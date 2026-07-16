import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import DialogShell from '../components/wizmatch/DialogShell.jsx';
import ConsentDialog from '../components/wizmatch/ConsentDialog.jsx';
import SubmissionDialog from '../components/wizmatch/SubmissionDialog.jsx';
import InterviewDialog from '../components/wizmatch/InterviewDialog.jsx';
import OfferDialog from '../components/wizmatch/OfferDialog.jsx';
import WithdrawCancelDialog from '../components/wizmatch/WithdrawCancelDialog.jsx';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';

const LABEL = { draft: 'Draft', approved: 'Approved', submitted: 'Submitted', interviewing: 'Interviewing', offered: 'Offered', placed: 'Placed', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const TERMINAL = ['placed', 'withdrawn', 'closed', 'rejected'];
const TERMINAL_OFFER_STATUSES = ['accepted', 'declined', 'withdrawn'];

const DELIVERY_EXPORT_COLUMNS = [
  { key: 'candidate', label: 'Candidate', exportValue: (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') },
  { key: 'requirement_title', label: 'Requirement' },
  { key: 'company_name', label: 'Company' },
  { key: 'consent_status', label: 'Consent' },
  { key: 'status', label: 'Status' },
  { key: 'resend_count', label: 'Resends', exportValue: (r) => r.resend_count || 0 },
  { key: 'interview_count', label: 'Interviews', exportValue: (r) => r.interview_count || 0 },
  { key: 'offer_status', label: 'Offer status', exportValue: (r) => r.offer_status || '' },
];

function candidateName(item) {
  return [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Unnamed candidate';
}

export default function WizmatchDeliveryBoardPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [capabilities, setCapabilities] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [timelines, setTimelines] = useState({}); // requirementId -> events[]
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [companyContactsByReq, setCompanyContactsByReq] = useState({}); // requirementId -> contacts[]

  const [dialog, setDialog] = useState(null); // { type, item, ...extra }
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const access = await apiFetch('/api/wizmatch/staffing/access');
      const caps = access.capabilities || {};
      setCapabilities(caps);
      const board = await apiFetch('/api/wizmatch/staffing/delivery-board');
      const metrics = caps.viewCommercial ? await apiFetch('/api/wizmatch/staffing/analytics') : null;
      setItems(board.items || []);
      setAnalytics(metrics);
    } catch (e) {
      setItems([]);
      setAnalytics(null);
      setError(e.message || 'Delivery board could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fetchTimeline = useCallback(async (requirementId) => {
    if (timelines[requirementId]) return timelines[requirementId];
    const data = await apiFetch(`/api/wizmatch/requirements/${requirementId}/timeline`);
    const events = data.items || [];
    setTimelines((prev) => ({ ...prev, [requirementId]: events }));
    return events;
  }, [timelines]);

  const fetchCompanyContacts = useCallback(async (requirementId) => {
    if (companyContactsByReq[requirementId]) return companyContactsByReq[requirementId];
    try {
      const detail = await apiFetch(`/api/wizmatch/staffing/requirements/${requirementId}`);
      const contacts = await apiFetch(`/api/wizmatch/companies/${detail.requirement.company_id}/contacts`);
      const list = contacts.items || [];
      setCompanyContactsByReq((prev) => ({ ...prev, [requirementId]: list }));
      return list;
    } catch {
      return [];
    }
  }, [companyContactsByReq]);

  function latestInterviewRoundId(item, events) {
    const relevant = (events || [])
      .filter((e) => String(e.submission_id) === String(item.id) && ['interview_scheduled', 'interview_updated'].includes(e.event_type))
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    return relevant[0]?.payload?.interviewRoundId || null;
  }

  async function toggleActivity(item) {
    if (expandedId === item.id) { setExpandedId(null); return; }
    setExpandedId(item.id);
    setTimelineLoading(true);
    try { await fetchTimeline(item.requirement_id); } catch { /* surfaced via empty panel */ } finally { setTimelineLoading(false); }
  }

  function closeDialog() { setDialog(null); setDialogError(''); }

  async function runDialog(action, successMessage) {
    setDialogLoading(true);
    setDialogError('');
    try {
      await action();
      closeDialog();
      toast.showSuccess(successMessage);
      await load();
    } catch (e) {
      setDialogError(e.message || 'Action could not be recorded.');
    } finally {
      setDialogLoading(false);
    }
  }

  async function openConsentDialog(item) {
    setDialogError('');
    setDialog({ type: 'consent', item });
  }

  async function openSubmissionDialog(item, resend) {
    setDialogError('');
    setDialog({ type: 'submission', item, resend, companyContacts: [] });
    const contacts = await fetchCompanyContacts(item.requirement_id);
    setDialog((d) => (d && d.type === 'submission' && d.item.id === item.id ? { ...d, companyContacts: contacts } : d));
  }

  async function openScheduleInterview(item) {
    setDialogError('');
    setDialog({ type: 'interview', mode: 'schedule', item });
  }

  async function openUpdateInterview(item) {
    setDialogError('');
    setTimelineLoading(true);
    try {
      const events = await fetchTimeline(item.requirement_id);
      const interviewId = latestInterviewRoundId(item, events);
      if (!interviewId) {
        setError('No interview round was found on file for this submission — schedule one first.');
        return;
      }
      setDialog({ type: 'interview', mode: 'update', item, interviewId });
    } finally {
      setTimelineLoading(false);
    }
  }

  function openOfferDialog(item) {
    setDialogError('');
    setDialog({ type: 'offer', item });
  }

  function openWithdraw(item, kind) {
    setDialogError('');
    setDialog({ type: 'withdraw', item, kind });
  }

  function openPlacementDialog(item) {
    setDialogError('');
    setDialog({ type: 'placement', item });
  }

  async function run(item, action) {
    setBusy(item.id);
    setError('');
    try {
      if (action === 'approve') {
        await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/approve`, { method: 'POST' });
        toast.showSuccess('Submission approved.');
      }
      if (action === 'presented') {
        await apiFetch(`/api/wizmatch/staffing/offers/${item.latest_offer_id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'presented' }) });
        toast.showSuccess('Offer marked presented.');
      }
      if (action === 'accept') {
        await apiFetch(`/api/wizmatch/staffing/offers/${item.latest_offer_id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'accepted' }) });
        toast.showSuccess('Offer marked accepted.');
      }
      await load();
    } catch (e) {
      setError(e.message || 'Delivery action could not be recorded.');
      toast.showError(e.message || 'Delivery action could not be recorded.');
    } finally {
      setBusy('');
    }
  }

  // Faceted from the loaded rows so status/consent options always match real
  // data (their enums vary by tenant/config). Filtering is client-side.
  const statusOptions = useMemo(() => [...new Set(items.map((i) => i.status).filter(Boolean))].sort().map((v) => ({ value: v, label: LABEL[v] || String(v).replaceAll('_', ' ') })), [items]);
  const consentOptions = useMemo(() => [...new Set(items.map((i) => i.consent_status).filter(Boolean))].sort().map((v) => ({ value: v, label: String(v).replaceAll('_', ' ') })), [items]);
  const deliveryFilters = useMemo(() => [
    { key: 'q', label: 'Search', type: 'search', placeholder: 'Candidate, requirement, company…', fields: ['first_name', 'last_name', 'requirement_title', 'company_name'] },
    { key: 'requirement', label: 'Requirement', type: 'search', placeholder: 'Requirement…', fields: ['requirement_title'] },
    { key: 'status', label: 'Status', type: 'multiselect', options: statusOptions },
    { key: 'consent_status', label: 'Consent', type: 'multiselect', options: consentOptions },
    { key: 'has_interview', label: 'Has interview', type: 'toggle', predicate: (r) => (r.interview_count || 0) > 0 },
    { key: 'has_offer', label: 'Has offer', type: 'toggle', predicate: (r) => Boolean(r.latest_offer_id) },
  ], [statusOptions, consentOptions]);
  const ctl = useTableControls({ pageId: 'wizmatch-delivery', spec: deliveryFilters, columns: undefined });
  const filtered = ctl.applyClient(items);

  const money = analytics?.commercial || {};
  const exceptions = analytics?.exceptions || {};

  return (
    <div className="p-6 space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Submissions & Delivery</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Consent → approval → manual delivery record → interview → offer → placement. This page never sends automatically.
          </p>
        </div>
        <button className="btn-standard btn-compact" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {capabilities.viewCommercial && (
        <>
          <div className="grid md:grid-cols-5 gap-3">
            {[
              ['Starts', money.starts || 0],
              ['Gross margin', money.gross_margin || 0],
              ['Invoiced', money.invoiced || 0],
              ['Collected', money.collected || 0],
              ['Avg. time to fill', analytics?.timeToFill?.average_days ? `${analytics.timeToFill.average_days} days` : '—'],
            ].map(([label, value]) => (
              <div className="card p-4" key={label}>
                <div className="text-[11px] text-neutral-500 uppercase">{label}</div>
                <div className="text-xl font-bold text-neutral-900 mt-1">{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-warning-200 bg-warning-50 p-3 text-[12.5px] text-warning-800">
            <ShieldCheck className="w-4 h-4 inline mr-2" />
            Exceptions: {exceptions.overdue_submissions || 0} overdue · {exceptions.missing_next_action || 0} missing next action.
          </div>
        </>
      )}

      {error && items.length > 0 && (
        <div role="alert" className="flex items-center justify-between gap-3 border border-danger-200 bg-danger-50 text-danger-700 rounded-md p-3 text-[12.5px]">
          <span>{error}</span>
          <button className="underline font-semibold" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center text-neutral-500">Loading delivery records…</div>
      ) : error && items.length === 0 ? (
        <ErrorRetry message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title="No submission drafts yet" description="Drafts are created from a shortlisted candidate match against a requirement." />
      ) : (
        <>
          <FilterBar
            spec={deliveryFilters}
            filters={ctl.filters}
            setFilter={ctl.setFilter}
            activeChips={ctl.activeChips}
            clearFilter={ctl.clearFilter}
            clearAll={ctl.clearAll}
            onExport={() => exportRowsToCsv(filtered, DELIVERY_EXPORT_COLUMNS, 'delivery.csv')}
            presets={ctl.presets}
            savePreset={ctl.savePreset}
            applyPreset={ctl.applyPreset}
            deletePreset={ctl.deletePreset}
          />
          <div className="card overflow-hidden">
          <table className="table-fluent">
            <thead>
              <tr>
                <th></th>
                <th>Candidate</th>
                <th>Requirement</th>
                <th>Consent</th>
                <th>Status</th>
                <th>Delivery evidence</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="7" className="px-4 py-8 text-center text-neutral-400">No submissions match these filters.</td></tr>
              ) : filtered.map((item) => {
                const consentGranted = item.consent_status === 'granted';
                const isTerminal = TERMINAL.includes(item.status);
                const isBusy = busy === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td className="w-8">
                        <button type="button" onClick={() => toggleActivity(item)} className="text-neutral-500 hover:text-neutral-600" aria-label="Toggle activity">
                          {expandedId === item.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="font-semibold">{candidateName(item)}</td>
                      <td>{item.requirement_title}<div className="text-[11px] text-neutral-500">{item.company_name}</div></td>
                      <td>{item.consent_status ? <StatusBadge status={item.consent_status} /> : <span className="badge-warning text-[11px]">not linked</span>}</td>
                      <td><StatusBadge status={item.status} label={LABEL[item.status]} /></td>
                      <td className="text-[11.5px]">{item.resend_count || 0} resends · {item.interview_count || 0} interviews · offer {item.offer_revision || '—'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {item.status === 'draft' && !consentGranted && capabilities.operateDelivery && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openConsentDialog(item)}>Consent</button>
                          )}
                          {item.status === 'draft' && consentGranted && capabilities.approveSubmissions && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => run(item, 'approve')}>Approve</button>
                          )}
                          {item.status === 'approved' && capabilities.approveSubmissions && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openSubmissionDialog(item, false)}>Record sent</button>
                          )}
                          {item.status === 'submitted' && capabilities.approveSubmissions && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openSubmissionDialog(item, true)}>Resend</button>
                          )}
                          {['submitted', 'interviewing'].includes(item.status) && capabilities.operateDelivery && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openScheduleInterview(item)}>Add interview</button>
                          )}
                          {item.status === 'interviewing' && item.interview_count > 0 && capabilities.operateDelivery && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openUpdateInterview(item)}>Update interview</button>
                          )}
                          {item.status === 'interviewing' && capabilities.manageOffers && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openOfferDialog(item)}>Add offer</button>
                          )}
                          {item.status === 'offered' && capabilities.manageOffers && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => openOfferDialog(item)}>Revise offer</button>
                          )}
                          {item.status === 'offered' && item.offer_status === 'draft' && capabilities.manageOffers && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => run(item, 'presented')}>Mark presented</button>
                          )}
                          {item.status === 'offered' && ['draft', 'presented'].includes(item.offer_status) && capabilities.manageOffers && (
                            <button disabled={isBusy} className="btn-standard btn-compact" onClick={() => run(item, 'accept')}>Record accepted</button>
                          )}
                          {item.status === 'offered' && item.latest_offer_id && !TERMINAL_OFFER_STATUSES.includes(item.offer_status) && capabilities.manageOffers && (
                            <button disabled={isBusy} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700" onClick={() => openWithdraw(item, 'offer-decline')}>Decline offer</button>
                          )}
                          {item.status === 'offered' && item.offer_status === 'accepted' && capabilities.manageFinance && (
                            <button disabled={isBusy} className="btn-primary btn-compact" onClick={() => openPlacementDialog(item)}>Create placement</button>
                          )}
                          {!isTerminal && capabilities.approveSubmissions && (
                            <button disabled={isBusy} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700" onClick={() => openWithdraw(item, 'submission')}>Withdraw</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr>
                        <td colSpan="7" className="bg-neutral-50 px-4 py-3">
                          <ActivityPanel item={item} loading={timelineLoading} events={timelines[item.requirement_id] || []} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      <ConsentDialog
        open={dialog?.type === 'consent'}
        candidateName={dialog?.item ? candidateName(dialog.item) : ''}
        requirementTitle={dialog?.item?.requirement_title}
        loading={dialogLoading}
        error={dialogError}
        onCancel={closeDialog}
        onSubmit={(payload) => runDialog(() => apiFetch('/api/wizmatch/staffing/consents', {
          method: 'POST',
          body: JSON.stringify({ candidateId: dialog.item.candidate_id, requirementId: dialog.item.requirement_id, ...payload }),
        }), 'Consent recorded.')}
      />

      <SubmissionDialog
        open={dialog?.type === 'submission'}
        resend={dialog?.resend}
        companyContacts={dialog?.companyContacts || []}
        loading={dialogLoading}
        error={dialogError}
        onCancel={closeDialog}
        onSubmit={(payload) => runDialog(() => apiFetch(`/api/wizmatch/staffing/submissions/${dialog.item.id}/record-sent`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }), dialog.resend ? 'Resend recorded.' : 'Submission recorded as sent.')}
      />

      <InterviewDialog
        open={dialog?.type === 'interview'}
        mode={dialog?.mode}
        loading={dialogLoading}
        error={dialogError}
        onCancel={closeDialog}
        onSubmit={(payload) => runDialog(() => (
          dialog.mode === 'schedule'
            ? apiFetch(`/api/wizmatch/staffing/submissions/${dialog.item.id}/interviews`, { method: 'POST', body: JSON.stringify(payload) })
            : apiFetch(`/api/wizmatch/staffing/interviews/${dialog.interviewId}`, { method: 'PUT', body: JSON.stringify(payload) })
        ), dialog?.mode === 'schedule' ? 'Interview scheduled.' : 'Interview updated.')}
      />

      <OfferDialog
        open={dialog?.type === 'offer'}
        revision={dialog?.item?.offer_revision ? dialog.item.offer_revision + 1 : null}
        loading={dialogLoading}
        error={dialogError}
        onCancel={closeDialog}
        onSubmit={(payload) => runDialog(() => apiFetch(`/api/wizmatch/staffing/submissions/${dialog.item.id}/offers`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }), 'Offer recorded.')}
      />

      <WithdrawCancelDialog
        open={dialog?.type === 'withdraw'}
        action={dialog?.kind === 'offer-decline' ? 'decline' : 'withdraw'}
        entityLabel={dialog?.kind === 'offer-decline' ? 'this offer' : 'this submission'}
        impactSummary={dialog?.kind === 'offer-decline'
          ? 'Marks the current offer declined. Note: the reason is shown here for the record but the offer-status endpoint does not currently persist a reason server-side.'
          : undefined}
        loading={dialogLoading}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={(reason) => runDialog(() => (
          dialog.kind === 'offer-decline'
            ? apiFetch(`/api/wizmatch/staffing/offers/${dialog.item.latest_offer_id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'declined', reason }) })
            : apiFetch(`/api/wizmatch/staffing/submissions/${dialog.item.id}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) })
        ), dialog.kind === 'offer-decline' ? 'Offer declined.' : 'Submission withdrawn.')}
      />

      <PlacementDialog
        open={dialog?.type === 'placement'}
        loading={dialogLoading}
        error={dialogError}
        onCancel={closeDialog}
        onSubmit={(payload) => runDialog(() => apiFetch(`/api/wizmatch/staffing/submissions/${dialog.item.id}/placement`, {
          method: 'POST',
          body: JSON.stringify({ offerId: dialog.item.latest_offer_id, ...payload }),
        }), 'Placement created.')}
      />
    </div>
  );
}

function ActivityPanel({ loading, events }) {
  if (loading) return <p className="text-[12px] text-neutral-500">Loading activity…</p>;
  if (!events.length) return <p className="text-[12px] text-neutral-500">No activity recorded yet.</p>;
  return (
    <div className="space-y-1.5 max-h-56 overflow-y-auto">
      {events.slice(0, 30).map((e) => (
        <div key={e.id} className="text-[11.5px] border-l-2 border-primary-200 pl-2 py-0.5">
          <b>{e.event_type.replaceAll('_', ' ')}</b> · {e.actor_name || 'System'} · {new Date(e.occurred_at).toLocaleString()}
          {e.payload?.reason && <div className="text-neutral-500">Reason: {e.payload.reason}</div>}
        </div>
      ))}
    </div>
  );
}

// Not one of the five named dialogs (Consent/Submission/Interview/Offer/WithdrawCancel) —
// placement creation needs its own economics fields and isn't a withdraw/cancel/reject
// action, so it doesn't fit any of those shapes. Built on the same DialogShell for
// visual/accessibility consistency instead of a native prompt() chain.
function PlacementDialog({ open, loading, error, onCancel, onSubmit }) {
  const [model, setModel] = useState('permanent');
  const [currency, setCurrency] = useState('INR');
  const [feeAmount, setFeeAmount] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [loadedCost, setLoadedCost] = useState('');
  const [marginExceptionReason, setMarginExceptionReason] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  const bill = Number(billAmount) || 0;
  const cost = Number(loadedCost) || 0;
  const marginPercent = bill > 0 ? ((bill - cost) / bill) * 100 : 0;
  const needsException = model === 'contract' && billAmount && loadedCost !== '' && marginPercent < 20;

  const canSubmit = !loading && (
    model === 'permanent'
      ? Number(feeAmount) > 0
      : Number(billAmount) > 0 && loadedCost !== '' && (!needsException || marginExceptionReason.trim())
  );

  const submit = () => {
    onSubmit({
      model,
      currency,
      startDate,
      feeAmount: model === 'permanent' ? Number(feeAmount) : undefined,
      billAmount: model === 'contract' ? Number(billAmount) : undefined,
      loadedCost: model === 'contract' ? Number(loadedCost) : undefined,
      payAmount: model === 'contract' ? Number(loadedCost) : undefined,
      originalAmount: model === 'permanent' ? Number(feeAmount) : Number(billAmount),
      period: model === 'contract' ? 'hourly' : 'one_time',
      marginExceptionReason: needsException ? marginExceptionReason.trim() : undefined,
    });
  };

  return (
    <DialogShell
      open={open}
      title="Create placement"
      error={error}
      loading={loading}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={loading} className="btn-standard">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : 'Create placement'}
          </button>
        </>
      }
    >
      {({ firstFieldRef }) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="placement-model" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Model</label>
              <select id="placement-model" ref={firstFieldRef} value={model} onChange={(e) => setModel(e.target.value)} className="input w-full mt-1">
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <div>
              <label htmlFor="placement-currency" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Currency</label>
              <select id="placement-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="input w-full mt-1">
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          {model === 'permanent' ? (
            <div>
              <label htmlFor="placement-fee-amount" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Permanent fee amount *</label>
              <input id="placement-fee-amount" type="number" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} className="input w-full mt-1" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="placement-bill-rate" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Bill rate *</label>
                  <input id="placement-bill-rate" type="number" value={billAmount} onChange={(e) => setBillAmount(e.target.value)} className="input w-full mt-1" />
                </div>
                <div>
                  <label htmlFor="placement-loaded-cost" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Loaded cost *</label>
                  <input id="placement-loaded-cost" type="number" value={loadedCost} onChange={(e) => setLoadedCost(e.target.value)} className="input w-full mt-1" />
                </div>
              </div>
              {billAmount && loadedCost !== '' && (
                <p className={`text-[11.5px] ${needsException ? 'text-danger-600' : 'text-neutral-500'}`}>
                  Gross margin: {marginPercent.toFixed(1)}%{needsException ? ' — below the 20% floor, an exception reason is required.' : ''}
                </p>
              )}
              {needsException && (
                <div>
                  <label htmlFor="placement-margin-exception" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Margin exception reason *</label>
                  <input id="placement-margin-exception" value={marginExceptionReason} onChange={(e) => setMarginExceptionReason(e.target.value)} className="input w-full mt-1" />
                </div>
              )}
            </>
          )}
          <div>
            <label htmlFor="placement-start-date" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Start date</label>
            <input id="placement-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input w-full mt-1" />
          </div>
        </>
      )}
    </DialogShell>
  );
}
