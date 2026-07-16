import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, CheckCircle2, Clock, IndianRupee,
  Info, RefreshCw, ShieldCheck, TrendingUp, Users, XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';

const STATUS_BADGE = {
  healthy: 'badge-success',
  watch: 'badge-warning',
  blocked: 'badge-danger',
};

const REQUIREMENT_STATUS_OPTIONS = ['draft', 'sheet_ready', 'shared', 'closed'];

// Submission lifecycle statuses this page reads from GET /staffing/analytics
// funnel rows (see SUBMISSION_STATUSES in wizmatchDeliveryDomain.ts).
const INTERVIEW_OR_BEYOND = ['interviewing', 'offered', 'placed'];
const OFFER_OR_BEYOND = ['offered', 'placed'];

const DEMO_ROI = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  from: '2026-06-06',
  to: '2026-07-06',
  guardrails: {
    paidEnrichment: 'disabled_until_qualified',
    sending: 'manual_review_only',
    deterministicBeforeAi: true,
    scope: 'internal_it_tech_staffing_only',
  },
  kpis: {
    prioritySignalRate: 31,
    indiaSignalShare: 82,
    matchRate: 54,
    draftRate: 48,
    sendRate: 42,
    positiveReplyRate: 12,
    contactApprovalRate: 63,
    contactLinkRate: 70,
    requirementCoverage: 67,
    placementStartRate: 18,
    monthlyMargin: 384000,
    estimatedAnnualRunRate: 4608000,
    costCentsTotal: 0,
    costPerApprovedContactCents: 0,
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
  sourceBreakdown: [
    { source: 'naukri', count: 74, avgScore: 7.4 },
    { source: 'manual', count: 31, avgScore: 6.8 },
    { source: 'ats', count: 21, avgScore: 6.1 },
  ],
  recommendations: [
    'Keep current guardrails: deterministic scoring, manual review, and qualified-only enrichment.',
    'Push urgent requirements through sheet/review readiness before widening discovery.',
  ],
  risks: ['No critical ROI risks detected from current deterministic metrics.'],
};

const DEMO_ANALYTICS = {
  domains: [
    { domain: 'growthescalators.com', sends_7d: 7, reply_rate_7d: 0.12, bounce_rate_7d: 0.01, status: 'healthy' },
    { domain: 'example-outreach.com', sends_7d: 4, reply_rate_7d: 0.05, bounce_rate_7d: 0.04, status: 'watch' },
  ],
  pipeline: [
    { status: 'submitted', count: 3, monthly_value: 0 },
    { status: 'interviewing', count: 2, monthly_value: 0 },
    { status: 'started', count: 1, monthly_value: 384000 },
  ],
  sources: DEMO_ROI.sourceBreakdown.map((source) => ({ source: source.source, count: source.count, avg_score: source.avgScore })),
};

const DEMO_DELIVERY = {
  funnel: [
    { status: 'draft', count: 2 }, { status: 'approved', count: 1 }, { status: 'submitted', count: 3 },
    { status: 'interviewing', count: 2 }, { status: 'offered', count: 1 }, { status: 'placed', count: 1 },
    { status: 'rejected', count: 1 }, { status: 'withdrawn', count: 0 }, { status: 'closed', count: 0 },
  ],
  commercial: { gross_margin: '384000', starts: 1, invoiced: '384000', collected: '192000' },
  exceptions: { overdue_submissions: 1, missing_next_action: 0 },
  cohorts: [],
  timeToFill: { average_days: 21.5, fastest_days: 14, slowest_days: 30 },
  aging: [{ bucket: '0-2d', count: 2 }, { bucket: '3-7d', count: 3 }, { bucket: '8-14d', count: 1 }, { bucket: '15d+', count: 0 }],
  rejectionReasons: [{ reason: 'Budget mismatch', count: 1 }],
  recruiterPerformance: [{ recruiter: 'Demo Recruiter', submissions: 4, progressed: 3, starts: 1 }],
  sourcePerformance: [{ source: 'manual', submissions: 4, starts: 1 }],
};

const DEMO_REQUIREMENTS = {
  items: [{ id: 'demo-1', title: 'Senior Java Developer', company_name: 'Acme Corp', status: 'sheet_ready', required_skills: ['Java', 'AWS'] }],
  total: 6,
};

const DEMO_USERS = { items: [{ id: 'demo-user-1', name: 'Demo Recruiter', role: 'staff' }] };

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDays(value) {
  if (value == null) return '—';
  const n = Number(value);
  return `${n} day${n === 1 ? '' : 's'}`;
}

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function sumSubmissionStatuses(rows, statuses) {
  const set = new Set(statuses);
  return (rows || []).filter((r) => set.has(r.status)).reduce((acc, r) => acc + Number(r.count || 0), 0);
}

// Builds the required Job Lead -> Collection funnel from whichever real
// endpoints actually cover each stage. Every stage carries two independent
// flags so the UI never conflates them:
//   supported — does ANY endpoint exist for this stage at all (structural;
//               false forever for Hiring Contact / Match / Shortlist)
//   errored   — did the specific fetch for a supported stage fail this load
//               (transient; distinct from "no backend support")
// A stage only renders a real bar (including a real zero) when supported
// and not errored — never a computed/estimated fallback number.
function buildDeliveryFunnel({ roi, requirementsSummary, delivery, roiError, requirementsError, deliveryError }) {
  const jobLeadCount = roi ? Number(roi.funnel?.[0]?.count ?? 0) : null;
  const requirementCount = requirementsSummary ? Number(requirementsSummary.total ?? 0) : null;
  const submissionRows = delivery?.funnel || [];
  const totalSubmissions = delivery ? submissionRows.reduce((acc, r) => acc + Number(r.count || 0), 0) : null;
  const interviewCount = delivery ? sumSubmissionStatuses(submissionRows, INTERVIEW_OR_BEYOND) : null;
  const offerCount = delivery ? sumSubmissionStatuses(submissionRows, OFFER_OR_BEYOND) : null;
  const startCount = delivery ? Number(delivery.commercial?.starts ?? 0) : null;

  const stages = [
    {
      key: 'job_lead', label: 'Job Lead', supported: true, errored: !!roiError, count: jobLeadCount,
      note: 'Job signals captured in the selected period (wizmatch_job_signals), from GET /api/wizmatch/analytics/roi.',
    },
    {
      key: 'hiring_contact', label: 'Hiring Contact', supported: false, errored: false, count: null,
      note: 'No endpoint returns a tenant-wide count of approved/linked hiring contacts. GET /api/wizmatch/analytics/roi only exposes this as a rate (contactApprovalRate / contactLinkRate) and a free-text scorecard summary, not a structured count.',
    },
    {
      key: 'requirement', label: 'Requirement', supported: true, errored: !!requirementsError, count: requirementCount,
      note: 'Requirements matching the current company / skill / status / recruiter filters, from GET /api/wizmatch/requirements. All-time — this endpoint has no date-range filter.',
    },
    {
      key: 'match', label: 'Match', supported: false, errored: false, count: null,
      note: 'No endpoint aggregates candidate-to-requirement matches tenant-wide — only a per-requirement match list and a per-recruiter "my work" queue exist.',
    },
    {
      key: 'shortlist', label: 'Shortlist', supported: false, errored: false, count: null,
      note: 'No endpoint aggregates shortlist decisions (human_decision = shortlisted) tenant-wide.',
    },
    {
      key: 'submission', label: 'Submission', supported: true, errored: !!deliveryError, count: totalSubmissions,
      note: 'All submissions ever created, from GET /api/wizmatch/staffing/analytics. All-time — this endpoint has no date-range filter.',
    },
    {
      key: 'interview', label: 'Interview', supported: true, errored: !!deliveryError, count: interviewCount,
      note: 'Submissions currently at interviewing / offered / placed. This is a current-status snapshot, not a historical funnel: a submission that interviewed and was later rejected or withdrawn is no longer counted here.',
    },
    {
      key: 'offer', label: 'Offer', supported: true, errored: !!deliveryError, count: offerCount,
      note: 'Submissions currently at offered / placed. Same current-status caveat as Interview.',
    },
    {
      key: 'start', label: 'Start', supported: true, errored: !!deliveryError, count: startCount,
      note: 'Placements ever started (wizmatch_placements), from GET /api/wizmatch/staffing/analytics commercial.starts.',
    },
  ];

  const isReady = (st) => st.supported && !st.errored && st.count != null;
  for (let i = 0; i < stages.length; i += 1) {
    const prev = stages[i - 1];
    stages[i].conversionFromPrevious = i === 0 || !prev || !isReady(stages[i]) || !isReady(prev)
      ? null
      : pct(stages[i].count, prev.count);
  }
  return stages;
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary-500" />
      <div className="text-[12.5px] text-neutral-500 font-medium">{label}</div>
      <div className="text-[26px] font-bold text-neutral-900 mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

function FunnelRow({ item, max }) {
  const width = Math.max(5, Math.round((Number(item.count || 0) / Math.max(max, 1)) * 100));
  return (
    <div className="grid grid-cols-[150px_1fr_90px] gap-3 items-center">
      <div>
        <p className="text-sm font-semibold text-neutral-800">{item.stage}</p>
        <p className="text-[12px] text-neutral-500">
          {item.conversionFromPrevious == null ? 'Start' : `${formatPct(item.conversionFromPrevious)} from previous`}
        </p>
      </div>
      <div className="h-8 bg-neutral-100 rounded-md overflow-hidden">
        <div className="h-full bg-primary-500 rounded-md flex items-center justify-end px-2" style={{ width: `${width}%` }}>
          <span className="text-xs font-bold text-white">{item.count}</span>
        </div>
      </div>
      <span className={STATUS_BADGE[item.status] || 'badge-muted'}>{item.status}</span>
    </div>
  );
}

// Renders one stage of the Job Lead -> Collection delivery funnel. Three
// distinct states, never conflated: no backend support (dashed grey), a
// failed fetch for a stage that IS supported (dashed danger, retryable),
// or real data (a real bar, including a real zero).
function DeliveryFunnelRow({ stage, maxCount }) {
  if (!stage.supported) {
    return (
      <div className="grid grid-cols-[130px_1fr_130px] gap-3 items-center" title={stage.note}>
        <div>
          <p className="text-sm font-semibold text-neutral-500">{stage.label}</p>
        </div>
        <div className="h-8 rounded-md border border-dashed border-neutral-300 bg-neutral-50" />
        <span className="badge-muted text-[11px] inline-flex items-center gap-1"><Info className="w-3 h-3" /> Not available yet</span>
      </div>
    );
  }
  if (stage.errored) {
    return (
      <div className="grid grid-cols-[130px_1fr_130px] gap-3 items-center">
        <div>
          <p className="text-sm font-semibold text-neutral-500">{stage.label}</p>
        </div>
        <div className="h-8 rounded-md border border-dashed border-danger-300 bg-danger-500/5" />
        <span className="badge-danger text-[11px] inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Failed to load</span>
      </div>
    );
  }
  const count = stage.count ?? 0;
  const width = Math.max(5, Math.round((count / Math.max(maxCount, 1)) * 100));
  return (
    <div className="grid grid-cols-[130px_1fr_130px] gap-3 items-center">
      <div>
        <p className="text-sm font-semibold text-neutral-800">{stage.label}</p>
        <p className="text-[11.5px] text-neutral-500">
          {stage.conversionFromPrevious == null ? '—' : `${formatPct(stage.conversionFromPrevious)} from previous`}
        </p>
      </div>
      <div className="h-8 bg-neutral-100 rounded-md overflow-hidden" title={stage.note}>
        <div className="h-full bg-primary-500 rounded-md flex items-center justify-end px-2" style={{ width: `${width}%` }}>
          <span className="text-xs font-bold text-white">{count}</span>
        </div>
      </div>
      <span className="text-[11px] text-neutral-500 truncate" title={stage.note}>real data</span>
    </div>
  );
}

function ModuleScorecard({ item }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">{item.module}</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">{item.summary}</p>
        </div>
        <div className="text-right">
          <span className={STATUS_BADGE[item.status] || 'badge-muted'}>{item.status}</span>
          <p className="mt-2 text-lg font-bold text-neutral-900">{item.score}</p>
        </div>
      </div>
    </div>
  );
}

function defaultFrom() {
  return new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

// Module-level for stable identity (the hook keys memoization off `defaults`).
const REPORTS_DEFAULTS = { period: { from: defaultFrom(), to: defaultTo() } };
const REPORTS_STATUS_OPTIONS = REQUIREMENT_STATUS_OPTIONS.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
const REPORTS_EXPORT_COLUMNS = [
  { key: 'title', label: 'Requirement' },
  { key: 'company_name', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'required_skills', label: 'Skills', exportValue: (r) => (r.required_skills || []).join('; ') },
];

export default function WizmatchAnalyticsPage({ demoMode = false }) {
  const [analytics, setAnalytics] = useState(demoMode ? DEMO_ANALYTICS : null);
  const [digest, setDigest] = useState(null);
  const [roi, setRoi] = useState(demoMode ? DEMO_ROI : null);
  const [delivery, setDelivery] = useState(demoMode ? DEMO_DELIVERY : null);
  const [requirementsSummary, setRequirementsSummary] = useState(demoMode ? DEMO_REQUIREMENTS : null);
  const [recruiters, setRecruiters] = useState(demoMode ? DEMO_USERS.items : []);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(!demoMode);

  // Filter state lives in the URL (shareable + presettable) via the shared hook.
  // `source` stays a client-only filter; the rest drive the server fetches below.
  const sourceOptionsForSpec = useMemo(() => {
    const set = new Set();
    (roi?.sourceBreakdown || []).forEach((src) => src.source && set.add(src.source));
    (analytics?.sources || []).forEach((src) => src.source && set.add(src.source));
    (delivery?.sourcePerformance || []).forEach((src) => src.source && set.add(src.source));
    return [...set].sort().map((v) => ({ value: v, label: v }));
  }, [roi, analytics, delivery]);
  const reportsFilters = useMemo(() => [
    { key: 'period', label: 'Period', type: 'dateRange' },
    { key: 'company', label: 'Company', type: 'search', placeholder: 'Company…' },
    { key: 'skill', label: 'Skill', type: 'search', placeholder: 'Skill…' },
    { key: 'status', label: 'Req status', type: 'multiselect', options: REPORTS_STATUS_OPTIONS },
    { key: 'recruiter', label: 'Recruiter', type: 'select', options: recruiters.map((u) => ({ value: u.id, label: u.name })), placeholder: 'Any recruiter' },
    { key: 'source', label: 'Source', type: 'select', options: sourceOptionsForSpec, placeholder: 'Any source' },
  ], [recruiters, sourceOptionsForSpec]);
  const ctl = useTableControls({ pageId: 'wizmatch-reports', spec: reportsFilters, columns: undefined, defaults: REPORTS_DEFAULTS });
  const fromParam = ctl.filters.period?.from || '';
  const toParam = ctl.filters.period?.to || '';
  const companyParam = ctl.filters.company || '';
  const skillParam = ctl.filters.skill || '';
  const statusParam = (ctl.filters.status || []).join(',');
  const recruiterParam = ctl.filters.recruiter || '';
  const sourceParam = ctl.filters.source || '';

  const load = useCallback(async () => {
    setLoading(true);
    if (demoMode) {
      setAnalytics(DEMO_ANALYTICS);
      setRoi(DEMO_ROI);
      setDelivery(DEMO_DELIVERY);
      setRequirementsSummary(DEMO_REQUIREMENTS);
      setRecruiters(DEMO_USERS.items);
      setDigest({ stats: { signals_captured: 126, signals_priority: 39, sends: 7, positive_replies: 2, candidates_sourced: 92 } });
      setErrors({});
      setLoading(false);
      return;
    }

    const period = new URLSearchParams();
    if (fromParam) period.set('from', fromParam);
    if (toParam) period.set('to', toParam);

    const reqParams = new URLSearchParams({ limit: '10' });
    if (companyParam) reqParams.set('company', companyParam);
    if (skillParam) reqParams.set('skill', skillParam);
    if (statusParam) reqParams.set('status', statusParam);
    if (recruiterParam) reqParams.set('assigned_user_id', recruiterParam);

    const [analyticsR, digestR, roiR, deliveryR, requirementsR, usersR] = await Promise.allSettled([
      apiFetch(`/api/wizmatch/analytics?${period}`),
      apiFetch('/api/wizmatch/digest'),
      apiFetch(`/api/wizmatch/analytics/roi?${period}`),
      apiFetch('/api/wizmatch/staffing/analytics'),
      apiFetch(`/api/wizmatch/requirements?${reqParams}`),
      apiFetch('/api/wizmatch/staffing/users'),
    ]);

    const nextErrors = {};

    if (analyticsR.status === 'fulfilled') setAnalytics(analyticsR.value);
    else { setAnalytics(null); nextErrors.analytics = analyticsR.reason?.message || 'Failed to load analytics'; }

    if (digestR.status === 'fulfilled') setDigest(digestR.value);
    else { setDigest(null); nextErrors.digest = digestR.reason?.message || 'Failed to load today’s digest'; }

    if (roiR.status === 'fulfilled') setRoi(roiR.value);
    else { setRoi(null); nextErrors.roi = roiR.reason?.message || 'Failed to load ROI analytics'; }

    if (deliveryR.status === 'fulfilled') setDelivery(deliveryR.value);
    else { setDelivery(null); nextErrors.delivery = deliveryR.reason?.message || 'Failed to load staffing delivery analytics'; }

    if (requirementsR.status === 'fulfilled') setRequirementsSummary(requirementsR.value);
    else { setRequirementsSummary(null); nextErrors.requirements = requirementsR.reason?.message || 'Failed to load requirements'; }

    if (usersR.status === 'fulfilled') setRecruiters(usersR.value.items || []);
    else { setRecruiters([]); nextErrors.recruiters = usersR.reason?.message || 'Failed to load recruiters'; }

    setErrors(nextErrors);
    setLoading(false);
  }, [demoMode, fromParam, toParam, companyParam, skillParam, statusParam, recruiterParam]);

  useEffect(() => { load(); }, [load]);

  const s = digest?.stats || {};
  const maxFunnel = useMemo(() => Math.max(...(roi?.funnel || []).map((item) => item.count || 0), 1), [roi]);

  const deliveryFunnel = useMemo(
    () => buildDeliveryFunnel({
      roi, requirementsSummary, delivery,
      roiError: errors.roi, requirementsError: errors.requirements, deliveryError: errors.delivery,
    }),
    [roi, requirementsSummary, delivery, errors.roi, errors.requirements, errors.delivery],
  );
  const maxDeliveryCount = useMemo(
    () => Math.max(...deliveryFunnel.filter((st) => st.supported && !st.errored && st.count != null).map((st) => st.count || 0), 1),
    [deliveryFunnel],
  );

  const commercial = delivery?.commercial || null;
  const invoiced = commercial ? Number(commercial.invoiced || 0) : null;
  const collected = commercial ? Number(commercial.collected || 0) : null;
  const grossMargin = commercial ? Number(commercial.gross_margin || 0) : null;
  const outstanding = invoiced != null && collected != null ? Math.max(0, invoiced - collected) : null;
  const collectionRate = invoiced != null && invoiced > 0 ? pct(collected, invoiced) : null;

  const signalSourceRows = useMemo(
    () => (roi?.sourceBreakdown || analytics?.sources || []).filter((src) => !sourceParam || src.source === sourceParam),
    [roi, analytics, sourceParam],
  );
  const staffingSourceRows = useMemo(
    () => (delivery?.sourcePerformance || []).filter((src) => !sourceParam || src.source === sourceParam),
    [delivery, sourceParam],
  );

  const filtersActive = ctl.activeChips.length > 0;

  if (loading) return <div className="p-6"><p className="text-neutral-500">Loading...</p></div>;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Wizmatch Reports</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Job Lead → Hiring Contact → Requirement → Match → Shortlist → Submission → Interview → Offer → Start → Invoice → Collection{demoMode ? ' · demo data' : ''}
          </p>
        </div>
        <button onClick={load} className="btn-standard btn-compact self-start" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filters — URL-shareable + presettable via the shared toolbar */}
      <div className="card p-4 mb-6">
        <FilterBar
          spec={reportsFilters}
          filters={ctl.filters}
          setFilter={ctl.setFilter}
          activeChips={ctl.activeChips}
          clearFilter={ctl.clearFilter}
          clearAll={ctl.clearAll}
          onExport={() => exportRowsToCsv(requirementsSummary?.items || [], REPORTS_EXPORT_COLUMNS, 'requirements-report.csv')}
          presets={ctl.presets}
          savePreset={ctl.savePreset}
          applyPreset={ctl.applyPreset}
          deletePreset={ctl.deletePreset}
        />
        <p className="text-[11px] text-neutral-500 mt-1">
          From/To scope the <b>Job Lead</b> and <b>Requirement/Match-adjacent</b> discovery metrics (GET /api/wizmatch/analytics + /analytics/roi).
          Company, Skill, Req status and Recruiter scope the <b>Requirement</b> stage and table below (GET /api/wizmatch/requirements).
          Source filters the signal/source breakdown tables. <b>Submission → Start, SLA/aging, time-to-start and revenue figures are all-time totals</b> — GET /api/wizmatch/staffing/analytics does not accept any query filters yet. Filtering the whole funnel by a single requirement isn't wired to the backend yet.
        </p>
      </div>

      {errors.digest && errors.analytics && errors.roi && errors.delivery && (
        <ErrorRetry message="Failed to load Wizmatch reports." onRetry={load} retrying={loading} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Signals Today" value={s.signals_captured ?? '—'} sub={`${s.signals_priority ?? 0} priority`} />
        <KpiCard label="Positive Reply Rate" value={roi ? formatPct(roi.kpis?.positiveReplyRate) : '—'} sub={`${s.sends ?? 0} sends today`} />
        <KpiCard label="India Signal Share" value={roi ? formatPct(roi.kpis?.indiaSignalShare) : '—'} sub="Target: 80%" />
        <KpiCard label="Monthly Margin" value={roi ? formatCurrency(roi.kpis?.monthlyMargin) : '—'} sub={roi ? `${formatCurrency(roi.kpis?.estimatedAnnualRunRate)} ARR run-rate` : ''} />
        <KpiCard label="Enrichment Cost" value={roi ? formatCurrency((roi.kpis?.costCentsTotal || 0) / 100) : '—'} sub="Phase 1 should stay near zero" />
      </div>

      {/* Delivery funnel: Job Lead -> Collection */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-4 h-4 text-primary-600" />
          <h2 className="text-[15px] font-semibold text-neutral-800">Delivery Funnel — Job Lead to Collection</h2>
        </div>
        <p className="text-[11.5px] text-neutral-500 mb-4">
          Hover a row for its exact data source and caveats. Dashed rows have no backend endpoint to source real numbers from yet — see the gap notes below.
        </p>
        {errors.roi && errors.delivery && errors.requirements ? (
          <ErrorRetry message="Failed to load funnel data." onRetry={load} retrying={loading} />
        ) : (
          <div className="space-y-3">
            {deliveryFunnel.map((stage) => (
              <DeliveryFunnelRow key={stage.key} stage={stage} maxCount={maxDeliveryCount} />
            ))}
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {deliveryFunnel.filter((st) => !st.supported).map((st) => (
            <p key={st.key} className="text-[11px] text-neutral-500 bg-neutral-50 rounded-md px-2.5 py-1.5">
              <b className="text-neutral-500">{st.label} not available:</b> {st.note}
            </p>
          ))}
        </div>
      </div>

      {/* Revenue & Collection */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <IndianRupee className="w-4 h-4 text-primary-600" />
          <h2 className="text-[15px] font-semibold text-neutral-800">Revenue &amp; Collection</h2>
        </div>
        <p className="text-[11.5px] text-neutral-500 mb-4">All placements, all time — GET /api/wizmatch/staffing/analytics has no date-range filter.</p>
        {errors.delivery ? (
          <ErrorRetry message={errors.delivery} onRetry={load} retrying={loading} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <KpiCard label="Invoiced" value={invoiced != null ? formatCurrency(invoiced) : '—'} />
            <KpiCard label="Collected" value={collected != null ? formatCurrency(collected) : '—'} />
            <KpiCard label="Outstanding" value={outstanding != null ? formatCurrency(outstanding) : '—'} />
            <KpiCard label="Collection Rate" value={collectionRate != null ? formatPct(collectionRate) : '—'} sub={invoiced === 0 ? 'No invoices linked yet' : undefined} />
            <KpiCard label="Gross Margin" value={grossMargin != null ? formatCurrency(grossMargin) : '—'} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        {/* SLA & Aging */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">SLA &amp; Aging</h2>
          </div>
          <p className="text-[11.5px] text-neutral-500 mb-4">Open submissions only — all time.</p>
          {errors.delivery ? (
            <ErrorRetry message={errors.delivery} onRetry={load} retrying={loading} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <KpiCard label="Overdue Submissions" value={delivery?.exceptions?.overdue_submissions ?? '—'} />
                <KpiCard label="Missing Next Action" value={delivery?.exceptions?.missing_next_action ?? '—'} />
              </div>
              {(delivery?.aging || []).length === 0 ? (
                <EmptyState title="No open submissions" description="Nothing is currently active in the submission pipeline, so there's no aging to show." variant="true-empty" />
              ) : (
                <div className="space-y-2">
                  {delivery.aging.map((bucket) => (
                    <div key={bucket.bucket} className="flex items-center gap-3">
                      <span className="text-[12px] text-neutral-600 w-16">{bucket.bucket}</span>
                      <div className="flex-1 bg-neutral-100 rounded-full h-5 relative">
                        <div
                          className="bg-primary-500 h-5 rounded-full flex items-center justify-end px-2"
                          style={{ width: `${Math.min(100, Math.max(5, (bucket.count / Math.max(...delivery.aging.map((b) => b.count), 1)) * 100))}%` }}
                        >
                          <span className="text-[11px] text-white font-medium">{bucket.count}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Time to Start */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Time to Start</h2>
          </div>
          <p className="text-[11.5px] text-neutral-500 mb-4">Requirement accepted → placement started. All time.</p>
          {errors.delivery ? (
            <ErrorRetry message={errors.delivery} onRetry={load} retrying={loading} />
          ) : delivery?.timeToFill?.average_days == null ? (
            <EmptyState title="No completed placements yet" description="Time-to-start needs at least one placement created from an accepted requirement." variant="true-empty" />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label="Average" value={formatDays(delivery.timeToFill.average_days)} />
              <KpiCard label="Fastest" value={formatDays(delivery.timeToFill.fastest_days)} />
              <KpiCard label="Slowest" value={formatDays(delivery.timeToFill.slowest_days)} />
            </div>
          )}
          <p className="text-[11px] text-neutral-500 mt-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            Time to first profile / time to submission / time to interview / time to offer are not available — no endpoint exposes per-stage transition timestamps for these yet.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Discovery &amp; Outreach Funnel</h2>
          </div>
          {errors.roi ? (
            <ErrorRetry message={errors.roi} onRetry={load} retrying={loading} />
          ) : (
            <div className="space-y-4">
              {(roi?.funnel || []).map((item) => (
                <FunnelRow key={item.stage} item={item} max={maxFunnel} />
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Guardrails</h2>
          </div>
          <div className="space-y-2 text-[12.5px] text-neutral-600">
            <p className="rounded-md bg-neutral-50 px-3 py-2">Paid enrichment: {roi?.guardrails?.paidEnrichment?.replace(/_/g, ' ') ?? '—'}</p>
            <p className="rounded-md bg-neutral-50 px-3 py-2">Sending: {roi?.guardrails?.sending?.replace(/_/g, ' ') ?? '—'}</p>
            <p className="rounded-md bg-neutral-50 px-3 py-2">Deterministic before AI: {roi ? (roi.guardrails?.deterministicBeforeAi ? 'yes' : 'no') : '—'}</p>
            <p className="rounded-md bg-neutral-50 px-3 py-2">Scope: internal IT/Tech staffing only</p>
          </div>
          <p className="text-[11px] text-neutral-500 mt-3">
            Technical deliverability (SPF/DKIM/DMARC, domain pause state) lives on{' '}
            <Link to="/wizmatch/system?tab=domains" className="text-primary-600 font-medium hover:underline">System → Deliverability / Domains</Link>, not here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-6">
        {(roi?.moduleScorecards || []).map((item) => (
          <ModuleScorecard key={item.module} item={item} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-success-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Recommended Next Moves</h2>
          </div>
          <div className="space-y-2">
            {(roi?.recommendations || []).map((item) => (
              <p key={item} className="text-[12.5px] text-neutral-700 rounded-md bg-neutral-50 px-3 py-2">{item}</p>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-warning-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Risks</h2>
          </div>
          <div className="space-y-2">
            {(roi?.risks || []).map((item) => (
              <p key={item} className="text-[12.5px] text-neutral-700 rounded-md bg-neutral-50 px-3 py-2">{item}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        {/* Recruiter performance */}
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-700 mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Recruiter Performance</h2>
          <div className="card p-4 overflow-x-auto">
            {errors.delivery ? <ErrorRetry message={errors.delivery} onRetry={load} retrying={loading} /> : (
              <>
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-neutral-200">
                      <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Recruiter</th>
                      <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Submissions</th>
                      <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Progressed</th>
                      <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Starts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(delivery?.recruiterPerformance || []).map((r) => (
                      <tr key={r.recruiter} className="border-b border-neutral-100 last:border-0">
                        <td className="py-2 text-sm font-medium text-neutral-900">{r.recruiter}</td>
                        <td className="py-2 text-sm text-neutral-600 text-right">{r.submissions}</td>
                        <td className="py-2 text-sm text-neutral-600 text-right">{r.progressed}</td>
                        <td className="py-2 text-sm text-neutral-600 text-right">{r.starts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(delivery?.recruiterPerformance || []).length === 0 && <p className="text-neutral-500 text-sm">No submissions recorded yet</p>}
              </>
            )}
          </div>
        </div>

        {/* Rejection reasons */}
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-700 mb-3 flex items-center gap-2"><XCircle className="w-4 h-4" /> Rejection &amp; Withdrawal Reasons</h2>
          <div className="card p-4">
            {errors.delivery ? <ErrorRetry message={errors.delivery} onRetry={load} retrying={loading} /> : (
              <>
                {(delivery?.rejectionReasons || []).map((r) => (
                  <div key={r.reason} className="flex justify-between items-center py-2 border-b border-neutral-100 last:border-0">
                    <span className="text-sm text-neutral-700">{r.reason}</span>
                    <span className="text-sm font-medium text-neutral-900">{r.count}</span>
                  </div>
                ))}
                {(delivery?.rejectionReasons || []).length === 0 && <p className="text-neutral-500 text-sm">No rejections or withdrawals recorded yet</p>}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Signals by Source</h2>
          <div className="card p-4">
            {errors.roi && errors.analytics ? <ErrorRetry message="Failed to load source breakdown." onRetry={load} retrying={loading} /> : (
              <>
                {signalSourceRows.map((src) => (
                  <div key={src.source} className="flex justify-between items-center py-2 border-b border-neutral-100 last:border-0">
                    <span className="text-sm font-medium text-neutral-900 capitalize">{src.source}</span>
                    <div className="flex gap-4">
                      <span className="text-sm text-neutral-600">{src.count} signals</span>
                      <span className="text-sm text-neutral-500">avg score {Number(src.avgScore ?? src.avg_score ?? 0).toFixed(1)}</span>
                    </div>
                  </div>
                ))}
                {signalSourceRows.length === 0 && <p className="text-neutral-500 text-sm">{sourceParam ? 'No signals for this source' : 'No signals yet'}</p>}
              </>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Staffing Outcomes by Source</h2>
          <div className="card p-4">
            {errors.delivery ? <ErrorRetry message={errors.delivery} onRetry={load} retrying={loading} /> : (
              <>
                {staffingSourceRows.map((src) => (
                  <div key={src.source} className="flex justify-between items-center py-2 border-b border-neutral-100 last:border-0">
                    <span className="text-sm font-medium text-neutral-900 capitalize">{src.source}</span>
                    <div className="flex gap-4">
                      <span className="text-sm text-neutral-600">{src.submissions} submissions</span>
                      <span className="text-sm text-neutral-500">{src.starts} starts</span>
                    </div>
                  </div>
                ))}
                {staffingSourceRows.length === 0 && <p className="text-neutral-500 text-sm">{sourceParam ? 'No staffing outcomes for this source' : 'No candidate submissions yet'}</p>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filtered requirements — makes the Company/Skill/Status/Recruiter filters visibly do something */}
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Requirements Matching Filters</h2>
        <div className="card p-4 overflow-x-auto">
          {errors.requirements ? <ErrorRetry message={errors.requirements} onRetry={load} retrying={loading} /> : requirementsSummary && requirementsSummary.total === 0 ? (
            <EmptyState
              title="No requirements match these filters"
              description={filtersActive ? 'Try clearing a filter — nothing in this tenant matches the current combination.' : 'No requirements have been created for this tenant yet.'}
              variant={filtersActive ? 'filtered-empty' : 'true-empty'}
            />
          ) : (
            <>
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Requirement</th>
                    <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Company</th>
                    <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Status</th>
                    <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Skills</th>
                  </tr>
                </thead>
                <tbody>
                  {(requirementsSummary?.items || []).map((r) => (
                    <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2 text-sm font-medium text-neutral-900">{r.title}</td>
                      <td className="py-2 text-sm text-neutral-600">{r.company_name || '—'}</td>
                      <td className="py-2 text-sm text-neutral-600">{(r.status || '').replace(/_/g, ' ')}</td>
                      <td className="py-2 text-sm text-neutral-600">{(r.required_skills || []).slice(0, 4).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {requirementsSummary && requirementsSummary.total > (requirementsSummary.items || []).length && (
                <p className="text-[11.5px] text-neutral-500 mt-2">Showing {(requirementsSummary.items || []).length} of {requirementsSummary.total}.</p>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Pipeline Value by Stage</h2>
        <div className="card p-4">
          {errors.analytics ? <ErrorRetry message={errors.analytics} onRetry={load} retrying={loading} /> : (
            <>
              {(analytics?.pipeline || []).map((p) => (
                <div key={p.status} className="flex items-center gap-3 mb-2">
                  <span className="text-sm text-neutral-700 w-32 capitalize">{p.status}</span>
                  <div className="flex-1 bg-neutral-100 rounded-full h-6 relative">
                    <div
                      className="bg-primary-500 h-6 rounded-full flex items-center justify-end px-2 transition-all duration-200"
                      style={{ width: `${Math.min(100, (p.count / Math.max(...(analytics?.pipeline?.map((x) => x.count) || [1]))) * 100)}%` }}
                    >
                      <span className="text-xs text-white font-medium">{p.count}</span>
                    </div>
                  </div>
                  <span className="text-sm text-success-600 w-28 text-right font-medium">{formatCurrency(p.monthly_value || 0)}</span>
                </div>
              ))}
              {(analytics?.pipeline || []).length === 0 && <p className="text-neutral-500 text-sm">No placements yet</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
