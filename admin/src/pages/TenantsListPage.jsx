import React, { useCallback, useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { apiFetch, getPermissions } from '../lib/api.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import { Building2, ShieldOff, ChevronDown, ChevronRight, Ban, CheckCircle2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Platform-superadmin-only page: lists every tenant on this platform and
// lets a superadmin suspend/reactivate a workspace, change its plan, and
// toggle its feature flags — the natural follow-up ProvisionTenantPage.jsx's
// own header comment called out as "not built here" ("Scope: create-tenant
// only. Listing/managing existing tenants is a natural follow-up.").
//
// Backs onto src/routes/platformTenants.ts:
//   GET   /api/platform/tenants              — this page's table
//   GET   /api/platform/tenants/:tenantId     — expanded row detail (features,
//                                               subscription plan limits)
//   PATCH /api/platform/tenants/:tenantId/status   — suspend/reactivate
//   PATCH /api/platform/tenants/:tenantId/features — feature-flag toggles
//   PATCH /api/platform/tenants/:tenantId/plan     — plan dropdown
//
// Same defense-in-depth pattern as ProvisionTenantPage.jsx: the nav hides
// this entry from non-superadmins (navEntries.js `visible: f =>
// f.isPlatformSuperadmin`) and every backend route re-checks the DB-backed
// flag independently, but a non-superadmin can still land here via direct
// URL — show a clean message instead of a raw 403.
// ---------------------------------------------------------------------------

// Mirrors src/services/tenantFeatures.ts's TenantFeatureFlags shape/order —
// keep in sync if a flag is added/removed there.
const FEATURE_LABELS = {
  wizmatch: 'Wizmatch',
  seo: 'SEO automation',
  crmAutomation: 'CRM automation',
  gstBilling: 'GST billing',
  d2c: 'D2C / ecom',
};

// Mirrors src/services/tenantFeatures.ts's KNOWN_PLANS (Object.keys(PLAN_DEFAULTS)).
// The backend is the source of truth and re-validates independently — this
// list only drives the dropdown's options.
const PLAN_OPTIONS = ['agency_internal', 'wizmatch_internal', 'client_basic', 'reseller_pilot'];

function StatusBadge({ isActive }) {
  return isActive ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      Active
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
      Suspended
    </span>
  );
}

function TenantDetailPanel({ tenant, onChanged }) {
  const { showError, showSuccess } = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingFeature, setSavingFeature] = useState(null); // feature key currently saving, or null
  const [confirmSuspendOpen, setConfirmSuspendOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await apiFetch(`/api/platform/tenants/${tenant.id}`);
      setDetail(res);
    } catch (err) {
      setLoadError(err.message || 'Failed to load tenant detail');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => { load(); }, [load]);

  async function handlePlanChange(e) {
    const plan = e.target.value;
    if (!detail || plan === detail.tenant.plan) return;
    setSavingPlan(true);
    try {
      const res = await apiFetch(`/api/platform/tenants/${tenant.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plan }),
      });
      setDetail((prev) => ({ ...prev, tenant: { ...prev.tenant, plan: res.plan }, features: res.features }));
      showSuccess(`Plan changed to "${res.plan}" — feature flags below were reset to that plan's defaults.`);
      onChanged?.();
    } catch (err) {
      showError(err.message || 'Failed to change plan');
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleFeatureToggle(key, nextValue) {
    setSavingFeature(key);
    try {
      const res = await apiFetch(`/api/platform/tenants/${tenant.id}/features`, {
        method: 'PATCH',
        body: JSON.stringify({ [key]: nextValue }),
      });
      setDetail((prev) => ({ ...prev, features: res.features }));
    } catch (err) {
      showError(err.message || 'Failed to update feature flag');
    } finally {
      setSavingFeature(null);
    }
  }

  async function runStatusChange(nextIsActive) {
    setStatusBusy(true);
    setStatusError(null);
    try {
      await apiFetch(`/api/platform/tenants/${tenant.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: nextIsActive }),
      });
      setDetail((prev) => ({ ...prev, tenant: { ...prev.tenant, isActive: nextIsActive } }));
      showSuccess(nextIsActive ? `${tenant.name} reactivated — access restored.` : `${tenant.name} suspended — every user is now locked out.`);
      setConfirmSuspendOpen(false);
      onChanged?.();
    } catch (err) {
      setStatusError(err.message || 'Failed to update workspace status');
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading tenant detail…</div>;
  if (loadError) return <div className="p-4 text-sm text-red-600">{loadError}</div>;
  if (!detail) return null;

  return (
    <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-700">Owner:</span>{' '}
          {detail.owner ? (
            <>{detail.owner.name} <span className="text-slate-400">({detail.owner.email})</span></>
          ) : (
            <span className="text-slate-400">no owner on record</span>
          )}
          <span className="ml-4 font-semibold text-slate-700">Active users:</span> {detail.userCount}
        </div>
        {detail.tenant.isActive ? (
          <button
            onClick={() => setConfirmSuspendOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100"
          >
            <Ban className="w-3.5 h-3.5" /> Suspend workspace
          </button>
        ) : (
          <button
            onClick={() => runStatusChange(true)}
            disabled={statusBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium hover:bg-emerald-100 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> {statusBusy ? 'Reactivating…' : 'Reactivate workspace'}
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Plan</label>
        <select
          value={detail.tenant.plan || ''}
          onChange={handlePlanChange}
          disabled={savingPlan}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {PLAN_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <p className="text-xs text-slate-400 mt-1">
          Changing the plan resets the feature flags below to that plan's defaults — any per-tenant
          overrides made through the toggles are cleared. Re-apply them after switching, if needed.
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1.5">Feature flags</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 max-w-md">
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!detail.features?.[key]}
                disabled={savingFeature === key}
                onChange={(e) => handleFeatureToggle(key, e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {detail.subscriptionPlan && (
        <div className="text-xs text-slate-500 border-t border-slate-200 pt-3">
          Active subscription: <span className="font-medium text-slate-700">{detail.subscriptionPlan.planName}</span>{' '}
          ({detail.subscriptionPlan.planCurrency} {detail.subscriptionPlan.planPrice}) — {detail.subscriptionPlan.subscriptionStatus}
        </div>
      )}

      <ConfirmDialog
        open={confirmSuspendOpen}
        title={`Suspend ${tenant.name}?`}
        impactSummary={`This will immediately lock out every user in ${tenant.name}. They will not be able to log in or use the API again until this workspace is reactivated.`}
        confirmLabel="Suspend workspace"
        danger
        requireTypedName={tenant.name}
        loading={statusBusy}
        error={statusError}
        onConfirm={() => runStatusChange(false)}
        onCancel={() => { setConfirmSuspendOpen(false); setStatusError(null); }}
      />
    </div>
  );
}

export default function TenantsListPage() {
  const { showError } = useToast();
  const isPlatformSuperadmin = getPermissions()?.isPlatformSuperadmin === true;

  const [searchOpen, setSearchOpen] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 200 (the route's own cap) covers every tenant expected for the
      // foreseeable future — see platformTenants.ts's GET / comment on why a
      // flat, single page is fine today.
      const res = await apiFetch('/api/platform/tenants?limit=200');
      setTenants(res.tenants || []);
    } catch (err) {
      setError(err.message || 'Failed to load tenants');
      showError(err.message || 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (isPlatformSuperadmin) load();
  }, [isPlatformSuperadmin, load]);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 max-w-5xl">
          <div className="flex items-center gap-3 mb-6">
            <Building2 className="w-6 h-6 text-sky-600" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Tenants</h1>
              <p className="text-sm text-slate-500">Every workspace on this platform — plan, status, users, and feature flags. Click a row for detail.</p>
            </div>
          </div>

          {!isPlatformSuperadmin ? (
            <EmptyState
              icon={ShieldOff}
              title="You don't have access to this page"
              description="Managing tenants requires platform-superadmin access. Contact Jatin if you need this."
            />
          ) : loading ? (
            <div className="text-sm text-slate-500">Loading tenants…</div>
          ) : error ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 w-8" />
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Slug</th>
                    <th className="px-4 py-2.5">Plan</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Owner</th>
                    <th className="px-4 py-2.5">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <React.Fragment key={t.id}>
                      <tr
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                        onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                      >
                        <td className="px-4 py-2.5 text-slate-400">
                          {expandedId === t.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{t.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{t.slug}</td>
                        <td className="px-4 py-2.5 text-slate-600">{t.plan}</td>
                        <td className="px-4 py-2.5"><StatusBadge isActive={t.isActive} /></td>
                        <td className="px-4 py-2.5 text-slate-600">{t.owner ? t.owner.name : <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-2.5 text-slate-600">{t.userCount}</td>
                      </tr>
                      {expandedId === t.id && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <TenantDetailPanel tenant={t} onChanged={load} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {tenants.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No tenants yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
