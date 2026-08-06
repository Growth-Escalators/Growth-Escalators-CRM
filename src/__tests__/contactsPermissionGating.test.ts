import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// src/routes/contacts.ts's 20 routes were each wired with requirePerm(...)
// (this PR) — every route now requires one of the 7 contacts.* registry
// keys (src/config/permissions.ts) before its real handler runs. These
// tests exercise ONLY the requirePerm gate itself — the middleware
// immediately before the final handler in each route's stack — for every
// wired route, proving the four properties the rollout depends on:
//   1. a caller who genuinely holds the required permission gets past the
//      gate (next() called, response untouched)
//   2. a caller who lacks it is denied 403 when PERMISSION_SHADOW_MODE is
//      unset/false
//   3. a caller who lacks it is let through anyway (logged, not blocked)
//      when PERMISSION_SHADOW_MODE=true — the deliberate rollout safety net
//   4. a resolver that returns the FULL permission set — exactly what
//      permissionResolver.ts's isOwner bypass produces (see
//      permissionResolver.test.ts's "isOwner bypasses roles/overrides
//      entirely" case) — always gets through, regardless of the caller's
//      role or which single key the route requires
//
// requirePerm's OWN fail-closed contract (401/unknown-key/db-error
// handling) is already fully unit-tested in requirePerm.test.ts and is not
// re-tested here. permissionResolver's isOwner/role/override resolution
// logic is unit-tested in permissionResolver.test.ts. This file only proves
// the WIRING: the right route requires the right key. Business-logic
// correctness of each handler (tenant scoping, validation, etc.) is
// unchanged by this PR and already covered elsewhere (e.g.
// contactsTenantScoping.test.ts).

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

import contactsRouter from '../routes/contacts';
import { ALL_PERMISSIONS } from '../config/permissions';

type RouteCase = { path: string; method: 'get' | 'post' | 'patch' | 'delete'; perm: string };

function gate(router: unknown, path: string, method: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  expect(stack.length).toBeGreaterThanOrEqual(2);
  // requirePerm is wired as the middleware immediately before the final
  // handler on every route in this file (router.METHOD(path, requirePerm(...), handler)).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stack[stack.length - 2].handle as (req: any, res: any, next: any) => Promise<void>;
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'u1', role: 'staff' }, method: 'GET', path: '/api/contacts', ...overrides } as unknown as import('express').Request;
}

const ROUTES: RouteCase[] = [
  { path: '/', method: 'get', perm: 'contacts.view' },
  { path: '/counts', method: 'get', perm: 'contacts.view' },
  { path: '/tags', method: 'get', perm: 'contacts.view' },
  { path: '/:id/conversation', method: 'get', perm: 'contacts.view' },
  { path: '/:id/notes', method: 'get', perm: 'contacts.view' },
  { path: '/:id/notes', method: 'post', perm: 'contacts.edit' },
  { path: '/:id/notes/:noteId', method: 'patch', perm: 'contacts.edit' },
  { path: '/:id/notes/:noteId', method: 'delete', perm: 'contacts.edit' },
  { path: '/:id', method: 'get', perm: 'contacts.view' },
  { path: '/:id/channels', method: 'get', perm: 'contacts.view' },
  { path: '/', method: 'post', perm: 'contacts.create' },
  { path: '/:id', method: 'patch', perm: 'contacts.edit' },
  { path: '/:id/channels', method: 'post', perm: 'contacts.edit' },
  { path: '/bulk-tag', method: 'post', perm: 'contacts.bulk' },
  { path: '/bulk-assign', method: 'post', perm: 'contacts.bulk' },
  { path: '/bulk-delete', method: 'post', perm: 'contacts.delete' },
  { path: '/bulk-email', method: 'post', perm: 'contacts.bulk' },
  { path: '/export', method: 'post', perm: 'contacts.export' },
  { path: '/import', method: 'post', perm: 'contacts.import' },
  { path: '/bulk-sequence', method: 'post', perm: 'contacts.bulk' },
];

describe('contacts.ts route-level requirePerm wiring', () => {
  const originalShadow = process.env.PERMISSION_SHADOW_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERMISSION_SHADOW_MODE;
  });

  afterEach(() => {
    if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
    else process.env.PERMISSION_SHADOW_MODE = originalShadow;
  });

  // Sanity check that the table above matches reality — catches a route
  // added/renamed in contacts.ts without a matching entry here.
  it('covers every GET/POST/PATCH/DELETE route registered on the router', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actual = (contactsRouter as any).stack
      .filter((l: any) => l.route)
      .flatMap((l: any) => Object.keys(l.route.methods).map((m) => `${m} ${l.route.path}`))
      .sort();
    const expected = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(actual).toEqual(expected);
  });

  describe.each(ROUTES)('$method $path -> requirePerm($perm)', ({ path, method, perm }) => {
    it('lets a caller with the exact required permission through', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set([perm]));
      const handler = gate(contactsRouter, path, method);
      const next = vi.fn();
      const res = makeRes();
      await handler(makeReq(), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('denies with 403 a caller without the permission when shadow mode is off', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const handler = gate(contactsRouter, path, method);
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
      const handler = gate(contactsRouter, path, method);
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
      const handler = gate(contactsRouter, path, method);
      const next = vi.fn();
      const res = makeRes();
      await handler(makeReq({ user: { id: 'owner-1', role: 'viewer' } }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
