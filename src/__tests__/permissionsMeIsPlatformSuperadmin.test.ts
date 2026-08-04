import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/permissions/me now also exposes `isPlatformSuperadmin`, read fresh
// from `users.isPlatformSuperadmin` for the CALLING user only (never as part
// of any listing of other users) — same fail-closed, read-fresh-from-DB
// reasoning as requirePlatformSuperadmin itself (src/middleware/rbac.ts).
// This is what lets the admin frontend gate the new "Provision Tenant" nav
// entry + page (admin/src/components/navEntries.js, admin/src/pages/
// ProvisionTenantPage.jsx) on the caller's own superadmin flag.
//
// `permissions.ts` runs `db.execute(...)` at module top level (idempotent
// ensure-column ALTERs) — the mock fns must exist before that import runs,
// hence `vi.hoisted` rather than a plain `const`, same as
// src/__tests__/tenantIsolationIDOR.test.ts.
const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      execute: (...args: unknown[]) => mockExecute(...args),
    },
    pool: { query: vi.fn() },
    users: schema.users,
    userPermissions: schema.userPermissions,
  };
});

import permissionsRouter from '../routes/permissions';

// Thenable chain — `from`/`where`/`limit` all return the same object, and it
// resolves via `.then` so a bare `await db.select(...).from(...).where(...).limit(1)`
// works regardless of chain depth. Same helper shape as tenantIsolationIDOR.test.ts.
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

function makeReqRes(user: Record<string, unknown>) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = { user, params: {}, query: {}, body: {} };
  const res = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke(router: any, path: string, req: unknown, res: unknown) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.get); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!layer) throw new Error(`route not found: GET ${path}`);
  for (const item of layer.route.stack) {
    await item.handle(req, res, (err?: unknown) => { if (err) throw err; });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [] });
});

describe('GET /api/permissions/me — isPlatformSuperadmin', () => {
  it('includes isPlatformSuperadmin: true for a flagged user, alongside their existing permissions row', async () => {
    mockSelect
      .mockReturnValueOnce(resultChain([{ isPlatformSuperadmin: true }])) // users lookup
      .mockReturnValueOnce(resultChain([{ isOwner: true, contactsView: true }])); // userPermissions lookup

    const { req, res, jsonFn } = makeReqRes({ id: 'user-1', tenantId: 'tenant-1', role: 'admin' });
    await invoke(permissionsRouter, '/me', req, res);

    expect(jsonFn).toHaveBeenCalledWith({ permissions: expect.objectContaining({
      isOwner: true,
      contactsView: true,
      isPlatformSuperadmin: true,
    }) });
  });

  it('defaults to isPlatformSuperadmin: false for an unflagged user', async () => {
    mockSelect
      .mockReturnValueOnce(resultChain([{ isPlatformSuperadmin: false }]))
      .mockReturnValueOnce(resultChain([{ isOwner: false }]));

    const { req, res, jsonFn } = makeReqRes({ id: 'user-2', tenantId: 'tenant-1', role: 'staff' });
    await invoke(permissionsRouter, '/me', req, res);

    expect(jsonFn).toHaveBeenCalledWith({ permissions: expect.objectContaining({ isPlatformSuperadmin: false }) });
  });

  it('defaults to isPlatformSuperadmin: false when the users lookup returns no row (defensive)', async () => {
    mockSelect
      .mockReturnValueOnce(resultChain([])) // users lookup misses
      .mockReturnValueOnce(resultChain([])); // no userPermissions row either

    const { req, res, jsonFn } = makeReqRes({ id: 'ghost-user', tenantId: 'tenant-1', role: 'staff' });
    await invoke(permissionsRouter, '/me', req, res);

    expect(jsonFn).toHaveBeenCalledWith({ permissions: expect.objectContaining({
      isOwner: false,
      isPlatformSuperadmin: false,
    }) });
  });
});
