import { useState, useEffect, useCallback, useRef } from 'react';
import { Building2, X, UserPlus, Trash2, Radar, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { getAuthUser } from '../lib/auth.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import DataTable from '../components/ui/DataTable.jsx';
import BulkActionBar from '../components/ui/BulkActionBar.jsx';
import { useRowSelection } from '../components/ui/useRowSelection.js';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';
import CompanyPolicySection from '../components/wizmatch/CompanyPolicySection.jsx';
import { companyPolicyUiEnabled } from '../lib/companyPolicyFlag.js';
// The ONE cross-boundary import in the admin SPA, and a deliberate one: the §9
// reason-code taxonomy is the same frozen list the server validates every
// policy write against (policyService rejects anything not in it), so a
// hand-copied picker here would drift silently and produce per-company
// `unknown_reason_code` failures. The module is pure data + pure functions with
// no imports of its own, so nothing server-side is pulled into the bundle.
import { WIZMATCH_REASON_CODES, getReasonCodeMeta } from '../../../src/config/wizmatchReasonCodes.ts';
// Same deliberate cross-boundary import, same reason: these option lists are the
// runtime source the server's write-time validation is derived from. See the
// header of that module for the pure-data rule that keeps the import safe.
import {
  ELIGIBILITY_OPTIONS,
  HIRING_POLICY_OPTIONS,
  RELATIONSHIP_OPTIONS,
  EVIDENCE_KIND_OPTIONS,
  REGION_SCOPE_LABELS,
} from '../../../src/config/wizmatchPolicyEnums.ts';

const TIER_BADGE = { A: 'badge-success', B: 'badge-warning', C: 'badge-muted', Reject: 'badge-danger' };
const REGION_BADGE = { india: 'badge-warning', us: 'badge-info' };

// The name/domain search is the ONE server-side filter on this page; every other
// def below narrows the rows already loaded. `serverKey` is the route's param
// name (`search`, not `q` — listCompanies(tenantId, search)), declared once here
// and read back by load() so the two can't drift. `serverOnly` makes
// filterPipeline skip it client-side: the server matches
// `name ILIKE %q% OR domain ILIKE %q%`, and re-running a per-field client test
// over the result would drop rows the server deliberately matched.
const COMPANY_SEARCH_DEF = {
  key: 'q',
  label: 'Name / domain',
  type: 'search',
  placeholder: 'Search name or domain…',
  serverOnly: true,
  serverKey: 'search',
};

// Declarative filter spec + columns for the Companies list. Everything except
// the search above is applied client-side over one capped load.
const COMPANY_FILTERS = [
  COMPANY_SEARCH_DEF,
  { key: 'industry', label: 'Industry', type: 'search', placeholder: 'Industry…', fields: ['industry'] },
  { key: 'country', label: 'Country', type: 'search', placeholder: 'Country…', fields: ['country'] },
  { key: 'ats_type', label: 'ATS', type: 'search', placeholder: 'ATS…', fields: ['ats_type'] },
  { key: 'tier', label: 'Tier', type: 'multiselect', options: ['A', 'B', 'C', 'Reject'].map((v) => ({ value: v, label: v })) },
  { key: 'region', label: 'Region', type: 'select', options: [{ value: 'india', label: 'India' }, { value: 'us', label: 'US' }], placeholder: 'Any region' },
  { key: 'employees', label: 'Employees', type: 'numberRange', accessor: (r) => r.employee_count },
  { key: 'is_prime', label: 'Prime only', type: 'toggle', predicate: (r) => r.is_prime === true },
  { key: 'has_open_reqs', label: 'Has open reqs', type: 'toggle', predicate: (r) => (r.open_requirement_count || 0) > 0 },
  { key: 'has_contacts', label: 'Has contacts', type: 'toggle', predicate: (r) => (r.contact_count || 0) > 0 },
];

const COMPANY_COLUMNS = [
  { key: 'name', label: 'Company', sortable: true, render: (c) => <span className="font-medium text-neutral-900">{c.name}</span> },
  { key: 'domain', label: 'Domain', sortable: true, render: (c) => <span className="text-neutral-500">{c.domain || '—'}</span> },
  { key: 'industry', label: 'Industry', sortable: true, render: (c) => <span className="text-neutral-500">{c.industry || '—'}</span> },
  { key: 'country', label: 'Country', sortable: true, render: (c) => <span className="text-neutral-500">{c.country || '—'}</span> },
  { key: 'tier', label: 'Tier', sortable: true, render: (c) => (c.tier ? <span className={TIER_BADGE[c.tier] || 'badge-muted'}>Tier {c.tier}</span> : <span className="text-neutral-400">—</span>) },
  { key: 'region', label: 'Region', sortable: true, render: (c) => (c.region ? <span className={REGION_BADGE[c.region] || 'badge-muted'}>{c.region}</span> : <span className="text-neutral-400">—</span>) },
  { key: 'employee_count', label: 'Employees', sortable: true, defaultHidden: true, render: (c) => <span className="tabular-nums">{c.employee_count ?? '—'}</span> },
  { key: 'ats_type', label: 'ATS', sortable: true, defaultHidden: true, render: (c) => <span className="text-neutral-500">{c.ats_type || '—'}</span> },
  { key: 'is_prime', label: 'Prime', sortable: true, defaultHidden: true, exportValue: (c) => (c.is_prime ? 'prime' : ''), render: (c) => (c.is_prime ? <span className="badge-info text-[10px]">Prime</span> : <span className="text-neutral-400">—</span>) },
  { key: 'open_requirement_count', label: 'Open reqs', sortable: true, render: (c) => (c.open_requirement_count > 0 ? <span className="badge-info">{c.open_requirement_count}</span> : <span className="text-neutral-500">0</span>) },
  { key: 'contact_count', label: 'Contacts', sortable: true, render: (c) => (c.contact_count > 0 ? <span className="badge-success">{c.contact_count}</span> : <span className="text-neutral-500">0</span>) },
];

// Mirrors COMPANY_CONTACT_ROLES in src/services/wizmatchStaffingDomain.ts —
// kept in sync by hand like OPERATING_STAGES in WizmatchRequirementsPage.jsx.
const COMPANY_CONTACT_ROLES = [
  'talent_acquisition', 'hiring_manager', 'coordinator', 'approver',
  'interviewer', 'procurement', 'vendor_manager', 'source', 'other',
];

// The shared bulk-endpoint contract caps a request at 200 ids. The existing
// /companies/bulk/policy route does not enforce a cap, but a 500-row
// select-all in one request is exactly the shape that times out, so chunk.
const BULK_CHUNK = 200;

// Grouped straight off the taxonomy array — categories are derived, not listed,
// so a new §9 category shows up in the picker without a change here.
const REASON_CODES_BY_CATEGORY = WIZMATCH_REASON_CODES.reduce((acc, meta) => {
  (acc[meta.category] ||= []).push(meta.code);
  return acc;
}, {});

function formatMinorCurrency(value, currency = 'INR') {
  const amount = Number(value || 0) / 100;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount.toFixed(2)}`;
  }
}

export default function WizmatchCompaniesPage() {
  const { showSuccess, showError } = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showBulkPolicy, setShowBulkPolicy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(null);

  const ctl = useTableControls({ pageId: 'wizmatch-companies', spec: COMPANY_FILTERS, columns: COMPANY_COLUMNS });

  // rowAriaLabel is what DataTable announces on the per-row checkbox; without
  // it a screen reader reads "Select row 7f3a-…" for every row.
  const rows = ctl.applyClient(items).map((c) => ({ ...c, rowAriaLabel: c.name || c.domain || 'Unnamed company' }));
  const sel = useRowSelection(rows, 'id');
  const clearSelection = sel.clear;

  // The Toast context value is a fresh object on every provider render (each
  // toast shown or dismissed re-renders it), so it can never sit in load()'s
  // dependency list — load() would be re-created and the effect below would
  // refetch on every toast. Read the toast fns through a ref instead.
  const toastRef = useRef({ showSuccess, showError });
  toastRef.current = { showSuccess, showError };

  const loadedOnce = useRef(false);

  // The one server-side filter. FilterBar debounces the input by 300ms before it
  // reaches the URL, so this value changes at most ~3x/second while typing and
  // each change is one request.
  const searchQuery = ctl.filters[COMPANY_SEARCH_DEF.key] || '';

  // One capped load per search term; every other filter and the sort are applied
  // client-side over the rows it returns.
  const load = useCallback(async () => {
    if (loadedOnce.current) setRefreshing(true); else setLoading(true);
    setError(null);
    // Mandatory: a selection that survives a reload would fire a bulk action
    // against rows the user can no longer see. INTENTIONAL and user-visible on
    // this page — typing in search re-runs load(), so it clears the selection
    // mid-flow. That is the correct trade: this page's only bulk action is an
    // admin policy WRITE, and carrying a selection across a changed result set
    // would let it land on companies the user can no longer see. Losing a
    // selection is cheap; a mis-targeted policy write is not.
    clearSelection();
    try {
      const params = new URLSearchParams();
      // Read the param name off the def rather than re-typing 'search' here.
      if (searchQuery.trim()) params.set(COMPANY_SEARCH_DEF.serverKey, searchQuery.trim());
      const qs = params.toString();
      const data = await apiFetch(`/api/wizmatch/staffing/companies${qs ? `?${qs}` : ''}`);
      setItems(data.items || []);
      // The route returns { items, total }; it used to return a bare array, so
      // fall back to the page length rather than rendering "of 0" against an
      // older server.
      setTotal(Number.isFinite(data.total) ? data.total : (data.items || []).length);
    } catch (e) {
      const msg = e.message || 'Failed to load companies';
      // First load has nothing to fall back on -> full ErrorRetry. A failed
      // REFRESH keeps the rows already on screen and reports the failure in a
      // toast instead of throwing a good list away.
      if (loadedOnce.current) toastRef.current.showError(msg);
      else setError(msg);
    } finally {
      loadedOnce.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [clearSelection, searchQuery]);

  useEffect(() => { load(); }, [load]);

  // listCompanies() is `... WHERE <search predicate> ORDER BY c.name LIMIT 500`
  // with no OFFSET (src/services/wizmatchStaffingDomain.ts), and returns `total`
  // = COUNT(*) over that SAME predicate. So "truncated" is `total > items.length`
  // — the server matched more than it was willing to return — never a hardcoded
  // `items.length >= 500`, which would accuse a tenant of exactly 500 matches of
  // hiding something. The search runs BEFORE the LIMIT, so narrowing reaches the
  // whole tenant: the cap bounds one page, not what is findable.
  const truncated = total > items.length;

  // POST /api/wizmatch/companies/bulk/policy is requireAdmin server-side, and
  // the whole policy router next('router')s into a 404 when
  // WIZMATCH_COMPANY_POLICY_ENABLED is off. Surface both as a disabled action
  // with a reason rather than letting someone click into a 403/404.
  const role = getAuthUser()?.role;
  const bulkPolicyDisabledReason = !companyPolicyUiEnabled
    ? 'Company policy is switched off in this environment'
    : role !== 'admin'
      ? 'Admin only — bulk policy writes are gated to the admin role'
      : undefined;

  const runBulkPolicy = async (input) => {
    const ids = sel.selectedVisible;
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    // Declared outside the try so a mid-chunk failure can still report the
    // companies that were already written — silently dropping that would make
    // a partial write look like a total no-op.
    let succeeded = 0;
    let failed = 0;
    let firstError = null;
    try {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const result = await apiFetch('/api/wizmatch/companies/bulk/policy', {
          method: 'POST',
          body: JSON.stringify({ companyIds: ids.slice(i, i + BULK_CHUNK), ...input }),
        });
        succeeded += result?.succeeded || 0;
        failed += result?.failed || 0;
        // Per-company results key on `companyId`, not `id` (policyService.ts).
        if (!firstError) firstError = (result?.results || []).find((r) => !r.ok)?.error || null;
      }
      setShowBulkPolicy(false);
      if (failed === 0) {
        toastRef.current.showSuccess(`Policy written on ${succeeded} ${succeeded === 1 ? 'company' : 'companies'}`);
      } else {
        toastRef.current.showError(`${succeeded} succeeded, ${failed} failed — ${firstError || 'open a company to see why'}`);
      }
      await load();
    } catch (e) {
      const base = e.status === 404
        ? 'The company-policy API is not enabled on this server.'
        : (e.message || 'Bulk policy write failed.');
      setBulkError(succeeded > 0 ? `${base} (${succeeded} companies were already written before this failure.)` : base);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Companies</h1>
          <span className="text-[12.5px] font-semibold text-primary-700 bg-primary-500/10 border border-primary-500/20 px-2.5 py-0.5 rounded-full">
            {rows.length}{rows.length !== total ? ` of ${total}` : ''} companies
          </span>
        </div>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-3">
        Client companies in the staffing pipeline — hiring contacts, open requirements and delivery activity. Filters and sort are shareable via the URL and savable as presets.
      </p>

      {truncated && (
        <div role="status" className="mb-4 rounded-md border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-[12px] text-warning-700">
          Showing the first {items.length.toLocaleString()} of {total.toLocaleString()}{searchQuery.trim() ? ' matching' : ''} companies
          — narrow with search to see the rest. Name/domain search runs on the server across the whole tenant; every other
          filter here only narrows the {items.length.toLocaleString()} rows already loaded.
        </div>
      )}

      {error ? (
        <ErrorRetry message={error} onRetry={load} retrying={loading} />
      ) : (
        <>
          <FilterBar
            spec={COMPANY_FILTERS}
            filters={ctl.filters}
            setFilter={ctl.setFilter}
            activeChips={ctl.activeChips}
            clearFilter={ctl.clearFilter}
            clearAll={ctl.clearAll}
            columns={COMPANY_COLUMNS}
            hiddenColumns={ctl.hiddenColumns}
            toggleColumn={ctl.toggleColumn}
            onExport={() => exportRowsToCsv(rows, ctl.visibleColumns, 'companies.csv')}
            presets={ctl.presets}
            savePreset={ctl.savePreset}
            setPresetShared={ctl.setPresetShared}
            presetsError={ctl.presetsError}
            applyPreset={ctl.applyPreset}
            deletePreset={ctl.deletePreset}
          />
          <DataTable
            columns={ctl.visibleColumns}
            rows={rows}
            rowKey="id"
            onRowClick={(c) => setSelectedId(c.id)}
            loading={loading}
            refreshing={refreshing}
            emptyText={
              // "No companies yet" is only true with no search term — with one
              // active, zero rows means the SERVER matched nothing, which is a
              // different thing and a different fix.
              items.length > 0 ? 'No companies match these filters.'
                : searchQuery.trim() ? 'No companies match this search.'
                  : 'No companies yet — they appear once they enter the staffing pipeline.'
            }
            sort={ctl.sort}
            onSort={ctl.setSort}
            selectedIds={sel.selectedIds}
            onToggleRow={sel.toggleRow}
            onToggleAll={sel.toggleAll}
          />
          <BulkActionBar
            count={sel.count}
            entityLabel="company"
            entityLabelPlural="companies"
            busy={bulkBusy}
            actions={[{
              key: 'policy',
              label: 'Set policy…',
              disabled: Boolean(bulkPolicyDisabledReason),
              reason: bulkPolicyDisabledReason,
            }]}
            onAction={() => { setBulkError(null); setShowBulkPolicy(true); }}
            onClear={sel.clear}
          />
        </>
      )}

      {showBulkPolicy && (
        <BulkPolicyDialog
          count={sel.count}
          busy={bulkBusy}
          error={bulkError}
          onSubmit={runBulkPolicy}
          onCancel={() => { setShowBulkPolicy(false); setBulkError(null); }}
        />
      )}

      {selectedId && (
        <CompanyDetailDrawer
          companyId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleted={() => { setSelectedId(null); load(); }}
          onChanged={load}
        />
      )}
    </div>
  );
}

// Bulk policy write — a form, not a ConfirmDialog, because the endpoint needs a
// scope plus a §9 reason code and ConfirmDialog only collects free text.
//
// TWO scopes are offered, and the split is a correctness constraint, not a
// convenience:
//
//   `entire_company` (Set full policy) forces all three dimensions.
//   policyService rejects an `entire_company` row that leaves any of them unset
//   (`root_requires_all_dimensions`, policyService.ts:215-221, mirroring
//   migration 0037's `..._root_defines_all_chk`), so they are validated here
//   rather than sent to fail. Consequence: it is impossible to "just pause" at
//   the root — a root pause also restates hiring policy and relationship type.
//
//   `region` (Pause outreach only) needs exactly ONE dimension
//   (`scoped_requires_one_dimension`, policyService.ts:222-223 / 0037's
//   `..._scoped_overrides_one_chk`), so it can carry an eligibility change with
//   nothing else attached.
//
// An earlier version of this comment claimed every non-`entire_company` scope
// "keys off a per-company value" and used that to rule out any other scope in
// bulk. That is true of `business_unit` and `location`, whose `scope_ref_label`
// is free text, and of `specific_signal`/`specific_requirement`, which need a
// row id. It is NOT true of `region`: migration 0037's
// `wizmatch_company_policies_region_label_chk` pins a region row's
// `scope_ref_label` to exactly `'india'|'us'` — a closed, tenant-independent
// vocabulary that means the same thing for every company in a selection. Region
// is the one non-root scope that is legitimately bulk-able.
//
// One property worth knowing before using it: a region row is STRICTER than it
// looks, never looser. While an active `region:*` row exists on a company, any
// gate call whose context cannot resolve a region label denies outright with
// `scope_unresolvable` (policyResolver.ts:193-205 -> outreachGate.ts:416-417),
// rather than skipping the row. A region-scoped pause therefore cannot silently
// fail open — the failure mode is over-blocking, which is the safe direction for
// a pause. The dialog says so.
const BULK_SCOPES = {
  entire_company: {
    label: 'Set full policy',
    hint: 'All three dimensions, at the company root.',
  },
  region: {
    label: 'Pause outreach only',
    hint: 'One region, eligibility only — hiring policy and relationship are left untouched.',
  },
};

function BulkPolicyDialog({ count, busy, error, onSubmit, onCancel }) {
  const [scopeType, setScopeType] = useState('entire_company');
  const [scopeRefLabel, setScopeRefLabel] = useState('');
  const [outreachEligibility, setOutreachEligibility] = useState('');
  const [externalHiringPolicy, setExternalHiringPolicy] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [evidenceKind, setEvidenceKind] = useState('human_text');
  const [evidenceText, setEvidenceText] = useState('');

  const pauseOnly = scopeType === 'region';
  // In pause mode eligibility is pinned, not chosen — the whole point of the
  // preset is that it writes one dimension and no others.
  const effectiveEligibility = pauseOnly ? 'paused' : outreachEligibility;
  // Mirrors the server's `paused_requires_review_date` rule
  // (policyService.ts:212-214 / 0037 `..._paused_review_date_chk`). Always true
  // in pause mode, since eligibility is pinned to `paused`.
  const needsReviewDate = effectiveEligibility === 'paused';
  const evidenceExpected = reasonCode ? getReasonCodeMeta(reasonCode)?.evidence === 'required' : false;
  const canSubmit = !busy
    && reasonCode.length > 0
    && (!needsReviewDate || Boolean(reviewDate))
    && (pauseOnly
      ? Boolean(scopeRefLabel)
      : Boolean(outreachEligibility && externalHiringPolicy && relationshipType));

  // Built per-mode rather than by nulling fields, so a value typed in one mode
  // and hidden by switching to the other can never reach the server.
  const submit = () => onSubmit(pauseOnly
    ? {
      scopeType: 'region',
      scopeRefLabel,
      outreachEligibility: 'paused',
      reasonCode,
      reason: reason.trim() || undefined,
      reviewDate,
      evidenceKind: evidenceText.trim() ? evidenceKind : undefined,
      evidenceText: evidenceText.trim() || undefined,
    }
    : {
      scopeType: 'entire_company',
      outreachEligibility,
      externalHiringPolicy,
      relationshipType,
      reasonCode,
      reason: reason.trim() || undefined,
      reviewDate: reviewDate || undefined,
      evidenceKind: evidenceText.trim() ? evidenceKind : undefined,
      evidenceText: evidenceText.trim() || undefined,
    });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-policy-title" className="w-[440px] max-w-full bg-white rounded-xl shadow-modal border border-neutral-200 max-h-[90vh] overflow-y-auto">
        <div className="p-5 space-y-3">
          <h2 id="bulk-policy-title" className="text-[15px] font-bold text-neutral-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary-600" />
            Set policy on {count} {count === 1 ? 'company' : 'companies'}
          </h2>
          <div role="radiogroup" aria-label="What to write" className="flex gap-1.5">
            {Object.entries(BULK_SCOPES).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={scopeType === key}
                onClick={() => setScopeType(key)}
                title={meta.hint}
                className={`flex-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-md border ${scopeType === key ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'}`}
              >
                {meta.label}
              </button>
            ))}
          </div>

          {pauseOnly ? (
            <p className="text-[12.5px] text-neutral-600 leading-relaxed">
              Writes one <code>region</code> policy row per selected company, setting outreach eligibility to
              {' '}<b>paused</b> for that region only. Hiring policy and relationship type are not written and keep inheriting
              from each company's root. While a region row is active, an action whose context has no resolvable region is
              denied outright (<code>scope_unresolvable</code>) rather than ignoring the row — the pause cannot fail open, but
              it is stricter than it looks.
            </p>
          ) : (
            <p className="text-[12.5px] text-neutral-600 leading-relaxed">
              Writes one <code>entire_company</code> policy row per selected company, superseding whatever root policy each one
              has now. A root row must define all three dimensions, so this restates hiring policy and relationship type even
              if you only meant to change eligibility — use <b>Pause outreach only</b> for that. Every write is recorded in that
              company's policy history and can be superseded again, but not un-done in bulk.
            </p>
          )}
          {error && (
            <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {error}
            </div>
          )}
          {pauseOnly ? (
            /* Not free text: migration 0037 pins a region row's scope_ref_label
               to exactly these values, so a typo here would be a per-company
               CHECK violation across the whole selection. */
            <label className="block">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Region to pause — required</span>
              <select value={scopeRefLabel} onChange={(e) => setScopeRefLabel(e.target.value)} className="input w-full mt-1">
                <option value="">Select a region…</option>
                {REGION_SCOPE_LABELS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ) : (
            <>
              <select value={outreachEligibility} onChange={(e) => setOutreachEligibility(e.target.value)} className="input w-full">
                <option value="">Outreach eligibility — required</option>
                {ELIGIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
              </select>
              <select value={externalHiringPolicy} onChange={(e) => setExternalHiringPolicy(e.target.value)} className="input w-full">
                <option value="">Hiring policy — required</option>
                {HIRING_POLICY_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
              </select>
              <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)} className="input w-full">
                <option value="">Relationship — required</option>
                {RELATIONSHIP_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
              </select>
            </>
          )}
          {needsReviewDate && (
            <label className="block">
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Review date (required while paused)</span>
              <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="input w-full mt-1" />
            </label>
          )}
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} className="input w-full">
            <option value="">Reason code — required (§9 taxonomy)</option>
            {Object.entries(REASON_CODES_BY_CATEGORY).map(([category, codes]) => (
              <optgroup key={category} label={category.replaceAll('_', ' ')}>
                {codes.map((code) => <option key={code} value={code}>{code.replaceAll('_', ' ')}</option>)}
              </optgroup>
            ))}
          </select>
          {evidenceExpected && (
            <p className="text-[11px] text-warning-700">
              The §9 entry for this code expects evidence. It is not enforced for an overridable row, but a block written
              without it is not reviewable later — add evidence text below.
            </p>
          )}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional free text)" className="input w-full resize-y" />
          <div className="grid grid-cols-2 gap-2">
            <select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)} className="input">
              {EVIDENCE_KIND_OPTIONS.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
            </select>
            <input value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} placeholder="Evidence text (optional)" className="input" />
          </div>
          <p className="text-[10.5px] text-neutral-400">
            The reason code must be in the ratified §9 taxonomy — the server rejects anything else, per company, and the
            failures are reported back individually. Permanent and non-overridable blocks are deliberately not offered in
            bulk; set those one company at a time from the company drawer.
          </p>
        </div>
        <div className="border-t border-neutral-100 px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-standard">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
            {busy ? 'Working…' : pauseOnly ? `Pause ${scopeRefLabel || 'region'} on ${count}` : `Write policy on ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyDetailDrawer({ companyId, onClose, onDeleted, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [dependencyNotice, setDependencyNotice] = useState(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiFetch(`/api/wizmatch/staffing/companies/${companyId}`);
      setData(detail);
    } catch (e) {
      setError(e.message || 'Failed to load company');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch('/api/wizmatch/staffing/users').then(d => setUsers(d.items || [])).catch(() => setUsers([]));
  }, []);

  const ownerName = (id) => users.find(u => u.id === id)?.name || null;

  const refreshAfterChange = async () => {
    await load();
    onChanged();
  };

  // The delete endpoint returns 409 { error:'has_dependencies', message,
  // dependencies:[...] } which apiFetch surfaces as e.message — matched here
  // instead of a status code because apiFetch does not expose one.
  const deleteCompany = async (reason) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/staffing/companies/${companyId}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      showSuccess('Company deleted permanently');
      onDeleted();
    } catch (e) {
      if (e.message && /cannot delete/i.test(e.message)) {
        setShowDeleteDialog(false);
        setDependencyNotice(e.message);
      } else {
        setDeleteError(e.message || 'Delete failed.');
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[600px] max-w-[95vw] h-full shadow-modal flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <p className="text-neutral-500">Loading company…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[600px] max-w-[95vw] h-full shadow-modal p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-end mb-4"><button onClick={onClose} className="text-neutral-500 hover:text-neutral-600"><X className="w-5 h-5" /></button></div>
          <ErrorRetry message={error} onRetry={load} retrying={loading} />
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { company, contacts, requirements, events, tasks } = data;
  const canOfferDelete = !dependencyNotice && (contacts?.length || 0) === 0 && (requirements?.length || 0) === 0;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[600px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900 truncate">{company.name}</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {company.domain || 'No domain on file'}{company.country ? ` · ${company.country}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex gap-4 text-[12.5px] text-neutral-500">
              <span><b className="text-neutral-900">{requirements?.length || 0}</b> requirements</span>
              <span><b className="text-neutral-900">{contacts?.length || 0}</b> hiring contacts</span>
              <span><b className="text-neutral-900">{tasks?.length || 0}</b> open tasks</span>
            </div>
            {canOfferDelete && (
              <button onClick={() => setShowDeleteDialog(true)} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700 inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Delete permanently
              </button>
            )}
          </div>

          {dependencyNotice && (
            <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {dependencyNotice}
            </div>
          )}

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-bold text-neutral-900">Hiring contacts</h3>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowDiscovery(v => !v)} className="btn-standard btn-compact">
                  <Radar className="w-3.5 h-3.5" /> Discover contacts
                </button>
                <button onClick={() => setShowAddContact(v => !v)} className="btn-standard btn-compact">
                  <UserPlus className="w-3.5 h-3.5" /> Link contact
                </button>
              </div>
            </div>
            {showDiscovery && (
              <DiscoveryPreviewPanel
                companyId={companyId}
                onClose={() => setShowDiscovery(false)}
                onDiscovered={async (message) => { showSuccess(message); await refreshAfterChange(); }}
                onError={(msg) => showError(msg)}
              />
            )}
            {showAddContact && (
              <AddHiringContactPanel
                companyId={companyId}
                onClose={() => setShowAddContact(false)}
                onAdded={async () => { setShowAddContact(false); showSuccess('Hiring contact linked'); await refreshAfterChange(); }}
                onError={(msg) => showError(msg)}
              />
            )}
            {(contacts?.length || 0) === 0 ? (
              <EmptyState icon={UserPlus} title="No hiring contacts yet" description="Link an existing CRM contact to this company." variant="true-empty" />
            ) : (
              <div className="space-y-2">
                {contacts.map(c => (
                  <div key={c.id} className="rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-neutral-900 text-[13px]">{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Unnamed contact'}</p>
                        <p className="text-[11.5px] text-neutral-500 mt-0.5">{c.email || c.phone || 'No channel on file'}</p>
                      </div>
                      <StatusBadge status={c.relationship_stage} />
                    </div>
                    {(c.roles || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.roles.map(r => <span key={r} className="badge-info text-[10px]">{r.replaceAll('_', ' ')}</span>)}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                      <span>{c.active_requirement_count || 0} active requirement(s){ownerName(c.owner_user_id) ? ` · owner ${ownerName(c.owner_user_id)}` : ''}</span>
                      {c.next_action && <span className="text-warning-700">{c.next_action}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <CompanyPolicySection companyId={companyId} users={users} onChanged={refreshAfterChange} />

          <section>
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Requirements</h3>
            {(requirements?.length || 0) === 0 ? (
              <EmptyState icon={Building2} title="No requirements yet" description="No job leads have been created for this company." variant="true-empty" />
            ) : (
              <div className="space-y-2">
                {requirements.map(r => (
                  <div key={r.id} className="rounded-lg border border-neutral-200 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 text-[13px] truncate">{r.title}</p>
                      <p className="text-[11.5px] text-neutral-500 mt-0.5">
                        {r.location || '—'}{r.work_mode ? ` · ${r.work_mode}` : ''} · {r.positions || 1} position(s)
                        {r.source_first_name ? ` · source ${[r.source_first_name, r.source_last_name].filter(Boolean).join(' ')}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={r.stage || 'draft'} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Open work</h3>
            {(tasks?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-500">No open tasks linked to this company.</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map(t => (
                  <div key={t.id} className="text-[12px] flex items-center justify-between border-l-2 border-warning-300 pl-2 py-1">
                    <span className="font-medium text-neutral-800">{t.title}</span>
                    <span className="text-neutral-500">{t.due_at ? new Date(t.due_at).toLocaleDateString() : 'No due date'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Activity</h3>
            {(events?.length || 0) === 0 ? (
              <p className="text-[12px] text-neutral-500">No activity recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {events.slice(0, 15).map(e => (
                  <div key={e.id} className="text-[11.5px] border-l-2 border-primary-200 pl-2 py-1">
                    <b>{e.event_type.replaceAll('_', ' ')}</b> · {new Date(e.occurred_at).toLocaleString()}{e.actor_name ? ` · ${e.actor_name}` : ''}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Must stay inside the stopPropagation() panel above — the outer
            backdrop's onClick={onClose} would otherwise catch bubbled clicks
            from inside ConfirmDialog (including Cancel) and close the whole
            drawer, not just the dialog. */}
        <ConfirmDialog
          open={showDeleteDialog}
          title="Delete this company?"
          impactSummary={`This permanently deletes "${company.name}" and cannot be undone. Only allowed while it has zero requirements, hiring contacts and job signals.`}
          confirmLabel="Delete permanently"
          danger
          requireTypedName={company.name}
          requireReason
          loading={deleting}
          error={deleteError}
          onConfirm={deleteCompany}
          onCancel={() => { setShowDeleteDialog(false); setDeleteError(null); }}
        />
      </div>
    </div>
  );
}

// Cost-gated preview/confirm discovery flow — same contract as the retired
// WizmatchContactIntelligencePage (POST .../discovery-preview then
// POST .../discover with confirmPreview:true), moved here since discovery is
// company-scoped and this is the company's natural detail view. Found
// candidates land in wizmatch_contact_candidates and show up on the Hiring
// Contacts page's discovery queue tab for review.
function DiscoveryPreviewPanel({ companyId, onClose, onDiscovered, onError }) {
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const runPreview = async () => {
    setPreviewing(true);
    setFeedback(null);
    setPreview(null);
    setConfirmed(false);
    try {
      const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${companyId}/discovery-preview`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPreview(result.preview || null);
      if (!result.preview?.eligible) setFeedback('Preview blocked — review the reasons below. No provider call was made.');
    } catch (e) {
      setFeedback(e.message || 'Discovery preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const runDiscovery = async () => {
    if (!preview?.eligible || !confirmed) return;
    setRunning(true);
    setFeedback(null);
    try {
      const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${companyId}/discover`, {
        method: 'POST',
        body: JSON.stringify({ confirmPreview: true }),
      });
      const count = result.contactCandidates?.length || 0;
      const cost = formatMinorCurrency(result.costCents, result.preview?.costGuard?.currency);
      onDiscovered(`Discovery ${result.status || 'completed'}: ${count} reviewable contact(s) found, ${cost} recorded cost. No outreach was sent.`);
    } catch (e) {
      const msg = e.message || 'Discovery run failed.';
      setFeedback(msg);
      onError(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="card p-3 mb-3 space-y-2.5 bg-neutral-50/50">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-neutral-500">Preview is read-only — it shows eligibility, provider order and estimated cost without calling a provider.</p>
        <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-600 shrink-0"><X className="w-4 h-4" /></button>
      </div>
      {feedback && (
        <div role="alert" className="text-[12px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{feedback}</div>
      )}
      {!preview ? (
        <button onClick={runPreview} disabled={previewing} className="btn-standard btn-compact disabled:opacity-50">
          {previewing ? 'Preparing…' : 'Preview discovery'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={preview.eligible ? 'badge-success' : 'badge-warning'}>
              {preview.status?.replaceAll('_', ' ') || (preview.eligible ? 'eligible' : 'blocked')}
            </span>
            <span className="badge-muted text-[11px]">Est. cost {formatMinorCurrency(preview.estimatedCostCents, preview.costGuard?.currency)}</span>
            <span className="badge-muted text-[11px]">Cooldown {preview.capStatus?.rediscoveryCooldownDays ?? 30}d</span>
          </div>
          <p className="text-[11.5px] text-neutral-500">
            Providers: {(preview.providerOrder || []).map(p => p.replaceAll('_', ' ')).join(' → ') || 'No provider path available'}
          </p>
          {(preview.blockedReasons || []).length > 0 && (
            <ul className="text-[11.5px] text-warning-700 list-disc list-inside">
              {preview.blockedReasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {preview.eligible && (
            <label className="flex items-center gap-2 text-[12px] text-neutral-600">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I've reviewed the cost and provider order — run this discovery now
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={runPreview} disabled={previewing} className="btn-standard btn-compact">Re-preview</button>
            {preview.eligible && (
              <button onClick={runDiscovery} disabled={running || !confirmed} className="btn-primary btn-compact disabled:opacity-50">
                {running ? 'Running…' : 'Run discovery'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddHiringContactPanel({ companyId, onClose, onAdded, onError }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        const data = await apiFetch(`/api/wizmatch/staffing/contacts?${params}`);
        if (!cancelled) setResults(data.items || []);
      } catch (e) {
        if (!cancelled) setFeedback(e.message || 'Search failed.');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const toggleRole = (role) => setRoles(r => r.includes(role) ? r.filter(x => x !== role) : [...r, role]);

  const link = async () => {
    if (!selected) { setFeedback({ kind: 'error', message: 'Select a CRM contact first.' }); return; }
    setSaving(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/wizmatch/companies/${companyId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ contactId: selected.id, roles, relationshipStage: 'active' }),
      });
      onAdded();
    } catch (e) {
      const msg = e.message || 'Failed to link contact.';
      setFeedback({ kind: 'error', message: msg });
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-3 mb-3 space-y-2.5 bg-neutral-50/50">
      <input
        placeholder="Search CRM contacts by name, company, email or phone…"
        value={search}
        onChange={e => { setSearch(e.target.value); setSelected(null); }}
        className="input w-full"
        autoFocus
      />
      {feedback && (
        <div role="alert" className="text-[12px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
          {typeof feedback === 'string' ? feedback : feedback.message}
        </div>
      )}
      {searching ? (
        <p className="text-[12px] text-neutral-500">Searching…</p>
      ) : results.length === 0 ? (
        <p className="text-[12px] text-neutral-500">{search ? 'No CRM contacts match this search.' : 'Type to search CRM contacts.'}</p>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r)}
              className={`w-full text-left text-[12.5px] px-2.5 py-1.5 rounded-md border ${selected?.id === r.id ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:bg-neutral-100'}`}
            >
              <span className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.company_name || 'Unnamed'}</span>
              <span className="text-neutral-500"> · {r.email || r.phone || 'no channel'}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="flex flex-wrap gap-1.5">
          {COMPANY_CONTACT_ROLES.map(role => (
            <button
              key={role}
              type="button"
              onClick={() => toggleRole(role)}
              className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${roles.includes(role) ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}
            >
              {role.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-standard btn-compact">Cancel</button>
        <button onClick={link} disabled={saving || !selected} className="btn-primary btn-compact disabled:opacity-50">
          {saving ? 'Linking…' : 'Link as hiring contact'}
        </button>
      </div>
    </div>
  );
}
