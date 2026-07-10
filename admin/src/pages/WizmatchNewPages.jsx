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
  Eye,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Upload,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const BADGE = {
  hot: 'badge-success',
  warm: 'badge-info',
  watch: 'badge-warning',
  blocked: 'badge-danger',
  healthy: 'badge-success',
  live: 'badge-success',
  planning: 'badge-info',
  qualified: 'badge-success',
  discovered: 'badge-success',
  needs_review: 'badge-warning',
  discovery_blocked: 'badge-warning',
  paid_discovery_disabled: 'badge-warning',
  blocked_by_cap: 'badge-danger',
  preview_only: 'badge-info',
  ready_for_manual_paid_discovery: 'badge-success',
  partial: 'badge-warning',
  rejected: 'badge-danger',
  suppressed: 'badge-danger',
  cooldown: 'badge-muted',
  approved: 'badge-success',
  linked_to_crm: 'badge-success',
  do_not_contact: 'badge-danger',
  stale: 'badge-muted',
  A: 'badge-success',
  B: 'badge-info',
  C: 'badge-warning',
  Reject: 'badge-danger',
  high: 'badge-success',
  medium: 'badge-info',
  low: 'badge-warning',
};

// Plain-language guidance shown next to each contact's confidence tier.
const CONFIDENCE_TIER_HELP = {
  high: 'Published by the company — safe to email.',
  medium: 'Verified deliverable — good to email.',
  low: 'Unconfirmed (guess / Google / Microsoft) — test carefully before bulk send.',
};

const DEMO_COMMAND = {
  metrics: {
    activeSignals: 42,
    prioritySignals: 13,
    availableCandidates: 86,
    openRequirements: 9,
    reviewReadyCompanies: 7,
    blockedCompanies: 2,
    activePlacements: 5,
    pausedDomains: 1,
  },
  costControls: {
    paidDiscoveryEnabled: false,
    maxPaidDiscoveryPerCompany: 0,
    maxContactCandidatesShown: 3,
    rediscoveryCooldownDays: 30,
  },
  moduleHealth: [
    { module: 'Client Discovery', status: 'live', priority: 'hot', summary: '13 priority company signals are ready for review.' },
    { module: 'Contact Intelligence', status: 'live', priority: 'hot', summary: '7 qualified companies have contact decisions pending.' },
    { module: 'Candidate Intelligence', status: 'live', priority: 'warm', summary: '86 candidates are ready for deterministic scoring.' },
    { module: 'Requirement Intake', status: 'live', priority: 'warm', summary: '9 open requirements need coverage and review.' },
    { module: 'Sending Safety', status: 'live', priority: 'blocked', summary: '1 paused domain and 2 blocked companies need attention.' },
  ],
  commandQueue: [
    {
      id: 'contact-demo-1',
      actionType: 'review_contact',
      title: 'Review Bengaluru Cloud Staffing contacts',
      subtitle: 'India - Tier A - 2 contacts',
      score: 92,
      priority: 'hot',
      module: 'Contact Intelligence',
      reasons: ['IT/Tech signal detected.', 'India-first priority applies.', 'Reusable CRM contacts found.'],
    },
    {
      id: 'client-demo-1',
      actionType: 'review_match',
      title: 'Move Pune Data Systems into contact review',
      subtitle: 'Data Engineer - 4 candidates',
      score: 88,
      priority: 'hot',
      module: 'Client Discovery',
      reasons: ['Strong signal score.', 'Strong candidate supply exists.'],
    },
    {
      id: 'candidate-demo-1',
      actionType: 'review_candidate',
      title: 'Shortlist Aarav Kumar',
      subtitle: 'Java Backend Developer - 91 match',
      score: 91,
      priority: 'hot',
      module: 'Candidate Intelligence',
      reasons: ['Strong skill overlap.', 'India candidate supply priority.'],
    },
    {
      id: 'safety-demo-1',
      actionType: 'resolve_safety',
      title: 'Reject non-tech payroll signal',
      subtitle: 'People Suite Payroll - blocked',
      score: 34,
      priority: 'blocked',
      module: 'Safety',
      reasons: ['Non-tech/HRMS language detected.', 'No paid enrichment allowed.'],
    },
  ],
};

const DEMO_CLIENTS = [
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
    reasons: ['IT/Tech vocabulary detected.', 'India-first priority applies.', 'Strong candidate supply exists.'],
    blockers: [],
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
    reasons: ['Blocked: non-tech/HRMS/payroll language found.'],
    blockers: ['non_tech_signal'],
  },
];

const DEMO_CONTACTS = [
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
    contactCandidates: [
      { id: 'contact-demo-1', name: 'Asha Rao', title: 'Head of Talent Acquisition', email: 'asha@bengalurucloud.example', source: 'prior_wizmatch_signal', status: 'needs_review', rankingScore: 94, reasons: ['Decision-maker title fit.', 'Existing relationship signal found.'] },
      { id: 'contact-demo-2', name: 'Ravi Mehta', title: 'Engineering Manager', email: 'ravi@bengalurucloud.example', source: 'internal_crm', status: 'needs_review', rankingScore: 86, reasons: ['Technical hiring title fit.', 'Verified internal channel.'] },
    ],
    reasons: ['Strong IT/Tech signal.', 'India-first priority applies.', 'Reusable CRM contacts found.'],
    hardBlocks: [],
  },
  {
    companyId: 'demo-2',
    companyName: 'US Prime Systems',
    companyDomain: 'usprime.example',
    targetRegion: 'us',
    qualificationTier: 'B',
    qualificationScore: 71,
    companyStatus: 'discovery_blocked',
    discoveryRunStatus: 'blocked_by_cap',
    componentScores: {
      itTechFit: 22,
      signalQuality: 14,
      regionPriority: 10,
      candidateSupply: 10,
      relationshipValue: 7,
      safetyAndDeliverability: 8,
    },
    contactCandidates: [],
    reasons: ['US signal allowed by value evidence.', 'Paid discovery blocked in Phase 1.'],
    hardBlocks: [],
  },
];

const DEMO_CANDIDATES = [
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
    topRequirementMatches: [{ requirementId: 'req-demo-1', title: 'Java Backend Developer', companyName: 'Masked client', score: 91, priority: 'hot', matchedSkills: ['java', 'spring', 'aws'], missingSkills: ['kubernetes'], reasons: ['Strong required-skill overlap.'] }],
    reasons: ['Strong skill overlap with active demand.', 'India candidate supply priority applies.', 'Candidate is available.'],
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
    bestUse: 'Manual review only',
    componentScores: { skillFit: 22, availability: 0, regionWorkModeFit: 15, rateBudgetFit: 3, profileQuality: 4, relationshipOutcome: 0, riskControls: 0 },
    topRequirementMatches: [],
    reasons: ['Useful skill overlap with active demand.'],
    concerns: ['Blocked because candidate is already placed.'],
    blockers: ['already_placed'],
  },
];

const SAMPLE_INTAKE_CSV = `name,email,phone,skills,location,visa_status,rate_hourly,rate_currency,availability_status,source,linkedin_url,resume_url
Aarav Kumar,aarav@example.com,9876543210,"Java; Spring; AWS",Hyderabad India,,2400,INR,available,manual_intake,https://linkedin.com/in/aarav,https://example.com/aarav.pdf
Neha Shah,neha@example.com,,"QA Automation; Selenium; Java",Pune India,,1800,INR,available,manual_intake,,`;

const DEMO_ROI = {
  kpis: {
    prioritySignalRate: 31,
    indiaSignalShare: 82,
    matchRate: 54,
    positiveReplyRate: 12,
    contactApprovalRate: 63,
    requirementCoverage: 67,
    placementStartRate: 18,
    monthlyMargin: 384000,
    estimatedAnnualRunRate: 4608000,
    costCentsTotal: 0,
  },
  funnel: [
    { stage: 'Signals captured', count: 126, conversionFromPrevious: null, status: 'healthy' },
    { stage: 'Priority signals', count: 39, conversionFromPrevious: 31, status: 'watch' },
    { stage: 'Matched signals', count: 21, conversionFromPrevious: 53.8, status: 'healthy' },
    { stage: 'Drafted outreach', count: 10, conversionFromPrevious: 47.6, status: 'healthy' },
    { stage: 'Sent outreach', count: 7, conversionFromPrevious: 70, status: 'healthy' },
    { stage: 'Positive replies', count: 2, conversionFromPrevious: 28.6, status: 'watch' },
    { stage: 'Active placements', count: 1, conversionFromPrevious: 50, status: 'healthy' },
  ],
  moduleScorecards: [
    { module: 'Client Discovery', score: 89, status: 'healthy', summary: '39/126 signals are priority; India share is 82%.' },
    { module: 'Contact Intelligence', score: 100, status: 'healthy', summary: '5 approved contacts from 8 reviewed companies.' },
    { module: 'Candidate Intelligence', score: 76, status: 'healthy', summary: '64/92 candidates are available; 11 certified.' },
    { module: 'Requirement Intake', score: 100, status: 'healthy', summary: '6/9 open requirements have sheet/review coverage.' },
    { module: 'Placement ROI', score: 100, status: 'healthy', summary: '1 active placement; estimated monthly margin 384000.' },
  ],
  recommendations: [
    'Keep current guardrails: deterministic scoring, manual review, and qualified-only enrichment.',
    'Push urgent requirements through sheet/review readiness before widening discovery.',
  ],
  risks: ['No critical ROI risks detected from current deterministic metrics.'],
};

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatMinorCurrency(cents, currency = 'INR') {
  const value = Number(cents || 0) / 100;
  const prefix = currency === 'INR' ? 'Rs' : currency;
  return `${prefix} ${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function badgeFor(value) {
  return BADGE[value] || 'badge-muted';
}

function useLiveData({ demoMode, fallback, loadLive }) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setData(fallback);
      setLoading(false);
      return;
    }
    try {
      setData(await loadLive());
    } catch (e) {
      console.error(e);
      setData(fallback);
      setError(`${e.message || 'Failed to load live data'} - showing demo data`);
    } finally {
      setLoading(false);
    }
  }, [demoMode, fallback, loadLive]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, refresh: load };
}

function PageChrome({ eyebrow, title, description, demoMode, loading, error, onRefresh, primaryAction, children }) {
  return (
    <div className="min-h-screen bg-neutral-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <div className="card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-primary-600 via-primary-400 to-accent-500" />
          <div className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge-info">{eyebrow}</span>
                  <span className="badge-muted">Internal only</span>
                  <span className="badge-muted">IT/Tech staffing</span>
                  <span className="badge-muted">India 80 / US 20</span>
                  {demoMode && <span className="badge-accent">Demo data</span>}
                </div>
                <h1 className="mt-3 text-[22px] font-bold tracking-tight text-neutral-900">{title}</h1>
                <p className="mt-1 max-w-3xl text-[13px] leading-6 text-neutral-500">{description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {primaryAction}
                <button type="button" onClick={onRefresh} className="btn-standard btn-compact" disabled={loading}>
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
            {error}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, helper, tone = 'primary' }) {
  const toneClass = tone === 'success' ? 'text-success-600 bg-success-500/10' : tone === 'warning' ? 'text-warning-600 bg-warning-500/10' : tone === 'danger' ? 'text-danger-600 bg-danger-500/10' : 'text-primary-700 bg-primary-500/10';
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
          <p className="mt-2 text-[26px] font-bold leading-none tracking-tight text-neutral-900">{value}</p>
          {helper && <p className="mt-2 text-[12px] text-neutral-400">{helper}</p>}
        </div>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function ScoreRing({ score, label }) {
  const value = Math.max(0, Math.min(100, Number(score || 0)));
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-14 w-14 place-items-center rounded-full"
        style={{ background: `conic-gradient(#2563eb ${value * 3.6}deg, #e2e8f0 0deg)` }}
      >
        <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-sm font-bold text-neutral-900">{value}</div>
      </div>
      <div>
        <p className="text-sm font-semibold text-neutral-900">{label}</p>
        <p className="text-[12px] text-neutral-500">Deterministic score</p>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, max }) {
  const pct = Math.min(100, Math.round((Number(value || 0) / Math.max(max, 1)) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-neutral-600">{label}</span>
        <span className="font-semibold text-neutral-800">{value || 0}/{max}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmptyPanel({ title, description }) {
  return (
    <div className="card p-8 text-center">
      <ShieldCheck className="mx-auto h-8 w-8 text-neutral-300" />
      <p className="mt-3 font-semibold text-neutral-800">{title}</p>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
    </div>
  );
}

function Reasons({ reasons = [], blockers = [] }) {
  return (
    <div className="space-y-2">
      {reasons.slice(0, 5).map((reason) => (
        <p key={reason} className="flex gap-2 rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success-600" />
          <span>{reason}</span>
        </p>
      ))}
      {blockers.slice(0, 4).map((blocker) => (
        <p key={blocker} className="flex gap-2 rounded-md bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{blocker.replace(/_/g, ' ')}</span>
        </p>
      ))}
    </div>
  );
}

function GuardrailStrip() {
  const items = [
    'Paid enrichment off',
    'Manual approval before outreach',
    'Deterministic before AI',
    'No auto submissions',
  ];
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12.5px] font-medium text-neutral-700 shadow-card">
          <ShieldCheck className="h-4 w-4 text-primary-600" />
          {item}
        </div>
      ))}
    </div>
  );
}

function ListButton({ selected, title, subtitle, score, priority, meta, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border bg-white p-4 text-left shadow-card transition hover:border-primary-200 hover:shadow-hover ${selected ? 'border-primary-300 ring-2 ring-primary-100' : 'border-neutral-200'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900">{title}</p>
          <p className="mt-1 truncate text-[12.5px] text-neutral-500">{subtitle}</p>
        </div>
        <span className="inline-flex min-w-10 items-center justify-center rounded-md bg-neutral-900 px-2.5 py-2 text-sm font-bold text-white">
          {score}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={badgeFor(priority)}>{priority || 'watch'}</span>
        {(meta || []).filter(Boolean).slice(0, 3).map((item) => (
          <span key={item} className="badge-muted">{item}</span>
        ))}
      </div>
    </button>
  );
}

function DetailShell({ title, subtitle, badge, score, children }) {
  return (
    <div className="card min-h-[560px] p-5">
      <div className="flex flex-col gap-4 border-b border-neutral-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {badge && <span className={badgeFor(badge)}>{String(badge).replace(/_/g, ' ')}</span>}
            <span className="badge-muted">safe manual workflow</span>
          </div>
          <h2 className="mt-3 text-lg font-bold text-neutral-900">{title}</h2>
          <p className="mt-1 text-[12.5px] text-neutral-500">{subtitle}</p>
        </div>
        <ScoreRing score={score} label="Readiness" />
      </div>
      <div className="pt-5">{children}</div>
    </div>
  );
}

function MiniTable({ rows, columns }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200">
      <table className="table-fluent">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id || row.requirementId || row.stage || row.module || row.name}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WizmatchCommandCenterNewPage({ demoMode = false }) {
  const fallback = useMemo(() => DEMO_COMMAND, []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(() => apiFetch('/api/wizmatch/command-center'), []),
  });
  const metrics = data.metrics || {};
  const queue = data.commandQueue || [];

  return (
    <PageChrome
      eyebrow="Wizmatch HQ"
      title="Command Center"
      description="A denser CRM-native control room for company signals, contact review, candidate readiness, requirement coverage, and safety blockers."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <GuardrailStrip />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Search} label="Active signals" value={metrics.activeSignals || 0} helper={`${metrics.prioritySignals || 0} priority`} />
        <Metric icon={Users} label="Available candidates" value={metrics.availableCandidates || 0} helper="Candidate pool" tone="success" />
        <Metric icon={Contact} label="Contact reviews" value={metrics.reviewReadyCompanies || 0} helper={`${metrics.blockedCompanies || 0} blocked`} tone="warning" />
        <Metric icon={Target} label="Open requirements" value={metrics.openRequirements || 0} helper={`${metrics.activePlacements || 0} active placements`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-neutral-900">Module Health</h2>
              <p className="text-[12.5px] text-neutral-500">Where the operating system needs attention.</p>
            </div>
            <span className="badge-muted">{data.moduleHealth?.length || 0} modules</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {(data.moduleHealth || []).map((item) => (
              <div key={item.module} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-neutral-900">{item.module}</p>
                    <p className="mt-1 text-[12.5px] leading-5 text-neutral-500">{item.summary}</p>
                  </div>
                  <span className={badgeFor(item.priority)}>{item.priority}</span>
                </div>
                <div className="mt-3">
                  <span className={badgeFor(item.status)}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-900">Next Best Actions</h2>
          </div>
          <div className="space-y-3">
            {queue.map((item) => (
              <div key={item.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{item.title}</p>
                    <p className="mt-1 text-[12px] text-neutral-500">{item.subtitle}</p>
                  </div>
                  <span className={badgeFor(item.priority)}>{item.priority}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="badge-muted">{item.module}</span>
                  <span className="badge-muted">{item.actionType?.replace(/_/g, ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageChrome>
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
  const [expanded, setExpanded] = useState(false);

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
        text: 'Demo mode - nothing was saved. Live mode seeds a company + manual job signal + runs Contact Intelligence snapshot.',
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
          ? 'Existing company updated + new signal added. Refreshing queue...'
          : 'Prospect company seeded + Contact Intelligence snapshot created. Refreshing queue...',
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
      setCsvStatus({ kind: 'ok', text: 'Demo mode - CSV not uploaded.' });
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
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary-600" />
          <h2 className="text-[15px] font-bold text-neutral-900">Seed prospect hiring company</h2>
        </div>
        <span className="text-[12px] font-semibold text-neutral-500">{expanded ? 'Hide' : 'Expand'}</span>
      </button>
      <p className="mt-2 text-[12px] text-neutral-500">
        Manually add an actively-hiring company + one open role. Creates the company record, a manual
        job signal, and auto-runs the Contact Intelligence snapshot so it enters the review queue.
        No outreach is sent.
      </p>

      {expanded && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
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
                placeholder="https://..."
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
              {submitting ? 'Seeding...' : 'Seed prospect'}
            </button>
            {status.text && (
              <span className={`text-[12.5px] ${status.kind === 'error' ? 'text-danger-700' : 'text-success-700'}`}>
                {status.text}
              </span>
            )}
          </div>

          <div className="mt-5 border-t border-neutral-100 pt-4">
            <div className="mb-2 flex items-center gap-2">
              <Upload className="h-4 w-4 text-neutral-500" />
              <span className="text-[12.5px] font-semibold text-neutral-800">Bulk import CSV</span>
            </div>
            <p className="mb-2 text-[11.5px] text-neutral-500">
              Headers accepted: <code>company_name</code>, <code>job_title</code> (required);
              optional <code>website</code>, <code>job_url</code>, <code>location</code>,{' '}
              <code>target_region</code>, <code>industry</code>, <code>employee_count</code>,{' '}
              <code>linkedin_url</code>, <code>keywords</code>, <code>notes</code>.
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
                {csvSubmitting ? 'Uploading...' : 'Upload CSV'}
              </button>
              {csvStatus && (
                <span className={`text-[12.5px] ${csvStatus.kind === 'error' ? 'text-danger-700' : 'text-success-700'}`}>
                  {csvStatus.text}
                </span>
              )}
            </div>
            {csvStatus?.errors?.length > 0 && (
              <div className="mt-2 max-h-40 overflow-auto rounded-md border border-warning-200 bg-warning-50 p-2 text-[11.5px] text-warning-800">
                <p className="mb-1 font-semibold">Row errors:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {csvStatus.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>Row {e.row}: {e.reason}</li>
                  ))}
                  {csvStatus.errors.length > 20 && (
                    <li>...and {csvStatus.errors.length - 20} more.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function WizmatchClientDiscoveryNewPage({ demoMode = false }) {
  const fallback = useMemo(() => ({ items: DEMO_CLIENTS }), []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(async () => {
      const result = await apiFetch('/api/wizmatch/client-discovery/queue?limit=75');
      return { items: result.items || [] };
    }, []),
  });
  const items = data.items || [];
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0], [items, selectedId]);
  const summary = useMemo(() => ({
    hot: items.filter((item) => item.priority === 'hot').length,
    warm: items.filter((item) => item.priority === 'warm').length,
    blocked: items.filter((item) => item.priority === 'blocked').length,
  }), [items]);

  return (
    <PageChrome
      eyebrow="Company Signals"
      title="Client Discovery"
      description="Qualification-first discovery for IT/Tech companies, with India-first scoring and no paid enrichment before review."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={Building2} label="Signals" value={items.length} helper="Current queue" />
        <Metric icon={Target} label="Hot" value={summary.hot} helper="Move now" tone="success" />
        <Metric icon={Brain} label="Warm" value={summary.warm} helper="Review next" />
        <Metric icon={AlertTriangle} label="Blocked" value={summary.blocked} helper="Do not enrich" tone="danger" />
      </div>

      <SeedProspectPanel demoMode={demoMode} onSeeded={refresh} />

      <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="space-y-3">
          {items.length ? items.map((item) => (
            <ListButton
              key={item.id}
              selected={selected?.id === item.id}
              title={item.companyName}
              subtitle={item.jobTitle}
              score={item.score}
              priority={item.priority}
              meta={[item.region?.toUpperCase(), `${item.matchedCandidateCount || 0} candidates`, item.source]}
              onClick={() => setSelectedId(item.id)}
            />
          )) : <EmptyPanel title="No signals" description="Client Discovery has no queue items yet." />}
        </div>

        {selected && (
          <DetailShell title={selected.companyName} subtitle={`${selected.companyDomain || 'No domain'} - ${selected.jobTitle}`} badge={selected.priority} score={selected.score}>
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <ScoreBar label="IT/Tech fit" value={selected.componentScores?.itTechFit} max={25} />
                  <ScoreBar label="Signal strength" value={selected.componentScores?.signalStrength} max={20} />
                  <ScoreBar label="India/US priority" value={selected.componentScores?.regionPriority} max={15} />
                  <ScoreBar label="Candidate supply" value={selected.componentScores?.candidateSupply} max={15} />
                  <ScoreBar label="Relationship value" value={selected.componentScores?.relationshipValue} max={15} />
                  <ScoreBar label="Safety" value={selected.componentScores?.safety} max={10} />
                </div>
                <Reasons reasons={selected.reasons} blockers={selected.blockers} />
              </div>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">Safe next step</p>
                <p className="mt-2 text-sm font-semibold text-neutral-900">
                  {selected.priority === 'blocked' ? 'Reject or hold. No enrichment.' : 'Send to Contact Intelligence review.'}
                </p>
                <p className="mt-2 text-[12.5px] leading-5 text-neutral-500">
                  Keep this manual. Use the Review Workbench to run approved handoff actions without paid enrichment or auto-sending.
                </p>
                <a className="btn-standard btn-compact mt-4" href="/wizmatch/review-workbench">
                  Open Review Workbench
                </a>
              </div>
            </div>
          </DetailShell>
        )}
      </div>
    </PageChrome>
  );
}

export function WizmatchContactIntelligenceNewPage({ demoMode = false }) {
  const fallback = useMemo(() => ({
    items: DEMO_CONTACTS,
    costControls: {
      paidDiscoveryEnabled: false,
      googleFallbackEnabled: false,
      maxPaidDiscoveryPerCompany: 1,
      maxContactCandidatesShown: 3,
      rediscoveryCooldownDays: 30,
      costGuard: null,
    },
  }), []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(async () => {
      const result = await apiFetch('/api/wizmatch/contact-intelligence/queue?limit=50');
      return { items: result.items || [], costControls: result.costControls };
    }, []),
  });
  const items = data.items || [];
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => items.find((item) => item.companyId === selectedId) || items[0], [items, selectedId]);
  const [preview, setPreview] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  // Outreach compose/send state
  const [templates, setTemplates] = useState([]);
  const [composeFor, setComposeFor] = useState(null);        // candidateId currently being composed
  const [composeTemplateId, setComposeTemplateId] = useState('');
  const [composeDraft, setComposeDraft] = useState(null);    // { draftId, subject, body, to }
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeMsg, setComposeMsg] = useState('');

  useEffect(() => {
    setPreview(null);
    setActionMessage('');
    setComposeFor(null);
    setComposeDraft(null);
    setComposeMsg('');
  }, [selected?.companyId]);

  useEffect(() => {
    if (demoMode) return;
    apiFetch('/api/wizmatch/outreach-templates')
      .then((r) => {
        setTemplates(r.templates || []);
        if (r.templates?.[0]) setComposeTemplateId(r.templates[0].id);
      })
      .catch(() => {});
  }, [demoMode]);

  const reviewContact = async (candidateId, action) => {
    setComposeBusy(true); setComposeMsg('');
    try {
      await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidateId}/review`, {
        method: 'POST', body: JSON.stringify({ action }),
      });
      setComposeMsg(action === 'approve_contact' ? 'Contact approved.' : action === 'reject_contact' ? 'Contact rejected.' : 'Marked do-not-contact.');
      await refresh();
    } catch (e) { setComposeMsg(e.message || 'Action failed.'); } finally { setComposeBusy(false); }
  };

  const composeContact = async (candidateId, polish = false) => {
    if (!composeTemplateId) { setComposeMsg('Create/pick a template first.'); return; }
    setComposeBusy(true); setComposeMsg('');
    try {
      const r = await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidateId}/compose`, {
        method: 'POST', body: JSON.stringify({ templateId: composeTemplateId, polish }),
      });
      setComposeDraft({ draftId: r.draftId, subject: r.subject, body: r.body, to: r.to });
      setComposeMsg(polish ? 'Draft composed (AI-polished). Review before sending.' : 'Draft composed. Review before sending.');
    } catch (e) { setComposeMsg(e.message || 'Compose failed.'); } finally { setComposeBusy(false); }
  };

  const sendContact = async (candidateId) => {
    if (!composeDraft?.draftId) return;
    setComposeBusy(true); setComposeMsg('');
    try {
      const r = await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidateId}/send`, {
        method: 'POST', body: JSON.stringify({ draftId: composeDraft.draftId, body: composeDraft.body }),
      });
      setComposeMsg(`✅ Sent from ${r.from}.`);
      setComposeDraft(null); setComposeFor(null);
      await refresh();
    } catch (e) { setComposeMsg(e.message || 'Send failed (is WIZMATCH_SENDING_ENABLED set?).'); } finally { setComposeBusy(false); }
  };

  const runPreview = async () => {
    if (!selected) return;
    setActionBusy(true);
    setActionMessage('');
    try {
      if (demoMode) {
        const blockedReasons = data.costControls?.paidDiscoveryEnabled ? [] : ['Paid discovery is disabled by WIZMATCH_PAID_DISCOVERY_ENABLED.'];
        setPreview({
          eligible: blockedReasons.length === 0,
          status: blockedReasons.length === 0 ? 'ready_for_manual_paid_discovery' : 'paid_discovery_disabled',
          estimatedCostCents: blockedReasons.length === 0 ? 3200 : 0,
          providerOrder: ['internal_crm_reuse', 'company_metadata', 'website_manual_pattern', 'apollo', 'snov', 'reacher_verification', 'google_fallback'],
          capStatus: { ...(data.costControls || {}), paidRunsInCooldown: 0, cooldownUntil: null },
          costGuard: {
            allowed: blockedReasons.length === 0,
            currency: 'INR',
            estimatedCostCents: blockedReasons.length === 0 ? 3200 : 0,
            budget: {
              month: { usedCents: 0, limitCents: 500000, remainingCents: 500000 },
              day: { usedCents: 0, limitCents: 50000, remainingCents: 50000 },
              userDayRuns: { used: 0, limit: 5, remaining: 5 },
              tenantDayRuns: { used: 0, limit: 20, remaining: 20 },
              providerDayCalls: {
                apollo: { used: 0, limit: 50, remaining: 50, estimated: 1 },
                snov: { used: 0, limit: 50, remaining: 50, estimated: 1 },
                reacher: { used: 0, limit: 150, remaining: 150, estimated: 3 },
                googleFallback: { used: 0, limit: 25, remaining: 25, estimated: 1 },
              },
            },
            providerEnv: { missing: blockedReasons.length === 0 ? [] : ['provider env disabled in demo'] },
          },
          blockedReasons,
          notes: ['Demo preview only. No provider calls are made.', 'Discovery never sends outreach.'],
        });
        setActionMessage('Demo preview prepared.');
      } else {
        const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/discovery-preview`, { method: 'POST', body: JSON.stringify({}) });
        setPreview(result.preview);
        setActionMessage(result.preview?.eligible ? 'Preview ready. Manual discovery can be run after review.' : 'Preview blocked. Review the reasons before proceeding.');
      }
    } catch (e) {
      setActionMessage(e.message || 'Discovery preview failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const runDiscovery = async () => {
    if (!selected || !preview?.eligible) return;
    setActionBusy(true);
    setActionMessage('');
    try {
      if (demoMode) {
        setActionMessage('Demo discovery completed. No paid providers were called.');
      } else {
        const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/discover`, {
          method: 'POST',
          body: JSON.stringify({ confirmPreview: true }),
        });
        setPreview(result.preview || preview);
        setActionMessage(`Discovery ${result.status}. ${result.contactCandidates?.length || 0} reviewable contacts now available.`);
        await refresh();
      }
    } catch (e) {
      setActionMessage(e.message || 'Discovery run failed.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <PageChrome
      eyebrow="Contact Review"
      title="Contact Intelligence"
      description="Ranked company-contact review with CRM reuse first, preview-first paid discovery, and manual approval before any outreach."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={Building2} label="Companies" value={items.length} helper="Qualified queue" />
        <Metric icon={Contact} label="Candidates shown" value={items.reduce((sum, item) => sum + (item.contactCandidates?.length || 0), 0)} helper="Max 3/company" />
        <Metric icon={DatabaseZap} label="Paid discovery" value={data.costControls?.paidDiscoveryEnabled ? 'Manual' : 'Off'} helper={`${data.costControls?.maxPaidDiscoveryPerCompany ?? 1}/company cap`} tone={data.costControls?.paidDiscoveryEnabled ? 'success' : 'neutral'} />
        <Metric icon={ShieldCheck} label="Cooldown" value={`${data.costControls?.rediscoveryCooldownDays || 30}d`} helper="Rediscovery guardrail" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="space-y-3">
          {items.length ? items.map((item) => (
            <ListButton
              key={item.companyId}
              selected={selected?.companyId === item.companyId}
              title={item.companyName}
              subtitle={`${item.companyDomain || 'No domain'} - ${item.targetRegion?.toUpperCase()}`}
              score={item.qualificationScore}
              priority={item.companyStatus}
              meta={[`Tier ${item.qualificationTier}`, `${item.contactCandidates?.length || 0} contacts`, item.discoveryRunStatus]}
              onClick={() => setSelectedId(item.companyId)}
            />
          )) : <EmptyPanel title="No companies" description="Contact Intelligence has no review items yet." />}
        </div>

        {selected && (
          <DetailShell title={selected.companyName} subtitle={`${selected.companyDomain || 'No domain'} - Tier ${selected.qualificationTier}`} badge={selected.companyStatus} score={selected.qualificationScore}>
            <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <ScoreBar label="IT/Tech fit" value={selected.componentScores?.itTechFit} max={25} />
                  <ScoreBar label="Signal quality" value={selected.componentScores?.signalQuality} max={20} />
                  <ScoreBar label="India/US priority" value={selected.componentScores?.regionPriority} max={15} />
                  <ScoreBar label="Candidate supply" value={selected.componentScores?.candidateSupply} max={15} />
                  <ScoreBar label="Relationship value" value={selected.componentScores?.relationshipValue} max={15} />
                  <ScoreBar label="Safety/deliverability" value={selected.componentScores?.safetyAndDeliverability} max={10} />
                </div>
                <Reasons reasons={selected.reasons} blockers={selected.hardBlocks} />
                <div className="rounded-lg border border-neutral-200 bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">Discovery preview</p>
                      <p className="text-[12.5px] text-neutral-500">Preview first. Run discovery only after reviewing caps, eligibility, and provider order.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-standard btn-compact" type="button" disabled={actionBusy} onClick={runPreview}>Discovery Preview</button>
                      <button className="btn-primary btn-compact" type="button" disabled={actionBusy || !preview?.eligible} onClick={runDiscovery}>Run discovery</button>
                    </div>
                  </div>
                  {preview ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={badgeFor(preview.status)}>{preview.status?.replace(/_/g, ' ')}</span>
                        <span className="badge-muted">Estimated cost {formatMinorCurrency(preview.estimatedCostCents, preview.costGuard?.currency)}</span>
                        <span className="badge-muted">Cooldown {preview.capStatus?.rediscoveryCooldownDays || 30}d</span>
                        {preview.costGuard?.providerEnv?.missing?.length > 0 && <span className="badge-danger">Provider env missing</span>}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-md bg-neutral-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Provider order</p>
                          <p className="mt-1 text-sm text-neutral-800">{(preview.providerOrder || []).map((item) => item.replace(/_/g, ' ')).join(' -> ')}</p>
                        </div>
                        <div className="rounded-md bg-neutral-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Caps</p>
                          <p className="mt-1 text-sm text-neutral-800">Paid runs {preview.capStatus?.paidRunsInCooldown || 0}/{preview.capStatus?.maxPaidDiscoveryPerCompany ?? 1} · Google {preview.capStatus?.googleFallbackEnabled ? 'on' : 'off'}</p>
                        </div>
                      </div>
                      {preview.costGuard?.budget && (
                        <div className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Cost controls</p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <p className="text-[12.5px] text-neutral-700">Month: {formatMinorCurrency(preview.costGuard.budget.month.usedCents, preview.costGuard.currency)} / {formatMinorCurrency(preview.costGuard.budget.month.limitCents, preview.costGuard.currency)}</p>
                            <p className="text-[12.5px] text-neutral-700">Today: {formatMinorCurrency(preview.costGuard.budget.day.usedCents, preview.costGuard.currency)} / {formatMinorCurrency(preview.costGuard.budget.day.limitCents, preview.costGuard.currency)}</p>
                            <p className="text-[12.5px] text-neutral-700">Your runs: {preview.costGuard.budget.userDayRuns.used}/{preview.costGuard.budget.userDayRuns.limit}</p>
                            <p className="text-[12.5px] text-neutral-700">Tenant runs: {preview.costGuard.budget.tenantDayRuns.used}/{preview.costGuard.budget.tenantDayRuns.limit}</p>
                          </div>
                          <p className="mt-2 text-[12px] text-neutral-500">
                            Provider calls today: Apollo {preview.costGuard.budget.providerDayCalls?.apollo?.used || 0}/{preview.costGuard.budget.providerDayCalls?.apollo?.limit || 0} · Snov {preview.costGuard.budget.providerDayCalls?.snov?.used || 0}/{preview.costGuard.budget.providerDayCalls?.snov?.limit || 0} · Reacher {preview.costGuard.budget.providerDayCalls?.reacher?.used || 0}/{preview.costGuard.budget.providerDayCalls?.reacher?.limit || 0} · Google {preview.costGuard.budget.providerDayCalls?.googleFallback?.used || 0}/{preview.costGuard.budget.providerDayCalls?.googleFallback?.limit || 0}
                          </p>
                        </div>
                      )}
                      {preview.costGuard?.providerEnv?.missing?.length > 0 && (
                        <p className="rounded-md bg-warning-50 px-3 py-2 text-[12.5px] text-warning-800">Missing provider env: {preview.costGuard.providerEnv.missing.join(', ')}</p>
                      )}
                      {(preview.blockedReasons || []).length > 0 && (
                        <div className="space-y-1.5">
                          {preview.blockedReasons.map((reason) => <p key={reason} className="rounded-md bg-danger-50 px-3 py-2 text-[12.5px] text-danger-800">{reason}</p>)}
                        </div>
                      )}
                      {(preview.notes || []).map((note) => <p key={note} className="text-[12px] text-neutral-500">{note}</p>)}
                    </div>
                  ) : (
                    <EmptyPanel title="Preview not run yet" description="Run Discovery Preview to see eligibility, estimated cost, provider order, cooldown, and blocked reasons." />
                  )}
                  {actionMessage && <p className="mt-3 rounded-md bg-primary-50 px-3 py-2 text-[12.5px] text-primary-700">{actionMessage}</p>}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-neutral-900">Recommended contacts</p>
                  <span className="badge-muted">Review only</span>
                </div>
                <div className="space-y-3">
                  {(selected.contactCandidates || []).length ? selected.contactCandidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-neutral-900">{candidate.name}</p>
                          <p className="text-[12.5px] text-neutral-500">{candidate.title || 'Title needs review'}</p>
                        </div>
                        <span className="rounded-md bg-neutral-900 px-2.5 py-2 text-sm font-bold text-white">{candidate.rankingScore}</span>
                      </div>
                      <p className="mt-2 text-[12px] text-neutral-500">{candidate.email || 'No email'} - {candidate.source?.replace(/_/g, ' ')} - {candidate.deliverabilityStatus || 'unknown'}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {candidate.team && candidate.team !== 'Generic inbox' && <span className="badge-info">{candidate.team}</span>}
                        {candidate.team === 'Generic inbox' && <span className="badge-warning">Generic inbox</span>}
                        {candidate.confidenceTier && <span className={badgeFor(candidate.confidenceTier)}>{candidate.confidenceTier} confidence</span>}
                        {candidate.mxProvider === 'google' && <span className="badge-muted">Google Workspace</span>}
                        {candidate.mxProvider === 'microsoft' && <span className="badge-muted">Microsoft 365</span>}
                        <span className={badgeFor(candidate.status)}>{candidate.status?.replace(/_/g, ' ')}</span>
                        {candidate.linkedinUrl && <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer" className="badge-muted underline">LinkedIn</a>}
                        {(candidate.reasons || []).slice(0, 2).map((reason) => <span key={reason} className="badge-muted">{reason}</span>)}
                      </div>
                      {candidate.confidenceTier && CONFIDENCE_TIER_HELP[candidate.confidenceTier] && (
                        <p className="mt-1.5 text-[11.5px] text-neutral-400">{CONFIDENCE_TIER_HELP[candidate.confidenceTier]}</p>
                      )}

                      {!demoMode && candidate.email && (
                        <div className="mt-3 border-t border-neutral-100 pt-2.5">
                          <div className="flex flex-wrap gap-2">
                            {candidate.status !== 'approved' && candidate.status !== 'linked_to_crm' && (
                              <button className="btn-standard btn-compact" type="button" disabled={composeBusy} onClick={() => reviewContact(candidate.id, 'approve_contact')}>Approve</button>
                            )}
                            {candidate.status !== 'rejected' && (
                              <button className="btn-standard btn-compact" type="button" disabled={composeBusy} onClick={() => reviewContact(candidate.id, 'reject_contact')}>Reject</button>
                            )}
                            {(candidate.status === 'approved' || candidate.status === 'linked_to_crm') && (
                              <button className="btn-primary btn-compact" type="button" disabled={composeBusy} onClick={() => { setComposeFor(composeFor === candidate.id ? null : candidate.id); setComposeDraft(null); setComposeMsg(''); }}>
                                {composeFor === candidate.id ? 'Close' : 'Compose & Send'}
                              </button>
                            )}
                          </div>

                          {composeFor === candidate.id && (
                            <div className="mt-2.5 rounded-md border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <select className="input-compact" value={composeTemplateId} onChange={(e) => setComposeTemplateId(e.target.value)}>
                                  {templates.length === 0 && <option value="">No templates — create one first</option>}
                                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                                <button className="btn-standard btn-compact" type="button" disabled={composeBusy || !composeTemplateId} onClick={() => composeContact(candidate.id, false)}>Generate</button>
                                <button className="btn-standard btn-compact" type="button" disabled={composeBusy || !composeTemplateId} onClick={() => composeContact(candidate.id, true)}>AI polish</button>
                              </div>
                              {composeDraft && (
                                <div className="space-y-1.5">
                                  <p className="text-[12px] text-neutral-500">To: {composeDraft.to} · Subject: <span className="font-medium text-neutral-800">{composeDraft.subject}</span></p>
                                  <textarea className="input-compact w-full h-32 font-mono text-[12px]" value={composeDraft.body} onChange={(e) => setComposeDraft({ ...composeDraft, body: e.target.value })} />
                                  <button className="btn-primary btn-compact" type="button" disabled={composeBusy} onClick={() => sendContact(candidate.id)}>Send email</button>
                                </div>
                              )}
                              {composeMsg && <p className="text-[12px] text-primary-700">{composeMsg}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )) : (
                    <EmptyPanel title="No contacts yet" description="Run preview first. If eligible and enabled, manual discovery can create up to 3 reviewable candidates without sending outreach." />
                  )}
                </div>
              </div>
            </div>
          </DetailShell>
        )}
      </div>
    </PageChrome>
  );
}

export function WizmatchCandidateIntelligenceNewPage({ demoMode = false }) {
  const fallback = useMemo(() => ({ items: DEMO_CANDIDATES }), []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(async () => {
      const result = await apiFetch('/api/wizmatch/candidate-intelligence/queue?limit=75');
      return { items: result.items || [] };
    }, []),
  });
  const items = data.items || [];
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0], [items, selectedId]);
  const [intakeText, setIntakeText] = useState('');
  const [intakeLoading, setIntakeLoading] = useState('');
  const [intakeResult, setIntakeResult] = useState(null);

  const runIntake = useCallback(async ({ dryRun }) => {
    if (!intakeText.trim()) {
      setIntakeResult({ error: 'Paste candidate CSV text first.' });
      return;
    }
    setIntakeLoading(dryRun ? 'preview' : 'import');
    setIntakeResult(null);
    try {
      if (demoMode) {
        const accepted = Math.max(0, intakeText.trim().split(/\r?\n/).length - 1);
        setIntakeResult({
          dryRun,
          accepted,
          inserted: dryRun ? 0 : accepted,
          skipped: 0,
          duplicates: 0,
          errors: 0,
          message: dryRun
            ? 'Demo preview only. No records were written.'
            : 'Demo import simulated locally. No records were written.',
          preview: DEMO_CANDIDATES.slice(0, 2).map((item, index) => ({ row: index + 1, profile: item, score: item })),
        });
        return;
      }
      const result = await apiFetch('/api/wizmatch/candidate-intelligence/intake', {
        method: 'POST',
        body: JSON.stringify({
          rawText: intakeText,
          dryRun,
          confirmImport: !dryRun,
        }),
      });
      setIntakeResult(result);
      if (!dryRun) await refresh();
    } catch (e) {
      setIntakeResult({ error: e.message || 'Candidate intake failed' });
    } finally {
      setIntakeLoading('');
    }
  }, [demoMode, intakeText, refresh]);

  return (
    <PageChrome
      eyebrow="Candidate Readiness"
      title="Candidate Intelligence"
      description="Requirement-fit scoring for IT/Tech candidates, with duplicate and availability blockers visible before any submission."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
      primaryAction={<button type="button" className="btn-standard btn-compact" onClick={() => setIntakeText(SAMPLE_INTAKE_CSV)}>Use sample CSV</button>}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={Users} label="Candidates" value={items.length} helper="Current pool" />
        <Metric icon={Target} label="Hot" value={items.filter((item) => item.priority === 'hot').length} helper="Shortlist first" tone="success" />
        <Metric icon={ClipboardList} label="Warm" value={items.filter((item) => item.priority === 'warm').length} helper="Useful next" />
        <Metric icon={AlertTriangle} label="Blocked" value={items.filter((item) => item.priority === 'blocked').length} helper="Do not submit" tone="danger" />
      </div>

      <div className="card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase text-primary-700">Candidate Profile Intake</p>
            <h2 className="mt-1 text-base font-bold text-neutral-900">Paste vetted IT/Tech candidate profiles</h2>
            <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-neutral-500">
              Manual-only intake for real candidate profiles. Preview scores first, then import CRM contacts and Wizmatch candidate records. No outreach, submission, placement, provider call, or automation is created.
            </p>
          </div>
          <span className="badge-muted self-start">Max 50 profiles/import</span>
        </div>

        <textarea
          className="mt-4 min-h-[128px] w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm font-mono text-neutral-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
          value={intakeText}
          onChange={(event) => setIntakeText(event.target.value)}
          placeholder="name,email,phone,skills,location,visa_status,rate_hourly,rate_currency,availability_status,source,linkedin_url,resume_url"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-standard btn-compact"
            disabled={Boolean(intakeLoading)}
            onClick={() => runIntake({ dryRun: true })}
          >
            <Eye className="h-3.5 w-3.5" /> {intakeLoading === 'preview' ? 'Previewing...' : 'Preview scores'}
          </button>
          <button
            type="button"
            className="btn-primary btn-compact"
            disabled={Boolean(intakeLoading)}
            onClick={() => runIntake({ dryRun: false })}
          >
            <Upload className="h-3.5 w-3.5" /> {intakeLoading === 'import' ? 'Importing...' : 'Import candidates'}
          </button>
          <span className="text-[12px] text-neutral-500">Duplicates by existing CRM contact are skipped.</span>
        </div>

        {intakeResult && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${intakeResult.error ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-primary-100 bg-primary-50 text-primary-800'}`}>
            <p className="font-semibold">{intakeResult.error || intakeResult.message || 'Candidate intake result'}</p>
            {!intakeResult.error && (
              <>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="badge-muted">Accepted {intakeResult.accepted || 0}</span>
                  <span className="badge-success">Inserted {intakeResult.inserted || 0}</span>
                  <span className="badge-warning">Duplicates {intakeResult.duplicates || 0}</span>
                  <span className="badge-muted">Skipped {intakeResult.skipped || 0}</span>
                  <span className="badge-danger">Errors {intakeResult.errors || 0}</span>
                </div>
                {(intakeResult.preview || []).length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {intakeResult.preview.slice(0, 6).map((row) => (
                      <div key={`${row.row}-${row.profile?.name}`} className="rounded-md border border-primary-100 bg-white/80 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-neutral-900">{row.profile?.name}</p>
                            <p className="text-[12px] text-neutral-500">{row.profile?.location || 'No location'} - {row.profile?.skills?.length || 0} skills</p>
                          </div>
                          <span className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-bold text-white">{row.score?.score ?? '-'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <div className="space-y-3">
          {items.length ? items.map((item) => (
            <ListButton
              key={item.id}
              selected={selected?.id === item.id}
              title={item.name}
              subtitle={item.bestUse}
              score={item.score}
              priority={item.priority}
              meta={[item.region?.toUpperCase(), item.availabilityStatus, `${item.skills?.length || 0} skills`]}
              onClick={() => setSelectedId(item.id)}
            />
          )) : <EmptyPanel title="No candidates" description="Candidate Intelligence has no queue items yet." />}
        </div>

        {selected && (
          <DetailShell title={selected.name} subtitle={`${selected.location || 'No location'} - ${selected.bestUse}`} badge={selected.priority} score={selected.score}>
            <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {(selected.skills || []).slice(0, 14).map((skill) => <span key={skill} className="badge-info">{skill}</span>)}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <ScoreBar label="Skill fit" value={selected.componentScores?.skillFit} max={30} />
                  <ScoreBar label="Availability" value={selected.componentScores?.availability} max={20} />
                  <ScoreBar label="Region/work mode" value={selected.componentScores?.regionWorkModeFit} max={15} />
                  <ScoreBar label="Rate/budget" value={selected.componentScores?.rateBudgetFit} max={10} />
                  <ScoreBar label="Profile quality" value={selected.componentScores?.profileQuality} max={10} />
                  <ScoreBar label="Risk controls" value={selected.componentScores?.riskControls} max={5} />
                </div>
                <Reasons reasons={selected.reasons} blockers={[...(selected.blockers || []), ...(selected.concerns || [])]} />
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-neutral-900">Requirement fit</p>
                  <span className="badge-muted">No auto-submit</span>
                </div>
                {(selected.topRequirementMatches || []).length ? (
                  <MiniTable
                    rows={selected.topRequirementMatches}
                    columns={[
                      { key: 'title', label: 'Requirement' },
                      { key: 'score', label: 'Score', render: (row) => <span className="font-bold text-neutral-900">{row.score}</span> },
                      { key: 'priority', label: 'Priority', render: (row) => <span className={badgeFor(row.priority)}>{row.priority}</span> },
                    ]}
                  />
                ) : (
                  <EmptyPanel title="No top match yet" description="Keep in pool or enrich candidate profile later." />
                )}
              </div>
            </div>
          </DetailShell>
        )}
      </div>
    </PageChrome>
  );
}

export function WizmatchAnalyticsNewPage({ demoMode = false }) {
  const fallback = useMemo(() => ({ roi: DEMO_ROI, digest: { stats: { signals_captured: 126, signals_priority: 39, sends: 7, positive_replies: 2 } } }), []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(async () => {
      const [roi, digest] = await Promise.all([
        apiFetch('/api/wizmatch/analytics/roi'),
        apiFetch('/api/wizmatch/digest'),
      ]);
      return { roi, digest };
    }, []),
  });
  const roi = data.roi || DEMO_ROI;
  const stats = data.digest?.stats || {};
  const maxFunnel = Math.max(...(roi.funnel || []).map((item) => item.count || 0), 1);

  return (
    <PageChrome
      eyebrow="ROI Loop"
      title="Analytics / ROI"
      description="A CRM-native operating dashboard for the full Wizmatch loop: signals, contact review, candidate readiness, requirements, replies, placements, and safety."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Search} label="Signals" value={stats.signals_captured || 0} helper={`${stats.signals_priority || 0} priority`} />
        <Metric icon={BarChart3} label="India share" value={formatPct(roi.kpis?.indiaSignalShare)} helper="Target 80%" tone="success" />
        <Metric icon={Contact} label="Contact approval" value={formatPct(roi.kpis?.contactApprovalRate)} helper="Manual review" />
        <Metric icon={UserCheck} label="Positive replies" value={formatPct(roi.kpis?.positiveReplyRate)} helper={`${stats.sends || 0} sends`} />
        <Metric icon={Target} label="Monthly margin" value={formatCurrency(roi.kpis?.monthlyMargin)} helper={`${formatCurrency(roi.kpis?.estimatedAnnualRunRate)} ARR`} tone="success" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-900">Operating Funnel</h2>
          </div>
          <div className="space-y-4">
            {(roi.funnel || []).map((item) => {
              const width = Math.max(5, Math.round((Number(item.count || 0) / maxFunnel) * 100));
              return (
                <div key={item.stage} className="grid grid-cols-[150px_1fr_84px] items-center gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">{item.stage}</p>
                    <p className="text-[12px] text-neutral-500">{item.conversionFromPrevious == null ? 'Start' : `${formatPct(item.conversionFromPrevious)} conversion`}</p>
                  </div>
                  <div className="h-8 overflow-hidden rounded-md bg-neutral-100">
                    <div className="flex h-full items-center justify-end rounded-md bg-primary-500 px-2 text-xs font-bold text-white" style={{ width: `${width}%` }}>
                      {item.count}
                    </div>
                  </div>
                  <span className={badgeFor(item.status)}>{item.status}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-900">Recommendations</h2>
          </div>
          <div className="space-y-2">
            {(roi.recommendations || []).map((item) => (
              <p key={item} className="rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">{item}</p>
            ))}
          </div>
          <div className="mt-5 border-t border-neutral-100 pt-4">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-500">Risk watch</p>
            <div className="space-y-2">
              {(roi.risks || []).map((item) => (
                <p key={item} className="rounded-md bg-warning-50 px-3 py-2 text-[12.5px] text-warning-800">{item}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {(roi.moduleScorecards || []).map((item) => (
          <div key={item.module} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-neutral-900">{item.module}</p>
                <p className="mt-1 text-[12.5px] leading-5 text-neutral-500">{item.summary}</p>
              </div>
              <span className={badgeFor(item.status)}>{item.status}</span>
            </div>
            <p className="mt-4 text-2xl font-bold text-neutral-900">{item.score}</p>
          </div>
        ))}
      </div>
    </PageChrome>
  );
}

export default WizmatchCommandCenterNewPage;
