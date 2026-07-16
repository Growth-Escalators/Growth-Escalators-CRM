import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import {
  MetricCard,
  StatePanel,
  WorkspaceHeader,
  formatMoney,
} from './wizmatch-ui/TalentDeliveryPrimitives.jsx';

const FUNNEL_ORDER = ['draft', 'approved', 'submitted', 'interviewing', 'offered', 'placed', 'withdrawn'];
const FUNNEL_LABELS = { draft: 'Drafts', approved: 'Approved', submitted: 'Sent', interviewing: 'Interviews', offered: 'Offers', placed: 'Starts', withdrawn: 'Withdrawn' };
const ACQUISITION_LABELS = {
  job_leads: 'Job leads', poc_ready: 'POC ready', requirements: 'Requirements', matches: 'Matches', shortlists: 'Shortlists',
};
const EMPTY_FILTERS = { from: '', to: '', companyId: '', recruiterId: '', skillId: '', source: '' };

export default function WizmatchAnalyticsPage() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permissionError, setPermissionError] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setPermissionError(false);
    try {
      const access = await apiFetch('/api/wizmatch/staffing/access');
      if (!access.capabilities?.viewCommercial) throw new Error('Commercial reports require a team-lead or admin role.');
      const params = new URLSearchParams();
      Object.entries(appliedFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
      setAnalytics(await apiFetch(`/api/wizmatch/staffing/analytics${params.size ? `?${params}` : ''}`));
    } catch (err) {
      setAnalytics(null);
      const message = err.message || 'Staffing reports could not be loaded.';
      setPermissionError(/permission|access|role|requires/i.test(message));
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => { load(); }, [load]);

  const funnel = useMemo(() => {
    const byStatus = new Map((analytics?.funnel || []).map((item) => [item.status, Number(item.count || 0)]));
    return FUNNEL_ORDER.map((status) => ({ status, label: FUNNEL_LABELS[status], count: byStatus.get(status) || 0 }));
  }, [analytics]);
  const acquisitionFunnel = (analytics?.acquisitionFunnel || []).map((item) => ({
    ...item,
    label: ACQUISITION_LABELS[item.stage] || item.stage,
    count: Number(item.count || 0),
  }));
  const completeFunnel = [
    ...acquisitionFunnel,
    ...funnel.filter((item) => !['withdrawn'].includes(item.status)).map((item) => ({ ...item, stage: item.status })),
  ];
  const maxCompleteFunnel = Math.max(1, ...completeFunnel.map((item) => item.count));
  const commercial = analytics?.commercial || {};
  const exceptions = analytics?.exceptions || {};

  return (
    <div className="min-h-full bg-neutral-50">
      <WorkspaceHeader
        eyebrow="Management"
        title="Staffing reports"
        description="Delivery conversion, SLA, revenue, collection and margin from traceable staffing records. Outreach and domain-health metrics are intentionally excluded."
        actions={<button type="button" className="btn-standard" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}
      />
      <main className="space-y-5 p-4 sm:p-6">
        <section className="card p-4" aria-label="Report filters">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <ReportInput label="From" type="date" value={filters.from} onChange={(value) => setFilters((current) => ({ ...current, from: value }))} />
            <ReportInput label="To" type="date" value={filters.to} onChange={(value) => setFilters((current) => ({ ...current, to: value }))} />
            <ReportSelect label="Company" value={filters.companyId} onChange={(value) => setFilters((current) => ({ ...current, companyId: value }))} options={analytics?.filterOptions?.companies || []} />
            <ReportSelect label="Recruiter" value={filters.recruiterId} onChange={(value) => setFilters((current) => ({ ...current, recruiterId: value }))} options={analytics?.filterOptions?.recruiters || []} />
            <ReportSelect label="Skill" value={filters.skillId} onChange={(value) => setFilters((current) => ({ ...current, skillId: value }))} options={analytics?.filterOptions?.skills || []} />
            <ReportSelect label="Source" value={filters.source} onChange={(value) => setFilters((current) => ({ ...current, source: value }))} options={(analytics?.filterOptions?.sources || []).map((source) => ({ id: source, label: String(source).replaceAll('_', ' ') }))} />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-standard btn-compact" disabled={!Object.values(filters).some(Boolean)} onClick={() => { setFilters(EMPTY_FILTERS); setAppliedFilters(EMPTY_FILTERS); }}>Clear</button>
            <button type="button" className="btn-primary btn-compact" onClick={() => setAppliedFilters({ ...filters })}>Apply filters</button>
          </div>
        </section>
        {error && <StatePanel state={permissionError ? 'permission' : 'error'} title={permissionError ? 'Reports access unavailable' : 'Reports unavailable'} description={error} onRetry={load} compact />}
        {!error && loading && <StatePanel state="loading" title="Loading staffing reports" description="Calculating current funnel and commercial outcomes." />}
        {!error && !loading && analytics && <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label="Starts" value={commercial.starts || 0} />
            <MetricCard label="Gross margin" value={formatMoney(commercial.gross_margin || 0)} />
            <MetricCard label="Invoiced" value={formatMoney(commercial.invoiced || 0)} />
            <MetricCard label="Collected" value={formatMoney(commercial.collected || 0)} />
            <MetricCard label="Avg. time to fill" value={analytics.timeToFill?.average_days ? `${analytics.timeToFill.average_days} days` : '—'} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
            <section className="card p-5">
              <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary-600" /><h2 className="text-sm font-semibold text-neutral-900">Staffing funnel</h2></div>
              <p className="mt-1 text-[11.5px] text-neutral-500">Traceable records from demand discovery through collection. A record is counted only when the relationship exists in Wizmatch.</p>
              <div className="mt-5 space-y-3">
                {completeFunnel.map((item) => (
                  <div key={item.stage} className="grid grid-cols-[96px_minmax(0,1fr)_36px] items-center gap-3">
                    <span className="text-[12px] font-medium text-neutral-600">{item.label}</span>
                    <div className="h-7 overflow-hidden rounded-md bg-neutral-100"><div className="flex h-full min-w-1 items-center justify-end rounded-md bg-primary-700 px-2" style={{ width: `${Math.max(2, (item.count / maxCompleteFunnel) * 100)}%` }}><span className="text-[10px] font-semibold text-white">{item.count || ''}</span></div></div>
                    <span className="text-right text-[12px] font-semibold text-neutral-800">{item.count}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="card p-5"><h2 className="text-sm font-semibold text-neutral-900">Exceptions needing action</h2><div className="mt-4 space-y-3"><Exception label="Overdue submissions" value={exceptions.overdue_submissions || 0} /><Exception label="Missing next action" value={exceptions.missing_next_action || 0} /></div><div className="mt-5 rounded-lg border border-info-200 bg-info-50 p-3 text-[11.5px] text-info-800"><ShieldCheck className="mr-2 inline h-4 w-4" />Placement, invoice and collection are measured separately.</div></section>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <TableSection title="Monthly cohorts" empty="No cohort outcomes yet." columns={['Cohort', 'Requirements', 'Submissions', 'Starts']} rows={(analytics.cohorts || []).map((row) => [row.cohort, row.requirements, row.submissions, row.starts])} />
            <TableSection title="Recruiter performance" empty="No recruiter delivery records yet." columns={['Recruiter', 'Submissions', 'Progressed', 'Starts']} rows={(analytics.recruiterPerformance || []).map((row) => [row.recruiter, row.submissions, row.progressed, row.starts])} />
            <TableSection title="Candidate source performance" empty="No source conversion records yet." columns={['Source', 'Submissions', 'Starts']} rows={(analytics.sourcePerformance || []).map((row) => [String(row.source || 'unknown').replaceAll('_', ' '), row.submissions, row.starts])} />
            <TableSection title="Open-work aging" empty="No open delivery work." columns={['Age', 'Records']} rows={(analytics.aging || []).map((row) => [row.bucket, row.count])} />
          </div>

          <section className="card p-5"><h2 className="text-sm font-semibold text-neutral-900">Rejection and withdrawal reasons</h2>{!(analytics.rejectionReasons || []).length ? <p className="mt-3 text-[12.5px] text-neutral-500">No reasons recorded yet.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{analytics.rejectionReasons.map((row) => <div key={row.reason} className="flex items-center justify-between rounded-lg bg-neutral-50 p-3 text-[12px]"><span className="text-neutral-700">{row.reason}</span><span className="font-bold text-neutral-900">{row.count}</span></div>)}</div>}</section>

          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-[12px] text-neutral-600"><strong className="text-neutral-800">Communication analytics:</strong> sending, bounce and domain-health metrics live under System / Communication. They are not mixed into staffing revenue or conversion reports.</div>
        </>}
      </main>
    </div>
  );
}

function Exception({ label, value }) {
  return <div className="flex items-center justify-between rounded-lg bg-neutral-50 p-3"><span className="text-[12px] text-neutral-600">{label}</span><span className={Number(value) > 0 ? 'badge-warning' : 'badge-success'}>{value}</span></div>;
}

function ReportInput({ label, type, value, onChange }) {
  return <label className="block"><span className="input-label">{label}</span><input className="input" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ReportSelect({ label, value, onChange, options }) {
  return <label className="block"><span className="input-label">{label}</span><select className="input capitalize" value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}

function TableSection({ title, columns, rows, empty }) {
  return <section className="card overflow-hidden"><div className="border-b border-neutral-100 px-4 py-3"><h2 className="text-sm font-semibold text-neutral-900">{title}</h2></div>{!rows.length ? <p className="p-5 text-[12.5px] text-neutral-500">{empty}</p> : <div className="overflow-x-auto"><table className="table-fluent"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((value, index) => <td key={`${index}-${value}`} className={index === 0 ? 'font-medium text-neutral-800 capitalize' : ''}>{value ?? '—'}</td>)}</tr>)}</tbody></table></div>}</section>;
}
