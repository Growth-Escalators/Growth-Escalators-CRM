// requirePerm wiring for src/routes/tasks.ts, taskAttachments.ts, and
// task-lists.ts — the three Tasks-module route files gated in this PR under
// the new 'tasks.*' registry keys (src/config/permissions.ts). Still in
// PERMISSION_SHADOW_MODE-first rollout: this proves the WIRING is correct
// (right key on the right route), not that shadow mode is flipped on in
// prod — see requirePerm.test.ts for the middleware's own unit tests and
// permissionResolver.test.ts for the isOwner-bypass resolver logic itself.
//
// Each battery below invokes the FIRST middleware registered on the route
// (requirePerm is always mounted first, ahead of any other per-route
// middleware such as multer) directly, rather than running the whole
// handler — that keeps these tests focused purely on "is this route gated
// by the right permission key", decoupled from unrelated business-logic
// changes (Slack DMs, file uploads, SQL shape, etc.) that other lanes may
// make to the same handlers later.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

vi.mock('../services/slackService', () => ({
  sendSlackDM: vi.fn().mockResolvedValue(true),
  MEMBER_MAP: {},
}));

// task-lists.ts fires a handful of `db.execute(sql\`...\`).catch(() => {})`
// runtime ensure-table calls at MODULE LOAD time — db.execute must resolve
// to something with a .catch, or import() itself throws.
const mockDbExecute = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  tasks: {}, contacts: {}, deals: {}, taskChecklistItems: {}, users: {}, taskLists: {},
}));

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

function permMiddleware(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (e?: unknown) => void) => Promise<void>;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', role: 'staff', tenantId: 'tenant-a' },
    method: 'GET',
    path: '/x',
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as any;
}

function runPermissionBattery(opts: {
  getRouter: () => Promise<any>;
  path: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  permission: string;
}) {
  const { getRouter, path, method, permission } = opts;

  describe(`${method.toUpperCase()} ${path} — requires '${permission}'`, () => {
    const originalShadow = process.env.PERMISSION_SHADOW_MODE;

    beforeEach(() => {
      vi.clearAllMocks();
      delete process.env.PERMISSION_SHADOW_MODE;
      mockDbExecute.mockResolvedValue({ rows: [] });
    });

    afterEach(() => {
      if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
      else process.env.PERMISSION_SHADOW_MODE = originalShadow;
    });

    it('allows a caller whose effective permissions include it', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set([permission]));
      const mw = permMiddleware(await getRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      await mw(makeReq(), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).not.toBe(403);
    });

    it('403s a caller missing it when PERMISSION_SHADOW_MODE is unset', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const mw = permMiddleware(await getRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      await mw(makeReq(), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('passes a caller missing it through when PERMISSION_SHADOW_MODE=true', async () => {
      process.env.PERMISSION_SHADOW_MODE = 'true';
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const mw = permMiddleware(await getRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await mw(makeReq(), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).not.toBe(403);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('isOwner-equivalent (full effective permission set) is allowed regardless of role', async () => {
      const { ALL_PERMISSIONS } = await import('../config/permissions');
      mockGetEffectivePermissions.mockResolvedValue(new Set(ALL_PERMISSIONS));
      const mw = permMiddleware(await getRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      // permissionResolver's isOwner bypass returns the full registry set
      // unconditionally — this proves the route wiring honours that,
      // deliberately paired with a low-privilege role to show the bypass
      // isn't gated on role at this layer.
      await mw(makeReq({ user: { id: 'owner-1', role: 'staff', tenantId: 'tenant-a' } }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).not.toBe(403);
    });
  });
}

async function tasksRouter() { return (await import('../routes/tasks')).default; }
async function taskAttachmentsRouter() { return (await import('../routes/taskAttachments')).default; }
async function taskListsRouter() { return (await import('../routes/task-lists')).default; }

describe('src/routes/tasks.ts — requirePerm wiring', () => {
  runPermissionBattery({ getRouter: tasksRouter, path: '/', method: 'get', permission: 'tasks.view' });
  runPermissionBattery({ getRouter: tasksRouter, path: '/', method: 'post', permission: 'tasks.create' });
  runPermissionBattery({ getRouter: tasksRouter, path: '/:id', method: 'patch', permission: 'tasks.edit' });
  runPermissionBattery({ getRouter: tasksRouter, path: '/:id', method: 'delete', permission: 'tasks.delete' });
  runPermissionBattery({ getRouter: tasksRouter, path: '/bulk-status', method: 'post', permission: 'tasks.bulk' });
});

describe('src/routes/taskAttachments.ts — requirePerm wiring', () => {
  runPermissionBattery({ getRouter: taskAttachmentsRouter, path: '/:id/attachments', method: 'get', permission: 'tasks.view' });
  runPermissionBattery({ getRouter: taskAttachmentsRouter, path: '/:id/attachments', method: 'post', permission: 'tasks.edit' });
});

describe('src/routes/task-lists.ts — requirePerm wiring', () => {
  // Only one key exists for this whole file (no separate 'tasks.lists.view'),
  // so even the GET route is gated on 'tasks.lists.manage'.
  runPermissionBattery({ getRouter: taskListsRouter, path: '/', method: 'get', permission: 'tasks.lists.manage' });
  runPermissionBattery({ getRouter: taskListsRouter, path: '/', method: 'post', permission: 'tasks.lists.manage' });
});
