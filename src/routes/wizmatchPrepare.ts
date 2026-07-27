// PRD-005 PR 7 §12 "Preparation" — POST /companies/:id/prepare,
// GET /companies/:id/prepare/status.
//
// Gated end-to-end behind WIZMATCH_AUTO_PREP_ENABLED (default false, PRD-005
// §16) using the corrected `next('router')` pattern (PR 6 review C-1) — see
// wizmatchToday.ts / wizmatchPolicy.ts for the same idiom and its rationale.
//
// Role gate: same tier as reading policy/queues (§4 "Read policy, read
// queues" -> pilot member / staff+) — preparation reuses existing free data
// and never spends, sends, enrols or grants permission to contact a company,
// so it does not need the team_lead+ bar that a policy WRITE requires.
//
// Mounted in src/index.ts alongside wizmatchPolicyRouter/wizmatchTodayRouter,
// BEFORE the wizmatchRequireAdmin-gated wizmatchRouter, for the same M-1
// reason those two routers are.

import { Router, type Request, type Response } from 'express';
import { prepareSingleCompany, getPrepStatus } from '../modules/outreach/prepareCompanies';
import { isWizmatchFlagEnabled } from '../services/wizmatchAutomation';
import { wizmatchPilotGate } from '../middleware/wizmatchPilotGate';

const router = Router();

// Read per request, not once at module load, and through the SAME parser the
// worker cron uses — otherwise `WIZMATCH_AUTO_PREP_ENABLED=1` runs the cron
// while these routes 404 (PR 6 review, M-D). Unset/absent remains off.
function featureGate(_req: Request, _res: Response, next: (route?: string) => void): void {
  if (!isWizmatchFlagEnabled(process.env.WIZMATCH_AUTO_PREP_ENABLED)) {
    next('router');
    return;
  }
  next();
}
router.use(featureGate);
// PR 8A hardening — pilot roster enforcement (§4 preparation is a
// preparation-trigger route; same pilot-member tier as reading policy/queues).
router.use(wizmatchPilotGate);

router.post('/companies/:id/prepare', async (req: Request, res: Response) => {
  try {
    const outcome = await prepareSingleCompany(req.user!.tenantId, String(req.params.id));
    if (!outcome.ok) {
      // 404 and 409 are not interchangeable here: a client retrying a 409 is
      // correct, a client retrying a nonexistent company loops forever.
      if (outcome.reason === 'not_found') {
        res.status(404).json({ error: 'not_found', message: 'No such company for this tenant.' });
        return;
      }
      res.status(409).json({ error: 'lock_held', message: 'Another prep run is in progress for this tenant. Retry shortly.' });
      return;
    }
    res.json(outcome.result);
  } catch (error) {
    console.error('[wizmatch companies/:id/prepare] failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/companies/:id/prepare/status', async (req: Request, res: Response) => {
  try {
    const prep = await getPrepStatus(req.user!.tenantId, String(req.params.id));
    if (prep === null) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ prep });
  } catch (error) {
    console.error('[wizmatch companies/:id/prepare/status] failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
