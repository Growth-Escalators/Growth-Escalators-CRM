import { Router } from 'express';
import { sendSequenceEmail, addContactToBrevo } from '../services/emailService';

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

export default router;
