import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetMetaOAuthConfig = vi.fn();
const mockVerifyOAuthState = vi.fn();
const mockIsPendingNonceValid = vi.fn();
const mockExchangeCodeForToken = vi.fn();
const mockExchangeForLongLivedToken = vi.fn();
const mockSaveMetaCredentials = vi.fn();
const mockMarkMetaIntegrationFailed = vi.fn();

vi.mock('../services/metaOAuthService', () => ({
  getMetaOAuthConfig: (...a: unknown[]) => mockGetMetaOAuthConfig(...a),
  verifyOAuthState: (...a: unknown[]) => mockVerifyOAuthState(...a),
  isPendingNonceValid: (...a: unknown[]) => mockIsPendingNonceValid(...a),
  exchangeCodeForToken: (...a: unknown[]) => mockExchangeCodeForToken(...a),
  exchangeForLongLivedToken: (...a: unknown[]) => mockExchangeForLongLivedToken(...a),
  saveMetaCredentials: (...a: unknown[]) => mockSaveMetaCredentials(...a),
  markMetaIntegrationFailed: (...a: unknown[]) => mockMarkMetaIntegrationFailed(...a),
}));

import callbackRouter from '../routes/integrationsMetaCallback';

function makeReqRes(query: Record<string, string>) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = { query, params: {}, body: {}, headers: {} };
  const res = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn };
}

async function invokeCallback(req: unknown, res: unknown) {
  const layer = (callbackRouter as any).stack.find((l: any) => l.route?.path === '/' && l.route?.methods?.get);
  await layer.route.stack[0].handle(req, res, vi.fn());
}

const VALID_CONFIG = { clientId: 'c', clientSecret: 's', redirectUri: 'https://example.test/api/integrations/meta/callback' };

describe('routes/integrationsMetaCallback.ts — GET /api/integrations/meta/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetaOAuthConfig.mockReturnValue(VALID_CONFIG);
  });

  it('rejects a state signature mismatch (possible CSRF) before touching the DB or Meta', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: false, reason: 'signature_mismatch' });
    const { req, res, statusFn, jsonFn } = makeReqRes({ code: 'abc', state: 'forged-state' });

    await invokeCallback(req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_state', reason: 'signature_mismatch' }));
    expect(mockIsPendingNonceValid).not.toHaveBeenCalled();
    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: false, reason: 'expired' });
    const { req, res, statusFn, jsonFn } = makeReqRes({ code: 'abc', state: 'old-state' });
    await invokeCallback(req, res);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_state', reason: 'expired' }));
  });

  it('rejects a nonce that does not match the pending row (stale/replayed state)', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(false);
    const { req, res, statusFn, jsonFn } = makeReqRes({ code: 'abc', state: 'valid-sig-but-stale' });

    await invokeCallback(req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'state_mismatch' }));
    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('handles a user-denied grant: fails closed with a clear error and records it against the right tenant', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(true);
    const { req, res, statusFn, jsonFn } = makeReqRes({
      state: 'valid-state', error: 'access_denied', error_reason: 'user_denied', error_description: 'The user denied your request.',
    });

    await invokeCallback(req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'meta_oauth_denied' }));
    expect(mockMarkMetaIntegrationFailed).toHaveBeenCalledWith('tenant-A', expect.stringContaining('denied'));
    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('handles a missing code (no error, no code) by failing closed rather than proceeding', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(true);
    const { req, res, statusFn, jsonFn } = makeReqRes({ state: 'valid-state' });

    await invokeCallback(req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'missing_code' }));
  });

  it('handles a token-exchange failure: marks the integration errored and responds 502, never 200', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(true);
    mockExchangeCodeForToken.mockResolvedValue({ error: { message: 'This authorization code has expired.' } });
    const { req, res, statusFn, jsonFn } = makeReqRes({ code: 'expired-code', state: 'valid-state' });

    await invokeCallback(req, res);

    expect(statusFn).toHaveBeenCalledWith(502);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'token_exchange_failed' }));
    expect(mockMarkMetaIntegrationFailed).toHaveBeenCalledWith('tenant-A', expect.stringContaining('expired'));
    expect(mockSaveMetaCredentials).not.toHaveBeenCalled();
  });

  it('handles a network-level exchange failure (rejected promise) without throwing out of the handler', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(true);
    mockExchangeCodeForToken.mockRejectedValue(new Error('ECONNRESET'));
    const { req, res, statusFn, jsonFn } = makeReqRes({ code: 'code', state: 'valid-state' });

    await invokeCallback(req, res);

    expect(statusFn).toHaveBeenCalledWith(502);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'token_exchange_failed' }));
  });

  it('completes a successful end-to-end connect: exchanges code, upgrades to long-lived, and stores credentials for the RIGHT tenant', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(true);
    mockExchangeCodeForToken.mockResolvedValue({ access_token: 'short-lived', token_type: 'bearer', expires_in: 3600 });
    mockExchangeForLongLivedToken.mockResolvedValue({ access_token: 'long-lived-token', expires_in: 5184000 });
    const { req, res, jsonFn, statusFn } = makeReqRes({ code: 'good-code', state: 'valid-state' });

    await invokeCallback(req, res);

    expect(mockExchangeForLongLivedToken).toHaveBeenCalledWith('short-lived', VALID_CONFIG);
    expect(mockSaveMetaCredentials).toHaveBeenCalledWith('tenant-A', expect.objectContaining({ accessToken: 'long-lived-token' }));
    expect(statusFn).not.toHaveBeenCalled(); // success path calls res.json() directly, no error status set
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, status: 'connected' }));
  });

  it('falls back to the short-lived token if only the long-lived exchange fails, and still connects', async () => {
    mockVerifyOAuthState.mockReturnValue({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    mockIsPendingNonceValid.mockResolvedValue(true);
    mockExchangeCodeForToken.mockResolvedValue({ access_token: 'short-lived-only', token_type: 'bearer', expires_in: 3600 });
    mockExchangeForLongLivedToken.mockResolvedValue({ error: { message: 'long-lived exchange unavailable' } });
    const { req, res, jsonFn } = makeReqRes({ code: 'good-code', state: 'valid-state' });

    await invokeCallback(req, res);

    expect(mockSaveMetaCredentials).toHaveBeenCalledWith('tenant-A', expect.objectContaining({ accessToken: 'short-lived-only' }));
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: true, status: 'connected' }));
  });

  it('two different tenants completing the flow concurrently store credentials against their OWN tenantId only', async () => {
    mockIsPendingNonceValid.mockResolvedValue(true);
    mockExchangeCodeForToken.mockResolvedValue({ access_token: 'tok', expires_in: 3600 });
    mockExchangeForLongLivedToken.mockResolvedValue({ access_token: 'tok-ll', expires_in: 5184000 });

    mockVerifyOAuthState.mockReturnValueOnce({ ok: true, payload: { tenantId: 'tenant-A', nonce: 'n1', iat: Date.now() } });
    const first = makeReqRes({ code: 'c1', state: 's1' });
    await invokeCallback(first.req, first.res);

    mockVerifyOAuthState.mockReturnValueOnce({ ok: true, payload: { tenantId: 'tenant-B', nonce: 'n2', iat: Date.now() } });
    const second = makeReqRes({ code: 'c2', state: 's2' });
    await invokeCallback(second.req, second.res);

    expect(mockSaveMetaCredentials).toHaveBeenNthCalledWith(1, 'tenant-A', expect.anything());
    expect(mockSaveMetaCredentials).toHaveBeenNthCalledWith(2, 'tenant-B', expect.anything());
  });
});
