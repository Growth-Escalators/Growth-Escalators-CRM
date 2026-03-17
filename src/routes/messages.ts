import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, messages } from '../db/index';

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

  res.json(rows);
});

export default router;
