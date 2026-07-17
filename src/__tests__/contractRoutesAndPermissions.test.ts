import { describe, expect, it } from 'vitest';
import { hasPermission } from '../middleware/rbac';
import contractsRouter from '../modules/esign/esign.routes';

function routeExists(router: any, path: string, method: string): boolean {
  return router.stack.some(
    (layer: any) => layer.route?.path === path && Boolean(layer.route.methods?.[method]),
  );
}

describe('CONTRACTS_* permissions (fail-closed RBAC)', () => {
  it('grants view/download to admin and read-only viewer', () => {
    for (const perm of ['CONTRACTS_VIEW', 'CONTRACTS_DOWNLOAD']) {
      expect(hasPermission('admin', perm)).toBe(true);
      expect(hasPermission('viewer', perm)).toBe(true);
    }
  });

  it('restricts SEND / APPROVE / VOID to the right roles', () => {
    expect(hasPermission('manager_ops', 'CONTRACTS_SEND')).toBe(true);
    expect(hasPermission('sales', 'CONTRACTS_SEND')).toBe(false);
    // approve + void are admin-only
    expect(hasPermission('admin', 'CONTRACTS_APPROVE')).toBe(true);
    expect(hasPermission('manager_ops', 'CONTRACTS_APPROVE')).toBe(false);
    expect(hasPermission('admin', 'CONTRACTS_VOID')).toBe(true);
    expect(hasPermission('team_lead', 'CONTRACTS_VOID')).toBe(false);
    // template management admin-only
    expect(hasPermission('admin', 'CONTRACTS_MANAGE_TEMPLATES')).toBe(true);
    expect(hasPermission('manager_ops', 'CONTRACTS_MANAGE_TEMPLATES')).toBe(false);
  });

  it('denies sales/staff from creating; denies an unknown permission (fail-closed)', () => {
    expect(hasPermission('staff', 'CONTRACTS_CREATE')).toBe(false);
    expect(hasPermission('team_lead', 'CONTRACTS_CREATE')).toBe(true);
    expect(hasPermission('admin', 'CONTRACTS_BOGUS')).toBe(false);
  });
});

describe('/api/contracts router registration', () => {
  it('mounts the collection + lifecycle routes with correct verbs', () => {
    expect(routeExists(contractsRouter, '/', 'get')).toBe(true);
    expect(routeExists(contractsRouter, '/', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/number/preview', 'get')).toBe(true);
    expect(routeExists(contractsRouter, '/:id', 'get')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/audit', 'get')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/download', 'get')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/recipients', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/generate', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/upload', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/approve', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/send', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/void', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/clone', 'post')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/file/:artifact', 'get')).toBe(true);
    expect(routeExists(contractsRouter, '/:id/recipients/:rid/signing-link', 'post')).toBe(true);
  });

  it('declares /number/preview before the /:id catch-all', () => {
    const paths = contractsRouter.stack.filter((l: any) => l.route).map((l: any) => l.route.path);
    expect(paths.indexOf('/number/preview')).toBeLessThan(paths.indexOf('/:id'));
  });
});
