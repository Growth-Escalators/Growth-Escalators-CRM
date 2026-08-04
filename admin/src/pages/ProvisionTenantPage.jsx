import React, { useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { apiFetch, getPermissions } from '../lib/api.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import { UserPlus, ShieldOff, Check, Copy } from 'lucide-react';

// ---------------------------------------------------------------------------
// Platform-superadmin-only page: onboards a new reseller-pilot tenant from
// the admin panel instead of the terminal (`npm run onboarding:provision-
// reseller-tenant`). POSTs to POST /api/platform/tenants
// (src/routes/platformTenants.ts), which wraps the exact same, already-
// reviewed logic the CLI script runs (src/services/tenantProvisioning.ts) —
// no new tenant/user-creation behavior lives here, only the form + results
// UI around it.
//
// Same defense-in-depth pattern as BrandingPage.jsx: the nav already hides
// this page from non-superadmins (navEntries.js `visible: f =>
// f.isPlatformSuperadmin`) and the backend route re-checks the DB-backed
// flag independently, but a non-superadmin can still land here via direct
// URL — show a clean message instead of a raw 403.
//
// Scope: create-tenant only. Listing/managing existing tenants is a natural
// follow-up, not built here.
// ---------------------------------------------------------------------------

// Client-side approximation of the backend's TENANT_SLUG_PATTERN
// (src/services/tenantProvisioning.ts) — lowercase letters/digits separated
// by single hyphens. This is just a friendlier auto-suggestion; the backend
// re-validates and is the source of truth (see validateTenantSlug there).
function slugifyName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function CopyField({ label, value, mono = true }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — the value is still visible/selectable on screen
    }
  }
  return (
    <div>
      <p className="text-xs font-semibold text-slate-700 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`flex-1 block bg-slate-100 border border-slate-200 px-3 py-2 rounded text-slate-900 text-sm break-all ${mono ? 'font-mono' : ''}`}>
          {value}
        </code>
        <button
          onClick={doCopy}
          title={`Copy ${label.toLowerCase()}`}
          className="shrink-0 p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function ResultPanel({ result, onReset }) {
  const { tenant, owner, loginUrl, temporaryPassword, note } = result;
  return (
    <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden">
      <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100">
        <h2 className="font-bold text-emerald-900">
          {tenant.alreadyExisted ? 'Tenant already existed — reused' : 'Tenant provisioned'} ✓
        </h2>
        <p className="text-xs text-emerald-700 mt-0.5">
          {tenant.name} ({tenant.slug}){tenant.alreadyExisted ? '' : ' — plan: ' + tenant.plan}
        </p>
      </div>
      <div className="p-6 space-y-4">
        <div className="text-sm"><span className="font-semibold text-slate-700">Owner:</span> <span className="text-slate-900">{owner.name}</span> <span className="text-slate-500">({owner.email})</span></div>
        <CopyField label="Login URL — share this with the tenant owner" value={loginUrl} mono={false} />
        {temporaryPassword ? (
          <div>
            <CopyField label="Temporary password" value={temporaryPassword} />
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
              This password is shown ONCE, right now, and is never stored or logged anywhere in plaintext again.
              Copy and share it securely with the tenant owner — they can change it any time via
              "Forgot password" on the login page.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{note || 'No new password was minted — the owner user already existed.'}</p>
        )}
      </div>
      <div className="px-6 pb-5">
        <button
          onClick={onReset}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
        >
          Provision another tenant
        </button>
      </div>
    </div>
  );
}

export default function ProvisionTenantPage() {
  const { showError } = useToast();
  const isPlatformSuperadmin = getPermissions()?.isPlatformSuperadmin === true;

  const [searchOpen, setSearchOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  function handleNameChange(value) {
    setName(value);
    if (!slugTouched) setSlug(slugifyName(value));
  }

  function handleSlugChange(value) {
    setSlugTouched(true);
    setSlug(value.toLowerCase());
  }

  function resetForm() {
    setResult(null);
    setName('');
    setSlug('');
    setSlugTouched(false);
    setOwnerName('');
    setOwnerEmail('');
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerName: ownerName.trim(),
        }),
      });
      setResult(res);
    } catch (err) {
      if (err.status === 403) {
        setError("You don't have platform-superadmin access.");
      } else {
        setError(err.message || 'Failed to provision tenant');
        showError(err.message || 'Failed to provision tenant');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <UserPlus className="w-6 h-6 text-sky-600" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Provision Tenant</h1>
              <p className="text-sm text-slate-500">Onboard a new reseller-pilot agency — creates the tenant, an owner login, and a starter pipeline.</p>
            </div>
          </div>

          {!isPlatformSuperadmin ? (
            <EmptyState
              icon={ShieldOff}
              title="You don't have access to this page"
              description="Provisioning tenants requires platform-superadmin access. Contact Jatin if you need this."
            />
          ) : result ? (
            <ResultPanel result={result} onReset={resetForm} />
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Agency name *</label>
                <input
                  value={name}
                  onChange={e => handleNameChange(e.target.value)}
                  required
                  placeholder="Acme Marketing Co"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tenant slug *</label>
                <input
                  value={slug}
                  onChange={e => handleSlugChange(e.target.value)}
                  required
                  placeholder="acme-marketing"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-xs text-slate-400 mt-1">Lowercase letters/digits, single hyphens — auto-suggested from the agency name, editable. Used in the login URL.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Owner name</label>
                <input
                  value={ownerName}
                  onChange={e => setOwnerName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Owner email *</label>
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={e => setOwnerEmail(e.target.value)}
                  required
                  placeholder="owner@acmemarketing.example"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
                >
                  {submitting ? 'Provisioning…' : 'Provision Tenant'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
