import { describe, expect, it } from 'vitest';
import router, { isStaffingPhaseEnabled } from '../routes/wizmatchStaffing';

function routeExists(path: string, method: string) {
  return router.stack.some((layer: any) => layer.route?.path === path && Boolean(layer.route.methods?.[method]));
}

describe('Wizmatch staffing Gate A routes', () => {
  it('registers the operating workspaces and relationship CRUD contract', () => {
    const routes = [
      ['/staffing/companies', 'get'], ['/staffing/users', 'get'], ['/staffing/contacts', 'get'],
      ['/staffing/companies/:companyId', 'get'], ['/staffing/company-contacts/:companyContactId', 'get'],
      ['/staffing/requirements/:requirementId', 'get'], ['/staffing/my-work', 'get'],
      ['/companies/:companyId/contacts', 'get'], ['/companies/:companyId/contacts', 'post'],
      ['/companies/:companyId/contacts/:companyContactId', 'put'], ['/companies/:companyId/contacts/:companyContactId', 'delete'],
      ['/requirements/:requirementId/contacts', 'get'], ['/requirements/:requirementId/contacts', 'post'],
      ['/requirements/:requirementId/contacts/:attributionId', 'put'], ['/requirements/:requirementId/contacts/:attributionId', 'delete'],
      ['/requirements/:requirementId/assignments', 'get'], ['/requirements/:requirementId/assignments', 'post'],
      ['/requirements/:requirementId/assignments/:assignmentId', 'put'], ['/requirements/:requirementId/assignments/:assignmentId', 'delete'],
      ['/requirements/:requirementId/transition', 'post'], ['/requirements/:requirementId/next-action', 'post'],
      ['/requirements/:requirementId/timeline', 'get'],
    ];
    for (const [path, method] of routes) expect(routeExists(path, method), `${method.toUpperCase()} ${path}`).toBe(true);
  });
});

describe('Wizmatch staffing Gate B/C routes', () => {
  it('registers canonical matching and delivery contracts', () => {
    const routes = [
      ['/staffing/skills','get'], ['/staffing/skills','post'], ['/staffing/skills/seed-pilot','post'],
      ['/staffing/requirements/:requirementId/skills','put'], ['/staffing/candidates/:candidateId/skills','put'],
      ['/staffing/requirements/:requirementId/matches/recalculate','post'], ['/staffing/requirements/:requirementId/matches','get'],
      ['/staffing/matches/:matchId/decision','post'], ['/staffing/recruiter-work','get'],
      ['/staffing/consents','post'], ['/staffing/consent-documents','post'], ['/staffing/consents/:consentId/grant','post'], ['/staffing/consents/:consentId/revoke','post'],
      ['/staffing/submissions','post'], ['/staffing/submissions/:submissionId/approve','post'],
      ['/staffing/submissions/:submissionId/record-sent','post'], ['/staffing/submissions/:submissionId/interviews','post'],
      ['/staffing/submissions/:submissionId/withdraw','post'],
      ['/staffing/interviews/:interviewId','put'], ['/staffing/submissions/:submissionId/offers','post'],
      ['/staffing/offers/:offerId/status','put'], ['/staffing/submissions/:submissionId/placement','post'],
      ['/staffing/placements/:placementId/link-invoice','post'], ['/staffing/delivery-board','get'], ['/staffing/analytics','get'],
      ['/staffing/placements/:placementId/adjustments','post'], ['/staffing/adjustments/:adjustmentId/resolve','post'],
    ];
    for (const [path, method] of routes) expect(routeExists(path, method), `${method.toUpperCase()} ${path}`).toBe(true);
  });

  it('defaults every phase off in production and honors explicit flags', () => {
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.WIZMATCH_STAFFING_GATE_A_ENABLED;
    expect(isStaffingPhaseEnabled('A')).toBe(false);
    process.env.WIZMATCH_STAFFING_GATE_A_ENABLED = 'true';
    expect(isStaffingPhaseEnabled('A')).toBe(true);
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    delete process.env.WIZMATCH_STAFFING_GATE_A_ENABLED;
  });
});
