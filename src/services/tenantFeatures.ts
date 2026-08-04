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
import { DEFAULT_TENANT_SLUG } from '../config/constants';
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
  // up) PLUS GST billing — `/api/billing` is gated behind
  // `requireTenantFeature('gstBilling')`, and the tenant-driven invoice
  // branding work (legal/financial identity sourced from `tenant_branding`)
  // was built specifically so a pilot can invoice ITS OWN clients under its
  // own identity, not GE's; leaving this flag off made that work
  // unreachable for the tenants it exists for. Still NOT Wizmatch, SEO, or
  // D2C — those stay Growth-Escalators-internal product surfaces this pilot
  // has no reason to see. Revisit this table once a pilot needs one of those
  // flipped on (per-tenant override via `settings.features` already
  // supports that without touching this default).
  //
  // NOTE: this default only applies going forward — provisionResellerTenant.ts
  // derives a new tenant's `settings.features` from this table at creation
  // time, so newly-provisioned tenants pick it up automatically. It is not
  // retroactive: any reseller_pilot tenant already provisioned before this
  // change keeps whatever `settings.features` it was given at the time and
  // needs a separate manual fix, not covered by this change.
  reseller_pilot: { wizmatch: false, seo: false, crmAutomation: true, gstBilling: true, d2c: false },
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
 * tenant — a single memoized SEO context, a single billing sweep — rather
 * than a cron sweep over every qualifying tenant. Returns null when no
 * active tenant has the feature on.
 *
 * BUG HISTORY (fixed 2026-08-04): this used to deterministically pick the
 * FIRST qualifying tenant by slug when more than one matched, on the theory
 * that these call sites already have a "resolve exactly one tenant or fail"
 * contract to preserve. That was wrong for any call site ingesting data that
 * arrives from GE's OWN infrastructure (inbound website leads, the edge
 * queue, the job drainer) rather than genuinely being "whichever tenant has
 * this feature" — the instant a second tenant (e.g. a `reseller_pilot`
 * tenant, which also has `crmAutomation: true`) sorted before
 * `growth-escalators` by slug, GE's own inbound leads silently routed to the
 * reseller instead. See src/services/tenantFeatures.ts's getDefaultIngestTenant()
 * for the fix for THOSE call sites: they now pin DEFAULT_TENANT_SLUG
 * explicitly instead of resolving through this feature-scan.
 *
 * What's left calling this helper (worker.ts's gstBilling sweep,
 * seoTenantContext.ts's SEO tenant memo) are genuinely single-tenant-by-
 * feature lookups where guessing is not an option — so ambiguity here now
 * throws loudly instead of silently picking a winner. "Returning an
 * arbitrary one" is the bug class; a caller that hits this needs a human to
 * resolve which tenant should actually own the feature, not code that
 * guesses.
 */
export async function getSingleActiveTenantWithFeature(
  feature: keyof TenantFeatureFlags,
): Promise<ActiveTenantRef | null> {
  const matches = await getActiveTenantsWithFeature(feature);
  if (matches.length > 1) {
    const tenantSlugs = matches.map((t) => t.slug).sort();
    logger.error(
      { feature, tenantSlugs },
      '[tenant-features] multiple active tenants have this feature enabled for a single-attribution call site — refusing to guess which one owns this data',
    );
    throw new Error(
      `[tenant-features] ambiguous tenant resolution for feature="${feature}": ${tenantSlugs.length} active tenants qualify (${tenantSlugs.join(', ')}) and this call site can only attribute work to one. Resolve the ambiguity (per-tenant settings.features override, or a narrower call site) rather than picking one arbitrarily.`,
    );
  }
  return matches[0] ?? null;
}

/**
 * Resolves GE's OWN tenant (DEFAULT_TENANT_SLUG), for ingestion surfaces that
 * receive data arriving from GE's own website/edge infrastructure — the
 * agency-lead capture route, the edge queue drainer, the job drainer's
 * form_submit recovery, and the daily intelligence collector. These are NOT
 * "which tenant currently has this feature enabled" lookups: the data's
 * ORIGIN is always GE's own infra, so the destination tenant must be pinned
 * explicitly by slug rather than resolved by scanning every active tenant for
 * a feature flag (see getSingleActiveTenantWithFeature's docstring for the
 * bug that pattern caused — a reseller_pilot tenant sorting before
 * growth-escalators silently stole GE's own inbound leads).
 *
 * Still fails closed the same way the old feature-scan did: returns null (not
 * GE's row) when GE's tenant is inactive or does not have `feature` enabled,
 * so flipping crmAutomation off for GE still turns ingestion off rather than
 * silently falling through to some other tenant.
 */
export async function getDefaultIngestTenant(
  feature: keyof TenantFeatureFlags = 'crmAutomation',
): Promise<ActiveTenantRef | null> {
  const [row] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      plan: tenants.plan,
      settings: tenants.settings,
      isActive: tenants.isActive,
    })
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG))
    .limit(1);
  if (!row || !row.isActive) return null;
  if (!computeTenantFeatures(row.plan, row.settings)[feature]) return null;
  return { id: row.id, slug: row.slug };
}

// ---------------------------------------------------------------------------
// Subscription-billing entitlement enforcement (added alongside
// src/services/paymentGateway/ + the plans/subscriptions tables).
//
// Everything above this line is read-only from the app's perspective — until
// now nothing wrote `tenants.settings.features` (see the module doc comment
// at the top of this file). Subscription billing is the first writer: when a
// tenant's subscription activates, its plan's `feature_entitlements` (see
// `plans` in src/db/schema.ts) should take effect immediately rather than
// waiting on a PLAN_DEFAULTS lookup keyed off the coarse `tenants.plan`
// string, which has no notion of a purchased plan row.
// ---------------------------------------------------------------------------

/**
 * Merges `features` into a tenant's `settings.features`, preserving every
 * other key already in `settings` (and any feature flags not present in this
 * call). This is a partial merge, not a replace — so activating a plan's
 * entitlements can never silently clear a flag set by some other, unrelated
 * write to `settings` in the future.
 */
export async function setTenantFeatures(
  tenantId: string,
  features: Partial<TenantFeatureFlags>,
): Promise<void> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error(`[tenant-features] no tenant found for id=${tenantId}`);

  const existingSettings =
    tenant.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings)
      ? (tenant.settings as Record<string, unknown>)
      : {};
  const existingFeatures =
    existingSettings.features &&
    typeof existingSettings.features === 'object' &&
    !Array.isArray(existingSettings.features)
      ? (existingSettings.features as Partial<TenantFeatureFlags>)
      : {};

  const nextSettings = {
    ...existingSettings,
    features: { ...existingFeatures, ...features },
  };

  await db.update(tenants).set({ settings: nextSettings }).where(eq(tenants.id, tenantId));
}

/**
 * Applies a plan's `feature_entitlements` jsonb column (src/db/schema.ts's
 * `plans` table) onto a tenant's `settings.features`. Called by
 * subscriptionEventProcessor.ts when a subscription transitions to
 * `active`.
 *
 * `entitlements` arrives as `unknown` straight out of jsonb and is narrowed
 * defensively: a malformed/empty plan row degrades to a no-op rather than
 * throwing and aborting the webhook that is activating billing — losing an
 * entitlement update is recoverable (replay the webhook, or fix the plan row
 * and re-apply), but failing the whole webhook 500s a call Cashfree/Razorpay
 * will retry indefinitely.
 */
export async function applyPlanEntitlementsToTenant(
  tenantId: string,
  entitlements: unknown,
): Promise<void> {
  if (!entitlements || typeof entitlements !== 'object' || Array.isArray(entitlements)) return;
  await setTenantFeatures(tenantId, entitlements as Partial<TenantFeatureFlags>);
}
