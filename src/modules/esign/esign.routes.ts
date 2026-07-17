// /api/contracts router. Mounted behind requireAuth in src/index.ts; each route
// additionally gated by a CONTRACTS_* permission (fail-closed via requirePermission).
// Static paths are declared before '/:id' so they aren't captured as an id.
import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac';
import { validateBody, validateParams } from '../../middleware/validate';
import * as c from './esign.controller';

const router = Router();
const idParam = validateParams({ id: 'uuid|required' });

// collection
router.get('/', requirePermission('CONTRACTS_VIEW'), c.listContracts);
router.get('/number/preview', requirePermission('CONTRACTS_CREATE'), c.previewNumber);
router.post(
  '/',
  requirePermission('CONTRACTS_CREATE'),
  validateBody({ title: 'string|required', clientCompanyId: 'uuid|optional', templateId: 'uuid|optional' }),
  c.createContract,
);

// single contract
router.get('/:id', requirePermission('CONTRACTS_VIEW'), idParam, c.getContract);
router.get('/:id/audit', requirePermission('CONTRACTS_VIEW_AUDIT'), idParam, c.getAudit);
router.get('/:id/download', requirePermission('CONTRACTS_DOWNLOAD'), idParam, c.downloadContract);
router.post(
  '/:id/recipients',
  requirePermission('CONTRACTS_EDIT'),
  idParam,
  validateBody({ recipients: 'array|required' }),
  c.addRecipients,
);
router.post('/:id/generate', requirePermission('CONTRACTS_EDIT'), idParam, c.generateContract);
router.post('/:id/approve', requirePermission('CONTRACTS_APPROVE'), idParam, c.approveContract);
router.post('/:id/send', requirePermission('CONTRACTS_SEND'), idParam, c.sendContract);
router.post(
  '/:id/void',
  requirePermission('CONTRACTS_VOID'),
  idParam,
  validateBody({ reason: 'string|required' }),
  c.voidContract,
);
router.post('/:id/clone', requirePermission('CONTRACTS_CREATE'), idParam, c.cloneContract);

export default router;
