import { describe, expect, it } from 'vitest';
import router from '../routes/wizmatchStaffing';

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
