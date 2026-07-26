// PRD-005 PR 4 — policy read/write API, duplicate review/merge, account-owner
// assignment, admin bulk policy actions, and the readiness report/CLI backend.
//
// Gated end-to-end behind WIZMATCH_COMPANY_POLICY_ENABLED (default false,
// PRD-005 §16) — when off, every route in this file responds 404 so the
// surface is invisible rather than merely unauthenticated. Mounted at
// /api/wizmatch in src/index.ts, AFTER the existing staffing/admin mounts, so
// it only ever handles paths neither of those routers defines.
//
// Role gates per PRD-005 §4:
//   read policy / read duplicates            -> pilot member (staff+)
//   write a policy row / assign owner /
//   resolve a duplicate                        -> team_lead+
//   admin override of a standard block         -> admin
//   bulk policy write                          -> admin
//   readiness report                           -> admin, read-only

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac';
import {
  getCompanyPolicyView,
  writeCompanyPolicy,
  writeCompanyPolicyOverride,
  assignAccountOwner,
  bulkWriteCompanyPolicy,
  listCompaniesByPolicy,
  PolicyValidationError,
  PolicyOverrideRefusedError,
  type PolicyWriteInput,
} from '../modules/outreach/policyService';
import { listDuplicates, resolveDuplicate, DuplicateValidationError } from '../modules/outreach/duplicateService';
import { getWizmatchPolicyReadiness } from '../modules/outreach/policyReadiness';

const router = Router();

function featureGate(req: Request, res: Response, next: NextFunction): void {
  if (process.env.WIZMATCH_COMPANY_POLICY_ENABLED !== 'true') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
}
router.use(featureGate);

const requireTeamLead = requireRole('admin', 'team_lead');
const requireAdmin = requireRole('admin');

function actorFrom(req: Request) {
  return { tenantId: req.user!.tenantId, userId: req.user?.id };
}

function handleServiceError(error: unknown, res: Response): void {
  if (error instanceof PolicyValidationError) {
    res.status(400).json({ error: 'validation_error', code: error.code, message: error.message });
    return;
  }
  if (error instanceof PolicyOverrideRefusedError) {
    res.status(409).json({ error: 'override_refused', message: error.message });
    return;
  }
  if (error instanceof DuplicateValidationError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'already_resolved' ? 409 : 400;
    res.status(status).json({ error: error.code, message: error.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[wizmatch-policy] unexpected error', error);
  res.status(500).json({ error: 'internal_error' });
}

// ---------------------------------------------------------------------------
// Policy read/write
// ---------------------------------------------------------------------------

router.get('/companies/:id/policy', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const view = await getCompanyPolicyView(tenantId, String(req.params.id));
    res.json(view);
  } catch (error) {
    handleServiceError(error, res);
  }
});

router.post('/companies/:id/policy', requireTeamLead, async (req: Request, res: Response) => {
  try {
    const input = req.body as PolicyWriteInput;
    const row = await writeCompanyPolicy(actorFrom(req), String(req.params.id), input, 'human');
    res.status(201).json(row);
  } catch (error) {
    handleServiceError(error, res);
  }
});

router.post('/companies/:id/policy/override', requireAdmin, async (req: Request, res: Response) => {
  try {
    const input = req.body as Omit<PolicyWriteInput, 'reasonCode'> & { evidenceKind: PolicyWriteInput['evidenceKind'] };
    const row = await writeCompanyPolicyOverride(actorFrom(req), String(req.params.id), input as any);
    res.status(201).json(row);
  } catch (error) {
    handleServiceError(error, res);
  }
});

router.post('/companies/:id/owner', requireTeamLead, async (req: Request, res: Response) => {
  try {
    const { accountOwnerUserId } = req.body as { accountOwnerUserId: string | null };
    const result = await assignAccountOwner(actorFrom(req), String(req.params.id), accountOwnerUserId ?? null);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Deliberately a NEW read endpoint (not an overload of the existing companies
// list route) — see policyService.ts's listCompaniesByPolicy header comment.
router.get('/policy/companies', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const rows = await listCompaniesByPolicy({
      tenantId,
      eligibility: req.query.eligibility as any,
      hiringPolicy: req.query.hiringPolicy as any,
      relationship: req.query.relationship as any,
      reviewDue: req.query.reviewDue === 'true',
    });
    res.json({ companies: rows });
  } catch (error) {
    handleServiceError(error, res);
  }
});

router.post('/companies/bulk/policy', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { companyIds, ...input } = req.body as { companyIds: string[] } & PolicyWriteInput;
    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'companyIds must be a non-empty array.' });
      return;
    }
    const result = await bulkWriteCompanyPolicy(actorFrom(req), { companyIds, input });
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

router.get('/companies/duplicates', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const resolution = req.query.resolution as 'pending' | 'merged' | 'confirmed_separate' | undefined;
    const rows = await listDuplicates(tenantId, resolution);
    res.json({ duplicates: rows });
  } catch (error) {
    handleServiceError(error, res);
  }
});

router.post('/companies/duplicates/:id/resolve', requireTeamLead, async (req: Request, res: Response) => {
  try {
    const { resolution, reasonCode, evidence } = req.body as {
      resolution: 'merged' | 'confirmed_separate';
      reasonCode: string;
      evidence?: string;
    };
    const row = await resolveDuplicate(actorFrom(req), String(req.params.id), { resolution, reasonCode, evidence });
    res.json(row);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// ---------------------------------------------------------------------------
// Readiness (admin, read-only — PRD-005 §21.1)
// ---------------------------------------------------------------------------

router.get('/policy/readiness', requireAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const report = await getWizmatchPolicyReadiness(tenantId);
    res.json(report);
  } catch (error) {
    handleServiceError(error, res);
  }
});

export default router;
