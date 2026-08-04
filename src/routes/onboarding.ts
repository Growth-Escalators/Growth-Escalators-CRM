import { Router, type Request, type Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db, contacts, pipelines } from '../db/index';
import { getTenantDocumentIdentity } from '../services/tenantBrandingDefaults';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/onboarding/status — first-run setup checklist for the Dashboard.
//
// Backs the "you haven't finished setting up yet" card a freshly-provisioned
// reseller tenant sees on an otherwise-empty Dashboard. Every item is
// derived from data that already exists (tenant_branding, contacts,
// pipelines) — no new tables/columns, no persisted "dismissed" flag. That
// keeps this endpoint a pure read: three cheap existence checks per request,
// tenant-scoped exactly like every other route in this file's family
// (contacts.ts, pipelines.ts, tenantBranding.ts).
//
// A tenant with real data (Growth Escalators' own tenant included) simply
// gets every item back `done: true` / `allComplete: true` — the admin UI
// hides the card in that case. No tenant-id special-casing lives here or in
// the frontend.
// ---------------------------------------------------------------------------
router.get('/status', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const [identity, [contactRow], [pipelineRow]] = await Promise.all([
      getTenantDocumentIdentity(tenantId),
      db.select({ id: contacts.id }).from(contacts).where(eq(contacts.tenantId, tenantId)).limit(1),
      db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.isActive, true)))
        .limit(1),
    ]);

    const items = [
      {
        key: 'branding',
        label: 'Set up your branding',
        description: 'Add your legal business name so invoices and client-facing documents use your own identity.',
        done: !!identity?.legalEntityName?.trim(),
        link: '/settings/branding',
      },
      {
        key: 'contacts',
        label: 'Add your first contact',
        description: 'Bring in a lead or client so the CRM has something to work with.',
        done: !!contactRow,
        link: '/contacts',
      },
      {
        key: 'pipeline',
        label: 'Create a pipeline',
        description: 'Set up a deal pipeline to start tracking opportunities.',
        done: !!pipelineRow,
        link: '/pipeline',
      },
    ];

    res.json({ items, allComplete: items.every((item) => item.done) });
  } catch (e: unknown) {
    logger.error('[onboarding] GET /status error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
