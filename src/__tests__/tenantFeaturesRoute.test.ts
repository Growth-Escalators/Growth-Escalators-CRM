import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/tenant-features/me — mocks getTenantFeatures directly (same
// technique as requireTenantFeature.test.ts) so this pins the route's own
// contract (tenant-scoping, response shape, fail-mode) without re-deriving
// PLAN_DEFAULTS math, which tenantFeatures.test.ts already owns.
const mockGetTenantFeatures = vi.fn();
vi.mock('../services/tenantFeatures', () => ({
  getTenantFeatures: (...args: unknown[]) => mockGetTenantFeatures(...args),
}));

import tenantFeaturesRouter from '../routes/tenantFeatures';

function makeReqRes(user: Record<string, unknown>) {
  const req = { user } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

async function invoke(path: string, req: any, res: any) {
  const layer = (tenantFeaturesRouter as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.get);
  if (!layer) throw new Error(`route not found: GET ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

describe('GET /api/tenant-features/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the caller's own tenant via req.user.tenantId, never a client-supplied value", async () => {
    mockGetTenantFeatures.mockResolvedValue({
      wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true,
    });
    const { req, res, jsonFn } = makeReqRes({ id: 'u1', tenantId: 'tenant-a', role: 'admin' });

    await invoke('/me', req, res);

    expect(mockGetTenantFeatures).toHaveBeenCalledWith('tenant-a');
    expect(jsonFn).toHaveBeenCalledWith({
      features: { wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true },
    });
  });

  it('reports a tenant with gstBilling off exactly as such — the shape navEntries.js reads', async () => {
    mockGetTenantFeatures.mockResolvedValue({
      wizmatch: false, seo: false, crmAutomation: true, gstBilling: false, d2c: false,
    });
    const { req, res, jsonFn } = makeReqRes({ id: 'u2', tenantId: 'reseller-tenant', role: 'admin' });

    await invoke('/me', req, res);

    expect(jsonFn).toHaveBeenCalledWith({
      features: expect.objectContaining({ gstBilling: false }),
    });
  });

  it('500s rather than throwing when getTenantFeatures rejects (e.g. tenant row gone)', async () => {
    mockGetTenantFeatures.mockRejectedValue(new Error('no tenant found for id=ghost'));
    const { req, res, statusFn, jsonFn } = makeReqRes({ id: 'u3', tenantId: 'ghost', role: 'admin' });

    await invoke('/me', req, res);

    expect(statusFn).toHaveBeenCalledWith(500);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'no tenant found for id=ghost' });
  });
});
