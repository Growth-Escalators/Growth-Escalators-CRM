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
import { Plug, AlertTriangle, CheckCircle2, Clock, XCircle, ShieldOff, Mail, Globe, ShoppingBag } from 'lucide-react';

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

// ---------------------------------------------------------------------------
// Generic tenant-integrations UI — wires up src/routes/tenantIntegrations.ts
// (GET list/status open to any authenticated tenant member; PUT/DELETE
// owner-only, enforced server-side). The backend never echoes a credential
// value back in any response (see tenantIntegrationsService.ts's
// PublicIntegration whitelist), so this UI never tries to render one either
// — only a connected/disconnected badge, plus whatever non-secret `metadata`
// we ourselves chose to store at connect time (host + a masked identifier).
//
// SMTP ('email_smtp') is the one confirmed real consumer today —
// emailService.ts / multiDomainMailer.ts's getTenantSmtpCredentials() reads
// exactly this provider key and shape ({ host, port, user, pass }; `user`
// doubles as the outgoing "From" address — see sendWithInboxes). Any other
// provider row (future) still gets a generic connected-status + disconnect
// action via OtherIntegrationsList below, without needing its own bespoke UI.
// ---------------------------------------------------------------------------

// Masks all but the first/last character of an identifier (e.g. an SMTP
// username) for display — never the credential itself, just a value we
// chose to store in non-secret `metadata` at connect time.
function maskIdentifier(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 3) return '•'.repeat(trimmed.length);
  return `${trimmed[0]}${'•'.repeat(Math.max(trimmed.length - 2, 3))}${trimmed[trimmed.length - 1]}`;
}

function SmtpIntegrationCard({ integration, isOwner, saving, onSave, onDisconnectRequest }) {
  const status = integration?.status || 'disconnected';
  const info = statusInfo(status);
  const StatusIcon = info.icon;
  const metadata = integration?.metadata || {};
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ host: '', port: '587', user: '', pass: '' });
  const [formError, setFormError] = useState('');

  function update(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const canSubmit = form.host.trim().length > 0 && Number(form.port) > 0
    && form.user.trim().length > 0 && form.pass.length > 0;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setFormError('');
    try {
      await onSave({ host: form.host.trim(), port: Number(form.port), user: form.user.trim(), pass: form.pass });
      setEditing(false);
      setForm({ host: '', port: '587', user: '', pass: '' });
    } catch (err) {
      setFormError(err.message || 'Failed to save SMTP credentials');
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5 text-sky-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">Email sending (SMTP)</p>
            <p className="text-sm text-slate-500 mt-0.5 max-w-lg">
              Send email through this tenant's own mailbox instead of Growth Escalators' shared sending pool.
            </p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.badge}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${info.iconColor}`} />
          {info.label}
        </span>
      </div>

      {status === 'connected' && (metadata.host || metadata.userMasked) && (
        <p className="mt-3 text-xs text-slate-500 font-mono">
          {metadata.host || '—'}{metadata.userMasked ? ` (${metadata.userMasked})` : ''}
        </p>
      )}

      {!isOwner ? (
        <p className="mt-4 text-xs text-slate-400">Only the tenant owner can connect or disconnect this integration.</p>
      ) : status === 'connected' ? (
        <div className="mt-4">
          <button
            onClick={onDisconnectRequest}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : editing ? (
        <form onSubmit={submit} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          {formError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">SMTP host *</label>
              <input
                value={form.host} onChange={e => update('host', e.target.value)}
                placeholder="smtp.gmail.com" required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Port *</label>
              <input
                type="number" value={form.port} onChange={e => update('port', e.target.value)}
                placeholder="587" required
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Username / From address *</label>
            <input
              type="email" value={form.user} onChange={e => update('user', e.target.value)}
              placeholder="no-reply@youragency.com" required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="text-xs text-slate-400 mt-1">Used to log in to the SMTP server, and as the "From" address on outgoing mail.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password *</label>
            <input
              type="password" value={form.pass} onChange={e => update('pass', e.target.value)}
              placeholder="••••••••" required autoComplete="new-password"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={!canSubmit || saving}
              className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors">
              {saving ? 'Connecting…' : 'Connect'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setFormError(''); }}
              className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <button
            onClick={() => setEditing(true)}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
          >
            Connect your SMTP account
          </button>
        </div>
      )}
    </div>
  );
}

// Any OTHER connected provider row (beyond the dedicated SMTP card above) —
// status + a generic disconnect action, so a future provider doesn't need
// its own bespoke card to at least be visible and disconnectable.

/**
 * WordPress + Shopify credential cards.
 *
 * The site adapters (src/modules/site/providers/) read credentials ONLY from
 * the encrypted `tenant_integrations` store — they contain zero `process.env`
 * reads by design, because the legacy WP_* variables are part of a live
 * credential exposure. Without these two forms the only way to store a
 * credential was a raw API call, which is not a thing to ask of an operator
 * who is mid-way through closing that exposure.
 *
 * NOTE the split: credentials live here; the site's non-secret config (a
 * WordPress base URL, Shopify's theme-snippet flag, a git repo/branch) lives
 * on the SEO site registry, because `seo_sites.adapter_config` rejects any key
 * matching /pass|secret|token|key|credential|auth/i server-side.
 */
function SiteCredentialCard({ provider, title, icon: Icon, iconTone, blurb, hint, fields, integration, isOwner, saving, onSave, onDisconnectRequest }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.name, ''])));
  const [error, setError] = useState(null);
  const status = integration?.status === 'connected' ? 'connected' : 'not_connected';
  const info = statusInfo(status);
  const StatusIcon = info.icon;
  const canSubmit = fields.every(f => values[f.name].trim().length > 0) && !saving;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      await onSave(Object.fromEntries(fields.map(f => [f.name, values[f.name].trim()])));
      // Cleared, never repopulated: PublicIntegration structurally carries no
      // credential, so there is nothing to render back even if we wanted to.
      setValues(Object.fromEntries(fields.map(f => [f.name, ''])));
    } catch (err) {
      setError(err?.message || 'Could not save those credentials.');
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg ${iconTone} flex items-center justify-center flex-shrink-0`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">{title}</p>
            <p className="text-sm text-slate-500 mt-0.5 max-w-lg">{blurb}</p>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.badge}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${info.iconColor}`} />
          {info.label}
        </span>
      </div>

      {!isOwner ? (
        <p className="mt-4 text-sm text-slate-500">
          Only the tenant owner can connect this integration. You can see whether it is connected, but not change it.
        </p>
      ) : (
        <>
          {status === 'connected' && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={onDisconnectRequest}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                Disconnect
              </button>
              <span className="text-xs text-slate-500">Saving again replaces the stored credentials.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3 max-w-md">
            {fields.map(f => (
              <div key={f.name}>
                <label htmlFor={`${provider}-${f.name}`} className="block text-xs font-semibold text-slate-700 mb-1.5">{f.label}</label>
                <input
                  id={`${provider}-${f.name}`}
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[f.name]}
                  onChange={(e) => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-300"
                />
              </div>
            ))}
            {hint && <p className="text-xs text-slate-500">{hint}</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
            >
              {saving ? 'Saving…' : status === 'connected' ? 'Replace credentials' : `Connect ${title}`}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function OtherIntegrationsList({ integrations, isOwner, onDisconnectRequest }) {
  // Providers with a dedicated card above are excluded — listing them here
  // too would show the same integration twice with two different controls.
  const DEDICATED = ['email_smtp', 'wordpress', 'shopify'];
  const others = (integrations || []).filter(i => !DEDICATED.includes(i.provider) && i.status === 'connected');
  if (others.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="font-semibold text-slate-900 mb-3">Other connected integrations</p>
      <div className="space-y-2">
        {others.map(i => (
          <div key={i.provider} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-800">{i.provider}</p>
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 mt-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            </div>
            {isOwner && (
              <button
                onClick={() => onDisconnectRequest(i.provider)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-600 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  // Defense-in-depth, same posture as BrandingPage.jsx: the backend's PUT/
  // DELETE routes on /api/tenant-integrations are already owner-only
  // (src/routes/tenantIntegrations.ts's isOwner() check) — this only decides
  // whether to render the write controls, never whether the write itself
  // is allowed. A non-owner hitting the API directly is still 403'd there.
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

  // Generic tenant-integrations (src/routes/tenantIntegrations.ts) — separate
  // state from the Meta block above, which talks to the older Meta-only
  // /api/integrations router.
  const [tenantIntegrations, setTenantIntegrations] = useState([]);
  const [tiLoading, setTiLoading] = useState(true);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [wpSaving, setWpSaving] = useState(false);
  const [shopifySaving, setShopifySaving] = useState(false);
  const [tiDisconnectTarget, setTiDisconnectTarget] = useState(null); // provider name, or null
  const [tiDisconnectBusy, setTiDisconnectBusy] = useState(false);
  const [tiDisconnectErr, setTiDisconnectErr] = useState(null);

  const loadTenantIntegrations = useCallback(async () => {
    setTiLoading(true);
    try {
      const data = await apiFetch('/api/tenant-integrations');
      setTenantIntegrations(data?.integrations || []);
    } catch (err) {
      showError(err.message || 'Failed to load integrations');
    } finally {
      setTiLoading(false);
    }
  }, [showError]);

  useEffect(() => { loadTenantIntegrations(); }, [loadTenantIntegrations]);

  const smtpIntegration = tenantIntegrations.find(i => i.provider === 'email_smtp') || null;
  const wordpressIntegration = tenantIntegrations.find(i => i.provider === 'wordpress') || null;
  const shopifyIntegration = tenantIntegrations.find(i => i.provider === 'shopify') || null;

  // PUT is owner-gated server-side; on success, merge the returned row (never
  // the credentials we just sent) into local state so the card flips to
  // "Connected" without a full reload.
  async function handleSmtpSave(credentials) {
    setSmtpSaving(true);
    try {
      const body = {
        credentials,
        metadata: { host: credentials.host, userMasked: maskIdentifier(credentials.user) },
      };
      const data = await apiFetch('/api/tenant-integrations/email_smtp', { method: 'PUT', body: JSON.stringify(body) });
      setTenantIntegrations(prev => [...prev.filter(i => i.provider !== 'email_smtp'), data.integration]);
      showSuccess('SMTP connected');
    } finally {
      setSmtpSaving(false);
    }
  }

  async function saveSiteCredential(provider, credentials, setSaving, metadata) {
    setSaving(true);
    try {
      const data = await apiFetch(`/api/tenant-integrations/${provider}`, {
        method: 'PUT',
        body: JSON.stringify({ credentials, ...(metadata ? { metadata } : {}) }),
      });
      setTenantIntegrations(prev => [...prev.filter(i => i.provider !== provider), data.integration]);
      showSuccess(`${provider} connected`);
    } finally {
      setSaving(false);
    }
  }

  // Field names match the adapters' credential interfaces exactly
  // (WordPressCredentials / ShopifyCredentials). A mismatch here surfaces at
  // call time as `missing_configuration` with no hint as to why.
  const handleWordPressSave = (c) =>
    saveSiteCredential('wordpress', c, setWpSaving, { userMasked: maskIdentifier(c.username) });
  const handleShopifySave = (c) =>
    saveSiteCredential('shopify', c, setShopifySaving, { shop: c.shop });

  async function runTiDisconnect() {
    if (!tiDisconnectTarget) return;
    setTiDisconnectBusy(true);
    setTiDisconnectErr(null);
    try {
      const data = await apiFetch(`/api/tenant-integrations/${encodeURIComponent(tiDisconnectTarget)}`, { method: 'DELETE' });
      setTenantIntegrations(prev => [...prev.filter(i => i.provider !== tiDisconnectTarget), data.integration]);
      showSuccess('Disconnected');
      setTiDisconnectTarget(null);
    } catch (err) {
      setTiDisconnectErr(err.message || 'Failed to disconnect');
    } finally {
      setTiDisconnectBusy(false);
    }
  }

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
            <div className="space-y-6">
              <MetaIntegrationCard
                integration={integration}
                connecting={connecting}
                unavailable={unavailable}
                onConnect={handleConnect}
                onDisconnect={() => setConfirmDisconnect(true)}
              />

              <div>
                <h2 className="text-base font-semibold text-slate-900 mb-3">More integrations</h2>
                {tiLoading ? (
                  <SkeletonCard className="h-32" />
                ) : (
                  <div className="space-y-4">
                    <SmtpIntegrationCard
                      integration={smtpIntegration}
                      isOwner={isOwner}
                      saving={smtpSaving}
                      onSave={handleSmtpSave}
                      onDisconnectRequest={() => setTiDisconnectTarget('email_smtp')}
                    />
                    <SiteCredentialCard
                      provider="wordpress"
                      title="WordPress"
                      icon={Globe}
                      iconTone="bg-slate-100 text-slate-600"
                      blurb="Publish approved SEO page changes to this tenant's WordPress site."
                      hint="This is a WordPress Application Password (WP admin → Users → your profile → Application Passwords), NOT the account login password. The site's URL is set on its SEO site record, not here."
                      fields={[
                        { name: 'username', label: 'WordPress username', placeholder: 'admin' },
                        { name: 'applicationPassword', label: 'Application password', secret: true, placeholder: 'xxxx xxxx xxxx xxxx' },
                      ]}
                      integration={wordpressIntegration}
                      isOwner={isOwner}
                      saving={wpSaving}
                      onSave={handleWordPressSave}
                      onDisconnectRequest={() => setTiDisconnectTarget('wordpress')}
                    />
                    <SiteCredentialCard
                      provider="shopify"
                      title="Shopify"
                      icon={ShoppingBag}
                      iconTone="bg-emerald-50 text-emerald-600"
                      blurb="Publish approved SEO page changes to this tenant's Shopify storefront."
                      hint="Admin API access token from a custom app. Structured data also needs the theme snippet enabled on the site's SEO record — without it the metafield is written but never renders."
                      fields={[
                        { name: 'shop', label: 'Shop domain', placeholder: 'example.myshopify.com' },
                        { name: 'accessToken', label: 'Admin API access token', secret: true, placeholder: 'shpat_…' },
                      ]}
                      integration={shopifyIntegration}
                      isOwner={isOwner}
                      saving={shopifySaving}
                      onSave={handleShopifySave}
                      onDisconnectRequest={() => setTiDisconnectTarget('shopify')}
                    />
                    <OtherIntegrationsList
                      integrations={tenantIntegrations}
                      isOwner={isOwner}
                      onDisconnectRequest={(provider) => setTiDisconnectTarget(provider)}
                    />
                  </div>
                )}
              </div>
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
          open={!!tiDisconnectTarget}
          title={tiDisconnectTarget === 'email_smtp' ? 'Disconnect SMTP?' : `Disconnect ${tiDisconnectTarget || ''}?`}
          impactSummary="This tenant's connection will stop working. You can reconnect any time."
          confirmLabel="Disconnect"
          danger
          loading={tiDisconnectBusy}
          error={tiDisconnectErr}
          onConfirm={runTiDisconnect}
          onCancel={() => { setTiDisconnectTarget(null); setTiDisconnectErr(null); }}
        />
      </main>
    </div>
  );
}
