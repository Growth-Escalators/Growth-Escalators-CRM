import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { SkeletonCard } from '../components/SkeletonLoader.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import { apiFetch } from '../lib/api.js';
import { getAuthToken } from '../lib/auth.js';
import { Plug, AlertTriangle, CheckCircle2, Clock, XCircle, ShieldOff } from 'lucide-react';

// ---------------------------------------------------------------------------
// Tenant Integrations settings page.
//
// First (and so far only) provider wired up here is the NEW, per-tenant Meta
// OAuth connect flow shipped in PR #122 (src/routes/integrations.ts +
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

export default function IntegrationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [integration, setIntegration] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [disconnectErr, setDisconnectErr] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
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
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

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
            <MetaIntegrationCard
              integration={integration}
              connecting={connecting}
              unavailable={unavailable}
              onConnect={handleConnect}
              onDisconnect={() => setConfirmDisconnect(true)}
            />
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
      </main>
    </div>
  );
}
