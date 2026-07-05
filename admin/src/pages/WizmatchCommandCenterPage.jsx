import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Building2,
  CheckCircle2,
  ClipboardList,
  Contact,
  DatabaseZap,
  RefreshCw,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const PRIORITY_BADGE = {
  hot: 'badge-success',
  warm: 'badge-info',
  watch: 'badge-warning',
  blocked: 'badge-danger',
};

const MODULE_BADGE = {
  live: 'badge-success',
  planning: 'badge-info',
  blocked: 'badge-danger',
};

const DEMO_DATA = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  phase: 'phase_1_command_center_read_only',
  costControls: {
    paidDiscoveryEnabled: false,
    maxPaidDiscoveryPerCompany: 0,
    maxContactCandidatesShown: 3,
    rediscoveryCooldownDays: 30,
  },
  guardrails: {
    paidEnrichment: 'disabled',
    sending: 'manual_review_only',
    writes: 'disabled_for_command_center',
    schemaChanges: 'none',
  },
  metrics: {
    activeSignals: 42,
    prioritySignals: 13,
    availableCandidates: 86,
    openRequirements: 9,
    reviewReadyCompanies: 7,
    blockedCompanies: 2,
    activePlacements: 5,
    pausedDomains: 1,
    suppressedContacts: 18,
  },
  moduleHealth: [
    { module: 'Client Discovery / Company Signals', status: 'live', priority: 'hot', summary: '42 active signals, 13 priority signals.' },
    { module: 'Contact Intelligence', status: 'live', priority: 'hot', summary: '7 companies ready for manual contact review.' },
    { module: 'Candidate Intelligence', status: 'live', priority: 'warm', summary: '86 available candidates in pool.' },
    { module: 'Requirement Intake', status: 'live', priority: 'warm', summary: '9 open requirements.' },
    { module: 'Domain Health / Sending Safety', status: 'live', priority: 'blocked', summary: '1 paused domain, 18 suppressions.' },
  ],
  commandQueue: [
    {
      id: 'contact-demo-1',
      actionType: 'review_contact',
      title: 'Review 2 contact(s): Bengaluru Cloud Staffing',
      subtitle: 'INDIA - Tier A - 92/100',
      score: 92,
      priority: 'hot',
      module: 'Contact Intelligence',
      reasons: ['IT/Tech signal detected.', 'India-first priority applies.', 'Reusable internal CRM contacts found.'],
    },
    {
      id: 'client-demo-1',
      actionType: 'review_match',
      title: 'Review match path: Pune Data Systems',
      subtitle: 'Data Engineer - INDIA - 4 candidate(s)',
      score: 88,
      priority: 'hot',
      module: 'Client Discovery',
      reasons: ['Existing Wizmatch signal score is high.', 'Strong candidate supply exists.'],
    },
    {
      id: 'requirement-demo-1',
      actionType: 'review_requirement',
      title: 'Fill requirement: Java Backend Developer',
      subtitle: 'INDIA - 3 position(s)',
      score: 91,
      priority: 'hot',
      module: 'Requirement Intake',
      reasons: ['Urgent requirement.', 'Clear skill definition.', 'Budget is captured.'],
    },
    {
      id: 'safety-demo-1',
      actionType: 'resolve_safety',
      title: 'Resolve safety block: Legacy Payroll Suite',
      subtitle: 'non_tech_signal',
      score: 34,
      priority: 'blocked',
      module: 'Domain Health / Sending Safety',
      reasons: ['Rejected from pursuit: non-tech/HRMS/payroll/attendance language found.'],
    },
  ],
  clientDiscovery: [
    {
      id: 'signal-1',
      companyName: 'Bengaluru Cloud Staffing',
      companyDomain: 'bengalurucloud.example',
      jobTitle: 'Senior Java Developer',
      region: 'india',
      source: 'naukri',
      status: 'matched',
      score: 92,
      priority: 'hot',
      matchedCandidateCount: 4,
      reasons: ['IT/Tech signal detected.', 'India-first priority applies.', 'Strong candidate supply exists.'],
      blockers: [],
    },
    {
      id: 'signal-2',
      companyName: 'US Prime Systems',
      companyDomain: 'usprime.example',
      jobTitle: 'DevOps Engineer - Contract',
      region: 'us',
      source: 'manual',
      status: 'scored',
      score: 72,
      priority: 'warm',
      matchedCandidateCount: 1,
      reasons: ['US opportunity kept because high-value evidence exists.', 'Some candidate supply exists.'],
      blockers: [],
    },
  ],
  contactIntelligence: [
    {
      companyId: 'company-1',
      companyName: 'Bengaluru Cloud Staffing',
      targetRegion: 'india',
      qualificationTier: 'A',
      qualificationScore: 92,
      companyStatus: 'qualified',
      contactCandidates: [
        { id: 'contact-1', name: 'Asha Rao', title: 'Head of Talent Acquisition', rankingScore: 94 },
        { id: 'contact-2', name: 'Ravi Mehta', title: 'Engineering Manager', rankingScore: 86 },
      ],
      hardBlocks: [],
      reasons: ['Strong IT/Tech role or skills detected.', 'India-first priority applies.'],
    },
  ],
  candidateIntelligence: [
    {
      id: 'candidate-1',
      name: 'Aarav Kumar',
      skills: ['Java', 'Spring', 'AWS', 'React'],
      location: 'Hyderabad, India',
      availabilityStatus: 'available',
      score: 94,
      priority: 'hot',
      bestUse: 'java, spring, aws',
      reasons: ['Strong skill overlap with active Wizmatch demand.', 'India candidate supply priority.', 'Candidate is marked available.'],
      concerns: [],
    },
    {
      id: 'candidate-2',
      name: 'Neha Shah',
      skills: ['QA Automation', 'Selenium', 'Java'],
      location: 'Pune, India',
      availabilityStatus: 'available',
      score: 78,
      priority: 'warm',
      bestUse: 'java',
      reasons: ['Some skill relevance found.', 'India candidate supply priority.'],
      concerns: [],
    },
  ],
  requirements: [
    {
      id: 'req-1',
      title: 'Java Backend Developer',
      companyName: 'Masked client',
      region: 'india',
      priority: 'hot',
      score: 91,
      requiredSkills: ['java', 'spring', 'microservices', 'aws'],
      positions: 3,
      status: 'sheet_ready',
      reasons: ['India requirement priority.', 'Urgent requirement.', 'Clear skill definition.'],
    },
  ],
};

function KpiCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
        <Icon className="w-4 h-4" /> {label}
      </div>
      <p className="text-2xl font-bold text-neutral-900 mt-2">{value}</p>
      {sub && <p className="text-[12px] text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
}

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

function QueueItem({ item }) {
  return (
    <div className="card card-hover p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{item.title}</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">{item.subtitle}</p>
        </div>
        <ScorePill score={item.score} priority={item.priority} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="badge-muted">{item.module}</span>
        <span className="badge-muted">{item.actionType?.replace(/_/g, ' ')}</span>
      </div>
      {item.reasons?.length > 0 && (
        <div className="mt-3 space-y-1">
          {item.reasons.slice(0, 3).map((reason) => (
            <p key={reason} className="text-[12.5px] text-neutral-600 flex gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-success-600 mt-0.5 flex-shrink-0" />
              <span>{reason}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleHealth({ module }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-neutral-900 text-sm">{module.module}</p>
        <span className={MODULE_BADGE[module.status] || 'badge-muted'}>{module.status}</span>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-2">{module.summary}</p>
    </div>
  );
}

function CompactOpportunity({ title, subtitle, score, priority, meta }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{title}</p>
          <p className="text-[12.5px] text-neutral-500 mt-1 line-clamp-2">{subtitle}</p>
        </div>
        <ScorePill score={score} priority={priority} />
      </div>
      {meta && <p className="text-[12px] text-neutral-400 mt-2">{meta}</p>}
    </div>
  );
}

export default function WizmatchCommandCenterPage({ demoMode = false }) {
  const [data, setData] = useState(demoMode ? DEMO_DATA : null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setData(DEMO_DATA);
      setLoading(false);
      return;
    }
    try {
      const result = await apiFetch('/api/wizmatch/command-center?limit=40');
      setData(result);
    } catch (e) {
      console.error('Failed to load Wizmatch Command Center:', e);
      setData(DEMO_DATA);
      setError(`${e.message || 'Failed to load command center'} - showing local demo data`);
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => { load(); }, [load]);

  const metrics = data?.metrics || {};
  const queueSummary = useMemo(() => {
    const queue = data?.commandQueue || [];
    return {
      hot: queue.filter((item) => item.priority === 'hot').length,
      blocked: queue.filter((item) => item.priority === 'blocked').length,
    };
  }, [data]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Wizmatch Command Center</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Internal IT staffing operating layer · India 80 / US 20 · read-only Phase 1{demoMode ? ' · demo data' : ''}
          </p>
        </div>
        <button onClick={load} className="btn-standard btn-compact self-start" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="mb-5 card p-4 bg-primary-50 border-primary-100">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-primary-700 mt-0.5" />
          <div>
            <p className="font-semibold text-primary-900">Phase 1 guardrails are active</p>
            <p className="text-[12.5px] text-primary-800 mt-1">
              Paid enrichment disabled · no auto-send · no writes from this dashboard · no schema changes · max paid discovery/company {data?.costControls?.maxPaidDiscoveryPerCompany ?? 0}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 card p-4 border-danger-500/20 bg-danger-500/5 text-danger-600 flex gap-2 items-start">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <p className="font-semibold">Using demo fallback</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 mb-5">
        <KpiCard icon={Target} label="Active Signals" value={metrics.activeSignals || 0} sub={`${metrics.prioritySignals || 0} priority`} />
        <KpiCard icon={Contact} label="Contact Review" value={metrics.reviewReadyCompanies || 0} sub={`${metrics.blockedCompanies || 0} blocked`} />
        <KpiCard icon={Users} label="Candidates" value={metrics.availableCandidates || 0} sub="available pool" />
        <KpiCard icon={ClipboardList} label="Requirements" value={metrics.openRequirements || 0} sub="open intake" />
        <KpiCard icon={Building2} label="Placements" value={metrics.activePlacements || 0} sub="active pipeline" />
        <KpiCard icon={ShieldCheck} label="Safety" value={metrics.pausedDomains || 0} sub={`${metrics.suppressedContacts || 0} suppressions`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5 mb-5">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold text-neutral-800">Command Queue</h2>
            <div className="flex gap-2">
              <span className="badge-success">{queueSummary.hot} hot</span>
              <span className="badge-danger">{queueSummary.blocked} blocked</span>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {loading ? (
              <div className="card p-8 text-neutral-400">Loading command queue...</div>
            ) : (data?.commandQueue || []).length ? (
              data.commandQueue.map((item) => <QueueItem key={item.id} item={item} />)
            ) : (
              <div className="card p-8 text-neutral-400">No command items yet.</div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-800 mb-3">Module Health</h2>
          <div className="grid grid-cols-1 gap-3">
            {(data?.moduleHealth || []).map((module) => (
              <ModuleHealth key={module.module} module={module} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-primary-700" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Client Discovery / Company Signals</h2>
          </div>
          <div className="space-y-3">
            {(data?.clientDiscovery || []).slice(0, 6).map((item) => (
              <CompactOpportunity
                key={item.id}
                title={item.companyName}
                subtitle={`${item.jobTitle} · ${item.region?.toUpperCase()} · ${item.matchedCandidateCount || 0} candidates`}
                score={item.score}
                priority={item.priority}
                meta={item.blockers?.length ? `Blocked: ${item.blockers.join(', ')}` : item.reasons?.slice(0, 2).join(' · ')}
              />
            ))}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-4 h-4 text-primary-700" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Candidate Intelligence</h2>
          </div>
          <div className="space-y-3">
            {(data?.candidateIntelligence || []).slice(0, 6).map((item) => (
              <CompactOpportunity
                key={item.id}
                title={item.name}
                subtitle={`${item.location || 'Unknown location'} · ${item.availabilityStatus || 'unknown'} · ${item.bestUse || 'review'}`}
                score={item.score}
                priority={item.priority}
                meta={item.skills?.slice(0, 5).join(', ')}
              />
            ))}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <DatabaseZap className="w-4 h-4 text-primary-700" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Contact Intelligence</h2>
          </div>
          <div className="space-y-3">
            {(data?.contactIntelligence || []).slice(0, 6).map((item) => (
              <CompactOpportunity
                key={item.companyId}
                title={item.companyName}
                subtitle={`${item.targetRegion?.toUpperCase()} · Tier ${item.qualificationTier} · ${item.contactCandidates?.length || 0} contacts`}
                score={item.qualificationScore}
                priority={item.hardBlocks?.length ? 'blocked' : item.qualificationTier === 'A' ? 'hot' : 'warm'}
                meta={item.hardBlocks?.length ? `Blocked: ${item.hardBlocks.join(', ')}` : item.reasons?.slice(0, 2).join(' · ')}
              />
            ))}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary-700" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Requirement Intake / Fill Priority</h2>
          </div>
          <div className="space-y-3">
            {(data?.requirements || []).slice(0, 6).map((item) => (
              <CompactOpportunity
                key={item.id}
                title={item.title}
                subtitle={`${item.region?.toUpperCase()} · ${item.positions || 1} positions · ${item.status || 'draft'}`}
                score={item.score}
                priority={item.priority}
                meta={item.requiredSkills?.slice(0, 5).join(', ')}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
