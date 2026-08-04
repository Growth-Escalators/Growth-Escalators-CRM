import { describe, it, expect, vi, beforeEach } from 'vitest';

// Security audit (2026-08-03): GET /api/reports/generate had two
// cross-tenant leaks:
//   1. fetchCompletedTasksForWeek() queried `tasks` with no tenant_id filter
//      at all (tasks.tenant_id is already NOT NULL in schema.ts — this was a
//      missing WHERE, not a missing column), so a weekly report for one
//      tenant's client showed every tenant's completed tasks.
//   2. The "agency average benchmark" query averaged EVERY tenant's
//      client_benchmarks rows together (client_benchmarks itself had no
//      tenant_id column at all), so "your agency average ROAS" leaked other
//      tenants' ad performance into the number.
//
// Convention matches seoTenantIsolation.test.ts / billingRoutes.test.ts:
// pool.query is a tiny filtered database keyed off the bound tenant_id
// param (not a canned response), and db.select() is a fluent mock that
// routes to different fixture rows based on which table object was passed
// to .from(...).

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Row = Record<string, unknown>;

const TASK_FIXTURES: Record<string, Row[]> = {
  [TENANT_A]: [{ id: 'task-a', title: 'tenantA-exclusive-task', status: 'done', updated_at: new Date('2026-07-20T00:00:00Z') }],
  [TENANT_B]: [{ id: 'task-b', title: 'tenantB-exclusive-task', status: 'done', updated_at: new Date('2026-07-21T00:00:00Z') }],
};

// Per-client benchmark row (ad_account_id + tenant_id scoped)
const CLIENT_BENCHMARK_FIXTURES: Record<string, Row[]> = {
  [TENANT_A]: [{ avg_roas: 2, avg_ctr: 1, total_spend: 1000, total_revenue: 2000, top_creative_type: 'tenantA-creative' }],
  [TENANT_B]: [{ avg_roas: 50, avg_ctr: 20, total_spend: 5000, total_revenue: 250000, top_creative_type: 'tenantB-creative' }],
};

// Agency-average source rows per tenant — deliberately very different so a
// pooled (unscoped) average would be an obviously wrong number for either
// tenant, making a broken filter unmistakable in the assertions below.
const AGENCY_AVG_FIXTURES: Record<string, { avg_roas: number; avg_ctr: number }> = {
  [TENANT_A]: { avg_roas: 2, avg_ctr: 1 },
  [TENANT_B]: { avg_roas: 50, avg_ctr: 20 },
};

function fakePoolQuery(sqlText: string, params: unknown[] = []): { rows: Row[] } {
  if (sqlText.includes('FROM tasks')) {
    const tenantId = params[2] as string | undefined;
    return { rows: tenantId ? (TASK_FIXTURES[tenantId] ?? []) : [] };
  }
  if (sqlText.includes('FROM client_benchmarks') && sqlText.includes('AVG(avg_roas)')) {
    // Agency-average query — bound as [tenantId]. If the code regresses to
    // an unscoped query, params will be empty and this returns nothing,
    // which the "never accidentally correct" assertion below catches.
    const tenantId = params[0] as string | undefined;
    const fixture = tenantId ? AGENCY_AVG_FIXTURES[tenantId] : undefined;
    if (!fixture) return { rows: [] };
    return { rows: [{ avg_roas: fixture.avg_roas, avg_ctr: fixture.avg_ctr }] };
  }
  if (sqlText.includes('FROM client_benchmarks')) {
    // Per-client benchmark lookup — bound as [adAccountId, tenantId].
    const tenantId = params[1] as string | undefined;
    return { rows: tenantId ? (CLIENT_BENCHMARK_FIXTURES[tenantId] ?? []) : [] };
  }
  return { rows: [] };
}

const mockPoolQuery = vi.fn();
const mockDbSelect = vi.fn();

const billingClients = { id: 'id', tenantId: 'tenant_id', name: 'name', email: 'email', phone: 'phone', metaAdAccountId: 'meta_ad_account_id', isActive: 'is_active' };
const userPermissions = { userId: 'user_id' };

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
  billingClients,
  userPermissions,
}));

function mockPerms(perms: Record<string, boolean>) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([perms]),
      }),
    }),
  });
}

function mockClientRow(row: Row | undefined) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(row ? [row] : []),
      }),
    }),
  });
}

async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

function makeReqRes(tenantId: string, query: Record<string, string> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = { user: { id: 'user-1', tenantId, email: 'user@test.com' }, params: {}, query, body: {} } as any;
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

describe('routes/reports.ts — tenant isolation (weekly tasks + agency benchmark)', () => {
  beforeEach(() => {
    // Neither Meta Ads nor Anthropic calls should happen in these tests —
    // clearing these ensures fetchWeeklyAdMetrics() and the AI-recommendation
    // block both short-circuit instead of making a real network call.
    delete process.env.META_ADS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;

    mockDbSelect.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => fakePoolQuery(sqlText, params));
  });

  it('GET /generate — completedTasks only reflects the caller tenant\'s tasks', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-1', name: 'Acme', email: null, phone: null, metaAdAccountId: 'act_shared' });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn } = makeReqRes(TENANT_A, { clientId: 'client-1', weekOf: '2026-07-20' });

    await invokeRoute(router, '/generate', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    const taskNames = (body.completedTasks as Array<{ name: string }>).map((t) => t.name);
    expect(taskNames).toEqual(['tenantA-exclusive-task']);
    expect(taskNames).not.toContain('tenantB-exclusive-task');

    // The tasks query must actually bind the caller's tenant_id — verifies
    // this isn't accidentally passing because the fixture happened to be
    // empty for both tenants.
    const tasksCall = mockPoolQuery.mock.calls.find((c) => String(c[0]).includes('FROM tasks'));
    expect(tasksCall).toBeDefined();
    expect(tasksCall![1]).toContain(TENANT_A);
  });

  it('GET /generate — completedTasks for tenant B never contains tenant A\'s task', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-2', name: 'Acme', email: null, phone: null, metaAdAccountId: 'act_shared' });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn } = makeReqRes(TENANT_B, { clientId: 'client-2', weekOf: '2026-07-20' });

    await invokeRoute(router, '/generate', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    const taskNames = (body.completedTasks as Array<{ name: string }>).map((t) => t.name);
    expect(taskNames).toEqual(['tenantB-exclusive-task']);
  });

  it('GET /generate — agencyAvg reflects only the caller tenant\'s client_benchmarks rows', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-1', name: 'Acme', email: null, phone: null, metaAdAccountId: 'act_shared' });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn } = makeReqRes(TENANT_A, { clientId: 'client-1', weekOf: '2026-07-20' });

    await invokeRoute(router, '/generate', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    expect(body.agencyAvg).toEqual({ avg_roas: 2, avg_ctr: 1 });
    expect(body.agencyAvg.avg_roas).not.toBe(AGENCY_AVG_FIXTURES[TENANT_B].avg_roas);
  });

  it('GET /generate — agencyAvg for tenant B is tenant B\'s own average, not tenant A\'s', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-2', name: 'Acme', email: null, phone: null, metaAdAccountId: 'act_shared' });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn } = makeReqRes(TENANT_B, { clientId: 'client-2', weekOf: '2026-07-20' });

    await invokeRoute(router, '/generate', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    expect(body.agencyAvg).toEqual({ avg_roas: 50, avg_ctr: 20 });
  });

  it('GET /generate — per-client benchmark scopes by tenant_id even with a shared ad_account_id', async () => {
    mockPerms({ reportsView: true, isOwner: false });
    mockClientRow({ id: 'client-1', name: 'Acme', email: null, phone: null, metaAdAccountId: 'act_shared' });

    const { default: router } = await import('../routes/reports');
    const { req, res, jsonFn } = makeReqRes(TENANT_A, { clientId: 'client-1', weekOf: '2026-07-20' });

    await invokeRoute(router, '/generate', 'get', req, res);

    const body = jsonFn.mock.calls[0][0];
    expect(body.benchmark.top_creative_type).toBe('tenantA-creative');

    const benchCall = mockPoolQuery.mock.calls.find(
      (c) => String(c[0]).includes('FROM client_benchmarks') && !String(c[0]).includes('AVG(avg_roas)'),
    );
    expect(benchCall).toBeDefined();
    expect(benchCall![1]).toEqual(['act_shared', TENANT_A]);
  });
});
