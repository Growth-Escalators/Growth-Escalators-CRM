import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level tests mock the service layer entirely (metaOAuthService has its
// own unit tests in metaOAuthService.test.ts) and assert: (a) routes always
// scope by req.user!.tenantId, never a client-supplied id, and (b) each
// response shape/status matches the contract described in the route file.
const mockGetMetaOAuthConfig = vi.fn();
const mockSignOAuthState = vi.fn();
const mockBuildMetaAuthorizeUrl = vi.fn();
const mockUpsertPendingMetaState = vi.fn();
const mockGetTenantIntegration = vi.fn();
const mockDisconnectMetaIntegration = vi.fn();
const mockDecryptMetaCredentials = vi.fn();
const mockRefreshLongLivedToken = vi.fn();
const mockIsNearExpiry = vi.fn();
const mockSaveMetaCredentials = vi.fn();

vi.mock('../services/metaOAuthService', () => ({
  getMetaOAuthConfig: (...a: unknown[]) => mockGetMetaOAuthConfig(...a),
  signOAuthState: (...a: unknown[]) => mockSignOAuthState(...a),
  buildMetaAuthorizeUrl: (...a: unknown[]) => mockBuildMetaAuthorizeUrl(...a),
  upsertPendingMetaState: (...a: unknown[]) => mockUpsertPendingMetaState(...a),
  getTenantIntegration: (...a: unknown[]) => mockGetTenantIntegration(...a),
  disconnectMetaIntegration: (...a: unknown[]) => mockDisconnectMetaIntegration(...a),
  decryptMetaCredentials: (...a: unknown[]) => mockDecryptMetaCredentials(...a),
  refreshLongLivedToken: (...a: unknown[]) => mockRefreshLongLivedToken(...a),
  isNearExpiry: (...a: unknown[]) => mockIsNearExpiry(...a),
  saveMetaCredentials: (...a: unknown[]) => mockSaveMetaCredentials(...a),
}));

import integrationsRouter from '../routes/integrations';

function makeReqRes(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const redirectFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = {
    user: { tenantId: 'tenant-A', role: 'admin' },
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };
  const res = { json: jsonFn, status: statusFn, redirect: redirectFn };
  return { req, res, jsonFn, statusFn, redirectFn };
}

async function invokeRoute(path: string, method: 'get' | 'post' | 'delete', req: unknown, res: unknown) {
  const layer = (integrationsRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  await layer.route.stack[0].handle(req, res, vi.fn());
}

describe('routes/integrations.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /meta/connect', () => {
    it('503s with a clear message when META_OAUTH_CLIENT_ID/SECRET are not configured', async () => {
      mockGetMetaOAuthConfig.mockReturnValue(null);
      const { req, res, statusFn, jsonFn } = makeReqRes();
      await invokeRoute('/meta/connect', 'get', req, res);
      expect(statusFn).toHaveBeenCalledWith(503);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'meta_oauth_not_configured' }));
      expect(mockUpsertPendingMetaState).not.toHaveBeenCalled();
    });

    it('persists a pending state scoped to the caller tenant, then redirects to Meta', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback' });
      mockSignOAuthState.mockReturnValue('signed-state-token');
      mockBuildMetaAuthorizeUrl.mockReturnValue('https://www.facebook.com/v19.0/dialog/oauth?...');
      const { req, res, redirectFn } = makeReqRes({ user: { tenantId: 'tenant-A', role: 'admin' } });

      await invokeRoute('/meta/connect', 'get', req, res);

      expect(mockUpsertPendingMetaState).toHaveBeenCalledWith('tenant-A', expect.any(String));
      const signedArgs = mockSignOAuthState.mock.calls[0][0];
      expect(signedArgs.tenantId).toBe('tenant-A');
      expect(redirectFn).toHaveBeenCalledWith('https://www.facebook.com/v19.0/dialog/oauth?...');
    });

    it('a different tenant gets its own nonce/state bound to ITS tenantId, not a shared one', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback' });
      mockSignOAuthState.mockReturnValue('state-token');
      mockBuildMetaAuthorizeUrl.mockReturnValue('https://redirect');

      await invokeRoute('/meta/connect', 'get', makeReqRes({ user: { tenantId: 'tenant-A', role: 'admin' } }).req, makeReqRes().res);
      await invokeRoute('/meta/connect', 'get', makeReqRes({ user: { tenantId: 'tenant-B', role: 'admin' } }).req, makeReqRes().res);

      expect(mockUpsertPendingMetaState).toHaveBeenNthCalledWith(1, 'tenant-A', expect.any(String));
      expect(mockUpsertPendingMetaState).toHaveBeenNthCalledWith(2, 'tenant-B', expect.any(String));
    });
  });

  describe('GET /meta — tenant scoping on view', () => {
    it('404s when the caller tenant has no meta integration', async () => {
      mockGetTenantIntegration.mockResolvedValue(null);
      const { req, res, statusFn } = makeReqRes();
      await invokeRoute('/meta', 'get', req, res);
      expect(mockGetTenantIntegration).toHaveBeenCalledWith('tenant-A', 'meta');
      expect(statusFn).toHaveBeenCalledWith(404);
    });

    it('never includes encryptedCredentials in the response', async () => {
      mockGetTenantIntegration.mockResolvedValue({
        provider: 'meta', status: 'connected', metadata: { expiresAt: '2026-12-01' },
        encryptedCredentials: 'salt:iv:tag:cipher', createdAt: new Date(), updatedAt: new Date(),
      });
      const { req, res, jsonFn } = makeReqRes();
      await invokeRoute('/meta', 'get', req, res);
      const body = jsonFn.mock.calls[0][0];
      expect(JSON.stringify(body)).not.toContain('encryptedCredentials');
      expect(JSON.stringify(body)).not.toContain('salt:iv:tag:cipher');
    });

    it('looks up strictly by the caller tenantId — two tenants never share a lookup', async () => {
      mockGetTenantIntegration.mockResolvedValue(null);
      await invokeRoute('/meta', 'get', makeReqRes({ user: { tenantId: 'tenant-A', role: 'admin' } }).req, makeReqRes().res);
      await invokeRoute('/meta', 'get', makeReqRes({ user: { tenantId: 'tenant-B', role: 'admin' } }).req, makeReqRes().res);
      expect(mockGetTenantIntegration).toHaveBeenNthCalledWith(1, 'tenant-A', 'meta');
      expect(mockGetTenantIntegration).toHaveBeenNthCalledWith(2, 'tenant-B', 'meta');
    });
  });

  describe('DELETE /meta — tenant scoping on disconnect', () => {
    it('404s when the caller tenant has nothing connected', async () => {
      mockDisconnectMetaIntegration.mockResolvedValue(false);
      const { req, res, statusFn } = makeReqRes();
      await invokeRoute('/meta', 'delete', req, res);
      expect(statusFn).toHaveBeenCalledWith(404);
    });

    it('disconnects only the caller tenant — the disconnect call carries no client-suppliable id', async () => {
      mockDisconnectMetaIntegration.mockResolvedValue(true);
      const { req, res, jsonFn } = makeReqRes({ user: { tenantId: 'tenant-A', role: 'admin' }, body: { tenantId: 'tenant-B' } });
      await invokeRoute('/meta', 'delete', req, res);
      // Even if a caller tries to smuggle a different tenantId in the body,
      // the route only ever reads req.user!.tenantId.
      expect(mockDisconnectMetaIntegration).toHaveBeenCalledWith('tenant-A');
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, status: 'disconnected' }));
    });
  });

  describe('POST /meta/refresh', () => {
    it('404s when the tenant has no connected meta integration', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x' });
      mockGetTenantIntegration.mockResolvedValue(null);
      const { req, res, statusFn } = makeReqRes();
      await invokeRoute('/meta/refresh', 'post', req, res);
      expect(statusFn).toHaveBeenCalledWith(404);
    });

    it('skips refreshing (200, refreshed:false) when the token is not near expiry and force is not set', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x' });
      mockGetTenantIntegration.mockResolvedValue({
        status: 'connected', encryptedCredentials: 'enc-blob', metadata: { expiresAt: '2099-01-01T00:00:00.000Z' },
      });
      mockDecryptMetaCredentials.mockReturnValue({ accessToken: 'tok', tokenType: 'bearer', expiresAt: '2099-01-01T00:00:00.000Z' });
      mockIsNearExpiry.mockReturnValue(false);
      const { req, res, jsonFn } = makeReqRes();
      await invokeRoute('/meta/refresh', 'post', req, res);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ refreshed: false }));
      expect(mockRefreshLongLivedToken).not.toHaveBeenCalled();
    });

    it('refreshes and persists a new token when near expiry', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x' });
      mockGetTenantIntegration.mockResolvedValue({
        status: 'connected', encryptedCredentials: 'enc-blob', metadata: { expiresAt: '2026-01-01T00:00:00.000Z' },
      });
      mockDecryptMetaCredentials.mockReturnValue({ accessToken: 'old-token', tokenType: 'bearer', expiresAt: '2026-01-01T00:00:00.000Z' });
      mockIsNearExpiry.mockReturnValue(true);
      mockRefreshLongLivedToken.mockResolvedValue({ access_token: 'new-token', expires_in: 5184000 });
      const { req, res, jsonFn } = makeReqRes();
      await invokeRoute('/meta/refresh', 'post', req, res);
      expect(mockSaveMetaCredentials).toHaveBeenCalledWith('tenant-A', expect.objectContaining({ accessToken: 'new-token' }));
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ refreshed: true }));
    });

    it('502s with a clear error when Meta refuses the refresh, and does NOT wipe the existing token', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x' });
      mockGetTenantIntegration.mockResolvedValue({
        status: 'connected', encryptedCredentials: 'enc-blob', metadata: { expiresAt: '2026-01-01T00:00:00.000Z' },
      });
      mockDecryptMetaCredentials.mockReturnValue({ accessToken: 'old-token', tokenType: 'bearer', expiresAt: '2026-01-01T00:00:00.000Z' });
      mockIsNearExpiry.mockReturnValue(true);
      mockRefreshLongLivedToken.mockResolvedValue({ error: { message: 'invalid token' } });
      const { req, res, statusFn, jsonFn } = makeReqRes();
      await invokeRoute('/meta/refresh', 'post', req, res);
      expect(statusFn).toHaveBeenCalledWith(502);
      expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'refresh_failed' }));
      expect(mockSaveMetaCredentials).not.toHaveBeenCalled();
    });
  });
});
