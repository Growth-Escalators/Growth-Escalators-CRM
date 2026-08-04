// ---------------------------------------------------------------------------
// Third-party integration management — connect/list/disconnect/refresh.
//
// Mounted at /api/integrations with requireAuth + requireRole('admin') in
// src/index.ts (there is no "owner" role in this codebase — 'admin' is the
// closest analogue, see PR body). The OAuth *callback* route lives in the
// separate, unauthenticated src/routes/integrationsMetaCallback.ts — Meta
// redirects the raw browser there and cannot carry an Authorization header,
// mirroring the existing /api/social/oauth vs /api/social split.
//
// Every query below is scoped by req.user!.tenantId, taken from the
// server-verified JWT — never from a client-supplied id — so there is no
// parameter a caller could substitute to reach another tenant's row.
// ---------------------------------------------------------------------------
import logger from '../utils/logger';
import { Router } from 'express';
import crypto from 'crypto';
import {
  getMetaOAuthConfig,
  signOAuthState,
  buildMetaAuthorizeUrl,
  upsertPendingMetaState,
  getTenantIntegration,
  disconnectMetaIntegration,
  decryptMetaCredentials,
  refreshLongLivedToken,
  isNearExpiry,
  saveMetaCredentials,
} from '../services/metaOAuthService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/integrations — list every provider connection for the caller's
// tenant. Never includes encryptedCredentials.
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const meta = await getTenantIntegration(tenantId, 'meta');
    const integrations = [meta].filter((row): row is NonNullable<typeof meta> => row !== null).map((row) => ({
      provider: row.provider,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    res.json({ integrations });
  } catch (e) {
    logger.error('[integrations] list failed:', e);
    res.status(500).json({ error: 'failed to list integrations' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/meta — this tenant's Meta connection status only.
// ---------------------------------------------------------------------------
router.get('/meta', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const row = await getTenantIntegration(tenantId, 'meta');
    if (!row) { res.status(404).json({ error: 'not_found', message: 'Meta is not connected for this tenant' }); return; }
    res.json({
      provider: row.provider,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    logger.error('[integrations] meta status failed:', e);
    res.status(500).json({ error: 'failed to load meta integration' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/integrations/meta/connect — start the OAuth flow.
//
// SCAFFOLDING NOTE: this 503s until Jatin sets META_OAUTH_CLIENT_ID /
// META_OAUTH_CLIENT_SECRET for a Meta Developer App created specifically for
// this product's multi-tenant connect flow — see PR body.
// ---------------------------------------------------------------------------
router.get('/meta/connect', async (req, res) => {
  try {
    const config = getMetaOAuthConfig();
    if (!config) {
      res.status(503).json({
        error: 'meta_oauth_not_configured',
        message: 'META_OAUTH_CLIENT_ID / META_OAUTH_CLIENT_SECRET are not set — the Meta Developer App for this connect flow has not been created yet.',
      });
      return;
    }

    const tenantId = req.user!.tenantId;
    const nonce = crypto.randomBytes(16).toString('hex');
    await upsertPendingMetaState(tenantId, nonce);

    const state = signOAuthState({ tenantId, nonce, iat: Date.now() });
    const authorizeUrl = buildMetaAuthorizeUrl(config, state);
    res.redirect(authorizeUrl);
  } catch (e) {
    logger.error('[integrations] meta connect failed:', e);
    res.status(500).json({ error: 'failed to start meta connect flow' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/integrations/meta/refresh — manually trigger a long-lived-token
// refresh for the caller's tenant. Nothing schedules this automatically yet
// (no cron wiring in this PR — see PR body); this route exists so the
// refresh mechanics are exercisable/testable ahead of that follow-up.
// ---------------------------------------------------------------------------
router.post('/meta/refresh', async (req, res) => {
  try {
    const config = getMetaOAuthConfig();
    if (!config) {
      res.status(503).json({ error: 'meta_oauth_not_configured', message: 'META_OAUTH_CLIENT_ID / META_OAUTH_CLIENT_SECRET are not set' });
      return;
    }

    const tenantId = req.user!.tenantId;
    const row = await getTenantIntegration(tenantId, 'meta');
    if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
      res.status(404).json({ error: 'not_connected', message: 'Meta is not connected for this tenant' });
      return;
    }

    const current = decryptMetaCredentials(row.encryptedCredentials);
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    if (!isNearExpiry(metadata.expiresAt as string | undefined) && req.query.force !== 'true') {
      res.json({ refreshed: false, reason: 'not_near_expiry', expiresAt: metadata.expiresAt });
      return;
    }

    const refreshed = await refreshLongLivedToken(current.accessToken, config);
    if (!refreshed.access_token) {
      logger.warn(`[integrations] meta token refresh failed for tenant ${tenantId}: ${refreshed.error?.message || 'no access_token in response'}`);
      res.status(502).json({
        error: 'refresh_failed',
        message: refreshed.error?.message || 'Meta did not return a refreshed access token',
      });
      return;
    }

    const expiresAt = new Date(Date.now() + (refreshed.expires_in ?? 60 * 24 * 60 * 60) * 1000).toISOString();
    await saveMetaCredentials(tenantId, {
      accessToken: refreshed.access_token,
      tokenType: refreshed.token_type || 'bearer',
      expiresAt,
    });
    res.json({ refreshed: true, expiresAt });
  } catch (e) {
    logger.error('[integrations] meta refresh failed:', e);
    res.status(500).json({ error: 'failed to refresh meta token' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/integrations/meta — disconnect. Scoped structurally to the
// caller's own tenant (see module header) so a tenant can never disconnect
// another tenant's Meta connection.
// ---------------------------------------------------------------------------
router.delete('/meta', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const existed = await disconnectMetaIntegration(tenantId);
    if (!existed) { res.status(404).json({ error: 'not_found', message: 'Meta is not connected for this tenant' }); return; }
    res.json({ success: true, provider: 'meta', status: 'disconnected' });
  } catch (e) {
    logger.error('[integrations] meta disconnect failed:', e);
    res.status(500).json({ error: 'failed to disconnect meta' });
  }
});

export default router;
