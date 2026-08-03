// Tenant feature gating — first reader of `tenants.plan` / `tenants.settings`.
//
// WHY THIS EXISTS. `tenants.plan` (default 'agency_internal') and
// `tenants.settings` (default '{}') have existed in the schema since the
// original multi-tenant design (src/db/schema.ts) but were never read
// anywhere. Every feature in this codebase today is gated by a single global
// `process.env.*_ENABLED` check that applies identically to every tenant
// (e.g. WIZMATCH_COMPANY_POLICY_ENABLED), and background automation
// (src/worker.ts crons, the lead-intake drainers, SEO tenant context) is
// hardcoded to a single tenant via DEFAULT_TENANT_SLUG / WIZMATCH_TENANT_ID.
// That architecture cannot ever run automation for a second tenant.
//
// This module is the seam: `tenants.settings.features` is a per-tenant JSONB
// override, and PLAN_DEFAULTS below is a per-plan fallback used whenever a
// tenant's `settings.features` is empty (i.e. every tenant that existed
// before this file shipped — production tenants are NOT backfilled by this
// PR, see docs/decisions or the PR description). That fallback table is
// hand-verified against what's ACTUALLY true today per tenant via the global
// env vars, which is what makes rollout safe: an unmigrated tenant's
// behaviour is unchanged.
//
// SCOPE — deliberately small. This does NOT replace every
// `process.env.*_ENABLED` check in the codebase (that's a large follow-up
// effort, out of scope here). It covers exactly the subsystems this PR
// de-hardcodes off a single env-var-resolved tenant: Wizmatch automation,
// SEO automation, and generic CRM background automation (lead-intake
// sweeper, job drainer, agency-lead capture) — plus `gstBilling` and `d2c`
// as illustrative extras for the pattern.

import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenants } from '../db/schema';
import logger from '../utils/logger';

export interface TenantFeatureFlags {
  /** Wizmatch product surfaces + automation (signals, matching, discovery, staffing, sending). */
  wizmatch: boolean;
  /** SEO automation subsystem (rank tracking, content decay, digests, backlinks, ...). */
  seo: boolean;
  /** Generic CRM background automation: lead-intake sweeper, job drainer, agency-lead capture, daily intelligence report. */
  crmAutomation: boolean;
  /** GST invoicing (India) — the Overdue Invoice Check cron and related billing automation. */
  gstBilling: boolean;
  /** D2C / ecom features. */
  d2c: boolean;
}

const ALL_OFF: TenantFeatureFlags = {
  wizmatch: false,
  seo: false,
  crmAutomation: false,
  gstBilling: false,
  d2c: false,
};

/**
 * Per-plan defaults, used ONLY when a tenant's `settings.features` is empty
 * or missing. Each entry below is annotated with the concrete evidence for
 * why it matches today's ground truth — update the comment if you change a
 * default, so this table doesn't silently drift from reality again.
 */
const PLAN_DEFAULTS: Record<string, TenantFeatureFlags> = {
  // growth-escalators — today's DEFAULT_TENANT_SLUG target. Every SEO cron
  // (rank tracking, content decay, digests, ...) resolves its tenant via
  // resolveDefaultSeoTenantId() -> DEFAULT_TENANT_SLUG. The active "Overdue
  // Invoice Check" cron hardcodes DEFAULT_TENANT_SLUG. The generic
  // lead-intake sweepers (jobDrainer, edgeQueueDrainer, leads.ts POST
  // /agency) all resolve DEFAULT_TENANT_SLUG. This tenant does not run any
  // Wizmatch automation — WIZMATCH_TENANT_ID never equals this tenant's id.
  agency_internal: { wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true },
  // wizmatch — today's WIZMATCH_TENANT_ID target. The entire Wizmatch cron
  // block in worker.ts (signal scoring/enrichment/matching, domain
  // health/warmup, results-first sourcing, company prep, staffing reminders)
  // runs ONLY for whichever tenant id that env var holds, which in
  // production is this tenant. It receives none of the generic
  // CRM/SEO/billing automation above.
  wizmatch_internal: { wizmatch: true, seo: false, crmAutomation: false, gstBilling: false, d2c: false },
  // client_basic — e.g. a CRM-only client tenant (referred to by slug only,
  // never by client name, per repo convention). No background automation is
  // wired to this plan today.
  client_basic: { ...ALL_OFF },
  // reseller_pilot — white-label reseller pilot agencies, manually provisioned
  // one at a time via scripts/onboarding/provisionResellerTenant.ts (Phase 2
  // of the reseller plan; self-serve signup is a later phase, out of scope
  // here). Pilot tenants get the plain CRM (contacts/pipeline/deals — same
  // "generic automation" surface client_basic tenants would get once wired
  // up) but NOT Wizmatch, SEO, GST billing, or D2C — those are
  // Growth-Escalators-internal product surfaces this pilot has no reason to
  // see. Revisit this table once a pilot actually needs one of those flipped
  // on (per-tenant override via `settings.features` already supports that
  // without touching this default).
  reseller_pilot: { wizmatch: false, seo: false, crmAutomation: true, gstBilling: false, d2c: false },
};

/**
 * Pure — merges a tenant's plan + settings.features into a resolved
 * TenantFeatureFlags. Exported separately from getTenantFeatures() so this
 * logic is testable without mocking the DB (matches this repo's convention,
 * e.g. jobDrainer.ts's parseTallySubmission).
 */
export function computeTenantFeatures(
  plan: string | null | undefined,
  settings: unknown,
): TenantFeatureFlags {
  const planDefaults = PLAN_DEFAULTS[plan ?? ''] ?? ALL_OFF;
  const stored =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).features
      : undefined;
  if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0) {
    return { ...planDefaults, ...(stored as Partial<TenantFeatureFlags>) };
  }
  return { ...planDefaults };
}

/** Resolves a tenant's feature flags by id. Throws if the tenant does not exist. */
export async function getTenantFeatures(tenantId: string): Promise<TenantFeatureFlags> {
  const [tenant] = await db
    .select({ plan: tenants.plan, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error(`[tenant-features] no tenant found for id=${tenantId}`);
  return computeTenantFeatures(tenant.plan, tenant.settings);
}

export interface ActiveTenantRef {
  id: string;
  slug: string;
}

/**
 * All active tenants whose resolved features have `feature` === true. This is
 * the replacement for "resolve one hardcoded tenant via DEFAULT_TENANT_SLUG /
 * WIZMATCH_TENANT_ID" in the automation/cron layer — a cron that used to read
 * a single env var now loops over this list, so a second tenant with the
 * feature enabled is picked up automatically.
 */
export async function getActiveTenantsWithFeature(
  feature: keyof TenantFeatureFlags,
): Promise<ActiveTenantRef[]> {
  const rows = await db
    .select({ id: tenants.id, slug: tenants.slug, plan: tenants.plan, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.isActive, true));
  return rows
    .filter((row) => computeTenantFeatures(row.plan, row.settings)[feature])
    .map((row) => ({ id: row.id, slug: row.slug }));
}

/**
 * Convenience for call sites that (today) only ever attribute work to ONE
 * tenant — a single inbound lead, a single memoized SEO context — rather than
 * a cron sweep. Returns null when no active tenant has the feature on.
 *
 * If more than one tenant qualifies, this is a genuinely ambiguous case for a
 * single-attribution call site (which tenant does this webhook/lead belong
 * to?) — it deterministically picks the first by slug and logs a warning
 * rather than throwing, since these call sites already have a
 * "resolve exactly one tenant or fail" contract to preserve. Proper
 * per-request tenant routing for these surfaces (e.g. a tenant hint on the
 * inbound payload) is a follow-up, not solved by this helper.
 */
export async function getSingleActiveTenantWithFeature(
  feature: keyof TenantFeatureFlags,
): Promise<ActiveTenantRef | null> {
  const matches = await getActiveTenantsWithFeature(feature);
  if (matches.length > 1) {
    logger.warn(
      { feature, tenantSlugs: matches.map((t) => t.slug) },
      '[tenant-features] multiple active tenants have this feature enabled for a single-attribution call site — using the first by slug',
    );
    return [...matches].sort((a, b) => a.slug.localeCompare(b.slug))[0];
  }
  return matches[0] ?? null;
}
