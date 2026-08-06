import { describe, it, expect, vi, beforeEach } from 'vitest';

// Two things under test here (src/routes/audit.ts):
//
// 1. AUDIT_VIEW isOwner escape hatch — rbac.ts's requirePermission('AUDIT_VIEW')
//    resolves to role === 'admin' literally, not userPermissions.isOwner. A
//    tenant owner whose role isn't 'admin' was previously 403'd from their own
//    audit log. requireAuditView() must pass for role='admin' (unchanged),
//    reject a non-admin/non-owner (unchanged), and now ALSO pass for a
//    non-admin caller with isOwner=true (the fix).
//
// 2. The merged audit_events + audit_logs view — /events, /users, and
//    /export must query BOTH tables (UNION ALL) instead of only audit_events.

const mockDbSelect = vi.fn();
const mockDbExecute = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
  users: { id: 'id', tenantId: 'tenant_id', name: 'name', email: 'email', role: 'role' },
  userPermissions: { userId: 'user_id' },
}));

// drizzle-orm's `sql` tag composes SQL objects recursively (buildMergedFragment
// nests buildEventsFragment/buildLogsFragment, each of which itself nests
// conditional AND fragments) — a flat, one-level chunk scan misses text that
// lives inside a nested SQL sub-object. This recurses through queryChunks to
// reassemble the full literal SQL text for matching against in assertions.
function extractSqlText(sqlObj: unknown): string {
  if (sqlObj == null || typeof sqlObj !== 'object') return '';
  const chunks = (sqlObj as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        if (Array.isArray((c as { queryChunks?: unknown[] }).queryChunks)) return extractSqlText(c);
        const value = (c as { value?: unknown[] }).value;
        if (Array.isArray(value)) return value.join('');
      }
      return '';
    })
    .join(' ');
}

function mockSelectOnce(rows: unknown[]) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function makeReqRes(userId: string, tenantId: string, role: string, query: Record<string, string> = {}) {
  const req = { user: { id: userId, tenantId, role }, query, params: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn, setHeader: vi.fn(), send: vi.fn() } as any;
  return { req, res, jsonFn, statusFn };
}

// Mirrors billingRoutes.test.ts's harness: walk the route's middleware chain
// (requireAuditView, then the handler) exactly as Express would, stopping if
// a middleware never calls next().
async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAuditView — AUDIT_VIEW isOwner escape hatch', () => {
  it("admin role still passes (unchanged behavior — doesn't need isOwner)", async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes/audit');
    const { req, res, statusFn } = makeReqRes('user-1', 'tenant-a', 'admin');

    await invokeRoute(router, '/events', 'get', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
  });

  it('a non-admin, non-owner caller is still rejected with 403 (unchanged behavior)', async () => {
    mockSelectOnce([{ isOwner: false }]);
    const { default: router } = await import('../routes/audit');
    const { req, res, statusFn } = makeReqRes('user-2', 'tenant-a', 'sales');

    await invokeRoute(router, '/events', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
  });

  it("a non-admin caller who IS the tenant owner now passes — the actual bug fix", async () => {
    mockSelectOnce([{ isOwner: true }]);
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes/audit');
    const { req, res, statusFn } = makeReqRes('user-3', 'tenant-a', 'sales');

    await invokeRoute(router, '/events', 'get', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
  });

  it('a non-admin owner also passes on /export (the redundant hardcoded admin-only check is gone)', async () => {
    mockSelectOnce([{ isOwner: true }]);
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes/audit');
    const { req, res, statusFn } = makeReqRes('user-4', 'tenant-a', 'manager_ops');

    await invokeRoute(router, '/export', 'get', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
  });

  it('no userPermissions row at all (fresh/never-provisioned user) is treated as not-owner, not a crash', async () => {
    mockSelectOnce([]); // getPerms finds nothing
    const { default: router } = await import('../routes/audit');
    const { req, res, statusFn } = makeReqRes('user-5', 'tenant-a', 'staff');

    await invokeRoute(router, '/events', 'get', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
  });
});

describe('GET /events — merged audit_events + audit_logs view', () => {
  it('queries both tables via UNION ALL, tenant-scoped, and reports total from the merged count', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: '1', source: 'audit_events', action: 'LOGIN' }] }) // data query
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }); // count query

    const { default: router } = await import('../routes/audit');
    const { req, res, jsonFn } = makeReqRes('user-1', 'tenant-a', 'admin');

    await invokeRoute(router, '/events', 'get', req, res);

    expect(mockDbExecute).toHaveBeenCalledTimes(2);
    const dataQueryText = extractSqlText(mockDbExecute.mock.calls[0][0]);
    expect(dataQueryText).toMatch(/audit_events/);
    expect(dataQueryText).toMatch(/audit_logs/);
    expect(dataQueryText).toMatch(/UNION ALL/);
    expect(dataQueryText).toMatch(/ae\.tenant_id/);
    expect(dataQueryText).toMatch(/al\.tenant_id/);

    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ total: 3 }));
  });

  it('applies the action/userId/date filters to BOTH source queries', async () => {
    mockDbExecute.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes/audit');
    const { req, res } = makeReqRes('user-1', 'tenant-a', 'admin', {
      action: 'invoice_sent', userId: 'user-9', from: '2026-01-01', to: '2026-01-31',
    });

    await invokeRoute(router, '/events', 'get', req, res);

    const dataQueryText = extractSqlText(mockDbExecute.mock.calls[0][0]);
    expect(dataQueryText).toMatch(/ae\.action\s*=/);
    expect(dataQueryText).toMatch(/al\.action\s*=/);
    expect(dataQueryText).toMatch(/ae\.user_id\s*=/);
    expect(dataQueryText).toMatch(/al\.user_id\s*=/);
  });
});

describe('GET /export — merged CSV includes a Source column', () => {
  it('emits a Source column and rows tagged by source table', async () => {
    mockDbExecute.mockResolvedValue({
      rows: [
        { created_at: '2026-01-01T00:00:00Z', user_name: 'Jatin', user_email: 'j@ge.com', action: 'LOGIN', resource_type: null, resource_id: null, ip_address: '1.2.3.4', source: 'audit_events' },
        { created_at: '2026-01-02T00:00:00Z', user_name: 'Jatin', user_email: 'j@ge.com', action: 'invoice_sent', resource_type: 'invoice', resource_id: 'inv-1', ip_address: null, source: 'audit_logs' },
      ],
    });
    const { default: router } = await import('../routes/audit');
    const { req, res } = makeReqRes('user-1', 'tenant-a', 'admin');

    await invokeRoute(router, '/export', 'get', req, res);

    expect(res.send).toHaveBeenCalledTimes(1);
    const csv = res.send.mock.calls[0][0] as string;
    expect(csv.split('\n')[0]).toContain('Source');
    expect(csv).toContain('audit_events');
    expect(csv).toContain('audit_logs');
  });
});
