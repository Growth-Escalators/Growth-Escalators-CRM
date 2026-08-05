import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Route-level tests for the three permissions.ts features added alongside
// this PR: invite-by-email (POST /users, POST /users/:userId/resend-invite),
// seat-limit enforcement (POST /users), and reassign-on-offboard (POST
// /users/:userId/reassign, DELETE /users/:userId's optional reassign).
//
// Service internals (token hashing/expiry, seat-limit key resolution, the
// reassign SQL shape) are already unit-tested directly (userInvites.test.ts,
// seatLimits.test.ts, userReassignment.test.ts) — these tests mock those
// services and focus on what's route-specific: authorization gates,
// tenant-scoping IDOR checks, and wiring (the right args reach the right
// service, the right HTTP status/shape comes back). Same db-mocking harness
// as tenantIsolationIDOR.test.ts.

const { mockSelect, mockDelete, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockDelete: vi.fn(),
  mockExecute: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      execute: (...args: unknown[]) => mockExecute(...args),
    },
    pool: { query: vi.fn() },
    users: schema.users,
    userPermissions: schema.userPermissions,
  };
});

const mockCreateInviteToken = vi.fn();
const mockSendInviteEmail = vi.fn();
const mockHasPendingInvite = vi.fn();
vi.mock('../services/userInvites', () => ({
  createInviteToken: (...args: unknown[]) => mockCreateInviteToken(...args),
  sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args),
  hasPendingInvite: (...args: unknown[]) => mockHasPendingInvite(...args),
}));

const mockResolveTenantSeatLimit = vi.fn();
const mockCountActiveTenantUsers = vi.fn();
vi.mock('../services/seatLimits', () => ({
  resolveTenantSeatLimit: (...args: unknown[]) => mockResolveTenantSeatLimit(...args),
  countActiveTenantUsers: (...args: unknown[]) => mockCountActiveTenantUsers(...args),
}));

const mockReassignUserRecords = vi.fn();
vi.mock('../services/userReassignment', () => ({
  reassignUserRecords: (...args: unknown[]) => mockReassignUserRecords(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import permissionsRouter from '../routes/permissions';

const dialect = new PgDialect();
function compiledSql(query: unknown): string {
  return dialect.sqlToQuery(query as Parameters<PgDialect['sqlToQuery']>[0]).sql;
}

function resultChain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    limit: () => c,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function makeReqRes(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req: Record<string, unknown> = { params: {}, query: {}, body: {}, ...overrides };
  const res = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, req: unknown, res: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (permissionsRouter as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    await item.handle(req, res, (err?: unknown) => { if (err) throw err; });
  }
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222'; // same-tenant target
const OTHER_TENANT_USER = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [] });
});

// ===========================================================================
// POST /api/permissions/users — invite-by-email + seat-limit enforcement
// ===========================================================================
describe('POST /api/permissions/users', () => {
  function ownerReqRes(body: Record<string, unknown>) {
    return makeReqRes({ user: { id: OWNER_ID, tenantId: TENANT_A, role: 'admin' }, body });
  }

  function stubHappyPathInserts(newUserId = 'new-user-1') {
    // 1) INSERT INTO users ... RETURNING — 2) INSERT INTO user_permissions
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: newUserId, name: 'Sneha Joshi', email: 'sneha@growthescalators.com', role: 'staff', created_at: '2026-08-05' }] })
      .mockResolvedValueOnce({ rows: [] });
  }

  it('creates the user and sends an invite when under the seat limit', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller isOwner
    mockSelect.mockReturnValueOnce(resultChain([])); // no existing user with this email
    mockResolveTenantSeatLimit.mockResolvedValue(5);
    mockCountActiveTenantUsers.mockResolvedValue(2); // 2 + 1 = 3 <= 5
    stubHappyPathInserts();
    mockCreateInviteToken.mockResolvedValue('raw-invite-token');
    mockSendInviteEmail.mockResolvedValue({ success: true });

    const { req, res, jsonFn, statusFn } = ownerReqRes({ name: 'Sneha Joshi', email: 'sneha@growthescalators.com', role: 'staff' });
    await invoke('post', '/users', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(mockCreateInviteToken).toHaveBeenCalledWith('new-user-1', TENANT_A);
    expect(mockSendInviteEmail).toHaveBeenCalledWith('raw-invite-token', TENANT_A, 'Sneha Joshi', 'sneha@growthescalators.com');
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ ok: true, invited: true, emailSent: true }));
    // Regression guard: the old plaintext-password-in-response leak must not return.
    expect(jsonFn.mock.calls[0][0]).not.toHaveProperty('temporaryPassword');
  });

  it('blocks with 403 when adding one more user would exceed the seat limit, and never creates the user', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([]));
    mockResolveTenantSeatLimit.mockResolvedValue(3);
    mockCountActiveTenantUsers.mockResolvedValue(3); // 3 + 1 = 4 > 3

    const { req, res, statusFn } = ownerReqRes({ name: 'One Too Many', email: 'toomany@growthescalators.com' });
    await invoke('post', '/users', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockExecute).not.toHaveBeenCalled(); // no INSERT INTO users
    expect(mockCreateInviteToken).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });

  it('at exactly the limit still blocks the NEXT user (limit is a cap, not a floor)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([]));
    mockResolveTenantSeatLimit.mockResolvedValue(5);
    mockCountActiveTenantUsers.mockResolvedValue(5); // 5 + 1 = 6 > 5

    const { req, res, statusFn } = ownerReqRes({ name: 'At Limit', email: 'atlimit@growthescalators.com' });
    await invoke('post', '/users', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
  });

  it('allows creation with no seat limit configured (unlimited)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([]));
    mockResolveTenantSeatLimit.mockResolvedValue(null); // no active subscription/plan cap
    stubHappyPathInserts();
    mockCreateInviteToken.mockResolvedValue('tok');
    mockSendInviteEmail.mockResolvedValue({ success: true });

    const { req, res, statusFn } = ownerReqRes({ name: 'Unlimited Co', email: 'unlimited@growthescalators.com' });
    await invoke('post', '/users', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(mockCountActiveTenantUsers).not.toHaveBeenCalled(); // short-circuits — no cap to count against
    expect(mockCreateInviteToken).toHaveBeenCalled();
  });

  it('still creates the user and reports emailSent:false when the invite email fails (best-effort, not fatal)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([]));
    mockResolveTenantSeatLimit.mockResolvedValue(null);
    stubHappyPathInserts();
    mockCreateInviteToken.mockResolvedValue('tok');
    mockSendInviteEmail.mockRejectedValue(new Error('brevo down'));

    const { req, res, jsonFn } = ownerReqRes({ name: 'Sneha Joshi', email: 'sneha@growthescalators.com' });
    await invoke('post', '/users', req, res);

    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ ok: true, emailSent: false }));
  });
});

// ===========================================================================
// POST /api/permissions/users/:userId/resend-invite
// ===========================================================================
describe('POST /api/permissions/users/:userId/resend-invite', () => {
  function ownerReqRes(overrides: Record<string, unknown> = {}) {
    return makeReqRes({ user: { id: OWNER_ID, tenantId: TENANT_A, role: 'admin' }, params: { userId: TARGET_ID }, ...overrides });
  }

  it('404s for a user belonging to a different tenant, and never resends', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller check
    mockSelect.mockReturnValueOnce(resultChain([{ id: TARGET_ID, name: 'X', email: 'x@example.com', tenantId: TENANT_B }])); // target lookup, wrong tenant

    const { req, res, statusFn } = ownerReqRes();
    await invoke('post', '/users/:userId/resend-invite', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockCreateInviteToken).not.toHaveBeenCalled();
  });

  it('400s when the user is not actually pending', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([{ id: TARGET_ID, name: 'X', email: 'x@growthescalators.com', tenantId: TENANT_A }]));
    mockHasPendingInvite.mockResolvedValue(false);

    const { req, res, statusFn } = ownerReqRes();
    await invoke('post', '/users/:userId/resend-invite', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockCreateInviteToken).not.toHaveBeenCalled();
  });

  it('mints a fresh token and emails it for a same-tenant pending user', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([{ id: TARGET_ID, name: 'Sneha Joshi', email: 'sneha@growthescalators.com', tenantId: TENANT_A }]));
    mockHasPendingInvite.mockResolvedValue(true);
    mockCreateInviteToken.mockResolvedValue('fresh-token');
    mockSendInviteEmail.mockResolvedValue({ success: true });

    const { req, res, jsonFn } = ownerReqRes();
    await invoke('post', '/users/:userId/resend-invite', req, res);

    expect(mockCreateInviteToken).toHaveBeenCalledWith(TARGET_ID, TENANT_A);
    expect(mockSendInviteEmail).toHaveBeenCalledWith('fresh-token', TENANT_A, 'Sneha Joshi', 'sneha@growthescalators.com');
    expect(jsonFn).toHaveBeenCalledWith({ ok: true, emailSent: true });
  });
});

// ===========================================================================
// POST /api/permissions/users/:userId/reassign — tenant isolation
// ===========================================================================
describe('POST /api/permissions/users/:userId/reassign', () => {
  function ownerReqRes(overrides: Record<string, unknown> = {}) {
    return makeReqRes({
      user: { id: OWNER_ID, tenantId: TENANT_A, role: 'admin' },
      params: { userId: TARGET_ID },
      body: { toUserId: USER_B },
      ...overrides,
    });
  }

  it('403s a non-owner caller', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: false }]));
    const { req, res, statusFn } = ownerReqRes();
    await invoke('post', '/users/:userId/reassign', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
  });

  it('400s when toUserId is missing', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReqRes({ body: {} });
    await invoke('post', '/users/:userId/reassign', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
  });

  it('400s when reassigning a user to themselves', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReqRes({ body: { toUserId: TARGET_ID } });
    await invoke('post', '/users/:userId/reassign', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
  });

  it('404s (and never reassigns) when the SOURCE user belongs to a different tenant', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller
    mockSelect.mockReturnValueOnce(resultChain([{ id: TARGET_ID, tenantId: TENANT_B, name: 'X', email: 'x@example.com' }])); // fromUser, wrong tenant

    const { req, res, statusFn } = ownerReqRes();
    await invoke('post', '/users/:userId/reassign', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
  });

  it('404s (and never reassigns) when the TARGET (toUserId) belongs to a different tenant', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller
    mockSelect.mockReturnValueOnce(resultChain([{ id: TARGET_ID, tenantId: TENANT_A, name: 'From', email: 'from@growthescalators.com' }])); // fromUser ok
    mockSelect.mockReturnValueOnce(resultChain([{ id: OTHER_TENANT_USER, tenantId: TENANT_B, name: 'Cross Tenant', email: 'x@other.example' }])); // toUser, wrong tenant

    const { req, res, statusFn } = ownerReqRes({ body: { toUserId: OTHER_TENANT_USER } });
    await invoke('post', '/users/:userId/reassign', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
  });

  it('reassigns and returns per-table counts for a same-tenant pair', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([{ id: TARGET_ID, tenantId: TENANT_A, name: 'Tushar Jangid', email: 'tushar@growthescalators.com' }]));
    mockSelect.mockReturnValueOnce(resultChain([{ id: USER_B, tenantId: TENANT_A, name: 'Kanishk Khandelwal', email: 'kanishk@growthescalators.com' }]));
    mockReassignUserRecords.mockResolvedValue({ contacts: 4, deals: 2, tasks: 7 });

    const { req, res, jsonFn } = ownerReqRes();
    await invoke('post', '/users/:userId/reassign', req, res);

    expect(mockReassignUserRecords).toHaveBeenCalledWith(
      TENANT_A,
      expect.objectContaining({ id: TARGET_ID }),
      expect.objectContaining({ id: USER_B }),
    );
    expect(jsonFn).toHaveBeenCalledWith({ reassigned: { contacts: 4, deals: 2, tasks: 7 } });
  });
});

// ===========================================================================
// DELETE /api/permissions/users/:userId — optional reassign-then-deactivate
// ===========================================================================
describe('DELETE /api/permissions/users/:userId — optional reassign', () => {
  function ownerReqRes(overrides: Record<string, unknown> = {}) {
    return makeReqRes({
      user: { id: OWNER_ID, tenantId: TENANT_A, role: 'admin' },
      params: { userId: TARGET_ID },
      body: {},
      ...overrides,
    });
  }

  it('deactivates WITHOUT reassigning when reassignToUserId is omitted — records are left exactly as-is', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_A, name: 'X', email: 'x@growthescalators.com' }])); // target user
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: false }])); // targetPerms
    mockDelete.mockReturnValueOnce(resultChain([]));

    const { req, res, jsonFn } = ownerReqRes();
    await invoke('delete', '/users/:userId', req, res);

    expect(mockReassignUserRecords).not.toHaveBeenCalled();
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ removed: true }));
  });

  it('reassigns first, then deactivates, when reassignToUserId is given', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_A, name: 'Tushar Jangid', email: 'tushar@growthescalators.com' }])); // target user
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: false }])); // targetPerms
    mockSelect.mockReturnValueOnce(resultChain([{ id: USER_B, tenantId: TENANT_A, name: 'Kanishk Khandelwal', email: 'kanishk@growthescalators.com' }])); // reassign target lookup
    mockReassignUserRecords.mockResolvedValue({ contacts: 1, deals: 0, tasks: 3 });
    mockDelete.mockReturnValueOnce(resultChain([]));

    const { req, res, jsonFn } = ownerReqRes({ body: { reassignToUserId: USER_B } });
    await invoke('delete', '/users/:userId', req, res);

    expect(mockReassignUserRecords).toHaveBeenCalledWith(
      TENANT_A,
      expect.objectContaining({ name: 'Tushar Jangid' }),
      expect.objectContaining({ id: USER_B }),
    );
    expect(jsonFn).toHaveBeenCalledWith({ removed: true, reassigned: { contacts: 1, deals: 0, tasks: 3 } });
  });

  it('404s (and does NOT deactivate) when the reassign target belongs to a different tenant', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_A, name: 'X', email: 'x@growthescalators.com' }])); // target user
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: false }])); // targetPerms
    mockSelect.mockReturnValueOnce(resultChain([{ id: OTHER_TENANT_USER, tenantId: TENANT_B, name: 'Cross Tenant', email: 'x@other.example' }])); // reassign target, wrong tenant

    const { req, res, statusFn } = ownerReqRes({ body: { reassignToUserId: OTHER_TENANT_USER } });
    await invoke('delete', '/users/:userId', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    // The deactivation UPDATE lives in db.execute — must not have run either.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('400s when reassignToUserId equals the user being removed', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_A, name: 'X', email: 'x@growthescalators.com' }]));
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: false }]));

    const { req, res, statusFn } = ownerReqRes({ body: { reassignToUserId: TARGET_ID } });
    await invoke('delete', '/users/:userId', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockReassignUserRecords).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GET /api/permissions/users — pending flag wiring
// ===========================================================================
describe('GET /api/permissions/users — pending flag', () => {
  it('LEFT JOINs user_invites so a pending user is derivable from the result set', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller isOwner check
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { req, res } = makeReqRes({ user: { id: OWNER_ID, tenantId: TENANT_A, role: 'admin' } });
    await invoke('get', '/users', req, res);

    const sqlText = compiledSql(mockExecute.mock.calls[0][0]);
    expect(sqlText).toMatch(/user_invites/i);
    expect(sqlText).toMatch(/pending/i);
  });
});
