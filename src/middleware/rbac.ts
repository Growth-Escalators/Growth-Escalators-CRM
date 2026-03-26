import { type Request, type Response, type NextFunction } from 'express';
import { db, users } from '../db/index';
import { eq } from 'drizzle-orm';

// Permission → which roles are allowed
const PERMISSION_MAP: Record<string, string[]> = {
  CONTACTS_VIEW:       ['admin', 'manager_ops', 'sales'],
  CONTACTS_EXPORT:     ['admin'],
  CONTACTS_BULK_DELETE: ['admin'],
  DEALS_VIEW:          ['admin', 'manager_ops', 'sales'],
  DEALS_EDIT:          ['admin', 'manager_ops', 'sales'],
  QUALIFICATION_VIEW:  ['admin', 'manager_ops', 'sales'],
  SEQUENCES_VIEW:      ['admin', 'manager_ops', 'sales'],
  SEQUENCES_EDIT:      ['admin', 'manager_ops'],
  AUTOMATIONS_VIEW:    ['admin', 'manager_ops', 'sales'],
  AUTOMATIONS_EDIT:    ['admin', 'manager_ops'],
  ADS_VIEW:            ['admin', 'manager_ads'],
  ADS_MANAGE:          ['admin', 'manager_ads'],
  REPORTS_VIEW:        ['admin', 'manager_ops', 'manager_ads'],
  SOCIAL_VIEW:         ['admin', 'manager_ops', 'staff'],
  SOCIAL_POST:         ['admin', 'manager_ops', 'staff'],
  INBOX_VIEW:          ['admin', 'manager_ops', 'sales'],
  BILLING_VIEW:        ['admin'],
  HEALTH_VIEW:         ['admin', 'manager_ops', 'sales'],
  PERMISSIONS_VIEW:    ['admin'],
  AUDIT_VIEW:          ['admin'],
  MARKETING_VIEW:      ['admin', 'manager_ads'],
  MARKETING_MANAGE:    ['admin', 'manager_ads'],
  DISCOVERY_VIEW:      ['admin', 'manager_ops', 'sales'],
};

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
    if (!allowed) { next(); return; }
    if (allowed.includes(role)) {
      next();
    } else {
      res.status(403).json({ error: 'forbidden', message: "You don't have permission to access this resource" });
    }
  };
}

// Check permission from role string directly (for use in route handlers)
export function hasPermission(role: string, permission: string): boolean {
  const allowed = PERMISSION_MAP[permission];
  if (!allowed) return true;
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
