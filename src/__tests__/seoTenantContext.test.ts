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

  it('resolves the tenant id for DEFAULT_TENANT_SLUG and memoizes it (only queries once)', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 'resolved-tenant-id' }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
    vi.doMock('../config/constants', () => ({ DEFAULT_TENANT_SLUG: 'growth-escalators' }));

    const { resolveDefaultSeoTenantId } = await import('../services/seoTenantContext');
    const first = await resolveDefaultSeoTenantId();
    const second = await resolveDefaultSeoTenantId();

    expect(first).toBe('resolved-tenant-id');
    expect(second).toBe('resolved-tenant-id');
    expect(select).toHaveBeenCalledTimes(1); // memoized — second call hit the cache, not the DB
  });

  it('throws a clear error when no tenant matches DEFAULT_TENANT_SLUG', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
    vi.doMock('../config/constants', () => ({ DEFAULT_TENANT_SLUG: 'growth-escalators' }));

    const { resolveDefaultSeoTenantId } = await import('../services/seoTenantContext');
    await expect(resolveDefaultSeoTenantId()).rejects.toThrow(/DEFAULT_TENANT_SLUG/);
  });

  it('queries by the configured DEFAULT_TENANT_SLUG value, not a hardcoded one', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 'x' }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
    vi.doMock('../config/constants', () => ({ DEFAULT_TENANT_SLUG: 'some-other-slug' }));

    const { resolveDefaultSeoTenantId } = await import('../services/seoTenantContext');
    await resolveDefaultSeoTenantId();

    // eq(tenants.slug, DEFAULT_TENANT_SLUG) — drizzle's eq() builds an SQL
    // condition whose queryChunks alternate StringChunk (text, `.value` is a
    // string[]), the PgText column reference, and a Param wrapping the bound
    // scalar (`.value` is the raw value itself) — extract just that Param.
    expect(where).toHaveBeenCalledTimes(1);
    const condition = where.mock.calls[0][0] as { queryChunks?: Array<{ value?: unknown }> };
    const boundValues = (condition.queryChunks ?? [])
      .filter((c) => c && typeof c === 'object' && 'value' in c && !Array.isArray(c.value))
      .map((c) => c.value);
    expect(boundValues).toContain('some-other-slug');
  });
});
