import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { Drawer } from '../components/ui/index.js';
import {
  EntityTabs,
  MetricCard,
  StatePanel,
  WorkspaceHeader,
  candidateName,
  formatDate,
  formatMoney,
} from './wizmatch-ui/TalentDeliveryPrimitives.jsx';

const VIEWS = [
  { value: 'active', label: 'Active starts' },
  { value: 'commercial', label: 'Commercial follow-up' },
  { value: 'history', label: 'History' },
];

function placementModel(item) {
  const value = String(item.economics?.model || item.model || item.placement_type || '').toLowerCase();
  return value.includes('contract') ? 'contract' : 'permanent';
}

function placementCommercial(item) {
  const currency = item.economics?.originalCurrency || item.currency || 'INR';
  if (placementModel(item) === 'permanent') {
    return `${formatMoney(item.economics?.originalAmount ?? item.fee_amount ?? item.perm_fee_amount ?? item.original_amount ?? 0, currency)} permanent fee`;
  }
  const margin = item.economics?.grossMarginAmount ?? item.gross_margin_amount ?? item.margin_hourly;
  const period = item.economics?.originalPeriod || item.period || 'hr';
  if (margin !== null && margin !== undefined) return `${formatMoney(margin, currency)}/${period} gross margin`;
  return `${formatMoney(item.economics?.billAmount ?? item.bill_amount ?? item.bill_rate_hourly ?? 0, currency)}/${period} bill rate`;
}

function placementNeedsCommercialFollowUp(item) {
  const invoiceId = item.invoice?.id || item.invoice_id;
  const collected = item.collections?.amount ?? item.collection_amount ?? item.collected_amount ?? 0;
  const invoiced = item.invoice?.totalAmount ?? item.invoice_total_amount ?? item.invoice_total ?? item.invoiced_amount ?? 0;
  const openAdjustments = item.open_adjustment_count ?? item.open_adjustments ?? 0;
  return !invoiceId || Number(collected) < Number(invoiced) || Number(openAdjustments) > 0;
}

function placementMatchesView(item, view) {
  const historical = ['ended', 'lost', 'cancelled', 'closed'].includes(String(item.status));
  if (view === 'history') return historical;
  if (historical) return false;
  if (view === 'commercial') return placementNeedsCommercialFollowUp(item);
  return String(item.status) === 'started';
}

function placementCandidateName(item) {
  return item.candidateName || candidateName({ first_name: item.candidate_first_name || item.candidate_first || item.first_name, last_name: item.candidate_last_name || item.candidate_last || item.last_name });
}

function placementId(item) { return item.placementId || item.id; }

export default function WizmatchPlacementsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view = VIEWS.some((item) => item.value === requestedView) ? requestedView : 'active';
  const selectedId = searchParams.get('placementId');
  const [placements, setPlacements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [legacyHistory, setLegacyHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLegacyHistory(false);
    try {
      try {
        const result = await apiFetch('/api/wizmatch/staffing/placements?limit=200');
        setPlacements(result.items || []);
      } catch (staffingError) {
        if (!/404|not found/i.test(staffingError.message || '')) throw staffingError;
        const legacy = await apiFetch('/api/wizmatch/placements?limit=200');
        setPlacements(legacy.items || []);
        setLegacyHistory(true);
      }
    } catch (err) {
      setPlacements([]);
      setError(err.message || 'Placements could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    return Object.fromEntries(VIEWS.map((item) => [item.value, placements.filter((placement) => placementMatchesView(placement, item.value)).length]));
  }, [placements]);
  const visible = useMemo(() => placements.filter((item) => placementMatchesView(item, view)), [placements, view]);
  const selected = placements.find((item) => String(placementId(item)) === String(selectedId));
  const totals = useMemo(() => ({
    starts: placements.filter((item) => String(item.status) === 'started').length,
    invoiced: placements.reduce((sum, item) => sum + Number(item.invoice?.totalAmount ?? item.invoice_total_amount ?? item.invoice_total ?? item.invoiced_amount ?? 0), 0),
    collected: placements.reduce((sum, item) => sum + Number(item.collections?.amount ?? item.collection_amount ?? item.collected_amount ?? 0), 0),
    openAdjustments: placements.reduce((sum, item) => sum + Number(item.open_adjustment_count ?? item.open_adjustments ?? 0), 0),
  }), [placements]);

  const changeView = (nextView) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set('view', nextView);
    next.delete('placementId');
    return next;
  });
  const selectPlacement = (id) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set('placementId', id);
    return next;
  });
  const closePlacement = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('placementId');
    return next;
  });

  return (
    <div className="min-h-full bg-neutral-50">
      <WorkspaceHeader
        eyebrow="Commercial close"
        title="Placements"
        description="Traceable starts created from accepted offers. Placement, invoice and collection remain separate records."
        actions={<><button type="button" className="btn-standard" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button><Link to="/wizmatch/submissions" className="btn-primary">Open submissions <ArrowRight className="h-3.5 w-3.5" /></Link></>}
      />
      <EntityTabs items={VIEWS.map((item) => ({ ...item, count: counts[item.value] }))} value={view} onChange={changeView} label="Placement views" />
      <main className="space-y-5 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Started" value={totals.starts} />
          <MetricCard label="Invoiced" value={formatMoney(totals.invoiced)} />
          <MetricCard label="Collected" value={formatMoney(totals.collected)} />
          <MetricCard label="Open adjustments" value={totals.openAdjustments} tone={totals.openAdjustments ? 'danger' : 'neutral'} />
        </div>
        {legacyHistory && (
          <div role="status" className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-[12.5px] text-warning-800">
            <ShieldCheck className="mr-2 inline h-4 w-4" /><strong>Legacy history:</strong> trace links are unavailable on this compatibility API. Records are read-only; create and advance placements only through Submissions.
          </div>
        )}
        {error && <StatePanel state="error" title="Placements unavailable" description={error} onRetry={load} compact />}
        {!error && loading && <StatePanel state="loading" title="Loading placements" description="Fetching placement, submission and finance trace links." />}
        {!error && !loading && !visible.length && <StatePanel title={`No ${VIEWS.find((item) => item.value === view)?.label.toLowerCase()}`} description="Placements appear here only after an accepted offer is converted from Submissions." />}
        {!error && !loading && visible.length > 0 && (
          <div className="grid gap-3 xl:grid-cols-2">
            {visible.map((item) => (
              <button key={placementId(item)} type="button" onClick={() => selectPlacement(placementId(item))} className="card card-hover p-4 text-left focus:outline-none focus:ring-2 focus:ring-primary-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-neutral-900">{placementCandidateName(item)}</p><p className="mt-0.5 truncate text-[12px] text-neutral-500">{item.requirement_title || item.job_title || 'Requirement not linked'} · {item.company_name || 'Company not linked'}</p></div>
                  <span className={String(item.status) === 'started' ? 'badge-success' : 'badge-muted'}>{String(item.status || 'unknown').replaceAll('_', ' ')}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3"><Small label="Model" value={placementModel(item)} /><Small label="Commercial" value={placementCommercial(item)} /><Small label="Started" value={formatDate(item.start_date || item.contract_start_date || item.created_at)} /></div>
                <div className="mt-4 flex items-center justify-between text-[11.5px] text-neutral-500"><span>{item.invoice?.id || item.invoice_id ? 'Invoice linked' : 'Invoice not linked'} · {Number(item.collections?.amount ?? item.collection_amount ?? item.collected_amount ?? 0) > 0 ? 'Collection recorded' : 'No collection recorded'}</span><span className="inline-flex items-center gap-1 font-semibold text-primary-700">View trace <ArrowRight className="h-3.5 w-3.5" /></span></div>
              </button>
            ))}
          </div>
        )}
      </main>

      {selectedId && (
        <Drawer open onClose={closePlacement} title={selected ? placementCandidateName(selected) : 'Placement not found'} subtitle="Placement trace" wide>
            <div className="space-y-4">
              {!selected ? <StatePanel state="error" title="Placement not found" description="It may be outside the current result set. Refresh and try again." onRetry={load} /> : <>
                <section className="card p-4"><h3 className="text-sm font-semibold text-neutral-900">Origin</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Small label="Company" value={selected.company_name} /><Small label="Requirement" value={selected.requirement_title || selected.job_title} /><Small label="Submission" value={selected.submissionId || selected.submission_id || 'Legacy record'} /><Small label="Accepted offer" value={selected.linked_offer_id || selected.offer_id || 'Legacy record'} /></div></section>
                <section className="card p-4"><h3 className="text-sm font-semibold text-neutral-900">Economics</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><Small label="Model" value={placementModel(selected)} /><Small label="Original economics" value={placementCommercial(selected)} /><Small label="Invoice" value={selected.invoice?.number || selected.invoice?.id || selected.invoice_id || 'Not linked'} /><Small label="Collected" value={formatMoney(selected.collections?.amount ?? selected.collection_amount ?? selected.collected_amount ?? 0, selected.economics?.originalCurrency || selected.currency || 'INR')} /></div></section>
                <section className="card p-4"><h3 className="text-sm font-semibold text-neutral-900">Adjustments</h3><p className="mt-2 text-[12.5px] text-neutral-500">{Number(selected.open_adjustment_count ?? selected.open_adjustments ?? 0)} open · {Math.max(0, Number(selected.adjustment_count || 0) - Number(selected.open_adjustment_count ?? selected.open_adjustments ?? 0))} resolved. Disputes, replacements and refunds are retained as separate traceable records.</p></section>
                {(selected.submissionId || selected.submission_id) && <Link to={`/wizmatch/submissions?submissionId=${encodeURIComponent(selected.submissionId || selected.submission_id)}`} className="btn-primary w-full">Open source submission <ArrowRight className="h-3.5 w-3.5" /></Link>}
              </>}
            </div>
        </Drawer>
      )}
    </div>
  );
}

function Small({ label, value }) {
  return <div className="min-w-0 rounded-lg bg-neutral-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p><p className="mt-1 truncate text-[12px] font-semibold capitalize text-neutral-800">{value || '—'}</p></div>;
}
