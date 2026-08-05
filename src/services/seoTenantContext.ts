import { getActiveTenantsWithFeature, getSingleActiveTenantWithFeature } from './tenantFeatures';
import logger from '../utils/logger';

let cachedTenantId: string | null = null;

// SEO crons/services have no req.user — all SEO "clients" today are projects
// under a single tenant. Memoized because these crons run dozens of queries
// per invocation (e.g. content-decay does 40+) and this tenant row never
// changes mid-process.
//
// Tenant-feature-gated (PR: tenant feature gating) — this used to hardcode
// `eq(tenants.slug, DEFAULT_TENANT_SLUG)`. Today only `growth-escalators` has
// the `seo` feature enabled (see tenantFeatures.ts PLAN_DEFAULTS), so this
// resolves to the exact same tenant as before.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE CALLING IT FROM ANYTHING AUTOMATED.
//
// This THROWS the moment a second active tenant has `seo: true`, because
// getSingleActiveTenantWithFeature refuses to guess which tenant owns the data
// (it exists because a reseller tenant once silently stole GE's own inbound
// leads — see its docstring). That throw is correct and must stay.
//
// The consequence is that this function is safe ONLY for call sites that
// genuinely resolve one tenant: a request handler falling back when there is no
// req.user, or a service invoked with no tenant in hand. It is NOT safe in a
// cron. A cron that calls it stops working for EVERY tenant — including GE's
// own — the day the SEO add-on is sold to a second agency.
//
// Crons must use forEachSeoTenant() below and pass the tenant id down
// explicitly. Every SEO service entry point therefore takes an optional
// `tenantId` and only falls back to this resolver when it isn't supplied.
// ─────────────────────────────────────────────────────────────────────────────
export async function resolveDefaultSeoTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const tenant = await getSingleActiveTenantWithFeature('seo');
  if (!tenant) throw new Error('[seo] no active tenant has the "seo" feature enabled');
  cachedTenantId = tenant.id;
  return cachedTenantId;
}

/**
 * Every active tenant with the `seo` feature on. The list crons iterate.
 *
 * Deliberately NOT memoized (unlike resolveDefaultSeoTenantId): enabling the
 * add-on for a new tenant must take effect on the next cron tick, not on the
 * next deploy. The query is one indexed read against a table with a handful of
 * rows, run a few times a day.
 */
export async function getSeoTenantIds(): Promise<string[]> {
  const tenants = await getActiveTenantsWithFeature('seo');
  return tenants.map((t) => t.id);
}

/**
 * Runs `fn` once per SEO-enabled tenant, isolating failures.
 *
 * The isolation is the point. Without it, one tenant's expired Google token
 * throws out of the cron body and every tenant after it in the list is silently
 * skipped for that run — and because safeCron catches at the top, it looks like
 * a single failure rather than an outage for everyone downstream of it.
 *
 * Returns per-tenant outcomes so the caller can log a real summary. Rethrows
 * nothing: a cron that partially succeeded should be recorded as partial, not
 * as a total failure. Callers that record run status (logSeoWorkflowRun) should
 * treat `failed > 0` as an error status while still keeping the successes.
 */
export async function forEachSeoTenant<T>(
  label: string,
  fn: (tenantId: string) => Promise<T>,
): Promise<{
  results: Array<{ tenantId: string; ok: true; value: T } | { tenantId: string; ok: false; error: Error }>;
  succeeded: number;
  failed: number;
}> {
  const tenantIds = await getSeoTenantIds();
  if (tenantIds.length === 0) {
    logger.warn(`[seo] ${label}: no active tenant has the "seo" feature enabled — nothing to do`);
    return { results: [], succeeded: 0, failed: 0 };
  }

  const results: Array<
    { tenantId: string; ok: true; value: T } | { tenantId: string; ok: false; error: Error }
  > = [];
  let succeeded = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      const value = await fn(tenantId);
      results.push({ tenantId, ok: true, value });
      succeeded++;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      failed++;
      results.push({ tenantId, ok: false, error });
      logger.error(
        `[seo] ${label} failed for tenant ${tenantId} — continuing with the remaining tenants`,
        error.message,
      );
    }
  }

  return { results, succeeded, failed };
}

// Test-only escape hatch — lets tests reset the memoized tenant id between cases.
export function __resetSeoTenantCacheForTests(): void {
  cachedTenantId = null;
}
