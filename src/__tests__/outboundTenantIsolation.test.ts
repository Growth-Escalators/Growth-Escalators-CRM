import { describe, it, expect, vi, beforeEach } from 'vitest';

// H18 — prospects (and its child tables signals/replies/outbound_events,
// scoped transitively through prospect_id) had no tenant_id at all: any
// authenticated admin/team_lead of ANY tenant could read/mutate the first
// tenant's outbound data. These tests assert every prospects touch-point in
// routes/outbound.ts now filters/stamps on the caller's tenant_id.

const mockPoolQuery = vi.fn();
vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
  db: { select: vi.fn(), insert: vi.fn() },
  deals: {},
  pipelines: {},
}));

vi.mock('../services/contactService', () => ({
  findOrCreateContact: vi.fn(),
}));
vi.mock('../services/outreachEnrichmentService', () => ({
  classifyReplyWithAI: vi.fn(),
}));

import outboundRouter from '../routes/outbound';

async function invokeRoute(router: any, path: string, method: string, req: any, res: any, jsonFn: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    if (jsonFn.mock.calls.length > 0) break;
    let nextCalled = false;
    let nextErr: unknown;
    await item.handle(req, res, (err?: unknown) => { nextCalled = true; nextErr = err; });
    if (nextErr) throw nextErr;
    if (!nextCalled) break;
  }
}

function makeReqRes(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = {
    user: { tenantId: 'tenant-A' },
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };
  const res = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn };
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('outbound routes — tenant isolation (H18)', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it('GET /prospects returns 401 when the caller has no tenant context', async () => {
    const { req, res, statusFn, jsonFn } = makeReqRes({ user: undefined });
    await invokeRoute(outboundRouter, '/prospects', 'get', req, res, jsonFn);
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('GET /prospects filters the list query by the caller tenant_id', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const { req, res, jsonFn } = makeReqRes();
    await invokeRoute(outboundRouter, '/prospects', 'get', req, res, jsonFn);

    const [sql, args] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    // limit/offset are appended positionally after the WHERE args.
    expect(args).toEqual(['tenant-A', 50, 0]);
  });

  it('GET /prospects/:id filters by tenant_id and 404s a cross-tenant id', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // prospects
      .mockResolvedValueOnce({ rows: [] }) // signals
      .mockResolvedValueOnce({ rows: [] }); // replies

    const { req, res, statusFn, jsonFn } = makeReqRes({ params: { id: VALID_UUID } });
    await invokeRoute(outboundRouter, '/prospects/:id', 'get', req, res, jsonFn);

    const [sql, args] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
    expect(args).toEqual([VALID_UUID, 'tenant-A']);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('POST /prospects/import-csv stamps tenant_id on every inserted row', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: 'p-1' }] });
    const { req, res, jsonFn } = makeReqRes({
      body: 'email\nrider@example.com\n',
      headers: { 'content-type': 'text/csv' },
      is: (t: string) => t === 'text/csv',
    });
    await invokeRoute(outboundRouter, '/prospects/import-csv', 'post', req, res, jsonFn);

    const insertCall = mockPoolQuery.mock.calls.find((call: unknown[]) => (call[0] as string).includes('INSERT INTO prospects'));
    expect(insertCall).toBeDefined();
    const [sql, args] = insertCall!;
    expect(sql).toMatch(/tenant_id/);
    expect(args[0]).toBe('tenant-A');
  });

  it('PATCH /prospects/:id/status scopes both the lock read and the update to tenant_id', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ status: 'new' }] }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE prospects
        .mockResolvedValueOnce(undefined) // INSERT outbound_events
        .mockResolvedValueOnce(undefined), // COMMIT
      release: vi.fn(),
    };
    const mockConnect = vi.fn().mockResolvedValue(client);
    const dbIndex = await import('../db/index');
    (dbIndex.pool as unknown as { connect: typeof mockConnect }).connect = mockConnect;

    const { req, res, jsonFn } = makeReqRes({
      params: { id: VALID_UUID },
      body: { status: 'contacted' },
    });
    await invokeRoute(outboundRouter, '/prospects/:id/status', 'patch', req, res, jsonFn);

    const selectCall = client.query.mock.calls[1];
    expect(selectCall[0]).toMatch(/WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/);
    expect(selectCall[1]).toEqual([VALID_UUID, 'tenant-A']);

    const updateCall = client.query.mock.calls[2];
    expect(updateCall[0]).toMatch(/WHERE id = \$2 AND tenant_id = \$3/);
    expect(updateCall[1]).toEqual(['contacted', VALID_UUID, 'tenant-A']);
  });

  it('POST /prospects/bulk-enrich matches candidates by email only within the caller tenant', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // no match for the one row

    const { req, res, jsonFn } = makeReqRes({
      body: { rows: [{ email: 'lead@example.com', title: 'CTO' }] },
    });
    await invokeRoute(outboundRouter, '/prospects/bulk-enrich', 'post', req, res, jsonFn);

    const [sql, args] = mockPoolQuery.mock.calls[0];
    expect(sql).toMatch(/lower\(email\)=\$1 AND tenant_id=\$2/);
    expect(args).toEqual(['lead@example.com', 'tenant-A']);
  });

  it('GET /stats scopes every aggregate query to the caller tenant_id', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // by-status
      .mockResolvedValueOnce({ rows: [] }) // by-icp
      .mockResolvedValueOnce({ rows: [] }) // 7d trend
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const { req, res, jsonFn } = makeReqRes();
    await invokeRoute(outboundRouter, '/stats', 'get', req, res, jsonFn);

    expect(mockPoolQuery).toHaveBeenCalledTimes(5);
    for (const call of mockPoolQuery.mock.calls) {
      expect(call[0]).toMatch(/tenant_id/);
      expect(call[1]).toEqual(['tenant-A']);
    }
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ total: 0 }));
  });
});
