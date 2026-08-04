import { describe, it, expect, vi, beforeEach } from 'vitest';

// H18 — resolveDefaultSeoTenantId() is the single source of truth every SEO
// cron/service (with no req.user) uses to scope its queries. Kept in its own
// file (rather than seoTenantIsolation.test.ts) because exercising the REAL
// implementation needs vi.resetModules()/vi.doMock(), which would corrupt the
// persistent top-level db/index mock the rest of the tenant-isolation sweep
// relies on if run in the same file.

describe('seoTenantContext.resolveDefaultSeoTenantId', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // Tenant-feature-gating PR — this now resolves via
  // getSingleActiveTenantWithFeature('seo') instead of a hardcoded
  // eq(tenants.slug, DEFAULT_TENANT_SLUG) query. getSingleActiveTenantWithFeature
  // itself has its own dedicated coverage (tenantFeatures.test.ts); this suite
  // only needs to prove resolveDefaultSeoTenantId calls it correctly and still
  // memoizes.

  it('resolves the tenant id for the "seo" feature and memoizes it (only queries once)', async () => {
    const getSingleActiveTenantWithFeature = vi.fn().mockResolvedValue({ id: 'resolved-tenant-id', slug: 'growth-escalators' });
    vi.doMock('../services/tenantFeatures', () => ({ getSingleActiveTenantWithFeature }));

    const { resolveDefaultSeoTenantId } = await import('../services/seoTenantContext');
    const first = await resolveDefaultSeoTenantId();
    const second = await resolveDefaultSeoTenantId();

    expect(first).toBe('resolved-tenant-id');
    expect(second).toBe('resolved-tenant-id');
    expect(getSingleActiveTenantWithFeature).toHaveBeenCalledTimes(1); // memoized — second call hit the cache, not the DB
    expect(getSingleActiveTenantWithFeature).toHaveBeenCalledWith('seo');
  });

  it('throws a clear error when no active tenant has the "seo" feature enabled', async () => {
    const getSingleActiveTenantWithFeature = vi.fn().mockResolvedValue(null);
    vi.doMock('../services/tenantFeatures', () => ({ getSingleActiveTenantWithFeature }));

    const { resolveDefaultSeoTenantId } = await import('../services/seoTenantContext');
    await expect(resolveDefaultSeoTenantId()).rejects.toThrow(/no active tenant has the "seo" feature/);
  });
});
