import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/routes/ads.ts's getAdAccounts() helper queried marketing_accounts with
// no tenant_id filter at all (unlike src/routes/marketing.ts, which already
// scopes the same table), and none of this 811-line file's 18 routes called
// requirePermission — any authenticated role, including creative_assistant,
// could pause a live ad campaign. These tests cover both fixes at the route
// level (the router-wide GE-tenant-only gate is covered separately by
// metaAdsGeOnlyGate.test.ts).

const TENANT_A = 'tenant-ge-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock('../utils/fetchWithRetry', () => ({
  fetchWithRetry: vi.fn(),
}));

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

// Finds the LAST handler registered on a route (skipping any
// requirePermission/etc. middleware in front of it) — matches the
// convention used by intelligenceReportsTenantIsolation.test.ts.
function finalHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

// Runs the FULL middleware chain (requirePermission, then the handler) so
// the permission gate itself is genuinely exercised.
async function invokeFullChain(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [] });
});

describe('routes/ads.ts — getAdAccounts() is tenant-scoped', () => {
  const ORIGINAL_TOKEN = process.env.META_ADS_TOKEN;
  beforeEach(() => { process.env.META_ADS_TOKEN = 'test-token'; });
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.META_ADS_TOKEN;
    else process.env.META_ADS_TOKEN = ORIGINAL_TOKEN;
  });

  it('GET /accounts filters marketing_accounts by the caller tenant_id', async () => {
    let sawMarketingAccountsQuery = false;
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (String(sqlText).includes('FROM marketing_accounts')) {
        sawMarketingAccountsQuery = true;
        expect(String(sqlText)).toMatch(/tenant_id = \$1/);
        expect(params).toEqual([TENANT_A]);
        return { rows: [{ id: 'act_1', name: 'Tenant A Account' }] };
      }
      return { rows: [] };
    });
    const { fetchWithRetry } = await import('../utils/fetchWithRetry');
    (fetchWithRetry as any).mockResolvedValue({ json: async () => ({ name: 'Tenant A Account', currency: 'INR', account_status: 1 }) });

    const router = (await import('../routes/ads')).default;
    const handler = finalHandler(router, '/accounts', 'get');
    const req: any = { user: { tenantId: TENANT_A, id: 'u1', role: 'admin' }, query: {} };
    const res = mockRes();

    await handler(req, res);

    expect(sawMarketingAccountsQuery).toBe(true);
    expect(res.body.accounts).toEqual([
      expect.objectContaining({ id: 'act_1', name: 'Tenant A Account' }),
    ]);
  });

  it('a reseller tenant with no ad accounts of its own never sees another tenant\'s rows (bound param is its own tenant_id)', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
      if (String(sqlText).includes('FROM marketing_accounts')) {
        expect(params).toEqual(['tenant-b-reseller']);
        return { rows: [] }; // tenant B has no accounts of its own — falls back to FALLBACK_AD_ACCOUNTS (GE's), not tenant A's
      }
      return { rows: [] };
    });
    const { fetchWithRetry } = await import('../utils/fetchWithRetry');
    (fetchWithRetry as any).mockResolvedValue({ json: async () => ({ name: 'x', currency: 'INR', account_status: 1 }) });

    const router = (await import('../routes/ads')).default;
    const handler = finalHandler(router, '/accounts', 'get');
    const req: any = { user: { tenantId: 'tenant-b-reseller', id: 'u1', role: 'admin' }, query: {} };
    const res = mockRes();

    await handler(req, res);

    const ids = (res.body.accounts as Array<{ id: string }>).map(a => a.id);
    expect(ids).not.toContain('act_1'); // tenant A's account id from the previous test must never appear here
  });
});

describe('routes/ads.ts — permission gating (previously zero requirePermission calls in this file)', () => {
  it('GET /accounts (ADS_VIEW) rejects a role with neither ADS_VIEW nor ADS_MANAGE', async () => {
    const router = (await import('../routes/ads')).default;
    const req: any = { user: { tenantId: TENANT_A, id: 'u1', role: 'sales' }, query: {} };
    const res = mockRes();

    await invokeFullChain(router, '/accounts', 'get', req, res);

    expect(res.statusCode).toBe(403);
  });

  it('GET /accounts (ADS_VIEW) allows creative_assistant (narrowest role with ads access)', async () => {
    const router = (await import('../routes/ads')).default;
    const req: any = { user: { tenantId: TENANT_A, id: 'u1', role: 'creative_assistant' }, query: {} };
    const res = mockRes();

    await invokeFullChain(router, '/accounts', 'get', req, res);

    expect(res.statusCode).not.toBe(403);
  });

  it('POST /campaigns/:id/status (ADS_MANAGE) rejects a view-only role', async () => {
    const router = (await import('../routes/ads')).default;
    // 'viewer' has ADS_VIEW but not ADS_MANAGE in PERMISSION_MAP.
    const req: any = { user: { tenantId: TENANT_A, id: 'u1', role: 'viewer' }, params: { id: '123' }, body: { status: 'PAUSED' } };
    const res = mockRes();

    await invokeFullChain(router, '/campaigns/:id/status', 'post', req, res);

    expect(res.statusCode).toBe(403);
  });

  it('POST /campaigns/:id/status (ADS_MANAGE) allows admin', async () => {
    process.env.META_ADS_TOKEN = 'test-token';
    const { fetchWithRetry } = await import('../utils/fetchWithRetry');
    (fetchWithRetry as any).mockResolvedValue({ json: async () => ({ id: '123' }) });

    const router = (await import('../routes/ads')).default;
    const req: any = { user: { tenantId: TENANT_A, id: 'u1', role: 'admin' }, params: { id: '123' }, body: { status: 'PAUSED' } };
    const res = mockRes();

    await invokeFullChain(router, '/campaigns/:id/status', 'post', req, res);

    expect(res.statusCode).not.toBe(403);
    // The consistency fix: this route now goes through fetchWithRetry like
    // every other Meta API call in the file, not a bare fetch().
    expect(fetchWithRetry).toHaveBeenCalled();
    delete process.env.META_ADS_TOKEN;
  });

  it('PATCH /settings (ADS_MANAGE) rejects a view-only role', async () => {
    const router = (await import('../routes/ads')).default;
    const req: any = { user: { tenantId: TENANT_A, id: 'u1', role: 'viewer' }, body: {} };
    const res = mockRes();

    await invokeFullChain(router, '/settings', 'patch', req, res);

    expect(res.statusCode).toBe(403);
  });
});
