import { Router, type Request, type Response } from 'express';
import { StaffingDomainError, wizmatchStaffingService } from '../services/wizmatchStaffingDomain';

const router = Router();

function actor(req: Request) {
  if (!req.user) throw new StaffingDomainError(401, 'unauthorised', 'Authentication is required');
  return { tenantId: req.user.tenantId, userId: req.user.id };
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

router.get('/staffing/my-work', async (req, res) => {
  try { const current = actor(req); return res.json(await wizmatchStaffingService.getMyWork(current.tenantId, current.userId)); }
  catch (error) { return handle(error, res); }
});

export default router;
