// ---------------------------------------------------------------------------
// Third-party integration management — list/disconnect/refresh.
//
// Mounted at /api/integrations with requireAuth + requireRole('admin') in
// src/index.ts (there is no "owner" role in this codebase — 'admin' is the
// closest analogue, see PR body). Two routes live OUTSIDE this authenticated
// router because they're reached by a real top-level browser navigation
// rather than an AJAX call, which can't carry an Authorization header:
//   - GET /api/integrations/meta/connect  → src/routes/integrationsMetaConnect.ts
//   - GET /api/integrations/meta/callback → src/routes/integrationsMetaCallback.ts
// mirroring the existing /api/social/oauth vs /api/social split.
//
// Every query below is scoped by req.user!.tenantId, taken from the
// server-verified JWT — never from a client-supplied id — so there is no
// parameter a caller could substitute to reach another tenant's row.
// ---------------------------------------------------------------------------
import logger from '../utils/logger';
import { Router } from 'express';
import {
  getMetaOAuthConfig,
  getTenantIntegration,
  disconnectMetaIntegration,
  decryptMetaCredentials,
  refreshLongLivedToken,
  isNearExpiry,
  saveMetaCredentials,
  META_OAUTH_NOT_CONFIGURED_MESSAGE,
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
// POST /api/integrations/meta/refresh — manually trigger a long-lived-token
// refresh for the caller's tenant. Nothing schedules this automatically yet
// (no cron wiring in this PR — see PR body); this route exists so the
// refresh mechanics are exercisable/testable ahead of that follow-up. Unlike
// /meta/connect, this is a plain AJAX call from an already-loaded settings
// page — no browser redirect is involved — so it has no reason to live
// outside the authenticated router.
// ---------------------------------------------------------------------------
router.post('/meta/refresh', async (req, res) => {
  try {
    const config = getMetaOAuthConfig();
    if (!config) {
      res.status(503).json({ error: 'meta_oauth_not_configured', message: META_OAUTH_NOT_CONFIGURED_MESSAGE });
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
