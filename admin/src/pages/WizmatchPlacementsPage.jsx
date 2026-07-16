import { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, Plus, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { Modal, Button } from '../components/ui/index.js';
import { formatPlacementCommercial, summarizePlacementCommercials } from '../lib/wizmatchPlacementCommercials.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';

const PLACEMENT_EXPORT_COLUMNS = [
  { key: 'candidate', label: 'Candidate', exportValue: (p) => [p.candidate_first, p.candidate_last].filter(Boolean).join(' ') },
  { key: 'company_name', label: 'Company' },
  { key: 'job_title', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'placement_type', label: 'Type' },
  { key: 'currency', label: 'Currency', exportValue: (p) => p.currency || 'INR' },
  { key: 'commercial', label: 'Commercial', exportValue: (p) => formatPlacementCommercial(p) },
  { key: 'contract_start_date', label: 'Start date', exportValue: (p) => p.contract_start_date || '' },
];

const STAGES = ['submitted', 'interviewing', 'offered', 'started', 'ended', 'lost'];
const STAGE_LABELS = { submitted: 'Submitted', interviewing: 'Interviewing', offered: 'Offered', started: 'Started', ended: 'Ended', lost: 'Lost' };
const STAGE_COLORS = { submitted: '#3b82f6', interviewing: '#f59e0b', offered: '#8b5cf6', started: '#22c55e', ended: '#94a3b8', lost: '#ef4444' };
// Neutral columns match tokens exactly (neutral-100/neutral-200); started/lost use
// the spec's exact tints, which aren't in the token scale.
const COLUMN_BG = {
  submitted: 'bg-neutral-100 border-neutral-200',
  interviewing: 'bg-neutral-100 border-neutral-200',
  offered: 'bg-neutral-100 border-neutral-200',
  started: 'bg-[#f0fdf4] border-[#bbf7d0]',
  ended: 'bg-neutral-100 border-neutral-200',
  lost: 'bg-[#fef2f2] border-[#fecaca]',
};
const HEADER_TEXT = { started: 'text-[#15803d]', lost: 'text-[#b91c1c]' };
const COUNT_PILL = {
  started: 'bg-white border-[#bbf7d0] text-[#15803d]',
  lost: 'bg-white border-[#fecaca] text-[#dc2626]',
};
const SUBTOTAL_TEXT = { started: 'text-[#15803d]', lost: 'text-[#b91c1c]' };
const NEW_CARD_BORDER = {
  started: 'border-[#bbf7d0] text-[#15803d]',
  lost: 'border-[#fecaca] text-[#b91c1c]',
};

export default function WizmatchPlacementsPage() {
  const [placements, setPlacements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [capabilities, setCapabilities] = useState({});
  const [draggedId, setDraggedId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailPlacement, setDetailPlacement] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [data, access] = await Promise.all([
        apiFetch('/api/wizmatch/placements?limit=200'),
        apiFetch('/api/wizmatch/staffing/access').catch(() => ({ capabilities: {} })),
      ]);
      setPlacements(data.items || []);
      setCapabilities(access.capabilities || {});
    } catch (e) {
      setPlacements([]);
      setLoadError(e.message || 'Placements could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    try { await apiFetch(`/api/wizmatch/placements/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); load(); }
    catch (e) { alert(e.message); }
  };

  const onDrop = (e, status) => {
    e.preventDefault();
    if (draggedId) { updateStatus(draggedId, status); setDraggedId(null); }
  };

  // Client-side only — derived from already-loaded placements, no new fetch.
  // Role/currency options are faceted from the loaded rows; the filter applies
  // across every Kanban column at once.
  const roleOptions = useMemo(() => [...new Set(placements.map(p => p.job_title).filter(Boolean))].sort().map(v => ({ value: v, label: v })), [placements]);
  const currencyOptions = useMemo(() => [...new Set(placements.map(p => p.currency).filter(Boolean))].sort().map(v => ({ value: v, label: v })), [placements]);
  const placementFilters = useMemo(() => [
    { key: 'q', label: 'Search', type: 'search', placeholder: 'Candidate, company, role…', fields: ['candidate_first', 'candidate_last', 'company_name', 'job_title'] },
    { key: 'job_title', label: 'Role', type: 'select', options: roleOptions, placeholder: 'All roles' },
    { key: 'placement_type', label: 'Type', type: 'multiselect', options: [{ value: 'contract_c2c', label: 'Contract — C2C' }, { value: 'contract_w2', label: 'Contract — W2' }, { value: 'contract_1099', label: 'Contract — 1099' }, { value: 'permanent', label: 'Permanent' }] },
    { key: 'currency', label: 'Currency', type: 'multiselect', options: currencyOptions },
    { key: 'started', label: 'Started', type: 'dateRange', accessor: (p) => p.contract_start_date },
  ], [roleOptions, currencyOptions]);
  const ctl = useTableControls({ pageId: 'wizmatch-placements', spec: placementFilters, columns: undefined });
  const filteredPlacements = ctl.applyClient(placements);
  const commercialSummary = summarizePlacementCommercials(filteredPlacements);

  if (loading) return <div className="p-6"><p className="text-neutral-500">Loading...</p></div>;
  if (loadError && placements.length === 0) return <div className="p-6"><ErrorRetry message={loadError} onRetry={load} /></div>;

  return (
    <div className="flex flex-col h-full">
      {/* Command bar */}
      <div className="bg-white border-b border-neutral-200 px-6 py-3.5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] font-semibold text-primary-700 bg-primary-500/10 border border-primary-500/20 px-2.5 py-0.5 rounded-full">
            {filteredPlacements.length} placements · {commercialSummary}
          </span>
          <div className="flex-1" />
          <button onClick={() => exportRowsToCsv(filteredPlacements, PLACEMENT_EXPORT_COLUMNS, 'placements.csv')} className="btn-standard">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          {/* Legacy creation path — see AddPlacementModal below. Product rules say the only
              legitimate placement-creation path is an accepted offer on the Submissions &
              Delivery board (POST .../submissions/:id/placement). This button predates that
              rule and still posts directly to /api/wizmatch/placements. Left in place per
              instruction not to silently remove a working entry point; flagged in the PR report. */}
          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            + Add Placement
          </button>
        </div>
        <FilterBar
          spec={placementFilters}
          filters={ctl.filters}
          setFilter={ctl.setFilter}
          activeChips={ctl.activeChips}
          clearFilter={ctl.clearFilter}
          clearAll={ctl.clearAll}
          presets={ctl.presets}
          savePreset={ctl.savePreset}
          applyPreset={ctl.applyPreset}
          deletePreset={ctl.deletePreset}
        />
      </div>

      {placements.length === 0 ? (
        <EmptyState title="No placements yet" description="Placements are created from an accepted offer on the Submissions & Delivery board, or via the legacy Add Placement button." />
      ) : (
      <>
      {/* Kanban */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 pt-[18px] px-6 pb-6 items-start min-w-max">
          {STAGES.map(stage => {
            const stageDeals = filteredPlacements.filter(p => p.status === stage);
            const stageCommercialSummary = summarizePlacementCommercials(stageDeals);
            return (
              <div
                key={stage}
                className={`flex-shrink-0 w-64 rounded-lg border overflow-hidden ${COLUMN_BG[stage]}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, stage)}
              >
                <span className="h-[3px] block" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                  <h2 className={`text-[12.5px] font-semibold flex-1 truncate ${HEADER_TEXT[stage] || 'text-neutral-700'}`}>
                    {STAGE_LABELS[stage]}
                  </h2>
                  <span className={`text-[11px] font-semibold px-1.5 py-px rounded-full border ${COUNT_PILL[stage] || 'bg-white border-neutral-200 text-neutral-500'}`}>
                    {stageDeals.length}
                  </span>
                </div>
                <p className={`px-3 pb-2 text-[11px] font-medium ${SUBTOTAL_TEXT[stage] || 'text-neutral-600'}`}>
                  {stageCommercialSummary}
                </p>
                <div className="px-2.5 pb-2.5 space-y-2">
                  {stageDeals.map(p => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={() => setDraggedId(p.id)}
                      onClick={() => setDetailPlacement(p)}
                      className="bg-white rounded-lg shadow-card p-3 cursor-pointer hover:shadow-hover transition-shadow"
                    >
                      <p className="text-[13.5px] font-semibold text-neutral-900">{p.candidate_first} {p.candidate_last}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">{p.company_name}</p>
                      <p className="text-[11.5px] text-neutral-500 mt-px mb-2">{p.job_title}</p>
                      <div className="flex items-center justify-between">
                        {stage === 'ended' ? (
                          <span className="text-xs font-semibold text-neutral-500">Contract ended</span>
                        ) : stage === 'lost' ? (
                          <span className="text-[11.5px] font-medium text-danger-600">Lost</span>
                        ) : (
                          <span className="text-xs font-semibold text-success-700">{formatPlacementCommercial(p)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setShowAddModal(true)}
                    className={`w-full text-xs font-medium border border-dashed rounded-md py-1.5 transition-colors hover:bg-white/60 ${NEW_CARD_BORDER[stage] || 'border-neutral-300 text-neutral-600'}`}
                  >
                    + New
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}

      {showAddModal && (
        <AddPlacementModal onClose={() => setShowAddModal(false)} onDone={() => { setShowAddModal(false); load(); }} />
      )}

      {detailPlacement && (
        <PlacementDetailModal
          placement={detailPlacement}
          capabilities={capabilities}
          onClose={() => setDetailPlacement(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// Legacy creation path — see the "+ Add Placement" button above for context. Kept
// functional as-is; not extended further since new placement creation should go
// through the Submissions & Delivery board instead.
function AddPlacementModal({ onClose, onDone }) {
  const [candidates, setCandidates] = useState([]);
  const [signals, setSignals] = useState([]);
  const [form, setForm] = useState({ candidate_id: '', job_signal_id: '', placement_type: 'contract_c2c', bill_rate_hourly: '', pay_rate_hourly: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/wizmatch/candidates?limit=200').then(d => setCandidates(d.items || [])).catch(() => {});
    apiFetch('/api/wizmatch/signals?limit=200').then(d => setSignals(d.items || [])).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const signal = signals.find(s => s.id === form.job_signal_id);
      await apiFetch('/api/wizmatch/placements', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: form.candidate_id,
          job_signal_id: form.job_signal_id || undefined,
          company_id: signal?.company_id,
          placement_type: form.placement_type,
          bill_rate_hourly: form.bill_rate_hourly ? Number(form.bill_rate_hourly) : undefined,
          pay_rate_hourly: form.pay_rate_hourly ? Number(form.pay_rate_hourly) : undefined,
        }),
      });
      onDone();
    } catch (e) { alert('Failed: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Placement"
      footer={
        <>
          <Button variant="standard" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-placement-form" disabled={saving || !form.candidate_id}>
            {saving ? 'Saving…' : 'Add Placement'}
          </Button>
        </>
      }
    >
      <form id="add-placement-form" onSubmit={submit} className="space-y-3">
        <select required value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })} className="input w-full">
          <option value="">Select candidate…</option>
          {candidates.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
        </select>
        <select value={form.job_signal_id} onChange={e => setForm({ ...form, job_signal_id: e.target.value })} className="input w-full">
          <option value="">Select role (optional)…</option>
          {signals.map(s => <option key={s.id} value={s.id}>{s.job_title} — {s.company_name}</option>)}
        </select>
        <select value={form.placement_type} onChange={e => setForm({ ...form, placement_type: e.target.value })} className="input w-full">
          <option value="contract_c2c">Contract — C2C</option>
          <option value="contract_w2">Contract — W2</option>
          <option value="contract_1099">Contract — 1099</option>
          <option value="permanent">Permanent</option>
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input type="number" placeholder="Bill rate $/hr" value={form.bill_rate_hourly} onChange={e => setForm({ ...form, bill_rate_hourly: e.target.value })} className="input" />
          <input type="number" placeholder="Pay rate $/hr" value={form.pay_rate_hourly} onChange={e => setForm({ ...form, pay_rate_hourly: e.target.value })} className="input" />
        </div>
      </form>
    </Modal>
  );
}

const TABS = ['overview', 'economics', 'invoice', 'collection', 'adjustments'];
const TAB_LABELS = { overview: 'Overview', economics: 'Economics', invoice: 'Invoice', collection: 'Collection', adjustments: 'Adjustments' };
const ADJUSTMENT_TYPES = ['dispute', 'replacement', 'refund'];

function money(paise, currencyCode) {
  if (paise == null) return '—';
  const code = currencyCode || 'INR';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(paise / 100);
  } catch {
    return `${code} ${(paise / 100).toLocaleString()}`;
  }
}

// Reconstructs invoice-link / adjustment-open / adjustment-resolve history from the
// requirement's staffing event timeline, filtered to this placement. There is no
// dedicated GET endpoint for a placement's linked invoice history or adjustments list
// (see PR report), so this is the only way to recover it without a new backend route —
// and only works for placements created through the staffing flow (they carry a
// requirement_id; legacy directly-created placements do not).
function derivePlacementEvents(events, placementId) {
  return (events || [])
    .filter((e) => String(e.placement_id) === String(placementId) && e.event_type.startsWith('placement_'))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

function deriveAdjustments(placementEvents) {
  const resolvedIds = new Set(
    placementEvents.filter((e) => e.event_type.endsWith('_resolved')).map((e) => e.payload?.adjustmentId),
  );
  return placementEvents
    .filter((e) => e.event_type.endsWith('_opened'))
    .map((e) => ({
      id: e.payload?.adjustmentId,
      type: e.event_type.replace('placement_', '').replace('_opened', ''),
      amount: e.payload?.amount,
      currency: e.payload?.currency,
      occurredAt: e.occurred_at,
      status: resolvedIds.has(e.payload?.adjustmentId) ? 'resolved' : 'open',
    }));
}

function PlacementDetailModal({ placement, capabilities, onClose, onChanged }) {
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [events, setEvents] = useState(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceLoadError, setInvoiceLoadError] = useState('');

  const canManageFinance = !!capabilities.manageFinance;
  const hasRequirement = !!placement.requirement_id;

  const loadEvents = useCallback(async () => {
    if (!hasRequirement || events !== null) return;
    setEventsLoading(true);
    try {
      const data = await apiFetch(`/api/wizmatch/requirements/${placement.requirement_id}/timeline`);
      setEvents(data.items || []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [hasRequirement, placement.requirement_id, events]);

  const loadInvoice = useCallback(async () => {
    if (!placement.invoice_id || invoiceDetail) return;
    setInvoiceLoading(true);
    setInvoiceLoadError('');
    try {
      const data = await apiFetch(`/api/billing/invoices/${placement.invoice_id}`);
      setInvoiceDetail(data);
    } catch (e) {
      setInvoiceLoadError(e.message || 'Invoice could not be loaded.');
    } finally {
      setInvoiceLoading(false);
    }
  }, [placement.invoice_id, invoiceDetail]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { if (['invoice', 'collection'].includes(tab)) loadInvoice(); }, [tab, loadInvoice]);

  const placementEvents = useMemo(() => derivePlacementEvents(events || [], placement.id), [events, placement.id]);
  const adjustments = useMemo(() => deriveAdjustments(placementEvents), [placementEvents]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[640px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900 truncate">{placement.candidate_first} {placement.candidate_last}</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">{placement.company_name} · {placement.job_title || 'No role on file'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 pt-3 flex gap-1 border-b border-neutral-100">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[12.5px] font-semibold px-3 py-2 border-b-2 -mb-px ${tab === t ? 'border-primary-500 text-primary-700' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'overview' && (
            <OverviewTab placement={placement} hasRequirement={hasRequirement} events={placementEvents} loading={eventsLoading} />
          )}
          {tab === 'economics' && <EconomicsTab placement={placement} />}
          {tab === 'invoice' && (
            <InvoiceTab
              placement={placement}
              canManageFinance={canManageFinance}
              invoiceDetail={invoiceDetail}
              invoiceLoading={invoiceLoading}
              invoiceLoadError={invoiceLoadError}
              onLinked={() => { setInvoiceDetail(null); onChanged(); toast.showSuccess('Invoice linked to placement.'); }}
            />
          )}
          {tab === 'collection' && (
            <CollectionTab invoiceDetail={invoiceDetail} invoiceLoading={invoiceLoading} invoiceLoadError={invoiceLoadError} hasInvoice={!!placement.invoice_id} />
          )}
          {tab === 'adjustments' && (
            <AdjustmentsTab
              placement={placement}
              hasRequirement={hasRequirement}
              adjustments={adjustments}
              loading={eventsLoading}
              canManageFinance={canManageFinance}
              onChanged={async () => { setEvents(null); await loadEvents(); onChanged(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ placement, hasRequirement, events, loading }) {
  const rows = [
    ['Status', <StatusBadge key="s" status={placement.status} />],
    ['Model', placement.placement_type],
    ['Currency', placement.currency || 'INR'],
    ['Start date', placement.contract_start_date ? new Date(placement.contract_start_date).toLocaleDateString() : '—'],
    ['End date', placement.contract_end_date ? new Date(placement.contract_end_date).toLocaleDateString() : '—'],
    ['Requirement', placement.requirement_id || '— (legacy placement)'],
    ['Submission', placement.submission_id || '—'],
    ['Offer', placement.offer_id || '—'],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">{label}</div>
            <div className="text-[13px] text-neutral-900 mt-0.5">{value}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <h3 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">Activity</h3>
        {!hasRequirement ? (
          <p className="text-[12px] text-neutral-500">This placement has no linked requirement, so activity history isn't available.</p>
        ) : loading ? (
          <p className="text-[12px] text-neutral-500">Loading activity…</p>
        ) : events.length === 0 ? (
          <p className="text-[12px] text-neutral-500">No placement activity recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {events.map((e) => (
              <div key={e.id} className="text-[11.5px] border-l-2 border-primary-200 pl-2 py-0.5">
                <b>{e.event_type.replaceAll('_', ' ')}</b> · {e.actor_name || 'System'} · {new Date(e.occurred_at).toLocaleString()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EconomicsTab({ placement }) {
  const isPermanent = placement.placement_type === 'permanent';
  return (
    <div className="space-y-4">
      <div className="card p-4 bg-primary-50/40 border-primary-200">
        <div className="text-[11px] text-neutral-500 uppercase">{isPermanent ? 'Permanent fee' : 'Contract margin'}</div>
        <div className="text-xl font-bold text-neutral-900 mt-1">{formatPlacementCommercial(placement)}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {isPermanent ? (
          <>
            <Field label="Fee amount" value={money(placement.perm_fee_amount, placement.currency)} />
            <Field label="Annual CTC" value={money(placement.perm_ctc_annual, placement.currency)} />
          </>
        ) : (
          <>
            <Field label="Bill rate / hr" value={money(placement.bill_rate_hourly, placement.currency)} />
            <Field label="Pay rate / hr" value={money(placement.pay_rate_hourly, placement.currency)} />
            <Field label="Margin / hr" value={money(placement.margin_hourly, placement.currency)} />
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">{label}</div>
      <div className="text-[13px] text-neutral-900 mt-0.5">{value}</div>
    </div>
  );
}

function InvoiceTab({ placement, canManageFinance, invoiceDetail, invoiceLoading, invoiceLoadError, onLinked }) {
  const [candidates, setCandidates] = useState(null);
  const [candidatesError, setCandidatesError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  const loadCandidates = async () => {
    setCandidatesError('');
    try {
      const data = await apiFetch('/api/billing/invoices');
      setCandidates(data.invoices || []);
    } catch (e) {
      setCandidatesError(e.message || 'Invoices could not be loaded.');
    }
  };

  useEffect(() => { if (!placement.invoice_id && candidates === null) loadCandidates(); }, [placement.invoice_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = (candidates || []).filter((inv) => !search
    || inv.invoice_number?.toLowerCase().includes(search.toLowerCase())
    || inv.client_name?.toLowerCase().includes(search.toLowerCase()));

  const link = async () => {
    if (!selectedId) return;
    setLinking(true);
    setLinkError('');
    try {
      const invoice = candidates.find((i) => i.id === selectedId);
      await apiFetch(`/api/wizmatch/staffing/placements/${placement.id}/link-invoice`, {
        method: 'POST',
        body: JSON.stringify({ invoiceId: selectedId, billingClientId: invoice?.client_id }),
      });
      onLinked();
    } catch (e) {
      setLinkError(e.message || 'Invoice could not be linked.');
    } finally {
      setLinking(false);
    }
  };

  if (placement.invoice_id) {
    if (invoiceLoading) return <p className="text-[12.5px] text-neutral-500">Loading invoice…</p>;
    if (invoiceLoadError) return <ErrorRetry message={invoiceLoadError} />;
    const inv = invoiceDetail?.invoice;
    return (
      <div className="space-y-2.5">
        <Field label="Invoice number" value={inv?.invoiceNumber || placement.invoice_id} />
        <Field label="Status" value={inv ? <StatusBadge status={inv.status} /> : '—'} />
        <Field label="Total amount" value={inv ? money(inv.totalAmount, invoiceDetail.client?.currency) : '—'} />
        <Field label="Amount due" value={inv ? money(inv.amountDue, invoiceDetail.client?.currency) : '—'} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-neutral-500">No invoice linked to this placement yet.</p>
      {!canManageFinance ? (
        <p className="text-[12px] text-warning-700">Linking an invoice requires the finance/admin role.</p>
      ) : candidatesError ? (
        <ErrorRetry message={candidatesError} onRetry={loadCandidates} />
      ) : candidates === null ? (
        <p className="text-[12px] text-neutral-500">Loading invoices…</p>
      ) : (
        <>
          <input placeholder="Search by invoice number or client…" value={search} onChange={(e) => setSearch(e.target.value)} className="input w-full" />
          <select aria-label="Matching invoices" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="input w-full" size={6}>
            {filtered.length === 0 && <option disabled>No matching invoices</option>}
            {filtered.map((inv) => (
              <option key={inv.id} value={inv.id}>{inv.invoice_number} · {inv.client_name} · {money(inv.total_amount)}</option>
            ))}
          </select>
          {linkError && <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{linkError}</div>}
          <button onClick={link} disabled={!selectedId || linking} className="btn-primary btn-compact disabled:opacity-50">
            {linking ? 'Linking…' : 'Link invoice'}
          </button>
        </>
      )}
    </div>
  );
}

function CollectionTab({ invoiceDetail, invoiceLoading, invoiceLoadError, hasInvoice }) {
  if (!hasInvoice) return <p className="text-[12.5px] text-neutral-500">Link an invoice first to see collections here.</p>;
  if (invoiceLoading) return <p className="text-[12.5px] text-neutral-500">Loading collections…</p>;
  if (invoiceLoadError) return <ErrorRetry message={invoiceLoadError} />;
  const payments = invoiceDetail?.payments || [];
  const inv = invoiceDetail?.invoice;
  const currencyCode = invoiceDetail?.client?.currency;
  if (payments.length === 0) return <EmptyState title="No payments recorded" description="No collections have been recorded against this invoice yet." />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Invoiced" value={money(inv?.totalAmount, currencyCode)} />
        <Field label="Collected" value={money(inv?.amountPaid, currencyCode)} />
      </div>
      <div className="space-y-1.5">
        {payments.map((p) => (
          <div key={p.id} className="flex justify-between text-[12.5px] border-b border-neutral-100 py-1.5">
            <span>{new Date(p.paymentDate).toLocaleDateString()} · {p.paymentMode || 'unknown'}</span>
            <span className="font-semibold">{money(p.amount, currencyCode)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdjustmentsTab({ placement, hasRequirement, adjustments, loading, canManageFinance, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'dispute', amount: '', currency: placement.currency || 'INR', reason: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [resolvingId, setResolvingId] = useState('');
  const [resolveDialogFor, setResolveDialogFor] = useState(null);
  const [resolveError, setResolveError] = useState('');

  const create = async () => {
    setCreating(true);
    setCreateError('');
    try {
      await apiFetch(`/api/wizmatch/staffing/placements/${placement.id}/adjustments`, {
        method: 'POST',
        body: JSON.stringify({ type: form.type, amount: Number(form.amount) || undefined, currency: form.currency, reason: form.reason }),
      });
      setShowForm(false);
      setForm({ type: 'dispute', amount: '', currency: placement.currency || 'INR', reason: '' });
      onChanged();
    } catch (e) {
      setCreateError(e.message || 'Adjustment could not be created.');
    } finally {
      setCreating(false);
    }
  };

  const resolve = async () => {
    setResolvingId(resolveDialogFor.id);
    setResolveError('');
    try {
      await apiFetch(`/api/wizmatch/staffing/adjustments/${resolveDialogFor.id}/resolve`, { method: 'POST' });
      setResolveDialogFor(null);
      onChanged();
    } catch (e) {
      setResolveError(e.message || 'Adjustment could not be resolved.');
    } finally {
      setResolvingId('');
    }
  };

  if (!hasRequirement) {
    return <p className="text-[12.5px] text-neutral-500">This placement has no linked requirement, so its adjustment history can't be reconstructed. New adjustments can still be created below.</p>;
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-[12px] text-neutral-500">Loading adjustments…</p>
      ) : adjustments.length === 0 ? (
        <EmptyState title="No adjustments" description="No disputes, replacements or refunds have been opened on this placement." />
      ) : (
        <div className="space-y-1.5">
          {adjustments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-[12.5px] border-b border-neutral-100 py-1.5">
              <div>
                <span className="font-semibold capitalize">{a.type}</span> · {money(a.amount, a.currency)} · {new Date(a.occurredAt).toLocaleDateString()}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={a.status} />
                {a.status === 'open' && canManageFinance && (
                  <button disabled={resolvingId === a.id} onClick={() => setResolveDialogFor(a)} className="text-[11.5px] font-semibold text-primary-700 hover:text-primary-800">
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManageFinance && (
        showForm ? (
          <div className="card p-3 space-y-2.5 border-primary-200">
            <div className="grid grid-cols-2 gap-2.5">
              <select aria-label="Adjustment type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
                {ADJUSTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" />
            </div>
            <input placeholder="Reason *" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="input w-full" />
            {createError && <div role="alert" className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{createError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} disabled={creating} className="btn-standard btn-compact">Cancel</button>
              <button onClick={create} disabled={creating || !form.reason.trim()} className="btn-primary btn-compact disabled:opacity-50">
                {creating ? 'Saving…' : 'Open adjustment'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowForm(true)} className="btn-standard btn-compact inline-flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> New adjustment
          </button>
        )
      )}

      <ConfirmDialog
        open={!!resolveDialogFor}
        title={resolveDialogFor ? `Resolve the ${resolveDialogFor.type} adjustment?` : ''}
        impactSummary="Marks this adjustment resolved. This is recorded in the placement's activity history and cannot be reversed from here."
        confirmLabel="Resolve"
        loading={!!resolvingId}
        error={resolveError}
        onCancel={() => { setResolveDialogFor(null); setResolveError(''); }}
        onConfirm={resolve}
      />
    </div>
  );
}
