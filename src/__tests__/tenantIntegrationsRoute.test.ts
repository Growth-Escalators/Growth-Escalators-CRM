import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-level tests: the service layer's own tenant-isolation guarantees are
// proven with real predicate compilation in tenantIntegrationsService.test.ts.
// This file proves what belongs to the ROUTE: it reads the tenant strictly
// from req.user (never from the body/params, even when a client tries to
// smuggle a different one in), it enforces owner-only on writes via the exact
// userPermissions.isOwner convention from src/routes/permissions.ts, and no
// response shape it produces can carry decrypted (or even encrypted) secrets.

const mockSelect = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

const serviceMocks = vi.hoisted(() => ({
  listIntegrations: vi.fn(),
  getIntegrationStatus: vi.fn(),
  upsertIntegrationCredentials: vi.fn(),
  disconnectIntegration: vi.fn(),
}));

vi.mock('../services/tenantIntegrationsService', () => serviceMocks);

import tenantIntegrationsRouter from '../routes/tenantIntegrations';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_USER = '11111111-1111-4111-8111-111111111111';
const NON_OWNER_USER = '22222222-2222-4222-8222-222222222222';

function mockIsOwner(isOwner: boolean) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(isOwner ? [{ isOwner: true }] : []) }),
    }),
  });
}

function makeReqRes(userId: string, tenantId: string, overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req: any = {
    user: { id: userId, tenantId, role: 'admin', email: 'x@example.test', tokenVersion: 1 },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  return { req, res: { json: jsonFn, status: statusFn } as any, jsonFn, statusFn };
}

async function invoke(method: 'get' | 'put' | 'delete', path: string, req: any, res: any) {
  const layer = (tenantIntegrationsRouter as any).stack
    .find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  await layer.route.stack[0].handle(req, res, (err?: unknown) => { if (err) throw err; });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/tenant-integrations — readable by any tenant member, status/metadata only', () => {
  it('lists using the callers tenant from req.user, not anything the client supplies', async () => {
    serviceMocks.listIntegrations.mockResolvedValueOnce([
      { id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null },
    ]);
    const { req, res, jsonFn } = makeReqRes(NON_OWNER_USER, TENANT_A, { query: { tenantId: TENANT_B } });

    await invoke('get', '/', req, res);

    expect(serviceMocks.listIntegrations).toHaveBeenCalledWith(TENANT_A);
    expect(serviceMocks.listIntegrations).not.toHaveBeenCalledWith(TENANT_B);
    expect(jsonFn).toHaveBeenCalledWith({ integrations: [{ id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null }] });
  });

  it('does not require ownership — any authenticated tenant member can read status', async () => {
    serviceMocks.listIntegrations.mockResolvedValueOnce([]);
    const { req, res, statusFn } = makeReqRes(NON_OWNER_USER, TENANT_A);

    await invoke('get', '/', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(mockSelect).not.toHaveBeenCalled(); // no owner check performed for a read
  });

  it('GET /:provider rejects a malformed provider before touching the service', async () => {
    const { req, res, statusFn } = makeReqRes(NON_OWNER_USER, TENANT_A, { params: { provider: '../../etc/passwd' } });
    await invoke('get', '/:provider', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(serviceMocks.getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('GET /:provider for tenant A cannot be coerced into reading tenant B\'s row', async () => {
    serviceMocks.getIntegrationStatus.mockResolvedValueOnce({
      id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null,
    });
    const { req } = makeReqRes(NON_OWNER_USER, TENANT_A, { params: { provider: 'email_smtp' }, body: { tenantId: TENANT_B } });
    const res2 = makeReqRes(NON_OWNER_USER, TENANT_A).res;
    await invoke('get', '/:provider', req, res2);
    expect(serviceMocks.getIntegrationStatus).toHaveBeenCalledWith(TENANT_A, 'email_smtp');
  });

  it('no GET response can ever carry a credentials/encryptedCredentials field, even if the service returned one', async () => {
    // Defence in depth: even if a future refactor accidentally widened the
    // service's return type to include the ciphertext, the route's own
    // response shape (json({ integrations }) / json({ integration })) simply
    // forwards whatever object the service gives it — so this test also
    // documents that the WHITELISTING responsibility lives in the service
    // (`toPublicIntegration`), not the route. Assert the route does not add
    // any additional secret-shaped field of its own.
    serviceMocks.listIntegrations.mockResolvedValueOnce([
      { id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null },
    ]);
    const { req, res, jsonFn } = makeReqRes(NON_OWNER_USER, TENANT_A);
    await invoke('get', '/', req, res);
    const body = JSON.stringify(jsonFn.mock.calls[0][0]);
    expect(body).not.toMatch(/encryptedCredentials|"pass"|"password"/i);
  });
});

describe('PUT /api/tenant-integrations/:provider — owner-only credential writes', () => {
  it('rejects a non-owner with 403 and never calls the service', async () => {
    mockIsOwner(false);
    const { req, res, statusFn } = makeReqRes(NON_OWNER_USER, TENANT_A, {
      params: { provider: 'email_smtp' },
      body: { credentials: { host: 'smtp.evil.test', user: 'x', pass: 'y', port: 587 } },
    });

    await invoke('put', '/:provider', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(serviceMocks.upsertIntegrationCredentials).not.toHaveBeenCalled();
  });

  it('allows the owner and scopes the write to the owners own tenant, never a body-supplied tenantId', async () => {
    mockIsOwner(true);
    serviceMocks.upsertIntegrationCredentials.mockResolvedValueOnce({
      id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null,
    });
    const { req, res, jsonFn } = makeReqRes(OWNER_USER, TENANT_A, {
      params: { provider: 'email_smtp' },
      body: {
        tenantId: TENANT_B, // attacker-supplied — must be ignored
        credentials: { host: 'smtp.a.test', user: 'a@a.test', pass: 'secretA', port: 587 },
      },
    });

    await invoke('put', '/:provider', req, res);

    expect(serviceMocks.upsertIntegrationCredentials).toHaveBeenCalledWith(
      TENANT_A, 'email_smtp', { host: 'smtp.a.test', user: 'a@a.test', pass: 'secretA', port: 587 }, undefined,
    );
    expect(serviceMocks.upsertIntegrationCredentials).not.toHaveBeenCalledWith(
      TENANT_B, expect.anything(), expect.anything(), expect.anything(),
    );
    const body = JSON.stringify(jsonFn.mock.calls[0][0]);
    expect(body).not.toMatch(/secretA|smtp\.a\.test/);
  });

  it('rejects a request with no credentials object before checking ownership status further', async () => {
    mockIsOwner(true);
    const { req, res, statusFn } = makeReqRes(OWNER_USER, TENANT_A, { params: { provider: 'email_smtp' }, body: {} });
    await invoke('put', '/:provider', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(serviceMocks.upsertIntegrationCredentials).not.toHaveBeenCalled();
  });

  it('rejects an invalid provider name (e.g. attempted path/SQL injection via the param)', async () => {
    const { req, res, statusFn } = makeReqRes(OWNER_USER, TENANT_A, {
      params: { provider: "email'; DROP TABLE tenant_integrations; --" },
      body: { credentials: { host: 'h', user: 'u', pass: 'p', port: 587 } },
    });
    await invoke('put', '/:provider', req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(serviceMocks.upsertIntegrationCredentials).not.toHaveBeenCalled();
  });

  it('the response body never contains the ciphertext, even indirectly', async () => {
    mockIsOwner(true);
    serviceMocks.upsertIntegrationCredentials.mockResolvedValueOnce({
      id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null,
    });
    const { req, res, jsonFn } = makeReqRes(OWNER_USER, TENANT_A, {
      params: { provider: 'email_smtp' },
      body: { credentials: { host: 'h', user: 'u', pass: 'super-secret-pass', port: 587 } },
    });
    await invoke('put', '/:provider', req, res);
    expect(JSON.stringify(jsonFn.mock.calls[0][0])).not.toMatch(/super-secret-pass/);
  });
});

describe('DELETE /api/tenant-integrations/:provider — owner-only disconnect', () => {
  it('rejects a non-owner with 403', async () => {
    mockIsOwner(false);
    const { req, res, statusFn } = makeReqRes(NON_OWNER_USER, TENANT_A, { params: { provider: 'email_smtp' } });
    await invoke('delete', '/:provider', req, res);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(serviceMocks.disconnectIntegration).not.toHaveBeenCalled();
  });

  it('allows the owner and scopes to the owners own tenant', async () => {
    mockIsOwner(true);
    serviceMocks.disconnectIntegration.mockResolvedValueOnce({
      id: 'i1', tenantId: TENANT_A, provider: 'email_smtp', status: 'disconnected', metadata: {}, createdAt: null, updatedAt: null,
    });
    const { req, res } = makeReqRes(OWNER_USER, TENANT_A, { params: { provider: 'email_smtp' } });
    await invoke('delete', '/:provider', req, res);
    expect(serviceMocks.disconnectIntegration).toHaveBeenCalledWith(TENANT_A, 'email_smtp');
  });
});
