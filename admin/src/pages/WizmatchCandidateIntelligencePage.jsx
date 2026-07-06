import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const PRIORITY_BADGE = {
  hot: 'badge-success',
  warm: 'badge-info',
  watch: 'badge-warning',
  blocked: 'badge-danger',
};

const DEMO_ITEMS = [
  {
    id: 'candidate-demo-1',
    name: 'Aarav Kumar',
    skills: ['Java', 'Spring', 'AWS', 'Microservices', 'React'],
    location: 'Hyderabad, India',
    region: 'india',
    availabilityStatus: 'available',
    score: 94,
    priority: 'hot',
    bestUse: 'Java Backend Developer',
    componentScores: { skillFit: 30, availability: 20, regionWorkModeFit: 15, rateBudgetFit: 10, profileQuality: 9, relationshipOutcome: 5, riskControls: 5 },
    topRequirementMatches: [
      { requirementId: 'req-demo-1', title: 'Java Backend Developer', companyName: 'Masked client', score: 91, priority: 'hot', matchedSkills: ['java', 'spring', 'aws'], missingSkills: ['kubernetes'], reasons: ['Strong required-skill overlap.'] },
    ],
    reasons: ['Strong skill overlap with active demand.', 'India candidate supply priority applies.', 'Candidate is available for review.'],
    concerns: [],
    blockers: [],
  },
  {
    id: 'candidate-demo-2',
    name: 'Neha Shah',
    skills: ['QA Automation', 'Selenium', 'Java'],
    location: 'Pune, India',
    region: 'india',
    availabilityStatus: 'available',
    score: 76,
    priority: 'warm',
    bestUse: 'QA Automation Engineer',
    componentScores: { skillFit: 22, availability: 20, regionWorkModeFit: 15, rateBudgetFit: 7, profileQuality: 7, relationshipOutcome: 0, riskControls: 5 },
    topRequirementMatches: [],
    reasons: ['Useful skill overlap with active demand.', 'India candidate supply priority applies.'],
    concerns: [],
    blockers: [],
  },
  {
    id: 'candidate-demo-3',
    name: 'Placed Candidate',
    skills: ['React', 'Node'],
    location: 'Delhi, India',
    region: 'india',
    availabilityStatus: 'placed',
    score: 49,
    priority: 'blocked',
    bestUse: 'Manual review',
    componentScores: { skillFit: 22, availability: 0, regionWorkModeFit: 15, rateBudgetFit: 3, profileQuality: 4, relationshipOutcome: 0, riskControls: 0 },
    topRequirementMatches: [],
    reasons: ['Useful skill overlap with active demand.'],
    concerns: ['Blocked because candidate is already placed.'],
    blockers: ['already_placed'],
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

function CandidateCard({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left card card-hover p-4 ${selected ? 'ring-2 ring-primary-300 border-primary-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{item.name}</p>
          <p className="text-[12.5px] text-neutral-500 truncate">{item.bestUse}</p>
        </div>
        <ScorePill score={item.score} priority={item.priority} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge-muted">{item.region?.toUpperCase()}</span>
        <span className="badge-muted">{item.availabilityStatus || 'unknown'}</span>
        <span className="badge-muted">{item.skills?.length || 0} skills</span>
      </div>
    </button>
  );
}

export default function WizmatchCandidateIntelligencePage({ demoMode = false }) {
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
      const data = await apiFetch('/api/wizmatch/candidate-intelligence/queue?limit=75');
      const next = data.items || [];
      setItems(next);
      setSelected((prev) => {
        if (!next.length) return null;
        return next.find((item) => item.id === prev?.id) || next[0];
      });
    } catch (e) {
      console.error('Failed to load Candidate Intelligence:', e);
      setItems(DEMO_ITEMS);
      setSelected(DEMO_ITEMS[0]);
      setError(`${e.message || 'Failed to load Candidate Intelligence'} · showing demo data`);
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

  const reviewPlan = useCallback(async (action) => {
    if (!selected) return;
    setActionLoading(action);
    setActionMessage('');
    try {
      if (demoMode) {
        setActionMessage(`Demo review recorded locally: ${action.replace(/_/g, ' ')}. No outreach or submission was created.`);
      } else {
        const result = await apiFetch(`/api/wizmatch/candidate-intelligence/candidates/${selected.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
        setActionMessage(result.message || 'Review plan saved.');
      }
    } catch (e) {
      setActionMessage(e.message || 'Review action failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, selected]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Candidate Intelligence</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Candidate readiness and requirement fit · deterministic first{demoMode ? ' · demo data' : ''}
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
          <p className="text-[12px] text-neutral-500 font-semibold uppercase">Candidates</p>
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
            <div className="card p-6 text-center text-neutral-400">No candidate intelligence records found</div>
          ) : items.map((item) => (
            <CandidateCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={setSelected} />
          ))}
        </div>

        <div className="card p-5 min-h-[560px]">
          {selected ? (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">{selected.name}</h2>
                  <p className="text-[12.5px] text-neutral-500 mt-1">{selected.location || 'No location'} · best use: {selected.bestUse}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={PRIORITY_BADGE[selected.priority] || 'badge-muted'}>{selected.priority}</span>
                    <span className="badge-muted">{selected.region?.toUpperCase()}</span>
                    <span className="badge-muted">{selected.availabilityStatus || 'unknown'}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-standard btn-compact" disabled={actionLoading || selected.priority === 'blocked'} onClick={() => reviewPlan('mark_reviewed')}>
                    <ClipboardCheck className="w-3.5 h-3.5" /> Mark reviewed
                  </button>
                  <button className="btn-primary btn-compact" disabled={actionLoading || selected.priority === 'blocked'} onClick={() => reviewPlan('shortlist_for_requirement')}>
                    <UserCheck className="w-3.5 h-3.5" /> Shortlist
                  </button>
                </div>
              </div>

              {actionMessage && (
                <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
                  {actionMessage}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-2">
                {(selected.skills || []).slice(0, 12).map((skill) => (
                  <span key={skill} className="badge-info">{skill}</span>
                ))}
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <ScoreBar label="Skill fit" value={selected.componentScores?.skillFit || 0} max={30} />
                <ScoreBar label="Availability" value={selected.componentScores?.availability || 0} max={20} />
                <ScoreBar label="Region/work mode" value={selected.componentScores?.regionWorkModeFit || 0} max={15} />
                <ScoreBar label="Rate/budget" value={selected.componentScores?.rateBudgetFit || 0} max={10} />
                <ScoreBar label="Profile quality" value={selected.componentScores?.profileQuality || 0} max={10} />
                <ScoreBar label="Relationship/outcome" value={selected.componentScores?.relationshipOutcome || 0} max={10} />
                <ScoreBar label="Risk controls" value={selected.componentScores?.riskControls || 0} max={5} />
              </div>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-neutral-800 mb-2">Top requirement fit</h3>
                <div className="space-y-2">
                  {(selected.topRequirementMatches || []).length === 0 ? (
                    <p className="text-[12.5px] text-neutral-500 rounded-md bg-neutral-50 px-3 py-2">No active requirement fit found yet.</p>
                  ) : selected.topRequirementMatches.map((match) => (
                    <div key={match.requirementId} className="rounded-lg border border-neutral-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-neutral-900 text-sm">{match.title}</p>
                          <p className="text-[12px] text-neutral-500">{match.companyName || 'Masked client'}</p>
                        </div>
                        <ScorePill score={match.score} priority={match.priority} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(match.matchedSkills || []).slice(0, 5).map((skill) => <span key={skill} className="badge-success">{skill}</span>)}
                        {(match.missingSkills || []).slice(0, 4).map((skill) => <span key={skill} className="badge-muted">missing {skill}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
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
                    <ShieldCheck className="w-4 h-4 text-primary-600" /> Risks
                  </h3>
                  <div className="space-y-2">
                    {(selected.concerns || []).length === 0 && (selected.blockers || []).length === 0 ? (
                      <p className="text-[12.5px] text-neutral-600 rounded-md bg-neutral-50 px-3 py-2">No hard blockers detected.</p>
                    ) : null}
                    {(selected.concerns || []).map((concern) => (
                      <p key={concern} className="text-[12.5px] text-warning-800 rounded-md bg-warning-50 px-3 py-2">{concern}</p>
                    ))}
                    {(selected.blockers || []).map((block) => (
                      <p key={block} className="text-[12.5px] text-danger-700 rounded-md bg-danger-50 px-3 py-2">Blocked: {block.replace(/_/g, ' ')}</p>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-neutral-400">
              <UserCheck className="w-8 h-8 mb-2" />
              <p>Select a candidate</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
