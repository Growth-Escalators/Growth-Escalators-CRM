import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetEffectivePermissions = vi.fn();
vi.mock('../services/permissionResolver', () => ({
  getEffectivePermissions: (...args: unknown[]) => mockGetEffectivePermissions(...args),
}));

import { requirePerm } from '../middleware/requirePerm';

function makeReq(user?: { id: string; role: string }) {
  return { user, method: 'GET', path: '/api/contacts' } as unknown as import('express').Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res as unknown as import('express').Response & { statusCode: number; body: unknown };
}

describe('requirePerm', () => {
  const originalShadow = process.env.PERMISSION_SHADOW_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERMISSION_SHADOW_MODE;
  });

  afterEach(() => {
    if (originalShadow === undefined) delete process.env.PERMISSION_SHADOW_MODE;
    else process.env.PERMISSION_SHADOW_MODE = originalShadow;
  });

  it('401s when req.user is missing, without ever calling the resolver', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('contacts.view')(makeReq(undefined), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockGetEffectivePermissions).not.toHaveBeenCalled();
  });

  it('fails closed (403) on an unknown permission key, without querying the resolver', async () => {
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('not.a.real.permission' as never)(makeReq({ id: 'u1', role: 'admin' }), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(mockGetEffectivePermissions).not.toHaveBeenCalled();
  });

  it('grants access (calls next) when every required permission is present in the effective set', async () => {
    mockGetEffectivePermissions.mockResolvedValue(new Set(['contacts.view']));
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('contacts.view')(makeReq({ id: 'u1', role: 'sales' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('requires ALL listed permissions (AND semantics) — missing even one denies', async () => {
    mockGetEffectivePermissions.mockResolvedValue(new Set(['contacts.view']));
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('contacts.view', 'contacts.delete')(makeReq({ id: 'u1', role: 'sales' }), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies with 403 when the permission is genuinely absent and shadow mode is off', async () => {
    mockGetEffectivePermissions.mockResolvedValue(new Set());
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('contacts.delete')(makeReq({ id: 'u1', role: 'staff' }), res, next);
    expect(res.statusCode).toBe(403);
    expect((res as unknown as { body: { required: string[] } }).body.required).toEqual(['contacts.delete']);
    expect(next).not.toHaveBeenCalled();
  });

  it('PERMISSION_SHADOW_MODE=true logs a warning but still calls next() for a genuinely-missing permission', async () => {
    process.env.PERMISSION_SHADOW_MODE = 'true';
    mockGetEffectivePermissions.mockResolvedValue(new Set());
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('contacts.delete')(makeReq({ id: 'u1', role: 'staff' }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/permission-shadow.*would deny/);
    warnSpy.mockRestore();
  });

  it('fails closed (403, not a crash) when the resolver rejects', async () => {
    mockGetEffectivePermissions.mockRejectedValue(new Error('db down'));
    const next = vi.fn();
    const res = makeRes();
    await expect(
      requirePerm('contacts.view')(makeReq({ id: 'u1', role: 'admin' }), res, next),
    ).resolves.toBeUndefined();
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('DB-error fail-closed is NOT softened by shadow mode — an outage must not silently allow everything through', async () => {
    process.env.PERMISSION_SHADOW_MODE = 'true';
    mockGetEffectivePermissions.mockRejectedValue(new Error('db down'));
    const next = vi.fn();
    const res = makeRes();
    await requirePerm('contacts.view')(makeReq({ id: 'u1', role: 'admin' }), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
