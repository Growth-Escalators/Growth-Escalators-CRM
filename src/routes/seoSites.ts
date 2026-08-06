/**
 * seo_sites registry API (migration 0046).
 *
 * Guarantees enforced here:
 *   - `tenantId` always comes from `req.user!.tenantId`, NEVER from the
 *     request body or a query param — a client-supplied tenant id would be a
 *     cross-tenant write. Matches this repo's convention (see
 *     src/routes/contacts.ts, src/routes/subscriptions.ts,
 *     src/routes/tenantIntegrations.ts).
 *   - GET (list + single) is readable by any authenticated tenant member.
 *     POST/PATCH/DELETE are admin-only (`requireRole('admin')`, the same
 *     helper `wizmatchPolicy.ts`/`wizmatchTelemetry.ts`/`integrations.ts` use
 *     for their admin-only routes).
 *   - POST enforces the caller's plan `limits.seoSites` (jsonb on `plans`,
 *     resolved via that tenant's active `subscriptions` row) before creating
 *     a new site. A tenant with no active subscription, or a plan whose
 *     `limits` has no `seoSites` key, is NOT limited — see `getSeoSiteLimit`.
 *   - `platform` and `riskProfile` are validated against a fixed enum here;
 *     everything else (secret-shaped `adapterConfig` keys, domain
 *     uniqueness) is enforced by the service layer (`seoSiteRegistry.ts`),
 *     which is also the tenant-isolation boundary these routes sit on top of.
 *
 * NOT mounted here — the orchestrator mounts this router in src/index.ts at
 * `/api/seo-sites`, behind `requireAuth` + `requireTenantFeature('seo')`.
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import { requireRole } from '../middleware/rbac';
import logger from '../utils/logger';
import {
  listSeoSites,
  getSeoSiteById,
  createSeoSite,
  updateSeoSite,
  archiveSeoSite,
  countSeoSites,
  SeoSiteRegistryError,
  type CreateSeoSiteInput,
  type UpdateSeoSiteInput,
} from '../services/seoSiteRegistry';

const router = Router();
const requireAdmin = requireRole('admin');

const PLATFORMS = ['git', 'wordpress', 'shopify', 'unknown'] as const;
const RISK_PROFILES = ['low', 'standard', 'high'] as const;
type Platform = (typeof PLATFORMS)[number];
type RiskProfile = (typeof RISK_PROFILES)[number];

class PayloadValidationError extends Error {}

// Parses+validates the subset of CreateSeoSiteInput fields present in the
// body. Every field is optional here (PATCH sends a subset; POST's required-
// field check happens separately, after this) — this only rejects fields
// that ARE present but malformed.
function parseSitePayload(body: Record<string, unknown>): Partial<CreateSeoSiteInput> {
  const out: Partial<CreateSeoSiteInput> = {};

  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) {
      throw new PayloadValidationError('label must be a non-empty string');
    }
    out.label = body.label as string;
  }
  if (body.domain !== undefined) {
    if (typeof body.domain !== 'string' || !body.domain.trim()) {
      throw new PayloadValidationError('domain must be a non-empty string');
    }
    out.domain = body.domain as string;
  }
  if (body.clientId !== undefined) {
    if (body.clientId !== null && typeof body.clientId !== 'string') {
      throw new PayloadValidationError('clientId must be a string or null');
    }
    out.clientId = body.clientId as string | null;
  }
  if (body.platform !== undefined) {
    if (typeof body.platform !== 'string' || !(PLATFORMS as readonly string[]).includes(body.platform as string)) {
      throw new PayloadValidationError(`platform must be one of: ${PLATFORMS.join(', ')}`);
    }
    out.platform = body.platform as Platform;
  }
  if (body.adapterConfig !== undefined) {
    if (typeof body.adapterConfig !== 'object' || body.adapterConfig === null || Array.isArray(body.adapterConfig)) {
      throw new PayloadValidationError('adapterConfig must be an object');
    }
    out.adapterConfig = body.adapterConfig as Record<string, unknown>;
  }
  if (body.credentialProvider !== undefined) {
    if (body.credentialProvider !== null && typeof body.credentialProvider !== 'string') {
      throw new PayloadValidationError('credentialProvider must be a string or null');
    }
    out.credentialProvider = body.credentialProvider as string | null;
  }
  if (body.gscProperty !== undefined) {
    if (body.gscProperty !== null && typeof body.gscProperty !== 'string') {
      throw new PayloadValidationError('gscProperty must be a string or null');
    }
    out.gscProperty = body.gscProperty as string | null;
  }
  if (body.ga4PropertyId !== undefined) {
    if (body.ga4PropertyId !== null && typeof body.ga4PropertyId !== 'string') {
      throw new PayloadValidationError('ga4PropertyId must be a string or null');
    }
    out.ga4PropertyId = body.ga4PropertyId as string | null;
  }
  if (body.riskProfile !== undefined) {
    if (typeof body.riskProfile !== 'string' || !(RISK_PROFILES as readonly string[]).includes(body.riskProfile as string)) {
      throw new PayloadValidationError(`riskProfile must be one of: ${RISK_PROFILES.join(', ')}`);
    }
    out.riskProfile = body.riskProfile as RiskProfile;
  }
  if (body.requiredChecks !== undefined) {
    if (!Array.isArray(body.requiredChecks) || !body.requiredChecks.every((v) => typeof v === 'string')) {
      throw new PayloadValidationError('requiredChecks must be an array of strings');
    }
    out.requiredChecks = body.requiredChecks as string[];
  }
  if (body.autoPublishAllowed !== undefined) {
    if (typeof body.autoPublishAllowed !== 'boolean') {
      throw new PayloadValidationError('autoPublishAllowed must be a boolean');
    }
    out.autoPublishAllowed = body.autoPublishAllowed as boolean;
  }
  if (body.observationWindowDays !== undefined) {
    if (
      typeof body.observationWindowDays !== 'number' ||
      !Number.isInteger(body.observationWindowDays) ||
      body.observationWindowDays < 0
    ) {
      throw new PayloadValidationError('observationWindowDays must be a non-negative integer');
    }
    out.observationWindowDays = body.observationWindowDays as number;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !body.status.trim()) {
      throw new PayloadValidationError('status must be a non-empty string');
    }
    out.status = body.status as string;
  }

  return out;
}

function handleServiceError(e: unknown, res: Response): void {
  if (e instanceof SeoSiteRegistryError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return;
  }
  logger.error('[seo-sites] unexpected error:', e);
  res.status(500).json({ error: 'internal_error' });
}

// ---------------------------------------------------------------------------
// Plan limit: `plans.limits` is a free-form jsonb bag (see schema.ts comment
// on `plans`). `limits.seoSites`, when present and numeric, caps how many
// non-archived sites a tenant may register. Resolved from the tenant's most
// recently created `status = 'active'` subscription — a tenant with no
// active subscription (never subscribed, or lapsed) has no plan limit to
// read, so POST is NOT blocked in that case; billing enforcement for that
// state is a separate concern from this registry.
// ---------------------------------------------------------------------------
async function getSeoSiteLimit(tenantId: string): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT p.limits AS limits
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = $1 AND s.status = 'active'
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [tenantId],
  );
  const limits = rows[0]?.limits as Record<string, unknown> | undefined;
  const value = limits?.seoSites;
  return typeof value === 'number' ? value : null;
}

// ---------------------------------------------------------------------------
// GET /api/seo-sites — list this tenant's sites.
// ?includeInactive=true also returns paused/archived sites.
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const sites = await listSeoSites(tenantId, { includeInactive });
    res.json({ sites });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-sites/:id — single site. 404s (not 403s) for another
// tenant's id — the service's tenant-scoped WHERE clause makes that id
// indistinguishable from a non-existent one.
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const site = await getSeoSiteById(tenantId, req.params.id as string);
    if (!site) {
      res.status(404).json({ error: 'not_found', message: 'SEO site not found' });
      return;
    }
    res.json({ site });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-sites — create (admin-only). Enforces limits.seoSites
// before calling the service.
// ---------------------------------------------------------------------------
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseSitePayload(body);
    if (!parsed.label || !parsed.domain) {
      res.status(400).json({ error: 'validation_error', message: 'label and domain are required' });
      return;
    }

    const limit = await getSeoSiteLimit(tenantId);
    if (limit !== null) {
      const current = await countSeoSites(tenantId);
      if (current >= limit) {
        res.status(402).json({
          error: 'seo_site_limit_reached',
          message: `Your plan allows up to ${limit} SEO site${limit === 1 ? '' : 's'}; this tenant already has ${current} registered.`,
        });
        return;
      }
    }

    const input: CreateSeoSiteInput = { ...parsed, label: parsed.label!, domain: parsed.domain! };
    const site = await createSeoSite(tenantId, input);
    res.status(201).json({ site });
  } catch (e) {
    if (e instanceof PayloadValidationError) {
      res.status(400).json({ error: 'validation_error', message: e.message });
      return;
    }
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/seo-sites/:id — partial update (admin-only).
// ---------------------------------------------------------------------------
router.patch('/:id', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: UpdateSeoSiteInput = parseSitePayload(body);
    const site = await updateSeoSite(tenantId, req.params.id as string, patch);
    if (!site) {
      res.status(404).json({ error: 'not_found', message: 'SEO site not found' });
      return;
    }
    res.json({ site });
  } catch (e) {
    if (e instanceof PayloadValidationError) {
      res.status(400).json({ error: 'validation_error', message: e.message });
      return;
    }
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/seo-sites/:id — archive, not delete (admin-only). Nine SEO
// tables carry an FK to seo_sites.id; a real DELETE would fail on the FK or
// orphan their rows. See archiveSeoSite in the service for the full reason.
// ---------------------------------------------------------------------------
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const archived = await archiveSeoSite(tenantId, req.params.id as string);
    if (!archived) {
      res.status(404).json({ error: 'not_found', message: 'SEO site not found' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    handleServiceError(e, res);
  }
});

export default router;
