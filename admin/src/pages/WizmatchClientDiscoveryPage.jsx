import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Plus, RefreshCw, ShieldCheck, Target, Upload, Zap } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const PRIORITY_BADGE = {
  hot: 'badge-success',
  warm: 'badge-info',
  watch: 'badge-warning',
  blocked: 'badge-danger',
};

const DEMO_ITEMS = [
  {
    id: 'signal-demo-1',
    companyId: 'company-demo-1',
    companyName: 'Bengaluru Cloud Staffing',
    companyDomain: 'bengalurucloud.example',
    jobTitle: 'Senior Java Developer',
    region: 'india',
    source: 'naukri',
    status: 'matched',
    score: 91,
    priority: 'hot',
    matchedCandidateCount: 4,
    componentScores: { itTechFit: 25, signalStrength: 18, regionPriority: 15, candidateSupply: 15, relationshipValue: 8, safety: 10 },
    reasons: ['IT/Tech company or role vocabulary detected.', 'India-first priority applies.', 'Strong matching candidate supply exists.'],
    blockers: [],
    nextAction: 'send_to_contact_intelligence',
  },
  {
    id: 'signal-demo-2',
    companyId: 'company-demo-2',
    companyName: 'US Prime Systems',
    companyDomain: 'usprime.example',
    jobTitle: 'DevOps Engineer - Contract',
    region: 'us',
    source: 'manual',
    status: 'scored',
    score: 68,
    priority: 'warm',
    matchedCandidateCount: 1,
    componentScores: { itTechFit: 23, signalStrength: 14, regionPriority: 10, candidateSupply: 9, relationshipValue: 5, safety: 7 },
    reasons: ['US opportunity retained because high-value evidence exists.', 'Some matching candidate supply exists.'],
    blockers: [],
    nextAction: 'send_to_contact_intelligence',
  },
  {
    id: 'signal-demo-3',
    companyId: 'company-demo-3',
    companyName: 'People Suite Payroll',
    companyDomain: 'peoplesuite.example',
    jobTitle: 'Payroll Executive',
    region: 'india',
    source: 'manual',
    status: 'new',
    score: 31,
    priority: 'blocked',
    matchedCandidateCount: 0,
    componentScores: { itTechFit: 0, signalStrength: 12, regionPriority: 15, candidateSupply: 0, relationshipValue: 0, safety: 10 },
    reasons: ['Blocked: non-tech/HRMS/payroll/attendance language found.'],
    blockers: ['non_tech_signal'],
    nextAction: 'blocked',
  },
];

function ScorePill({ score, priority }) {
  return (
    <div className="flex items-center gap-2">
      <span className={PRIORITY_BADGE[priority] || 'badge-muted'}>{priority}</span>
      <span className="inline-flex items-center justify-center min-w-10 h-9 rounded-md bg-neutral-900 text-white text-sm font-bold">
        {score}
      </span>
    </div>
  );
}

function ScoreBar({ label, value, max }) {
  const pct = Math.min(100, Math.round((Number(value || 0) / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-neutral-600">{label}</span>
        <span className="font-semibold text-neutral-800">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SignalCard({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left card card-hover p-4 ${selected ? 'ring-2 ring-primary-300 border-primary-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{item.companyName}</p>
          <p className="text-[12.5px] text-neutral-500 truncate">{item.jobTitle}</p>
        </div>
        <ScorePill score={item.score} priority={item.priority} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge-muted">{item.region?.toUpperCase()}</span>
        <span className="badge-muted">{item.matchedCandidateCount} candidate(s)</span>
        <span className="badge-muted">{item.source || 'unknown source'}</span>
      </div>
    </button>
  );
}

function SeedProspectPanel({ demoMode, onSeeded }) {
  const [form, setForm] = useState({
    companyName: '',
    website: '',
    jobTitle: '',
    jobUrl: '',
    location: '',
    targetRegion: 'india',
    industry: '',
    employeeCount: '',
    linkedinUrl: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState({ kind: '', text: '' });
  const [csvFile, setCsvFile] = useState(null);
  const [csvSubmitting, setCsvSubmitting] = useState(false);
  const [csvStatus, setCsvStatus] = useState(null);

  const update = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const submitSingle = useCallback(async () => {
    setStatus({ kind: '', text: '' });
    if (!form.companyName.trim() || !form.jobTitle.trim()) {
      setStatus({ kind: 'error', text: 'Company name and job title are required.' });
      return;
    }
    if (demoMode) {
      setStatus({
        kind: 'ok',
        text: 'Demo mode — nothing was saved. In live mode this seeds a company + a manual job signal and runs the Contact Intelligence snapshot.',
      });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        companyName: form.companyName.trim(),
        jobTitle: form.jobTitle.trim(),
      };
      if (form.website.trim()) payload.website = form.website.trim();
      if (form.jobUrl.trim()) payload.jobUrl = form.jobUrl.trim();
      if (form.location.trim()) payload.location = form.location.trim();
      if (form.targetRegion) payload.targetRegion = form.targetRegion;
      if (form.industry.trim()) payload.industry = form.industry.trim();
      if (form.employeeCount) payload.employeeCount = Number(form.employeeCount);
      if (form.linkedinUrl.trim()) payload.linkedinUrl = form.linkedinUrl.trim();
      if (form.notes.trim()) payload.notes = form.notes.trim();

      const result = await apiFetch('/api/wizmatch/client-discovery/seed-company', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus({
        kind: 'ok',
        text: result.companyExisted
          ? 'Existing company updated + new signal added. Refreshing queue…'
          : 'Prospect company seeded + Contact Intelligence snapshot created. Refreshing queue…',
      });
      setForm({
        companyName: '',
        website: '',
        jobTitle: '',
        jobUrl: '',
        location: '',
        targetRegion: form.targetRegion,
        industry: '',
        employeeCount: '',
        linkedinUrl: '',
        notes: '',
      });
      onSeeded?.();
    } catch (err) {
      setStatus({ kind: 'error', text: err?.message || 'Seed failed' });
    } finally {
      setSubmitting(false);
    }
  }, [form, demoMode, onSeeded]);

  const submitCsv = useCallback(async () => {
    setCsvStatus(null);
    if (!csvFile) {
      setCsvStatus({ kind: 'error', text: 'Choose a CSV file first.' });
      return;
    }
    if (demoMode) {
      setCsvStatus({ kind: 'ok', text: 'Demo mode — CSV not uploaded.' });
      return;
    }
    setCsvSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', csvFile);
      const result = await apiFetch('/api/wizmatch/client-discovery/seed-company/csv', {
        method: 'POST',
        body: formData,
      });
      const s = result.summary || {};
      setCsvStatus({
        kind: 'ok',
        text: `Processed ${s.total_rows ?? 0} rows: ${s.inserted ?? 0} new, ${s.updated ?? 0} updated, ${s.skipped_invalid ?? 0} skipped.`,
        errors: s.errors || [],
      });
      setCsvFile(null);
      onSeeded?.();
    } catch (err) {
      setCsvStatus({ kind: 'error', text: err?.message || 'CSV upload failed' });
    } finally {
      setCsvSubmitting(false);
    }
  }, [csvFile, demoMode, onSeeded]);

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Plus className="w-4 h-4 text-primary-600" />
        <h2 className="text-[15px] font-bold text-neutral-900">Seed prospect hiring company</h2>
      </div>
      <p className="text-[12px] text-neutral-500 mb-4">
        Manually add an actively-hiring company + one open role. This creates the company
        record, a manual job signal, and auto-runs the Contact Intelligence snapshot so it
        enters the review queue. No outreach is sent.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-[12px] font-semibold text-neutral-700">
          Company name *
          <input
            type="text"
            value={form.companyName}
            onChange={update('companyName')}
            placeholder="e.g. Acme Systems Pvt Ltd"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Website
          <input
            type="text"
            value={form.website}
            onChange={update('website')}
            placeholder="acme.com or https://acme.com"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Open job title *
          <input
            type="text"
            value={form.jobTitle}
            onChange={update('jobTitle')}
            placeholder="Senior DevOps Engineer"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Job posting URL
          <input
            type="text"
            value={form.jobUrl}
            onChange={update('jobUrl')}
            placeholder="https://…"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Location
          <input
            type="text"
            value={form.location}
            onChange={update('location')}
            placeholder="Bengaluru / Remote"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Target region
          <select
            value={form.targetRegion}
            onChange={update('targetRegion')}
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          >
            <option value="india">India</option>
            <option value="us">US</option>
          </select>
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Industry
          <input
            type="text"
            value={form.industry}
            onChange={update('industry')}
            placeholder="IT Services / SaaS / etc."
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700">
          Employee count
          <input
            type="number"
            min="0"
            value={form.employeeCount}
            onChange={update('employeeCount')}
            placeholder="e.g. 250"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700 md:col-span-2">
          LinkedIn URL
          <input
            type="text"
            value={form.linkedinUrl}
            onChange={update('linkedinUrl')}
            placeholder="https://www.linkedin.com/company/acme"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-[12px] font-semibold text-neutral-700 md:col-span-2">
          Notes
          <textarea
            rows={2}
            value={form.notes}
            onChange={update('notes')}
            placeholder="Why this is worth pursuing (open reqs, funding, referral, etc.)"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submitSingle}
          className="btn-primary btn-compact"
          disabled={submitting}
        >
          {submitting ? 'Seeding…' : 'Seed prospect'}
        </button>
        {status.text && (
          <span className={`text-[12.5px] ${status.kind === 'error' ? 'text-danger-700' : 'text-success-700'}`}>
            {status.text}
          </span>
        )}
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Upload className="w-4 h-4 text-neutral-500" />
          <span className="text-[12.5px] font-semibold text-neutral-800">Bulk import CSV</span>
        </div>
        <p className="text-[11.5px] text-neutral-500 mb-2">
          Headers accepted: <code>company_name</code>, <code>job_title</code> (required); optional{' '}
          <code>website</code>, <code>job_url</code>, <code>location</code>, <code>target_region</code>,{' '}
          <code>industry</code>, <code>employee_count</code>, <code>linkedin_url</code>, <code>keywords</code>,{' '}
          <code>notes</code>.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            className="text-[12px]"
          />
          <button
            type="button"
            onClick={submitCsv}
            className="btn-standard btn-compact"
            disabled={csvSubmitting || !csvFile}
          >
            {csvSubmitting ? 'Uploading…' : 'Upload CSV'}
          </button>
          {csvStatus && (
            <span className={`text-[12.5px] ${csvStatus.kind === 'error' ? 'text-danger-700' : 'text-success-700'}`}>
              {csvStatus.text}
            </span>
          )}
        </div>
        {csvStatus?.errors?.length > 0 && (
          <div className="mt-2 max-h-40 overflow-auto rounded-md border border-warning-200 bg-warning-50 p-2 text-[11.5px] text-warning-800">
            <p className="font-semibold mb-1">Row errors:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {csvStatus.errors.slice(0, 20).map((e, i) => (
                <li key={i}>Row {e.row}: {e.reason}</li>
              ))}
              {csvStatus.errors.length > 20 && (
                <li>…and {csvStatus.errors.length - 20} more.</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WizmatchClientDiscoveryPage({ demoMode = false }) {
  const [items, setItems] = useState(demoMode ? DEMO_ITEMS : []);
  const [total, setTotal] = useState(demoMode ? DEMO_ITEMS.length : 0);
  const [selected, setSelected] = useState(demoMode ? DEMO_ITEMS[0] : null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [sentIds, setSentIds] = useState(() => new Set());
  const [actionLoading, setActionLoading] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setItems(DEMO_ITEMS);
      setTotal(DEMO_ITEMS.length);
      setSelected((prev) => prev || DEMO_ITEMS[0]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch('/api/wizmatch/client-discovery/queue?limit=75');
      const next = data.items || [];
      setItems(next);
      setTotal(Number(data.total ?? next.length));
      setSelected((prev) => {
        if (!next.length) return null;
        return next.find((item) => item.id === prev?.id) || next[0];
      });
    } catch (e) {
      console.error('Failed to load Client Discovery:', e);
      setItems([]);
      setTotal(0);
      setSelected(null);
      setError(e.message || 'Failed to load Client Discovery');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => ({
    hot: items.filter((item) => item.priority === 'hot').length,
    warm: items.filter((item) => item.priority === 'warm').length,
    blocked: items.filter((item) => item.priority === 'blocked').length,
  }), [items]);

  const handoff = useCallback(async () => {
    if (!selected?.companyId) return;
    setActionLoading('handoff');
    setActionMessage('');
    try {
      if (demoMode) {
        setActionMessage('Demo handoff completed locally. In live mode this saves a Contact Intelligence snapshot.');
      } else {
        await apiFetch(`/api/wizmatch/client-discovery/companies/${selected.companyId}/send-to-contact-intelligence`, { method: 'POST' });
        setSentIds((prev) => new Set(prev).add(selected.companyId));
        setActionMessage(`Sent "${selected.companyName || 'this company'}" to Contact Intelligence — go there to find the decision-maker.`);
      }
    } catch (e) {
      setActionMessage(e.message || 'Handoff failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, selected]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Client Discovery</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Company signal ranking · IT/Tech only · India 80 / US 20{demoMode ? ' · demo data' : ''}
          </p>
        </div>
        <button onClick={load} className="btn-standard btn-compact self-start" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        <div className="card p-4">
          <p className="text-[12px] text-neutral-500 font-semibold uppercase">Total signals</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{total}</p>
        </div>
        <div className="card p-4">
          <p className="text-[12px] text-neutral-500 font-semibold uppercase">Hot</p>
          <p className="text-2xl font-bold text-success-700 mt-1">{summary.hot}</p>
        </div>
        <div className="card p-4">
          <p className="text-[12px] text-neutral-500 font-semibold uppercase">Warm</p>
          <p className="text-2xl font-bold text-primary-700 mt-1">{summary.warm}</p>
        </div>
        <div className="card p-4">
          <p className="text-[12px] text-neutral-500 font-semibold uppercase">Blocked</p>
          <p className="text-2xl font-bold text-danger-700 mt-1">{summary.blocked}</p>
        </div>
      </div>

      <SeedProspectPanel demoMode={demoMode} onSeeded={load} />

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <div className="space-y-3">
          {loading ? (
            <div className="card p-6 text-center text-neutral-400">Loading...</div>
          ) : items.length === 0 ? (
            <div className="card p-6 text-center text-neutral-400">No client discovery signals found</div>
          ) : items.map((item) => (
            <SignalCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={setSelected} />
          ))}
        </div>

        <div className="card p-5 min-h-[520px]">
          {selected ? (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">{selected.companyName}</h2>
                  <p className="text-[12.5px] text-neutral-500 mt-1">{selected.companyDomain || 'No domain'} · {selected.jobTitle}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={PRIORITY_BADGE[selected.priority] || 'badge-muted'}>{selected.priority}</span>
                    <span className="badge-muted">{selected.region?.toUpperCase()}</span>
                    <span className="badge-muted">cost ₹0</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  disabled={actionLoading === 'handoff' || sentIds.has(selected.companyId) || selected.nextAction !== 'send_to_contact_intelligence'}
                  onClick={handoff}
                >
                  {sentIds.has(selected.companyId)
                    ? '✓ Sent'
                    : actionLoading === 'handoff'
                    ? 'Sending…'
                    : <><ArrowRight className="w-3.5 h-3.5" /> Send to Contact Intel</>}
                </button>
              </div>

              {actionMessage && (
                <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
                  <p>{actionMessage}</p>
                  {sentIds.has(selected.companyId) && (
                    <a href="/wizmatch/contact-intelligence" className="mt-1 inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline">
                      View in Contact Intelligence <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <ScoreBar label="IT/Tech fit" value={selected.componentScores?.itTechFit || 0} max={25} />
                <ScoreBar label="Signal strength" value={selected.componentScores?.signalStrength || 0} max={20} />
                <ScoreBar label="India/US priority" value={selected.componentScores?.regionPriority || 0} max={15} />
                <ScoreBar label="Candidate supply" value={selected.componentScores?.candidateSupply || 0} max={15} />
                <ScoreBar label="Relationship value" value={selected.componentScores?.relationshipValue || 0} max={15} />
                <ScoreBar label="Safety" value={selected.componentScores?.safety || 0} max={10} />
              </div>

              <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-800 mb-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success-600" /> Reasons
                  </h3>
                  <div className="space-y-2">
                    {(selected.reasons || []).map((reason) => (
                      <p key={reason} className="text-[12.5px] text-neutral-600 rounded-md bg-neutral-50 px-3 py-2">{reason}</p>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-800 mb-2 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary-600" /> Guardrails
                  </h3>
                  <div className="space-y-2 text-[12.5px] text-neutral-600">
                    <p className="rounded-md bg-neutral-50 px-3 py-2">No paid enrichment before qualification.</p>
                    <p className="rounded-md bg-neutral-50 px-3 py-2">No auto-sending from this queue.</p>
                    <p className="rounded-md bg-neutral-50 px-3 py-2">Hot/warm only can hand off to Contact Intelligence.</p>
                    {(selected.blockers || []).map((block) => (
                      <p key={block} className="rounded-md bg-danger-50 text-danger-700 px-3 py-2">Blocked: {block.replace(/_/g, ' ')}</p>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-neutral-400">
              <Target className="w-8 h-8 mb-2" />
              <p>Select a client signal</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-neutral-200 bg-white p-4 flex flex-wrap gap-3 text-[12.5px] text-neutral-600">
        <span className="inline-flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-primary-600" /> Deterministic scoring first</span>
        <span>Paid enrichment disabled</span>
        <span>Manual review required before outreach</span>
      </div>
    </div>
  );
}
