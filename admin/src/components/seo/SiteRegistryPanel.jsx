import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Archive, X, RefreshCw, AlertTriangle, Globe, XCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { useToast } from '../wizmatch/Toast.jsx';

// The SEO feature is becoming a per-tenant add-on that reseller agencies run
// for their own clients — this panel is where a tenant registers/manages the
// sites it operates SEO automation for, backed by /api/seo-sites (contract
// owned elsewhere: GET list/one, POST create, PATCH update, DELETE archive —
// archive, never a hard delete).
//
// No optimistic updates, matching the house convention in
// TodayDecisionWorkbench.jsx / WizmatchDuplicateReviewPage.jsx: every mutation
// POSTs/PATCHes/DELETEs first, then refetches in a `finally` so the list on
// screen is always what the server actually has — never a client-side guess.

const PLATFORM_OPTIONS = [
  { value: 'git', label: 'Git' },
  { value: 'wordpress', label: 'WordPress' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'unknown', label: 'Unknown' },
];

const RISK_PROFILE_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
];

function platformLabel(p) {
  return PLATFORM_OPTIONS.find((o) => o.value === p)?.label ?? (p || 'Unknown');
}

function riskBadgeClass(risk) {
  if (risk === 'high') return 'bg-red-100 text-red-700';
  if (risk === 'low') return 'bg-slate-100 text-slate-600';
  return 'bg-blue-100 text-blue-700'; // standard
}

function statusBadgeClass(status) {
  if (status === 'active') return 'bg-green-100 text-green-700';
  if (status === 'paused') return 'bg-amber-100 text-amber-700';
  if (status === 'archived') return 'bg-slate-100 text-slate-500';
  return 'bg-slate-100 text-slate-500';
}

function emptyForm() {
  return { label: '', domain: '', platform: 'unknown', gscProperty: '', ga4PropertyId: '', riskProfile: 'standard', autoPublishAllowed: false };
}

// `autoPublishAllowed` is the switch that lets the system edit/publish to a
// LIVE client site without a human approving each change. It gets its own
// pill-switch control (not a checkbox) inside a bordered, explicitly-labelled
// callout — never a bare input lost among the other fields, and never part of
// a bulk action (this panel has none).
function AutoPublishToggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Allow automatic publishing"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 ${
        checked ? 'bg-red-500 focus:ring-red-400' : 'bg-slate-300 focus:ring-slate-400'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function SiteRegistryPanel({ onSitesChanged }) {
  const { showSuccess, showError } = useToast();

  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingSite, setEditingSite] = useState(null); // null = create mode
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const [archiveConfirmId, setArchiveConfirmId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/seo-sites');
      // Defensive against either envelope shape ({ sites: [...] } vs a bare
      // array) since this route's exact response shape is being built
      // concurrently elsewhere in this change.
      setSites(Array.isArray(data?.sites) ? data.sites : Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Failed to load sites.');
      setSites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAddForm() {
    setEditingSite(null);
    setForm(emptyForm());
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(site) {
    setEditingSite(site);
    setForm({
      label: site.label || '',
      domain: site.domain || '',
      platform: site.platform || 'unknown',
      gscProperty: site.gscProperty || '',
      ga4PropertyId: site.ga4PropertyId || '',
      riskProfile: site.riskProfile || 'standard',
      autoPublishAllowed: !!site.autoPublishAllowed,
    });
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingSite(null);
    setForm(emptyForm());
    setFormError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.label.trim() || (!editingSite && !form.domain.trim())) return;
    setSubmitting(true);
    setFormError(null);
    const isEdit = !!editingSite;
    try {
      // Domain is immutable after creation — never sent on PATCH, and the
      // field itself is disabled below so there is no path to typing a new
      // value in edit mode in the first place.
      const body = isEdit
        ? {
            label: form.label.trim(),
            platform: form.platform,
            gscProperty: form.gscProperty.trim() || null,
            ga4PropertyId: form.ga4PropertyId.trim() || null,
            riskProfile: form.riskProfile,
            autoPublishAllowed: !!form.autoPublishAllowed,
          }
        : {
            label: form.label.trim(),
            domain: form.domain.trim(),
            platform: form.platform,
            gscProperty: form.gscProperty.trim() || undefined,
            ga4PropertyId: form.ga4PropertyId.trim() || undefined,
            riskProfile: form.riskProfile,
          };
      await apiFetch(isEdit ? `/api/seo-sites/${editingSite.id}` : '/api/seo-sites', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      showSuccess(isEdit ? `${form.label || form.domain} updated.` : `${form.label || form.domain} registered.`);
      closeForm();
      onSitesChanged?.();
    } catch (err) {
      if (err.status === 402) {
        setFormError("You've reached your plan's site limit. Archive an existing site, or ask an admin to raise the limit, before registering another.");
      } else {
        setFormError(err.message || `Failed to ${isEdit ? 'update' : 'create'} site.`);
      }
    } finally {
      setSubmitting(false);
      await load();
    }
  }

  async function handleArchive(site) {
    setArchivingId(site.id);
    try {
      await apiFetch(`/api/seo-sites/${site.id}`, { method: 'DELETE' });
      showSuccess(`${site.label || site.domain} archived.`);
      onSitesChanged?.();
    } catch (err) {
      showError(err.message || 'Failed to archive site.');
    } finally {
      setArchivingId(null);
      setArchiveConfirmId(null);
      await load();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-700">Registered Sites</h2>
          <p className="text-xs text-slate-400 mt-0.5">Sites this tenant runs SEO automation for. Auto-publish is off by default for every new site.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-xs text-sky-600 hover:underline flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button
            onClick={openAddForm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Site
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-700">
              {editingSite ? `Edit ${editingSite.label || editingSite.domain}` : 'Register a new site'}
            </h3>
            <button onClick={closeForm} className="text-slate-400 hover:text-slate-600" aria-label="Close form">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Label</label>
                <input
                  type="text" value={form.label} required
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Domain{editingSite ? ' (cannot be changed)' : ''}</label>
                <input
                  type="text" value={form.domain} required disabled={!!editingSite}
                  placeholder="example.com"
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Platform</label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {PLATFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Risk profile</label>
                <select
                  value={form.riskProfile}
                  onChange={(e) => setForm((f) => ({ ...f, riskProfile: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {RISK_PROFILE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Search Console property</label>
                <input
                  type="text" value={form.gscProperty} placeholder="sc-domain:example.com"
                  onChange={(e) => setForm((f) => ({ ...f, gscProperty: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">GA4 property ID</label>
                <input
                  type="text" value={form.ga4PropertyId} placeholder="properties/123456789"
                  onChange={(e) => setForm((f) => ({ ...f, ga4PropertyId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Auto-publish only appears once a site exists to edit — a brand
                new site has never been observed yet, so there is nothing to
                graduate to autonomous publishing. */}
            {editingSite && (
              <div className={`rounded-lg border p-3 flex items-start gap-3 ${form.autoPublishAllowed ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${form.autoPublishAllowed ? 'text-red-500' : 'text-slate-400'}`} />
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-800">Allow automatic publishing</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    When on, the system may publish changes to this LIVE site without a human approving each one.
                    Defaults off — only turn this on once the client has explicitly signed off on autonomous publishing.
                  </p>
                </div>
                <AutoPublishToggle
                  checked={!!form.autoPublishAllowed}
                  onChange={(v) => setForm((f) => ({ ...f, autoPublishAllowed: v }))}
                />
              </div>
            )}

            {formError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
                <XCircle className="w-4 h-4 flex-shrink-0" /> {formError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit" disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? (editingSite ? 'Saving...' : 'Registering...') : editingSite ? 'Save changes' : 'Register site'}
              </button>
              <button
                type="button" onClick={closeForm} disabled={submitting}
                className="px-4 py-2 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading sites...
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          <button onClick={load} className="ml-auto text-xs font-semibold underline flex-shrink-0">Retry</button>
        </div>
      ) : sites.length === 0 ? (
        <div className="py-16 text-center">
          <Globe className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-medium">No sites registered yet</p>
          <p className="text-slate-400 text-xs mt-1">Register a site to start tracking its SEO automation.</p>
          {!showForm && (
            <button
              onClick={openAddForm}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Register your first site
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Site</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Platform</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Risk</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                  <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Auto-publish</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sites.map((site) => (
                  <tr key={site.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{site.label || site.domain}</p>
                      <p className="text-xs text-slate-400">{site.domain}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 text-xs">{platformLabel(site.platform)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${riskBadgeClass(site.riskProfile)}`}>
                        {site.riskProfile || 'standard'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClass(site.status)}`}>{site.status || 'active'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${site.autoPublishAllowed ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                        {site.autoPublishAllowed ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {archiveConfirmId === site.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-600">Archive this site?</span>
                          <button onClick={() => setArchiveConfirmId(null)} className="text-xs text-slate-500 hover:underline">Cancel</button>
                          <button
                            onClick={() => handleArchive(site)} disabled={archivingId === site.id}
                            className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                          >
                            {archivingId === site.id ? 'Archiving...' : 'Confirm'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => openEditForm(site)} className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline">
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                          {site.status !== 'archived' && (
                            <button
                              onClick={() => setArchiveConfirmId(site.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 hover:underline"
                            >
                              <Archive className="w-3 h-3" /> Archive
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
