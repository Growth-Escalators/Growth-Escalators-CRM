import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, Target, Zap } from 'lucide-react';
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

export default function WizmatchClientDiscoveryPage({ demoMode = false }) {
  const [items, setItems] = useState(demoMode ? DEMO_ITEMS : []);
  const [selected, setSelected] = useState(demoMode ? DEMO_ITEMS[0] : null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setItems(DEMO_ITEMS);
      setSelected((prev) => prev || DEMO_ITEMS[0]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch('/api/wizmatch/client-discovery/queue?limit=75');
      const next = data.items || [];
      setItems(next);
      setSelected((prev) => {
        if (!next.length) return null;
        return next.find((item) => item.id === prev?.id) || next[0];
      });
    } catch (e) {
      console.error('Failed to load Client Discovery:', e);
      setItems(DEMO_ITEMS);
      setSelected(DEMO_ITEMS[0]);
      setError(`${e.message || 'Failed to load Client Discovery'} · showing demo data`);
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
        setActionMessage('Sent to Contact Intelligence review queue.');
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
          <p className="text-2xl font-bold text-neutral-900 mt-1">{items.length}</p>
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
                  disabled={actionLoading === 'handoff' || selected.nextAction !== 'send_to_contact_intelligence'}
                  onClick={handoff}
                >
                  <ArrowRight className="w-3.5 h-3.5" /> Send to Contact Intel
                </button>
              </div>

              {actionMessage && (
                <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
                  {actionMessage}
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
