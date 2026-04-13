import { Router, type Request, type Response } from 'express';
import { db, messages, contacts, contactChannels, waTemplates } from '../db/index';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Server as SocketServer } from 'socket.io';

const router = Router();

// Socket.io instance — injected by the main server
let _io: SocketServer | null = null;
export function setSocketIO(io: SocketServer) { _io = io; }

// Emit a new message event to the contact's socket room
export function emitNewMessage(contactId: string, message: Record<string, unknown>) {
  if (_io) {
    _io.to(`contact:${contactId}`).emit('new_message', message);
  }
}

// Emit status update
export function emitStatusUpdate(contactId: string, waMessageId: string, status: string) {
  if (_io) {
    _io.to(`contact:${contactId}`).emit('message_status', { waMessageId, status });
  }
}

// ---------------------------------------------------------------------------
// GET /api/inbox/conversations
// ---------------------------------------------------------------------------
router.get('/conversations', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;

  try {
    const rows = await db.execute(sql`
      SELECT
        c.id AS "contactId",
        c.first_name || COALESCE(' ' || c.last_name, '') AS "contactName",
        cc.channel_value AS "contactPhone",
        cc_em.channel_value AS "contactEmail",
        c.company_name AS "companyName",
        c.tags,
        c.source,
        m.content AS "lastMessage",
        m.sent_at AS "lastMessageAt",
        m.direction AS "lastDirection",
        m.channel AS "lastChannel",
        COUNT(m2.id) FILTER (WHERE m2.direction = 'inbound' AND m2.status = 'received') AS "unreadCount"
      FROM contacts c
      JOIN messages m ON m.id = (
        SELECT id FROM messages
        WHERE contact_id = c.id AND tenant_id = ${tenantId}
        ORDER BY sent_at DESC LIMIT 1
      )
      LEFT JOIN contact_channels cc ON cc.contact_id = c.id AND cc.channel_type = 'whatsapp'
      LEFT JOIN contact_channels cc_em ON cc_em.contact_id = c.id AND cc_em.channel_type = 'email'
      LEFT JOIN messages m2 ON m2.contact_id = c.id AND m2.tenant_id = ${tenantId}
      WHERE c.tenant_id = ${tenantId}
      GROUP BY c.id, c.first_name, c.last_name, cc.channel_value, cc_em.channel_value,
               c.company_name, c.tags, c.source, m.content, m.sent_at, m.direction, m.channel
      ORDER BY m.sent_at DESC
      LIMIT 100
    `);
    res.json({ conversations: rows.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/inbox/conversations/:contactId/messages
// ---------------------------------------------------------------------------
router.get('/conversations/:contactId/messages', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const contactId = req.params.contactId as string;

  try {
    const rows = await db.select().from(messages)
      .where(and(eq(messages.contactId, contactId), eq(messages.tenantId, tenantId)))
      .orderBy(messages.sentAt)
      .limit(200);
    res.json({ messages: rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/inbox/conversations/:contactId/send
// ---------------------------------------------------------------------------
router.post('/conversations/:contactId/send', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const contactId = req.params.contactId as string;
  const { message } = req.body;
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  try {
    // Get contact's WhatsApp number
    const [channel] = await db.select().from(contactChannels)
      .where(and(eq(contactChannels.contactId, contactId), eq(contactChannels.channelType, 'whatsapp')))
      .limit(1);
    if (!channel) { res.status(400).json({ error: 'contact has no WhatsApp number' }); return; }

    const phone = channel.channelValue.replace(/\D/g, '');
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      res.status(503).json({ error: 'WhatsApp not configured' });
      return;
    }

    // Send via Meta Cloud API
    const sendRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message },
      }),
    });
    const sendData = await sendRes.json() as Record<string, unknown>;
    const waMessageId = (sendData.messages as Array<{ id: string }> | undefined)?.[0]?.id || null;

    // Save to messages table
    const [saved] = await db.insert(messages).values({
      tenantId,
      contactId,
      channel: 'whatsapp',
      direction: 'outbound',
      externalId: waMessageId,
      content: message,
      messageType: 'text',
      status: 'sent',
    }).returning();

    // Emit socket event
    emitNewMessage(contactId, { ...saved });

    res.json({ message: saved });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/inbox/conversations/:contactId/send-template
// ---------------------------------------------------------------------------
router.post('/conversations/:contactId/send-template', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const contactId = req.params.contactId as string;
  const { templateName, languageCode, components } = req.body;
  if (!templateName) { res.status(400).json({ error: 'templateName required' }); return; }

  try {
    const [channel] = await db.select().from(contactChannels)
      .where(and(eq(contactChannels.contactId, contactId), eq(contactChannels.channelType, 'whatsapp')))
      .limit(1);
    if (!channel) { res.status(400).json({ error: 'contact has no WhatsApp number' }); return; }

    const phone = channel.channelValue.replace(/\D/g, '');
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken) { res.status(503).json({ error: 'WhatsApp not configured' }); return; }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode || 'en' },
        components: components || [],
      },
    };

    const sendRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const sendData = await sendRes.json() as Record<string, unknown>;
    const waMessageId = (sendData.messages as Array<{ id: string }> | undefined)?.[0]?.id || null;

    const [saved] = await db.insert(messages).values({
      tenantId,
      contactId,
      channel: 'whatsapp',
      direction: 'outbound',
      externalId: waMessageId,
      templateName,
      content: `[Template: ${templateName}]`,
      messageType: 'template',
      status: 'sent',
    }).returning();

    emitNewMessage(contactId, { ...saved });
    res.json({ message: saved });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/inbox/conversations/:contactId/read
// ---------------------------------------------------------------------------
router.post('/conversations/:contactId/read', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const contactId = req.params.contactId as string;

  try {
    await db.execute(sql`
      UPDATE messages
      SET status = 'read'
      WHERE contact_id = ${contactId}
        AND tenant_id = ${tenantId}
        AND direction = 'inbound'
        AND status = 'received'
    `);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/inbox/templates — list approved WA templates
// ---------------------------------------------------------------------------
router.get('/templates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db.select().from(waTemplates)
      .where(and(eq(waTemplates.tenantId, tenantId), eq(waTemplates.status, 'approved')));
    res.json({ templates: rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/inbox/unread-count — total unread across all conversations
// ---------------------------------------------------------------------------
router.get('/unread-count', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM messages
      WHERE tenant_id = ${tenantId} AND direction = 'inbound' AND status = 'received'
    `);
    res.json({ count: Number((result.rows[0] as Record<string,unknown> | undefined)?.count || 0) });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
