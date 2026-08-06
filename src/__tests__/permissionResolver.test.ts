import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same disambiguation trick used throughout this file: each of
// permissionResolver's 4 possible db.select(...) calls asks for a distinct
// set of field names, so the mock can dispatch on Object.keys(fields) alone
// without needing to inspect the (unmocked, real) `eq(...)` where-clause.
type Row = Record<string, unknown>;

let ownerRows: Row[] = [];
let userRows: Row[] = [];
let rolePermRows: Row[] = [];
let overrideRows: Row[] = [];
let throwOnSelect = false;

const mockDbSelect = vi.fn((fields: Record<string, unknown>) => {
  if (throwOnSelect) throw new Error('connection reset');
  const keys = Object.keys(fields).sort().join(',');
  let rows: Row[] = [];
  if (keys === 'isOwner') rows = ownerRows;
  else if (keys === 'roleId') rows = userRows;
  else if (keys === 'permission') rows = rolePermRows;
  else if (keys === 'effect,permission') rows = overrideRows;
  const wherePromise = Object.assign(Promise.resolve(rows), { limit: vi.fn(() => Promise.resolve(rows)) });
  return { from: vi.fn(() => ({ where: vi.fn(() => wherePromise) })) };
});

vi.mock('../db/index', () => ({
  db: { select: (fields: Record<string, unknown>) => mockDbSelect(fields) },
  users: { id: 'id', roleId: 'role_id' },
  roles: { id: 'id' },
  rolePermissions: { roleId: 'role_id', permission: 'permission' },
  userPermissionOverrides: { userId: 'user_id', permission: 'permission', effect: 'effect' },
  userPermissions: { userId: 'user_id', isOwner: 'is_owner' },
}));

describe('getEffectivePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ownerRows = [];
    userRows = [];
    rolePermRows = [];
    overrideRows = [];
    throwOnSelect = false;
  });

  it('resolves to exactly the role\'s permissions when there are no overrides', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }, { permission: 'deals.view' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect([...effective].sort()).toEqual(['contacts.view', 'deals.view']);
  });

  it('a grant override ADDS a permission the role does not have', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }];
    overrideRows = [{ permission: 'contacts.export', effect: 'grant' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect(effective.has('contacts.export')).toBe(true);
    expect(effective.has('contacts.view')).toBe(true);
  });

  it('a revoke override REMOVES a permission the role does have', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }, { permission: 'contacts.delete' }];
    overrideRows = [{ permission: 'contacts.delete', effect: 'revoke' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect(effective.has('contacts.delete')).toBe(false);
    expect(effective.has('contacts.view')).toBe(true);
  });

  it('a revoke override for a permission not granted by the role is a harmless no-op', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }];
    overrideRows = [{ permission: 'contacts.delete', effect: 'revoke' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect(effective.has('contacts.delete')).toBe(false);
    expect(effective.has('contacts.view')).toBe(true);
  });

  it('isOwner bypasses roles/overrides entirely and grants every permission in the registry, unconditionally', async () => {
    ownerRows = [{ isOwner: true }];
    // Deliberately leave userRows/rolePermRows empty — isOwner must not
    // require the user to even have a role assigned.
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const { ALL_PERMISSIONS } = await import('../config/permissions');
    const effective = await getEffectivePermissions('owner-1');
    expect(effective.size).toBe(ALL_PERMISSIONS.length);
    expect(effective.has('settings.team.deactivate')).toBe(true);
    expect(effective.has('billing.invoices.delete')).toBe(true);
  });

  it('a user with no role_id and no overrides resolves to an empty permission set (not a crash)', async () => {
    userRows = [{ roleId: null }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect(effective.size).toBe(0);
  });

  it('ignores an unrecognised permission string stored in role_permissions (fail closed, not a crash)', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }, { permission: 'some.deleted.key' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect([...effective]).toEqual(['contacts.view']);
  });

  it('ignores an unrecognised permission string in an override row too', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [];
    overrideRows = [{ permission: 'not.a.real.permission', effect: 'grant' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    const effective = await getEffectivePermissions('user-1');
    expect(effective.size).toBe(0);
  });

  it('fails closed (rejects, does not swallow the error) when the DB call throws', async () => {
    throwOnSelect = true;
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    await expect(getEffectivePermissions('user-1')).rejects.toThrow('connection reset');
  });

  it('does not cache a failed resolution — a subsequent successful call still hits the DB and succeeds', async () => {
    throwOnSelect = true;
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    await expect(getEffectivePermissions('user-1')).rejects.toThrow();

    throwOnSelect = false;
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }];
    const effective = await getEffectivePermissions('user-1');
    expect(effective.has('contacts.view')).toBe(true);
  });

  it('caches the result for the TTL window — a second call within it does not re-query the DB', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    await getEffectivePermissions('user-1');
    const callsAfterFirst = mockDbSelect.mock.calls.length;
    await getEffectivePermissions('user-1');
    expect(mockDbSelect.mock.calls.length).toBe(callsAfterFirst);
  });

  it('caches per-user — a different userId still triggers a fresh resolution', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }];
    const { getEffectivePermissions } = await import('../services/permissionResolver');
    await getEffectivePermissions('user-1');
    const callsAfterFirst = mockDbSelect.mock.calls.length;
    await getEffectivePermissions('user-2');
    expect(mockDbSelect.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe('hasEffectivePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ownerRows = [];
    userRows = [];
    rolePermRows = [];
    overrideRows = [];
    throwOnSelect = false;
  });

  it('returns true/false based on the effective set', async () => {
    userRows = [{ roleId: 'role-1' }];
    rolePermRows = [{ permission: 'contacts.view' }];
    const { hasEffectivePermission } = await import('../services/permissionResolver');
    expect(await hasEffectivePermission('user-1', 'contacts.view')).toBe(true);
    expect(await hasEffectivePermission('user-1', 'contacts.delete')).toBe(false);
  });
});
