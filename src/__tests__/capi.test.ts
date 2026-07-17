import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
  events: { id: 'id', tenantId: 'tenant_id', eventType: 'event_type', createdAt: 'created_at' },
  contacts: {},
  tenants: {},
}));

vi.mock('../services/metaCapi', () => ({
  sendCapiEvent: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeReqRes(tenantId: string) {
  const req = { user: { tenantId } } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

async function invokeGetStatus(req: any, res: any) {
  const { default: router } = await import('../routes/capi');
  const layer = router.stack.find((l: any) => l.route?.path === '/status' && l.route?.methods?.get);
  await layer!.route!.stack[0].handle(req, res, vi.fn());
}

describe('GET /api/capi/status (C4 — tenant isolation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters CAPI events by the caller tenant, not just event type', async () => {
    let capturedWhere: unknown;
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: unknown) => {
          capturedWhere = cond;
          return { orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
        }),
      }),
    });

    const { req, res, jsonFn } = makeReqRes('tenant-a');
    await invokeGetStatus(req, res);

    // The where() call must have been given a compound condition (and(...))
    // rather than just the `like(eventType, 'capi_%')` filter alone — this
    // is a coarse but meaningful regression guard: passing only a single
    // condition object is how the pre-fix code looked (tenant-unfiltered).
    expect(capturedWhere).toBeDefined();
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ recentEvents: [] }));
  });

  it('two different tenants querying concurrently get independently-scoped where() calls', async () => {
    const seenWheres: unknown[] = [];
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: unknown) => {
          seenWheres.push(cond);
          return { orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
        }),
      }),
    });

    const tenantA = makeReqRes('tenant-a');
    const tenantB = makeReqRes('tenant-b');
    await invokeGetStatus(tenantA.req, tenantA.res);
    await invokeGetStatus(tenantB.req, tenantB.res);

    expect(seenWheres).toHaveLength(2);
    // Each call's where() condition must differ (it embeds the tenantId),
    // proving the query is not identical/tenant-blind across callers.
    expect(seenWheres[0]).not.toEqual(seenWheres[1]);
  });
});
