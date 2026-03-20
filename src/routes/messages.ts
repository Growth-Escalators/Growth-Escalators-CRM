import { Router } from 'express';
import { eq, desc, and, or } from 'drizzle-orm';
import { db, messages, contactChannels } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// POST /messages
// Creates a message record. Called by n8n after sending a WhatsApp or email.
// Body: tenantId, contactId, channel, direction, content, templateName?,
//       externalId?, status?
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { tenantId, contactId, channel, direction, content, templateName, externalId, status } =
    req.body as {
      tenantId: string;
      contactId: string;
      channel: string;
      direction: string;
      content: string;
      templateName?: string;
      externalId?: string;
      status?: string;
    };

  if (!tenantId || !contactId || !channel || !direction || !content) {
    res.status(400).json({ error: 'tenantId, contactId, channel, direction, content are required' });
    return;
  }

  const inserted = await db
    .insert(messages)
    .values({
      tenantId,
      contactId,
      channel,
      direction,
      content,
      templateName,
      externalId,
      status: status ?? 'sent',
    })
    .returning();

  res.status(201).json(inserted[0]);
});

// ---------------------------------------------------------------------------
// GET /messages?contactId=&limit=20
// Returns messages for a contact ordered by sentAt descending.
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { contactId } = req.query as Record<string, string>;
  const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);

  if (!contactId) {
    res.status(400).json({ error: 'contactId is required' });
    return;
  }

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.contactId, contactId))
    .orderBy(desc(messages.sentAt))
    .limit(limit);

  res.json({ messages: rows });
});

// ---------------------------------------------------------------------------
// POST /messages/send/whatsapp
// Body: { contactId, templateName, variables?: Record<string, string> }
// Sends a WhatsApp template message via Meta Cloud API and logs it.
// Requires env: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN
// ---------------------------------------------------------------------------
router.post('/send/whatsapp', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactId, templateName, variables = {} } = req.body as {
    contactId?: string;
    templateName?: string;
    variables?: Record<string, string>;
  };

  if (!contactId || !templateName) {
    res.status(400).json({ error: 'contactId and templateName are required' });
    return;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    res.status(503).json({ error: 'WhatsApp not configured (missing env vars)' });
    return;
  }

  // Look up contact's WhatsApp number
  const channel = await db
    .select()
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.contactId, contactId),
        or(eq(contactChannels.channelType, 'whatsapp'), eq(contactChannels.channelType, 'phone')),
      ),
    )
    .limit(1);

  if (channel.length === 0) {
    res.status(400).json({ error: 'No WhatsApp/phone number found for contact' });
    return;
  }

  const toNumber = channel[0].channelValue.replace(/\D/g, '');

  // Build template components from variables
  const variableValues = Object.values(variables);
  const components = variableValues.length > 0
    ? [{ type: 'body', parameters: variableValues.map((v) => ({ type: 'text', text: String(v) })) }]
    : [];

  const waPayload = {
    messaging_product: 'whatsapp',
    to: toNumber,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components,
    },
  };

  const waRes = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(waPayload),
    },
  );

  if (!waRes.ok) {
    const errBody = await waRes.text();
    res.status(502).json({ error: 'Meta API error', detail: errBody });
    return;
  }

  const waData = await waRes.json() as { messages?: Array<{ id: string }> };
  const externalId = waData.messages?.[0]?.id;

  // Log to messages table
  const [logged] = await db
    .insert(messages)
    .values({
      tenantId,
      contactId,
      channel: 'whatsapp',
      direction: 'outbound',
      content: `[Template: ${templateName}]`,
      templateName,
      externalId,
      status: 'sent',
    })
    .returning();

  res.json({ success: true, messageId: logged.id, externalId });
});

export default router;
