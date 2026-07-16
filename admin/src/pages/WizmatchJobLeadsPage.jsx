import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, Clock3, ExternalLink, RefreshCw, Search, UserSearch, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { Button, DataTable, Input, Modal } from '../components/ui/index.js';
import { DataState, EntityHeader, NextActionPanel, StageStepper, StatusBadge, WorkspacePage, humanize } from '../components/wizmatch/WorkspaceUI.jsx';

const JOB_LEAD_STEPS = [
  { id: 'validate', label: 'Validate demand' },
  { id: 'qualify', label: 'Qualify' },
  { id: 'poc', label: 'Find POC' },
  { id: 'coordinate', label: 'Record coordination' },
  { id: 'requirement', label: 'Create draft role' },
];

function signalStep(signal) {
  if (signal.linked_requirement?.id || signal.linked_requirement_id || signal.source_job_requirement_id || signal.requirement_id || signal.status === 'drafted') return 'requirement';
  if (signal.contact_id || signal.poc_state === 'verified') return 'coordinate';
  if (signal.poc_state || signal.qualification?.qualified) return 'poc';
  if (['scored', 'enriched', 'matched'].includes(signal.status)) return 'qualify';
  return 'validate';
}

function formatDate(value, fallback = 'Not recorded') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export default function WizmatchJobLeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('signalId') || '';
  const [signals, setSignals] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [sourcing, setSourcing] = useState(null);
  const [filters, setFilters] = useState({ search: '', source: '', status: '' });

  const loadSignals = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filters.source) params.set('source', filters.source);
      if (filters.status) params.set('status', filters.status);
      const data = await apiFetch(`/api/wizmatch/signals?${params}`);
      const query = filters.search.trim().toLowerCase();
      const items = query ? (data.items || []).filter(signal => `${signal.job_title} ${signal.company_name || ''} ${signal.location || ''} ${(signal.keywords || []).join(' ')}`.toLowerCase().includes(query)) : data.items || [];
      setSignals(items); setTotal(data.total || items.length);
    } catch (requestError) {
      setSignals([]); setTotal(0); setError(requestError.message || 'Job leads could not be loaded.');
    } finally { setLoading(false); }
  }, [filters]);

  const loadSourcing = useCallback(async () => {
    try { setSourcing(await apiFetch('/api/wizmatch/sourcing/status')); }
    catch { setSourcing(null); }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); setDetailError(''); return; }
    setDetailLoading(true); setDetailError('');
    try { setDetail(await apiFetch(`/api/wizmatch/signals/${selectedId}`)); }
    catch (requestError) { setDetail(null); setDetailError(requestError.message || 'Job-lead details could not be loaded.'); }
    finally { setDetailLoading(false); }
  }, [selectedId]);

  useEffect(() => { const timer = window.setTimeout(loadSignals, 250); return () => window.clearTimeout(timer); }, [loadSignals]);
  useEffect(() => { loadSourcing(); }, [loadSourcing]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  if (selectedId) {
    return <WorkspacePage eyebrow="Job Leads" title="Job Lead Review" description="Validate demand, verify the hiring person and convert only a workable signal into a draft role." actions={<Button onClick={() => setSearchParams({})} icon={<ArrowLeft />}>All job leads</Button>}>
      <DataState loading={detailLoading && !detail} error={detailError} onRetry={loadDetail} empty={!detail} emptyTitle="Job lead not found">
        {detail && <JobLeadDetail signal={detail} sourcing={sourcing} onRefresh={() => Promise.all([loadDetail(), loadSignals(), loadSourcing()])} />}
      </DataState>
    </WorkspacePage>;
  }

  const providerHealth = ['theirstack', 'ats'].map(provider => {
    const latest = sourcing?.latestRuns?.find(run => run.provider === provider);
    const configured = provider === 'theirstack' ? sourcing?.providerAccounts?.theirstack?.configured : true;
    const enabled = provider === 'theirstack' ? sourcing?.config?.theirstackEnabled : sourcing?.config?.atsEnabled;
    return { provider, latest, configured, enabled };
  });

  return <WorkspacePage eyebrow="Demand" title="Job Leads" description="TheirStack and approved ATS postings enter here as evidence. A job lead is not a client requirement until a person reviews and promotes it." actions={<Button onClick={() => { loadSignals(); loadSourcing(); }} icon={<RefreshCw />}>Refresh</Button>}>
    <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Sourcing health">
      <div><p className="font-semibold text-neutral-900">Source health</p><p className="text-sm text-neutral-600">Provider controls and run history are under More → System.</p></div>
      <div className="flex flex-wrap gap-2">{providerHealth.map(item => <StatusBadge key={item.provider} status={item.enabled && item.latest?.status !== 'failed' ? 'verified' : item.configured ? 'watch' : 'blocked'} label={`${item.provider === 'theirstack' ? 'TheirStack' : 'ATS'}: ${item.enabled ? item.latest?.status || 'ready' : 'off'}`} />)}</div>
    </section>
    <div className="card grid gap-3 p-4 lg:grid-cols-[minmax(240px,1fr)_180px_180px]">
      <Input label="Search job leads" value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} placeholder="Role, company, location or skill" />
      <SelectField label="Source" value={filters.source} onChange={value => setFilters(current => ({ ...current, source: value }))} options={[["", "Any source"], ["theirstack", "TheirStack"], ["ats", "ATS"], ["manual", "Manual"]]} />
      <SelectField label="Status" value={filters.status} onChange={value => setFilters(current => ({ ...current, status: value }))} options={[["", "Any status"], ["new", "New"], ["scored", "Scored"], ["qualified", "Qualified"], ["drafted", "Draft role created"], ["dead", "Rejected"]]} />
    </div>
    <p className="text-sm text-neutral-600">Showing {signals.length} of {total} job leads</p>
    <DataState loading={loading} error={error} onRetry={loadSignals} empty={!signals.length} emptyTitle="No job leads match these filters" emptyDescription="A successful source run will place evidence here for human qualification.">
      <div className="hidden md:block"><DataTable tableLabel="Job leads" rows={signals} onRowClick={signal => setSearchParams({ signalId: signal.id })} columns={[
        { key: 'job_title', label: 'Demand evidence', render: signal => <div><p className="font-semibold text-neutral-900">{signal.job_title}</p><p className="text-xs text-neutral-600">{signal.location || 'Location missing'} · {humanize(signal.employment_type)}</p></div> },
        { key: 'company_name', label: 'Company', render: signal => <div><p className="font-medium text-neutral-900">{signal.company_name || 'Company unresolved'}</p><p className="text-xs text-neutral-600">{signal.company_domain || 'Domain missing'}</p></div> },
        { key: 'score', label: 'Evidence score', render: signal => <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-neutral-900 font-bold text-white">{signal.score ?? '—'}</span> },
        { key: 'source', label: 'Source', render: signal => humanize(signal.source) },
        { key: 'status', label: 'Review state', render: signal => <StatusBadge status={signal.status || 'new'} /> },
        { key: 'next', label: 'Next action', render: signal => <span className="font-medium text-primary-700">{humanize(signalStep(signal))}</span> },
      ]} /></div>
      <div className="grid gap-3 md:hidden">{signals.map(signal => <button type="button" key={signal.id} onClick={() => setSearchParams({ signalId: signal.id })} className="card p-4 text-left focus:outline-none focus:ring-2 focus:ring-primary-400"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{signal.job_title}</p><p className="mt-1 text-sm text-neutral-600">{signal.company_name || 'Company unresolved'}</p></div><StatusBadge status={signal.status || 'new'} /></div><p className="mt-3 text-sm text-neutral-700">Next: {humanize(signalStep(signal))}</p></button>)}</div>
    </DataState>
  </WorkspacePage>;
}

function SelectField({ label, value, onChange, options }) {
  const id = `job-lead-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return <div><label className="mb-1 block text-[13px] font-semibold text-neutral-700" htmlFor={id}>{label}</label><select id={id} className="h-9 w-full rounded-sm border border-neutral-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200" value={value} onChange={event => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue || 'all'} value={optionValue}>{optionLabel}</option>)}</select></div>;
}

function JobLeadDetail({ signal, sourcing, onRefresh }) {
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [pocResult, setPocResult] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [retryAt, setRetryAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!retryAt) return undefined; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [retryAt]);
  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const run = async (name, path, body) => {
    setBusy(name); setFeedback(null);
    try {
      const result = await apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      if (name === 'poc') setPocResult(result);
      if (name === 'promote') setFeedback({ kind: 'success', message: result.created ? 'Draft role created. Complete attribution and intake from Requirement 360.' : 'This signal already has a draft role; the existing record was returned.' });
      else if (name !== 'poc') setFeedback({ kind: 'success', message: `${humanize(name)} completed.` });
      await onRefresh(); return result;
    } catch (requestError) {
      const seconds = Number(requestError.retryAfterSeconds || requestError.retry_after_seconds || 0);
      if (seconds > 0) setRetryAt(Date.now() + seconds * 1000);
      setFeedback({ kind: 'error', message: requestError.message || `${humanize(name)} failed.`, retryable: requestError.retryable !== false });
      return null;
    } finally { setBusy(''); }
  };
  const current = signalStep(signal);
  const qualified = Boolean(signal.qualified || signal.qualification?.qualified || ['drafted'].includes(signal.status) || pocResult);
  const hasExistingPoc = Boolean(signal.contact_id || signal.contact_first_name);
  const persistedPocs = signal.poc_candidates || signal.pocCandidates || [];
  const visiblePocs = (pocResult?.candidates || persistedPocs).slice(0, 3);
  const pocState = pocResult?.state || signal.poc_state || persistedPocs[0]?.state || (hasExistingPoc ? 'verified' : 'pending_research');
  const requirementId = signal.linked_requirement?.id || signal.linked_requirement_id || signal.requirement_id || signal.source_job_requirement_id || pocResult?.requirement?.id;
  const primaryAction = !qualified
    ? { title: 'Qualify or reject this demand signal', description: 'Confirm that the title and description contain real staffing demand before spending POC-research effort.', action: <Button variant="primary" disabled={Boolean(busy)} onClick={() => run('qualify', `/api/wizmatch/signals/${signal.id}/qualify`)}>Qualify signal</Button> }
    : !hasExistingPoc && !pocResult && !persistedPocs.length
      ? { title: 'Find the main hiring POC', description: 'Wizmatch checks existing CRM relationships and the company website first, then one capped 15-second public search if required.', action: <Button variant="primary" disabled={Boolean(busy) || !sourcing?.config?.pocDiscoveryEnabled || retrySeconds > 0} onClick={() => run('poc', `/api/wizmatch/signals/${signal.id}/discover-poc`)}>{busy === 'poc' ? 'Researching…' : retrySeconds ? `Retry in ${retrySeconds}s` : 'Find up to 3 POCs'}</Button> }
      : requirementId || signal.status === 'drafted'
        ? { title: 'Complete the draft requirement intake', description: 'Add the genuine source contact, owner, recruiter, SLA, next action and canonical skills before acceptance.', action: requirementId ? <Link className="btn-primary" to={`/wizmatch/roles?requirementId=${requirementId}`}>Open draft role</Link> : <Link className="btn-primary" to="/wizmatch/roles">Open roles</Link> }
        : { title: 'Convert this reviewed lead to a draft role', description: 'Promotion is idempotent and creates a draft only. It never accepts the requirement automatically.', action: <Button variant="primary" disabled={Boolean(busy)} onClick={() => run('promote', `/api/wizmatch/signals/${signal.id}/promote-to-requirement`)}>Create draft role</Button> };

  return <div className="space-y-4">
    <EntityHeader trail={[{ label: 'Job Leads', to: '/wizmatch/job-leads' }, { label: signal.company_name || 'Company' }, { label: signal.job_title }]} title={signal.job_title} subtitle={`${signal.company_name || 'Company unresolved'} · ${signal.location || 'Location missing'} · ${humanize(signal.source)}`} status={signal.status || 'new'} metadata={[
      { label: 'Evidence score', value: signal.score ?? 'Not scored' }, { label: 'Posted / discovered', value: formatDate(signal.posted_at || signal.created_at) }, { label: 'POC readiness', value: humanize(pocState) }, { label: 'Owner / next action', value: signal.owner_name || 'Review owner not recorded' },
    ]} action={signal.job_url ? <a className="btn-standard" href={signal.job_url} target="_blank" rel="noreferrer">Open source <ExternalLink className="ml-1 inline h-4 w-4" /></a> : undefined} />
    <StageStepper stages={JOB_LEAD_STEPS} current={current} />
    <NextActionPanel {...primaryAction} blocked={!qualified || (!hasExistingPoc && !pocResult && !persistedPocs.length)} />
    {feedback && <div role={feedback.kind === 'error' ? 'alert' : 'status'} className={`rounded-md border p-4 text-sm ${feedback.kind === 'error' ? 'border-danger-500/30 bg-red-50 text-danger-600' : 'border-success-500/30 bg-green-50 text-neutral-800'}`}><p>{feedback.message}</p>{feedback.kind === 'error' && feedback.retryable && <Button className="mt-3" size="compact" disabled={retrySeconds > 0 || Boolean(busy)} onClick={onRefresh}>{retrySeconds ? `Retry available in ${retrySeconds}s` : 'Reload and retry'}</Button>}</div>}
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="card p-5"><h3 className="font-semibold text-neutral-900">Demand evidence</h3><p className="mt-1 text-sm text-neutral-600">Validate the role from title and description—not company-name vocabulary.</p><div className="mt-4 whitespace-pre-wrap break-words rounded-md bg-neutral-50 p-4 text-sm leading-6 text-neutral-800">{signal.raw_text || signal.description || 'No description evidence was retained for this signal.'}</div>{signal.keywords?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{signal.keywords.map(keyword => <StatusBadge key={keyword} status="new" label={keyword} />)}</div>}</section>
      <div className="space-y-4"><section className="card p-5"><h3 className="font-semibold text-neutral-900">POC readiness</h3><div className="mt-4 flex items-center gap-3">{pocState === 'verified' ? <CheckCircle2 className="h-6 w-6 text-success-700" /> : <UserSearch className="h-6 w-6 text-warning-700" />}<div><p className="font-medium text-neutral-900">{humanize(pocState)}</p><p className="text-sm text-neutral-600">{hasExistingPoc ? `${signal.contact_first_name || ''} ${signal.contact_last_name || ''}`.trim() : `${pocResult?.candidatesFound ?? visiblePocs.length} public candidates found`}</p></div></div>{visiblePocs.length > 0 && <div className="mt-4 space-y-3">{visiblePocs.map((candidate, index) => { const profileUrl = candidate.profileUrl || candidate.profile_url || candidate.sourceUrl || candidate.source_url; return <div key={`${profileUrl || candidate.name}-${index}`} className="rounded-md bg-neutral-50 p-3"><p className="font-medium text-neutral-900">{candidate.name}</p><p className="mt-1 text-xs text-neutral-600">{candidate.title || humanize(candidate.roleCategory || candidate.role_category)} · {humanize(candidate.state)}</p>{profileUrl && <a className="mt-2 inline-block text-xs font-semibold text-primary-700" href={profileUrl} target="_blank" rel="noreferrer">Review public evidence</a>}</div>; })}</div>}<div className="mt-4 flex flex-wrap gap-2">{signal.company_id && <Link className="btn-standard" to={`/wizmatch/companies?companyId=${signal.company_id}`}>Open Company 360</Link>}<Link className="btn-standard" to="/wizmatch/hiring-contacts">Review hiring contacts</Link></div></section>
      <section className="card p-5"><h3 className="font-semibold text-neutral-900">Review decision</h3><div className="mt-4 flex flex-wrap gap-2"><Button disabled={Boolean(busy) || qualified} variant="primary" onClick={() => run('qualify', `/api/wizmatch/signals/${signal.id}/qualify`)} icon={<CheckCircle2 />}>Qualify</Button><Button disabled={Boolean(busy) || signal.status === 'dead'} onClick={() => setRejectOpen(true)} icon={<XCircle />}>Reject with reason</Button></div><p className="mt-3 text-xs text-neutral-600">Neither action sends outreach or creates an accepted requirement.</p></section></div>
    </div>
    <RejectSignalModal open={rejectOpen} onClose={() => setRejectOpen(false)} onReject={async reason => { const result = await run('reject', `/api/wizmatch/signals/${signal.id}/reject`, { reason }); if (result) setRejectOpen(false); }} saving={busy === 'reject'} />
  </div>;
}

function RejectSignalModal({ open, onClose, onReject, saving }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return <Modal open={open} onClose={onClose} title="Reject this job lead" description="The source evidence remains in history; the reason explains why the team will not work it." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={saving || !reason.trim()} onClick={() => onReject(reason)}>{saving ? 'Rejecting…' : 'Reject lead'}</Button></>}><Input label="Reason" required value={reason} onChange={event => setReason(event.target.value)} placeholder="For example: no technical staffing demand in the posting" /></Modal>;
}
