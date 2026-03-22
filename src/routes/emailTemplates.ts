import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, emailTemplates, messages } from '../db/index';
import { syncTemplateToBrevo } from '../services/brevoTemplateService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/email-templates/stats — per-template sent counts from messages table
// (must be before /:id)
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  const tenantId = req.user!.tenantId;

  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.isActive, true)));

  const stats = rows.map((t) => ({
    id: t.id,
    name: t.name,
    sentCount: t.sentCount ?? 0,
    openRate: t.openRate ?? null,
    brevoSynced: t.brevoSynced,
    brevoTemplateId: t.brevoTemplateId,
  }));

  res.json(stats);
});

// ---------------------------------------------------------------------------
// GET /api/email-templates — list all active templates
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;

  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.isActive, true)))
    .orderBy(emailTemplates.createdAt);

  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/email-templates/:id — single template
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;

  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'template not found' });
    return;
  }
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// POST /api/email-templates — create template + auto-sync to Brevo
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { name, displayName, type, subject, fromName, bodyHtml, bodyText, variables } = req.body;

  if (!name || !subject) {
    res.status(400).json({ error: 'name and subject are required' });
    return;
  }

  const inserted = await db
    .insert(emailTemplates)
    .values({ tenantId, name, displayName, type, subject, fromName, bodyHtml, bodyText, variables })
    .returning();

  const template = inserted[0];

  // Try to sync to Brevo (non-blocking on error)
  const syncResult = await syncTemplateToBrevo(template);

  // Reload from DB to get updated brevoTemplateId
  const updated = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.id, template.id))
    .limit(1);

  res.status(201).json({ ...updated[0], _syncResult: syncResult });
});

// ---------------------------------------------------------------------------
// PATCH /api/email-templates/:id — update template, re-sync if content changed
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const { name, displayName, type, subject, fromName, bodyHtml, bodyText, variables } = req.body;

  const existing = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);

  if (existing.length === 0) {
    res.status(404).json({ error: 'template not found' });
    return;
  }

  const updates: Partial<typeof emailTemplates.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (displayName !== undefined) updates.displayName = displayName;
  if (type !== undefined) updates.type = type;
  if (subject !== undefined) updates.subject = subject;
  if (fromName !== undefined) updates.fromName = fromName;
  if (bodyHtml !== undefined) updates.bodyHtml = bodyHtml;
  if (bodyText !== undefined) updates.bodyText = bodyText;
  if (variables !== undefined) updates.variables = variables;

  const updatedRows = await db
    .update(emailTemplates)
    .set(updates)
    .where(eq(emailTemplates.id, id))
    .returning();

  const template = updatedRows[0];

  // Re-sync if content or subject changed
  const contentChanged =
    subject !== undefined ||
    bodyHtml !== undefined ||
    bodyText !== undefined ||
    fromName !== undefined;

  let syncResult = null;
  if (contentChanged) {
    syncResult = await syncTemplateToBrevo(template);
  }

  // Reload
  const final = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.id, id))
    .limit(1);

  res.json({ ...final[0], _syncResult: syncResult });
});

// ---------------------------------------------------------------------------
// DELETE /api/email-templates/:id — soft delete (isActive = false)
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;

  await db
    .update(emailTemplates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)));

  res.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// POST /api/email-templates/:id/sync — force sync to Brevo
// ---------------------------------------------------------------------------
router.post('/:id/sync', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;

  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'template not found' });
    return;
  }

  const result = await syncTemplateToBrevo(rows[0]);
  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /api/email-templates/:id/send-test — send test email via Brevo
// ---------------------------------------------------------------------------
router.post('/:id/send-test', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { id } = req.params;
  const { toEmail, variables: vars = {} } = req.body as {
    toEmail?: string;
    variables?: Record<string, string>;
  };

  if (!toEmail) {
    res.status(400).json({ error: 'toEmail is required' });
    return;
  }

  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.tenantId, tenantId)))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'template not found' });
    return;
  }

  const template = rows[0];
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    res.json({ sent: true, mock: true, messageId: `mock-${Date.now()}` });
    return;
  }

  // Substitute variables in subject + body
  function substitute(str: string): string {
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  const subject = substitute(template.subject);
  const rawHtml =
    template.bodyHtml ||
    (template.bodyText ?? '').replace(/\n/g, '<br>');
  const htmlContent = substitute(rawHtml);

  const payload: Record<string, unknown> = {
    subject,
    htmlContent,
    sender: { name: template.fromName ?? 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
    to: [{ email: toEmail, name: toEmail }],
  };

  // Prefer Brevo template ID if synced
  if (template.brevoTemplateId) {
    delete payload.htmlContent;
    payload.templateId = template.brevoTemplateId;
    payload.params = vars;
  }

  const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!brevoRes.ok) {
    const err = await brevoRes.text();
    res.status(500).json({ sent: false, error: err });
    return;
  }

  const data = (await brevoRes.json()) as { messageId?: string };
  res.json({ sent: true, messageId: data.messageId });
});

export default router;
