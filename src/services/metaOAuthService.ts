// ---------------------------------------------------------------------------
// Per-tenant Meta (Facebook/Instagram) OAuth connect flow — scaffolding.
//
// This is deliberately SEPARATE from the existing single-account integration:
//   - `META_ACCESS_TOKEN` / `META_APP_ID` / `META_APP_SECRET` (constants.ts,
//     social.ts's oauthRouter) belong to ONE global Meta Business account
//     shared by every tenant today.
//   - `META_OAUTH_CLIENT_ID` / `META_OAUTH_CLIENT_SECRET` (read here) belong
//     to a DIFFERENT, not-yet-created Meta Developer App for this product's
//     own multi-tenant connect flow. Do not conflate the two — see the PR
//     description for exactly what Jatin still needs to set up in Meta's
//     developer console before this is live-usable.
//
// Nothing in this file is wired into ads-reporting/CAPI/lead-forms yet. It
// only builds and stores a per-tenant token; consuming it is a follow-up.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenantIntegrations } from '../db/schema';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { encryptSecret, decryptSecret } from '../utils/integrationCrypto';
import logger from '../utils/logger';

export const META_GRAPH_API_BASE = process.env.META_API_BASE ?? 'https://graph.facebook.com/v19.0';
export const META_OAUTH_DIALOG_BASE = 'https://www.facebook.com/v19.0/dialog/oauth';

// Scopes requested for the per-tenant connect flow. Each of these needs Meta
// App Review approval on the NEW app (see PR body) before Meta will actually
// grant it to a non-developer-role user — same review process the existing
// social.ts oauthRouter went through for the single-account integration.
export const META_OAUTH_SCOPES = [
  'ads_read', // ad-account performance reporting
  'leads_retrieval', // Lead Ads form submissions
  'business_management', // list Business Manager + ad accounts
  'pages_show_list', // list Pages the connecting user administers
] as const;

// How long a signed `state` is valid for. The whole browser round-trip
// through Meta's consent screen must complete inside this window.
const STATE_TTL_MS = 15 * 60 * 1000;

const ENCRYPTION_ENV_VAR = 'TENANT_INTEGRATION_ENCRYPTION_KEY';

export interface MetaOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Reads the NEW multi-tenant OAuth app's credentials. Returns null (not a
 * thrown error) when unconfigured so callers can respond 503 rather than
 * 500 — this is expected to be unset until Jatin creates the Meta Developer
 * App described in the PR. */
export function getMetaOAuthConfig(): MetaOAuthConfig | null {
  const clientId = process.env.META_OAUTH_CLIENT_ID;
  const clientSecret = process.env.META_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI
    || `${process.env.BACKEND_URL || 'https://web-production-311da.up.railway.app'}/api/integrations/meta/callback`;
  return { clientId, clientSecret, redirectUri };
}

function stateSigningSecret(): string {
  // Falls back to JWT_SECRET only so state-signing never silently no-ops in
  // an environment that has JWT_SECRET but hasn't set META_OAUTH_CLIENT_SECRET
  // yet — but getMetaOAuthConfig() already gates the whole flow on the client
  // secret being present, so in practice this always resolves to the OAuth
  // app's own secret once configured.
  const secret = process.env.META_OAUTH_CLIENT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('META_OAUTH_CLIENT_SECRET or JWT_SECRET must be set to sign OAuth state');
  }
  return secret;
}

export interface OAuthStatePayload {
  tenantId: string;
  nonce: string;
  iat: number; // ms epoch
}

/**
 * Sign an HMAC-protected, self-describing `state` param.
 *
 * This is doing more than classic CSRF-nonce duty: the callback route
 * (`GET /api/integrations/meta/callback`) has NO auth middleware — Meta
 * redirects the bare browser there, which can't carry an Authorization
 * header — so `state` is the ONLY way the server learns which tenant a given
 * `code` belongs to. Without a signature, anyone could call the callback
 * directly with a forged `state` claiming an arbitrary `tenantId` and (given
 * a `code` from their OWN Meta login) splice a Meta connection into a tenant
 * they don't own. Signing `state` with a server-only secret makes the
 * tenantId claim unforgeable; `verifyOAuthState` additionally checks it
 * against a single-use nonce persisted on the tenant's own pending row
 * (`upsertPendingMetaState`) and an expiry, closing both replay and staleness.
 */
export function signOAuthState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSigningSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export type VerifyStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: 'malformed' | 'signature_mismatch' | 'expired' };

/** Verifies signature + shape + freshness of a `state` param. Does NOT check
 * the nonce against storage — callers must separately confirm the decoded
 * nonce matches the pending row for `payload.tenantId` (see
 * `getTenantIntegration`) before trusting it as single-use. */
export function verifyOAuthState(state: string | undefined | null): VerifyStateResult {
  if (!state || typeof state !== 'string') return { ok: false, reason: 'malformed' };
  const dotIndex = state.indexOf('.');
  if (dotIndex <= 0 || dotIndex === state.length - 1) return { ok: false, reason: 'malformed' };
  const body = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);

  const expectedSig = crypto.createHmac('sha256', stateSigningSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || !payload.tenantId || !payload.nonce || !payload.iat) {
    return { ok: false, reason: 'malformed' };
  }
  if (Date.now() - payload.iat > STATE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

export function buildMetaAuthorizeUrl(config: MetaOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: META_OAUTH_SCOPES.join(','),
    state,
    response_type: 'code',
  });
  return `${META_OAUTH_DIALOG_BASE}?${params.toString()}`;
}

// --- Graph API calls ---------------------------------------------------------

/** Matches `fetch`'s shape so tests can inject a fake implementation instead
 * of stubbing the global — see src/__tests__/metaOAuthService.test.ts. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface MetaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

export async function exchangeCodeForToken(
  code: string,
  config: MetaOAuthConfig,
  fetchImpl: FetchLike = fetchWithRetry,
): Promise<MetaTokenResponse> {
  const url = `${META_GRAPH_API_BASE}/oauth/access_token?${new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  }).toString()}`;
  const res = await fetchImpl(url);
  return (await res.json()) as MetaTokenResponse;
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  config: MetaOAuthConfig,
  fetchImpl: FetchLike = fetchWithRetry,
): Promise<MetaTokenResponse> {
  const url = `${META_GRAPH_API_BASE}/oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    fb_exchange_token: shortLivedToken,
  }).toString()}`;
  const res = await fetchImpl(url);
  return (await res.json()) as MetaTokenResponse;
}

/**
 * Meta long-lived user tokens (~60 days) have no separate `refresh_token` —
 * they are "refreshed" by re-exercising the SAME `fb_exchange_token` grant
 * using the current, still-valid long-lived token, which returns a fresh
 * ~60-day token. Must run before the current token actually expires (Meta
 * rejects an already-expired token here exactly like any other API call), so
 * callers should invoke this when `isNearExpiry(...)` is true — nothing in
 * this PR schedules that call automatically; see PR body.
 */
export async function refreshLongLivedToken(
  currentToken: string,
  config: MetaOAuthConfig,
  fetchImpl: FetchLike = fetchWithRetry,
): Promise<MetaTokenResponse> {
  return exchangeForLongLivedToken(currentToken, config, fetchImpl);
}

export function isNearExpiry(expiresAt: Date | string | null | undefined, thresholdDays = 7): boolean {
  if (!expiresAt) return true;
  const exp = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(exp.getTime())) return true;
  return exp.getTime() - Date.now() < thresholdDays * 24 * 60 * 60 * 1000;
}

// --- tenant_integrations storage --------------------------------------------

export interface StoredMetaCredentials {
  accessToken: string;
  tokenType: string;
  expiresAt: string; // ISO string
}

/** Creates or resets the tenant's `meta` row to `status: 'pending'` carrying a
 * single-use nonce, ahead of redirecting to Meta. Upserts on the
 * (tenantId, provider) unique index so re-initiating a connect always
 * replaces any previous in-flight or stale nonce rather than accumulating
 * rows. */
export async function upsertPendingMetaState(tenantId: string, nonce: string): Promise<void> {
  const metadata = { oauthNonce: nonce, oauthNonceIssuedAt: new Date().toISOString() };
  await db
    .insert(tenantIntegrations)
    .values({ tenantId, provider: 'meta', status: 'pending', metadata })
    .onConflictDoUpdate({
      target: [tenantIntegrations.tenantId, tenantIntegrations.provider],
      set: { status: 'pending', metadata, updatedAt: new Date() },
    });
}

export type TenantIntegrationRow = typeof tenantIntegrations.$inferSelect;

export async function getTenantIntegration(
  tenantId: string,
  provider: string,
): Promise<TenantIntegrationRow | null> {
  const [row] = await db
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

/** Consumes the pending nonce for (tenantId, 'meta'): true only if the row
 * exists, is still 'pending', and its stored nonce matches. Never mutates —
 * callers clear the nonce themselves once they're about to act on it, so a
 * failed downstream step (e.g. token exchange) can still be inspected. */
export async function isPendingNonceValid(tenantId: string, nonce: string): Promise<boolean> {
  const row = await getTenantIntegration(tenantId, 'meta');
  if (!row || row.status !== 'pending') return false;
  const storedNonce = (row.metadata as Record<string, unknown> | null)?.oauthNonce;
  return storedNonce === nonce;
}

export async function saveMetaCredentials(tenantId: string, creds: StoredMetaCredentials): Promise<void> {
  const encryptedCredentials = encryptSecret(JSON.stringify(creds), ENCRYPTION_ENV_VAR);
  await db
    .update(tenantIntegrations)
    .set({
      status: 'connected',
      encryptedCredentials,
      metadata: { connectedAt: new Date().toISOString(), expiresAt: creds.expiresAt, scopes: META_OAUTH_SCOPES },
      updatedAt: new Date(),
    })
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, 'meta')));
}

export function decryptMetaCredentials(encryptedCredentials: string): StoredMetaCredentials {
  return JSON.parse(decryptSecret(encryptedCredentials, ENCRYPTION_ENV_VAR)) as StoredMetaCredentials;
}

export async function markMetaIntegrationFailed(tenantId: string, reason: string): Promise<void> {
  await db
    .update(tenantIntegrations)
    .set({
      status: 'error',
      metadata: { error: reason, erroredAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, 'meta')));
  logger.warn(`[metaOAuthService] tenant ${tenantId} meta connect failed: ${reason}`);
}

/** Returns true only if a row existed for this tenant+provider (so callers can
 * 404 a disconnect of a never-connected integration). Tenant scoping is
 * structural, not a runtime check: the WHERE clause is built from the
 * server-trusted `tenantId` argument only — callers never accept a row id
 * from the client, so there is no id a caller could substitute to reach
 * another tenant's row. */
export async function disconnectMetaIntegration(tenantId: string): Promise<boolean> {
  const result = await db
    .update(tenantIntegrations)
    .set({ status: 'disconnected', encryptedCredentials: null, metadata: {}, updatedAt: new Date() })
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, 'meta')))
    .returning({ id: tenantIntegrations.id });
  return result.length > 0;
}
