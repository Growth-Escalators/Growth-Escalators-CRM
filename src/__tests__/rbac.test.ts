import { describe, it, expect, vi } from 'vitest';
import { requirePermission, hasPermission, isAdminTier } from '../middleware/rbac';

// Minimal Express-shaped fakes — enough to exercise the middleware contract.
function makeReq(role: string) {
  return { user: { role } } as unknown as import('express').Request;
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

describe('requirePermission (fail-closed)', () => {
  it('grants access when role is in the permission map', () => {
    const next = vi.fn();
    const res = makeRes();
    requirePermission('CONTACTS_VIEW')(makeReq('admin'), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('denies access when role is not in the permission map', () => {
    const next = vi.fn();
    const res = makeRes();
    requirePermission('AUDIT_VIEW')(makeReq('staff'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
  });

  it('denies and 403s when the permission name is unknown (typo / misconfig)', () => {
    const next = vi.fn();
    const res = makeRes();
    requirePermission('CONATCTS_VIEW' /* typo */)(makeReq('admin'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
    expect((res as unknown as { body: { message: string } }).body.message).toMatch(/misconfigured/i);
  });
});

describe('hasPermission (fail-closed)', () => {
  it('returns true for known permission + allowed role', () => {
    expect(hasPermission('admin', 'CONTACTS_VIEW')).toBe(true);
  });

  it('returns false for known permission + disallowed role', () => {
    expect(hasPermission('staff', 'AUDIT_VIEW')).toBe(false);
  });

  it('returns false for unknown permission name', () => {
    expect(hasPermission('admin', 'NONEXISTENT_FOO')).toBe(false);
  });
});

describe('viewer role (read-only, comprehensive read access)', () => {
  it('can read across all business domains', () => {
    for (const perm of ['CONTACTS_VIEW', 'DEALS_VIEW', 'QUALIFICATION_VIEW', 'SEQUENCES_VIEW',
      'AUTOMATIONS_VIEW', 'ADS_VIEW', 'REPORTS_VIEW', 'SOCIAL_VIEW', 'INBOX_VIEW', 'HEALTH_VIEW',
      'MARKETING_VIEW', 'DISCOVERY_VIEW']) {
      expect(hasPermission('viewer', perm)).toBe(true);
    }
  });

  it('cannot edit / export / delete / manage / post', () => {
    for (const perm of ['CONTACTS_EXPORT', 'CONTACTS_BULK_DELETE', 'DEALS_EDIT', 'SEQUENCES_EDIT',
      'AUTOMATIONS_EDIT', 'ADS_MANAGE', 'SOCIAL_POST', 'MARKETING_MANAGE']) {
      expect(hasPermission('viewer', perm)).toBe(false);
    }
  });

  it('is not granted sensitive admin-only reads (billing / permissions / audit)', () => {
    for (const perm of ['BILLING_VIEW', 'PERMISSIONS_VIEW', 'AUDIT_VIEW']) {
      expect(hasPermission('viewer', perm)).toBe(false);
    }
  });

  it('is admin-tier for READ access to Growth OS / Intelligence (writes still blocked in requireAuth)', () => {
    expect(isAdminTier('viewer')).toBe(true);
  });
});
