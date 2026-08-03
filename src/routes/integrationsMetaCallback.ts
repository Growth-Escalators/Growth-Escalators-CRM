// ---------------------------------------------------------------------------
// GET /api/integrations/meta/callback — Meta's OAuth redirect target.
//
// Mounted WITHOUT requireAuth in src/index.ts (registered BEFORE the
// authenticated /api/integrations mount, exactly like /api/social/oauth vs
// /api/social) — Meta redirects the bare browser here and cannot attach an
// Authorization header. `state` is therefore the only source of tenant
// identity for this request; see the long comment on `signOAuthState` in
// src/services/metaOAuthService.ts for why it's HMAC-signed rather than a
// plain nonce.
//
// Every failure path below responds with a non-2xx status and a clear error
// body — none of them fall through to a default "success" response. This is
// scaffolding: nothing here is wired into ads-reporting/CAPI/lead-forms yet,
// and there's no admin-UI redirect target configured (this is an API-only
// success/error JSON response) — that wiring is a follow-up once a real
// tenant connects a real account.
// ---------------------------------------------------------------------------
import logger from '../utils/logger';
import { Router } from 'express';
import {
  getMetaOAuthConfig,
  verifyOAuthState,
  isPendingNonceValid,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  saveMetaCredentials,
  markMetaIntegrationFailed,
} from '../services/metaOAuthService';

const router = Router();

router.get('/', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const metaError = req.query.error as string | undefined;
  const metaErrorReason = req.query.error_reason as string | undefined;
  const metaErrorDescription = req.query.error_description as string | undefined;

  // 1. Validate `state` FIRST — before trusting anything else in the query,
  // including whether to even look at `error`. An invalid signature means we
  // cannot trust the embedded tenantId, so nothing below may touch the DB.
  const verified = verifyOAuthState(state);
  if (!verified.ok) {
    logger.warn(`[integrations/meta callback] rejected — state ${verified.reason}`);
    res.status(400).json({
      error: 'invalid_state',
      reason: verified.reason,
      message: 'OAuth state failed validation (possible CSRF, tampering, or an expired/stale link). Please restart the connect flow.',
    });
    return;
  }

  const { tenantId, nonce } = verified.payload;

  // 2. Confirm the nonce matches a still-pending row for THIS tenant. A
  // signature-valid but nonce-mismatched state means either a replayed old
  // link or a state issued for a connect attempt that was since superseded —
  // fail closed rather than proceed with a code we can't attribute cleanly.
  const nonceValid = await isPendingNonceValid(tenantId, nonce);
  if (!nonceValid) {
    logger.warn(`[integrations/meta callback] rejected — nonce mismatch for tenant ${tenantId}`);
    res.status(400).json({
      error: 'state_mismatch',
      message: 'OAuth state did not match an in-flight connect attempt for this tenant (possible CSRF, or the link was already used/expired). Please restart the connect flow.',
    });
    return;
  }

  // 3. User denied the grant, or Meta itself returned an error — state is
  // trustworthy at this point, so we can record which tenant's attempt
  // failed and why, but there is nothing to exchange.
  if (metaError) {
    await markMetaIntegrationFailed(tenantId, metaErrorDescription || metaErrorReason || metaError);
    res.status(400).json({
      error: 'meta_oauth_denied',
      reason: metaErrorReason || metaError,
      message: metaErrorDescription || 'Meta OAuth did not complete — the user may have denied the permission request, or Meta returned an error.',
    });
    return;
  }

  if (!code) {
    await markMetaIntegrationFailed(tenantId, 'no authorization code in callback');
    res.status(400).json({ error: 'missing_code', message: 'Meta did not return an authorization code.' });
    return;
  }

  const config = getMetaOAuthConfig();
  if (!config) {
    // Shouldn't happen in practice (connect/ already 503s without config),
    // but the callback must fail closed too if config was removed mid-flow.
    await markMetaIntegrationFailed(tenantId, 'META_OAUTH_CLIENT_ID/SECRET not configured at callback time');
    res.status(503).json({ error: 'meta_oauth_not_configured', message: 'Meta OAuth app credentials are not configured.' });
    return;
  }

  // 4. Exchange the authorization code for a short-lived access token.
  let shortLived;
  try {
    shortLived = await exchangeCodeForToken(code, config);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markMetaIntegrationFailed(tenantId, `code exchange request failed: ${message}`);
    res.status(502).json({ error: 'token_exchange_failed', message: 'Could not reach Meta to exchange the authorization code.' });
    return;
  }
  if (!shortLived.access_token) {
    await markMetaIntegrationFailed(tenantId, shortLived.error?.message || 'no access_token in code-exchange response');
    res.status(502).json({
      error: 'token_exchange_failed',
      message: shortLived.error?.message || 'Meta did not return an access token for the provided code.',
    });
    return;
  }

  // 5. Exchange for a long-lived (~60 day) token. Meta long-lived user tokens
  // have no separate refresh_token — see refreshLongLivedToken(). Falls back
  // to the short-lived token (same precedent as the existing single-account
  // flow in src/routes/social.ts) rather than failing the whole connect if
  // only this second hop errors — the tenant still ends up connected, just
  // with a token that expires sooner and will need an earlier refresh.
  let accessToken = shortLived.access_token;
  let tokenType = shortLived.token_type || 'bearer';
  // Short-lived tokens are ~1-2hr if Meta doesn't say otherwise; long-lived
  // are ~60 days. Only used as a fallback when `expires_in` is absent from
  // the response, which stays accurate for whichever token we end up using.
  let expiresInSeconds = shortLived.expires_in ?? 60 * 60;
  try {
    const longLived = await exchangeForLongLivedToken(shortLived.access_token, config);
    if (longLived.access_token) {
      accessToken = longLived.access_token;
      tokenType = longLived.token_type || tokenType;
      expiresInSeconds = longLived.expires_in ?? 60 * 24 * 60 * 60;
    } else {
      logger.warn(`[integrations/meta callback] long-lived exchange failed for tenant ${tenantId}, keeping short-lived token: ${longLived.error?.message}`);
    }
  } catch (e) {
    logger.warn(`[integrations/meta callback] long-lived exchange request failed for tenant ${tenantId}, keeping short-lived token: ${e instanceof Error ? e.message : e}`);
  }

  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await saveMetaCredentials(tenantId, { accessToken, tokenType, expiresAt });

  res.json({ success: true, provider: 'meta', status: 'connected', expiresAt });
});

export default router;
