import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Contact,
  DatabaseZap,
  FileText,
  Filter,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Target,
  UserCheck,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const BADGE = {
  hot: 'badge-success',
  warm: 'badge-info',
  watch: 'badge-warning',
  blocked: 'badge-danger',
  ready: 'badge-success',
  needs_data: 'badge-warning',
  needs_migration_check: 'badge-danger',
  healthy: 'badge-success',
  approved: 'badge-success',
  review_candidates: 'badge-info',
  approve_contact: 'badge-success',
  send_to_contact_intelligence: 'badge-info',
  prioritize_requirement: 'badge-warning',
  resolve_safety: 'badge-danger',
};

const MODULE_META = {
  client_discovery: { label: 'Client Discovery', icon: Target, tone: 'primary' },
  contact_intelligence: { label: 'Contact Intelligence', icon: Contact, tone: 'success' },
  candidate_intelligence: { label: 'Candidate Intelligence', icon: UserCheck, tone: 'primary' },
  requirement_priority: { label: 'Requirement Priority', icon: FileText, tone: 'warning' },
  safety: { label: 'Safety', icon: ShieldCheck, tone: 'danger' },
};

const PRIORITY_FILTERS = ['all', 'hot', 'warm', 'watch', 'blocked'];
const MODULE_FILTERS = ['all', 'client_discovery', 'contact_intelligence', 'candidate_intelligence', 'requirement_priority', 'safety'];

const DEMO_REQUIREMENTS = {
  items: [
    {
      id: 'req-demo-1',
      title: 'Java Backend Developer',
      companyName: 'Bengaluru Cloud Staffing',
      region: 'india',
      priority: 'hot',
      score: 92,
      status: 'sheet_ready',
      componentScores: { urgency: 20, indiaFirst: 15, candidateCoverage: 25, contactReadiness: 15, requirementQuality: 12, safety: 10 },
      topCandidateMatches: [
        { candidateId: 'candidate-demo-1', name: 'Aarav Kumar', score: 94, priority: 'hot', reasons: ['Strong required-skill overlap.', 'Candidate region matches requirement.'] },
      ],
      nextAction: 'review_candidates',
      reasons: ['Urgent requirement.', 'India-first priority applies.', 'Hot candidate match exists.', 'Approved contact path exists.'],
      blockers: [],
    },
    {
      id: 'req-demo-2',
      title: 'DevOps Engineer',
      companyName: 'US Prime Systems',
      region: 'us',
      priority: 'warm',
      score: 71,
      status: 'draft',
      componentScores: { urgency: 15, indiaFirst: 8, candidateCoverage: 18, contactReadiness: 8, requirementQuality: 12, safety: 10 },
      topCandidateMatches: [
        { candidateId: 'candidate-demo-2', name: 'Maya Shah', score: 78, priority: 'warm', reasons: ['Partial required-skill overlap.'] },
      ],
      nextAction: 'review_candidates',
      reasons: ['High-priority requirement.', 'Multiple candidate matches exist.'],
      blockers: [],
    },
    {
      id: 'req-demo-3',
      title: 'Payroll Support Executive',
      companyName: 'People Suite Payroll',
      region: 'india',
      priority: 'blocked',
      score: 38,
      status: 'draft',
      componentScores: { urgency: 10, indiaFirst: 15, candidateCoverage: 0, contactReadiness: 5, requirementQuality: 3, safety: 0 },
      topCandidateMatches: [],
      nextAction: 'blocked',
      reasons: ['Blocked: required skills are missing.', 'Blocked: suppression risk exists.'],
      blockers: ['missing_required_skills', 'suppression_risk'],
    },
  ],
};

const DEMO_WORKBENCH = {
  phase: 'manual_action_workbench',
  summary: { totalActions: 6, hot: 3, warm: 1, watch: 0, blocked: 2, safeExecutableActions: 4 },
  guardrails: {
    paidEnrichment: 'disabled',
    sending: 'manual_review_only',
    submissions: 'no_automatic_submission',
    deterministicBeforeAi: true,
    maxPaidDiscoveryPerCompany: 0,
    maxContactCandidatesShown: 3,
  },
  safetyCenter: {
    status: 'blocked',
    blockers: ['1 paused/blacklisted sending domain(s).', '2 paid discovery request(s) need preview/cap review.'],
    guardrails: ['No paid enrichment.', 'No automatic outreach sending.', 'No automatic candidate submission.'],
  },
  actions: [
    {
      id: 'contact-demo-1',
      module: 'contact_intelligence',
      actionType: 'approve_contact',
      title: 'Approve Asha Rao',
      subtitle: 'Bengaluru Cloud Staffing - Head of Talent Acquisition',
      score: 94,
      priority: 'hot',
      allowed: true,
      endpoint: '/api/wizmatch/contact-intelligence/contacts/contact-demo-1/review',
      method: 'POST',
      payload: { action: 'approve_contact' },
      reasons: ['Decision-maker title fit.', 'Existing relationship signal found.'],
      guardrails: ['Approval does not send outreach.'],
    },
    {
      id: 'client-demo-1',
      module: 'client_discovery',
      actionType: 'send_to_contact_intelligence',
      title: 'Send Bengaluru Cloud Staffing to Contact Intelligence',
      subtitle: 'Senior Java Developer - INDIA - 4 candidates',
      score: 91,
      priority: 'hot',
      allowed: true,
      endpoint: '/api/wizmatch/client-discovery/companies/company-demo-1/send-to-contact-intelligence',
      method: 'POST',
      payload: {},
      reasons: ['Strong signal score.', 'India-first priority applies.'],
      guardrails: ['Handoff only creates a Contact Intelligence snapshot.'],
    },
    {
      id: 'candidate-demo-1',
      module: 'candidate_intelligence',
      actionType: 'review_candidate',
      title: 'Review candidate: Aarav Kumar',
      subtitle: 'Java Backend Developer - INDIA - available',
      score: 93,
      priority: 'hot',
      allowed: true,
      endpoint: '/api/wizmatch/candidate-intelligence/candidates/candidate-demo-1/review',
      method: 'POST',
      payload: { action: 'shortlist' },
      reasons: ['Strong skill overlap.', 'Candidate is available for review.'],
      guardrails: ['Review stores intent only; no submission is created.'],
    },
    {
      id: 'requirement-demo-1',
      module: 'requirement_priority',
      actionType: 'prioritize_requirement',
      title: 'Prioritize requirement: Java Backend Developer',
      subtitle: 'Bengaluru Cloud Staffing - INDIA - 1 match',
      score: 92,
      priority: 'hot',
      allowed: true,
      endpoint: '/api/wizmatch/requirement-priority/req-demo-1/review-plan',
      method: 'POST',
      payload: { action: 'review_candidates' },
      reasons: ['Urgent requirement.', 'Hot candidate match exists.'],
      guardrails: ['No automatic candidate submission.'],
    },
    {
      id: 'safety-demo-1',
      module: 'safety',
      actionType: 'resolve_safety',
      title: 'Resolve candidate blocker: Placed Candidate',
      subtitle: 'Already placed - missing contact channel',
      score: 44,
      priority: 'blocked',
      allowed: false,
      endpoint: null,
      method: null,
      payload: null,
      reasons: ['Blocked because candidate is already placed.'],
      guardrails: ['Safety blockers require manual review.'],
    },
  ],
};

const DEMO_GUARDRAILS = {
  safetyCenter: DEMO_WORKBENCH.safetyCenter,
  guardrails: DEMO_WORKBENCH.guardrails,
  readiness: { status: 'needs_data', score: 78, primaryIssue: 'Demo mode uses sample data; open the authenticated page to validate live CRM records.' },
  costControls: {
    paidDiscoveryEnabled: false,
    maxPaidDiscoveryPerCompany: 0,
    maxContactCandidatesShown: 3,
    rediscoveryCooldownDays: 30,
  },
  rules: [
    'Paid discovery requires qualification, preview confirmation, and explicit manual execution.',
    'Manual approval is required before outreach.',
    'Candidate review persistence does not create submissions.',
    'Requirement priority planning does not change requirement status.',
    'Safety blockers must be resolved before volume increases.',
  ],
};

const DEMO_READINESS = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  database: { status: 'connected', reason: 'Demo readiness fixture loaded.' },
  overall: {
    status: 'needs_data',
    score: 78,
    primaryIssue: 'Demo data is healthy, but live readiness must be checked after login.',
  },
  tables: [
    { table: 'wizmatch_companies', label: 'Companies', required: true, exists: true, count: 12, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'wizmatch_job_signals', label: 'Job signals', required: true, exists: true, count: 30, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'wizmatch_candidates', label: 'Candidates', required: true, exists: true, count: 25, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'wizmatch_requirements', label: 'Requirements', required: true, exists: true, count: 7, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'wizmatch_company_intelligence', label: 'Company intelligence', required: true, exists: true, count: 0, latestAt: null, status: 'needs_data', reason: 'Table exists but no review rows were found.' },
    { table: 'wizmatch_contact_candidates', label: 'Contact candidates', required: true, exists: true, count: 0, latestAt: null, status: 'needs_data', reason: 'Table exists but no review rows were found.' },
    { table: 'wizmatch_discovery_runs', label: 'Discovery runs', required: true, exists: true, count: 0, latestAt: null, status: 'needs_data', reason: 'No discovery audit rows yet.' },
    { table: 'wizmatch_placements', label: 'Placements', required: false, exists: true, count: 1, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'wizmatch_domain_health', label: 'Domain health', required: true, exists: true, count: 2, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'wizmatch_suppression_list', label: 'Suppressions', required: true, exists: true, count: 1, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'contacts', label: 'CRM contacts', required: true, exists: true, count: 50, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
    { table: 'contact_channels', label: 'CRM contact channels', required: true, exists: true, count: 80, latestAt: '2026-07-06T00:00:00.000Z', status: 'ready', reason: 'Live rows found.' },
  ],
  modules: [
    { module: 'client_discovery', label: 'Client Discovery', status: 'ready', score: 100, reason: 'Real data is present for this module.', counts: { companies: 12, signals: 30, candidates: 25, domains: 2 }, nextStep: 'Use this module with logged-in live data.' },
    { module: 'contact_intelligence', label: 'Contact Intelligence', status: 'needs_data', score: 55, reason: 'Contact Intelligence tables exist but have no review state yet.', counts: { companyIntel: 0, contactCandidates: 0, contacts: 50, channels: 80 }, nextStep: 'Send qualified companies from Client Discovery or create snapshots.' },
    { module: 'candidate_intelligence', label: 'Candidate Intelligence', status: 'ready', score: 100, reason: 'Real data is present for this module.', counts: { candidates: 25, contacts: 50, channels: 80 }, nextStep: 'Use this module with logged-in live data.' },
    { module: 'requirement_priority', label: 'Requirement Priority', status: 'ready', score: 100, reason: 'Real data is present for this module.', counts: { requirements: 7, candidates: 25 }, nextStep: 'Use this module with logged-in live data.' },
    { module: 'review_workbench', label: 'Review Workbench', status: 'ready', score: 100, reason: 'Real data is present for this module.', counts: { companies: 12, signals: 30, candidates: 25, requirements: 7 }, nextStep: 'Use this module with logged-in live data.' },
    { module: 'analytics', label: 'Analytics / ROI', status: 'ready', score: 100, reason: 'Real data is present for this module.', counts: { signals: 30, candidates: 25, requirements: 7, placements: 1 }, nextStep: 'Use this module with logged-in live data.' },
    { module: 'guardrails', label: 'Guardrails', status: 'ready', score: 100, reason: 'Real data is present for this module.', counts: { domains: 2, suppressions: 1, discoveryRuns: 0 }, nextStep: 'Use this module with logged-in live data.' },
  ],
  operatorNotes: [
    'Open /wizmatch/readiness first when validating live data.',
    'Demo pages are labeled demo mode and use fixed sample data.',
    'Live pages require CRM login and protected /api/wizmatch routes.',
    'A healthy state means required tables exist and source records are present.',
  ],
  guardedItems: [
    'Paid Apollo/Snov/Reacher discovery requires preview, caps, and env enablement.',
    'Google fallback discovery requires explicit enablement and earlier discovery paths to fail.',
    'Automatic outreach sending remains blocked.',
    'Automatic candidate submission remains blocked.',
    'Worker/cron automation remains blocked.',
    'Production migrations require explicit approval.',
  ],
};

function badgeFor(value) {
  return BADGE[value] || 'badge-muted';
}

function text(value) {
  return String(value || '').replace(/_/g, ' ');
}

function countWhere(items, predicate) {
  return items.filter(predicate).length;
}

function moduleLabel(module) {
  return MODULE_META[module]?.label || text(module);
}

function moduleIcon(module) {
  return MODULE_META[module]?.icon || ClipboardList;
}

function moduleToneClass(module) {
  const tone = MODULE_META[module]?.tone;
  if (tone === 'success') return 'bg-success-50 text-success-700';
  if (tone === 'warning') return 'bg-warning-50 text-warning-700';
  if (tone === 'danger') return 'bg-danger-50 text-danger-700';
  return 'bg-primary-50 text-primary-700';
}

function useLiveData({ demoMode, fallback, loadLive }) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (demoMode) {
      setData(fallback);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await loadLive());
    } catch (err) {
      setError(err?.message || 'Unable to load Wizmatch data');
      setData(fallback);
    } finally {
      setLoading(false);
    }
  }, [demoMode, fallback, loadLive]);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, error, refresh, setData };
}

function Page({ eyebrow, title, description, demoMode, loading, error, onRefresh, children }) {
  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-4 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1540px] space-y-5">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-100 bg-white px-5 py-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="badge-info">{eyebrow}</span>
                {demoMode && <span className="badge-warning">Demo mode</span>}
                {loading && <span className="badge-muted">Loading</span>}
              </div>
              <h1 className="text-[28px] font-bold tracking-tight text-neutral-950">{title}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">{description}</p>
            </div>
            <button type="button" onClick={onRefresh} className="btn-secondary btn-compact">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
          <div className="grid gap-3 bg-neutral-50 px-5 py-3 md:grid-cols-4">
            {[
              ['Manual approval', 'Required before outreach'],
              ['Paid discovery', 'Preview-first manual only'],
              ['Candidate submit', 'Never automatic'],
              ['Logic mode', 'Deterministic first'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-neutral-200 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
                <p className="mt-0.5 text-[12.5px] font-semibold text-neutral-800">{value}</p>
              </div>
            ))}
          </div>
        </div>
        {error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800">
            {error}. Showing safe demo fallback.
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon = ClipboardList, title, description, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary-50 p-2 text-primary-700">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-950">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-5 text-neutral-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function FilterBar({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2">
      <div className="mr-1 flex items-center gap-1.5 px-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
        <Filter className="h-3.5 w-3.5" />
        {label}
      </div>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${
            value === option ? 'bg-primary-500 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          {option === 'all' ? 'All' : moduleLabel(option)}
        </button>
      ))}
    </div>
  );
}

function EmptyQueue({ title = 'Nothing to show', description = 'Adjust filters or refresh the queue.' }) {
  return (
    <div className="card flex min-h-[220px] flex-col items-center justify-center p-8 text-center">
      <div className="mb-3 rounded-md bg-neutral-100 p-3 text-neutral-500">
        <ListChecks className="h-5 w-5" />
      </div>
      <h2 className="font-semibold text-neutral-950">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-neutral-500">{description}</p>
    </div>
  );
}

function GuardrailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2 text-[12.5px]">
      <span className="font-semibold text-neutral-700">{text(label)}</span>
      <span className="text-right text-neutral-500">{String(value)}</span>
    </div>
  );
}

function MetricRail({ actions }) {
  const modules = MODULE_FILTERS.filter((item) => item !== 'all');
  return (
    <div className="card p-5">
      <SectionHeader
        icon={LayoutDashboard}
        title="Operating map"
        description="Live queue mix across Wizmatch modules."
      />
      <div className="space-y-2">
        {modules.map((module) => {
          const Icon = moduleIcon(module);
          const count = countWhere(actions, (action) => action.module === module);
          return (
            <div key={module} className="flex items-center justify-between rounded-md border border-neutral-100 bg-white px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-md p-1.5 ${moduleToneClass(module)}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[12.5px] font-semibold text-neutral-800">{moduleLabel(module)}</span>
              </div>
              <span className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-bold text-white">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OperatingLinks() {
  const links = [
    ['/wizmatch/review-workbench-demo', 'Workbench', ClipboardList],
    ['/wizmatch/requirement-priority-new-demo', 'Requirements', FileText],
    ['/wizmatch/client-discovery-new-demo', 'Clients', Target],
    ['/wizmatch/contact-intelligence-new-demo', 'Contacts', Contact],
    ['/wizmatch/candidate-intelligence-new-demo', 'Candidates', UserCheck],
    ['/wizmatch/readiness-demo', 'Readiness', DatabaseZap],
    ['/wizmatch/analytics-new-demo', 'Analytics', Activity],
  ];
  return (
    <div className="card p-5">
      <SectionHeader icon={PlayCircle} title="Preview surfaces" description="No-login localhost links for fast review." />
      <div className="grid gap-2 sm:grid-cols-2">
        {links.map(([href, label, Icon]) => (
          <a key={href} href={href} className="flex items-center justify-between rounded-md border border-neutral-100 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 transition hover:border-primary-300 hover:text-primary-700">
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-neutral-400" />
              {label}
            </span>
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, helper, tone = 'neutral' }) {
  const toneClass = tone === 'danger' ? 'text-danger-700 bg-danger-50' : tone === 'success' ? 'text-success-700 bg-success-50' : 'text-primary-700 bg-primary-50';
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-neutral-950">{value}</p>
          <p className="mt-1 text-[12.5px] text-neutral-500">{helper}</p>
        </div>
        <div className={`rounded-md p-2 ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function ReadinessStrip({ readiness, demoMode }) {
  const status = readiness?.status || 'needs_data';
  const primaryIssue = readiness?.primaryIssue || 'Readiness has not been checked yet.';
  const href = demoMode ? '/wizmatch/readiness-demo' : '/wizmatch/readiness';
  return (
    <div className="rounded-lg border border-primary-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-md bg-primary-50 p-2 text-primary-700">
            <DatabaseZap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-neutral-950">Live data readiness</p>
              <span className={badgeFor(status)}>{text(status)}</span>
              {readiness?.score != null && <span className="badge-muted">{readiness.score}/100</span>}
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-neutral-500">{primaryIssue}</p>
          </div>
        </div>
        <a href={href} className="btn-secondary btn-compact">
          Open readiness
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={badgeFor(status)}>{text(status)}</span>;
}

function TableReadinessRow({ table }) {
  return (
    <div className="grid gap-3 rounded-md border border-neutral-100 bg-white px-3 py-3 text-[12.5px] md:grid-cols-[1.3fr_0.8fr_0.7fr_1fr_2fr]">
      <div>
        <p className="font-semibold text-neutral-900">{table.label}</p>
        <p className="mt-0.5 font-mono text-[11px] text-neutral-400">{table.table}</p>
      </div>
      <div><StatusPill status={table.status} /></div>
      <div className="font-semibold text-neutral-800">{table.exists ? table.count ?? 0 : 'Missing'}</div>
      <div className="text-neutral-500">{table.latestAt ? new Date(table.latestAt).toLocaleDateString() : 'No rows'}</div>
      <div className="text-neutral-500">{table.reason}</div>
    </div>
  );
}

function ModuleReadinessCard({ module }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill status={module.status} />
            <span className="badge-muted">{module.score}/100</span>
          </div>
          <h2 className="font-semibold text-neutral-950">{module.label}</h2>
          <p className="mt-1 text-[12.5px] leading-5 text-neutral-500">{module.reason}</p>
        </div>
        <div className="rounded-md bg-primary-50 p-2 text-primary-700">
          <DatabaseZap className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {Object.entries(module.counts || {}).slice(0, 4).map(([key, value]) => (
          <div key={key} className="rounded-md bg-neutral-50 px-3 py-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">{text(key)}</p>
            <p className="mt-1 text-sm font-bold text-neutral-900">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-600">{module.nextStep}</p>
    </div>
  );
}

function ActionCard({ action, onRun, running }) {
  const Icon = moduleIcon(action.module);
  return (
    <div className={`card card-hover overflow-hidden ${action.priority === 'hot' ? 'border-success-200' : action.priority === 'blocked' ? 'border-danger-200' : ''}`}>
      <div className={`h-1 ${action.priority === 'hot' ? 'bg-success-500' : action.priority === 'blocked' ? 'bg-danger-500' : action.priority === 'warm' ? 'bg-primary-500' : 'bg-neutral-300'}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className={`mt-0.5 rounded-md p-2 ${moduleToneClass(action.module)}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={badgeFor(action.priority)}>{action.priority}</span>
                <span className={badgeFor(action.actionType)}>{text(action.actionType)}</span>
                <span className="badge-muted">{moduleLabel(action.module)}</span>
              </div>
              <h2 className="text-[15px] font-semibold text-neutral-950">{action.title}</h2>
              <p className="mt-1 text-[12.5px] text-neutral-500">{action.subtitle}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-neutral-950">{action.score}</p>
            <p className="text-[11px] uppercase tracking-wider text-neutral-400">score</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(action.reasons || []).slice(0, 3).map((reason) => (
            <span key={reason} className="badge-muted">{reason}</span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
          <p className="flex items-center gap-1.5 text-[12px] text-neutral-500">
            <LockKeyhole className="h-3.5 w-3.5 text-neutral-400" />
            {(action.guardrails || [])[0] || 'Manual action only.'}
          </p>
          <button
            type="button"
            disabled={!action.allowed || running}
            onClick={() => onRun(action)}
            className={action.allowed ? 'btn-primary btn-compact' : 'btn-secondary btn-compact opacity-60'}
          >
            {action.allowed ? (running ? 'Working...' : 'Run safe action') : 'Blocked'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreBars({ scores }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Object.entries(scores || {}).map(([key, value]) => (
        <div key={key} className="rounded-md border border-neutral-100 bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[12.5px] font-semibold text-neutral-700">{text(key)}</p>
            <p className="text-sm font-bold text-neutral-950">{value}</p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, Number(value || 0) * 4)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WizmatchReviewWorkbenchPage({ demoMode = false }) {
  const fallback = useMemo(() => DEMO_WORKBENCH, []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(() => apiFetch('/api/wizmatch/review-workbench?limit=40'), []),
  });
  const [runningId, setRunningId] = useState(null);
  const [message, setMessage] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const actions = data.actions || [];
  const filteredActions = useMemo(() => actions.filter((action) => (
    (moduleFilter === 'all' || action.module === moduleFilter)
    && (priorityFilter === 'all' || action.priority === priorityFilter)
  )), [actions, moduleFilter, priorityFilter]);

  async function runAction(action) {
    setRunningId(action.id);
    setMessage('');
    try {
      if (demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        setMessage(`Demo action completed: ${action.title}`);
      } else if (action.endpoint && action.method === 'POST') {
        await apiFetch(action.endpoint, { method: 'POST', body: JSON.stringify(action.payload || {}) });
        setMessage(`Completed: ${action.title}`);
        await refresh();
      }
    } catch (err) {
      setMessage(err?.message || 'Action failed');
    } finally {
      setRunningId(null);
    }
  }

  return (
    <Page
      eyebrow="Unified Operator Queue"
      title="Wizmatch Review Workbench"
      description="One manual-action surface for approving contacts, shortlisting candidates, prioritizing requirements, moving client signals forward, and resolving safety blockers."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric icon={ClipboardList} label="Actions" value={data.summary?.totalActions || 0} helper="Unified queue" />
        <Metric icon={Zap} label="Hot" value={data.summary?.hot || 0} helper="Do first" tone="success" />
        <Metric icon={Target} label="Warm" value={data.summary?.warm || 0} helper="Next best" />
        <Metric icon={AlertTriangle} label="Blocked" value={data.summary?.blocked || 0} helper="Resolve manually" tone="danger" />
        <Metric icon={CheckCircle2} label="Safe actions" value={data.summary?.safeExecutableActions || 0} helper="No sending/submits" tone="success" />
      </div>

      <ReadinessStrip readiness={data.readiness || DEMO_READINESS.overall} demoMode={demoMode} />

      {message && <div className="rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">{message}</div>}

      <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
        <FilterBar label="Module" options={MODULE_FILTERS} value={moduleFilter} onChange={setModuleFilter} />
        <FilterBar label="Priority" options={PRIORITY_FILTERS} value={priorityFilter} onChange={setPriorityFilter} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-3">
          {filteredActions.length ? filteredActions.map((action) => (
            <ActionCard key={action.id} action={action} onRun={runAction} running={runningId === action.id} />
          )) : (
            <EmptyQueue
              title="No actions match these filters"
              description="The safe queue is still intact; change module or priority filters to see other items."
            />
          )}
        </div>
        <div className="space-y-4">
          <MetricRail actions={actions} />
          <div className="card p-5">
            <SectionHeader icon={ShieldCheck} title="Safety center" description="Blockers stay explanatory until a human resolves them." />
            <span className={badgeFor(data.safetyCenter?.status)}>{data.safetyCenter?.status || 'healthy'}</span>
            <div className="mt-3 space-y-2">
              {(data.safetyCenter?.blockers || ['No blockers detected.']).map((item) => (
                <p key={item} className="rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">{item}</p>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <SectionHeader icon={DatabaseZap} title="Guardrails" description="Every safe action respects these caps." />
            <div className="space-y-2">
              {Object.entries(data.guardrails || {}).map(([key, value]) => (
                <GuardrailRow key={key} label={key} value={value} />
              ))}
            </div>
          </div>
          <OperatingLinks />
        </div>
      </div>
    </Page>
  );
}

export function WizmatchRequirementPriorityPage({ demoMode = false }) {
  const fallback = useMemo(() => DEMO_REQUIREMENTS, []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(() => apiFetch('/api/wizmatch/requirement-priority/queue?limit=50'), []),
  });
  const items = data.items || [];
  const [selectedId, setSelectedId] = useState(null);
  const [planMessage, setPlanMessage] = useState('');
  const [planningId, setPlanningId] = useState(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0], [items, selectedId]);

  async function runReviewPlan(item) {
    if (!item) return;
    setPlanningId(item.id);
    setPlanMessage('');
    try {
      if (demoMode) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        setPlanMessage(`Demo review plan prepared for ${item.title}. No submission was created.`);
      } else {
        const result = await apiFetch(`/api/wizmatch/requirement-priority/${item.id}/review-plan`, {
          method: 'POST',
          body: JSON.stringify({ action: item.nextAction }),
        });
        setPlanMessage(result.message || `Review plan prepared for ${item.title}.`);
      }
    } catch (err) {
      setPlanMessage(err?.message || 'Unable to prepare requirement review plan.');
    } finally {
      setPlanningId(null);
    }
  }

  return (
    <Page
      eyebrow="Requirement Operating Layer"
      title="Requirement Priority"
      description="Rank open IT/Tech requirements by urgency, India-first priority, candidate coverage, contact readiness, quality, and safety before any submission work."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={FileText} label="Requirements" value={items.length} helper="Open queue" />
        <Metric icon={Zap} label="Hot" value={items.filter((item) => item.priority === 'hot').length} helper="Review first" tone="success" />
        <Metric icon={UserCheck} label="Matches" value={items.reduce((sum, item) => sum + (item.topCandidateMatches?.length || 0), 0)} helper="Top 3 each" />
        <Metric icon={AlertTriangle} label="Blocked" value={items.filter((item) => item.priority === 'blocked').length} helper="Needs cleanup" tone="danger" />
      </div>
      {planMessage && <div className="rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">{planMessage}</div>}

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`w-full rounded-md border bg-white p-4 text-left shadow-sm transition hover:border-primary-300 ${selected?.id === item.id ? 'border-primary-400 ring-2 ring-primary-100' : 'border-neutral-100'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-neutral-950">{item.title}</p>
                  <p className="mt-1 text-[12.5px] text-neutral-500">{item.companyName || 'No company'} - {item.region?.toUpperCase()}</p>
                </div>
                <span className={badgeFor(item.priority)}>{item.priority}</span>
              </div>
              <p className="mt-3 text-2xl font-bold text-neutral-950">{item.score}</p>
            </button>
          ))}
        </div>

        {selected && (
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <span className={badgeFor(selected.priority)}>{selected.priority}</span>
                  <span className="badge-muted">{text(selected.nextAction)}</span>
                  <span className="badge-muted">{selected.status || 'unknown status'}</span>
                </div>
                <h2 className="text-xl font-bold text-neutral-950">{selected.title}</h2>
                <p className="mt-1 text-sm text-neutral-500">{selected.companyName || 'No company'} - {selected.region?.toUpperCase()}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-neutral-950">{selected.score}</p>
                <button
                  type="button"
                  disabled={selected.priority === 'blocked' || planningId === selected.id}
                  onClick={() => runReviewPlan(selected)}
                  className={selected.priority === 'blocked' ? 'btn-secondary btn-compact mt-2 opacity-60' : 'btn-primary btn-compact mt-2'}
                >
                  {planningId === selected.id ? 'Preparing...' : 'Prepare review plan'}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                ['Score', selected.score],
                ['Action', text(selected.nextAction)],
                ['Matches', selected.topCandidateMatches?.length || 0],
                ['Blockers', selected.blockers?.length || 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-neutral-100 bg-neutral-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
                  <p className="mt-1 text-sm font-bold text-neutral-900">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <ScoreBars scores={selected.componentScores} />
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-neutral-950">Why this priority</h3>
                <div className="space-y-2">
                  {(selected.reasons || []).map((reason) => (
                    <p key={reason} className="rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">{reason}</p>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-neutral-950">Top candidate matches</h3>
                <div className="space-y-2">
                  {(selected.topCandidateMatches || []).length ? selected.topCandidateMatches.map((candidate) => (
                    <div key={candidate.candidateId} className="rounded-md border border-neutral-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-neutral-900">{candidate.name}</p>
                        <span className={badgeFor(candidate.priority)}>{candidate.score}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-neutral-500">{(candidate.reasons || [])[0] || 'Manual review needed'}</p>
                    </div>
                  )) : <p className="rounded-md bg-warning-50 px-3 py-2 text-[12.5px] text-warning-800">No candidate match yet.</p>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

export function WizmatchGuardrailsPage({ demoMode = false }) {
  const fallback = useMemo(() => DEMO_GUARDRAILS, []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(() => apiFetch('/api/wizmatch/guardrails'), []),
  });
  return (
    <Page
      eyebrow="Safety & Cost Control"
      title="Wizmatch Guardrail Center"
      description="A single safety page for paid-enrichment caps, manual approval rules, submission controls, and blockers before the team increases volume."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={ShieldCheck} label="Safety" value={data.safetyCenter?.status || 'healthy'} helper="Current posture" tone={data.safetyCenter?.status === 'blocked' ? 'danger' : 'success'} />
        <Metric icon={DatabaseZap} label="Paid/company" value={data.costControls?.maxPaidDiscoveryPerCompany ?? 0} helper="Phase cap" />
        <Metric icon={Contact} label="Contacts shown" value={data.costControls?.maxContactCandidatesShown ?? 3} helper="Per company" />
        <Metric icon={AlertTriangle} label="Blockers" value={(data.safetyCenter?.blockers || []).length} helper="Manual resolution" tone="danger" />
      </div>
      <ReadinessStrip readiness={data.readiness || DEMO_READINESS.overall} demoMode={demoMode} />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr_360px]">
        <div className="card p-5">
          <SectionHeader icon={AlertTriangle} title="Active blockers" description="Resolve manually before increasing volume." />
          <div className="space-y-2">
            {(data.safetyCenter?.blockers || ['No blockers detected.']).map((item) => (
              <p key={item} className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{item}</p>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <SectionHeader icon={ShieldCheck} title="Rules enforced" description="Non-negotiable operating boundaries." />
          <div className="space-y-2">
            {(data.rules || []).map((rule) => (
              <p key={rule} className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-800">{rule}</p>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <SectionHeader icon={DatabaseZap} title="Cost controls" description="Preview-first paid discovery stays capped and manual." />
          <div className="space-y-2">
            {Object.entries(data.costControls || {}).map(([key, value]) => (
              <GuardrailRow key={key} label={key} value={value} />
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}

export function WizmatchReadinessPage({ demoMode = false }) {
  const fallback = useMemo(() => DEMO_READINESS, []);
  const { data, loading, error, refresh } = useLiveData({
    demoMode,
    fallback,
    loadLive: useCallback(() => apiFetch('/api/wizmatch/readiness'), []),
  });
  const readyTables = (data.tables || []).filter((table) => table.status === 'ready').length;
  const missingTables = (data.tables || []).filter((table) => !table.exists).length;
  const needsDataModules = (data.modules || []).filter((module) => module.status === 'needs_data').length;
  const blockedModules = (data.modules || []).filter((module) => module.status === 'blocked' || module.status === 'needs_migration_check').length;

  return (
    <Page
      eyebrow="Live Data Validation"
      title="Wizmatch Data Readiness"
      description="Read-only live-data diagnostics for CRM/Wizmatch tables, module readiness, empty-state reasons, and guarded items before the team relies on production workflows."
      demoMode={demoMode}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="grid gap-4 md:grid-cols-5">
        <Metric icon={DatabaseZap} label="Overall" value={text(data.overall?.status || 'needs_data')} helper={data.overall?.primaryIssue || 'Readiness pending'} tone={data.overall?.status === 'ready' ? 'success' : data.overall?.status === 'blocked' ? 'danger' : 'neutral'} />
        <Metric icon={Activity} label="Score" value={data.overall?.score ?? 0} helper="Module average" />
        <Metric icon={CheckCircle2} label="Ready tables" value={readyTables} helper="Rows found" tone="success" />
        <Metric icon={AlertTriangle} label="Missing tables" value={missingTables} helper="Migration check" tone={missingTables ? 'danger' : 'success'} />
        <Metric icon={ListChecks} label="Needs data" value={needsDataModules} helper={`${blockedModules} blocked/check`} tone={blockedModules ? 'danger' : 'neutral'} />
      </div>

      <div className="card p-5">
        <SectionHeader icon={DatabaseZap} title="Primary live-data issue" description="Start here when a Wizmatch page looks empty." />
        <div className="rounded-md border border-neutral-100 bg-neutral-50 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill status={data.overall?.status || 'needs_data'} />
            <span className={data.database?.status === 'connected' ? 'badge-success' : 'badge-danger'}>{data.database?.status || 'unknown database'}</span>
          </div>
          <p className="text-sm font-semibold text-neutral-900">{data.overall?.primaryIssue}</p>
          <p className="mt-1 text-[12.5px] text-neutral-500">{data.database?.reason}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {(data.modules || []).map((module) => (
          <ModuleReadinessCard key={module.module} module={module} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="card p-5">
          <SectionHeader icon={DatabaseZap} title="Table readiness" description="Tenant-scoped counts and latest activity. Missing required tables mean migration/state must be checked." />
          <div className="space-y-2">
            {(data.tables || []).map((table) => (
              <TableReadinessRow key={table.table} table={table} />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <SectionHeader icon={ListChecks} title="Operator notes" description="How to tell demo from live data." />
            <div className="space-y-2">
              {(data.operatorNotes || []).map((note) => (
                <p key={note} className="rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">{note}</p>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <SectionHeader icon={ShieldCheck} title="Still intentionally blocked" description="These are not readiness bugs." />
            <div className="space-y-2">
              {(data.guardedItems || []).map((item) => (
                <p key={item} className="rounded-md bg-danger-50 px-3 py-2 text-[12.5px] text-danger-800">{item}</p>
              ))}
            </div>
          </div>
          <OperatingLinks />
        </div>
      </div>
    </Page>
  );
}

export function WizmatchLocalDemoFlowPage({ demoMode = false }) {
  const steps = [
    { title: 'Client signal qualifies', detail: 'India IT/Tech signal with candidate supply moves into Contact Intelligence.', icon: Target },
    { title: 'Contact approved', detail: 'Reviewer approves one decision-maker contact. No email is sent.', icon: Contact },
    { title: 'Candidate shortlisted', detail: 'Candidate review intent is persisted. No submission is created.', icon: UserCheck },
    { title: 'Requirement prioritized', detail: 'Urgent requirements are ranked by candidate coverage and contact readiness.', icon: FileText },
    { title: 'Safety checked', detail: 'Paid discovery is preview-first; sending and submissions remain blocked until later approval.', icon: ShieldCheck },
  ];
  const operatingChecklist = [
    'Start in Review Workbench for the unified queue.',
    'Use Requirement Priority to choose the requirement/candidate path.',
    'Use Client Discovery and Contact Intelligence for company/contact review.',
    'Use Candidate Intelligence before any submission decision.',
    'Use Guardrail Center before increasing volume.',
  ];

  return (
    <Page
      eyebrow="Local Preview"
      title="Wizmatch End-to-End Demo Flow"
      description="A guided localhost preview of the safe operating loop now available across the new workbench, requirement priority, guardrail center, and V2 intelligence pages."
      demoMode={demoMode}
      loading={false}
      error={null}
      onRefresh={() => {}}
    >
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-4 lg:grid-cols-5">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="card p-5">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                <Icon className="h-5 w-5" />
              </div>
              <span className="badge-muted">Step {index + 1}</span>
              <h2 className="mt-3 font-semibold text-neutral-950">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">{step.detail}</p>
            </div>
          );
        })}
        </div>
        <div className="card p-5">
          <SectionHeader icon={ListChecks} title="Operator checklist" description="Use this order for a clean localhost review." />
          <div className="space-y-2">
            {operatingChecklist.map((item) => (
              <p key={item} className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success-600" />
                {item}
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="card p-5">
        <SectionHeader icon={PlayCircle} title="Preview links" description="All routes below work without login in demo mode." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['/wizmatch/review-workbench-demo', 'Review Workbench'],
            ['/wizmatch/requirement-priority-new-demo', 'Requirement Priority'],
            ['/wizmatch/guardrails-new-demo', 'Guardrail Center'],
            ['/wizmatch/readiness-demo', 'Data Readiness'],
            ['/wizmatch/command-center-new-demo', 'Command Center V2'],
            ['/wizmatch/client-discovery-new-demo', 'Client Discovery V2'],
            ['/wizmatch/contact-intelligence-new-demo', 'Contact Intelligence V2'],
            ['/wizmatch/candidate-intelligence-new-demo', 'Candidate Intelligence V2'],
            ['/wizmatch/analytics-new-demo', 'Analytics V2'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-md border border-neutral-100 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 shadow-sm transition hover:border-primary-300 hover:text-primary-700">
              {label}
            </a>
          ))}
        </div>
      </div>
    </Page>
  );
}
