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

const router = Router();

function featureGate(_req: Request, _res: Response, next: (route?: string) => void): void {
  if (process.env.WIZMATCH_AUTO_PREP_ENABLED !== 'true') {
    next('router');
    return;
  }
  next();
}
router.use(featureGate);

router.post('/companies/:id/prepare', async (req: Request, res: Response) => {
  try {
    const result = await prepareSingleCompany(req.user!.tenantId, String(req.params.id));
    if (!result) {
      res.status(409).json({ error: 'lock_held_or_not_found', message: 'Another prep run is in progress, or the company does not exist for this tenant.' });
      return;
    }
    res.json(result);
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
