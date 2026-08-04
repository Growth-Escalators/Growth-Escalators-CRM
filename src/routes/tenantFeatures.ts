// Read-only surface for src/services/tenantFeatures.ts, for the admin SPA.
//
// WHY THIS EXISTS. Route-level enforcement (requireTenantFeature.ts) already
// stops a tenant without a feature from calling its API — but the admin
// nav (admin/src/components/navEntries.js) had no way to know a feature was
// off, so it kept showing the nav entry and the tenant discovered the gate
// only by clicking through to a 403. This endpoint is what the nav fetches
// to match its own visibility to what the backend actually allows, the same
// way GET /api/tenant-branding backs the white-label chrome.
//
// Deliberately minimal: one GET, tenant-scoped strictly by req.user.tenantId
// (never a client-supplied id/slug — same rule as every other per-tenant read
// in this file's siblings), no write path. Mount AFTER requireStrictAuth (it
// reads req.user, same precondition as requireTenantFeature.ts).
import { Router, type Request, type Response } from 'express';
import { getTenantFeatures } from '../services/tenantFeatures';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/tenant-features/me
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const features = await getTenantFeatures(tenantId);
    res.json({ features });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
