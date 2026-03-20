import { Router } from 'express';
import { eq, or } from 'drizzle-orm';
import { db, contacts, contactChannels, messages } from '../db/index';
import { sendSequenceEmail, addContactToBrevo, sendManualEmail } from '../services/emailService';

const router = Router();

// ---------------------------------------------------------------------------
// POST /email/send
// Body: { contactId, templateName, tenantId }
// Called by n8n when processing an email sequence step.
// ---------------------------------------------------------------------------
router.post('/send', async (req, res) => {
  const { contactId, templateName, tenantId } = req.body as {
    contactId?: string;
    templateName?: string;
    tenantId?: string;
  };

  if (!contactId || !templateName || !tenantId) {
    res.status(400).json({ error: 'contactId, templateName, tenantId are required' });
    return;
  }

  try {
    const result = await sendSequenceEmail(contactId, templateName, tenantId);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(200).json({ success: false, reason: message });
  }
});

// ---------------------------------------------------------------------------
// POST /email/contact
// Body: { email, firstName, lastName, listName, attributes }
// Adds or updates a contact in Brevo.
// ---------------------------------------------------------------------------
router.post('/contact', async (req, res) => {
  const { email, firstName, lastName, listName, attributes } = req.body as {
    email?: string;
    firstName?: string;
    lastName?: string;
    listName?: string;
    attributes?: Record<string, unknown>;
  };

  if (!email || !firstName) {
    res.status(400).json({ error: 'email and firstName are required' });
    return;
  }

  const result = await addContactToBrevo(
    email,
    firstName,
    lastName ?? '',
    listName ?? 'Default',
    attributes ?? {},
  );

  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /email/manual
// Body: { contactId, subject, body }
// Sends a one-off email to a contact via Brevo and logs it.
// ---------------------------------------------------------------------------
router.post('/manual', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { contactId, subject, body } = req.body as {
    contactId?: string;
    subject?: string;
    body?: string;
  };

  if (!contactId || !subject || !body) {
    res.status(400).json({ error: 'contactId, subject, and body are required' });
    return;
  }

  // Look up contact name + email channel
  const [contactRow] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contactRow) {
    res.status(404).json({ error: 'contact not found' });
    return;
  }

  const emailChannel = await db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, contactId))
    .then((rows) => rows.find((r) => r.channelType === 'email'));

  if (!emailChannel) {
    res.status(400).json({ error: 'No email address found for contact' });
    return;
  }

  const toName = [contactRow.firstName, contactRow.lastName].filter(Boolean).join(' ');
  const result = await sendManualEmail(emailChannel.channelValue, toName, subject, body);

  // Log to messages table
  await db.insert(messages).values({
    tenantId,
    contactId,
    channel: 'email',
    direction: 'outbound',
    content: subject,
    status: result.success ? 'sent' : 'failed',
    externalId: result.messageId,
  });

  res.json(result);
});

export default router;
