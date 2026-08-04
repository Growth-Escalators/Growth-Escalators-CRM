import { describe, it, expect, vi, beforeEach } from 'vitest';

// Security audit (2026-08-04): GET /api/pipelines/diagnose and
// POST /api/pipelines/backfill-from-deals had NO admin check at all and
// every underlying query was unscoped by tenant — any authenticated user of
// ANY tenant could read every tenant's pipeline/purchase counts, and the
// "auto-fix" block in /diagnose (and the whole body of /backfill-from-deals)
// would silently place OTHER tenants' orphan deals into pipelines via
// placePipelineContact(). These tests assert both routes are now
// admin-gated AND every query/mutation is scoped to the caller's own
// tenant_id — never touching or returning the other tenant's rows.

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // e.g. GE
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // reseller

const PIPELINE_FIXTURES: Record<string, Array<Record<string, unknown>>> = {
  [TENANT_A]: [{ id: 'p-a', name: 'tenantA-exclusive-pipeline', stages: [] }],
  [TENANT_B]: [{ id: 'p-b', name: 'tenantB-exclusive-pipeline', stages: [] }],
};

const DEALS_WITHOUT_PIPELINE_COUNT: Record<string, number> = {
  [TENANT_A]: 1,
  [TENANT_B]: 1,
};

const ORPHAN_DEALS_FIXTURES: Record<string, Array<Record<string, unknown>>> = {
  [TENANT_A]: [{ id: 'deal-a', contact_id: 'contact-a', tenant_id: TENANT_A, value: 100, stage: 'x', metadata: {}, tags: [] }],
  [TENANT_B]: [{ id: 'deal-b', contact_id: 'contact-b', tenant_id: TENANT_B, value: 200, stage: 'y', metadata: {}, tags: [] }],
};

const BACKFILL_PURCHASE_CONTACTS: Record<string, Array<Record<string, unknown>>> = {
  [TENANT_A]: [{ contact_id: 'pc-a', first_name: 'A', last_name: '', tenant_id: TENANT_A, metadata: {}, tags: ['slo_buyer'], deal_id: null, deal_value: null, deal_stage: null, pipeline_id: null }],
  [TENANT_B]: [{ contact_id: 'pc-b', first_name: 'B', last_name: '', tenant_id: TENANT_B, metadata: {}, tags: ['slo_buyer'], deal_id: null, deal_value: null, deal_stage: null, pipeline_id: null }],
};

const mockPoolQuery = vi.fn();
const mockPlacePipelineContact = vi.fn().mockResolvedValue({ success: true, pipeline: 'x', stage: 'y', tags: [], contactId: 'c' });

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
  db: {},
  pipelines: {},
  deals: {},
  contacts: {},
  contactChannels: {},
}));

vi.mock('../services/pipelineService', () => ({
  placePipelineContact: (...args: unknown[]) => mockPlacePipelineContact(...args),
}));

function diagnoseImpl(sqlText: string, params: unknown[] = []): { rows: unknown[] } {
  const tenantId = params[0] as string | undefined;
  if (sqlText.includes('FROM pipeline_contacts')) return { rows: [{ count: 0 }] };
  if (sqlText.includes("FROM events WHERE event_type = 'slo_purchase' AND contact_id IS NOT NULL")) return { rows: [{ count: 0 }] };
  if (sqlText.includes("FROM events WHERE event_type = 'slo_purchase'")) return { rows: [{ count: 0 }] };
  if (sqlText.includes('FROM events e') && sqlText.includes('NOT EXISTS')) return { rows: [{ count: 0 }] };
  if (sqlText.includes('FROM pipelines WHERE is_active')) return { rows: tenantId ? PIPELINE_FIXTURES[tenantId] ?? [] : [] };
  if (sqlText.includes('FROM deals WHERE pipeline_id IS NULL')) return { rows: [{ count: tenantId ? DEALS_WITHOUT_PIPELINE_COUNT[tenantId] ?? 0 : 0 }] };
  if (sqlText.includes('SELECT e.contact_id, e.payload')) return { rows: [] };
  if (sqlText.includes('FROM funnel_configs')) return { rows: [] };
  if (sqlText.includes('FROM deals d') && sqlText.includes('JOIN contacts c') && sqlText.includes('d.pipeline_id IS NULL')) {
    return { rows: tenantId ? ORPHAN_DEALS_FIXTURES[tenantId] ?? [] : [] };
  }
  return { rows: [] };
}

function backfillImpl(sqlText: string, params: unknown[] = []): { rows: unknown[] } {
  const tenantId = params[0] as string | undefined;
  if (sqlText.includes('SELECT DISTINCT ON (c.id)')) return { rows: tenantId ? BACKFILL_PURCHASE_CONTACTS[tenantId] ?? [] : [] };
  if (sqlText.includes("SELECT id FROM events WHERE event_type = 'slo_purchase'")) return { rows: [] };
  return { rows: [] };
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

function reqAs(tenantId: string, role: string, overrides: Record<string, unknown> = {}) {
  return { user: { tenantId, id: 'user-1', role }, params: {}, query: {}, body: {}, ...overrides };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPlacePipelineContact.mockClear();
  mockPlacePipelineContact.mockResolvedValue({ success: true, pipeline: 'x', stage: 'y', tags: [], contactId: 'c' });
});

describe('routes/pipelines.ts — GET /diagnose tenant isolation', () => {
  it('non-admin caller gets 403, no query is ever run', async () => {
    mockPoolQuery.mockImplementation(async () => { throw new Error('should not be called'); });
    const router = (await import('../routes/pipelines')).default;
    const handler = invokeRouteHandler(router, '/diagnose', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, 'team_lead'), res);

    expect(res.statusCode).toBe(403);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('admin of tenant B sees only tenant B\'s active_pipelines — never tenant A\'s', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => diagnoseImpl(sqlText, params));
    const router = (await import('../routes/pipelines')).default;
    const handler = invokeRouteHandler(router, '/diagnose', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, 'admin'), res);

    expect(res.statusCode).toBe(200);
    const names = (res.body.active_pipelines as Array<Record<string, unknown>>).map((p) => p.name);
    expect(names).toEqual(['tenantB-exclusive-pipeline']);
  });

  it('admin of tenant B\'s orphan-deal auto-fix only ever touches tenant B\'s deal, never tenant A\'s', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => diagnoseImpl(sqlText, params));
    const router = (await import('../routes/pipelines')).default;
    const handler = invokeRouteHandler(router, '/diagnose', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_B, 'admin'), res);

    expect(mockPlacePipelineContact).toHaveBeenCalledTimes(1);
    const call = mockPlacePipelineContact.mock.calls[0][0] as { contactId: string; tenantId: string };
    expect(call.contactId).toBe('contact-b');
    expect(call.tenantId).toBe(TENANT_B);
    // Every bound tenant param sent to the DB across this request was tenant B's —
    // tenant A's id never appears in any query's parameter list.
    for (const call of mockPoolQuery.mock.calls) {
      const params = (call[1] ?? []) as unknown[];
      expect(params).not.toContain(TENANT_A);
    }
  });

  it('admin of tenant A (unchanged behavior) sees only tenant A\'s pipeline', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => diagnoseImpl(sqlText, params));
    const router = (await import('../routes/pipelines')).default;
    const handler = invokeRouteHandler(router, '/diagnose', 'get');
    const res = mockRes();
    await handler(reqAs(TENANT_A, 'admin'), res);

    expect(res.statusCode).toBe(200);
    const names = (res.body.active_pipelines as Array<Record<string, unknown>>).map((p) => p.name);
    expect(names).toEqual(['tenantA-exclusive-pipeline']);
  });
});

describe('routes/pipelines.ts — POST /backfill-from-deals tenant isolation', () => {
  it('non-admin caller gets 403, no query is ever run', async () => {
    mockPoolQuery.mockImplementation(async () => { throw new Error('should not be called'); });
    const router = (await import('../routes/pipelines')).default;
    const handler = invokeRouteHandler(router, '/backfill-from-deals', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_B, 'sales_rep'), res);

    expect(res.statusCode).toBe(403);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('admin of tenant B only places tenant B\'s purchase contacts — never tenant A\'s', async () => {
    mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => backfillImpl(sqlText, params));
    const router = (await import('../routes/pipelines')).default;
    const handler = invokeRouteHandler(router, '/backfill-from-deals', 'post');
    const res = mockRes();
    await handler(reqAs(TENANT_B, 'admin'), res);

    expect(res.statusCode).toBe(200);
    expect(mockPlacePipelineContact).toHaveBeenCalledTimes(1);
    const call = mockPlacePipelineContact.mock.calls[0][0] as { contactId: string; tenantId: string };
    expect(call.contactId).toBe('pc-b');
    expect(call.tenantId).toBe(TENANT_B);

    const [, params] = mockPoolQuery.mock.calls[0];
    expect(params).toEqual([TENANT_B]);
  });
});
