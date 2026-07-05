import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const TIER_BADGE = {
  A: 'badge-success',
  B: 'badge-info',
  C: 'badge-warning',
  Reject: 'badge-danger',
};

const STATUS_BADGE = {
  qualified: 'badge-success',
  discovered: 'badge-success',
  needs_review: 'badge-warning',
  discovery_blocked: 'badge-warning',
  rejected: 'badge-danger',
  suppressed: 'badge-danger',
  cooldown: 'badge-muted',
};

const DEMO_ITEMS = [
  {
    companyId: 'demo-1',
    companyName: 'Bengaluru Cloud Staffing',
    companyDomain: 'bengalurucloud.example',
    targetRegion: 'india',
    qualificationTier: 'A',
    qualificationScore: 92,
    companyStatus: 'qualified',
    discoveryRunStatus: 'succeeded',
    componentScores: {
      itTechFit: 25,
      signalQuality: 19,
      regionPriority: 15,
      candidateSupply: 15,
      relationshipValue: 10,
      safetyAndDeliverability: 8,
    },
    latestSignal: {
      id: 'signal-demo-1',
      jobTitle: 'Senior Java Developer',
      source: 'naukri',
      location: 'Bangalore, India',
      score: 9,
      daysOpen: 12,
      status: 'matched',
      matchedCandidateCount: 4,
    },
    relationshipSummary: { knownContactCount: 3, positiveReplyCount: 1, placementCount: 0, activeSignalCount: 4 },
    safetySummary: { domainStatus: 'healthy', suppressedCount: 0, activeDuplicateCount: 0 },
    hardBlocks: [],
    reasons: [
      'Strong IT/Tech role or skills detected.',
      'India-first priority applies.',
      'Strong candidate supply is available.',
      'Prior positive reply found.',
      'Reusable internal CRM contacts found.',
    ],
    contactCandidates: [
      {
        id: 'contact-demo-1',
        name: 'Asha Rao',
        title: 'Head of Talent Acquisition',
        email: 'asha@bengalurucloud.example',
        phone: '+91 98765 43210',
        linkedinUrl: null,
        source: 'prior_wizmatch_signal',
        status: 'needs_review',
        rankingScore: 94,
        relationshipScore: 10,
        confidenceScore: 10,
        reasons: ['Decision-maker title fit.', 'Existing relationship signal found.', 'Verified internal channel.'],
      },
      {
        id: 'contact-demo-2',
        name: 'Ravi Mehta',
        title: 'Engineering Manager',
        email: 'ravi@bengalurucloud.example',
        phone: null,
        linkedinUrl: null,
        source: 'internal_crm',
        status: 'needs_review',
        rankingScore: 86,
        relationshipScore: 5,
        confidenceScore: 10,
        reasons: ['Decision-maker title fit.', 'Verified internal channel.'],
      },
    ],
  },
  {
    companyId: 'demo-2',
    companyName: 'US Prime Systems',
    companyDomain: 'usprime.example',
    targetRegion: 'us',
    qualificationTier: 'B',
    qualificationScore: 71,
    companyStatus: 'qualified',
    discoveryRunStatus: 'blocked_by_cap',
    componentScores: {
      itTechFit: 22,
      signalQuality: 14,
      regionPriority: 10,
      candidateSupply: 10,
      relationshipValue: 7,
      safetyAndDeliverability: 8,
    },
    latestSignal: {
      id: 'signal-demo-2',
      jobTitle: 'DevOps Engineer - Contract',
      source: 'manual',
      location: 'New Jersey, US',
      score: 7,
      daysOpen: 21,
      status: 'scored',
      matchedCandidateCount: 1,
    },
    relationshipSummary: { knownContactCount: 1, positiveReplyCount: 0, placementCount: 0, activeSignalCount: 2 },
    safetySummary: { domainStatus: 'warn', suppressedCount: 0, activeDuplicateCount: 0 },
    hardBlocks: [],
    reasons: [
      'Strong IT/Tech role or skills detected.',
      'US signal allowed because it has high-value evidence.',
      'Some matching candidate supply is available.',
      'Paid discovery is blocked in Phase 1.',
    ],
    contactCandidates: [],
  },
];

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

function CandidateCard({ candidate }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">{candidate.name}</p>
          <p className="text-[12.5px] text-neutral-500">{candidate.title || 'Title needs review'}</p>
        </div>
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-primary-50 text-primary-700 font-bold border border-primary-100">
          {candidate.rankingScore}
        </span>
      </div>
      <div className="mt-2 text-[12px] text-neutral-500 space-y-1">
        <p>{candidate.email || 'No email'}{candidate.phone ? ` · ${candidate.phone}` : ''}</p>
        <p className="capitalize">{candidate.source?.replace(/_/g, ' ') || 'internal crm'}</p>
      </div>
      {candidate.reasons?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidate.reasons.slice(0, 3).map((reason) => (
            <span key={reason} className="badge-muted">{reason}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyPanel({ item, selected, onSelect }) {
  const badge = TIER_BADGE[item.qualificationTier] || 'badge-muted';
  const statusBadge = STATUS_BADGE[item.companyStatus] || 'badge-muted';

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left card card-hover p-4 ${selected ? 'ring-2 ring-primary-300 border-primary-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{item.companyName}</p>
          <p className="text-[12.5px] text-neutral-500 truncate">{item.companyDomain || 'No domain'} · {item.targetRegion?.toUpperCase()}</p>
        </div>
        <div className="text-right">
          <span className={badge}>Tier {item.qualificationTier}</span>
          <p className="mt-1 text-[12px] font-semibold text-neutral-700">{item.qualificationScore}/100</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={statusBadge}>{item.companyStatus?.replace(/_/g, ' ')}</span>
        <span className="badge-muted">{item.contactCandidates?.length || 0} contacts</span>
        <span className="badge-muted">cost ₹0</span>
      </div>

      {item.latestSignal && (
        <p className="mt-3 text-[12.5px] text-neutral-600 line-clamp-2">
          {item.latestSignal.jobTitle} · score {item.latestSignal.score}/10
        </p>
      )}
    </button>
  );
}

export default function WizmatchContactIntelligencePage({ demoMode = false }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [costControls, setCostControls] = useState(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setItems(DEMO_ITEMS);
      setCostControls({
        paidDiscoveryEnabled: false,
        maxPaidDiscoveryPerCompany: 0,
        maxContactCandidatesShown: 3,
        rediscoveryCooldownDays: 30,
      });
      setSelected((prev) => prev || DEMO_ITEMS[0]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch('/api/wizmatch/contact-intelligence/queue?limit=50');
      const nextItems = data.items || [];
      setItems(nextItems);
      setCostControls(data.costControls || null);
      setSelected((prev) => {
        if (!nextItems.length) return null;
        if (!prev) return nextItems[0];
        return nextItems.find((item) => item.companyId === prev.companyId) || nextItems[0];
      });
    } catch (e) {
      console.error('Failed to load contact intelligence:', e);
      setItems(DEMO_ITEMS);
      setCostControls({
        paidDiscoveryEnabled: false,
        maxPaidDiscoveryPerCompany: 0,
        maxContactCandidatesShown: 3,
        rediscoveryCooldownDays: 30,
      });
      setSelected(DEMO_ITEMS[0]);
      setError(`${e.message || 'Failed to load Contact Intelligence'} · showing local demo data`);
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const summary = useMemo(() => {
    const tierA = items.filter((item) => item.qualificationTier === 'A').length;
    const blocked = items.filter((item) => item.discoveryRunStatus === 'blocked_by_cap').length;
    const contacts = items.reduce((sum, item) => sum + (item.contactCandidates?.length || 0), 0);
    return { tierA, blocked, contacts };
  }, [items]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Contact Intelligence</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Phase 1 · deterministic qualification · internal CRM reuse · zero paid enrichment{demoMode ? ' · demo data' : ''}
          </p>
        </div>
        <button onClick={loadQueue} className="btn-standard btn-compact self-start" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" /> Qualified
          </div>
          <p className="text-2xl font-bold text-neutral-900 mt-2">{items.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" /> Tier A
          </div>
          <p className="text-2xl font-bold text-success-600 mt-2">{summary.tierA}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <Users className="w-4 h-4" /> Internal Contacts
          </div>
          <p className="text-2xl font-bold text-primary-700 mt-2">{summary.contacts}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" /> Paid Calls
          </div>
          <p className="text-2xl font-bold text-neutral-900 mt-2">0</p>
        </div>
      </div>

      <div className="mb-5 card p-4 bg-primary-50 border-primary-100">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-primary-700 mt-0.5" />
          <div>
            <p className="font-semibold text-primary-900">Phase 1 guardrails are active</p>
            <p className="text-[12.5px] text-primary-800 mt-1">
              Paid enrichment disabled: {String(costControls?.paidDiscoveryEnabled ?? false)} · max paid discovery/company: {costControls?.maxPaidDiscoveryPerCompany ?? 0} · shown candidates/company: {costControls?.maxContactCandidatesShown ?? 3} · rediscovery cooldown: {costControls?.rediscoveryCooldownDays ?? 30} days
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 card p-4 border-danger-500/20 bg-danger-500/5 text-danger-600 flex gap-2 items-start">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <p className="font-semibold">Could not load queue</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <div className="space-y-3">
          {loading ? (
            <div className="card p-8 text-center text-neutral-400">Loading Contact Intelligence...</div>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center text-neutral-400">No companies with job signals found yet.</div>
          ) : items.map((item) => (
            <CompanyPanel
              key={item.companyId}
              item={item}
              selected={selected?.companyId === item.companyId}
              onSelect={setSelected}
            />
          ))}
        </div>

        <div className="card p-5 min-h-[520px]">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-neutral-400">Select a company to review.</div>
          ) : (
            <div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-5">
                <div>
                  <h2 className="text-[18px] font-bold text-neutral-900">{selected.companyName}</h2>
                  <p className="text-[12.5px] text-neutral-500">{selected.companyDomain || 'No domain'} · {selected.targetRegion?.toUpperCase()}</p>
                </div>
                <div className="flex gap-2">
                  <span className={TIER_BADGE[selected.qualificationTier] || 'badge-muted'}>Tier {selected.qualificationTier}</span>
                  <span className={STATUS_BADGE[selected.companyStatus] || 'badge-muted'}>{selected.companyStatus?.replace(/_/g, ' ')}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
                <div className="bg-neutral-50 rounded-lg p-4">
                  <p className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Qualification</p>
                  <p className="text-3xl font-bold text-neutral-900 mt-1">{selected.qualificationScore}</p>
                  <p className="text-[12px] text-neutral-500">out of 100</p>
                </div>
                <div className="bg-neutral-50 rounded-lg p-4">
                  <p className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Discovery</p>
                  <p className="text-lg font-bold text-neutral-900 mt-2">{selected.discoveryRunStatus?.replace(/_/g, ' ')}</p>
                  <p className="text-[12px] text-neutral-500">Phase 1 internal-only</p>
                </div>
                <div className="bg-neutral-50 rounded-lg p-4">
                  <p className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Latest Signal</p>
                  <p className="text-sm font-semibold text-neutral-900 mt-2 line-clamp-2">{selected.latestSignal?.jobTitle || 'No signal'}</p>
                  <p className="text-[12px] text-neutral-500">score {selected.latestSignal?.score ?? 0}/10</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Score Components</h3>
                  <div className="space-y-3">
                    <ScoreBar label="IT/Tech fit" value={selected.componentScores?.itTechFit || 0} max={25} />
                    <ScoreBar label="Signal quality" value={selected.componentScores?.signalQuality || 0} max={20} />
                    <ScoreBar label="Region priority" value={selected.componentScores?.regionPriority || 0} max={15} />
                    <ScoreBar label="Candidate supply" value={selected.componentScores?.candidateSupply || 0} max={15} />
                    <ScoreBar label="Relationship value" value={selected.componentScores?.relationshipValue || 0} max={15} />
                    <ScoreBar label="Safety" value={selected.componentScores?.safetyAndDeliverability || 0} max={10} />
                  </div>

                  <h3 className="text-[15px] font-semibold text-neutral-800 mt-6 mb-3">Why this company</h3>
                  <div className="space-y-2">
                    {(selected.reasons || []).slice(0, 7).map((reason) => (
                      <div key={reason} className="flex gap-2 text-[13px] text-neutral-600">
                        <CheckCircle2 className="w-4 h-4 text-success-600 flex-shrink-0 mt-0.5" />
                        <span>{reason}</span>
                      </div>
                    ))}
                    {selected.hardBlocks?.length > 0 && selected.hardBlocks.map((block) => (
                      <div key={block} className="flex gap-2 text-[13px] text-danger-600">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{block.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Reviewable Contacts</h3>
                  <div className="space-y-3">
                    {selected.contactCandidates?.length ? (
                      selected.contactCandidates.map((candidate) => (
                        <CandidateCard key={candidate.id} candidate={candidate} />
                      ))
                    ) : (
                      <div className="border border-dashed border-neutral-300 rounded-lg p-5 text-center text-neutral-400">
                        <Clock className="w-5 h-5 mx-auto mb-2" />
                        No reusable internal contacts found. Paid discovery is blocked in Phase 1.
                      </div>
                    )}
                  </div>

                  <h3 className="text-[15px] font-semibold text-neutral-800 mt-6 mb-3">Manual Review Actions</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn-primary btn-compact" disabled>Approve later</button>
                    <button className="btn-standard btn-compact" disabled>Reject later</button>
                    <button className="btn-standard btn-compact" disabled>Add manual contact</button>
                    <button className="btn-standard btn-compact" disabled>Request discovery</button>
                  </div>
                  <p className="text-[12px] text-neutral-400 mt-2">
                    Actions are disabled in this local Phase 1 slice: no writes, no outreach, no paid enrichment.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
