// Platform-superadmin primitive (Phase-1 hardening, security audit 2026-08-03).
//
// This PR adds `users.isPlatformSuperadmin`, the `requirePlatformSuperadmin`
// middleware, and the `auditSuperadminCrossTenantAccess` audit-logging
// capability (all in `src/middleware/rbac.ts`). None of it is wired into any
// route yet — there is no current support-UI use case, this is scaffolding
// only. These tests exist to prove the primitive itself is correct, and that
// it does not weaken the tenant isolation that already exists.
//
// Note on scope: at the time this branch was cut from `origin/main`, PRs
// #109 (booking route auth), #110 (tenant-isolation IDOR — messages/sequences/
// permissions) and #111 (Growth OS / reports / SEO ensure-hook tenant
// scoping) were still OPEN, not merged — so this branch does not contain
// those specific fixes. The regression coverage below instead targets the
// tenant-binding mechanism those fixes sit on top of: `requireAuth`'s H-1
// check (`src/middleware/auth.ts`, already merged), which compares the JWT's
// `tenantId` claim against the user's actual `users.tenant_id` on every
// request and is what makes tenant-scoped queries trustworthy in the first
// place. Proving the new superadmin flag doesn't bypass THAT is the
// meaningful regression here; re-proving #109/#110/#111 themselves belongs on
// those branches once they merge.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret';

const mockDbSelect = vi.fn();
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockDbInsert = vi.fn((..._args: unknown[]) => ({ values: mockInsertValues }));

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
  users: {
    id: 'id',
    tokenVersion: 'token_version',
    tenantId: 'tenant_id',
    isActive: 'is_active',
    isPlatformSuperadmin: 'is_platform_superadmin',
  },
  auditEvents: { id: 'id', tenantId: 'tenant_id', userId: 'user_id', action: 'action' },
}));

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res as unknown as import('express').Response & { statusCode: number; body: unknown };
}

// Row returned by the mocked `db.select(...).from(users).where(...).limit(1)`.
// Both `requireAuth`'s `currentIdentity` and `requirePlatformSuperadmin` read
// this same mocked chain — each just picks the field(s) it cares about, so one
// row shape serves both.
function mockUserRow(row: {
  tokenVersion?: number | null;
  tenantId?: string | null;
  isActive?: boolean | null;
  isPlatformSuperadmin?: boolean | null;
} | null) {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(row === null ? [] : [row]),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbInsert.mockImplementation(() => ({ values: mockInsertValues }));
});

// ---------------------------------------------------------------------------
// requirePlatformSuperadmin — fail-closed middleware
// ---------------------------------------------------------------------------
describe('requirePlatformSuperadmin', () => {
  it('rejects with 403 when there is no authenticated user', async () => {
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    const req = {} as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('allows a user flagged isPlatformSuperadmin=true through', async () => {
    mockUserRow({ isPlatformSuperadmin: true });
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    const req = { user: { id: 'user-1', tenantId: 'tenant-1', role: 'admin' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a user flagged isPlatformSuperadmin=false with 403', async () => {
    mockUserRow({ isPlatformSuperadmin: false });
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    const req = { user: { id: 'user-1', tenantId: 'tenant-1', role: 'admin' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects when the column is NULL rather than false (defensive — must be === true, not truthy)', async () => {
    mockUserRow({ isPlatformSuperadmin: null });
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    const req = { user: { id: 'user-1', tenantId: 'tenant-1', role: 'admin' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects with 403 when the user row no longer exists', async () => {
    mockUserRow(null);
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    const req = { user: { id: 'ghost-user', tenantId: 'tenant-1', role: 'admin' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('fails closed (403) when the DB lookup throws', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error('connection reset')),
        }),
      }),
    });
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    const req = { user: { id: 'user-1', tenantId: 'tenant-1', role: 'admin' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('a normal (non-superadmin) user cannot talk its way past the gate by forging req.user.tenantId — the flag is looked up by user id only', async () => {
    mockUserRow({ isPlatformSuperadmin: false });
    const { requirePlatformSuperadmin } = await import('../middleware/rbac');
    // Same user id, but claiming a DIFFERENT tenant than their own — the
    // middleware must still deny, because it never consults tenantId at all.
    const req = { user: { id: 'user-1', tenantId: 'tenant-VICTIM', role: 'admin' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await requirePlatformSuperadmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// auditSuperadminCrossTenantAccess — logging capability
// ---------------------------------------------------------------------------
describe('auditSuperadminCrossTenantAccess', () => {
  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      user: { id: 'superadmin-1', tenantId: 'tenant-home', role: 'admin', email: 'a@b.com', tokenVersion: 1 },
      method: 'GET',
      originalUrl: '/api/support/whatever',
      headers: {},
      ...overrides,
    } as unknown as import('express').Request;
  }

  it('does nothing when there is no authenticated user', async () => {
    const { auditSuperadminCrossTenantAccess } = await import('../middleware/rbac');
    const req = {} as unknown as import('express').Request;
    await auditSuperadminCrossTenantAccess(req, 'tenant-other');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('does nothing when the target tenant IS the caller\'s own tenant (not cross-tenant)', async () => {
    const { auditSuperadminCrossTenantAccess } = await import('../middleware/rbac');
    const req = makeReq();
    await auditSuperadminCrossTenantAccess(req, 'tenant-home');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('does nothing when the target tenant is falsy', async () => {
    const { auditSuperadminCrossTenantAccess } = await import('../middleware/rbac');
    const req = makeReq();
    await auditSuperadminCrossTenantAccess(req, '');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('logs to audit_events when accessing a tenant other than the caller\'s own', async () => {
    const { auditSuperadminCrossTenantAccess } = await import('../middleware/rbac');
    const req = makeReq();
    await auditSuperadminCrossTenantAccess(req, 'tenant-other', {
      resourceType: 'contact',
      resourceId: 'contact-42',
      metadata: { reason: 'support ticket #123' },
    });
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.tenantId).toBe('tenant-other');
    expect(inserted.userId).toBe('superadmin-1');
    expect(inserted.action).toBe('platform_superadmin.cross_tenant_access');
    expect(inserted.resourceType).toBe('contact');
    expect(inserted.resourceId).toBe('contact-42');
    expect(inserted.metadata).toMatchObject({
      actorUserId: 'superadmin-1',
      actorTenantId: 'tenant-home',
      targetTenantId: 'tenant-other',
      method: 'GET',
      path: '/api/support/whatever',
      reason: 'support ticket #123',
    });
  });

  it('never throws even if the underlying insert fails (logAuditEvent swallows errors)', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('db down'));
    const { auditSuperadminCrossTenantAccess } = await import('../middleware/rbac');
    const req = makeReq();
    await expect(auditSuperadminCrossTenantAccess(req, 'tenant-other')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression: existing tenant-scoping (requireAuth's H-1 tenant binding)
// still holds in the presence of the new isPlatformSuperadmin column.
// ---------------------------------------------------------------------------
describe('requireAuth tenant binding — unaffected by isPlatformSuperadmin (regression)', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  function signToken(overrides: Record<string, unknown> = {}) {
    return jwt.sign(
      { id: 'user-1', email: 'a@b.com', tenantId: 'tenant-1', role: 'admin', tokenVersion: 3, ...overrides },
      TEST_SECRET,
    );
  }
  function makeReq(header?: string) {
    return { headers: { authorization: header }, method: 'GET' } as unknown as import('express').Request;
  }

  it('still rejects a forged tenantId claim for a user who IS flagged isPlatformSuperadmin — the flag is not a tenant-binding bypass', async () => {
    // requireAuth's own DB select only ever asks for tokenVersion/tenantId/isActive
    // (it does not know or care about isPlatformSuperadmin), so the extra field
    // on the mocked row is inert here — that's the point: this column adds no
    // new code path inside requireAuth at all.
    mockUserRow({ tokenVersion: 3, tenantId: 'tenant-1', isActive: true, isPlatformSuperadmin: true });
    const { requireAuth } = await import('../middleware/auth');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-VICTIM' })}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
  });

  it('a normal (non-superadmin, matching-tenant) user still authenticates normally — the new column changes nothing on the happy path', async () => {
    mockUserRow({ tokenVersion: 3, tenantId: 'tenant-1', isActive: true, isPlatformSuperadmin: false });
    const { requireAuth } = await import('../middleware/auth');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-1' })}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as { user: { tenantId: string } }).user.tenantId).toBe('tenant-1');
  });

  it('a normal user with a forged tenantId claim is still rejected (Phase-0-style cross-tenant IDOR stays closed)', async () => {
    mockUserRow({ tokenVersion: 3, tenantId: 'tenant-1', isActive: true, isPlatformSuperadmin: false });
    const { requireAuth } = await import('../middleware/auth');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-VICTIM' })}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
