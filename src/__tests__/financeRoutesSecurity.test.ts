import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/routes/finance.ts previously had zero authorization beyond
// requireAuth on all 26 routes — any authenticated user of any role could
// read/write payroll, salaries, leave, expenses, income, and P&L. These
// tests cover the three highest-severity fixes:
//   1. GET /attendance/calendar leaked every tenant's payroll roster,
//      attendance, and leave balances with no tenant_id filter at all.
//   2. POST /leaves trusted a client-supplied memberId instead of resolving
//      the caller's own team_payroll row server-side.
//   3. PATCH /leaves/:id (approve/reject) had no role gate and no
//      self-approval check.

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock('../services/financeService', () => ({
  seedDefaultCategories: vi.fn().mockResolvedValue(undefined),
  generateMonthlyExpenses: vi.fn().mockResolvedValue({ generated: 0 }),
  calculatePnL: vi.fn().mockResolvedValue({
    revenue: 0, expenses: 0, profit: 0, expensesByCategory: [], revenueBreakdown: { invoices: 0, other: 0 },
  }),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeReqRes(
  role: string,
  tenantId: string,
  userId = 'user-1',
  overrides: Record<string, unknown> = {},
) {
  const req = { user: { id: userId, tenantId, role }, params: {}, query: {}, body: {}, ...overrides } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

// Walks the full middleware chain registered on a route (role gate(s) then
// the handler), same pattern as billingRoutes.test.ts's invokeRoute — this
// way the role-gate middleware is genuinely exercised, not bypassed.
async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

describe('finance.ts — role gating + tenant scoping (2026-08 hardening)', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  describe('GET /attendance/calendar — tenant isolation (most severe bug in this file)', () => {
    it('scopes all three queries (members, attendance, leave balances) by tenant_id', async () => {
      const { default: router } = await import('../routes/finance');
      const { req, res } = makeReqRes('admin', 'tenant-a');

      await invokeRoute(router, '/attendance/calendar', 'get', req, res);

      expect(mockPoolQuery).toHaveBeenCalledTimes(3);
      for (const call of mockPoolQuery.mock.calls) {
        const [sqlText, params] = call;
        expect(String(sqlText)).toMatch(/tenant_id/);
        expect(params).toContain('tenant-a');
      }
    });

    it('rejects a role with no finance access (e.g. sales) with 403 before touching the DB', async () => {
      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn } = makeReqRes('sales', 'tenant-a');

      await invokeRoute(router, '/attendance/calendar', 'get', req, res);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('allows manager_ops', async () => {
      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn } = makeReqRes('manager_ops', 'tenant-a');

      await invokeRoute(router, '/attendance/calendar', 'get', req, res);

      expect(statusFn).not.toHaveBeenCalledWith(403);
    });
  });

  describe('GET/POST /team-payroll — admin only', () => {
    it('rejects manager_ops (payroll is admin-only, stricter than the general finance view gate)', async () => {
      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn } = makeReqRes('manager_ops', 'tenant-a');

      await invokeRoute(router, '/team-payroll', 'get', req, res);

      expect(statusFn).toHaveBeenCalledWith(403);
    });

    it('allows admin', async () => {
      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn } = makeReqRes('admin', 'tenant-a');

      await invokeRoute(router, '/team-payroll', 'get', req, res);

      expect(statusFn).not.toHaveBeenCalledWith(403);
    });
  });

  describe('POST /leaves — memberId is resolved server-side, never trusted from the body', () => {
    it('ignores a client-supplied memberId and resolves the caller\'s own team_payroll row instead', async () => {
      mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => {
        if (String(sqlText).includes('SELECT id FROM team_payroll WHERE user_id')) {
          expect(params).toEqual(['user-1', 'tenant-a']);
          return { rows: [{ id: 'own-member-id' }] };
        }
        if (String(sqlText).includes('INSERT INTO team_leaves')) {
          // memberId bound must be the resolved own-member-id, not the
          // attacker-supplied 'someone-elses-member-id' from the body.
          expect(params).toContain('own-member-id');
          expect(params).not.toContain('someone-elses-member-id');
          return { rows: [{ id: 'leave-1' }] };
        }
        return { rows: [] };
      });

      const { default: router } = await import('../routes/finance');
      const { req, res, jsonFn } = makeReqRes('sales', 'tenant-a', 'user-1', {
        body: {
          memberId: 'someone-elses-member-id',
          startDate: '2026-08-10',
          endDate: '2026-08-11',
          leaveType: 'casual',
        },
      });

      await invokeRoute(router, '/leaves', 'post', req, res);

      expect(jsonFn).toHaveBeenCalledWith({ leave: { id: 'leave-1' } });
    });

    it('404s when the caller has no team_payroll record', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });
      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn } = makeReqRes('sales', 'tenant-a', 'user-no-record', {
        body: { startDate: '2026-08-10', endDate: '2026-08-11' },
      });

      await invokeRoute(router, '/leaves', 'post', req, res);

      expect(statusFn).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /leaves/:id — approve/reject requires admin/manager_ops AND blocks self-approval', () => {
    it('rejects a role with no finance access before touching the DB', async () => {
      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn } = makeReqRes('sales', 'tenant-a', 'user-1', {
        params: { id: 'leave-1' },
        body: { status: 'approved' },
      });

      await invokeRoute(router, '/leaves/:id', 'patch', req, res);

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('blocks an admin from approving their own leave request with 400, and never writes the approval', async () => {
      mockPoolQuery.mockImplementation(async (sqlText: string) => {
        if (String(sqlText).includes('SELECT l.id, t.user_id AS requester_user_id')) {
          return { rows: [{ id: 'leave-1', requester_user_id: 'user-1' }] };
        }
        throw new Error(`unexpected query: ${sqlText}`);
      });

      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn, jsonFn } = makeReqRes('admin', 'tenant-a', 'user-1', {
        params: { id: 'leave-1' },
        body: { status: 'approved' },
      });

      await invokeRoute(router, '/leaves/:id', 'patch', req, res);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/cannot approve your own leave request/i) }));
    });

    it('allows a different admin to approve the same leave request', async () => {
      mockPoolQuery.mockImplementation(async (sqlText: string) => {
        if (String(sqlText).includes('SELECT l.id, t.user_id AS requester_user_id')) {
          return { rows: [{ id: 'leave-1', requester_user_id: 'requester-user' }] };
        }
        if (String(sqlText).includes('UPDATE team_leaves SET status')) {
          return { rows: [] };
        }
        if (String(sqlText).includes('SELECT member_id, leave_type, days')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const { default: router } = await import('../routes/finance');
      const { req, res, statusFn, jsonFn } = makeReqRes('admin', 'tenant-a', 'approver-user', {
        params: { id: 'leave-1' },
        body: { status: 'approved' },
      });

      await invokeRoute(router, '/leaves/:id', 'patch', req, res);

      expect(statusFn).not.toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({ success: true });
    });
  });
});
