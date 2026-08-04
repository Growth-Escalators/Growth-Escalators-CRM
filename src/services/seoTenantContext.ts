import { getSingleActiveTenantWithFeature } from './tenantFeatures';

let cachedTenantId: string | null = null;

// SEO crons/services have no req.user — all SEO "clients" today are projects
// under a single tenant. Memoized because these crons run dozens of queries
// per invocation (e.g. content-decay does 40+) and this tenant row never
// changes mid-process.
//
// Tenant-feature-gated (PR: tenant feature gating) — this used to hardcode
// `eq(tenants.slug, DEFAULT_TENANT_SLUG)`. Today only `growth-escalators` has
// the `seo` feature enabled (see tenantFeatures.ts PLAN_DEFAULTS), so this
// resolves to the exact same tenant as before. Still a single-tenant
// resolution (not a loop) because every downstream SEO service/cron assumes
// exactly one tenant id — see the PR description for why the 22 downstream
// consumers were intentionally left as-is.
export async function resolveDefaultSeoTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const tenant = await getSingleActiveTenantWithFeature('seo');
  if (!tenant) throw new Error('[seo] no active tenant has the "seo" feature enabled');
  cachedTenantId = tenant.id;
  return cachedTenantId;
}

// Test-only escape hatch — lets tests reset the memoized tenant id between cases.
export function __resetSeoTenantCacheForTests(): void {
  cachedTenantId = null;
}
