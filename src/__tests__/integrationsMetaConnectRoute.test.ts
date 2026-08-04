// Route-level tests for GET /api/integrations/meta/connect
// (src/routes/integrationsMetaConnect.ts) — the fix that moved this route OUT
// of the authenticated /api/integrations router (see integrationsRoutes.test.ts's
// note) so it can be reached by a real top-level browser navigation, which
// can't attach an Authorization header. This file proves:
//   - a valid `?token=` query param authenticates and redirects to Meta with
//     the right tenantId embedded in the signed state (the query-param path
//     IS the real browser-navigation path — see admin/src/pages/
//     IntegrationsPage.jsx's window.location.href call)
//   - the Authorization header path still works too (backward compat /
//     API-style callers, mirroring src/routes/social.ts's oauthRouter)
//   - invalid/missing tokens 401 rather than proceeding
//   - the "not configured" case redirects back to the admin page instead of
//     the raw JSON 503 an AJAX caller could parse but a browser navigation
//     cannot
//
// metaOAuthService itself (including Fix 1's META_APP_ID/META_APP_SECRET
// config fallback) has its own unit tests in metaOAuthService.test.ts; here
// the service module is mocked entirely so this file stays focused on the
// route's own auth/redirect behaviour.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mockGetMetaOAuthConfig = vi.fn();
const mockSignOAuthState = vi.fn();
const mockBuildMetaAuthorizeUrl = vi.fn();
const mockUpsertPendingMetaState = vi.fn();

vi.mock('../services/metaOAuthService', () => ({
  getMetaOAuthConfig: (...a: unknown[]) => mockGetMetaOAuthConfig(...a),
  signOAuthState: (...a: unknown[]) => mockSignOAuthState(...a),
  buildMetaAuthorizeUrl: (...a: unknown[]) => mockBuildMetaAuthorizeUrl(...a),
  upsertPendingMetaState: (...a: unknown[]) => mockUpsertPendingMetaState(...a),
  META_OAUTH_NOT_CONFIGURED_MESSAGE: 'test: meta oauth not configured',
}));

import connectRouter from '../routes/integrationsMetaConnect';

const TEST_SECRET = 'test-jwt-secret-meta-connect';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-4111-8111-111111111111';

function signToken(tenantId: string | undefined, overrides: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = { id: USER_A, email: 'a@b.test', role: 'admin', tokenVersion: 1, ...overrides };
  if (tenantId !== undefined) payload.tenantId = tenantId;
  return jwt.sign(payload, TEST_SECRET);
}

let server: Server | null = null;

async function startApp(): Promise<string> {
  const app = express();
  // Mirrors the real src/index.ts mount: this router alone, no requireAuth.
  app.use('/api/integrations/meta/connect', connectRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('routes/integrationsMetaConnect.ts — GET /api/integrations/meta/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(async () => {
    delete process.env.JWT_SECRET;
    if (server) {
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  describe('valid token — ?token= query param (the real browser-navigation path)', () => {
    it('authenticates, persists a pending state for the RIGHT tenant, and redirects to Meta', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback' });
      mockSignOAuthState.mockReturnValue('signed-state-token');
      mockBuildMetaAuthorizeUrl.mockReturnValue('https://www.facebook.com/v19.0/dialog/oauth?mock=1');
      mockUpsertPendingMetaState.mockResolvedValue(undefined);

      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect?token=${signToken(TENANT_A)}`, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://www.facebook.com/v19.0/dialog/oauth?mock=1');
      expect(mockUpsertPendingMetaState).toHaveBeenCalledWith(TENANT_A, expect.any(String));
      const signedArgs = mockSignOAuthState.mock.calls[0][0];
      expect(signedArgs.tenantId).toBe(TENANT_A);
    });

    it('a different tenant gets its own nonce/state bound to ITS tenantId, not a shared one', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback' });
      mockSignOAuthState.mockReturnValue('state-token');
      mockBuildMetaAuthorizeUrl.mockReturnValue('https://redirect');
      mockUpsertPendingMetaState.mockResolvedValue(undefined);

      const baseUrl = await startApp();
      await fetch(`${baseUrl}/api/integrations/meta/connect?token=${signToken(TENANT_A)}`, { redirect: 'manual' });
      await fetch(`${baseUrl}/api/integrations/meta/connect?token=${signToken(TENANT_B)}`, { redirect: 'manual' });

      expect(mockUpsertPendingMetaState).toHaveBeenNthCalledWith(1, TENANT_A, expect.any(String));
      expect(mockUpsertPendingMetaState).toHaveBeenNthCalledWith(2, TENANT_B, expect.any(String));
    });
  });

  describe('valid token — Authorization header (backward compat / API-style callers)', () => {
    it('authenticates via the header exactly like the query-param path', async () => {
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'c', clientSecret: 's', redirectUri: 'https://x/callback' });
      mockSignOAuthState.mockReturnValue('signed-state-token');
      mockBuildMetaAuthorizeUrl.mockReturnValue('https://www.facebook.com/v19.0/dialog/oauth?mock=1');
      mockUpsertPendingMetaState.mockResolvedValue(undefined);

      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect`, {
        redirect: 'manual',
        headers: { authorization: `Bearer ${signToken(TENANT_A)}` },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://www.facebook.com/v19.0/dialog/oauth?mock=1');
      expect(mockUpsertPendingMetaState).toHaveBeenCalledWith(TENANT_A, expect.any(String));
    });
  });

  describe('invalid/missing token', () => {
    it('401s with no token at all, and never touches the pending-state store', async () => {
      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect`, { redirect: 'manual' });
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('unauthorised');
      expect(mockUpsertPendingMetaState).not.toHaveBeenCalled();
    });

    it('401s on a garbage token string', async () => {
      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect?token=not-a-real-jwt`, { redirect: 'manual' });
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('invalid token');
    });

    it('401s on a token signed with the WRONG secret (forged)', async () => {
      const baseUrl = await startApp();
      const forged = jwt.sign({ id: USER_A, tenantId: TENANT_A, role: 'admin', tokenVersion: 1 }, 'a-different-secret-entirely');
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect?token=${forged}`, { redirect: 'manual' });
      expect(res.status).toBe(401);
      expect(mockUpsertPendingMetaState).not.toHaveBeenCalled();
    });

    it('401s on a validly-signed token that carries no tenantId claim', async () => {
      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect?token=${signToken(undefined)}`, { redirect: 'manual' });
      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('invalid token');
      expect(mockUpsertPendingMetaState).not.toHaveBeenCalled();
    });
  });

  describe('Meta OAuth not configured (Fix 1 fallback resolved to null — neither pair set)', () => {
    it('redirects back to the admin Integrations page with ?meta=error&reason=not_configured, not a raw JSON 503', async () => {
      mockGetMetaOAuthConfig.mockReturnValue(null);
      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect?token=${signToken(TENANT_A)}`, { redirect: 'manual' });

      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('/settings/integrations');
      expect(location).toContain('meta=error');
      expect(location).toContain('reason=not_configured');
      expect(mockUpsertPendingMetaState).not.toHaveBeenCalled();
    });
  });

  describe('Meta OAuth configured via the Fix 1 META_APP_ID/META_APP_SECRET fallback', () => {
    it('proceeds identically to a dedicated-app config — the route does not care which env vars produced it', async () => {
      // getMetaOAuthConfig()'s own fallback resolution is unit-tested in
      // metaOAuthService.test.ts; mocking it here proves the ROUTE treats a
      // fallback-resolved config no differently from a dedicated OAuth app's.
      mockGetMetaOAuthConfig.mockReturnValue({ clientId: 'legacy-app-id', clientSecret: 'legacy-app-secret', redirectUri: 'https://x/callback' });
      mockSignOAuthState.mockReturnValue('state-token');
      mockBuildMetaAuthorizeUrl.mockReturnValue('https://www.facebook.com/v19.0/dialog/oauth?fallback=1');
      mockUpsertPendingMetaState.mockResolvedValue(undefined);

      const baseUrl = await startApp();
      const res = await fetch(`${baseUrl}/api/integrations/meta/connect?token=${signToken(TENANT_A)}`, { redirect: 'manual' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://www.facebook.com/v19.0/dialog/oauth?fallback=1');
      expect(mockBuildMetaAuthorizeUrl).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'legacy-app-id' }),
        'state-token',
      );
    });
  });
});
