// PRD-005 PR 6 §12 "Decision workbench" — GET /today/queues, POST /today/actions.
//
// Gated end-to-end behind WIZMATCH_DECISION_WORKBENCH_ENABLED (default
// false, PRD-005 §16) — when off, every route in this file responds 404, the
// same convention wizmatchPolicy.ts uses.
//
// Role gates per PRD-005 §4:
//   read queues                                -> pilot member (staff+)
//   single-target action (approve/pause/block/
//   resume/assign owner/set review date/
//   merge/confirm separate)                    -> team_lead+
//   multi-target ("bulk") action                -> admin only
//     ("Bulk policy write, bulk queue action" is explicitly admin-only,
//     PRD-005 §4 — a request with >1 target is a bulk action regardless of
//     which contextual action it names.)
//
// Mounted in src/index.ts BEFORE the wizmatchRequireAdmin-gated wizmatchRouter
// (see the mount-order comment there — PR 5 review finding M-1) so staff+ can
// reach `/today/queues` without being 403'd by an unrelated stricter gate.

import { Router, type Request, type Response } from 'express';
import { buildTodayQueues } from '../modules/outreach/decisionWorkbench';
import { runTodayActions, TodayActionValidationError, type TodayActionRequest } from '../modules/outreach/decisionWorkbenchActions';

const router = Router();

// When the flag is off this router must become INVISIBLE, not become a
// terminal 404 for the whole `/api/wizmatch` prefix. `next('router')` exits
// this router and hands the request back to the parent app, so it continues
// on to the later `/api/wizmatch` mounts (`wizmatchRouter`, 82 routes) and
// only the paths this router actually defines end at the app's own 404
// handler. Responding 404 here directly would 404 EVERY `/api/wizmatch`
// request, because this router is mounted ahead of `wizmatchRouter` (the M-1
// ordering fix) and `router.use` matches every path.
function featureGate(_req: Request, _res: Response, next: (route?: string) => void): void {
  if (process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED !== 'true') {
    next('router');
    return;
  }
  next();
}
router.use(featureGate);

function actorFrom(req: Request) {
  // `role` is carried into the action layer because PRD-005 §4 gates "admin
  // override of a `standard` block" on the PREDECESSOR policy state, which
  // only that layer reads — the route sees the action name, not the target.
  return { tenantId: req.user!.tenantId, userId: req.user?.id, role: req.user?.role };
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

router.get('/today/queues', async (req: Request, res: Response) => {
  try {
    const limit = clampLimit(req.query.limit, 200, 500);
    const queues = await buildTodayQueues(req.user!.tenantId, limit);
    res.json(queues);
  } catch (error) {
    console.error('[wizmatch today/queues] failed to build decision queues', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/today/actions', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Partial<TodayActionRequest>;
  const targets = Array.isArray(body.targets) ? body.targets : [];
  const role = req.user?.role || 'staff';
  const isBulk = targets.length > 1;
  const allowedRoles = isBulk ? ['admin'] : ['admin', 'team_lead'];
  if (!allowedRoles.includes(role)) {
    res.status(403).json({
      error: 'forbidden',
      message: isBulk
        ? 'Bulk actions (more than one target) require admin.'
        : 'This action requires team_lead or admin.',
    });
    return;
  }

  try {
    const outcome = await runTodayActions(actorFrom(req), body as TodayActionRequest);
    res.json(outcome);
  } catch (error) {
    if (error instanceof TodayActionValidationError) {
      res.status(400).json({ error: 'validation_error', code: error.code, message: error.message });
      return;
    }
    console.error('[wizmatch today/actions] failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
