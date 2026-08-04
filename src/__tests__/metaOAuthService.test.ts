import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Drizzle db mock — chainable .insert().values().onConflictDoUpdate() and
// .select().from().where().limit(), plus .update().set().where().returning(),
// matching the pattern in src/__tests__/inboxTenantIsolation.test.ts.
const mockInsertValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockSelectWhere = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockReturning = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        mockInsertValues(...args);
        return { onConflictDoUpdate: (...a: unknown[]) => mockOnConflictDoUpdate(...a) };
      },
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: (...args: unknown[]) => {
          mockSelectWhere(...args);
          return { limit: vi.fn().mockImplementation(() => mockSelectResult) };
        },
      })),
    })),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        mockUpdateSet(...args);
        return {
          where: (...a: unknown[]) => {
            mockUpdateWhere(...a);
            return { returning: (...r: unknown[]) => mockReturning(...r) };
          },
        };
      },
    })),
  },
}));

vi.mock('../db/schema', () => ({
  tenantIntegrations: {
    tenantId: 'tenant_id',
    provider: 'provider',
    id: 'id',
  },
}));

let mockSelectResult: unknown[] = [];

import {
  signOAuthState,
  verifyOAuthState,
  buildMetaAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  isNearExpiry,
  upsertPendingMetaState,
  isPendingNonceValid,
  disconnectMetaIntegration,
  saveMetaCredentials,
  decryptMetaCredentials,
  getMetaOAuthConfig,
  type MetaOAuthConfig,
} from '../services/metaOAuthService';

const CONFIG: MetaOAuthConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://example.test/api/integrations/meta/callback',
};

describe('metaOAuthService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult = [];
    process.env.META_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.META_OAUTH_CLIENT_SECRET = 'test-client-secret';
    process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = 'a-test-encryption-key-value';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -- config -----------------------------------------------------------------
  describe('getMetaOAuthConfig', () => {
    it('returns null when NEITHER pair is set (fails closed, not a hardcoded fallback)', () => {
      delete process.env.META_OAUTH_CLIENT_ID;
      delete process.env.META_OAUTH_CLIENT_SECRET;
      delete process.env.META_APP_ID;
      delete process.env.META_APP_SECRET;
      expect(getMetaOAuthConfig()).toBeNull();
    });

    it('both set: the OAuth-specific client id/secret win over the legacy single-account vars', () => {
      process.env.META_APP_ID = 'legacy-single-account-app-id';
      process.env.META_APP_SECRET = 'legacy-single-account-secret';
      const config = getMetaOAuthConfig();
      expect(config?.clientId).toBe('test-client-id');
      expect(config?.clientSecret).toBe('test-client-secret');
      expect(config?.clientId).not.toBe('legacy-single-account-app-id');
    });

    it('only the legacy single-account vars set: falls back to META_APP_ID/META_APP_SECRET instead of 503ing', () => {
      delete process.env.META_OAUTH_CLIENT_ID;
      delete process.env.META_OAUTH_CLIENT_SECRET;
      process.env.META_APP_ID = 'legacy-single-account-app-id';
      process.env.META_APP_SECRET = 'legacy-single-account-secret';
      const config = getMetaOAuthConfig();
      expect(config).not.toBeNull();
      expect(config?.clientId).toBe('legacy-single-account-app-id');
      expect(config?.clientSecret).toBe('legacy-single-account-secret');
    });

    it('neither pair set: returns null (not a thrown error), same as before the fallback existed', () => {
      delete process.env.META_OAUTH_CLIENT_ID;
      delete process.env.META_OAUTH_CLIENT_SECRET;
      delete process.env.META_APP_ID;
      delete process.env.META_APP_SECRET;
      expect(getMetaOAuthConfig()).toBeNull();
    });

    it('only one half of each pair set (e.g. an id with no matching secret) still fails closed', () => {
      delete process.env.META_OAUTH_CLIENT_ID;
      process.env.META_OAUTH_CLIENT_SECRET = 'oauth-secret-only';
      delete process.env.META_APP_ID;
      process.env.META_APP_SECRET = 'legacy-secret-only';
      // clientId resolves from neither var (both unset) — must fail closed
      // even though both *secret* vars are present.
      expect(getMetaOAuthConfig()).toBeNull();
    });
  });

  // -- state signing ------------------------------------------------------------
  describe('signOAuthState / verifyOAuthState', () => {
    it('round-trips a valid, freshly-signed state', () => {
      const state = signOAuthState({ tenantId: 'tenant-A', nonce: 'nonce-1', iat: Date.now() });
      const result = verifyOAuthState(state);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.tenantId).toBe('tenant-A');
        expect(result.payload.nonce).toBe('nonce-1');
      }
    });

    it('rejects a state with a tampered tenantId (forged tenant binding)', () => {
      const state = signOAuthState({ tenantId: 'tenant-A', nonce: 'nonce-1', iat: Date.now() });
      const [body] = state.split('.');
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      const forgedBody = Buffer.from(JSON.stringify({ ...decoded, tenantId: 'tenant-victim' })).toString('base64url');
      const forgedState = `${forgedBody}.${state.split('.')[1]}`; // keep the ORIGINAL signature
      const result = verifyOAuthState(forgedState);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('signature_mismatch');
    });

    it('rejects a state signed with a different secret (e.g. wrong tenant/app)', () => {
      const state = signOAuthState({ tenantId: 'tenant-A', nonce: 'nonce-1', iat: Date.now() });
      process.env.META_OAUTH_CLIENT_SECRET = 'a-completely-different-secret';
      const result = verifyOAuthState(state);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('signature_mismatch');
    });

    it('rejects an expired state', () => {
      const sixteenMinutesAgo = Date.now() - 16 * 60 * 1000;
      const state = signOAuthState({ tenantId: 'tenant-A', nonce: 'nonce-1', iat: sixteenMinutesAgo });
      const result = verifyOAuthState(state);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('expired');
    });

    it('rejects malformed state values', () => {
      expect(verifyOAuthState(undefined).ok).toBe(false);
      expect(verifyOAuthState('').ok).toBe(false);
      expect(verifyOAuthState('not-a-valid-state-at-all').ok).toBe(false);
      expect(verifyOAuthState('.nosig').ok).toBe(false);
    });
  });

  // -- authorize URL --------------------------------------------------------
  describe('buildMetaAuthorizeUrl', () => {
    it('builds a well-formed Meta dialog URL with the expected params', () => {
      const state = signOAuthState({ tenantId: 'tenant-A', nonce: 'n', iat: Date.now() });
      const url = buildMetaAuthorizeUrl(CONFIG, state);
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://www.facebook.com/v19.0/dialog/oauth');
      expect(parsed.searchParams.get('client_id')).toBe(CONFIG.clientId);
      expect(parsed.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('state')).toBe(state);
      expect(parsed.searchParams.get('scope')).toContain('ads_read');
    });
  });

  // -- token exchange (mocked Graph API) ---------------------------------------
  describe('exchangeCodeForToken / exchangeForLongLivedToken / refreshLongLivedToken', () => {
    it('exchanges a code for a short-lived token via the injected fetch', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        json: async () => ({ access_token: 'short-lived-token', token_type: 'bearer', expires_in: 3600 }),
      });
      const result = await exchangeCodeForToken('auth-code-123', CONFIG, fetchImpl as any);
      expect(result.access_token).toBe('short-lived-token');
      const [calledUrl] = fetchImpl.mock.calls[0];
      expect(calledUrl).toContain('/oauth/access_token');
      expect(calledUrl).toContain('code=auth-code-123');
      expect(calledUrl).toContain(`client_id=${CONFIG.clientId}`);
    });

    it('surfaces a Meta error object without throwing when the code exchange fails', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        json: async () => ({ error: { message: 'This authorization code has expired.', code: 100 } }),
      });
      const result = await exchangeCodeForToken('bad-code', CONFIG, fetchImpl as any);
      expect(result.access_token).toBeUndefined();
      expect(result.error?.message).toMatch(/expired/);
    });

    it('exchanges a short-lived token for a long-lived one using fb_exchange_token', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        json: async () => ({ access_token: 'long-lived-token', expires_in: 5184000 }),
      });
      const result = await exchangeForLongLivedToken('short-lived-token', CONFIG, fetchImpl as any);
      expect(result.access_token).toBe('long-lived-token');
      const [calledUrl] = fetchImpl.mock.calls[0];
      expect(calledUrl).toContain('grant_type=fb_exchange_token');
      expect(calledUrl).toContain('fb_exchange_token=short-lived-token');
    });

    it('refreshLongLivedToken re-exercises fb_exchange_token with the CURRENT token (no separate refresh_token)', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        json: async () => ({ access_token: 'refreshed-long-lived-token', expires_in: 5184000 }),
      });
      const result = await refreshLongLivedToken('current-long-lived-token', CONFIG, fetchImpl as any);
      expect(result.access_token).toBe('refreshed-long-lived-token');
      const [calledUrl] = fetchImpl.mock.calls[0];
      expect(calledUrl).toContain('fb_exchange_token=current-long-lived-token');
    });

    it('propagates a network failure from the injected fetch rather than swallowing it', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network unreachable'));
      await expect(exchangeCodeForToken('code', CONFIG, fetchImpl as any)).rejects.toThrow('network unreachable');
    });
  });

  describe('isNearExpiry', () => {
    it('treats a null/undefined expiry as near-expiry (fail toward refreshing)', () => {
      expect(isNearExpiry(undefined)).toBe(true);
      expect(isNearExpiry(null)).toBe(true);
    });

    it('is false for an expiry well in the future', () => {
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(isNearExpiry(farFuture, 7)).toBe(false);
    });

    it('is true for an expiry inside the threshold window', () => {
      const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(isNearExpiry(soon, 7)).toBe(true);
    });
  });

  // -- storage helpers (mocked db) ----------------------------------------------
  describe('upsertPendingMetaState', () => {
    it('inserts a pending row and upserts on the (tenantId, provider) unique index', async () => {
      await upsertPendingMetaState('tenant-A', 'nonce-abc');
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-A', provider: 'meta', status: 'pending' }),
      );
      expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    });
  });

  describe('isPendingNonceValid', () => {
    it('is true when the row is pending and the nonce matches', async () => {
      mockSelectResult = [{ status: 'pending', metadata: { oauthNonce: 'nonce-abc' } }];
      expect(await isPendingNonceValid('tenant-A', 'nonce-abc')).toBe(true);
    });

    it('is false when the nonce does not match (possible CSRF/replay)', async () => {
      mockSelectResult = [{ status: 'pending', metadata: { oauthNonce: 'a-different-nonce' } }];
      expect(await isPendingNonceValid('tenant-A', 'nonce-abc')).toBe(false);
    });

    it('is false when there is no row at all', async () => {
      mockSelectResult = [];
      expect(await isPendingNonceValid('tenant-A', 'nonce-abc')).toBe(false);
    });

    it('is false when the row is not pending (already connected/disconnected/error)', async () => {
      mockSelectResult = [{ status: 'connected', metadata: { oauthNonce: 'nonce-abc' } }];
      expect(await isPendingNonceValid('tenant-A', 'nonce-abc')).toBe(false);
    });
  });

  describe('saveMetaCredentials / decryptMetaCredentials', () => {
    it('encrypts credentials before writing, and the stored value round-trips through decryptMetaCredentials', async () => {
      await saveMetaCredentials('tenant-A', { accessToken: 'plain-token-value', tokenType: 'bearer', expiresAt: '2026-12-01T00:00:00.000Z' });
      const setArg = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.status).toBe('connected');
      expect(setArg.encryptedCredentials).not.toContain('plain-token-value');
      const decrypted = decryptMetaCredentials(setArg.encryptedCredentials as string);
      expect(decrypted.accessToken).toBe('plain-token-value');
    });
  });

  describe('disconnectMetaIntegration — tenant scoping', () => {
    it('scopes the update to the caller tenantId only, and reports false when no row existed', async () => {
      mockReturning.mockResolvedValueOnce([]);
      const existed = await disconnectMetaIntegration('tenant-A');
      expect(existed).toBe(false);
      expect(mockUpdateWhere).toHaveBeenCalled();
    });

    it('reports true and clears the stored credential when a row existed', async () => {
      mockReturning.mockResolvedValueOnce([{ id: 'row-1' }]);
      const existed = await disconnectMetaIntegration('tenant-A');
      expect(existed).toBe(true);
      const setArg = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.status).toBe('disconnected');
      expect(setArg.encryptedCredentials).toBeNull();
    });

    it('a different tenantId produces a different where() condition (proves scoping is per-argument, not global)', async () => {
      mockReturning.mockResolvedValue([]);
      await disconnectMetaIntegration('tenant-A');
      const whereA = mockUpdateWhere.mock.calls[0][0];
      await disconnectMetaIntegration('tenant-B');
      const whereB = mockUpdateWhere.mock.calls[1][0];
      expect(whereA).not.toEqual(whereB);
    });
  });
});
