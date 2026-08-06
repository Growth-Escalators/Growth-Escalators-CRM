import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Proves src/routes/automationHub.ts is correctly wired to requirePerm(...).
// See requirePerm.test.ts (middleware unit tests) and permissionResolver.test.ts
// (isOwner unit tests) for the underlying mechanics — this file only tests the
// route-level integration. automationHub.ts is a single-route, read-only
// aggregate dashboard (GET /hub-stats) per the registry's own comment in
// src/config/permissions.ts — there is no mutation to gate here.

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

const mockExecute = vi.fn();
vi.mock('../db/index', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

import automationHubRouter from '../routes/automationHub';
import { ALL_PERMISSIONS } from '../config/permissions';

function emptyRows() {
  return { rows: [] };
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

async function invoke(method: 'get', path: string, req: any, res: any) {
  const layer = automationHubRouter.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route!.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

describe('routes/automationHub.ts — requirePerm wiring', () => {
  const originalShadow = process.env.PERMISSION_SHADOW_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERMISSION_SHADOW_MODE;
    mockExecute.mockResolvedValue(emptyRows());
  });

  afterEach(() => {
    if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
    else process.env.PERMISSION_SHADOW_MODE = originalShadow;
  });

  it('GET /hub-stats requires automations.view (denied on an empty effective set)', async () => {
    mockGetEffectivePermissions.mockResolvedValue(new Set());
    const req = makeReq();
    const res = makeRes();

    await invoke('get', '/hub-stats', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.status().json).toHaveBeenCalledWith(expect.objectContaining({ required: ['automations.view'] }));
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('GET /hub-stats succeeds when automations.view is granted', async () => {
    mockGetEffectivePermissions.mockResolvedValue(new Set(['automations.view']));
    const req = makeReq();
    const res = makeRes();

    await invoke('get', '/hub-stats', req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('sequences');
    expect(body).toHaveProperty('jobs');
    expect(body).toHaveProperty('funnels');
    expect(body).toHaveProperty('contacts');
  });

  it('PERMISSION_SHADOW_MODE=true logs and lets a genuinely-denied request through', async () => {
    process.env.PERMISSION_SHADOW_MODE = 'true';
    mockGetEffectivePermissions.mockResolvedValue(new Set());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = makeReq();
    const res = makeRes();
    await invoke('get', '/hub-stats', req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/permission-shadow.*would deny/);
    warnSpy.mockRestore();
  });

  it('isOwner bypasses regardless of role (effective set is the full owner set)', async () => {
    mockGetEffectivePermissions.mockResolvedValue(new Set(ALL_PERMISSIONS));
    const req = makeReq({ user: { id: 'owner-1', tenantId: 'tenant-a', role: 'creative_assistant' } });
    const res = makeRes();

    await invoke('get', '/hub-stats', req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('401s when req.user is missing', async () => {
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await invoke('get', '/hub-stats', req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockGetEffectivePermissions).not.toHaveBeenCalled();
  });
});
