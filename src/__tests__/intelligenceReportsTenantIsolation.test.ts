import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ai_intelligence_reports had no tenant_id column at all — every
// /api/intelligence/* read route (today, reports, scores, actions,
// status/:id) was unscoped, so every tenant's admin dashboard rendered
// GE's own AI coaching reports verbatim. These tests assert every read
// route now filters by the caller's tenant_id.
//
// The read fix alone was incomplete: the underlying data collection this
// module uses is not tenant-parameterized (it always operates on GE's own
// business data), so a tenant-scoped write is not the same as a
// tenant-scoped *source*. POST /generate and POST /run-cron/:name (which
// both trigger that unparameterized collection/cron layer) are therefore
// restricted to GE's own tenant — a reseller simply cannot trigger
// generation, rather than being able to generate a report whose content
// isn't theirs but whose row now legitimately reads back as theirs.

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // GE — resolveGeTenantId() below resolves to this id
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // reseller

type Row = Record<string, unknown>;

const REPORTS: Record<string, Row[]> = {
  [TENANT_A]: [{ id: 'r-a', report_date: '2026-08-04', overall_score: 11, status: 'complete', focus_today: 'tenantA-exclusive-focus' }],
  [TENANT_B]: [{ id: 'r-b', report_date: '2026-08-04', overall_score: 99, status: 'complete', focus_today: 'tenantB-exclusive-focus' }],
};

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
}));

vi.mock('../middleware/rbac', () => ({
  isAdminTier: (role: string | undefined) => ['admin', 'team_lead', 'viewer'].includes(role ?? ''),
}));

// analyzeWithClaude/deliverDailyIntelligence resolve to well-formed values
// (not bare `undefined`) — POST /generate's background continuation
// (setImmediate) runs AFTER the handler awaited below returns, so it can
// still execute mid-test-suite; a bare-undefined mock would throw on
// `analysis.scores?.overall` and leak an unhandled rejection into whichever
// test happens to be running when the macrotask fires.
vi.mock('../services/intelligenceDataCollector', () => ({
  collectDailyData: vi.fn().mockResolvedValue({}),
}));
vi.mock('../services/intelligenceAnalyzer', () => ({
  analyzeWithClaude: vi.fn().mockResolvedValue({ scores: { overall: 50, ads: 50, seo: 50, sales: 50, ops: 50 }, tokensUsed: 0 }),
  ensureIntelligenceTable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/intelligenceDelivery', () => ({
  deliverDailyIntelligence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/directoryScraperService', () => ({
  runAllScrapers: vi.fn().mockResolvedValue({ total: 0, imported: 0 }),
}));
vi.mock('../services/metaAdsService', () => ({
  calculateMonthlyBenchmarks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/systemHealthMonitor', () => ({
  checkAllSystems: vi.fn().mockResolvedValue({}),
  logCronStart: vi.fn().mockResolvedValue(null),
  logCronSuccess: vi.fn().mockResolvedValue(undefined),
  logCronFailure: vi.fn().mockResolvedValue(undefined),
}));

function fakeFilteredRead(sqlText: string, params: unknown[]): { rows: Row[] } {
  // resolveGeTenantId()'s lookup — matched by SQL text, not call order, so
  // it behaves the same whether or not an earlier test already warmed the
  // module-level cache in routes/intelligence.ts.
  if (sqlText.includes('FROM tenants WHERE slug')) return { rows: [{ id: TENANT_A }] };
  if (sqlText.includes('INSERT INTO ai_intelligence_reports')) return { rows: [{ id: 'new-report-id' }] };
  if (!sqlText.includes('ai_intelligence_reports')) return { rows: [] };
  const matchedTenant = [TENANT_A, TENANT_B].find((t) => params.includes(t));
  if (!matchedTenant) return { rows: [...REPORTS[TENANT_A], ...REPORTS[TENANT_B]] }; // simulates the pre-fix leak
  return { rows: REPORTS[matchedTenant] ?? [] };
}

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

// Imported once, in beforeAll — routes/intelligence.ts fires 3 startup
// pool.query() calls at module-load time (idempotent ALTER TABLE/UPDATE
// cleanup, no bound params). Importing here — before the first beforeEach's
// mockReset() — keeps those startup calls out of every test's
// `mock.calls[0]`, instead of polluting whichever test happens to trigger
// the module's first-ever import.
let router: any;
beforeAll(async () => {
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => fakeFilteredRead(sqlText, params));
  router = (await import('../routes/intelligence')).default;
});

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => fakeFilteredRead(sqlText, params));
});

describe('routes/intelligence.ts — read routes are tenant-scoped', () => {
  it('GET /reports never returns GE\'s report to a reseller tenant', async () => {
    const handler = invokeRouteHandler(router, '/reports', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B), res);

    const focuses = (res.body.reports as Row[]).map((r) => r.focus_today);
    expect(focuses).toEqual(['tenantB-exclusive-focus']);
    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params).toEqual([TENANT_B]);
  });

  it('GET /today scopes both the complete-report query and the fallback query by tenant_id', async () => {
    const handler = invokeRouteHandler(router, '/today', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    expect(res.body.report.focus_today).toBe('tenantA-exclusive-focus');
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(params).toEqual([TENANT_A]);
  });

  it('GET /scores never leaks the other tenant\'s score', async () => {
    const handler = invokeRouteHandler(router, '/scores', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B), res);

    expect((res.body.scores as Row[]).map((r) => r.overall_score)).toEqual([99]);
  });

  it('GET /actions is tenant-scoped', async () => {
    const handler = invokeRouteHandler(router, '/actions', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params).toEqual([TENANT_A]);
  });

  it('GET /status/:id cannot be used to probe another tenant\'s report by id (IDOR)', async () => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // tenant B's id + tenant A's report id -> no match
    const handler = invokeRouteHandler(router, '/status/:id', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, { params: { id: 'r-a' } }), res);

    expect(res.body.status).toBe('not_found');
    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params).toEqual(['r-a', TENANT_B]);
  });
});

describe('routes/intelligence.ts — POST /generate is GE-tenant-only', () => {
  it('a reseller tenant admin gets 403 and no report row is ever created', async () => {
    const handler = invokeRouteHandler(router, '/generate', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_B), res);

    expect(res.statusCode).toBe(403);
    expect(mockPoolQuery.mock.calls.every(([sql]) => !String(sql).includes('INSERT INTO ai_intelligence_reports'))).toBe(true);
  });

  it('GE\'s own tenant is unaffected and the placeholder report row is stamped with GE\'s tenant', async () => {
    // The persistent fakeFilteredRead implementation (set in beforeEach)
    // handles both the GE-tenant-id lookup and the placeholder INSERT by
    // SQL text, so it stays correct for the background setImmediate
    // continuation too (which fires after this test's own assertions, and
    // may interleave with later tests) — no per-call mock ordering to get
    // wrong.
    const handler = invokeRouteHandler(router, '/generate', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_A), res);

    expect(res.body.status).toBe('generating');
    const insertCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO ai_intelligence_reports'));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall!;
    expect(sql).toMatch(/tenant_id/);
    expect(params).toContain(TENANT_A);
  });
});

describe('routes/intelligence.ts — POST /run-cron/:name is GE-tenant-only', () => {
  it('a reseller tenant admin gets 403, the cron never runs', async () => {
    const handler = invokeRouteHandler(router, '/run-cron/:name', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_B, { params: { name: 'Directory Scrapers' } }), res);

    expect(res.statusCode).toBe(403);
  });

  it('GE\'s own tenant is unaffected', async () => {
    const handler = invokeRouteHandler(router, '/run-cron/:name', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_A, { params: { name: 'Directory Scrapers' } }), res);

    expect(res.body.ok).toBe(true);
  });
});
