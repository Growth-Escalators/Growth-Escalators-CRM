import { describe, expect, it } from 'vitest';
import router from '../routes/wizmatch';

function routeExists(path: string, method: string) {
  return router.stack.some((layer: any) =>
    layer.route?.path === path && Boolean(layer.route.methods?.[method]),
  );
}

describe('Wizmatch Contact Intelligence routes', () => {
  it('registers read and manual-review write endpoints', () => {
    expect(routeExists('/contact-intelligence/queue', 'get')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId', 'get')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId/snapshot', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId/review', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/companies/:companyId/contacts/manual', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/contacts/:candidateId/review', 'post')).toBe(true);
    expect(routeExists('/contact-intelligence/contacts/:candidateId/link-crm-contact', 'post')).toBe(true);
  });
});
