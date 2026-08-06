/**
 * site_changes lifecycle API (migration 0048) — the approvals surface on top
 * of `src/services/siteChangeService.ts`.
 *
 * Guarantees enforced here, mirroring src/routes/seoSites.ts:
 *   - `tenantId` always comes from `req.user!.tenantId`, NEVER from the
 *     request body or a query param — a client-supplied tenant id would be a
 *     cross-tenant write/read.
 *   - Every response that carries a change returns a `SiteChangeDTO`
 *     (`toSiteChangeDTO`, src/services/siteChangeCapabilities.ts) — the UI
 *     reads `capabilities` off the row and must never re-derive them. This
 *     route file does not compute capabilities itself.
 *   - `stage`/`verify` are open to any authenticated tenant member (the
 *     capabilities module gates them with `requiresDecisionRole: false`).
 *     `approve`/`reject`/`publish`/`retry-publish`/`handoff-complete`, and
 *     creating a new
 *     proposal, are `admin`-only — `publish` most of all, since it is the one
 *     call that reaches a client's live website and the whole point of
 *     siteChangeService.ts's three-layer hard stop is that this is never an
 *     accident. `computeSiteChangeCapabilities`'s `DECISION_ROLES` comment
 *     calls this out explicitly; this router enforces it independently of
 *     that computation, not in place of it.
 *   - `publishApprovedChange` returning `null` means another process holds
 *     the publish lock — that is a 409 `publish_in_progress`, never a 500 and
 *     never treated as success.
 *   - A raw provider or DB error message never reaches the response body:
 *     `handleServiceError` logs the real error and returns a stable code.
 *
 * NOT mounted here — the orchestrator mounts this router in src/index.ts at
 * `/api/seo-changes`, behind `requireAuth` (+ likely `requireTenantFeature`,
 * matching seoSites.ts).
 */

import { Router, type Request, type Response } from 'express';
import { requireRole } from '../middleware/rbac';
import logger from '../utils/logger';
import { safeLogText } from '../utils/redactSecrets';
import {
  getSiteChange,
  listSiteChanges,
  createSiteChange,
  stageSiteChange,
  verifySiteChange,
  approveSiteChange,
  rejectSiteChange,
  publishApprovedChange,
  completeSiteChangeHandoff,
  retrySiteChangePublish,
  SiteChangeError,
  isSiteChangeStatus,
  SITE_CHANGE_STATUSES,
  type SiteChange,
  type SiteChangeKind,
  type SiteChangeStatus,
} from '../services/siteChangeService';
import { toSiteChangeDTO, resolveSiteChangePreviewTier } from '../services/siteChangeCapabilities';
import { getSeoSiteById } from '../services/seoSiteRegistry';
import {
  SiteProviderError,
  type SiteChangeInput,
  type SiteProviderErrorCode,
} from '../modules/site/providers/site-provider.interface';
import {
  fetchLivePageSnapshot,
  extractSeoElements,
  diffSeoElements,
  EMPTY_SEO_ELEMENTS,
  type SeoElements,
} from '../modules/site/liveSnapshot';

const router = Router();
const requireAdmin = requireRole('admin');

// Duplicated from siteChangeService.ts's `SiteChangeKind` union rather than
// exported as a runtime array from there — same trade-off seoSites.ts makes
// for PLATFORMS/RISK_PROFILES: the route layer owns its own input validation
// list, the service layer owns the type.
const SITE_CHANGE_KINDS = ['page_create', 'page_update', 'redirect', 'robots_txt', 'metafield'] as const;

// A preview is an interactive request an operator is staring at, not a
// background sweep — bounded well under fetchLivePageSnapshot's own 15s
// default so a slow client site doesn't hang the approvals UI.
const PREVIEW_FETCH_TIMEOUT_MS = 8_000;

class PayloadValidationError extends Error {}

function actorFrom(req: Request): { role: string } {
  return { role: req.user!.role };
}

// ---------------------------------------------------------------------------
// error mapping — SiteChangeError and SiteProviderError codes are stable and
// safe to echo (see each class's own doc comment on message content); every
// other error is logged in full and returned as a generic, non-leaking code.
// ---------------------------------------------------------------------------

const SITE_CHANGE_ERROR_STATUS: Record<SiteChangeError['code'], number> = {
  not_found: 404,
  invalid_transition: 409,
  version_conflict: 409,
  invalid_input: 400,
  site_not_ready: 409,
  unsupported_platform: 400,
};

const SITE_PROVIDER_ERROR_STATUS: Record<SiteProviderErrorCode, number> = {
  unknown_provider: 400,
  unsupported_capability: 400,
  missing_configuration: 409,
  invalid_input: 400,
  duplicate_operation: 409,
  provider_unavailable: 502,
  // The hard-stop-before-publish invariant reaching the API surface. Must
  // never be a 500 — a 500 here would look like a bug instead of the system
  // correctly refusing an unapproved publish.
  unauthorised_publish: 403,
  provider_response_invalid: 502,
};

function handleServiceError(e: unknown, res: Response): void {
  if (e instanceof SiteChangeError) {
    res.status(SITE_CHANGE_ERROR_STATUS[e.code]).json({ error: e.code, message: e.message });
    return;
  }
  if (e instanceof PayloadValidationError) {
    res.status(400).json({ error: 'validation_error', message: e.message });
    return;
  }
  if (e instanceof SiteProviderError) {
    // Detail is log-only; the response body gets a stable code and a generic
    // message, never the raw text. That stance is deliberately independent of
    // SiteProviderError's own "no secrets in the message" contract — a
    // misbehaving adapter could violate it, and this boundary should not
    // depend on that.
    //
    // But if we assume the message MIGHT carry a token, the log is exactly
    // where it would land, and Railway retains logs and shows them to anyone
    // with dashboard access. So the same distrust is applied on the way out:
    // `safeLogText` scrubs credential-shaped substrings before this is
    // written. Redacting a diagnostic string is cheap; a live token sitting
    // in retained logs is not.
    logger.error(`[site-changes] provider error (${e.provider}): ${e.code} — ${safeLogText(e.message)}`);
    const status = SITE_PROVIDER_ERROR_STATUS[e.code] ?? 502;
    const message =
      e.code === 'unauthorised_publish'
        ? 'This change has not been approved by a human — publish refused.'
        : 'The site provider could not complete this request.';
    res.status(status).json({ error: e.code, message });
    return;
  }
  logger.error('[site-changes] unexpected error:', e);
  res.status(500).json({ error: 'internal_error', message: 'Unexpected error.' });
}

/**
 * `version` is the client's optimistic-concurrency token and is mandatory on
 * every decision endpoint (approve/reject/handoff-complete) — a decision the
 * UI didn't base on the row it is currently showing must lose to a
 * `version_conflict`, not silently win. Returns `null` (having already
 * written the 400) when absent or malformed.
 */
function readRequiredVersion(body: Record<string, unknown>, res: Response): number | null {
  if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
    res.status(400).json({ error: 'validation_error', message: 'version is required and must be an integer' });
    return null;
  }
  return body.version as number;
}

// ---------------------------------------------------------------------------
// GET /api/seo-changes — list this tenant's changes. ?siteId&status&limit
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;

    let status: SiteChangeStatus | undefined;
    if (req.query.status !== undefined) {
      if (typeof req.query.status !== 'string' || !isSiteChangeStatus(req.query.status)) {
        res
          .status(400)
          .json({ error: 'validation_error', message: `status must be one of: ${SITE_CHANGE_STATUSES.join(', ')}` });
        return;
      }
      status = req.query.status;
    }

    let limit: number | undefined;
    if (req.query.limit !== undefined) {
      const parsed = Number(req.query.limit);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        res.status(400).json({ error: 'validation_error', message: 'limit must be a positive integer' });
        return;
      }
      limit = parsed;
    }

    const changes = await listSiteChanges(tenantId, { siteId, status, limit });
    const actor = actorFrom(req);
    res.json({ changes: changes.map((c) => toSiteChangeDTO(c, actor)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/seo-changes/:id — single change. 404s (not 403s) for another
// tenant's id, matching seoSites.ts's convention.
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const change = await getSiteChange(tenantId, req.params.id as string);
    if (!change) {
      res.status(404).json({ error: 'not_found', message: 'site change not found' });
      return;
    }
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes — propose a new change (admin-only). `source` is
// always 'admin' here — a cron or agent-originated proposal is a different
// call path this route does not expose.
// ---------------------------------------------------------------------------
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body.siteId !== 'string' || body.siteId.trim().length === 0) {
      throw new PayloadValidationError('siteId is required');
    }

    let changeKind: SiteChangeKind | undefined;
    if (body.changeKind !== undefined) {
      if (typeof body.changeKind !== 'string' || !(SITE_CHANGE_KINDS as readonly string[]).includes(body.changeKind)) {
        throw new PayloadValidationError(`changeKind must be one of: ${SITE_CHANGE_KINDS.join(', ')}`);
      }
      changeKind = body.changeKind as SiteChangeKind;
    }

    let pageUrl: string | null | undefined;
    if (body.pageUrl !== undefined) {
      if (body.pageUrl !== null && typeof body.pageUrl !== 'string') {
        throw new PayloadValidationError('pageUrl must be a string or null');
      }
      pageUrl = body.pageUrl as string | null;
    }

    if (typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload)) {
      throw new PayloadValidationError('payload must be an object');
    }

    const change = await createSiteChange(tenantId, {
      siteId: body.siteId as string,
      changeKind,
      pageUrl,
      payload: body.payload as Omit<SiteChangeInput, 'changeId'>,
      source: 'admin',
      createdBy: req.user!.id,
    });
    res.status(201).json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes/:id/stage — any authenticated tenant member. Not
// admin-gated: computeSiteChangeCapabilities marks `stage` with
// requiresDecisionRole: false, and the operation itself never touches a live
// site (see siteChangeService.ts's stage/publish split).
// ---------------------------------------------------------------------------
router.post('/:id/stage', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const change = await stageSiteChange(tenantId, req.params.id as string);
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes/:id/verify — same access as stage; see comment above.
// ---------------------------------------------------------------------------
router.post('/:id/verify', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const change = await verifySiteChange(tenantId, req.params.id as string);
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes/:id/approve — admin-only. { reason?, version }
// ---------------------------------------------------------------------------
router.post('/:id/approve', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = readRequiredVersion(body, res);
    if (version === null) return;

    if (body.reason !== undefined && typeof body.reason !== 'string') {
      res.status(400).json({ error: 'validation_error', message: 'reason must be a string' });
      return;
    }

    const change = await approveSiteChange(tenantId, req.params.id as string, {
      userId: req.user!.id,
      reason: body.reason as string | undefined,
      expectedVersion: version,
    });
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes/:id/reject — admin-only. { reason, version }. Reason
// is required (unlike approve) — rejectSiteChange enforces this too, but
// checking it here avoids a DB round-trip for an obviously-incomplete request.
// ---------------------------------------------------------------------------
router.post('/:id/reject', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = readRequiredVersion(body, res);
    if (version === null) return;

    if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'reason is required' });
      return;
    }

    const change = await rejectSiteChange(tenantId, req.params.id as string, {
      userId: req.user!.id,
      reason: body.reason as string,
      expectedVersion: version,
    });
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes/:id/publish — admin-only. The brief's endpoint table
// did not mark this admin, but computeSiteChangeCapabilities gates `publish`
// with requiresDecisionRole: true (canDecideSiteChanges === admin-only) and
// its own comment calls this out as deliberate: this is the one action that
// reaches a live website. Gating it here independently of that computed
// capability is defense in depth, not a substitute for it — see this file's
// header. No request body: publishApprovedChange takes no expectedVersion.
// ---------------------------------------------------------------------------
router.post('/:id/publish', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const change = await publishApprovedChange(tenantId, req.params.id as string);
    if (change === null) {
      // Someone else holds the publish lock — a double-click or a racing
      // worker, not a failure. Must never be retried automatically by this
      // layer; the caller decides whether to retry.
      res.status(409).json({
        error: 'publish_in_progress',
        message: 'Another process is already publishing this change — try again shortly.',
      });
      return;
    }
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/seo-changes/:id/handoff-complete — admin-only. { liveUrl?, version }
// ---------------------------------------------------------------------------
/**
 * Returns a failed publish to `approved` so it can be attempted again.
 *
 * A separate, explicit call rather than something the publish route retries
 * for itself: an automatic retry loop against a live client website is how one
 * bad publish becomes fifty. Admin-gated because it re-enters `approved`, one
 * step from touching a live site — and it deliberately does NOT re-ask for
 * approval, since the original approver and timestamp survive the round trip.
 */
router.post('/:id/retry-publish', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = readRequiredVersion(body, res);
    if (version === null) return;

    const change = await retrySiteChangePublish(tenantId, req.params.id as string, {
      expectedVersion: version,
    });
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

router.post('/:id/handoff-complete', requireAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = readRequiredVersion(body, res);
    if (version === null) return;

    if (body.liveUrl !== undefined && typeof body.liveUrl !== 'string') {
      res.status(400).json({ error: 'validation_error', message: 'liveUrl must be a string' });
      return;
    }

    const change = await completeSiteChangeHandoff(tenantId, req.params.id as string, {
      liveUrl: body.liveUrl as string | undefined,
      expectedVersion: version,
    });
    res.json({ change: toSiteChangeDTO(change, actorFrom(req)) });
  } catch (e) {
    handleServiceError(e, res);
  }
});

/**
 * Builds the "after" SEO surface for a preview from the change's stored
 * payload, falling back to `before` (or, absent that, an all-null baseline)
 * for anything the payload does not touch.
 *
 * A `bodyHtml` replacement supersedes the live page entirely — extracted
 * fresh so h1/word-count/JSON-LD-type changes show up, not just the three
 * metadata fields. Without a full body, only the fields `SiteChangeInput`
 * actually carries (metaTitle/metaDescription/canonicalUrl) are overlaid;
 * `payload` is untrusted request-shaped data by the time it reaches here, so
 * every field is type-checked before use rather than trusted from the cast.
 */
function computeAfterElements(change: SiteChange, before: SeoElements | null): SeoElements {
  const payload = change.payload as Partial<SiteChangeInput>;
  if (typeof payload.bodyHtml === 'string' && payload.bodyHtml.length > 0) {
    return extractSeoElements(payload.bodyHtml, change.pageUrl ?? undefined);
  }
  const base = before ?? EMPTY_SEO_ELEMENTS;
  return {
    ...base,
    metaTitle: typeof payload.metaTitle === 'string' ? payload.metaTitle : base.metaTitle,
    metaDescription: typeof payload.metaDescription === 'string' ? payload.metaDescription : base.metaDescription,
    canonicalUrl: typeof payload.canonicalUrl === 'string' ? payload.canonicalUrl : base.canonicalUrl,
  };
}

// ---------------------------------------------------------------------------
// GET /api/seo-changes/:id/preview — any authenticated tenant member (an
// operator who cannot approve should still be able to review). Never returns
// raw HTML — only the extracted SeoElements and the stored diff.
//
// "Before" is read live from the change's site. That fetch is best-effort: a
// client's site being down must never block reviewing/approving a change, so
// any failure (unsafe URL, timeout, non-2xx, transport error) degrades to
// `before: null` rather than failing the request — see liveSnapshot.ts's file
// header and this endpoint's brief.
// ---------------------------------------------------------------------------
router.get('/:id/preview', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const change = await getSiteChange(tenantId, req.params.id as string);
    if (!change) {
      res.status(404).json({ error: 'not_found', message: 'site change not found' });
      return;
    }

    let before: SeoElements | null = null;
    if (change.pageUrl) {
      const site = await getSeoSiteById(tenantId, change.siteId);
      if (site) {
        try {
          // change.pageUrl is conventionally a site-relative path; if it is
          // already absolute the URL constructor's base is ignored, so this
          // handles both — mirrors git.provider.ts's verifyChange.
          const absoluteUrl = new URL(change.pageUrl, `https://${site.domain}`).toString();
          const snapshot = await fetchLivePageSnapshot(absoluteUrl, {
            providerName: 'site-changes-preview',
            timeoutMs: PREVIEW_FETCH_TIMEOUT_MS,
          });
          before = snapshot.elements;
        } catch (e) {
          logger.warn(
            `[site-changes] preview: live fetch failed for change ${change.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
          before = null;
        }
      }
    }

    const after = computeAfterElements(change, before);

    res.json({
      tier: resolveSiteChangePreviewTier(change),
      diff: change.diff,
      elements: {
        before,
        after,
        // Field-level comparison, useful even (especially) on the 'elements'
        // tier where there is no stored diff to show at all.
        fieldDiff: diffSeoElements(before ?? EMPTY_SEO_ELEMENTS, after),
      },
    });
  } catch (e) {
    handleServiceError(e, res);
  }
});

export default router;
