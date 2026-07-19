import { db } from '../db/index';
import { tenants } from '../db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_TENANT_SLUG } from '../config/constants';

let cachedTenantId: string | null = null;

// SEO crons/services have no req.user — all SEO "clients" today are projects
// under the single Growth Escalators tenant (H18). Memoized because these
// crons run dozens of queries per invocation (e.g. content-decay does 40+)
// and this tenant row never changes mid-process.
export async function resolveDefaultSeoTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEFAULT_TENANT_SLUG)).limit(1);
  if (!tenant) throw new Error(`[seo] no tenant found for DEFAULT_TENANT_SLUG=${DEFAULT_TENANT_SLUG}`);
  cachedTenantId = tenant.id;
  return cachedTenantId;
}

// Test-only escape hatch — lets tests reset the memoized tenant id between cases.
export function __resetSeoTenantCacheForTests(): void {
  cachedTenantId = null;
}
