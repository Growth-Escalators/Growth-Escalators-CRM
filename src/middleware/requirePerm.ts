// requirePerm — the future replacement for src/middleware/rbac.ts's
// requirePermission(), built on the new tenant-customizable roles/overrides
// foundation (src/services/permissionResolver.ts).
//
// NOT WIRED INTO ANY ROUTE BY THIS PR. rbac.ts's PERMISSION_MAP /
// requirePermission keep gating every existing route exactly as today; this
// is the mechanism a LATER, separate effort will swap in module-by-module,
// starting each module in PERMISSION_SHADOW_MODE (log what would have been
// denied, but let the request through) before flipping it to enforce.
//
// Fail-closed contract, in order of evaluation:
//   1. missing req.user                       -> 401 (always, no shadow mode)
//   2. an unrecognised permission key           -> 403 (always, no shadow mode;
//      mirrors requirePermission's identical guard in rbac.ts — a typo'd key
//      is a misconfiguration, not something shadow mode should soften)
//   3. the DB call to resolve permissions throws -> 403 (always, no shadow
//      mode; an infra failure is an outage, not "the new model would deny
//      this", which is the only case shadow mode exists to observe)
//   4. permission genuinely not held            -> 403 normally, OR logged
//      and ALLOWED when PERMISSION_SHADOW_MODE=true
import { type Request, type Response, type NextFunction } from 'express';
import { getEffectivePermissions } from '../services/permissionResolver';
import { isPermission, type Permission } from '../config/permissions';

export function requirePerm(...perms: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorised' });
      return;
    }

    const unknown = perms.filter((p) => !isPermission(p));
    if (unknown.length > 0) {
      console.error(`[requirePerm] unknown permission key(s) '${unknown.join(', ')}' — denying. Add to PERMISSIONS registry (src/config/permissions.ts).`);
      res.status(403).json({ error: 'forbidden', message: 'Permission misconfigured' });
      return;
    }

    let effective: Set<Permission>;
    try {
      effective = await getEffectivePermissions(req.user.id);
    } catch (e) {
      console.error(`[requirePerm] permission resolution failed for user=${req.user.id}:`, e instanceof Error ? e.message : e);
      res.status(403).json({ error: 'forbidden', message: 'permission check unavailable — please retry' });
      return;
    }

    const allowed = perms.every((p) => effective.has(p));
    if (allowed) {
      next();
      return;
    }

    if (process.env.PERMISSION_SHADOW_MODE === 'true') {
      console.warn(`[permission-shadow] would deny user=${req.user.id} role=${req.user.role} route=${req.method} ${req.path} required=${perms.join(',')}`);
      next();
      return;
    }

    res.status(403).json({ error: 'forbidden', required: perms });
  };
}
