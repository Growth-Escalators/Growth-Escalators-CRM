import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Proves src/routes/social.ts is correctly wired to requirePerm(...) on every
// route mounted under requireAuth (the `router` export). The OAuth redirect
// flow (`oauthRouter`, /api/social/oauth/*) is intentionally NOT gated here —
// it's mounted in src/index.ts WITHOUT requireAuth ("no auth — browser
// redirects can't send headers") and never populates req.user, so requirePerm
// cannot apply to it.
//
// See requirePerm.test.ts (middleware unit tests) and permissionResolver.test.ts
// (isOwner unit tests) for the underlying mechanics this file builds on.

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

const { mockSelect, mockInsert, mockUpdate } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    socialAccounts: schema.socialAccounts,
    socialPosts: schema.socialPosts,
  };
});

const mockGetFacebookLeadFormsStatus = vi.fn();
const mockSubscribeFacebookPageToLeadgen = vi.fn();
vi.mock('../services/facebookLeadForms', () => ({
  getFacebookLeadFormsStatus: (...args: unknown[]) => mockGetFacebookLeadFormsStatus(...args),
  subscribeFacebookPageToLeadgen: (...args: unknown[]) => mockSubscribeFacebookPageToLeadgen(...args),
}));

const mockUploadToR2 = vi.fn();
const mockDeleteFromR2 = vi.fn();
const mockListR2Objects = vi.fn();
const mockIsAllowedUploadContent = vi.fn();
vi.mock('../utils/r2', () => ({
  uploadToR2: (...args: unknown[]) => mockUploadToR2(...args),
  deleteFromR2: (...args: unknown[]) => mockDeleteFromR2(...args),
  listR2Objects: (...args: unknown[]) => mockListR2Objects(...args),
  isAllowedUploadContent: (...args: unknown[]) => mockIsAllowedUploadContent(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import socialRouter, { oauthRouter } from '../routes/social';
import { ALL_PERMISSIONS } from '../config/permissions';

function resultChain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    values: () => c,
    set: () => c,
    returning: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', tenantId: 'tenant-a', role: 'staff' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  return { json: jsonFn, status: statusFn } as any;
}

async function invoke(method: 'get' | 'post' | 'delete', path: string, req: any, res: any) {
  const layer = socialRouter.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route!.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

// Every route on the authenticated `router` export and the single registry
// key it must demand.
const ROUTES: Array<{ method: 'get' | 'post' | 'delete'; path: string; perm: string }> = [
  { method: 'get', path: '/accounts', perm: 'social.view' },
  { method: 'get', path: '/lead-forms/status', perm: 'social.view' },
  { method: 'post', path: '/lead-forms/accounts/:id/subscribe', perm: 'social.lead_forms.manage' },
  { method: 'post', path: '/accounts/connect-facebook', perm: 'social.connect' },
  { method: 'delete', path: '/accounts/:id', perm: 'social.connect' },
  { method: 'post', path: '/posts', perm: 'social.post' },
  { method: 'get', path: '/posts', perm: 'social.view' },
  { method: 'delete', path: '/posts/:id', perm: 'social.post' },
  { method: 'post', path: '/upload', perm: 'social.library.manage' },
  { method: 'get', path: '/calendar', perm: 'social.view' },
  { method: 'get', path: '/library', perm: 'social.view' },
  { method: 'delete', path: '/library/:key', perm: 'social.library.manage' },
];

describe('routes/social.ts — requirePerm wiring', () => {
  const originalShadow = process.env.PERMISSION_SHADOW_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERMISSION_SHADOW_MODE;
  });

  afterEach(() => {
    if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
    else process.env.PERMISSION_SHADOW_MODE = originalShadow;
  });

  describe('every authenticated route demands its exact registry key (denied when the effective set is empty)', () => {
    for (const { method, path, perm } of ROUTES) {
      it(`${method.toUpperCase()} ${path} requires '${perm}'`, async () => {
        mockGetEffectivePermissions.mockResolvedValue(new Set());
        const req = makeReq();
        const res = makeRes();

        await invoke(method, path, req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.status().json).toHaveBeenCalledWith(expect.objectContaining({ required: [perm] }));
        // The handler's own DB/service calls must never run for a denied request.
        expect(mockSelect).not.toHaveBeenCalled();
        expect(mockInsert).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockGetFacebookLeadFormsStatus).not.toHaveBeenCalled();
        expect(mockSubscribeFacebookPageToLeadgen).not.toHaveBeenCalled();
        expect(mockUploadToR2).not.toHaveBeenCalled();
        expect(mockDeleteFromR2).not.toHaveBeenCalled();
        expect(mockListR2Objects).not.toHaveBeenCalled();
      });
    }
  });

  describe('a granted permission succeeds', () => {
    it('GET /accounts (social.view) returns the account list', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['social.view']));
      mockSelect.mockReturnValueOnce(resultChain([{ id: 'acc-1', tenantId: 'tenant-a', accessToken: 'secret' }]));

      const req = makeReq();
      const res = makeRes();
      await invoke('get', '/accounts', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ accounts: [expect.objectContaining({ id: 'acc-1', accessToken: '[encrypted]' })] });
    });

    it('DELETE /accounts/:id (social.connect) deactivates the account', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['social.connect']));
      mockUpdate.mockReturnValueOnce(resultChain([]));

      const req = makeReq({ params: { id: 'acc-1' } });
      const res = makeRes();
      await invoke('delete', '/accounts/:id', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('POST /posts (social.post) schedules a future post without touching the publish path', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['social.post']));
      mockSelect.mockReturnValueOnce(resultChain([{ id: 'sa-1', tenantId: 'tenant-a', platform: 'facebook' }]));
      mockInsert.mockReturnValueOnce(resultChain([{ id: 'post-1', status: 'scheduled' }]));

      const req = makeReq({
        body: {
          socialAccountIds: ['sa-1'],
          content: 'hello world',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      const res = makeRes();
      await invoke('post', '/posts', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ posts: [expect.objectContaining({ id: 'post-1' })] });
    });

    it('DELETE /library/:key (social.library.manage) deletes the R2 object', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['social.library.manage']));
      mockDeleteFromR2.mockResolvedValueOnce(undefined);

      const req = makeReq({ params: { key: 'uploads/foo.png' } });
      const res = makeRes();
      await invoke('delete', '/library/:key', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(mockDeleteFromR2).toHaveBeenCalledWith('uploads/foo.png');
    });

    it('POST /lead-forms/accounts/:id/subscribe (social.lead_forms.manage) subscribes the page', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(['social.lead_forms.manage']));
      mockSubscribeFacebookPageToLeadgen.mockResolvedValueOnce({ subscribed: true });

      const req = makeReq({ params: { id: 'acc-1' } });
      const res = makeRes();
      await invoke('post', '/lead-forms/accounts/:id/subscribe', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ subscribed: true });
    });
  });

  describe('shadow mode logs and lets a genuinely-denied request through', () => {
    it('PERMISSION_SHADOW_MODE=true forwards GET /accounts to the handler despite an empty effective set', async () => {
      process.env.PERMISSION_SHADOW_MODE = 'true';
      mockGetEffectivePermissions.mockResolvedValue(new Set());
      mockSelect.mockReturnValueOnce(resultChain([]));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const req = makeReq();
      const res = makeRes();
      await invoke('get', '/accounts', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ accounts: [] });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/permission-shadow.*would deny/);
      warnSpy.mockRestore();
    });
  });

  describe('isOwner bypasses regardless of role', () => {
    it('a narrow, unprivileged role still succeeds when the effective set is the full owner set', async () => {
      mockGetEffectivePermissions.mockResolvedValue(new Set(ALL_PERMISSIONS));
      mockSelect.mockReturnValueOnce(resultChain([]));

      const req = makeReq({ user: { id: 'owner-1', tenantId: 'tenant-a', role: 'creative_assistant' } });
      const res = makeRes();
      await invoke('get', '/accounts', req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ accounts: [] });
    });
  });

  describe('401 when unauthenticated', () => {
    it('GET /accounts 401s when req.user is missing', async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();
      await invoke('get', '/accounts', req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockGetEffectivePermissions).not.toHaveBeenCalled();
    });
  });

  describe('the dead getPerms() helper is gone', () => {
    it('social.ts no longer exports or references a getPerms function', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const src = fs.readFileSync(path.join(__dirname, '../routes/social.ts'), 'utf8');
      expect(src).not.toMatch(/getPerms/);
    });
  });

  describe('OAuth redirect routes are intentionally left unauthenticated', () => {
    it('oauthRouter is a distinct router with no requirePerm-gated routes mounted on the authenticated router', () => {
      expect(oauthRouter).not.toBe(socialRouter);
      const oauthPaths = oauthRouter.stack.filter((l: any) => l.route).map((l: any) => l.route.path);
      expect(oauthPaths).toEqual(expect.arrayContaining(['/facebook/start', '/facebook/callback']));
    });
  });
});
