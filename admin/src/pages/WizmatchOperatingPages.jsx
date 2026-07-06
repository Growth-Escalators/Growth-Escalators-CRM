import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Contact,
  DatabaseZap,
  FileText,
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
  healthy: 'badge-success',
  approved: 'badge-success',
  review_candidates: 'badge-info',
  approve_contact: 'badge-success',
  send_to_contact_intelligence: 'badge-info',
  prioritize_requirement: 'badge-warning',
  resolve_safety: 'badge-danger',
};

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
    blockers: ['1 paused/blacklisted sending domain(s).', '2 paid discovery request(s) were blocked by caps.'],
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
  costControls: {
    paidDiscoveryEnabled: false,
    maxPaidDiscoveryPerCompany: 0,
    maxContactCandidatesShown: 3,
    rediscoveryCooldownDays: 30,
  },
  rules: [
    'Paid enrichment remains disabled until company qualification and explicit approval.',
    'Manual approval is required before outreach.',
    'Candidate review persistence does not create submissions.',
    'Requirement priority planning does not change requirement status.',
    'Safety blockers must be resolved before volume increases.',
  ],
};

function badgeFor(value) {
  return BADGE[value] || 'badge-muted';
}

function text(value) {
  return String(value || '').replace(/_/g, ' ');
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
    <div className="min-h-screen bg-neutral-50 px-5 py-5 lg:px-8">
      <div className="mx-auto max-w-[1540px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5">
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

function ActionCard({ action, onRun, running }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={badgeFor(action.priority)}>{action.priority}</span>
            <span className={badgeFor(action.actionType)}>{text(action.actionType)}</span>
            <span className="badge-muted">{text(action.module)}</span>
          </div>
          <h2 className="text-[15px] font-semibold text-neutral-950">{action.title}</h2>
          <p className="mt-1 text-[12.5px] text-neutral-500">{action.subtitle}</p>
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
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-100 pt-3">
        <p className="text-[12px] text-neutral-500">{(action.guardrails || [])[0] || 'Manual action only.'}</p>
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
  const actions = data.actions || [];

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

      {message && <div className="rounded-md border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">{message}</div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-3">
          {actions.map((action) => (
            <ActionCard key={action.id} action={action} onRun={runAction} running={runningId === action.id} />
          ))}
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary-600" />
              <h2 className="text-[15px] font-semibold text-neutral-950">Safety center</h2>
            </div>
            <span className={badgeFor(data.safetyCenter?.status)}>{data.safetyCenter?.status || 'healthy'}</span>
            <div className="mt-3 space-y-2">
              {(data.safetyCenter?.blockers || ['No blockers detected.']).map((item) => (
                <p key={item} className="rounded-md bg-neutral-50 px-3 py-2 text-[12.5px] text-neutral-700">{item}</p>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2">
              <DatabaseZap className="h-4 w-4 text-primary-600" />
              <h2 className="text-[15px] font-semibold text-neutral-950">Guardrails</h2>
            </div>
            <div className="space-y-2">
              {Object.entries(data.guardrails || {}).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2 text-[12.5px]">
                  <span className="font-semibold text-neutral-700">{text(key)}</span>
                  <span className="text-neutral-500">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
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
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0], [items, selectedId]);

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
              <p className="text-3xl font-bold text-neutral-950">{selected.score}</p>
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
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-neutral-950">Active blockers</h2>
          <div className="space-y-2">
            {(data.safetyCenter?.blockers || ['No blockers detected.']).map((item) => (
              <p key={item} className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{item}</p>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-neutral-950">Rules enforced</h2>
          <div className="space-y-2">
            {(data.rules || []).map((rule) => (
              <p key={rule} className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-800">{rule}</p>
            ))}
          </div>
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
    { title: 'Safety checked', detail: 'Paid enrichment, sending, and submissions remain blocked until manual approval gates pass.', icon: ShieldCheck },
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
        <h2 className="mb-3 text-lg font-bold text-neutral-950">Preview links</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['/wizmatch/review-workbench-demo', 'Review Workbench'],
            ['/wizmatch/requirement-priority-new-demo', 'Requirement Priority'],
            ['/wizmatch/guardrails-new-demo', 'Guardrail Center'],
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
