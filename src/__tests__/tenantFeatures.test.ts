import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ground truth this suite pins: for the 3 tenants that exist today
// (growth-escalators / wizmatch / sample-agency-basic — referred to by slug only),
// getTenantFeatures() must resolve to EXACTLY what's true today via the
// global env-var flags, with settings.features left at its default `{}` (no
// production backfill has run). See tenantFeatures.ts's PLAN_DEFAULTS
// comments for the evidence trail per flag.

describe('computeTenantFeatures (pure, per-plan defaults)', () => {
  it('agency_internal (growth-escalators) — seo, crmAutomation, gstBilling, d2c on; wizmatch off', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('agency_internal', {})).toEqual({
      wizmatch: false,
      seo: true,
      crmAutomation: true,
      gstBilling: true,
      d2c: true,
    });
  });

  it('wizmatch_internal (wizmatch) — only wizmatch on', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('wizmatch_internal', {})).toEqual({
      wizmatch: true,
      seo: false,
      crmAutomation: false,
      gstBilling: false,
      d2c: false,
    });
  });

  it('client_basic (e.g. sample-agency-basic) — everything off', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('client_basic', {})).toEqual({
      wizmatch: false,
      seo: false,
      crmAutomation: false,
      gstBilling: false,
      d2c: false,
    });
  });

  it('unknown/null plan — fails closed to everything off', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('some_future_plan', {})).toEqual({
      wizmatch: false, seo: false, crmAutomation: false, gstBilling: false, d2c: false,
    });
    expect(computeTenantFeatures(null, undefined)).toEqual({
      wizmatch: false, seo: false, crmAutomation: false, gstBilling: false, d2c: false,
    });
  });

  it('an empty settings.features object is treated as "not configured" — falls back to plan default, does not zero everything out', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('agency_internal', { features: {} })).toEqual({
      wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true,
    });
  });

  it('a non-empty settings.features PARTIALLY overrides the plan default (merge, not replace)', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('agency_internal', { features: { d2c: false } })).toEqual({
      wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: false,
    });
  });

  it('settings.features can also turn a plan-default-off feature on for a specific tenant', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('client_basic', { features: { wizmatch: true } })).toEqual({
      wizmatch: true, seo: false, crmAutomation: false, gstBilling: false, d2c: false,
    });
  });

  it('tolerates malformed settings (array, string, null) without throwing', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(() => computeTenantFeatures('agency_internal', null)).not.toThrow();
    expect(() => computeTenantFeatures('agency_internal', 'not-an-object')).not.toThrow();
    expect(() => computeTenantFeatures('agency_internal', [])).not.toThrow();
  });
});

describe('getTenantFeatures — zero-behavior-change proof for the 3 existing tenants', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockTenantRow(row: { plan: string; settings: unknown } | undefined) {
    const limit = vi.fn().mockResolvedValue(row ? [row] : []);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
  }

  it('growth-escalators (agency_internal, unmigrated settings={}) — matches today: seo/crmAutomation/gstBilling/d2c on, wizmatch off', async () => {
    mockTenantRow({ plan: 'agency_internal', settings: {} });
    const { getTenantFeatures } = await import('../services/tenantFeatures');
    await expect(getTenantFeatures('ge-tenant-id')).resolves.toEqual({
      wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true,
    });
  });

  it('wizmatch (wizmatch_internal, unmigrated settings={}) — matches today: only wizmatch on', async () => {
    mockTenantRow({ plan: 'wizmatch_internal', settings: {} });
    const { getTenantFeatures } = await import('../services/tenantFeatures');
    await expect(getTenantFeatures('wizmatch-tenant-id')).resolves.toEqual({
      wizmatch: true, seo: false, crmAutomation: false, gstBilling: false, d2c: false,
    });
  });

  it('sample-agency-basic (client_basic, unmigrated settings={}) — matches today: nothing on', async () => {
    mockTenantRow({ plan: 'client_basic', settings: {} });
    const { getTenantFeatures } = await import('../services/tenantFeatures');
    await expect(getTenantFeatures('sample-agency-basic-tenant-id')).resolves.toEqual({
      wizmatch: false, seo: false, crmAutomation: false, gstBilling: false, d2c: false,
    });
  });

  it('throws a clear error when the tenant id does not exist', async () => {
    mockTenantRow(undefined);
    const { getTenantFeatures } = await import('../services/tenantFeatures');
    await expect(getTenantFeatures('missing-tenant')).rejects.toThrow(/no tenant found for id=missing-tenant/);
  });
});

describe('getActiveTenantsWithFeature', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockTenantRows(rows: Array<{ id: string; slug: string; plan: string; settings: unknown }>) {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
    return { where };
  }

  it("today's reality: exactly the wizmatch tenant qualifies for 'wizmatch', exactly growth-escalators qualifies for 'seo'", async () => {
    const rows = [
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: {} },
      { id: 'wm-id', slug: 'wizmatch', plan: 'wizmatch_internal', settings: {} },
      { id: 'sab-id', slug: 'sample-agency-basic', plan: 'client_basic', settings: {} },
    ];
    mockTenantRows(rows);
    const { getActiveTenantsWithFeature } = await import('../services/tenantFeatures');
    await expect(getActiveTenantsWithFeature('wizmatch')).resolves.toEqual([{ id: 'wm-id', slug: 'wizmatch' }]);
  });

  it("only queries isActive tenants", async () => {
    const { where } = mockTenantRows([]);
    const { getActiveTenantsWithFeature } = await import('../services/tenantFeatures');
    await getActiveTenantsWithFeature('seo');
    expect(where).toHaveBeenCalledTimes(1);
    const condition = where.mock.calls[0][0] as { queryChunks?: Array<{ value?: unknown }> };
    const boundValues = (condition.queryChunks ?? [])
      .filter((c) => c && typeof c === 'object' && 'value' in c && !Array.isArray(c.value))
      .map((c) => c.value);
    expect(boundValues).toContain(true);
  });

  it('would correctly pick up a SECOND tenant if one were added with the feature enabled (proves the loop, not a hardcoded single tenant)', async () => {
    const rows = [
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: {} },
      { id: 'wm-id', slug: 'wizmatch', plan: 'wizmatch_internal', settings: {} },
      // A brand-new second tenant onboarded with Wizmatch enabled via an
      // explicit settings.features override (plan stays client_basic).
      { id: 'new-tenant-id', slug: 'second-agency', plan: 'client_basic', settings: { features: { wizmatch: true } } },
    ];
    mockTenantRows(rows);
    const { getActiveTenantsWithFeature } = await import('../services/tenantFeatures');
    const result = await getActiveTenantsWithFeature('wizmatch');
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.slug).sort()).toEqual(['second-agency', 'wizmatch']);
  });

  it('returns an empty list when no active tenant has the feature', async () => {
    mockTenantRows([{ id: 'sab-id', slug: 'sample-agency-basic', plan: 'client_basic', settings: {} }]);
    const { getActiveTenantsWithFeature } = await import('../services/tenantFeatures');
    await expect(getActiveTenantsWithFeature('d2c')).resolves.toEqual([]);
  });
});

describe('getSingleActiveTenantWithFeature', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockTenantRows(rows: Array<{ id: string; slug: string; plan: string; settings: unknown }>) {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
  }

  it('resolves the single qualifying tenant — matches DEFAULT_TENANT_SLUG behavior today for crmAutomation', async () => {
    mockTenantRows([
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: {} },
      { id: 'wm-id', slug: 'wizmatch', plan: 'wizmatch_internal', settings: {} },
      { id: 'sab-id', slug: 'sample-agency-basic', plan: 'client_basic', settings: {} },
    ]);
    const { getSingleActiveTenantWithFeature } = await import('../services/tenantFeatures');
    await expect(getSingleActiveTenantWithFeature('crmAutomation')).resolves.toEqual({ id: 'ge-id', slug: 'growth-escalators' });
  });

  it('returns null when nothing qualifies', async () => {
    mockTenantRows([{ id: 'sab-id', slug: 'sample-agency-basic', plan: 'client_basic', settings: {} }]);
    const { getSingleActiveTenantWithFeature } = await import('../services/tenantFeatures');
    await expect(getSingleActiveTenantWithFeature('gstBilling')).resolves.toBeNull();
  });

  // BUG HISTORY (fixed 2026-08-04): this helper used to deterministically
  // pick the first qualifying tenant by slug and silently return it — which
  // is exactly the "lead theft by slug order" bug (a reseller_pilot tenant
  // sorting before growth-escalators silently absorbed GE's own crmAutomation
  // call sites). It now throws instead of guessing, so an ambiguous match
  // fails loudly rather than routing data to an arbitrary tenant.
  it('throws loudly instead of picking an arbitrary tenant when more than one qualifies', async () => {
    mockTenantRows([
      { id: 'b-id', slug: 'bravo', plan: 'client_basic', settings: { features: { seo: true } } },
      { id: 'a-id', slug: 'alpha', plan: 'client_basic', settings: { features: { seo: true } } },
    ]);
    const { getSingleActiveTenantWithFeature } = await import('../services/tenantFeatures');
    await expect(getSingleActiveTenantWithFeature('seo')).rejects.toThrow(/ambiguous tenant resolution/);
  });
});

describe('getDefaultIngestTenant — pinned resolution for GE-own-infra ingestion (Bug 1 fix)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * Simulates the real WHERE clause: getDefaultIngestTenant() queries
   * `.where(eq(tenants.slug, DEFAULT_TENANT_SLUG)).limit(...)`, so this mock
   * inspects the BOUND VALUE of the condition drizzle builds (same technique
   * the "only queries isActive tenants" test above uses for a boolean bound
   * value) and filters the fixture by slug — exactly what Postgres would do.
   * This makes the regression test below meaningful: it fails if the
   * implementation reverts to scanning + sorting every active tenant in JS
   * (the Bug 1 pattern) instead of filtering by slug in the query itself.
   */
  function mockTenantsBySlugQuery(
    rows: Array<{ id: string; slug: string; plan: string; settings: unknown; isActive: boolean }>,
  ) {
    const where = vi.fn((condition: { queryChunks?: Array<{ value?: unknown }> }) => {
      const boundValues = (condition.queryChunks ?? [])
        .filter((c) => c && typeof c === 'object' && 'value' in c && !Array.isArray(c.value))
        .map((c) => c.value);
      const matched = rows.filter((r) => boundValues.includes(r.slug));
      return { limit: vi.fn().mockResolvedValue(matched) };
    });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.doMock('../db/index', () => ({ db: { select } }));
    return { where };
  }

  it('THE REGRESSION TEST: picks growth-escalators even when a reseller tenant sorts BEFORE it alphabetically', async () => {
    // "acme-agency" sorts before "growth-escalators" — this is exactly the
    // slug ordering that made the old getSingleActiveTenantWithFeature('crmAutomation')
    // silently route GE's own inbound website leads to the reseller instead
    // of GE. reseller_pilot also has crmAutomation: true (PLAN_DEFAULTS), so
    // a feature-scan alone cannot tell them apart — only pinning by slug can.
    mockTenantsBySlugQuery([
      { id: 'reseller-id', slug: 'acme-agency', plan: 'reseller_pilot', settings: {}, isActive: true },
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: {}, isActive: true },
    ]);
    const { getDefaultIngestTenant } = await import('../services/tenantFeatures');
    await expect(getDefaultIngestTenant('crmAutomation')).resolves.toEqual({ id: 'ge-id', slug: 'growth-escalators' });
  });

  it('returns null (fails closed) when the GE tenant is inactive, rather than falling through to another tenant', async () => {
    mockTenantsBySlugQuery([
      { id: 'reseller-id', slug: 'acme-agency', plan: 'reseller_pilot', settings: {}, isActive: true },
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: {}, isActive: false },
    ]);
    const { getDefaultIngestTenant } = await import('../services/tenantFeatures');
    await expect(getDefaultIngestTenant('crmAutomation')).resolves.toBeNull();
  });

  it('returns null (fails closed) when the requested feature is off for GE, rather than falling through to another tenant', async () => {
    mockTenantsBySlugQuery([
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: { features: { crmAutomation: false } }, isActive: true },
    ]);
    const { getDefaultIngestTenant } = await import('../services/tenantFeatures');
    await expect(getDefaultIngestTenant('crmAutomation')).resolves.toBeNull();
  });

  it('returns null when no tenant with DEFAULT_TENANT_SLUG exists at all', async () => {
    mockTenantsBySlugQuery([
      { id: 'reseller-id', slug: 'acme-agency', plan: 'reseller_pilot', settings: {}, isActive: true },
    ]);
    const { getDefaultIngestTenant } = await import('../services/tenantFeatures');
    await expect(getDefaultIngestTenant('crmAutomation')).resolves.toBeNull();
  });

  it('defaults the feature argument to crmAutomation', async () => {
    mockTenantsBySlugQuery([
      { id: 'ge-id', slug: 'growth-escalators', plan: 'agency_internal', settings: {}, isActive: true },
    ]);
    const { getDefaultIngestTenant } = await import('../services/tenantFeatures');
    await expect(getDefaultIngestTenant()).resolves.toEqual({ id: 'ge-id', slug: 'growth-escalators' });
  });
});
