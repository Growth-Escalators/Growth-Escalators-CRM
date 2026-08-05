// src/routes/tenantIntegrations.ts is the backend half of the new
// IntegrationsPage.jsx "Other integrations" section (PR: tenant-integrations
// UI). tenantIntegrationsService.test.ts already proves the SERVICE layer
// never returns a credential value (encrypted or otherwise) from any read.
// This file covers the ROUTE layer specifically — the two things the UI work
// depends on and must not accidentally weaken:
//
//   1. A PUT that sets credentials never echoes them back in its own
//      response, and a subsequent GET never returns them either (round trip
//      through the real route handlers, service mocked to isolate route
//      behaviour from the already-tested encryption/storage layer).
//   2. PUT/DELETE are rejected 403 for a non-owner by the route's OWN
//      isOwner() check (real `db.select` chain faked, not bypassed) — the
//      new frontend only hides the buttons for a non-owner; this proves the
//      server-side gate a non-owner would hit if they called the API
//      directly is still intact and is what actually blocks the write.
//
// Reads (GET) are intentionally left open to any authenticated tenant member
// — also asserted below — matching src/routes/tenantIntegrations.ts's own
// header comment.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_USER = 'user-owner-1';
const MEMBER_USER = 'user-member-1';

let ownerFixture = true;
const mockDbSelect = vi.fn();

vi.mock('../db/index', () => ({
  db: { select: (...args: unknown[]) => mockDbSelect(...args) },
}));

const mockListIntegrations = vi.fn();
const mockGetIntegrationStatus = vi.fn();
const mockUpsert = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../services/tenantIntegrationsService', () => ({
  listIntegrations: (...args: unknown[]) => mockListIntegrations(...args),
  getIntegrationStatus: (...args: unknown[]) => mockGetIntegrationStatus(...args),
  upsertIntegrationCredentials: (...args: unknown[]) => mockUpsert(...args),
  disconnectIntegration: (...args: unknown[]) => mockDisconnect(...args),
}));

function dbSelectChain() {
  // The route's isOwner() only ever does
  // db.select().from(userPermissions).where(eq(userId, ...)).limit(1) — a
  // single flat lookup, so a fixture-driven fake (no real predicate
  // evaluation) is enough; the value under test is ownerFixture, not the
  // query shape.
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(ownerFixture ? [{ isOwner: true }] : [{ isOwner: false }]),
      }),
    }),
  };
}

function invokeRouteHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

function reqAs(userId: string, overrides: Record<string, unknown> = {}) {
  return { user: { id: userId, tenantId: TENANT_A }, params: {}, body: {}, ...overrides };
}

let router: any;
beforeAll(async () => {
  mockDbSelect.mockImplementation(() => dbSelectChain());
  router = (await import('../routes/tenantIntegrations')).default;
});

beforeEach(() => {
  ownerFixture = true;
  mockDbSelect.mockReset();
  mockDbSelect.mockImplementation(() => dbSelectChain());
  mockListIntegrations.mockReset();
  mockGetIntegrationStatus.mockReset();
  mockUpsert.mockReset();
  mockDisconnect.mockReset();
});

describe('routes/tenantIntegrations.ts — credential-echo safety', () => {
  it('PUT sets credentials, never echoes them in its own response, and a subsequent GET never returns them either', async () => {
    const savedCredentials = { host: 'smtp.acme.test', port: 587, user: 'a@acme.test', pass: 'super-secret-pw' };
    const publicRow = {
      id: 'row-1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected',
      metadata: { host: 'smtp.acme.test', userMasked: 'a••••t' }, createdAt: null, updatedAt: null,
    };
    mockUpsert.mockResolvedValue(publicRow);
    mockGetIntegrationStatus.mockResolvedValue(publicRow);

    const putHandler = invokeRouteHandler(router, '/:provider', 'put');
    const putRes = mockRes();
    await putHandler(
      reqAs(OWNER_USER, { params: { provider: 'email_smtp' }, body: { credentials: savedCredentials, metadata: { host: savedCredentials.host } } }),
      putRes,
    );

    expect(putRes.statusCode).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(TENANT_A, 'email_smtp', savedCredentials, { host: savedCredentials.host });
    expect(JSON.stringify(putRes.body)).not.toContain('super-secret-pw');
    expect(putRes.body.integration).not.toHaveProperty('credentials');
    expect(putRes.body.integration).not.toHaveProperty('encryptedCredentials');
    expect(putRes.body.integration).toEqual(publicRow);

    // Subsequent GET (any tenant member, not just the owner who wrote it).
    const getHandler = invokeRouteHandler(router, '/:provider', 'get');
    const getRes = mockRes();
    await getHandler(reqAs(MEMBER_USER, { params: { provider: 'email_smtp' } }), getRes);

    expect(getRes.statusCode).toBe(200);
    expect(JSON.stringify(getRes.body)).not.toContain('super-secret-pw');
    expect(getRes.body.integration).toEqual(publicRow);
    expect(getRes.body.integration).not.toHaveProperty('encryptedCredentials');
  });

  it('DELETE disconnects the integration, scoped to the caller\'s own tenant', async () => {
    const disconnectedRow = { id: 'row-1', tenantId: TENANT_A, provider: 'email_smtp', status: 'disconnected', metadata: {}, createdAt: null, updatedAt: null };
    mockDisconnect.mockResolvedValue(disconnectedRow);

    const handler = invokeRouteHandler(router, '/:provider', 'delete');
    const res = mockRes();
    await handler(reqAs(OWNER_USER, { params: { provider: 'email_smtp' } }), res);

    expect(res.statusCode).toBe(200);
    expect(mockDisconnect).toHaveBeenCalledWith(TENANT_A, 'email_smtp');
    expect(res.body.integration.status).toBe('disconnected');
  });
});

describe('routes/tenantIntegrations.ts — owner gate on writes (existing backend guarantee)', () => {
  it('a non-owner PUT is rejected 403, and the service is never called', async () => {
    ownerFixture = false;
    const handler = invokeRouteHandler(router, '/:provider', 'put');
    const res = mockRes();
    await handler(
      reqAs(MEMBER_USER, { params: { provider: 'email_smtp' }, body: { credentials: { host: 'x', port: 1, user: 'y', pass: 'z' } } }),
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('a non-owner DELETE is rejected 403, and the service is never called', async () => {
    ownerFixture = false;
    const handler = invokeRouteHandler(router, '/:provider', 'delete');
    const res = mockRes();
    await handler(reqAs(MEMBER_USER, { params: { provider: 'email_smtp' } }), res);

    expect(res.statusCode).toBe(403);
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('a non-owner GET (read) still succeeds — reads are open to any authenticated tenant member, matching the backend contract the UI relies on', async () => {
    ownerFixture = false;
    mockGetIntegrationStatus.mockResolvedValue({
      id: 'row-1', tenantId: TENANT_A, provider: 'email_smtp', status: 'connected', metadata: {}, createdAt: null, updatedAt: null,
    });

    const handler = invokeRouteHandler(router, '/:provider', 'get');
    const res = mockRes();
    await handler(reqAs(MEMBER_USER, { params: { provider: 'email_smtp' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.integration.status).toBe('connected');
  });

  it('a non-owner GET / (list) still succeeds too', async () => {
    ownerFixture = false;
    mockListIntegrations.mockResolvedValue([]);
    const handler = invokeRouteHandler(router, '/', 'get');
    const res = mockRes();
    await handler(reqAs(MEMBER_USER), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.integrations).toEqual([]);
  });
});
