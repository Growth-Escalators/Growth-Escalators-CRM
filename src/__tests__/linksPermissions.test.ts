// requirePerm wiring for src/routes/links.ts (admin short-link CRUD) — new
// 'links.view' / 'links.manage' registry keys added in this PR alongside
// the Tasks keys (src/config/permissions.ts). The public /s/:slug redirect
// (src/routes/shortLinks.ts) is a SEPARATE, intentionally-unauthenticated
// router and is untouched here.
//
// Same approach as tasksPermissions.test.ts: invoke the route's first
// middleware (requirePerm) directly rather than the full handler, so these
// tests stay focused on permission wiring and don't churn on unrelated
// shortLinksDb changes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/shortLinksDb', () => ({
  lookupShortLinkDb: vi.fn().mockResolvedValue(null),
  listShortLinksDb: vi.fn().mockResolvedValue([]),
  createShortLinkDb: vi.fn(),
  updateShortLinkDb: vi.fn(),
  deleteShortLinkDb: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

// links.ts also mounts its own `router.use(requireAuth)` (mocked above to a
// pass-through), but router.use() layers have no `.route` and live outside
// any specific route's `.route.stack` — so requirePerm is still stack[0] on
// each individual route below, same as every other file in this PR.
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
  path: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  permission: string;
}) {
  const { path, method, permission } = opts;

  async function getRouter() { return (await import('../routes/links')).default; }

  describe(`${method.toUpperCase()} ${path} — requires '${permission}'`, () => {
    const originalShadow = process.env.PERMISSION_SHADOW_MODE;

    beforeEach(() => {
      vi.clearAllMocks();
      delete process.env.PERMISSION_SHADOW_MODE;
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
      await mw(makeReq({ user: { id: 'owner-1', role: 'staff', tenantId: 'tenant-a' } }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).not.toBe(403);
    });
  });
}

describe('src/routes/links.ts — requirePerm wiring', () => {
  runPermissionBattery({ path: '/', method: 'get', permission: 'links.view' });
  runPermissionBattery({ path: '/:slug', method: 'get', permission: 'links.view' });
  runPermissionBattery({ path: '/create', method: 'post', permission: 'links.manage' });
  runPermissionBattery({ path: '/:slug', method: 'patch', permission: 'links.manage' });
  runPermissionBattery({ path: '/:slug', method: 'delete', permission: 'links.manage' });
});
