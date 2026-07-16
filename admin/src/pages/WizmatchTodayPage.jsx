import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  UsersRound,
} from 'lucide-react';
import { apiFetch, getUser } from '../lib/api.js';
import { buildWizmatchTodayView, WIZMATCH_TODAY_BUCKETS } from '../lib/wizmatchRouteRegistry.js';
import { nextRovingTabIndex } from '../lib/focusManagement.js';

const REVIEW_ROLES = new Set(['admin', 'manager_ops', 'team_lead']);
const TYPE_LABELS = {
  company: 'Company',
  contact: 'Hiring contact',
  contact_candidate: 'POC research',
  requirement: 'Role',
  candidate: 'Candidate',
  submission: 'Submission',
  task: 'Task',
  safety: 'System',
};

function formatDue(value) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date needs review';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function MetricCard({ icon: Icon, label, value, helper, tone = 'primary' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
  };
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-neutral-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-neutral-950">{value}</p>
          <p className="mt-1 text-xs text-neutral-500">{helper}</p>
        </div>
        <span className={`rounded-lg p-2 ${tones[tone] || tones.primary}`}><Icon className="h-4 w-4" /></span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3" aria-label="Loading today's work">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-28 animate-pulse rounded-xl border border-neutral-100 bg-white" />
      ))}
    </div>
  );
}

function WorkCard({ item }) {
  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge-muted">{TYPE_LABELS[item.entityType] || 'Work item'}</span>
            {item.sla && <span className="badge-info">SLA {String(item.sla).replaceAll('_', ' ')}</span>}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-neutral-950">{item.title}</h3>
          {item.subtitle && <p className="mt-1 text-xs leading-5 text-neutral-500">{item.subtitle}</p>}
          {item.blocker && (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger-700">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {item.blocker}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatDue(item.dueAt)}</span>
            <span className="font-medium text-neutral-700">Next: {item.recommendedAction}</span>
          </div>
        </div>
        <Link
          to={item.href}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
        >
          Open record <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

export default function WizmatchTodayPage() {
  const user = getUser();
  const canReviewTeam = REVIEW_ROLES.has(user?.role);
  const [state, setState] = useState({ status: 'loading', myWork: {}, workbench: {}, error: '', warning: '' });
  const [filter, setFilter] = useState('attention');
  const tabRefs = useRef([]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '', warning: '' }));
    try {
      const [myWorkResult, workbenchResult] = await Promise.allSettled([
        apiFetch('/api/wizmatch/staffing/my-work'),
        canReviewTeam ? apiFetch('/api/wizmatch/review-workbench?limit=30') : Promise.resolve({ actions: [] }),
      ]);
      if (myWorkResult.status === 'rejected') throw myWorkResult.reason;
      const reviewUnavailable = workbenchResult.status === 'rejected';
      setState({
        status: 'ready',
        myWork: myWorkResult.value,
        workbench: reviewUnavailable ? { actions: [] } : workbenchResult.value,
        error: '',
        warning: reviewUnavailable ? 'Your work is available, but the team-review queue could not be loaded. Retry before making team decisions.' : '',
      });
    } catch (error) {
      setState({
        status: 'error',
        myWork: {},
        workbench: {},
        error: error?.message || 'Today could not be loaded. Nothing has been changed.',
        warning: '',
      });
    }
  }, [canReviewTeam]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (state.warning && filter === 'team_review') setFilter('attention');
  }, [state.warning, filter]);

  const view = useMemo(() => buildWizmatchTodayView(state.myWork, state.workbench, { canReviewTeam }), [state.myWork, state.workbench, canReviewTeam]);
  const filters = useMemo(() => [
    { id: 'attention', label: 'Needs attention', count: view.metrics.needsAttention },
    ...WIZMATCH_TODAY_BUCKETS
      .filter((bucket) => bucket.id !== 'team_review' || (canReviewTeam && !state.warning))
      .map((bucket) => ({ ...bucket, count: view.buckets[bucket.id]?.length || 0 })),
  ], [view, canReviewTeam, state.warning]);
  const visibleItems = filter === 'attention'
    ? view.items.filter((item) => ['overdue', 'due_today', 'blocked'].includes(item.bucket))
    : view.buckets[filter] || [];
  const active = filters.find((item) => item.id === filter) || filters[0];

  function handleTabKeyDown(event, index) {
    const nextIndex = nextRovingTabIndex(event.key, index, filters.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextFilter = filters[nextIndex];
    setFilter(nextFilter.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600">Your operating queue</p>
          <h1 className="mt-1 text-2xl font-bold text-neutral-950">Today</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            {user?.name ? `${user.name}, start` : 'Start'} with overdue and blocked work. Each card opens the exact record and shows the next action.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/wizmatch/job-leads" className="btn-standard btn-compact">Review job leads</Link>
          <Link to="/wizmatch/roles?action=new" className="btn-primary btn-compact">Add role</Link>
          <button type="button" onClick={load} disabled={state.status === 'loading'} className="btn-standard btn-compact">
            <RefreshCw className={`h-3.5 w-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </header>

      {state.status === 'error' && (
        <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-5 text-danger-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1">
              <h2 className="font-semibold">Today is temporarily unavailable</h2>
              <p className="mt-1 text-sm">{state.error}</p>
              <button type="button" onClick={load} className="mt-3 rounded-lg bg-danger-700 px-3 py-2 text-xs font-semibold text-white hover:bg-danger-800">Retry</button>
            </div>
          </div>
        </div>
      )}

      {state.status !== 'error' && state.warning && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 text-warning-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">{state.warning}</p>
          <button type="button" onClick={load} className="shrink-0 rounded-lg border border-warning-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-warning-100">Retry team review</button>
        </div>
      )}

      {state.status !== 'error' && (
        <>
          <section aria-label="Today summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard icon={CalendarClock} label="Needs attention" value={view.metrics.needsAttention} helper="Overdue, due today or blocked" tone={view.metrics.needsAttention ? 'danger' : 'primary'} />
            <MetricCard icon={BriefcaseBusiness} label="Assigned roles" value={view.metrics.assignedRoles} helper="Active requirements you can work" />
            <MetricCard
              icon={canReviewTeam ? UsersRound : Clock3}
              label={canReviewTeam ? 'Team review' : 'Waiting'}
              value={canReviewTeam ? (state.warning ? '—' : view.metrics.teamReview) : view.buckets.waiting.length}
              helper={canReviewTeam ? (state.warning ? 'Temporarily unavailable' : 'Safe decisions awaiting review') : 'Future or external dependencies'}
              tone="warning"
            />
          </section>

          <section>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Work buckets" aria-orientation="horizontal">
              {filters.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  id={`today-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  aria-controls="today-work-panel"
                  tabIndex={filter === item.id ? 0 : -1}
                  onClick={() => setFilter(item.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    filter === item.id
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-300 hover:text-primary-700'
                  }`}
                >
                  {item.label} <span className="ml-1 opacity-75">{item.count}</span>
                </button>
              ))}
            </div>

            <div id="today-work-panel" role="tabpanel" aria-labelledby={`today-tab-${active.id}`} tabIndex={0} className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 md:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-neutral-900">{active.label}</h2>
                  <p className="text-xs text-neutral-500">{active.description || 'Work that needs your attention first'}</p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-neutral-600 shadow-sm">{visibleItems.length} items</span>
              </div>

              {state.status === 'loading' ? <LoadingState /> : visibleItems.length ? (
                <div className="space-y-3">{visibleItems.map((item) => <WorkCard key={item.id} item={item} />)}</div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-5 py-10 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-success-500" />
                  <h3 className="mt-3 text-sm font-semibold text-neutral-900">Nothing in {active.label.toLowerCase()}</h3>
                  <p className="mt-1 text-xs text-neutral-500">You are clear here. Choose another bucket or review new job leads.</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
