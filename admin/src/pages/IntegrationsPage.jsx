import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { SkeletonCard } from '../components/SkeletonLoader.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import { apiFetch, getPermissions } from '../lib/api.js';
import { getAuthToken } from '../lib/auth.js';
import { Plug, AlertTriangle, CheckCircle2, Clock, XCircle, ShieldOff, Globe, ShoppingBag } from 'lucide-react';

// ---------------------------------------------------------------------------
// Tenant Integrations settings page.
//
// The first provider wired up here was the per-tenant Meta OAuth connect
// flow shipped in PR #122 (src/routes/integrations.ts +
// src/services/metaOAuthService.ts). This is deliberately a SEPARATE surface
// from the existing "Connect Facebook" buttons on SocialPage.jsx /
// MetaAssetsPage.jsx — those call `/api/social/accounts/connect-facebook`,
// a manual-token-paste flow against Growth Escalators' own single shared
// Meta Business account, and are untouched by this file.
//
// `/api/integrations/meta/connect` reuses the existing single-account Meta
// Developer App's credentials (`META_APP_ID` / `META_APP_SECRET`, already
// configured in Railway) unless dedicated `META_OAUTH_CLIENT_ID` /
// `META_OAUTH_CLIENT_SECRET` are set for a future standalone app — see
// src/services/metaOAuthService.ts. The "unavailable" state below is now the
// EXCEPTIONAL case (neither pair configured), not the expected default.
//
// WordPress and Shopify (Phase 4, site-adapter credentials) are a SEPARATE
// backend surface again: `src/routes/tenantIntegrations.ts`, mounted at
// `/api/tenant-integrations` and backed by `tenantIntegrationsService.ts`'s
// encrypted `tenant_integrations` table — not the Meta OAuth flow above, and
// not `/api/integrations`. GET is readable by any authenticated tenant
// member; PUT (save credentials) and DELETE (disconnect) are owner-only.
// Critically, GET never returns a stored credential value — only
// `status`/`metadata`/timestamps (see `PublicIntegration`) — so this page can
// only ever show connected/not-connected state and a form to REPLACE
// credentials; it can never pre-fill an existing secret.
// ---------------------------------------------------------------------------

const STATUS_META = {
  connected: { label: 'Connected', badge: 'bg-green-100 text-green-700', icon: CheckCircle2, iconColor: 'text-green-500' },
  pending: { label: 'Connecting…', badge: 'bg-amber-100 text-amber-700', icon: Clock, iconColor: 'text-amber-500' },
  error: { label: 'Connection error', badge: 'bg-red-100 text-red-700', icon: XCircle, iconColor: 'text-red-500' },
  disconnected: { label: 'Not connected', badge: 'bg-slate-100 text-slate-500', icon: ShieldOff, iconColor: 'text-slate-400' },
};

function statusInfo(status) {
  return STATUS_META[status] || STATUS_META.disconnected;
}

function MetaIntegrationCard({ integration, connecting, unavailable, onConnect, onDisconnect }) {
  const status = integration?.status || 'disconnected';
  const info = statusInfo(status);
  const StatusIcon = info.icon;
  const metadata = integration?.metadata || {};

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#e7f0fd] flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Meta Ads (Facebook &amp; Instagram)</p>
            <p className="text-sm text-slate-500 mt-0.5 max-w-lg">
              Connect this tenant's own Meta Business account for ads reporting, lead forms, and audience sync.
              This is separate from Growth Escalators' shared Meta account used on the Social page.
            </p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.badge}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${info.iconColor}`} />
          {info.label}
        </span>
      </div>

      {status === 'connected' && (
        <div className="mt-4 text-xs text-slate-500 space-y-0.5">
          {metadata.connectedAt && (
            <p>Connected {new Date(metadata.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          )}
          {metadata.expiresAt && (
            <p>Token refreshes automatically before {new Date(metadata.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          )}
        </div>
      )}

      {status === 'error' && metadata.error && (
        <p className="mt-3 text-sm text-red-600">{String(metadata.error)}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        {status === 'connected' ? (
          <button
            onClick={onDisconnect}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={connecting}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
          >
            {connecting ? 'Connecting…' : status === 'error' ? 'Try connecting again' : 'Connect your Meta Ads account'}
          </button>
        )}
      </div>

      {unavailable && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Meta connection isn't available yet</p>
            <p className="text-sm text-amber-700 mt-1">
              We're still setting up per-tenant Meta connections on our end. This isn't something wrong on
              your side — contact support and we'll let you know as soon as it's ready.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function formattedDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Shared "owner only" explanation shown in place of a credential form —
// never a form that would just 403 on submit. Wording differs slightly by
// connection state so a non-owner isn't told "connect" when one already has.
function OwnerOnlyNotice({ connected }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-600">
        {connected
          ? 'A tenant owner has connected this integration. Only an owner can view its status or replace its credentials.'
          : 'Only the tenant owner can connect this integration.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WordPress — credentials are a WP "Application Password"
// (WordPressCredentials: { username, applicationPassword }), never the
// account login password. See src/modules/site/providers/wordpress.provider.ts.
// ---------------------------------------------------------------------------
function WordPressIntegrationCard({ integration, isOwner, saving, error, onSave, onDisconnect }) {
  const status = integration?.status === 'connected' ? 'connected' : 'disconnected';
  const info = statusInfo(status);
  const StatusIcon = info.icon;
  const updatedAt = formattedDate(integration?.updatedAt);

  const [username, setUsername] = useState('');
  const [applicationPassword, setApplicationPassword] = useState('');
  const canSubmit = username.trim().length > 0 && applicationPassword.trim().length > 0 && !saving;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onSave({ username: username.trim(), applicationPassword: applicationPassword.trim() });
    // Never leave a submitted secret sitting in the form — clear on success;
    // leave it in place on failure so the owner can fix a typo and retry.
    if (ok) {
      setUsername('');
      setApplicationPassword('');
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Globe className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">WordPress</p>
            <p className="text-sm text-slate-500 mt-0.5 max-w-lg">
              Connect this tenant's WordPress site so staged SEO page changes can be published there.
            </p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.badge}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${info.iconColor}`} />
          {info.label}
        </span>
      </div>

      {status === 'connected' && updatedAt && (
        <p className="mt-3 text-xs text-slate-500">Last updated {updatedAt}</p>
      )}

      {!isOwner ? (
        <OwnerOnlyNotice connected={status === 'connected'} />
      ) : (
        <>
          {status === 'connected' && (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={onDisconnect}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                Disconnect
              </button>
              <span className="text-xs text-slate-500">To use a different WordPress account, disconnect first, then reconnect below.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3 max-w-md">
            <div>
              <label htmlFor="wp-username" className="block text-xs font-semibold text-slate-700 mb-1.5">WordPress username</label>
              <input
                id="wp-username"
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label htmlFor="wp-app-password" className="block text-xs font-semibold text-slate-700 mb-1.5">Application password</label>
              <input
                id="wp-app-password"
                type="password"
                autoComplete="off"
                value={applicationPassword}
                onChange={(e) => setApplicationPassword(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                This is a WordPress <strong>Application Password</strong> — generate one under WP admin →
                Users → your profile → Application Passwords. It is <strong>not</strong> your WordPress
                account login password; using your login password here would store a far more sensitive
                credential than this integration needs.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : status === 'connected' ? 'Replace credentials' : 'Connect WordPress'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shopify — credentials are a custom-app Admin API access token
// (ShopifyCredentials: { shop, accessToken }). See
// src/modules/site/providers/shopify.provider.ts.
// ---------------------------------------------------------------------------
function ShopifyIntegrationCard({ integration, isOwner, saving, error, onSave, onDisconnect }) {
  const status = integration?.status === 'connected' ? 'connected' : 'disconnected';
  const info = statusInfo(status);
  const StatusIcon = info.icon;
  const updatedAt = formattedDate(integration?.updatedAt);

  const [shop, setShop] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const canSubmit = shop.trim().length > 0 && accessToken.trim().length > 0 && !saving;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onSave({ shop: shop.trim(), accessToken: accessToken.trim() });
    if (ok) {
      setShop('');
      setAccessToken('');
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#eaf6df] flex items-center justify-center flex-shrink-0">
            <ShoppingBag className="w-5 h-5 text-[#5e8e3e]" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">Shopify</p>
            <p className="text-sm text-slate-500 mt-0.5 max-w-lg">
              Connect this tenant's Shopify store so staged SEO page changes can be published there.
            </p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.badge}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${info.iconColor}`} />
          {info.label}
        </span>
      </div>

      {status === 'connected' && updatedAt && (
        <p className="mt-3 text-xs text-slate-500">Last updated {updatedAt}</p>
      )}

      {!isOwner ? (
        <OwnerOnlyNotice connected={status === 'connected'} />
      ) : (
        <>
          {status === 'connected' && (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={onDisconnect}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                Disconnect
              </button>
              <span className="text-xs text-slate-500">To use a different Shopify store, disconnect first, then reconnect below.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3 max-w-md">
            <div>
              <label htmlFor="shopify-shop" className="block text-xs font-semibold text-slate-700 mb-1.5">Shop domain</label>
              <input
                id="shopify-shop"
                type="text"
                autoComplete="off"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-xs text-slate-400 mt-1">Your Shopify admin URL — either the bare handle or the full myshopify.com hostname.</p>
            </div>
            <div>
              <label htmlFor="shopify-token" className="block text-xs font-semibold text-slate-700 mb-1.5">Admin API access token</label>
              <input
                id="shopify-token"
                type="password"
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="shpat_…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                From a custom app's Admin API access token in Shopify admin → Settings → Apps and sales
                channels → Develop apps.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : status === 'connected' ? 'Replace credentials' : 'Connect Shopify'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  // Defense-in-depth, same convention as BrandingPage.jsx: the nav/route can
  // hide owner-only affordances, but a non-owner can still land here via
  // direct URL — the PUT/DELETE routes in tenantIntegrations.ts 403 any
  // non-owner regardless of what this check does.
  const isOwner = getPermissions()?.isOwner === true;

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [integration, setIntegration] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [disconnectErr, setDisconnectErr] = useState(null);

  const [wordpressIntegration, setWordpressIntegration] = useState(null);
  const [wpSaving, setWpSaving] = useState(false);
  const [wpError, setWpError] = useState(null);
  const [wpConfirmDisconnect, setWpConfirmDisconnect] = useState(false);
  const [wpDisconnectBusy, setWpDisconnectBusy] = useState(false);
  const [wpDisconnectErr, setWpDisconnectErr] = useState(null);

  const [shopifyIntegration, setShopifyIntegration] = useState(null);
  const [shopifySaving, setShopifySaving] = useState(false);
  const [shopifyError, setShopifyError] = useState(null);
  const [shopifyConfirmDisconnect, setShopifyConfirmDisconnect] = useState(false);
  const [shopifyDisconnectBusy, setShopifyDisconnectBusy] = useState(false);
  const [shopifyDisconnectErr, setShopifyDisconnectErr] = useState(null);

  const loadMetaStatus = useCallback(async () => {
    try {
      const data = await apiFetch('/api/integrations');
      const meta = (data?.integrations || []).find((row) => row.provider === 'meta') || null;
      setIntegration(meta);
    } catch (err) {
      // Backend mounts /api/integrations behind requireRole('admin'); a
      // non-admin landing here directly (nav already hides the entry) gets a
      // clean explanation instead of a console error.
      if (err.status === 403) setForbidden(true);
      else showError(err.message || 'Failed to load integration status');
    }
  }, [showError]);

  // WordPress/Shopify credential status — a SEPARATE backend surface from
  // Meta above (`/api/tenant-integrations`, requireStrictAuth only, not
  // requireRole('admin')). Never returns a credential value, only
  // status/metadata/timestamps — see the file-header comment.
  const loadTenantIntegrations = useCallback(async () => {
    try {
      const data = await apiFetch('/api/tenant-integrations');
      const rows = data?.integrations || [];
      setWordpressIntegration(rows.find((row) => row.provider === 'wordpress') || null);
      setShopifyIntegration(rows.find((row) => row.provider === 'shopify') || null);
    } catch (err) {
      showError(err.message || 'Failed to load WordPress/Shopify integration status');
    }
  }, [showError]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    await Promise.all([loadMetaStatus(), loadTenantIntegrations()]);
    setLoading(false);
  }, [loadMetaStatus, loadTenantIntegrations]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // No optimistic updates for WordPress/Shopify — always refetch the real
  // server state in a `finally`, whether the PUT/DELETE succeeded or not.
  async function saveWordPress(credentials) {
    setWpSaving(true);
    setWpError(null);
    try {
      await apiFetch('/api/tenant-integrations/wordpress', { method: 'PUT', body: JSON.stringify({ credentials }) });
      showSuccess('WordPress connected');
      return true;
    } catch (err) {
      const msg = err.status === 403 ? 'Only the tenant owner can connect WordPress.' : (err.message || 'Failed to save WordPress credentials');
      setWpError(msg);
      showError(msg);
      return false;
    } finally {
      setWpSaving(false);
      await loadTenantIntegrations();
    }
  }

  async function runWordPressDisconnect() {
    setWpDisconnectBusy(true);
    setWpDisconnectErr(null);
    try {
      await apiFetch('/api/tenant-integrations/wordpress', { method: 'DELETE' });
      setWpConfirmDisconnect(false);
      showSuccess('WordPress disconnected');
    } catch (err) {
      setWpDisconnectErr(err.message || 'Failed to disconnect');
    } finally {
      setWpDisconnectBusy(false);
      await loadTenantIntegrations();
    }
  }

  async function saveShopify(credentials) {
    setShopifySaving(true);
    setShopifyError(null);
    try {
      await apiFetch('/api/tenant-integrations/shopify', { method: 'PUT', body: JSON.stringify({ credentials }) });
      showSuccess('Shopify connected');
      return true;
    } catch (err) {
      const msg = err.status === 403 ? 'Only the tenant owner can connect Shopify.' : (err.message || 'Failed to save Shopify credentials');
      setShopifyError(msg);
      showError(msg);
      return false;
    } finally {
      setShopifySaving(false);
      await loadTenantIntegrations();
    }
  }

  async function runShopifyDisconnect() {
    setShopifyDisconnectBusy(true);
    setShopifyDisconnectErr(null);
    try {
      await apiFetch('/api/tenant-integrations/shopify', { method: 'DELETE' });
      setShopifyConfirmDisconnect(false);
      showSuccess('Shopify disconnected');
    } catch (err) {
      setShopifyDisconnectErr(err.message || 'Failed to disconnect');
    } finally {
      setShopifyDisconnectBusy(false);
      await loadTenantIntegrations();
    }
  }

  // Handles the return trip from GET /api/integrations/meta/connect
  // (src/routes/integrationsMetaConnect.ts), which redirects back here with
  // `?meta=error&reason=...&message=...` on a failure that happens BEFORE
  // Meta is ever reached (e.g. the OAuth app not configured) — a real
  // top-level navigation can't inspect a JSON error body the way apiFetch
  // could, so the backend redirects instead. `?meta=connected` is NOT sent
  // yet: the actual OAuth callback (src/routes/integrationsMetaCallback.ts)
  // still responds with raw JSON by design (see that file's header comment)
  // rather than redirecting back here — that's a separate follow-up. This
  // branch is forward-compatible with it already, so wiring it up later
  // needs no frontend change.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const metaParam = params.get('meta');
    if (!metaParam) return;
    if (metaParam === 'connected') {
      showSuccess('Meta Ads account connected');
      loadStatus();
    } else if (metaParam === 'error') {
      if (params.get('reason') === 'not_configured') {
        setUnavailable(true);
      } else {
        showError(params.get('message') || "Meta connection didn't complete");
      }
    }
    navigate(location.pathname, { replace: true });
    // Intentionally run once on mount only — re-running on every loadStatus
    // identity change would re-process the same query string after we've
    // already stripped it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleConnect() {
    setConnecting(true);
    setUnavailable(false);
    // GET /api/integrations/meta/connect ends in a real `res.redirect(...)` —
    // either to Meta's consent screen, or (see the useEffect above) back to
    // this page with `?meta=error` on failure. That's a real top-level
    // browser navigation, which apiFetch (AJAX) cannot carry: a same-origin
    // fetch() silently follows a 302 in the background rather than
    // navigating the browser, and would fail once it reached Meta's
    // cross-origin, non-CORS OAuth dialog. Mirrors exactly how
    // SocialPage.jsx starts `/api/social/oauth/facebook/start`. The token
    // has to travel as a `?token=` query param rather than an Authorization
    // header for the same reason a real navigation can't set custom headers
    // (see integrationsMetaConnect.ts's header comment).
    window.location.href = `/api/integrations/meta/connect?token=${getAuthToken()}`;
  }

  async function runDisconnect() {
    setDisconnectBusy(true);
    setDisconnectErr(null);
    try {
      await apiFetch('/api/integrations/meta', { method: 'DELETE' });
      setConfirmDisconnect(false);
      showSuccess('Meta Ads account disconnected');
      await loadStatus();
    } catch (err) {
      setDisconnectErr(err.message || 'Failed to disconnect');
    } finally {
      setDisconnectBusy(false);
    }
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <Plug className="w-6 h-6 text-sky-600" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Integrations</h1>
              <p className="text-sm text-slate-500">Connect this tenant's own third-party accounts.</p>
            </div>
          </div>

          {loading ? (
            <SkeletonCard className="h-40" />
          ) : forbidden ? (
            <EmptyState
              icon={ShieldOff}
              title="You don't have access to this page"
              description="Managing integrations requires an admin account. Contact your admin if you need this."
            />
          ) : (
            <div className="space-y-6">
              <MetaIntegrationCard
                integration={integration}
                connecting={connecting}
                unavailable={unavailable}
                onConnect={handleConnect}
                onDisconnect={() => setConfirmDisconnect(true)}
              />
              <WordPressIntegrationCard
                integration={wordpressIntegration}
                isOwner={isOwner}
                saving={wpSaving}
                error={wpError}
                onSave={saveWordPress}
                onDisconnect={() => setWpConfirmDisconnect(true)}
              />
              <ShopifyIntegrationCard
                integration={shopifyIntegration}
                isOwner={isOwner}
                saving={shopifySaving}
                error={shopifyError}
                onSave={saveShopify}
                onDisconnect={() => setShopifyConfirmDisconnect(true)}
              />
            </div>
          )}
        </div>

        <ConfirmDialog
          open={confirmDisconnect}
          title="Disconnect Meta Ads account?"
          impactSummary="This tenant's Meta connection will stop working. You can reconnect any time."
          confirmLabel="Disconnect"
          danger
          loading={disconnectBusy}
          error={disconnectErr}
          onConfirm={runDisconnect}
          onCancel={() => { setConfirmDisconnect(false); setDisconnectErr(null); }}
        />

        <ConfirmDialog
          open={wpConfirmDisconnect}
          title="Disconnect WordPress?"
          impactSummary="This tenant's WordPress site adapter will stop working — staged SEO changes can no longer be published there until reconnected."
          confirmLabel="Disconnect"
          danger
          loading={wpDisconnectBusy}
          error={wpDisconnectErr}
          onConfirm={runWordPressDisconnect}
          onCancel={() => { setWpConfirmDisconnect(false); setWpDisconnectErr(null); }}
        />

        <ConfirmDialog
          open={shopifyConfirmDisconnect}
          title="Disconnect Shopify?"
          impactSummary="This tenant's Shopify site adapter will stop working — staged SEO changes can no longer be published there until reconnected."
          confirmLabel="Disconnect"
          danger
          loading={shopifyDisconnectBusy}
          error={shopifyDisconnectErr}
          onConfirm={runShopifyDisconnect}
          onCancel={() => { setShopifyConfirmDisconnect(false); setShopifyDisconnectErr(null); }}
        />
      </main>
    </div>
  );
}
