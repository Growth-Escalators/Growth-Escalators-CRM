import { type Request, type Response, type NextFunction } from 'express';
import { db, users } from '../db/index';
import { eq } from 'drizzle-orm';

// Permission → which roles are allowed
// `team_lead` sits between sales and admin: full operational access (Contacts,
// Pipeline, Tasks, Meta Ads, Outreach, AI Intelligence, Growth OS, Templates,
// Lead Discovery, Short Links) but NOT financial/security tools (Billing,
// Permissions, Audit, Pipeline Manager, SEO, Analytics).
// `creative_assistant` is the narrowest non-staff role: Tasks (no perm needed —
// gated only by requireAuth on /api/tasks) + Inbox + Meta Ads (view & manage) +
// Social (view & post) + the external Content link. Explicitly excluded from
// Contacts/Deals/Reports/Billing/Sequences/Discovery/Marketing/Health/etc.
const PERMISSION_MAP: Record<string, string[]> = {
  CONTACTS_VIEW:       ['admin', 'manager_ops', 'team_lead', 'sales'],
  CONTACTS_EXPORT:     ['admin'],
  CONTACTS_BULK_DELETE: ['admin'],
  DEALS_VIEW:          ['admin', 'manager_ops', 'team_lead', 'sales'],
  DEALS_EDIT:          ['admin', 'manager_ops', 'team_lead', 'sales'],
  QUALIFICATION_VIEW:  ['admin', 'manager_ops', 'team_lead', 'sales'],
  SEQUENCES_VIEW:      ['admin', 'manager_ops', 'team_lead', 'sales'],
  SEQUENCES_EDIT:      ['admin', 'manager_ops', 'team_lead'],
  AUTOMATIONS_VIEW:    ['admin', 'manager_ops', 'team_lead', 'sales'],
  AUTOMATIONS_EDIT:    ['admin', 'manager_ops', 'team_lead'],
  ADS_VIEW:            ['admin', 'manager_ads', 'team_lead', 'creative_assistant'],
  ADS_MANAGE:          ['admin', 'manager_ads', 'team_lead', 'creative_assistant'],
  REPORTS_VIEW:        ['admin', 'manager_ops', 'manager_ads'],
  SOCIAL_VIEW:         ['admin', 'manager_ops', 'team_lead', 'staff', 'creative_assistant'],
  SOCIAL_POST:         ['admin', 'manager_ops', 'team_lead', 'staff', 'creative_assistant'],
  INBOX_VIEW:          ['admin', 'manager_ops', 'team_lead', 'sales', 'creative_assistant'],
  BILLING_VIEW:        ['admin'],
  HEALTH_VIEW:         ['admin', 'manager_ops', 'team_lead', 'sales'],
  PERMISSIONS_VIEW:    ['admin'],
  AUDIT_VIEW:          ['admin'],
  MARKETING_VIEW:      ['admin', 'manager_ads'],
  MARKETING_MANAGE:    ['admin', 'manager_ads'],
  DISCOVERY_VIEW:      ['admin', 'manager_ops', 'team_lead', 'sales'],
};

// Roles that get admin-tier operational tools (Outreach, AI Intelligence,
// Growth OS) — gated separately from PERMISSION_MAP because these are
// inline-checked in route handlers rather than via requirePermission.
export const ADMIN_TIER_ROLES = ['admin', 'team_lead'];
export function isAdminTier(role: string | undefined): boolean {
  return ADMIN_TIER_ROLES.includes(role || '');
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role || 'staff';
    if (roles.includes(role)) {
      next();
    } else {
      res.status(403).json({ error: 'forbidden', message: "You don't have permission to access this resource" });
    }
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role || 'staff';
    const allowed = PERMISSION_MAP[permission];
    // Fail closed: a permission name not in PERMISSION_MAP is a misconfiguration,
    // not a public route. A typo (`'CONATCTS_VIEW'`) used to silently grant
    // access to everyone — that's a latent auth bypass. All currently-used
    // permission keys were audited against PERMISSION_MAP before flipping this
    // default; new permissions must be added to the map at the same time as
    // the route that uses them.
    if (!allowed) {
      console.error(`[rbac] unknown permission '${permission}' — denying. Add it to PERMISSION_MAP.`);
      res.status(403).json({ error: 'forbidden', message: 'Permission misconfigured' });
      return;
    }
    if (allowed.includes(role)) {
      next();
    } else {
      res.status(403).json({ error: 'forbidden', message: "You don't have permission to access this resource" });
    }
  };
}

// Check permission from role string directly (for use in route handlers).
// Same fail-closed contract as requirePermission — unknown permission returns
// false, not true.
export function hasPermission(role: string, permission: string): boolean {
  const allowed = PERMISSION_MAP[permission];
  if (!allowed) {
    console.error(`[rbac] unknown permission '${permission}' — denying.`);
    return false;
  }
  return allowed.includes(role);
}

// Data masking for staff role
export function maskContactData(role: string, contact: Record<string, unknown>): Record<string, unknown> {
  if (role !== 'staff') return contact;
  const masked = { ...contact };
  if (masked.phone && typeof masked.phone === 'string') {
    masked.phone = masked.phone.slice(0, -3).replace(/\d/g, 'x') + masked.phone.slice(-3);
  }
  if (masked.email && typeof masked.email === 'string') {
    const [local, domain] = (masked.email as string).split('@');
    masked.email = local.slice(0, 2) + '***@' + domain;
  }
  return masked;
}
