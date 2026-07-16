import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { Button, Modal } from '../components/ui/index.js';
import {
  Lifecycle,
  MetricCard,
  StatePanel,
  WorkspaceHeader,
  candidateName,
  formatDate,
  formatMoney,
} from './wizmatch-ui/TalentDeliveryPrimitives.jsx';
import {
  DELIVERY_STAGES,
  deliveryLifecycleStage,
  placementMarginPercent,
  primaryDeliveryAction,
  validEmailOrBlank,
} from './wizmatch-ui/talentDeliveryWorkflow.js';

const STATUS_LABELS = {
  draft: 'Draft', approved: 'Approved', submitted: 'Sent', interviewing: 'Interviewing',
  offered: 'Offer', placed: 'Placed', rejected: 'Rejected', withdrawn: 'Withdrawn', closed: 'Closed',
};

export default function WizmatchDeliveryBoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedId = searchParams.get('submissionId');
  const requestedMatchId = searchParams.get('matchId');
  const [items, setItems] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [capabilities, setCapabilities] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [permissionError, setPermissionError] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null);
  const [shortlistedMatches, setShortlistedMatches] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setWarning('');
    setPermissionError(false);
    try {
      const access = await apiFetch('/api/wizmatch/staffing/access');
      const nextCapabilities = access.capabilities || {};
      setCapabilities(nextCapabilities);
      const [boardResult, metricsResult, recruiterWorkResult] = await Promise.allSettled([
        apiFetch('/api/wizmatch/staffing/delivery-board'),
        nextCapabilities.viewCommercial ? apiFetch('/api/wizmatch/staffing/analytics') : Promise.resolve(null),
        nextCapabilities.manageCandidateEvidence ? apiFetch('/api/wizmatch/staffing/recruiter-work') : Promise.resolve({ items: [] }),
      ]);
      if (boardResult.status === 'rejected') throw boardResult.reason;
      const board = boardResult.value;
      const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
      const recruiterWork = recruiterWorkResult.status === 'fulfilled' ? recruiterWorkResult.value : { items: [] };
      setItems(board.items || []);
      setAnalytics(metrics);
      const existingPairs = new Set((board.items || []).map((item) => `${item.candidate_id}|${item.requirement_id}`));
      setShortlistedMatches((recruiterWork.items || []).filter((match) => match.human_decision === 'shortlisted' && !existingPairs.has(`${match.candidate_id}|${match.requirement_id}`)));
      const unavailable = [];
      if (metricsResult.status === 'rejected') unavailable.push('commercial summary');
      if (recruiterWorkResult.status === 'rejected') unavailable.push('new shortlist queue');
      if (unavailable.length) setWarning(`Submissions are available, but the ${unavailable.join(' and ')} could not be loaded. Retry before relying on those sections.`);
    } catch (err) {
      setItems([]);
      setAnalytics(null);
      setShortlistedMatches([]);
      const message = err.message || 'Submissions could not be loaded.';
      setPermissionError(/permission|access|role|pilot|forbidden|requires/i.test(message));
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!loading && highlightedId) document.getElementById(`submission-${highlightedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedId, loading]);
  useEffect(() => {
    if (loading || !requestedMatchId || searchParams.get('action') !== 'consent' || dialog) return;
    const match = shortlistedMatches.find((item) => String(item.id) === requestedMatchId);
    if (match) setDialog({ action: 'consent', item: match });
  }, [dialog, loading, requestedMatchId, searchParams, shortlistedMatches]);

  const orderedItems = useMemo(() => {
    if (!highlightedId) return items;
    return [...items].sort((a, b) => Number(String(b.id) === highlightedId) - Number(String(a.id) === highlightedId));
  }, [highlightedId, items]);

  const performImmediate = async (item, action) => {
    setBusy(item.id);
    setError('');
    setNotice('');
    try {
      if (action === 'approve') await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/approve`, { method: 'POST' });
      if (action === 'accept') await apiFetch(`/api/wizmatch/staffing/offers/${item.latest_offer_id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'accepted' }) });
      setNotice(action === 'approve' ? 'Submission approved. Nothing was sent.' : 'Offer acceptance recorded.');
      await load();
    } catch (err) {
      setError(err.message || 'The delivery action could not be recorded.');
    } finally {
      setBusy('');
    }
  };

  const chooseAction = (item, action) => {
    if (['approve', 'accept'].includes(action)) performImmediate(item, action);
    else setDialog({ action, item });
  };

  const metrics = analytics?.commercial || {};
  const exceptions = analytics?.exceptions || {};

  return (
    <div className="min-h-full bg-neutral-50">
      <WorkspaceHeader
        eyebrow="Delivery"
        title="Submissions"
        description="A candidate-by-requirement record from consent through placement. Actions record real-world delivery; this page never sends automatically."
        actions={<button type="button" onClick={load} className="btn-standard"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}
      />
      <main className="space-y-5 p-4 sm:p-6">
        {shortlistedMatches.length > 0 && (
          <section className="card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><h2 className="text-sm font-semibold text-neutral-900">Shortlists ready for consent</h2><p className="mt-1 text-[12px] text-neutral-500">Start the Candidate × Requirement delivery record here. Consent remains exact to one requirement and nothing is sent automatically.</p></div>
              <span className="badge-info">{shortlistedMatches.length} ready</span>
            </div>
            <div className="mt-4 grid gap-2 lg:grid-cols-2">{shortlistedMatches.map((match) => <div key={match.id} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[12.5px] font-semibold text-neutral-900">{candidateName(match)}</p><p className="mt-0.5 text-[11.5px] text-neutral-500">{match.requirement_title}</p></div><button type="button" className="btn-primary btn-compact" onClick={() => setDialog({ action: 'consent', item: match })}>Record consent &amp; prepare draft</button></div>)}</div>
          </section>
        )}
        {capabilities.viewCommercial && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label="Starts" value={metrics.starts || 0} />
            <MetricCard label="Gross margin" value={formatMoney(metrics.gross_margin || 0)} />
            <MetricCard label="Invoiced" value={formatMoney(metrics.invoiced || 0)} />
            <MetricCard label="Collected" value={formatMoney(metrics.collected || 0)} />
            <MetricCard label="Avg. time to fill" value={analytics?.timeToFill?.average_days ? `${analytics.timeToFill.average_days} days` : '—'} />
          </div>
        )}
        {capabilities.viewCommercial && (
          <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-[12.5px] text-warning-800">
            <ShieldCheck className="mr-2 inline h-4 w-4" />{exceptions.overdue_submissions || 0} overdue · {exceptions.missing_next_action || 0} missing a dated next action
          </div>
        )}
        {notice && <div role="status" className="rounded-lg border border-success-200 bg-success-50 p-3 text-[12.5px] text-success-800">{notice}</div>}
        {warning && <div role="status" className="flex flex-col gap-3 rounded-lg border border-warning-200 bg-warning-50 p-3 text-[12.5px] text-warning-800 sm:flex-row sm:items-center sm:justify-between"><span>{warning}</span><button type="button" className="btn-standard btn-compact shrink-0" onClick={load}>Retry optional sections</button></div>}
        {error && <StatePanel state={permissionError ? 'permission' : 'error'} title={permissionError ? 'Delivery access unavailable' : 'Submissions unavailable'} description={error} onRetry={load} compact />}
        {!error && loading && <StatePanel state="loading" title="Loading submissions" description="Fetching consent, delivery and offer status." />}
        {!error && !loading && !orderedItems.length && !shortlistedMatches.length && <StatePanel title="No submission records yet" description="Shortlist a requirement-specific match in Candidates, then return here to record exact-requirement consent and prepare a draft." />}

        {!error && !loading && orderedItems.length > 0 && (
          <div className="space-y-3">
            {orderedItems.map((item) => {
              const action = primaryDeliveryAction(item, capabilities);
              const isHighlighted = String(item.id) === highlightedId;
              return (
                <article id={`submission-${item.id}`} key={item.id} className={`card overflow-hidden ${isHighlighted ? 'ring-2 ring-primary-300' : ''}`}>
                  <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-semibold text-neutral-900">{candidateName(item)}</h2>
                          <p className="truncate text-[12px] text-neutral-500">{item.requirement_title} · {item.company_name || 'Company not set'}</p>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <span className={item.consent_status === 'granted' ? 'badge-success' : 'badge-warning'}>Consent: {item.consent_status || 'not linked'}</span>
                          <span className="badge-info">{STATUS_LABELS[item.status] || item.status}</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto pb-1"><Lifecycle stages={DELIVERY_STAGES} current={deliveryLifecycleStage(item)} /></div>
                      <div className="grid gap-2 text-[11.5px] text-neutral-500 sm:grid-cols-3">
                        <p>{item.resend_count || 0} resend records</p>
                        <p>{item.interview_count || 0} interview rounds</p>
                        <p>Offer revision {item.offer_revision || '—'}</p>
                      </div>
                      <p className="text-[11.5px] text-neutral-500">Next: {item.next_action || 'No next action recorded'} {item.next_action_due_at ? `· ${formatDate(item.next_action_due_at, true)}` : ''}</p>
                    </div>
                    <div className="flex min-w-44 flex-col items-stretch gap-2">
                      {action ? (
                        <button type="button" className="btn-primary" disabled={busy === item.id} onClick={() => chooseAction(item, action.id)}>
                          {busy === item.id ? 'Saving…' : action.label} <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      ) : <span className="rounded-lg bg-neutral-50 p-3 text-center text-[11.5px] text-neutral-500">{item.status === 'draft' && item.consent_status !== 'granted' ? 'Valid exact-requirement consent is required before approval.' : 'No action available for your role or this stage.'}</span>}
                      {capabilities.approveSubmissions && !['placed', 'withdrawn', 'closed'].includes(item.status) && (
                        <button type="button" className="text-[11.5px] font-semibold text-danger-700 hover:underline" onClick={() => chooseAction(item, 'withdraw')}>Withdraw submission</button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
      {dialog && (
        <DeliveryActionModal
          dialog={dialog}
          onClose={() => { setDialog(null); if (requestedMatchId) setSearchParams({}); }}
          onComplete={async (message) => { setDialog(null); if (requestedMatchId) setSearchParams({}); setNotice(message); await load(); }}
        />
      )}
    </div>
  );
}

function DeliveryActionModal({ dialog, onClose, onComplete }) {
  const { action, item } = dialog;
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [consentFile, setConsentFile] = useState(null);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    recipientName: '', recipientEmail: '', nextActionDueAt: tomorrow,
    scheduledAt: '', roundType: 'client',
    interviewStatus: 'completed', feedback: '', outcome: '',
    amount: '', currency: 'INR', period: 'annual', startDate: today, expiresAt: '',
    model: 'permanent', loadedCost: '', endDate: '', marginExceptionReason: '',
    reason: '', consentConfirmed: false, consentExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  });

  const title = {
    consent: 'Record exact-requirement consent',
    sent: 'Record manual submission delivery', interview: 'Schedule interview', feedback: 'Record interview outcome', offer: 'Add offer revision',
    place: 'Create traceable placement', withdraw: 'Withdraw submission',
  }[action];

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    const amount = Number(form.amount || 0);
    const loadedCost = Number(form.loadedCost || 0);
    if (action === 'consent' && !form.consentConfirmed) { setFormError('Confirm that the candidate genuinely granted consent for this exact requirement.'); return; }
    if (action === 'consent' && !form.consentExpiresAt) { setFormError('Consent expiry is required.'); return; }
    if (action === 'sent' && !form.recipientName.trim()) { setFormError('A named client recipient is required.'); return; }
    if (action === 'sent' && !validEmailOrBlank(form.recipientEmail)) { setFormError('Enter a valid email or leave it blank.'); return; }
    if (action === 'interview' && !form.scheduledAt) { setFormError('Interview date and time are required.'); return; }
    if (action === 'feedback' && !form.feedback.trim()) { setFormError('Interview feedback is required.'); return; }
    if (['offer', 'place'].includes(action) && amount <= 0) { setFormError('Enter a positive amount.'); return; }
    if (action === 'place' && form.model === 'contract' && loadedCost <= 0) { setFormError('Contract loaded cost is required.'); return; }
    const margin = placementMarginPercent(amount, loadedCost);
    if (action === 'place' && form.model === 'contract' && margin < 20 && !form.marginExceptionReason.trim()) { setFormError(`Gross margin is ${margin.toFixed(1)}%. Record the approved exception reason.`); return; }
    if (action === 'withdraw' && !form.reason.trim()) { setFormError('A withdrawal reason is required.'); return; }

    setSaving(true);
    try {
      if (action === 'consent') {
        let documentReference = null;
        if (consentFile) {
          const upload = new FormData();
          upload.append('file', consentFile);
          documentReference = (await apiFetch('/api/wizmatch/staffing/consent-documents', { method: 'POST', body: upload })).reference;
        }
        await apiFetch('/api/wizmatch/staffing/consents', {
          method: 'POST',
          body: JSON.stringify({
            candidateId: item.candidate_id,
            requirementId: item.requirement_id,
            status: 'granted',
            consentType: 'rtr',
            documentReference,
            expiresAt: new Date(`${form.consentExpiresAt}T23:59:59`).toISOString(),
            terms: { recordedManually: true, evidence: documentReference ? 'private_document' : 'manual_confirmation' },
          }),
        });
        await apiFetch('/api/wizmatch/staffing/submissions', {
          method: 'POST',
          body: JSON.stringify({
            candidateId: item.candidate_id,
            requirementId: item.requirement_id,
            matchId: item.id,
            payload: { preparedFrom: 'submissions_workspace' },
            nextAction: 'Review and approve submission draft',
            nextActionDueAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
        });
      }
      if (action === 'sent') {
        await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/record-sent`, {
          method: 'POST', body: JSON.stringify({
            recipients: [{ name: form.recipientName.trim(), email: form.recipientEmail.trim() || null }],
            nextActionDueAt: form.nextActionDueAt ? new Date(form.nextActionDueAt).toISOString() : null,
          }),
        });
      }
      if (action === 'interview') {
        const scheduledAt = new Date(form.scheduledAt);
        await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/interviews`, {
          method: 'POST', body: JSON.stringify({
            roundType: form.roundType, scheduledAt: scheduledAt.toISOString(),
            nextAction: 'Collect interview feedback', nextActionDueAt: new Date(scheduledAt.getTime() + 7_200_000).toISOString(),
          }),
        });
      }
      if (action === 'feedback') {
        const interviewId = item.latest_interview_id || item.latestInterview?.id;
        await apiFetch(`/api/wizmatch/staffing/interviews/${interviewId}`, {
          method: 'PUT', body: JSON.stringify({
            status: form.interviewStatus,
            feedback: form.feedback.trim(),
            outcome: form.outcome.trim() || null,
            nextAction: form.interviewStatus === 'completed' ? 'Review interview outcome and offer decision' : 'Review interview exception',
            nextActionDueAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
        });
      }
      if (action === 'offer') {
        await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/offers`, {
          method: 'POST', body: JSON.stringify({
            amount, currency: form.currency, period: form.period, status: 'draft',
            startDate: form.startDate || null, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          }),
        });
      }
      if (action === 'place') {
        await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/placement`, {
          method: 'POST', body: JSON.stringify({
            offerId: item.latest_offer_id,
            model: form.model,
            originalAmount: amount,
            currency: form.currency,
            period: form.model === 'contract' ? 'hourly' : 'one_time',
            feeAmount: form.model === 'permanent' ? amount : null,
            billAmount: form.model === 'contract' ? amount : null,
            loadedCost: form.model === 'contract' ? loadedCost : null,
            payAmount: form.model === 'contract' ? loadedCost : null,
            startDate: form.startDate,
            endDate: form.endDate || null,
            marginExceptionReason: form.model === 'contract' && margin < 20 ? form.marginExceptionReason.trim() : null,
          }),
        });
      }
      if (action === 'withdraw') {
        await apiFetch(`/api/wizmatch/staffing/submissions/${item.id}/withdraw`, { method: 'POST', body: JSON.stringify({ reason: form.reason.trim() }) });
      }
      const message = {
        consent: 'Exact-requirement consent and a submission draft were recorded. Nothing was sent.',
        sent: 'Manual submission delivery recorded. No message was sent by Wizmatch.',
        interview: 'Interview round scheduled.', feedback: 'Interview outcome recorded.', offer: 'Offer revision recorded.',
        place: 'Traceable placement created from the accepted offer.', withdraw: 'Submission withdrawn with a recorded reason.',
      }[action];
      await onComplete(message);
    } catch (err) {
      const message = err.message || 'The delivery action could not be recorded.';
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={620}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={action === 'withdraw' ? 'danger' : 'primary'} type="submit" form="delivery-action-form" disabled={saving}>{saving ? 'Saving…' : action === 'withdraw' ? 'Withdraw' : 'Record action'}</Button></>}
    >
      <form id="delivery-action-form" className="space-y-4" onSubmit={submit}>
        <div className="rounded-lg bg-neutral-50 p-3"><p className="font-semibold text-neutral-800">{candidateName(item)}</p><p className="text-[12px] text-neutral-500">{item.requirement_title} · {item.company_name || 'Company linked through requirement'}</p></div>
        {formError && <div role="alert" className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700">{formError}</div>}
        {action === 'consent' && <><label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3"><input className="mt-1" type="checkbox" checked={form.consentConfirmed} onChange={(event) => field('consentConfirmed', event.target.checked)} /><span><strong className="block text-[12.5px] text-neutral-800">Consent genuinely received for this exact requirement</strong><span className="text-[11.5px] text-neutral-500">This manual record does not contact or submit the candidate.</span></span></label><Labeled label="Consent valid until"><input required className="input w-full" type="date" value={form.consentExpiresAt} onChange={(event) => field('consentExpiresAt', event.target.value)} /></Labeled><Labeled label="RTR / consent document (optional)"><input className="block w-full text-[12px]" type="file" accept=".pdf,.doc,.docx" onChange={(event) => setConsentFile(event.target.files?.[0] || null)} /><span className="input-help">Stored privately and opened only through a short-lived signed URL.</span></Labeled></>}
        {action === 'sent' && <><Labeled label="Named recipient"><input required className="input w-full" value={form.recipientName} onChange={(e) => field('recipientName', e.target.value)} /></Labeled><Labeled label="Recipient email (optional)"><input className="input w-full" type="email" value={form.recipientEmail} onChange={(e) => field('recipientEmail', e.target.value)} /></Labeled><Labeled label="Follow-up due"><input className="input w-full" type="datetime-local" value={form.nextActionDueAt} onChange={(e) => field('nextActionDueAt', e.target.value)} /></Labeled><p className="input-help">This records a manual send that happened outside Wizmatch. It does not send a message.</p></>}
        {action === 'interview' && <div className="grid gap-3 sm:grid-cols-2"><Labeled label="Interview date and time"><input required className="input w-full" type="datetime-local" value={form.scheduledAt} onChange={(e) => field('scheduledAt', e.target.value)} /></Labeled><Labeled label="Round type"><select className="input w-full" value={form.roundType} onChange={(e) => field('roundType', e.target.value)}><option value="client">Client</option><option value="technical">Technical</option><option value="hr">HR</option><option value="manager">Hiring manager</option></select></Labeled></div>}
        {action === 'feedback' && <><div className="grid gap-3 sm:grid-cols-2"><Labeled label="Round status"><select className="input w-full" value={form.interviewStatus} onChange={(e) => field('interviewStatus', e.target.value)}><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No show</option></select></Labeled><Labeled label="Outcome"><input className="input w-full" placeholder="Proceed, hold, reject…" value={form.outcome} onChange={(e) => field('outcome', e.target.value)} /></Labeled></div><Labeled label="Feedback"><textarea required className="input min-h-24 w-full" value={form.feedback} onChange={(e) => field('feedback', e.target.value)} /></Labeled></>}
        {action === 'offer' && <><div className="grid gap-3 sm:grid-cols-3"><Labeled label="Amount"><input required min="1" className="input w-full" type="number" value={form.amount} onChange={(e) => field('amount', e.target.value)} /></Labeled><Labeled label="Currency"><input className="input w-full" value={form.currency} onChange={(e) => field('currency', e.target.value.toUpperCase())} /></Labeled><Labeled label="Period"><select className="input w-full" value={form.period} onChange={(e) => field('period', e.target.value)}><option value="annual">Annual</option><option value="monthly">Monthly</option><option value="hourly">Hourly</option><option value="one_time">One time</option></select></Labeled></div><div className="grid gap-3 sm:grid-cols-2"><Labeled label="Start date"><input className="input w-full" type="date" value={form.startDate} onChange={(e) => field('startDate', e.target.value)} /></Labeled><Labeled label="Expires at"><input className="input w-full" type="datetime-local" value={form.expiresAt} onChange={(e) => field('expiresAt', e.target.value)} /></Labeled></div></>}
        {action === 'place' && <><div className="grid gap-3 sm:grid-cols-3"><Labeled label="Model"><select className="input w-full" value={form.model} onChange={(e) => field('model', e.target.value)}><option value="permanent">Permanent</option><option value="contract">Contract</option></select></Labeled><Labeled label={form.model === 'permanent' ? 'Permanent fee' : 'Bill rate'}><input required min="1" className="input w-full" type="number" value={form.amount} onChange={(e) => field('amount', e.target.value)} /></Labeled><Labeled label="Currency"><input className="input w-full" value={form.currency} onChange={(e) => field('currency', e.target.value.toUpperCase())} /></Labeled></div>{form.model === 'contract' && <><Labeled label="Loaded cost for same period"><input required min="1" className="input w-full" type="number" value={form.loadedCost} onChange={(e) => field('loadedCost', e.target.value)} /></Labeled>{form.amount && form.loadedCost && <p className="text-[12px] text-neutral-600">Calculated gross margin: {placementMarginPercent(form.amount, form.loadedCost).toFixed(1)}%</p>}{placementMarginPercent(form.amount, form.loadedCost) < 20 && <Labeled label="Approved margin exception reason"><textarea className="input min-h-20 w-full" value={form.marginExceptionReason} onChange={(e) => field('marginExceptionReason', e.target.value)} /></Labeled>}</>}<div className="grid gap-3 sm:grid-cols-2"><Labeled label="Start date"><input required className="input w-full" type="date" value={form.startDate} onChange={(e) => field('startDate', e.target.value)} /></Labeled>{form.model === 'contract' && <Labeled label="End date (optional)"><input className="input w-full" type="date" value={form.endDate} onChange={(e) => field('endDate', e.target.value)} /></Labeled>}</div></>}
        {action === 'withdraw' && <Labeled label="Withdrawal reason"><textarea required className="input min-h-24 w-full" value={form.reason} onChange={(e) => field('reason', e.target.value)} /></Labeled>}
      </form>
    </Modal>
  );
}

function Labeled({ label, children }) {
  return <label className="block"><span className="input-label">{label}</span>{children}</label>;
}
