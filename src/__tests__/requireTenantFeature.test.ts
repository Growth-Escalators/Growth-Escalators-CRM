import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit tests for the middleware itself, in isolation from any real router or
// index.ts mount — `getTenantFeatures` is mocked directly so these pin the
// middleware's own contract (auth precondition, allow/deny, fail-closed on
// error) without re-deriving PLAN_DEFAULTS math (that's tenantFeatures.test.ts's
// job). See tenantFeatureRouteEnforcement.test.ts for the end-to-end proof
// that mounts this in front of a real request and exercises the real
// getTenantFeatures()/computeTenantFeatures() plan-default table.

const mockGetTenantFeatures = vi.fn();
vi.mock('../services/tenantFeatures', () => ({
  getTenantFeatures: (...args: unknown[]) => mockGetTenantFeatures(...args),
}));

function makeReqRes(user?: { id: string; tenantId: string; role: string }) {
  const req = { user } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { status: statusFn, json: jsonFn } as any;
  const next = vi.fn();
  return { req, res, next, jsonFn, statusFn };
}

describe('requireTenantFeature middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when req.user is missing (must be mounted after requireAuth, but fails closed if it is not)', async () => {
    const { requireTenantFeature } = await import('../middleware/requireTenantFeature');
    const { req, res, next, statusFn, jsonFn } = makeReqRes(undefined);

    await requireTenantFeature('wizmatch')(req, res, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'unauthorised', message: 'Authentication is required' });
    expect(next).not.toHaveBeenCalled();
    expect(mockGetTenantFeatures).not.toHaveBeenCalled();
  });

  it('calls next() when the feature resolves true for the caller tenant', async () => {
    mockGetTenantFeatures.mockResolvedValue({ wizmatch: true, seo: false, crmAutomation: false, gstBilling: false, d2c: false });
    const { requireTenantFeature } = await import('../middleware/requireTenantFeature');
    const { req, res, next, statusFn } = makeReqRes({ id: 'u1', tenantId: 'wizmatch-tenant', role: 'admin' });

    await requireTenantFeature('wizmatch')(req, res, next);

    expect(mockGetTenantFeatures).toHaveBeenCalledWith('wizmatch-tenant');
    expect(next).toHaveBeenCalledTimes(1);
    expect(statusFn).not.toHaveBeenCalled();
  });

  it('403s with a clear body when the feature resolves false for the caller tenant', async () => {
    mockGetTenantFeatures.mockResolvedValue({ wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true });
    const { requireTenantFeature } = await import('../middleware/requireTenantFeature');
    const { req, res, next, statusFn, jsonFn } = makeReqRes({ id: 'u1', tenantId: 'agency-tenant', role: 'admin' });

    await requireTenantFeature('wizmatch')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith({
      error: 'feature_not_enabled',
      message: "This feature ('wizmatch') is not enabled for your account.",
    });
  });

  it('fails closed (403, not 500) when getTenantFeatures() throws — e.g. a stale JWT for a deleted tenant', async () => {
    mockGetTenantFeatures.mockRejectedValue(new Error('[tenant-features] no tenant found for id=ghost-tenant'));
    const { requireTenantFeature } = await import('../middleware/requireTenantFeature');
    const { req, res, next, statusFn, jsonFn } = makeReqRes({ id: 'u1', tenantId: 'ghost-tenant', role: 'admin' });

    await requireTenantFeature('gstBilling')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith({
      error: 'feature_not_enabled',
      message: "This feature ('gstBilling') is not enabled for your account.",
    });
  });

  it('checks the exact feature key it was configured with, not an unrelated one', async () => {
    // gstBilling on, wizmatch off — proves the middleware reads `feature`,
    // not e.g. always the first key.
    mockGetTenantFeatures.mockResolvedValue({ wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true });
    const { requireTenantFeature } = await import('../middleware/requireTenantFeature');
    const { req, res, next, statusFn } = makeReqRes({ id: 'u1', tenantId: 'agency-tenant', role: 'admin' });

    await requireTenantFeature('gstBilling')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(statusFn).not.toHaveBeenCalled();
  });
});
