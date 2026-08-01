import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, X, Trash2, ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { getAuthUser } from '../lib/auth.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import DataTable from '../components/ui/DataTable.jsx';
import BulkActionBar from '../components/ui/BulkActionBar.jsx';
import { useRowSelection } from '../components/ui/useRowSelection.js';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';

const PAGE_SIZE = 50;
// GET /signals clamps limit to 200 (src/routes/wizmatch.ts), matching the
// EXPORT_LIMIT constants on Candidates and Requirements.
const SIGNAL_EXPORT_LIMIT = 200;
// Shared bulk-endpoint contract: `ids` is capped at 200 per request.
const BULK_CHUNK = 200;

const STATUS_BADGE = {
  new: 'badge-info',
  scored: 'badge-info',
  enriched: 'badge-info',
  matched: 'badge-success',
  drafted: 'badge-warning',
  sent: 'badge-accent',
  replied_positive: 'badge-success',
  replied_other: 'badge-muted',
  dead: 'badge-muted',
  placed: 'badge-success',
};

// All four branches use the 700 shade on a 500/10 tint. The >= 8 branch used
// text-success-600, which measures ~3.3:1 against that tint — the badge is
// 14px bold, i.e. normal-size text under WCAG, so it needs 4.5:1 and failed.
// The 7 and 5 branches had already been moved to 700 for exactly this reason
// (see the danger-700 note in tailwind.config.js); this one was missed.
const scoreColor = (score) => {
  if (score >= 8) return 'bg-success-500/10 text-success-700 border-success-500/20';
  if (score >= 7) return 'bg-warning-500/10 text-warning-700 border-warning-500/20';
  if (score >= 5) return 'bg-primary-500/10 text-primary-700 border-primary-500/20';
  return 'bg-neutral-200 text-neutral-500 border-neutral-300';
};

const sigOpts = (arr) => arr.map((v) => ({ value: v, label: v }));
const SIGNAL_DEFAULTS = { region: 'india' };
const SIGNAL_FILTERS = [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Title or company…' },
  { key: 'status', label: 'Status', type: 'multiselect', options: sigOpts(['new', 'scored', 'enriched', 'matched', 'drafted', 'sent', 'replied_positive', 'replied_other', 'dead', 'placed']) },
  { key: 'source', label: 'Source', type: 'multiselect', options: sigOpts(['theirstack', 'greenhouse', 'lever', 'ashby', 'dice', 'manual', 'jobspy', 'ats', 'xray']) },
  { key: 'employment_type', label: 'Employment', type: 'multiselect', options: sigOpts(['contract', 'contract_c2c', 'contract_w2', 'C2C', 'W2', '1099', 'FTE', 'permanent', 'unknown']) },
  { key: 'score', label: 'Score', type: 'numberRange', serverMinKey: 'min_score', serverMaxKey: 'score_max' },
  { key: 'days_open', label: 'Days open', type: 'numberRange', serverMinKey: 'days_open_min', serverMaxKey: 'days_open_max' },
  { key: 'has_contact', label: 'Has decision-maker', type: 'toggle' },
  { key: 'posted', label: 'Posted', type: 'dateRange', serverFromKey: 'posted_from', serverToKey: 'posted_to' },
  { key: 'region', label: 'Region', type: 'select', options: [{ value: 'india', label: 'India only' }, { value: 'all', label: 'All regions' }, { value: 'us', label: 'US only' }] },
];
const SIGNAL_COLUMNS = [
  { key: 'job_title', label: 'Job Title', sortable: true, exportValue: (s) => s.job_title, render: (s) => <span className="font-medium text-neutral-900">{s.job_title}</span> },
  { key: 'company_name', label: 'Company', sortable: true, render: (s) => s.company_name || '—' },
  { key: 'days_open', label: 'Days Open', sortable: true, exportValue: (s) => s.days_open || 0, render: (s) => <span className={s.days_open >= 30 ? 'text-danger-600 font-bold' : 'text-neutral-600'}>{s.days_open || 0}d</span> },
  { key: 'score', label: 'Score', sortable: true, exportValue: (s) => s.score || 0, render: (s) => <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-sm font-bold border ${scoreColor(s.score || 0)}`}>{s.score || 0}</span> },
  { key: 'source', label: 'Source', sortable: true, render: (s) => <span className="text-neutral-500">{s.source}</span> },
  { key: 'status', label: 'Status', sortable: true, render: (s) => <span className={STATUS_BADGE[s.status] || 'badge-muted'}>{s.status?.replace(/_/g, ' ')}</span> },
];

const POC_ROLE_OPTIONS = [
  { value: 'talent_acquisition', label: 'Talent Acquisition' },
  { value: 'hr_people', label: 'HR / People' },
  { value: 'hiring_delivery_manager', label: 'Hiring / Delivery Mgr' },
  { value: 'vendor_procurement', label: 'Vendor / Procurement' },
];
const ALL_POC_ROLES = POC_ROLE_OPTIONS.map((o) => o.value);

// Cost-safe "Find POC": a read-only preview (exact query + remaining SearchAPI
// allowance + est. cost, calls nothing) with role targeting, before spending a
// free search. Reuses the /discover-poc/preview + /discover-poc endpoints.
function PocSearchPreview({ signal, enabled, onRan }) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState(ALL_POC_ROLES);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const loadPreview = async (nextRoles) => {
    setBusy('preview'); setError('');
    try {
      setPreview(await apiFetch(`/api/wizmatch/signals/${signal.id}/discover-poc/preview`, { method: 'POST', body: JSON.stringify({ roles: nextRoles }) }));
    } catch (e) { setError(e.message || 'Preview failed'); }
    finally { setBusy(''); }
  };

  const openPreview = () => { setOpen(true); setPreview(null); loadPreview(roles); };

  const toggleRole = (value) => {
    const next = roles.includes(value) ? roles.filter((r) => r !== value) : [...roles, value];
    const applied = next.length ? next : ALL_POC_ROLES; // never empty → all roles
    setRoles(applied);
    loadPreview(applied);
  };

  const runFree = async () => {
    setBusy('run'); setError('');
    try {
      await apiFetch(`/api/wizmatch/signals/${signal.id}/discover-poc`, { method: 'POST', body: JSON.stringify({ roles }) });
      setOpen(false);
      onRan?.();
    } catch (e) { setError(e.message || 'Search failed'); }
    finally { setBusy(''); }
  };

  if (!open) {
    return (
      <button type="button" disabled={!enabled} title={enabled ? '' : 'POC discovery is disabled in this environment (WIZMATCH_POC_DISCOVERY_ENABLED)'}
        onClick={openPreview} className="btn-standard disabled:opacity-50">Find POC ▸ preview</button>
    );
  }
  const needsCredit = preview && preview.estimatedSearchApiCredits > 0;
  const noCreditsLeft = needsCredit && (preview.searchApiUsage?.dailyRemaining ?? 1) <= 0;
  return (
    <div className="w-full card p-3 border-primary-200 bg-primary-50/30 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-neutral-800">Find POC — preview (no credits spent until you run)</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {POC_ROLE_OPTIONS.map((o) => (
          <button key={o.value} type="button" onClick={() => toggleRole(o.value)}
            className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${roles.includes(o.value) ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {error && <div role="alert" className="text-[12px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{error}</div>}
      {busy === 'preview' && !preview ? (
        <p className="text-[12px] text-neutral-500">Building preview…</p>
      ) : preview && (
        <div className="space-y-2 text-[12px]">
          <div>
            <div className="text-[11px] uppercase font-semibold text-neutral-500">Search query</div>
            <code className="block text-[11.5px] text-neutral-700 bg-white border border-neutral-200 rounded px-2 py-1.5 break-words">{preview.query}</code>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="badge-muted text-[11px]">SearchAPI today {preview.searchApiUsage?.daily ?? 0}/{preview.searchApiUsage?.dailyLimit ?? 5}</span>
            <span className="badge-muted text-[11px]">month {preview.searchApiUsage?.monthly ?? 0}/{preview.searchApiUsage?.monthlyLimit ?? 80}</span>
            <span className={needsCredit ? 'badge-warning text-[11px]' : 'badge-success text-[11px]'}>
              Est. cost: {needsCredit ? '1 free search' : '0 — reuses free sources'}
            </span>
            {preview.internalContactsExist && <span className="badge-success text-[11px]">Reuses linked contacts</span>}
            {preview.inCooldown && <span className="badge-muted text-[11px]">In 30-day cooldown</span>}
          </div>
          {(preview.notes || []).map((n, i) => <p key={i} className="text-[11.5px] text-neutral-500">{n}</p>)}
          {!enabled && <p className="text-[11.5px] text-warning-700">POC discovery is disabled here (WIZMATCH_POC_DISCOVERY_ENABLED). The preview is read-only; running requires it enabled.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-standard btn-compact">Cancel</button>
            <button type="button" disabled={busy === 'run' || !enabled || noCreditsLeft} onClick={runFree} className="btn-primary btn-compact disabled:opacity-50">
              {busy === 'run' ? 'Searching…' : noCreditsLeft ? 'Daily allowance used' : 'Run free search'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WizmatchSignalsPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [signals, setSignals] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const ctl = useTableControls({ pageId: 'wizmatch-signals', spec: SIGNAL_FILTERS, columns: SIGNAL_COLUMNS, defaults: SIGNAL_DEFAULTS });
  const { toQueryParams, page, setPage } = ctl;
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sourcing, setSourcing] = useState(null);
  const [sourcingError, setSourcingError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [promotedRequirementId, setPromotedRequirementId] = useState(null);
  const [actionBusy, setActionBusy] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkReject, setConfirmBulkReject] = useState(false);
  const [bulkRejectError, setBulkRejectError] = useState(null);

  // Server page: the backend applies the global ORDER BY (sort=<col>:<dir>), so
  // render rows in server order. rowAriaLabel is what DataTable announces on
  // the row checkbox — without it every row reads out as a raw UUID.
  const rows = signals.map((s) => ({
    ...s,
    rowAriaLabel: `${s.job_title}${s.company_name ? ` at ${s.company_name}` : ''}`,
  }));
  const sel = useRowSelection(rows, 'id');
  const clearSelection = sel.clear;

  // The Toast context value is a fresh object on every provider render, so it
  // must not appear in loadSignals()'s dependency list — otherwise showing a
  // toast re-creates the callback and the effect below refetches the list.
  const toastRef = useRef({ showSuccess, showError });
  toastRef.current = { showSuccess, showError };

  const loadedOnce = useRef(false);

  const loadSignals = useCallback(async () => {
    // First load -> skeletons. Every later refetch (filter change, 30s poll,
    // post-action reload) -> `refreshing`, so the rows stay on screen instead
    // of the whole table blanking every 30 seconds.
    if (loadedOnce.current) setRefreshing(true); else setLoading(true);
    setError(null);
    // Mandatory: selection must not survive a reload, or a bulk action fires
    // against rows the user can no longer see.
    clearSelection();
    try {
      const params = toQueryParams({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      const data = await apiFetch(`/api/wizmatch/signals?${params}`);
      setSignals(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      const msg = e.message || 'Failed to load job leads';
      // A failed load used to be swallowed by console.error, so a 500 looked
      // identical to "no signals match these filters".
      if (loadedOnce.current) toastRef.current.showError(msg);
      else setError(msg);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [toQueryParams, page, clearSelection]);

  useEffect(() => { loadSignals(); }, [loadSignals]);
  const loadSourcing = useCallback(async () => {
    setSourcingError('');
    try { setSourcing(await apiFetch('/api/wizmatch/sourcing/status')); }
    // Not a toast: with no status the provider cards below silently render as
    // "off / No run recorded", which is indistinguishable from real state.
    catch (e) { setSourcingError(e.message || 'Sourcing status could not be loaded — the provider cards below are not live.'); }
  }, []);
  useEffect(() => { loadSourcing(); }, [loadSourcing]);

  async function runAction(label, path, body) {
    setActionBusy(label); setFeedback(''); setPromotedRequirementId(null);
    try {
      const result = await apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setFeedback(`${label} completed.`); await loadSignals(); await loadSourcing();
      if (selectedSignal) await openDetail(selectedSignal);
      return result;
    } catch (e) { toastRef.current.showError(e.message || `${label} failed.`); }
    finally { setActionBusy(''); }
  }

  // Poll for new signals every 30s — but not while rows are selected. The poll
  // goes through loadSignals(), which clears the selection by design, so an
  // unconditional poll would wipe a half-built selection mid-review.
  const selectionCountRef = useRef(0);
  selectionCountRef.current = sel.count;
  useEffect(() => {
    const interval = setInterval(() => { if (selectionCountRef.current === 0) loadSignals(); }, 30000);
    return () => clearInterval(interval);
  }, [loadSignals]);

  const openDetail = async (signal) => {
    setSelectedSignal(signal);
    setDetailLoading(true);
    try {
      const detail = await apiFetch(`/api/wizmatch/signals/${signal.id}`);
      setSelectedSignal(detail);
    } catch (e) {
      // The drawer keeps the list row's fields; say the detail failed rather
      // than leaving a half-populated drawer that looks complete.
      toastRef.current.showError(e.message || 'Failed to load this job lead');
    } finally {
      setDetailLoading(false);
    }
  };

  // POST /signals/bulk-action gates on role by SELECTION SIZE, not by action:
  // more than one id is admin-only, a single id keeps the team_lead+ tier the
  // per-signal routes carry (src/routes/wizmatch.ts allowBulkRole). Mirror that
  // exactly so the bar explains the block instead of 403-ing on click.
  const role = getAuthUser()?.role;
  const bulkRoleReason = role === 'admin'
    ? undefined
    : sel.count > 1
      ? 'Admin only — acting on more than one lead at a time requires the admin role'
      : role === 'team_lead'
        ? undefined
        : 'Requires team_lead or admin';

  // Bulk qualify / reject. POST /api/wizmatch/signals/bulk-action returns
  // { results: [{ id, ok, error? }], succeeded, failed } — partial success is
  // reported as partial, never as a blanket success.
  const runBulkAction = async (action, reason) => {
    const ids = sel.selectedVisible;
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkRejectError(null);
    let succeeded = 0;
    let failed = 0;
    let firstError = null;
    try {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const result = await apiFetch('/api/wizmatch/signals/bulk-action', {
          method: 'POST',
          body: JSON.stringify({ ids: ids.slice(i, i + BULK_CHUNK), action, reason: reason || undefined }),
        });
        succeeded += result?.succeeded || 0;
        failed += result?.failed || 0;
        if (!firstError) firstError = (result?.results || []).find((r) => !r.ok)?.error || null;
      }
      setConfirmBulkReject(false);
      const verb = action === 'qualify' ? 'Qualified' : 'Rejected';
      const noun = succeeded === 1 ? 'job lead' : 'job leads';
      if (failed === 0) toastRef.current.showSuccess(`${verb} ${succeeded} ${noun}`);
      else toastRef.current.showError(`${succeeded} succeeded, ${failed} failed — ${firstError || 'open a lead to see why'}`);
      await loadSignals();
    } catch (e) {
      const base = e.status === 404
        ? 'Bulk actions are not available on this API build yet.'
        : (e.message || `Bulk ${action} failed.`);
      const msg = succeeded > 0 ? `${base} (${succeeded} leads were already ${action === 'qualify' ? 'qualified' : 'rejected'} before this failure.)` : base;
      if (action === 'reject') setBulkRejectError(msg);
      else toastRef.current.showError(msg);
    } finally {
      setBulkBusy(false);
    }
  };

  // Permanent delete via DELETE /signals/:id. The backend returns 409 with a
  // human message for signals that were promoted into a requirement or are
  // placed — surface it in the dialog and let the user Reject instead.
  const deleteSignal = async (reason) => {
    if (!selectedSignal) return;
    setDeleteBusy(true); setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/signals/${selectedSignal.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      setFeedback('Signal deleted.');
      setShowDeleteDialog(false);
      setSelectedSignal(null);
      await loadSignals();
    } catch (e) {
      setDeleteError(e.message || 'Delete failed.');
    } finally {
      setDeleteBusy(false);
    }
  };

  // Export the full filtered set (not just this page) — re-fetch current
  // filters/sort at the backend max limit; visible columns only.
  const exportCsv = async () => {
    try {
      // Ask for what the server will actually give: GET /signals clamps limit to
      // 200 (src/routes/wizmatch.ts), so `limit: 1000` was never honoured and the
      // truncation toast below reasoned about a number that could not occur.
      // Candidates and Requirements already ask for their real cap; this did not.
      const data = await apiFetch(`/api/wizmatch/signals?${toQueryParams({ limit: SIGNAL_EXPORT_LIMIT })}`);
      const items = data.items || [];
      exportRowsToCsv(items, ctl.visibleColumns, 'job-signals.csv');
      // The backend clamps `limit` to 200 (routes/wizmatch.ts), so a filtered
      // set larger than that exports short. Say so instead of handing over a
      // silently truncated CSV.
      if ((data.total || 0) > items.length) {
        toastRef.current.showError(`Exported the first ${items.length} of ${data.total} job leads — narrow the filters to export the rest.`);
      }
    } catch (e) { toastRef.current.showError(e.message || 'Export failed'); }
  };

  // Server-paginated: `total` is a full COUNT(*) over the same WHERE clause, so
  // this range is exact rather than a count of what happens to be loaded.
  const firstIndex = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIndex = page * PAGE_SIZE + rows.length;

  return (
    <div className="p-6">
      <div className="mb-6">
        {/* "Job Leads", not "Job Signals": the canonical route is id `job-leads`
            at /wizmatch/job-leads and /wizmatch/signals is only a legacyAlias —
            the product migrated signals -> job leads and this heading was the
            last place still using the old word. Nav, breadcrumb, bulk bar and
            toasts all say "job lead(s)". */}
        <h1 className="text-[20px] font-bold text-neutral-900">Job Leads</h1>
        <p className="text-[12.5px] text-neutral-500 mt-1">
          {total} total signals · {sel.count > 0 ? 'auto-refresh paused while rows are selected' : 'auto-refreshes every 30s'}
        </p>
      </div>

      {sourcingError && (
        <div role="alert" className="mb-4 rounded-md border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[12.5px] text-danger-600 flex items-center justify-between gap-3">
          <span>{sourcingError}</span>
          <button onClick={loadSourcing} className="btn-standard btn-compact shrink-0">Retry</button>
        </div>
      )}

      {feedback && (
        <div role="status" className="mb-4 rounded-md border border-info-200 bg-info-50 p-3 text-sm text-info-800 flex items-center justify-between gap-3">
          <span>{feedback}</span>
          {promotedRequirementId && (
            <button
              onClick={() => navigate(`/wizmatch/requirements?id=${promotedRequirementId}`)}
              className="btn-primary btn-compact shrink-0 inline-flex items-center gap-1"
            >Open requirement <ArrowRight className="w-3.5 h-3.5" /></button>
          )}
        </div>
      )}
      <div className="mb-3 rounded-md border border-info-200 bg-info-50 px-3 py-2 text-[12px] text-info-800 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">Search credits</span>
        <span>SearchAPI: {sourcing?.searchApiUsage?.dailyRemaining ?? 5}/{sourcing?.searchApiUsage?.dailyLimit ?? 5} free searches left today · {sourcing?.searchApiUsage?.monthlyRemaining ?? 80}/{sourcing?.searchApiUsage?.monthlyLimit ?? 80} this month</span>
        {sourcing?.providerAccounts?.searchapi?.remaining != null && <span>· {sourcing.providerAccounts.searchapi.remaining} account credits left</span>}
        <span className="text-info-700">· Previews (TheirStack “Free preview”, “Find POC ▸ preview”) cost nothing; paid providers stay off.</span>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {['theirstack','ats','xray'].map(provider => {
          const cfg = sourcing?.config || {}; const latest = (sourcing?.latestRuns || []).find(run => run.provider===provider);
          const enabled = provider==='theirstack' ? cfg.theirstackEnabled : provider==='ats' ? cfg.atsEnabled : cfg.xrayEnabled;
          const account = provider==='theirstack' ? sourcing?.providerAccounts?.theirstack : provider==='xray' ? sourcing?.providerAccounts?.searchapi : null;
          return <div className="card p-3" key={provider}><div className="flex justify-between"><span className="font-semibold">{provider==='xray'?'LinkedIn X-Ray':provider==='theirstack'?'TheirStack':'ATS polling'}</span><span className={enabled?'badge-success':'badge-muted'}>{enabled?'active':account?.configured?'configured, off':'off'}</span></div><div className="mt-1 text-xs text-neutral-500">{latest ? `${latest.status} · ${latest.inserted_count || 0} new · ${latest.duplicate_count || 0} duplicate` : 'No run recorded'}</div>{provider==='xray' && <div className="mt-1 text-xs text-neutral-500">SearchAPI shared allowance: {sourcing?.searchApiUsage?.daily || 0}/{sourcing?.searchApiUsage?.dailyLimit || 5} today · {sourcing?.searchApiUsage?.monthly || 0}/{sourcing?.searchApiUsage?.monthlyLimit || 80} this month. Requirement-first only.</div>}<div className="flex gap-2">{provider==='theirstack' && <button disabled={!account?.configured||actionBusy} className="btn-standard btn-compact mt-2" onClick={()=>runAction('Preview TheirStack','/api/wizmatch/sourcing/theirstack/preview')}>Free preview</button>}{provider!=='xray' && <button disabled={!enabled||actionBusy} className="btn-standard btn-compact mt-2" onClick={()=>runAction(`Run ${provider}`,`/api/wizmatch/sourcing/${provider}/run`)}>Run now</button>}</div></div>;
        })}
      </div>

      <FilterBar
        spec={SIGNAL_FILTERS}
        filters={ctl.filters}
        setFilter={ctl.setFilter}
        activeChips={ctl.activeChips}
        clearFilter={ctl.clearFilter}
        clearAll={ctl.clearAll}
        columns={SIGNAL_COLUMNS}
        hiddenColumns={ctl.hiddenColumns}
        toggleColumn={ctl.toggleColumn}
        onExport={exportCsv}
        presets={ctl.presets}
        savePreset={ctl.savePreset}
            setPresetShared={ctl.setPresetShared}
            presetsError={ctl.presetsError}
        applyPreset={ctl.applyPreset}
        deletePreset={ctl.deletePreset}
        rightSlot={<button onClick={loadSignals} className="btn-standard btn-compact"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>}
      />

      {error ? (
        <ErrorRetry message={error} onRetry={loadSignals} retrying={loading} />
      ) : (
        <>
          <DataTable
            columns={ctl.visibleColumns}
            rows={rows}
            rowKey="id"
            onRowClick={openDetail}
            loading={loading}
            refreshing={refreshing}
            emptyText="No signals match these filters"
            sort={ctl.sort}
            onSort={ctl.setSort}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onToggleAll={sel.toggleAll}
          />
          <BulkActionBar
            count={sel.count}
            entityLabel="job lead"
            entityLabelPlural="job leads"
            busy={bulkBusy}
            actions={[
              { key: 'qualify', label: 'Qualify', disabled: Boolean(bulkRoleReason), reason: bulkRoleReason },
              { key: 'reject', label: 'Reject', danger: true, disabled: Boolean(bulkRoleReason), reason: bulkRoleReason },
            ]}
            onAction={(key) => {
              if (key === 'reject') { setBulkRejectError(null); setConfirmBulkReject(true); }
              else runBulkAction('qualify');
            }}
            onClear={sel.clear}
          />

          {rows.length > 0 && (
            <div className="mt-4 flex justify-between items-center gap-3">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="btn-standard btn-compact disabled:opacity-50">Previous</button>
              <span className="text-sm text-neutral-500">
                Showing {firstIndex}–{lastIndex} of {total} job leads
                {total > PAGE_SIZE ? ` · page ${page + 1} of ${Math.ceil(total / PAGE_SIZE)}` : ''}
              </span>
              <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)} className="btn-standard btn-compact disabled:opacity-50">Next</button>
            </div>
          )}
        </>
      )}

      {/* Detail Drawer */}
      {selectedSignal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={() => setSelectedSignal(null)}>
          <div className="bg-white w-[480px] max-w-[90vw] h-full overflow-y-auto shadow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-start">
              <div>
                <h2 className="text-[18px] font-bold text-neutral-900">{selectedSignal.job_title}</h2>
                <p className="text-[12.5px] text-neutral-500">{selectedSignal.company_name || 'Unknown'} · {selectedSignal.location || '—'}</p>
              </div>
              <button onClick={() => setSelectedSignal(null)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {detailLoading ? (
                <p className="text-neutral-400">Loading details...</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-neutral-50 rounded-lg p-3">
                      <div className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Score</div>
                      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-md text-lg font-bold border mt-1 ${scoreColor(selectedSignal.score || 0)}`}>
                        {selectedSignal.score || 0}
                      </div>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-3">
                      <div className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Days Open</div>
                      <div className="text-2xl font-bold text-neutral-900 mt-1">{selectedSignal.days_open || 0}</div>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-3">
                      <div className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Status</div>
                      <div className={STATUS_BADGE[selectedSignal.status] || 'badge-muted'}>
                        {selectedSignal.status?.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>

                  {/* Score Breakdown */}
                  {selectedSignal.score_breakdown && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Score Breakdown</h3>
                      <pre className="bg-neutral-50 p-3 rounded-lg text-xs overflow-x-auto font-mono">
                        {JSON.stringify(selectedSignal.score_breakdown, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Decision Maker */}
                  {selectedSignal.contact_first_name && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Decision Maker</h3>
                      <p className="text-sm text-neutral-600">{selectedSignal.contact_first_name} {selectedSignal.contact_last_name || ''}</p>
                    </div>
                  )}

                  {/* Keywords */}
                  {selectedSignal.keywords?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Keywords</h3>
                      <div className="flex flex-wrap gap-1">
                        {selectedSignal.keywords.map((k, i) => (
                          <span key={i} className="badge-info text-[11px]">{k}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Matched Candidates */}
                  {selectedSignal.matched_candidates?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Matched Candidates ({selectedSignal.matched_candidates.length})</h3>
                      {selectedSignal.matched_candidates.map((c, i) => (
                        <div key={i} className="card p-3 mb-2">
                          <div className="font-medium text-sm text-neutral-900">{c.first_name} {c.last_name}</div>
                          <div className="text-xs text-neutral-500">{c.skills?.join(', ')}</div>
                          <div className="text-xs text-neutral-500">{c.visa_status} · {c.rate_currency === 'INR' ? '₹' : '$'}{c.rate_hourly}/hr · {c.availability_status}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drafts */}
                  {selectedSignal.drafts?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-[15px] font-semibold text-neutral-700 mb-2">Email Drafts ({selectedSignal.drafts.length})</h3>
                      {selectedSignal.drafts.map((d, i) => (
                        <div key={i} className="card p-3 mb-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-sm text-neutral-900">{d.metadata?.subject || '(no subject)'}</span>
                            <span className="text-xs text-neutral-400">{d.metadata?.variant}</span>
                          </div>
                          <pre className="text-xs text-neutral-600 whitespace-pre-wrap font-mono">{d.content?.slice(0, 200)}...</pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <button disabled={actionBusy} onClick={()=>runAction('Qualify signal',`/api/wizmatch/signals/${selectedSignal.id}/qualify`)} className="btn-primary">Qualify + POC task</button>
                    <PocSearchPreview signal={selectedSignal} enabled={!!sourcing?.config?.pocDiscoveryEnabled} onRan={() => { setFeedback('Find POC completed.'); loadSignals(); loadSourcing(); openDetail(selectedSignal); }} />
                    <button disabled={actionBusy} onClick={async ()=>{ const r = await runAction('Create requirement draft',`/api/wizmatch/signals/${selectedSignal.id}/promote-to-requirement`); if (r?.requirement?.id) setPromotedRequirementId(r.requirement.id); }} className="btn-standard">Create requirement draft</button>
                    <button disabled={actionBusy} onClick={()=>runAction('Reject signal',`/api/wizmatch/signals/${selectedSignal.id}/reject`,{reason:'Not a workable staffing requirement'})} className="btn-standard text-danger-700">Reject</button>
                    <button
                      disabled={!!actionBusy}
                      onClick={async () => {
                        setActionBusy('Generate drafts');
                        try {
                          await apiFetch(`/api/wizmatch/signals/${selectedSignal.id}/draft`, { method: 'POST' });
                          // Reload rather than telling the user to refresh:
                          // openDetail repopulates the drawer's Drafts section
                          // and the list row's status moves to `drafted`.
                          await openDetail(selectedSignal);
                          await loadSignals();
                          toastRef.current.showSuccess('Drafts generated');
                        } catch (e) {
                          toastRef.current.showError(e.message || 'Failed to generate drafts');
                        } finally {
                          setActionBusy('');
                        }
                      }}
                      className="btn-primary"
                    >Generate Drafts</button>
                    <button
                      disabled={actionBusy || deleteBusy}
                      onClick={() => { setDeleteError(null); setShowDeleteDialog(true); }}
                      className="btn-standard text-danger-700 inline-flex items-center gap-1"
                    ><Trash2 className="w-3.5 h-3.5" /> Delete permanently</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete this signal?"
        impactSummary={selectedSignal ? `This permanently deletes the job signal "${selectedSignal.job_title}"${selectedSignal.company_name ? ` at ${selectedSignal.company_name}` : ''}. Signals promoted into a requirement or already placed can't be deleted — Reject them instead.` : ''}
        confirmLabel="Delete permanently"
        danger
        requireReason
        loading={deleteBusy}
        error={deleteError}
        onConfirm={deleteSignal}
        onCancel={() => { setShowDeleteDialog(false); setDeleteError(null); }}
      />

      <ConfirmDialog
        open={confirmBulkReject}
        title={`Reject ${sel.count} ${sel.count === 1 ? 'job lead' : 'job leads'}?`}
        impactSummary="They leave the active queue and stop being matched or drafted against. Nothing is deleted — each one can be re-opened individually from its detail drawer."
        confirmLabel={`Reject ${sel.count}`}
        danger
        requireReason
        loading={bulkBusy}
        error={bulkRejectError}
        onConfirm={(reason) => runBulkAction('reject', reason)}
        onCancel={() => { setConfirmBulkReject(false); setBulkRejectError(null); }}
      />
    </div>
  );
}
