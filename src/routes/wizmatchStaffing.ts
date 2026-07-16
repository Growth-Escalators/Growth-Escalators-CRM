import { Router, type Request, type Response } from 'express';
import { StaffingDomainError, wizmatchStaffingService } from '../services/wizmatchStaffingDomain';
import { createSignedR2Url } from '../utils/r2';
import { pool } from '../db';
import { MATCH_DECISIONS, wizmatchMatchingService } from '../services/wizmatchMatchingDomain';
import { wizmatchDeliveryService } from '../services/wizmatchDeliveryDomain';
import multer from 'multer';
import { uploadPrivateToR2 } from '../utils/r2';
import {
  assignedRequirementIds,
  requireCandidateAccess,
  requireRequirementAccess,
  requireStaffingPilot,
  requireStaffingRole,
  requirementForResource,
  resolveStaffingAccess,
  type StaffingActor,
} from '../services/wizmatchStaffingAccess';

const router = Router();
const consentDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, done) => done(null, ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype)),
});

export function isStaffingPhaseEnabled(phase: 'A' | 'B' | 'C'): boolean {
  const key = `WIZMATCH_STAFFING_GATE_${phase}_ENABLED`;
  const configured = process.env[key];
  if (configured !== undefined) return ['1', 'true', 'yes', 'on'].includes(configured.toLowerCase());
  return process.env.NODE_ENV !== 'production';
}

function actor(req: Request): StaffingActor {
  if (!req.user) throw new StaffingDomainError(401, 'unauthorised', 'Authentication is required');
  return { tenantId: req.user.tenantId, userId: req.user.id, role: req.user.role };
}

router.get('/staffing/access', (req, res) => {
  try { return res.json(resolveStaffingAccess(actor(req))); }
  catch (error) { return handle(error, res); }
});

const STAFFING_PATH = /^\/staffing(?:\/|$)|^\/companies\/[^/]+\/contacts(?:\/|$)|^\/requirements\/[^/]+\/(?:contacts|assignments|transition|next-action|timeline|documents)(?:\/|$)/;

router.use((req, res, next) => {
  if (!STAFFING_PATH.test(req.path)) return next();
  if (!isStaffingPhaseEnabled('A')) return res.status(404).json({ error: 'staffing_phase_disabled' });
  try {
    requireStaffingPilot(actor(req));
    return next();
  } catch (error) { return handle(error, res); }
});

function requireLead(req: Request) {
  const current = actor(req);
  return requireStaffingRole(current, ['admin', 'team_lead'], 'Team lead or admin approval is required');
}

const RELATIONSHIP_ROLES = ['admin', 'team_lead', 'manager_ops', 'sales'] as const;
const ASSIGNMENT_ROLES = ['admin', 'team_lead', 'manager_ops'] as const;
const CANDIDATE_ROLES = ['admin', 'team_lead', 'manager_ops', 'staff'] as const;
const DELIVERY_ROLES = ['admin', 'team_lead', 'staff'] as const;
const DELIVERY_READ_ROLES = ['admin', 'team_lead', 'manager_ops', 'staff'] as const;

function requireRelationshipRole(req: Request) {
  return requireStaffingRole(actor(req), RELATIONSHIP_ROLES, 'Company and hiring-contact management requires an account, operations, lead or admin role');
}

function requireAssignmentRole(req: Request) {
  return requireStaffingRole(actor(req), ASSIGNMENT_ROLES, 'Requirement assignments require an operations, lead or admin role');
}

function requireCandidateRole(req: Request) {
  return requireStaffingRole(actor(req), CANDIDATE_ROLES, 'Candidate evidence and matching require a recruiter, operations, lead or admin role');
}

function requireDeliveryRole(req: Request) {
  return requireStaffingRole(actor(req), DELIVERY_ROLES, 'Delivery work requires an assigned recruiter, team lead or admin role');
}

function requireAdmin(req: Request) {
  const current = actor(req);
  if (current.role !== 'admin') throw new StaffingDomainError(403, 'forbidden', 'Admin or finance approval is required');
  return current;
}

function requirePhase(phase: 'B' | 'C') {
  return (_req: Request, res: Response, next: () => void) => {
    if (!isStaffingPhaseEnabled(phase)) return res.status(404).json({ error: 'staffing_phase_disabled' });
    return next();
  };
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function handle(error: unknown, res: Response) {
  if (error instanceof StaffingDomainError) {
    return res.status(error.status).json({ error: error.code, message: error.message });
  }
  const pgError = error as { code?: string };
  if (pgError?.code === '23503') return res.status(400).json({ error: 'invalid_reference', message: 'A referenced record is invalid' });
  console.error('[WIZMATCH STAFFING]', error);
  return res.status(500).json({ error: 'staffing_operation_failed' });
}

router.get('/staffing/companies', async (req, res) => {
  try { const current = requireRelationshipRole(req); return res.json({ items: await wizmatchStaffingService.listCompanies(current.tenantId, String(req.query.search ?? '')) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/users', async (req, res) => {
  try { const current = requireAssignmentRole(req); return res.json({ items: await wizmatchStaffingService.listUsers(current.tenantId) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/contacts', async (req, res) => {
  try { const current = requireRelationshipRole(req); return res.json({ items: await wizmatchStaffingService.searchContacts(current.tenantId, String(req.query.search ?? '')) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/hiring-contacts', async (req, res) => {
  try { const current = requireRelationshipRole(req); return res.json({ items: await wizmatchStaffingService.listHiringContacts(current.tenantId, String(req.query.search ?? '')) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/companies/:companyId', async (req, res) => {
  try { const current = requireRelationshipRole(req); return res.json(await wizmatchStaffingService.getCompany360(current.tenantId, req.params.companyId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/company-contacts/:companyContactId', async (req, res) => {
  try { const current = requireRelationshipRole(req); return res.json(await wizmatchStaffingService.getCompanyContact360(current.tenantId, req.params.companyContactId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/requirements/:requirementId', async (req, res) => {
  try { const current = actor(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json(await wizmatchStaffingService.getRequirement360(current.tenantId, req.params.requirementId)); }
  catch (error) { return handle(error, res); }
});

router.get('/companies/:companyId/contacts', async (req, res) => {
  try { const current = requireRelationshipRole(req); return res.json({ items: await wizmatchStaffingService.listCompanyContacts(current.tenantId, req.params.companyId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/companies/:companyId/contacts', async (req, res) => {
  try { return res.status(201).json(await wizmatchStaffingService.createCompanyContact(requireRelationshipRole(req), req.params.companyId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/companies/:companyId/contacts/:companyContactId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.updateCompanyContact(requireRelationshipRole(req), req.params.companyId, req.params.companyContactId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.delete('/companies/:companyId/contacts/:companyContactId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.deactivateCompanyContact(requireRelationshipRole(req), req.params.companyId, req.params.companyContactId)); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/contacts', async (req, res) => {
  try { const current = actor(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json({ items: await wizmatchStaffingService.listRequirementContacts(current.tenantId, req.params.requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/contacts', async (req, res) => {
  try { const current = requireRelationshipRole(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.status(201).json(await wizmatchStaffingService.addRequirementContact(current, req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/requirements/:requirementId/contacts/:attributionId', async (req, res) => {
  try { const current = requireRelationshipRole(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json(await wizmatchStaffingService.updateRequirementContact(current, req.params.requirementId, req.params.attributionId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.delete('/requirements/:requirementId/contacts/:attributionId', async (req, res) => {
  try { const current = requireRelationshipRole(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json(await wizmatchStaffingService.deactivateRequirementContact(current, req.params.requirementId, req.params.attributionId)); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/assignments', async (req, res) => {
  try { const current = actor(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json({ items: await wizmatchStaffingService.listAssignments(current.tenantId, req.params.requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/assignments', async (req, res) => {
  try { const current = requireAssignmentRole(req); return res.status(201).json(await wizmatchStaffingService.addAssignment(current, req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/requirements/:requirementId/assignments/:assignmentId', async (req, res) => {
  try { const current = requireAssignmentRole(req); return res.json(await wizmatchStaffingService.updateAssignment(current, req.params.requirementId, req.params.assignmentId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.delete('/requirements/:requirementId/assignments/:assignmentId', async (req, res) => {
  try { const current = requireAssignmentRole(req); return res.json(await wizmatchStaffingService.deactivateAssignment(current, req.params.requirementId, req.params.assignmentId)); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/transition', async (req, res) => {
  try { const current = actor(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json(await wizmatchStaffingService.transitionRequirement(current, req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/next-action', async (req, res) => {
  try { const current = actor(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.status(201).json(await wizmatchStaffingService.setNextAction(current, req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/timeline', async (req, res) => {
  try { const current = actor(req); await requireRequirementAccess(pool, current, req.params.requirementId); return res.json({ items: await wizmatchStaffingService.getTimeline(current.tenantId, req.params.requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/documents/:kind/access', async (req, res) => {
  try {
    const current = actor(req);
    await requireRequirementAccess(pool, current, req.params.requirementId);
    if (!['source', 'sheet'].includes(req.params.kind)) throw new StaffingDomainError(400, 'validation_error', 'Document kind is invalid');
    const column = req.params.kind === 'source' ? 'source_file_url' : 'sheet_url';
    const result = await pool.query(
      `SELECT ${column} AS reference FROM wizmatch_requirements WHERE tenant_id=$1 AND id=$2`,
      [current.tenantId, req.params.requirementId],
    );
    if (!result.rowCount || !result.rows[0].reference) throw new StaffingDomainError(404, 'not_found', 'Document was not found');
    const url = await createSignedR2Url(result.rows[0].reference, 300);
    return res.json({ url, expiresInSeconds: 300 });
  } catch (error) { return handle(error, res); }
});

router.get('/staffing/my-work', async (req, res) => {
  try { const current = actor(req); return res.json(await wizmatchStaffingService.getMyWork(current.tenantId, current.userId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/skills', requirePhase('B'), async (req, res) => {
  try { return res.json({ items: await wizmatchMatchingService.listSkills(actor(req).tenantId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/skills', requirePhase('B'), async (req, res) => {
  try { return res.status(201).json(await wizmatchMatchingService.createSkill(requireLead(req), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/skills/seed-pilot', requirePhase('B'), async (req, res) => {
  try { return res.json(await wizmatchMatchingService.seedPilotTaxonomy(requireLead(req))); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/skills/:skillId/aliases', requirePhase('B'), async (req, res) => {
  try { return res.status(201).json(await wizmatchMatchingService.addAlias(requireLead(req), routeParam(req.params.skillId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/staffing/requirements/:requirementId/skills', requirePhase('B'), async (req, res) => {
  try { const current = requireCandidateRole(req); const requirementId = routeParam(req.params.requirementId); await requireRequirementAccess(pool, current, requirementId); return res.json(await wizmatchMatchingService.replaceRequirementSkills(current, requirementId, Array.isArray(req.body?.skills) ? req.body.skills : [])); }
  catch (error) { return handle(error, res); }
});

router.put('/staffing/candidates/:candidateId/skills', requirePhase('B'), async (req, res) => {
  try { const current = requireCandidateRole(req); const candidateId = routeParam(req.params.candidateId); await requireCandidateAccess(pool, current, candidateId); return res.json(await wizmatchMatchingService.replaceCandidateSkills(current, candidateId, Array.isArray(req.body?.skills) ? req.body.skills : [])); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/requirements/:requirementId/matches/recalculate', requirePhase('B'), async (req, res) => {
  try { const current = requireCandidateRole(req); const requirementId = routeParam(req.params.requirementId); await requireRequirementAccess(pool, current, requirementId); return res.json(await wizmatchMatchingService.recalculateRequirement(current, requirementId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/requirements/:requirementId/matches', requirePhase('B'), async (req, res) => {
  try { const current = requireCandidateRole(req); const requirementId = routeParam(req.params.requirementId); await requireRequirementAccess(pool, current, requirementId); return res.json({ items: await wizmatchMatchingService.listRequirementMatches(current.tenantId, requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/matches/:matchId/decision', requirePhase('B'), async (req, res) => {
  try {
    const current = requireCandidateRole(req);
    if (!MATCH_DECISIONS.includes(req.body?.decision)) throw new StaffingDomainError(400, 'validation_error', 'Decision is invalid');
    const matchId = routeParam(req.params.matchId);
    await requireRequirementAccess(pool, current, await requirementForResource(pool, current, 'match', matchId));
    return res.json(await wizmatchMatchingService.decide(current, matchId, req.body ?? {}));
  } catch (error) { return handle(error, res); }
});

router.get('/staffing/candidates/:candidateId', requirePhase('B'), async (req, res) => {
  try {
    const current = requireCandidateRole(req);
    const candidateId = routeParam(req.params.candidateId);
    await requireCandidateAccess(pool, current, candidateId);
    const detail = await wizmatchMatchingService.candidate360(current.tenantId, candidateId);
    const requirementIds = await assignedRequirementIds(pool, current);
    if (requirementIds) detail.matches = detail.matches.filter((match: { requirement_id: string }) => requirementIds.has(String(match.requirement_id)));
    return res.json(detail);
  }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/recruiter-work', requirePhase('B'), async (req, res) => {
  try { const current = requireCandidateRole(req); return res.json(await wizmatchMatchingService.recruiterWork(current.tenantId, current.userId)); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/consents', requirePhase('C'), async (req, res) => {
  try { const current = requireDeliveryRole(req); await requireRequirementAccess(pool, current, String(req.body?.requirementId || '')); return res.status(201).json(await wizmatchDeliveryService.createConsent(current, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/consent-documents', requirePhase('C'), consentDocumentUpload.single('file'), async (req, res) => {
  try {
    const current = requireDeliveryRole(req);
    if (!req.file) throw new StaffingDomainError(400, 'validation_error', 'A PDF, DOC or DOCX consent document is required');
    const reference = await uploadPrivateToR2(req.file.buffer, `wizmatch/consents/${current.tenantId}/${Date.now()}-${req.file.originalname || 'consent-document'}`, req.file.mimetype);
    return res.status(201).json({ reference, access: 'private_signed_only' });
  } catch (error) { return handle(error, res); }
});

router.post('/staffing/consents/:consentId/grant', requirePhase('C'), async (req, res) => {
  try { const current = requireDeliveryRole(req); const consentId = routeParam(req.params.consentId); await requireRequirementAccess(pool, current, await requirementForResource(pool, current, 'consent', consentId)); return res.json(await wizmatchDeliveryService.grantConsent(current, consentId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/consents/:consentId/revoke', requirePhase('C'), async (req, res) => {
  try { const current = requireDeliveryRole(req); const consentId = routeParam(req.params.consentId); await requireRequirementAccess(pool, current, await requirementForResource(pool, current, 'consent', consentId)); return res.json(await wizmatchDeliveryService.revokeConsent(current, consentId, req.body?.reason)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/consents/:consentId/document/access', requirePhase('C'), async (req, res) => {
  try {
    const current = actor(req);
    const consentId = routeParam(req.params.consentId);
    requireStaffingRole(current, DELIVERY_READ_ROLES, 'Consent documents require a delivery, operations, lead or admin role');
    await requireRequirementAccess(pool, current, await requirementForResource(pool, current, 'consent', consentId));
    const result = await pool.query(`SELECT document_reference FROM wizmatch_candidate_consents WHERE tenant_id=$1 AND id=$2`, [current.tenantId, consentId]);
    if (!result.rowCount || !result.rows[0].document_reference) throw new StaffingDomainError(404, 'not_found', 'Consent document was not found');
    return res.json({ url: await createSignedR2Url(result.rows[0].document_reference, 300), expiresInSeconds: 300 });
  } catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions', requirePhase('C'), async (req, res) => {
  try { const current = requireDeliveryRole(req); await requireRequirementAccess(pool, current, String(req.body?.requirementId || '')); return res.status(201).json(await wizmatchDeliveryService.createSubmissionDraft(current, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions/:submissionId/approve', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.approveSubmission(requireLead(req), routeParam(req.params.submissionId))); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions/:submissionId/record-sent', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.recordSent(requireLead(req), routeParam(req.params.submissionId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions/:submissionId/withdraw', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.withdrawSubmission(requireLead(req), routeParam(req.params.submissionId), req.body?.reason)); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions/:submissionId/interviews', requirePhase('C'), async (req, res) => {
  try { const current = requireDeliveryRole(req); const submissionId = routeParam(req.params.submissionId); await requireRequirementAccess(pool, current, await requirementForResource(pool, current, 'submission', submissionId)); return res.status(201).json(await wizmatchDeliveryService.addInterview(current, submissionId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/staffing/interviews/:interviewId', requirePhase('C'), async (req, res) => {
  try { const current = requireDeliveryRole(req); const interviewId = routeParam(req.params.interviewId); await requireRequirementAccess(pool, current, await requirementForResource(pool, current, 'interview', interviewId)); return res.json(await wizmatchDeliveryService.updateInterview(current, interviewId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions/:submissionId/offers', requirePhase('C'), async (req, res) => {
  try { return res.status(201).json(await wizmatchDeliveryService.addOffer(requireLead(req), routeParam(req.params.submissionId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/staffing/offers/:offerId/status', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.updateOfferStatus(requireLead(req), routeParam(req.params.offerId), req.body?.status)); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions/:submissionId/placement', requirePhase('C'), async (req, res) => {
  try { return res.status(201).json(await wizmatchDeliveryService.createPlacement(requireAdmin(req), routeParam(req.params.submissionId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/placements/:placementId/link-invoice', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.linkInvoice(requireAdmin(req), routeParam(req.params.placementId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/placements/:placementId/adjustments', requirePhase('C'), async (req, res) => {
  try { return res.status(201).json(await wizmatchDeliveryService.createAdjustment(requireAdmin(req), routeParam(req.params.placementId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/adjustments/:adjustmentId/resolve', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.resolveAdjustment(requireAdmin(req), routeParam(req.params.adjustmentId))); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/delivery-board', requirePhase('C'), async (req, res) => {
  try {
    const current = requireStaffingRole(actor(req), DELIVERY_READ_ROLES, 'Delivery access requires a recruiter, operations, lead or admin role');
    const board = await wizmatchDeliveryService.deliveryBoard(current.tenantId);
    const requirementIds = await assignedRequirementIds(pool, current);
    if (requirementIds) board.items = board.items.filter((item: { requirement_id: string }) => requirementIds.has(String(item.requirement_id)));
    return res.json(board);
  }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/placements', requirePhase('C'), async (req, res) => {
  try { const current = requireLead(req); return res.json(await wizmatchDeliveryService.listPlacements(current.tenantId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/analytics', requirePhase('C'), async (req, res) => {
  try {
    const current = requireLead(req);
    return res.json(await wizmatchDeliveryService.analytics(current.tenantId, {
      from: req.query.from,
      to: req.query.to,
      companyId: req.query.companyId,
      recruiterId: req.query.recruiterId,
      skillId: req.query.skillId,
      source: req.query.source,
    }));
  }
  catch (error) { return handle(error, res); }
});

export default router;
