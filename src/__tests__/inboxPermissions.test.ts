// requirePerm wiring for src/routes/inbox.ts — only the read/list routes
// are gated on 'inbox.view' in this PR, per the registry ('inbox.view' is
// the only inbox key that exists today). POST /conversations/:contactId/send,
// /send-template, and /read are deliberately left UNGATED here — see the
// comment block at the top of src/routes/inbox.ts and the PR description:
// the first two are real outbound WhatsApp sends with no 'inbox.send'-style
// key to map to, and /read is a state mutation that doesn't cleanly fit
// "viewing" either. This file only tests the four GET routes that ARE gated.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

vi.mock('../db/index', () => ({
  db: { select: vi.fn(), insert: vi.fn(), execute: vi.fn().mockResolvedValue({ rows: [] }) },
  messages: {}, contacts: {}, contactChannels: {}, waTemplates: {},
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

async function inboxRouter() { return (await import('../routes/inbox')).default; }

function runPermissionBattery(opts: {
  path: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  permission: string;
}) {
  const { path, method, permission } = opts;

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
      const mw = permMiddleware(await inboxRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      await mw(makeReq(), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).not.toBe(403);
    });

    it('403s a caller missing it when PERMISSION_SHADOW_MODE is unset', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const mw = permMiddleware(await inboxRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      await mw(makeReq(), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('passes a caller missing it through when PERMISSION_SHADOW_MODE=true', async () => {
      process.env.PERMISSION_SHADOW_MODE = 'true';
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      const mw = permMiddleware(await inboxRouter(), path, method);
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
      const mw = permMiddleware(await inboxRouter(), path, method);
      const next = vi.fn();
      const res = mockRes();
      await mw(makeReq({ user: { id: 'owner-1', role: 'staff', tenantId: 'tenant-a' } }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).not.toBe(403);
    });
  });
}

describe('src/routes/inbox.ts — requirePerm wiring', () => {
  runPermissionBattery({ path: '/conversations', method: 'get', permission: 'inbox.view' });
  runPermissionBattery({ path: '/conversations/:contactId/messages', method: 'get', permission: 'inbox.view' });
  runPermissionBattery({ path: '/templates', method: 'get', permission: 'inbox.view' });
  runPermissionBattery({ path: '/unread-count', method: 'get', permission: 'inbox.view' });
});

describe('src/routes/inbox.ts — send/reply routes intentionally left ungated', () => {
  it('POST /conversations/:contactId/send has no permission middleware in front of the handler', async () => {
    const router = await inboxRouter();
    const layer = router.stack.find((l: any) => l.route?.path === '/conversations/:contactId/send' && l.route?.methods?.post);
    expect(layer!.route!.stack).toHaveLength(1); // handler only — no requirePerm
  });

  it('POST /conversations/:contactId/send-template has no permission middleware in front of the handler', async () => {
    const router = await inboxRouter();
    const layer = router.stack.find((l: any) => l.route?.path === '/conversations/:contactId/send-template' && l.route?.methods?.post);
    expect(layer!.route!.stack).toHaveLength(1);
  });

  it('POST /conversations/:contactId/read has no permission middleware in front of the handler', async () => {
    const router = await inboxRouter();
    const layer = router.stack.find((l: any) => l.route?.path === '/conversations/:contactId/read' && l.route?.methods?.post);
    expect(layer!.route!.stack).toHaveLength(1);
  });
});
