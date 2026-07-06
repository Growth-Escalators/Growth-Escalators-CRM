import { describe, expect, it } from 'vitest';
import router from '../routes/wizmatch';

function routeExists(path: string, method: string) {
  return router.stack.some((layer: any) =>
    layer.route?.path === path && Boolean(layer.route.methods?.[method]),
  );
}

describe('Wizmatch Contact Intelligence routes', () => {
  it('registers read and manual-review write endpoints', () => {
    expect(routeExists('/client-discovery/queue', 'get')).toBe(true);
    expect(routeExists('/client-discovery/companies/:companyId', 'get')).toBe(true);
    expect(routeExists('/client-discovery/companies/:companyId/qualify', 'post')).toBe(true);
    expect(routeExists('/client-discovery/companies/:companyId/send-to-contact-intelligence', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/queue', 'get')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId', 'get')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId/snapshot', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId/review', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId/contacts/manual', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/contacts/:candidateId/review', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/contacts/:candidateId/link-crm-contact', 'post')).toBe(true);
    expect(routeExists('/candidate-intelligence/queue', 'get')).toBe(true);
    expect(routeExists('/candidate-intelligence/candidates/:candidateId', 'get')).toBe(true);
    expect(routeExists('/candidate-intelligence/requirements/:requirementId/matches', 'get')).toBe(true);
    expect(routeExists('/candidate-intelligence/candidates/:candidateId/review', 'post')).toBe(true);
  });
});
