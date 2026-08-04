import { describe, it, expect, vi, beforeEach } from 'vitest';

// Security audit (2026-08-03): the Growth OS module (growth_os_clients,
// brand_health_scores, money_on_table, creative_intelligence,
// competitor_pulse, copilot_conversations) had NO tenant_id column at all —
// any authenticated user of any tenant could read every other tenant's
// Growth OS data via routes/growthOS.ts. These tests assert every GET/read
// route now filters by the caller's tenant_id.
//
// Convention matches src/__tests__/seoTenantIsolation.test.ts: pool.query is
// mocked as a tiny filtered database keyed off the actual bound tenant_id
// parameter, not a canned per-call response — a route that stopped binding
// tenant_id would fall back to returning BOTH tenants' rows here too,
// failing the "never contains the other tenant's row" assertions below.

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Row = Record<string, unknown>;

const FIXTURES: Record<string, Record<string, Row[]>> = {
  growth_os_clients: {
    [TENANT_A]: [{ id: 'c-a', client_name: 'tenantA-exclusive-client', ad_account_id: 'act_a', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'c-b', client_name: 'tenantB-exclusive-client', ad_account_id: 'act_b', tenant_id: TENANT_B }],
  },
  brand_health_scores: {
    [TENANT_A]: [{ id: 'h-a', client_name: 'Acme', overall_score: 11, tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'h-b', client_name: 'Acme', overall_score: 99, tenant_id: TENANT_B }],
  },
  money_on_table: {
    [TENANT_A]: [{ id: 'o-a', client_name: 'Acme', total_opportunity: 111, tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'o-b', client_name: 'Acme', total_opportunity: 999, tenant_id: TENANT_B }],
  },
  creative_intelligence: {
    [TENANT_A]: [{ id: 'cr-a', ad_id: 'ad-a', ad_name: 'tenantA-exclusive-ad', ad_account_id: 'act_shared', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'cr-b', ad_id: 'ad-b', ad_name: 'tenantB-exclusive-ad', ad_account_id: 'act_shared', tenant_id: TENANT_B }],
  },
  competitor_pulse: {
    [TENANT_A]: [{ id: 'p-a', client_name: 'Acme', competitor_name: 'tenantA-exclusive-competitor', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'p-b', client_name: 'Acme', competitor_name: 'tenantB-exclusive-competitor', tenant_id: TENANT_B }],
  },
  copilot_conversations: {
    [TENANT_A]: [{ id: 'cv-a', client_name: 'Acme', message: 'tenantA-exclusive-message', tenant_id: TENANT_A }],
    [TENANT_B]: [{ id: 'cv-b', client_name: 'Acme', message: 'tenantB-exclusive-message', tenant_id: TENANT_B }],
  },
};

// Same fake-filtered-read helper as seoTenantIsolation.test.ts: finds which
// fixture table the SQL text references, then returns only that tenant's
// rows for whichever tenant_id appears among the bound params. If no known
// tenant_id is bound at all, returns the union of every tenant's rows —
// i.e. exactly what an unscoped (broken) query would leak.
function fakeFilteredRead(sqlText: string, params: unknown[]): { rows: Row[] } {
  const table = Object.keys(FIXTURES).find((t) => sqlText.includes(t));
  if (!table) return { rows: [] };
  const matchedTenant = [TENANT_A, TENANT_B].find((t) => params.includes(t));
  if (!matchedTenant) return { rows: Object.values(FIXTURES[table]).flat() };
  return { rows: FIXTURES[table][matchedTenant] ?? [] };
}

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
  db: {},
  users: {},
}));

vi.mock('../services/growthOSSetup', () => ({
  getActiveGrowthOSClients: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/brandHealthService', () => ({
  calculateBrandHealth: vi.fn(),
  sendHealthScoreWhatsApp: vi.fn(),
}));
vi.mock('../services/opportunityService', () => ({
  calculateMoneyOnTable: vi.fn(),
}));
vi.mock('../services/creativeIntelligenceService', () => ({
  trackCreativePerformance: vi.fn(),
}));
vi.mock('../services/competitorService', () => ({
  runCompetitorPulse: vi.fn(),
}));

function invokeRouteHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

function reqAs(tenantId: string, overrides: Record<string, unknown> = {}) {
  return { user: { tenantId, id: 'user-1', role: 'admin' }, params: {}, query: {}, body: {}, ...overrides };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => fakeFilteredRead(sqlText, params));
});

describe('routes/growthOS.ts — tenant isolation', () => {
  it('GET /clients (growth_os_clients) returns only the caller tenant\'s client', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/clients', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    const names = (res.body.clients as Row[]).map((c) => c.client_name);
    expect(names).toEqual(['tenantA-exclusive-client']);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    expect(params).toEqual([TENANT_A]);
  });

  it('GET /health/all (brand_health_scores) never leaks the other tenant\'s score', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/health/all', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B), res);

    const scores = (res.body.scores as Row[]).map((s) => s.overall_score);
    expect(scores).toEqual([99]);
  });

  it('GET /health/:clientName scopes by tenant_id even for a shared client_name', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/health/:clientName', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A, { params: { clientName: 'Acme' } }), res);

    expect((res.body.scores as Row[]).map((s) => s.overall_score)).toEqual([11]);
    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params).toEqual(['Acme', TENANT_A]);
  });

  it('GET /opportunity/:clientName (money_on_table) never leaks the other tenant\'s opportunity total', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/opportunity/:clientName', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, { params: { clientName: 'Acme' } }), res);

    expect((res.body.reports as Row[]).map((r) => r.total_opportunity)).toEqual([999]);
  });

  it('GET /creatives/:adAccountId scopes by tenant_id even when both tenants share the same ad_account_id', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/creatives/:adAccountId', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A, { params: { adAccountId: 'act_shared' } }), res);

    expect((res.body.creatives as Row[]).map((c) => c.ad_name)).toEqual(['tenantA-exclusive-ad']);
  });

  it('GET /competitor/:clientName (competitor_pulse) never leaks the other tenant\'s competitor', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/competitor/:clientName', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A, { params: { clientName: 'Acme' } }), res);

    expect((res.body.pulse as Row[]).map((p) => p.competitor_name)).toEqual(['tenantA-exclusive-competitor']);
  });

  it('GET /copilot/:clientName (copilot_conversations) never leaks the other tenant\'s conversation', async () => {
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/copilot/:clientName', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, { params: { clientName: 'Acme' } }), res);

    expect((res.body.conversations as Row[]).map((c) => c.message)).toEqual(['tenantB-exclusive-message']);
  });

  it('POST /clients — a client_name collision with another tenant is a 409, not a silent cross-tenant overwrite', async () => {
    // Simulates the ON CONFLICT ... WHERE growth_os_clients.tenant_id = $9
    // guard returning 0 rows: name already taken by a DIFFERENT tenant.
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/clients', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_B, { body: { client_name: 'tenantA-exclusive-client', ad_account_id: 'act_new' } }), res);

    expect(res.statusCode).toBe(409);
  });

  it('POST /clients — a genuinely new client_name for the caller tenant succeeds', async () => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'new-client' }] });
    const router = (await import('../routes/growthOS')).default;
    const handler = invokeRouteHandler(router, '/clients', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_A, { body: { client_name: 'Brand New Co', ad_account_id: 'act_new' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'Client saved' });
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/tenant_id/);
    expect(params).toContain(TENANT_A);
  });
});
