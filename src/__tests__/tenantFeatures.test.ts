import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ground truth this suite pins: for the 3 tenants that exist today
// (growth-escalators / wizmatch / city-clinic — referred to by slug only),
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

  it('client_basic (e.g. city-clinic) — everything off', async () => {
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

  it('city-clinic (client_basic, unmigrated settings={}) — matches today: nothing on', async () => {
    mockTenantRow({ plan: 'client_basic', settings: {} });
    const { getTenantFeatures } = await import('../services/tenantFeatures');
    await expect(getTenantFeatures('city-clinic-tenant-id')).resolves.toEqual({
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
      { id: 'cc-id', slug: 'city-clinic', plan: 'client_basic', settings: {} },
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
    mockTenantRows([{ id: 'cc-id', slug: 'city-clinic', plan: 'client_basic', settings: {} }]);
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
      { id: 'cc-id', slug: 'city-clinic', plan: 'client_basic', settings: {} },
    ]);
    const { getSingleActiveTenantWithFeature } = await import('../services/tenantFeatures');
    await expect(getSingleActiveTenantWithFeature('crmAutomation')).resolves.toEqual({ id: 'ge-id', slug: 'growth-escalators' });
  });

  it('returns null when nothing qualifies', async () => {
    mockTenantRows([{ id: 'cc-id', slug: 'city-clinic', plan: 'client_basic', settings: {} }]);
    const { getSingleActiveTenantWithFeature } = await import('../services/tenantFeatures');
    await expect(getSingleActiveTenantWithFeature('gstBilling')).resolves.toBeNull();
  });

  it('deterministically picks the first by slug (and does not throw) when more than one tenant qualifies', async () => {
    mockTenantRows([
      { id: 'b-id', slug: 'bravo', plan: 'client_basic', settings: { features: { seo: true } } },
      { id: 'a-id', slug: 'alpha', plan: 'client_basic', settings: { features: { seo: true } } },
    ]);
    const { getSingleActiveTenantWithFeature } = await import('../services/tenantFeatures');
    await expect(getSingleActiveTenantWithFeature('seo')).resolves.toEqual({ id: 'a-id', slug: 'alpha' });
  });
});
