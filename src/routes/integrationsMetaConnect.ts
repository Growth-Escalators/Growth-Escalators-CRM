// ---------------------------------------------------------------------------
// GET /api/integrations/meta/connect — start the per-tenant Meta OAuth flow.
//
// Mounted WITHOUT requireAuth in src/index.ts (registered BEFORE the
// authenticated /api/integrations mount) — the admin UI reaches this route
// via a real top-level browser navigation (`window.location.href = ...`),
// not an AJAX call, because completing Meta's OAuth consent screen requires
// an actual page redirect: a same-origin fetch()/apiFetch call would follow
// the resulting 302 in the background and then fail once it hit Meta's
// cross-origin, non-CORS dialog. A browser navigation can't attach a custom
// Authorization header, so — exactly like src/routes/social.ts's oauthRouter
// (`/facebook/start`) — the JWT is accepted via EITHER the Authorization
// header (API-style callers, and this route's own tests) OR a `?token=`
// query param (the real browser navigation) and verified manually here
// rather than via requireAuth middleware.
//
// A failure BEFORE we ever reach Meta (missing/invalid token, or the OAuth
// app not configured) can't be reported as a JSON body the way an AJAX error
// response could — the browser has already navigated away from the admin
// SPA. Missing/invalid-token failures still respond with a plain 401 JSON
// body (mirroring social.ts's oauthRouter precedent exactly), but the
// "not configured" case redirects back to the admin Integrations page with a
// `?meta=error` query string it already knows how to render (see
// admin/src/pages/IntegrationsPage.jsx), since that's the one failure mode a
// real tenant admin is expected to actually hit here.
// ---------------------------------------------------------------------------
import logger from '../utils/logger';
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { AuthPayload } from '../middleware/auth';
import {
  getMetaOAuthConfig,
  signOAuthState,
  buildMetaAuthorizeUrl,
  upsertPendingMetaState,
  META_OAUTH_NOT_CONFIGURED_MESSAGE,
} from '../services/metaOAuthService';

const router = Router();

// Where to send the browser back to on a failure that happens before we ever
// reach Meta — there's no Meta redirect to bounce off of yet, so we have to
// send the user back to the admin page ourselves. Mirrors POST_OAUTH_HOST in
// src/routes/social.ts, and the `?meta=...` query contract
// admin/src/pages/IntegrationsPage.jsx already parses on mount.
const POST_OAUTH_HOST = process.env.CRM_PUBLIC_HOST || 'https://crm.growthescalators.com';
const INTEGRATIONS_PAGE_PATH = '/settings/integrations';

router.get('/', async (req: Request, res: Response) => {
  // Accept the JWT from either the Authorization header or ?token= — see
  // module header for why both need to work here.
  let rawToken = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (!rawToken && req.query.token) rawToken = req.query.token as string;
  if (!rawToken) { res.status(401).json({ error: 'unauthorised' }); return; }

  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).json({ error: 'server misconfigured' }); return; }

  let tenantId: string | undefined;
  try {
    const decoded = jwt.verify(rawToken, secret) as AuthPayload;
    tenantId = decoded.tenantId;
  } catch {
    res.status(401).json({ error: 'invalid token' });
    return;
  }
  if (!tenantId) { res.status(401).json({ error: 'invalid token' }); return; }

  try {
    const config = getMetaOAuthConfig();
    if (!config) {
      logger.warn('[integrations/meta connect] not configured — redirecting back to admin');
      const params = new URLSearchParams({ meta: 'error', reason: 'not_configured', message: META_OAUTH_NOT_CONFIGURED_MESSAGE });
      res.redirect(`${POST_OAUTH_HOST}${INTEGRATIONS_PAGE_PATH}?${params.toString()}`);
      return;
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    await upsertPendingMetaState(tenantId, nonce);

    const state = signOAuthState({ tenantId, nonce, iat: Date.now() });
    const authorizeUrl = buildMetaAuthorizeUrl(config, state);
    res.redirect(authorizeUrl);
  } catch (e) {
    logger.error('[integrations/meta connect] failed:', e);
    res.status(500).json({ error: 'failed to start meta connect flow' });
  }
});

export default router;
