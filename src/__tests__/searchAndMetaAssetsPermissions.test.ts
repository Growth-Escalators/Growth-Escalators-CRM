// requirePerm wiring for src/routes/search.ts and src/routes/metaAssets.ts.
//
// search.ts: gated on 'contacts.view' as a baseline — there is no dedicated
// 'search.*' key (cross-module search spans contacts/deals/Wizmatch
// entities). Judgment call documented in src/routes/search.ts and the PR
// description, not re-litigated here.
//
// metaAssets.ts: gated on 'ads.view' — Facebook Pages/Business Manager data
// is part of the same Ads/Marketing registry module as src/routes/ads.ts,
// no separate 'meta_assets.*' key. This router ALSO has a pre-existing
// GE-tenant-only `router.use(...)` gate (see metaAdsGeOnlyGate.test.ts) —
// that's a router.use() layer with no `.route`, so it lives outside every
// individual route's `.route.stack` and doesn't interact with the
// requirePerm assertions below (same reasoning as linksPermissions.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

vi.mock('../db/index', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
  contacts: {}, deals: {},
  pool: { query: vi.fn().mockResolvedValue({ rows: [{ id: 'tenant-ge' }] }) },
}));

vi.mock('../utils/fetchWithRetry', () => ({
  fetchWithRetry: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }),
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
    query: { q: 'acme' },
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

describe('src/routes/search.ts — requirePerm wiring', () => {
  runPermissionBattery({
    getRouter: async () => (await import('../routes/search')).default,
    path: '/',
    method: 'get',
    permission: 'contacts.view',
  });
});

describe('src/routes/metaAssets.ts — requirePerm wiring', () => {
  runPermissionBattery({
    getRouter: async () => (await import('../routes/metaAssets')).metaAssetsRouter,
    path: '/pages',
    method: 'get',
    permission: 'ads.view',
  });
  runPermissionBattery({
    getRouter: async () => (await import('../routes/metaAssets')).metaAssetsRouter,
    path: '/businesses',
    method: 'get',
    permission: 'ads.view',
  });
  runPermissionBattery({
    getRouter: async () => (await import('../routes/metaAssets')).metaAssetsRouter,
    path: '/pages/:pageId/posts',
    method: 'get',
    permission: 'ads.view',
  });
});
