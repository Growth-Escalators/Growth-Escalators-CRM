import { describe, it, expect } from 'vitest';
import {
  SYSTEM_ROLE_KEYS,
  computePermissionsForRole,
  buildSystemRoleSeeds,
  summarizeUserRoleMapping,
} from '../scripts/backfillRolesFromPermissionMap';
import { isPermission } from '../config/permissions';

describe('computePermissionsForRole (pure — no DB)', () => {
  it('admin gets every legacy-derived AND extra-default permission (the true superset role today)', () => {
    const adminPerms = new Set(computePermissionsForRole('admin'));
    // Spot-check a representative permission from each source: a
    // legacy-derived one (CONTACTS_VIEW -> contacts.view) and an
    // extra-default one with no legacy counterpart (finance.expenses.view).
    expect(adminPerms.has('contacts.view')).toBe(true);
    expect(adminPerms.has('contracts.approve')).toBe(true);
    expect(adminPerms.has('finance.expenses.view')).toBe(true);
    expect(adminPerms.has('integrations.manage')).toBe(true);
  });

  it('viewer only gets *_VIEW-derived permissions, never edit/manage/delete/export', () => {
    const viewerPerms = new Set(computePermissionsForRole('viewer'));
    expect(viewerPerms.has('contacts.view')).toBe(true);
    expect(viewerPerms.has('deals.view')).toBe(true);
    expect(viewerPerms.has('contacts.delete')).toBe(false);
    expect(viewerPerms.has('contacts.export')).toBe(false);
    expect(viewerPerms.has('deals.edit')).toBe(false);
    // Extra-default grants exclude viewer entirely (ALL_NON_VIEWER never
    // includes it, and every narrowed dangerous default is admin/manager_ops only).
    expect(viewerPerms.has('finance.expenses.view')).toBe(false);
    expect(viewerPerms.has('integrations.view')).toBe(false);
  });

  it('staff gets SOCIAL_VIEW/SOCIAL_POST-derived permissions but not sales-only DEALS_EDIT ones', () => {
    const staffPerms = new Set(computePermissionsForRole('staff'));
    expect(staffPerms.has('social.view')).toBe(true);
    expect(staffPerms.has('social.post')).toBe(true);
    expect(staffPerms.has('deals.edit')).toBe(false);
  });

  it("deliberately narrows finance.payroll.*/leave.approve/pnl.view to admin+manager_ops, NOT the everyone-today reality", () => {
    for (const roleKey of ['sales', 'staff', 'creative_assistant', 'team_lead'] as const) {
      const perms = new Set(computePermissionsForRole(roleKey));
      expect(perms.has('finance.payroll.view')).toBe(false);
      expect(perms.has('finance.payroll.manage')).toBe(false);
      expect(perms.has('finance.leave.approve')).toBe(false);
      expect(perms.has('finance.pnl.view')).toBe(false);
    }
    for (const roleKey of ['admin', 'manager_ops'] as const) {
      const perms = new Set(computePermissionsForRole(roleKey));
      expect(perms.has('finance.payroll.view')).toBe(true);
      expect(perms.has('finance.leave.approve')).toBe(true);
    }
  });

  it('pipeline.backfill is admin-only (mirrors the real inline role check in pipelines.ts)', () => {
    for (const roleKey of SYSTEM_ROLE_KEYS) {
      const perms = new Set(computePermissionsForRole(roleKey));
      expect(perms.has('pipeline.backfill')).toBe(roleKey === 'admin');
    }
  });

  it('every permission this function ever returns is a real key in the PERMISSIONS registry', () => {
    for (const roleKey of SYSTEM_ROLE_KEYS) {
      for (const perm of computePermissionsForRole(roleKey)) {
        expect(isPermission(perm), `${perm} (role=${roleKey})`).toBe(true);
      }
    }
  });
});

describe('buildSystemRoleSeeds (pure — no DB)', () => {
  it('produces exactly the 8 system roles, each is_system-flagged implicitly by being in this seed list', () => {
    const seeds = buildSystemRoleSeeds();
    expect(seeds.map((s) => s.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it('every seed has a non-empty display name and a permissions array (possibly empty for the narrowest roles)', () => {
    for (const seed of buildSystemRoleSeeds()) {
      expect(seed.name.length).toBeGreaterThan(0);
      expect(Array.isArray(seed.permissions)).toBe(true);
    }
  });
});

describe('summarizeUserRoleMapping (pure — no DB)', () => {
  const roleKeyToId = new Map([
    ['admin', 'role-admin-id'],
    ['sales', 'role-sales-id'],
  ] as Array<[string, string]>) as Map<'admin' | 'sales', string>;

  it('maps a user whose legacy role string matches a known system role', () => {
    const result = summarizeUserRoleMapping(
      [{ id: 'u1', role: 'admin', roleId: null }],
      roleKeyToId as never,
    );
    expect(result.mapped).toEqual([{ userId: 'u1', roleKey: 'admin', roleId: 'role-admin-id' }]);
    expect(result.unrecognized).toEqual([]);
    expect(result.alreadyMapped).toEqual([]);
  });

  it('leaves an already-mapped user (role_id already set) untouched — idempotent rerun', () => {
    const result = summarizeUserRoleMapping(
      [{ id: 'u1', role: 'admin', roleId: 'already-set' }],
      roleKeyToId as never,
    );
    expect(result.alreadyMapped).toEqual([{ userId: 'u1' }]);
    expect(result.mapped).toEqual([]);
  });

  it('flags an unrecognized role string loudly instead of silently skipping it', () => {
    const result = summarizeUserRoleMapping(
      [{ id: 'u2', role: 'super_duper_admin', roleId: null }],
      roleKeyToId as never,
    );
    expect(result.unrecognized).toEqual([{ userId: 'u2', role: 'super_duper_admin' }]);
    expect(result.mapped).toEqual([]);
  });

  it('flags a NULL role string as unrecognized rather than silently skipping it', () => {
    const result = summarizeUserRoleMapping(
      [{ id: 'u3', role: null, roleId: null }],
      roleKeyToId as never,
    );
    expect(result.unrecognized).toEqual([{ userId: 'u3', role: null }]);
  });

  it('flags a role string that is a known system-role key but has no id in the lookup map (role not yet created)', () => {
    const result = summarizeUserRoleMapping(
      [{ id: 'u4', role: 'viewer', roleId: null }],
      roleKeyToId as never, // 'viewer' deliberately absent from this test's lookup map
    );
    expect(result.unrecognized).toEqual([{ userId: 'u4', role: 'viewer' }]);
  });

  it('handles a mixed batch correctly in one pass', () => {
    const result = summarizeUserRoleMapping(
      [
        { id: 'u1', role: 'admin', roleId: null },
        { id: 'u2', role: 'sales', roleId: 'already-mapped' },
        { id: 'u3', role: 'not_a_role', roleId: null },
      ],
      roleKeyToId as never,
    );
    expect(result.mapped.map((m) => m.userId)).toEqual(['u1']);
    expect(result.alreadyMapped.map((m) => m.userId)).toEqual(['u2']);
    expect(result.unrecognized.map((m) => m.userId)).toEqual(['u3']);
  });
});
