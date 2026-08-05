import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/routes/pipelines.ts's 13 routes were each wired with requirePerm(...)
// (this PR) — every route now requires one of the 3 pipeline.* registry
// keys (src/config/permissions.ts) before its real handler runs. Same
// coverage shape as contactsPermissionGating.test.ts — see that file's
// header for the full rationale. In short, these tests exercise ONLY the
// requirePerm gate for every wired route and prove:
//   1. exact-permission caller gets past the gate
//   2. no-permission caller is 403'd when PERMISSION_SHADOW_MODE is off
//   3. no-permission caller is let through (logged) when shadow mode is on
//   4. a resolver returning the full permission set (the isOwner shape)
//      gets through regardless of role
// requirePerm's own fail-closed contract and permissionResolver's isOwner
// logic are unit-tested elsewhere (requirePerm.test.ts,
// permissionResolver.test.ts) and not re-tested here.
//
// Note: GET /diagnose, POST /backfill-all, and POST /backfill-from-deals
// ALSO retain their existing inline `req.user.role !== 'admin'` gate inside
// the handler (see pipelinesDiagnoseTenantIsolation.test.ts) — requirePerm
// is an additional gate in front of that, not a replacement for it.

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

import pipelinesRouter from '../routes/pipelines';
import { ALL_PERMISSIONS } from '../config/permissions';

type RouteCase = { path: string; method: 'get' | 'post' | 'patch' | 'delete'; perm: string };

function gate(router: unknown, path: string, method: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  expect(stack.length).toBeGreaterThanOrEqual(2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stack[stack.length - 2].handle as (req: any, res: any, next: any) => Promise<void>;
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'u1', role: 'staff' }, method: 'GET', path: '/api/pipelines', ...overrides } as unknown as import('express').Request;
}

const ROUTES: RouteCase[] = [
  { path: '/diagnose', method: 'get', perm: 'pipeline.view' },
  { path: '/_health', method: 'get', perm: 'pipeline.view' },
  { path: '/', method: 'get', perm: 'pipeline.view' },
  { path: '/', method: 'post', perm: 'pipeline.manage' },
  { path: '/reorder', method: 'post', perm: 'pipeline.manage' },
  { path: '/duplicate/:id', method: 'post', perm: 'pipeline.manage' },
  { path: '/:id', method: 'delete', perm: 'pipeline.manage' },
  { path: '/:id', method: 'patch', perm: 'pipeline.manage' },
  { path: '/:id/stage-config', method: 'get', perm: 'pipeline.view' },
  { path: '/:id/analytics', method: 'get', perm: 'pipeline.view' },
  { path: '/:id/deals', method: 'get', perm: 'pipeline.view' },
  { path: '/backfill-all', method: 'post', perm: 'pipeline.backfill' },
  { path: '/backfill-from-deals', method: 'post', perm: 'pipeline.backfill' },
];

describe('pipelines.ts route-level requirePerm wiring', () => {
  const originalShadow = process.env.PERMISSION_SHADOW_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERMISSION_SHADOW_MODE;
  });

  afterEach(() => {
    if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
    else process.env.PERMISSION_SHADOW_MODE = originalShadow;
  });

  it('covers every GET/POST/PATCH/DELETE route registered on the router', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actual = (pipelinesRouter as any).stack
      .filter((l: any) => l.route)
      .flatMap((l: any) => Object.keys(l.route.methods).map((m) => `${m} ${l.route.path}`))
      .sort();
    const expected = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(actual).toEqual(expected);
  });

  describe.each(ROUTES)('$method $path -> requirePerm($perm)', ({ path, method, perm }) => {
    it('lets a caller with the exact required permission through', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set([perm]));
      const handler = gate(pipelinesRouter, path, method);
      const next = vi.fn();
      const res = makeRes();
      await handler(makeReq(), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('denies with 403 a caller without the permission when shadow mode is off', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const handler = gate(pipelinesRouter, path, method);
      const next = vi.fn();
      const res = makeRes();
      await handler(makeReq(), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('lets a caller without the permission through (logged, not blocked) when PERMISSION_SHADOW_MODE=true', async () => {
      process.env.PERMISSION_SHADOW_MODE = 'true';
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = gate(pipelinesRouter, path, method);
      const next = vi.fn();
      const res = makeRes();
      await handler(makeReq(), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('a tenant owner (resolver returns every registry permission, matching the isOwner bypass) gets through regardless of role', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(ALL_PERMISSIONS));
      const handler = gate(pipelinesRouter, path, method);
      const next = vi.fn();
      const res = makeRes();
      await handler(makeReq({ user: { id: 'owner-1', role: 'viewer' } }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
