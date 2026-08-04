import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/routes/metaAssets.ts and src/routes/ads.ts both run on GE's shared
// Meta credentials with no per-tenant model or tenant check. Both routers
// are now gated to GE's own tenant via a `router.use(...)` middleware.
// These tests exercise that middleware directly (the first non-route layer
// registered on each router) rather than mocking the Graph API, since the
// gate itself is the thing being verified.

const GE_TENANT_ID = 'tenant-ge-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RESELLER_TENANT_ID = 'tenant-reseller-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
}));

function firstMiddleware(router: any) {
  const layer = router.stack.find((l: any) => !l.route);
  if (!layer) throw new Error('no router.use(...) middleware found');
  return layer.handle as (req: any, res: any, next: () => void) => Promise<void>;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

beforeEach(() => {
  // Each router caches its resolved GE tenant id in a module-level variable
  // (resolveGeTenantId's `_geTenantIdPromise`) — reset the module registry
  // so every test gets a fresh, uncached lookup and genuinely exercises the
  // mock set up for that specific test (in particular the "fails closed"
  // case below, which needs a real re-resolution attempt, not a cached hit
  // from an earlier passing test).
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockPoolQuery.mockImplementation(async (sqlText: string) => {
    if (sqlText.includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
    return { rows: [] };
  });
});

describe.each([
  ['routes/metaAssets.ts', () => import('../routes/metaAssets').then((m) => m.metaAssetsRouter)],
  ['routes/ads.ts', () => import('../routes/ads').then((m) => m.default)],
])('%s — GE-tenant-only gate', (_name, loadRouter) => {
  it('blocks a reseller tenant with 403 and never calls next()', async () => {
    const router = await loadRouter();
    const middleware = firstMiddleware(router);
    const req: any = { user: { tenantId: RESELLER_TENANT_ID, id: 'u1', role: 'admin' } };
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets GE\'s own tenant through unchanged (calls next(), never touches res)', async () => {
    const router = await loadRouter();
    const middleware = firstMiddleware(router);
    const req: any = { user: { tenantId: GE_TENANT_ID, id: 'u1', role: 'admin' } };
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails closed (403) when the GE tenant id cannot be resolved at all', async () => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    const router = await loadRouter();
    const middleware = firstMiddleware(router);
    const req: any = { user: { tenantId: GE_TENANT_ID, id: 'u1', role: 'admin' } };
    const res = mockRes();
    const next = vi.fn();
    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
