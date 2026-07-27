// PR 8A hardening — pilot roster enforcement for the Smartlead-free internal
// pilot surfaces (Decision Workbench, policy read/write, free preparation).
//
// Reuses the EXISTING pilot middleware and configuration pattern
// (`resolveStaffingAccess`/`requireStaffingPilot`, `WIZMATCH_STAFFING_PILOT_USER_IDS`,
// `src/services/wizmatchStaffingAccess.ts`) rather than inventing a second
// roster mechanism. That function already fails closed in production when the
// roster env var is unset (`configured && pilotAllowed` is false whenever
// `configured` is false), and is permissive only in non-production so local
// dev/test does not require the roster to be configured — the same tradeoff
// `wizmatchStaffing.ts` already makes for the Staffing OS surfaces.
//
// Before this fix, `wizmatchPolicy.ts`, `wizmatchToday.ts` and
// `wizmatchPrepare.ts` were reachable by ANY role in `wizmatchRequireStaffing`'s
// broad allow-list (`admin, team_lead, manager_ops, sales, staff, viewer`) with
// no pilot-roster check at all — a role-based gate, not a pilot-roster gate.
// This middleware adds the roster check ON TOP of the existing role gates; it
// never grants write access on its own (a pilot member with an ineligible role
// still fails downstream `requireRole`/team_lead/admin checks).

import type { Request, Response, NextFunction } from 'express';
import { requireStaffingPilot } from '../services/wizmatchStaffingAccess';
import { StaffingDomainError } from '../services/wizmatchStaffingDomain';

export function wizmatchPilotGate(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorised', message: 'Authentication is required' });
    return;
  }
  try {
    requireStaffingPilot({ tenantId: req.user.tenantId, userId: req.user.id, role: req.user.role });
    next();
  } catch (error) {
    if (error instanceof StaffingDomainError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[wizmatch-pilot-gate] unexpected error', error);
    res.status(500).json({ error: 'internal_error' });
  }
}
