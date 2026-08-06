import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level tests for src/routes/roles.ts — the NEW, not-yet-enforced RBAC
// foundation (roles / role_permissions / user_permission_overrides). Focus,
// per this PR's own review checklist: same-tenant scoping (IDOR) on every
// endpoint that takes an id, isOwner-gating on every write, unknown-
// permission-key rejection, and system-role protections (key/is_system
// immutable, can't delete, can't delete-with-members). Same db-mocking
// harness as src/__tests__/permissionsInviteSeatReassign.test.ts /
// billingRoutes.test.ts (a minimal thenable chain stand-in for the Drizzle
// query builder — no real SQL compiled, since the IDOR guards here are a
// fetch-by-id-then-compare-tenantId-in-JS pattern, not a WHERE-tenantId-at-
// the-SQL-level one; see roles.ts's own IDOR comments).

const { mockSelect, mockInsert, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    pool: { query: vi.fn() },
    ...schema,
  };
});

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import rolesRouter from '../routes/roles';

// ---------------------------------------------------------------------------
// Chain helpers — a minimal thenable stand-in for the Drizzle query builder.
// Every chain method returns the same object so any call sequence (.from(),
// .leftJoin()/.innerJoin(), .where(), .groupBy(), .orderBy(), .limit())
// resolves to the given rows once awaited, regardless of exactly which
// methods the route happens to call.
// ---------------------------------------------------------------------------
function chain(rows: unknown[], onWhere?: (cond: unknown) => void) {
  const c: Record<string, unknown> = {
    from: () => c,
    leftJoin: () => c,
    innerJoin: () => c,
    where: (cond: unknown) => { onWhere?.(cond); return c; },
    groupBy: () => c,
    orderBy: () => c,
    limit: () => c,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function insertChain(returnedRows: unknown[] = []) {
  const ret: Record<string, unknown> = {
    returning: () => ret,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(returnedRows).then(resolve, reject),
  };
  return { values: (..._args: unknown[]) => ret };
}

function updateChain(onWhere?: (cond: unknown) => void) {
  const w: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  };
  return { set: (..._args: unknown[]) => ({ where: (cond: unknown) => { onWhere?.(cond); return w; } }) };
}

function deleteChain(onWhere?: (cond: unknown) => void) {
  const w: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  };
  return { where: (cond: unknown) => { onWhere?.(cond); return w; } };
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
  const layer = (rolesRouter as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    await item.handle(req, res, (err?: unknown) => { if (err) throw err; });
  }
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_USER_ID = '44444444-4444-4444-8444-444444444444';
const SYSTEM_ROLE_ID = '55555555-5555-4555-8555-555555555555';

function ownerReq(overrides: Record<string, unknown> = {}) {
  return makeReqRes({ user: { id: OWNER_ID, tenantId: TENANT_A, role: 'admin' }, ...overrides });
}
function staffReq(overrides: Record<string, unknown> = {}) {
  return makeReqRes({ user: { id: STAFF_ID, tenantId: TENANT_A, role: 'staff' }, ...overrides });
}

// resetAllMocks (not clearAllMocks) — several tests below queue a
// mockReturnValueOnce chain that a short-circuiting route handler never
// consumes (e.g. a validation failure that returns before reaching a later
// DB call). clearAllMocks only wipes call history, not queued
// once-implementations, so leftover queue entries would otherwise leak into
// the next test's first DB call and silently desync it. resetAllMocks wipes
// the queue too, so every test starts from a truly clean slate.
beforeEach(() => vi.resetAllMocks());

// ---------------------------------------------------------------------------
// GET /api/roles
// ---------------------------------------------------------------------------
describe('GET /api/roles', () => {
  it('lists roles for the caller\'s tenant with member counts', async () => {
    mockSelect.mockReturnValueOnce(chain([
      { id: ROLE_ID, tenantId: TENANT_A, key: 'admin', name: 'Admin', description: null, isSystem: true, createdAt: new Date(), updatedAt: new Date(), memberCount: 3 },
    ]));
    const { req, res, jsonFn } = staffReq();
    await invoke('get', '/', req, res);
    expect(jsonFn).toHaveBeenCalledWith({ roles: [expect.objectContaining({ key: 'admin', memberCount: 3 })] });
  });
});

// ---------------------------------------------------------------------------
// GET /api/roles/registry
// ---------------------------------------------------------------------------
describe('GET /api/roles/registry', () => {
  it('returns the real permission registry grouped by module, with no DB call', async () => {
    const { req, res, jsonFn } = staffReq();
    await invoke('get', '/registry', req, res);
    expect(mockSelect).not.toHaveBeenCalled();
    const payload = jsonFn.mock.calls[0][0] as { modules: Array<{ module: string; permissions: unknown[] }> };
    expect(Array.isArray(payload.modules)).toBe(true);
    expect(payload.modules.length).toBeGreaterThan(0);
    expect(payload.modules.some((m) => m.module === 'Contacts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/roles/users
// ---------------------------------------------------------------------------
describe('GET /api/roles/users', () => {
  it('merges user rows with override counts', async () => {
    mockSelect
      .mockReturnValueOnce(chain([
        { id: TARGET_USER_ID, name: 'Sneha', email: 'sneha@x.com', legacyRole: 'staff', roleId: ROLE_ID, roleName: 'Admin', isActive: true },
      ]))
      .mockReturnValueOnce(chain([{ userId: TARGET_USER_ID, count: 2 }]));
    const { req, res, jsonFn } = staffReq();
    await invoke('get', '/users', req, res);
    expect(jsonFn).toHaveBeenCalledWith({
      users: [expect.objectContaining({ id: TARGET_USER_ID, overrideCount: 2 })],
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/roles
// ---------------------------------------------------------------------------
describe('POST /api/roles', () => {
  it('403s for a non-owner', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: false }])); // getPerms
    const { req, res, statusFn } = staffReq({ body: { key: 'x', name: 'X', permissions: [] } });
    await invoke('post', '/', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('400s on an unknown permission key, and never inserts', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }])); // getPerms
    const { req, res, statusFn, jsonFn } = ownerReq({
      body: { key: 'custom_role', name: 'Custom', permissions: ['contacts.view', 'not.a.real.key'] },
    });
    await invoke('post', '/', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn.mock.calls[0][0].error).toContain('not.a.real.key');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('400s on a malformed key', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReq({ body: { key: 'Not A Valid Key!', name: 'X', permissions: [] } });
    await invoke('post', '/', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('409s when a role with the same key already exists for this tenant', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }])) // getPerms
      .mockReturnValueOnce(chain([{ id: 'existing-role' }])); // duplicate-key pre-check
    const { req, res, statusFn } = ownerReq({ body: { key: 'sales_lead', name: 'Sales Lead', permissions: [] } });
    await invoke('post', '/', req, res);
    expect(statusFn).toHaveBeenCalledWith(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('creates a custom role (is_system: false) and inserts its permission set', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }])) // getPerms
      .mockReturnValueOnce(chain([])); // no existing role with this key
    const createdRole = { id: 'new-role-id', tenantId: TENANT_A, key: 'sales_lead', name: 'Sales Lead', description: null, isSystem: false };
    const rolesInsert = insertChain([createdRole]);
    const rolePermsInsert = insertChain([]);
    mockInsert.mockReturnValueOnce(rolesInsert).mockReturnValueOnce(rolePermsInsert);

    const { req, res, statusFn, jsonFn } = ownerReq({
      body: { key: 'sales_lead', name: 'Sales Lead', permissions: ['contacts.view', 'contacts.view'] },
    });
    await invoke('post', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(201);
    expect(jsonFn.mock.calls[0][0]).toEqual({
      role: expect.objectContaining({ key: 'sales_lead', isSystem: false, permissions: ['contacts.view'] }),
    });
  });
});

// ---------------------------------------------------------------------------
// GET / PUT /api/roles/users/:userId/permission-overrides
// ---------------------------------------------------------------------------
describe('GET /api/roles/users/:userId/permission-overrides', () => {
  it('404s for a user belonging to a different tenant', async () => {
    mockSelect.mockReturnValueOnce(chain([{ tenantId: TENANT_B }]));
    const { req, res, statusFn } = staffReq({ params: { userId: TARGET_USER_ID } });
    await invoke('get', '/users/:userId/permission-overrides', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('200s with the override list for a same-tenant user', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ tenantId: TENANT_A }]))
      .mockReturnValueOnce(chain([{ id: 'ov-1', userId: TARGET_USER_ID, permission: 'billing.mrr.view', effect: 'grant' }]));
    const { req, res, jsonFn } = staffReq({ params: { userId: TARGET_USER_ID } });
    await invoke('get', '/users/:userId/permission-overrides', req, res);
    expect(jsonFn).toHaveBeenCalledWith({ overrides: [expect.objectContaining({ permission: 'billing.mrr.view' })] });
  });
});

describe('PUT /api/roles/users/:userId/permission-overrides', () => {
  it('403s for a non-owner, before touching the DB target-user lookup', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: false }]));
    const { req, res, statusFn } = staffReq({ params: { userId: TARGET_USER_ID }, body: { overrides: [] } });
    await invoke('put', '/users/:userId/permission-overrides', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('400s on an unknown permission key in the overrides array', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReq({
      params: { userId: TARGET_USER_ID },
      body: { overrides: [{ permission: 'not.a.real.key', effect: 'grant' }] },
    });
    await invoke('put', '/users/:userId/permission-overrides', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('400s on an invalid effect value', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReq({
      params: { userId: TARGET_USER_ID },
      body: { overrides: [{ permission: 'contacts.view', effect: 'allow' }] },
    });
    await invoke('put', '/users/:userId/permission-overrides', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('400s on a duplicate permission within the same request', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReq({
      params: { userId: TARGET_USER_ID },
      body: { overrides: [{ permission: 'contacts.view', effect: 'grant' }, { permission: 'contacts.view', effect: 'revoke' }] },
    });
    await invoke('put', '/users/:userId/permission-overrides', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('404s (and never writes) for a target user in a different tenant', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ tenantId: TENANT_B }]));
    const { req, res, statusFn } = ownerReq({
      params: { userId: TARGET_USER_ID },
      body: { overrides: [{ permission: 'contacts.view', effect: 'grant' }] },
    });
    await invoke('put', '/users/:userId/permission-overrides', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('replaces the full override set for a same-tenant user', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ tenantId: TENANT_A }]))
      .mockReturnValueOnce(chain([{ id: 'ov-1', userId: TARGET_USER_ID, permission: 'contacts.view', effect: 'grant' }]));
    mockDelete.mockReturnValueOnce(deleteChain());
    mockInsert.mockReturnValueOnce(insertChain([]));

    const { req, res, jsonFn } = ownerReq({
      params: { userId: TARGET_USER_ID },
      body: { overrides: [{ permission: 'contacts.view', effect: 'grant' }] },
    });
    await invoke('put', '/users/:userId/permission-overrides', req, res);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(jsonFn).toHaveBeenCalledWith({ overrides: [expect.objectContaining({ permission: 'contacts.view' })] });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/roles/users/:userId/role — NEW system's role assignment
// ---------------------------------------------------------------------------
describe('PATCH /api/roles/users/:userId/role', () => {
  it('403s for a non-owner', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: false }]));
    const { req, res, statusFn } = staffReq({ params: { userId: TARGET_USER_ID }, body: { roleId: ROLE_ID } });
    await invoke('patch', '/users/:userId/role', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the role belongs to a different tenant', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_B }]));
    const { req, res, statusFn } = ownerReq({ params: { userId: TARGET_USER_ID }, body: { roleId: ROLE_ID } });
    await invoke('patch', '/users/:userId/role', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the target user belongs to a different tenant', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_A }]))
      .mockReturnValueOnce(chain([{ tenantId: TENANT_B }]));
    const { req, res, statusFn } = ownerReq({ params: { userId: TARGET_USER_ID }, body: { roleId: ROLE_ID } });
    await invoke('patch', '/users/:userId/role', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('assigns the role for a same-tenant role + user pair', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_A }]))
      .mockReturnValueOnce(chain([{ tenantId: TENANT_A }]));
    mockUpdate.mockReturnValueOnce(updateChain());

    const { req, res, jsonFn } = ownerReq({ params: { userId: TARGET_USER_ID }, body: { roleId: ROLE_ID } });
    await invoke('patch', '/users/:userId/role', req, res);
    expect(jsonFn).toHaveBeenCalledWith({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// GET /api/roles/:roleId
// ---------------------------------------------------------------------------
describe('GET /api/roles/:roleId', () => {
  it('404s for a role belonging to a different tenant', async () => {
    mockSelect.mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_B }]));
    const { req, res, statusFn } = staffReq({ params: { roleId: ROLE_ID } });
    await invoke('get', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('200s with the full permission list for a same-tenant role', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_A, key: 'sales', name: 'Sales', isSystem: true }]))
      .mockReturnValueOnce(chain([{ permission: 'contacts.view' }, { permission: 'deals.view' }]));
    const { req, res, jsonFn } = staffReq({ params: { roleId: ROLE_ID } });
    await invoke('get', '/:roleId', req, res);
    expect(jsonFn).toHaveBeenCalledWith({
      role: expect.objectContaining({ key: 'sales', permissions: ['contacts.view', 'deals.view'] }),
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/roles/:roleId
// ---------------------------------------------------------------------------
describe('PATCH /api/roles/:roleId', () => {
  it('403s for a non-owner', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: false }]));
    const { req, res, statusFn } = staffReq({ params: { roleId: ROLE_ID }, body: { name: 'New Name' } });
    await invoke('patch', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
  });

  it('400s if the body includes `key`, even alongside other valid fields', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn, jsonFn } = ownerReq({ params: { roleId: ROLE_ID }, body: { key: 'new_key', name: 'New Name' } });
    await invoke('patch', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn.mock.calls[0][0].error).toMatch(/key and is_system/);
  });

  it('400s if the body includes `isSystem`', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReq({ params: { roleId: ROLE_ID }, body: { isSystem: false } });
    await invoke('patch', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('404s for a role belonging to a different tenant', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_B }]));
    const { req, res, statusFn } = ownerReq({ params: { roleId: ROLE_ID }, body: { name: 'X' } });
    await invoke('patch', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('400s on an unknown permission key in the replacement set (before ever fetching the role)', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: true }]));
    const { req, res, statusFn } = ownerReq({ params: { roleId: ROLE_ID }, body: { permissions: ['contacts.view', 'bogus.key'] } });
    await invoke('patch', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('allows editing a SYSTEM role\'s permission set (only key/is_system are locked)', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }])) // getPerms
      .mockReturnValueOnce(chain([{ id: SYSTEM_ROLE_ID, tenantId: TENANT_A, key: 'admin', isSystem: true }])) // role lookup
      .mockReturnValueOnce(chain([{ id: SYSTEM_ROLE_ID, tenantId: TENANT_A, key: 'admin', name: 'Admin', isSystem: true }])) // re-fetch after update
      .mockReturnValueOnce(chain([{ permission: 'billing.mrr.view' }])); // re-fetch permissions
    // No mockUpdate queued: the body only sets `permissions`, so `updates`
    // stays empty and the `db.update(roles)...` branch is never reached.
    mockDelete.mockReturnValueOnce(deleteChain());
    mockInsert.mockReturnValueOnce(insertChain([]));

    const { req, res, statusFn, jsonFn } = ownerReq({
      params: { roleId: SYSTEM_ROLE_ID },
      body: { permissions: ['billing.mrr.view'] },
    });
    await invoke('patch', '/:roleId', req, res);
    expect(statusFn).not.toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(jsonFn.mock.calls[0][0]).toEqual({
      role: expect.objectContaining({ isSystem: true, permissions: ['billing.mrr.view'] }),
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/roles/:roleId
// ---------------------------------------------------------------------------
describe('DELETE /api/roles/:roleId', () => {
  it('403s for a non-owner', async () => {
    mockSelect.mockReturnValueOnce(chain([{ isOwner: false }]));
    const { req, res, statusFn } = staffReq({ params: { roleId: ROLE_ID } });
    await invoke('delete', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
  });

  it('404s for a role belonging to a different tenant', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_B, isSystem: false }]));
    const { req, res, statusFn } = ownerReq({ params: { roleId: ROLE_ID } });
    await invoke('delete', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('400s and refuses to delete a system role', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: SYSTEM_ROLE_ID, tenantId: TENANT_A, isSystem: true, name: 'Admin' }]));
    const { req, res, statusFn, jsonFn } = ownerReq({ params: { roleId: SYSTEM_ROLE_ID } });
    await invoke('delete', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn.mock.calls[0][0].error).toMatch(/system roles cannot be deleted/);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('400s and names the blocker when the role still has members', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_A, isSystem: false, name: 'Sales Lead' }]))
      .mockReturnValueOnce(chain([{ id: 'u1' }, { id: 'u2' }])); // 2 members
    const { req, res, statusFn, jsonFn } = ownerReq({ params: { roleId: ROLE_ID } });
    await invoke('delete', '/:roleId', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn.mock.calls[0][0].error).toContain('Sales Lead');
    expect(jsonFn.mock.calls[0][0].error).toContain('2 member');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes a custom role with zero members', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ isOwner: true }]))
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_A, isSystem: false, name: 'Sales Lead' }]))
      .mockReturnValueOnce(chain([]));
    mockDelete.mockReturnValueOnce(deleteChain()).mockReturnValueOnce(deleteChain());

    const { req, res, jsonFn } = ownerReq({ params: { roleId: ROLE_ID } });
    await invoke('delete', '/:roleId', req, res);
    expect(mockDelete).toHaveBeenCalledTimes(2); // role_permissions, then roles
    expect(jsonFn).toHaveBeenCalledWith({ deleted: true });
  });
});

// ---------------------------------------------------------------------------
// GET /api/roles/:roleId/members
// ---------------------------------------------------------------------------
describe('GET /api/roles/:roleId/members', () => {
  it('404s for a role belonging to a different tenant', async () => {
    mockSelect.mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_B }]));
    const { req, res, statusFn } = staffReq({ params: { roleId: ROLE_ID } });
    await invoke('get', '/:roleId/members', req, res);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('200s with the member list for a same-tenant role', async () => {
    mockSelect
      .mockReturnValueOnce(chain([{ id: ROLE_ID, tenantId: TENANT_A }]))
      .mockReturnValueOnce(chain([{ id: TARGET_USER_ID, name: 'Sneha', email: 'sneha@x.com', role: 'staff', isActive: true }]));
    const { req, res, jsonFn } = staffReq({ params: { roleId: ROLE_ID } });
    await invoke('get', '/:roleId/members', req, res);
    expect(jsonFn).toHaveBeenCalledWith({ members: [expect.objectContaining({ name: 'Sneha' })] });
  });
});
