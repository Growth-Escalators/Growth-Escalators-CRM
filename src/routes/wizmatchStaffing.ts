import { Router, type Request, type Response } from 'express';
import { StaffingDomainError, wizmatchStaffingService } from '../services/wizmatchStaffingDomain';
import { createSignedR2Url } from '../utils/r2';
import { pool } from '../db';
import { MATCH_DECISIONS, wizmatchMatchingService } from '../services/wizmatchMatchingDomain';
import { wizmatchDeliveryService } from '../services/wizmatchDeliveryDomain';
import multer from 'multer';
import { uploadPrivateToR2 } from '../utils/r2';

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

router.use((req, res, next) => {
  if (!isStaffingPhaseEnabled('A')) return res.status(404).json({ error: 'staffing_phase_disabled' });
  return next();
});

function actor(req: Request) {
  if (!req.user) throw new StaffingDomainError(401, 'unauthorised', 'Authentication is required');
  return { tenantId: req.user.tenantId, userId: req.user.id, role: req.user.role };
}

function requireLead(req: Request) {
  const current = actor(req);
  if (!['admin', 'team_lead'].includes(current.role)) throw new StaffingDomainError(403, 'forbidden', 'Team lead or admin approval is required');
  return current;
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
  try { return res.json({ items: await wizmatchStaffingService.listCompanies(actor(req).tenantId, String(req.query.search ?? '')) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/users', async (req, res) => {
  try { return res.json({ items: await wizmatchStaffingService.listUsers(actor(req).tenantId) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/contacts', async (req, res) => {
  try { return res.json({ items: await wizmatchStaffingService.searchContacts(actor(req).tenantId, String(req.query.search ?? '')) }); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/companies/:companyId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.getCompany360(actor(req).tenantId, req.params.companyId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/company-contacts/:companyContactId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.getCompanyContact360(actor(req).tenantId, req.params.companyContactId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/requirements/:requirementId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.getRequirement360(actor(req).tenantId, req.params.requirementId)); }
  catch (error) { return handle(error, res); }
});

router.get('/companies/:companyId/contacts', async (req, res) => {
  try { return res.json({ items: await wizmatchStaffingService.listCompanyContacts(actor(req).tenantId, req.params.companyId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/companies/:companyId/contacts', async (req, res) => {
  try { return res.status(201).json(await wizmatchStaffingService.createCompanyContact(actor(req), req.params.companyId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/companies/:companyId/contacts/:companyContactId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.updateCompanyContact(actor(req), req.params.companyId, req.params.companyContactId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.delete('/companies/:companyId/contacts/:companyContactId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.deactivateCompanyContact(actor(req), req.params.companyId, req.params.companyContactId)); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/contacts', async (req, res) => {
  try { return res.json({ items: await wizmatchStaffingService.listRequirementContacts(actor(req).tenantId, req.params.requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/contacts', async (req, res) => {
  try { return res.status(201).json(await wizmatchStaffingService.addRequirementContact(actor(req), req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/requirements/:requirementId/contacts/:attributionId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.updateRequirementContact(actor(req), req.params.requirementId, req.params.attributionId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.delete('/requirements/:requirementId/contacts/:attributionId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.deactivateRequirementContact(actor(req), req.params.requirementId, req.params.attributionId)); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/assignments', async (req, res) => {
  try { return res.json({ items: await wizmatchStaffingService.listAssignments(actor(req).tenantId, req.params.requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/assignments', async (req, res) => {
  try { return res.status(201).json(await wizmatchStaffingService.addAssignment(actor(req), req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/requirements/:requirementId/assignments/:assignmentId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.updateAssignment(actor(req), req.params.requirementId, req.params.assignmentId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.delete('/requirements/:requirementId/assignments/:assignmentId', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.deactivateAssignment(actor(req), req.params.requirementId, req.params.assignmentId)); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/transition', async (req, res) => {
  try { return res.json(await wizmatchStaffingService.transitionRequirement(actor(req), req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/requirements/:requirementId/next-action', async (req, res) => {
  try { return res.status(201).json(await wizmatchStaffingService.setNextAction(actor(req), req.params.requirementId, req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/timeline', async (req, res) => {
  try { return res.json({ items: await wizmatchStaffingService.getTimeline(actor(req).tenantId, req.params.requirementId) }); }
  catch (error) { return handle(error, res); }
});

router.get('/requirements/:requirementId/documents/:kind/access', async (req, res) => {
  try {
    const current = actor(req);
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
  try { return res.json(await wizmatchMatchingService.replaceRequirementSkills(actor(req), routeParam(req.params.requirementId), Array.isArray(req.body?.skills) ? req.body.skills : [])); }
  catch (error) { return handle(error, res); }
});

router.put('/staffing/candidates/:candidateId/skills', requirePhase('B'), async (req, res) => {
  try { return res.json(await wizmatchMatchingService.replaceCandidateSkills(actor(req), routeParam(req.params.candidateId), Array.isArray(req.body?.skills) ? req.body.skills : [])); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/requirements/:requirementId/matches/recalculate', requirePhase('B'), async (req, res) => {
  try { return res.json(await wizmatchMatchingService.recalculateRequirement(actor(req), routeParam(req.params.requirementId))); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/requirements/:requirementId/matches', requirePhase('B'), async (req, res) => {
  try { return res.json({ items: await wizmatchMatchingService.listRequirementMatches(actor(req).tenantId, routeParam(req.params.requirementId)) }); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/matches/:matchId/decision', requirePhase('B'), async (req, res) => {
  try {
    if (!MATCH_DECISIONS.includes(req.body?.decision)) throw new StaffingDomainError(400, 'validation_error', 'Decision is invalid');
    return res.json(await wizmatchMatchingService.decide(actor(req), routeParam(req.params.matchId), req.body ?? {}));
  } catch (error) { return handle(error, res); }
});

router.get('/staffing/candidates/:candidateId', requirePhase('B'), async (req, res) => {
  try { return res.json(await wizmatchMatchingService.candidate360(actor(req).tenantId, routeParam(req.params.candidateId))); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/recruiter-work', requirePhase('B'), async (req, res) => {
  try { const current = actor(req); return res.json(await wizmatchMatchingService.recruiterWork(current.tenantId, current.userId)); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/consents', requirePhase('C'), async (req, res) => {
  try { return res.status(201).json(await wizmatchDeliveryService.createConsent(actor(req), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/consent-documents', requirePhase('C'), consentDocumentUpload.single('file'), async (req, res) => {
  try {
    const current = actor(req);
    if (!req.file) throw new StaffingDomainError(400, 'validation_error', 'A PDF, DOC or DOCX consent document is required');
    const reference = await uploadPrivateToR2(req.file.buffer, `wizmatch/consents/${current.tenantId}/${Date.now()}-${req.file.originalname || 'consent-document'}`, req.file.mimetype);
    return res.status(201).json({ reference, access: 'private_signed_only' });
  } catch (error) { return handle(error, res); }
});

router.post('/staffing/consents/:consentId/grant', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.grantConsent(actor(req), routeParam(req.params.consentId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.post('/staffing/consents/:consentId/revoke', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.revokeConsent(actor(req), routeParam(req.params.consentId), req.body?.reason)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/consents/:consentId/document/access', requirePhase('C'), async (req, res) => {
  try {
    const current = actor(req);
    const result = await pool.query(`SELECT document_reference FROM wizmatch_candidate_consents WHERE tenant_id=$1 AND id=$2`, [current.tenantId, routeParam(req.params.consentId)]);
    if (!result.rowCount || !result.rows[0].document_reference) throw new StaffingDomainError(404, 'not_found', 'Consent document was not found');
    return res.json({ url: await createSignedR2Url(result.rows[0].document_reference, 300), expiresInSeconds: 300 });
  } catch (error) { return handle(error, res); }
});

router.post('/staffing/submissions', requirePhase('C'), async (req, res) => {
  try { return res.status(201).json(await wizmatchDeliveryService.createSubmissionDraft(actor(req), req.body ?? {})); }
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
  try { return res.status(201).json(await wizmatchDeliveryService.addInterview(actor(req), routeParam(req.params.submissionId), req.body ?? {})); }
  catch (error) { return handle(error, res); }
});

router.put('/staffing/interviews/:interviewId', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.updateInterview(actor(req), routeParam(req.params.interviewId), req.body ?? {})); }
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
  try { return res.json(await wizmatchDeliveryService.deliveryBoard(actor(req).tenantId)); }
  catch (error) { return handle(error, res); }
});

router.get('/staffing/analytics', requirePhase('C'), async (req, res) => {
  try { return res.json(await wizmatchDeliveryService.analytics(actor(req).tenantId)); }
  catch (error) { return handle(error, res); }
});

export default router;
