import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ListChecks, RefreshCw, Users } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const BUCKET_META = {
  overdue: { label: 'Overdue', icon: AlertTriangle, tone: 'danger' },
  dueToday: { label: 'Due Today', icon: Clock, tone: 'warning' },
  blocked: { label: 'Blocked', icon: AlertTriangle, tone: 'danger' },
  waiting: { label: 'Waiting for Someone', icon: Users, tone: 'info' },
  recentlyChanged: { label: 'Recently Changed', icon: RefreshCw, tone: 'muted' },
  teamReview: { label: 'Team Review', icon: ListChecks, tone: 'info' },
};

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

/** Buckets a my-work requirement row into exactly one Today bucket. */
function bucketRequirement(r, now) {
  const dueAt = r.next_action_due_at ? new Date(r.next_action_due_at) : null;
  const hasSource = Boolean(r.source_first_name);
  const isBlocked = r.stage === 'on_hold' || (!r.next_action && !hasSource);
  if (isBlocked) return 'blocked';
  if (dueAt && dueAt < now) return 'overdue';
  if (dueAt && dueAt >= startOfDay(now) && dueAt <= endOfDay(now)) return 'dueToday';
  if (dueAt && dueAt > endOfDay(now)) return 'waiting';
  return 'recentlyChanged';
}

function bucketTask(t, now) {
  const dueAt = t.due_at ? new Date(t.due_at) : null;
  if (dueAt && dueAt < now) return 'overdue';
  if (dueAt && dueAt >= startOfDay(now) && dueAt <= endOfDay(now)) return 'dueToday';
  if (dueAt && dueAt > endOfDay(now)) return 'waiting';
  return 'recentlyChanged';
}

function WorkItemRow({ item }) {
  const isTask = item.kind === 'task';
  const href = isTask
    ? (item.requirement_id ? `/wizmatch/requirements?id=${item.requirement_id}` : '/wizmatch/requirements')
    : `/wizmatch/requirements?id=${item.id}`;
  const dueAt = isTask ? item.due_at : item.next_action_due_at;
  const nextAction = isTask ? item.title : (item.next_action || 'No next action set');
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-3 rounded-md border border-neutral-100 bg-white px-3 py-2.5 hover:border-primary-300 transition"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="badge-muted text-[10px] uppercase">{isTask ? 'Task' : 'Requirement'}</span>
          <span className="font-medium text-neutral-900 truncate">{isTask ? item.title : item.title}</span>
        </div>
        <p className="text-[12px] text-neutral-500 mt-0.5 truncate">
          {!isTask && (item.company_name || 'No client on file')}
          {!isTask && item.source_first_name ? ` · Source: ${item.source_first_name} ${item.source_last_name || ''}` : ''}
          {' — '}{nextAction}
        </p>
      </div>
      <div className="text-right shrink-0">
        {dueAt && <div className="text-[11px] text-neutral-500">{new Date(dueAt).toLocaleDateString()}</div>}
        {!isTask && item.sla_due_at && (
          <div className="text-[10px] text-neutral-400">SLA {new Date(item.sla_due_at).toLocaleDateString()}</div>
        )}
      </div>
    </a>
  );
}

function BucketSection({ bucketKey, items }) {
  const meta = BUCKET_META[bucketKey];
  if (!items.length) return null;
  const Icon = meta.icon;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-neutral-500" />
        <h3 className="font-bold text-neutral-900 text-[13.5px]">{meta.label}</h3>
        <span className="badge-muted text-[11px]">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => <WorkItemRow key={`${item.kind}-${item.id}`} item={item} />)}
      </div>
    </div>
  );
}

export default function WizmatchTodayPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [buckets, setBuckets] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [teamReview, setTeamReview] = useState([]);
  const [canSeeTeamReview, setCanSeeTeamReview] = useState(false);
  const [partialFailure, setPartialFailure] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPartialFailure(null);
    try {
      // Each source fails independently and defaults to an empty result so a
      // failure in one doesn't blank the whole page — but a genuine outage
      // must never be silently indistinguishable from "you have no work
      // today", so a failed source is tracked and disclosed via the banner
      // below rather than swallowed.
      const failures = [];
      const [myWork, dashboard] = await Promise.all([
        apiFetch('/api/wizmatch/staffing/my-work').catch((e) => { failures.push(`assigned work (${e.message || 'request failed'})`); return { requirements: [], tasks: [] }; }),
        apiFetch('/api/wizmatch/dashboard').catch((e) => { failures.push(`readiness metrics (${e.message || 'request failed'})`); return null; }),
      ]);
      if (failures.length > 0) setPartialFailure(`Could not load: ${failures.join('; ')}. What's shown below may be incomplete.`);
      const now = new Date();
      const next = { overdue: [], dueToday: [], blocked: [], waiting: [], recentlyChanged: [] };
      for (const r of myWork.requirements || []) {
        next[bucketRequirement(r, now)].push({ ...r, kind: 'requirement' });
      }
      for (const t of myWork.tasks || []) {
        next[bucketTask(t, now)].push({ ...t, kind: 'task' });
      }
      // Recently changed caps at 5 most-recent by updated_at/stage_entered_at so it stays a signal, not a dump.
      next.recentlyChanged = next.recentlyChanged
        .sort((a, b) => new Date(b.updated_at || b.stage_entered_at || 0) - new Date(a.updated_at || a.stage_entered_at || 0))
        .slice(0, 5);
      setBuckets(next);

      if (dashboard) {
        setMetrics({
          openRequirements: dashboard.requirementsSummary?.total ?? dashboard.readiness ? undefined : undefined,
          readinessScore: dashboard.readiness?.score,
          readinessIssue: dashboard.readiness?.primaryIssue,
          activePlacements: dashboard.recentPlacements?.length,
        });
      }

      // Team review is a review-workbench read, gated to admin/team_lead by the API itself
      // (403 for anyone else) — treat that as "not visible to this role", not an error.
      try {
        const workbench = await apiFetch('/api/wizmatch/review-workbench?limit=10');
        setTeamReview(workbench.actions || []);
        setCanSeeTeamReview(true);
      } catch {
        setCanSeeTeamReview(false);
      }
    } catch (e) {
      setError(e.message || 'Failed to load Today.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="p-6"><div className="card p-8 text-center text-neutral-400">Loading Today…</div></div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div role="alert" className="card p-6 text-center">
          <AlertTriangle className="mx-auto w-6 h-6 text-danger-600" />
          <p className="mt-2 text-[13px] text-neutral-700">{error}</p>
          <button onClick={load} className="btn-primary btn-compact mt-3">Retry</button>
        </div>
      </div>
    );
  }

  const totalWorkItems = Object.values(buckets).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Today</h1>
        <button onClick={load} className="btn-standard btn-compact">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-5">Your assigned work, grouped by what needs attention now.</p>

      {partialFailure && (
        <div role="alert" className="card p-3 mb-4 border-warning-500/30 bg-warning-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-700 mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-warning-800">{partialFailure}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3 mb-5">
        <div className="card p-4">
          <p className="text-[11px] uppercase font-semibold text-neutral-500">Open Work Items</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{totalWorkItems}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] uppercase font-semibold text-neutral-500">Readiness Score</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{metrics?.readinessScore ?? '—'}</p>
          {metrics?.readinessIssue && <p className="text-[11px] text-neutral-500 mt-0.5">{metrics.readinessIssue}</p>}
        </div>
        <div className="card p-4">
          <p className="text-[11px] uppercase font-semibold text-neutral-500">Blocked Items</p>
          <p className="text-2xl font-bold text-neutral-900 mt-1">{buckets.blocked.length}</p>
        </div>
      </div>

      {totalWorkItems === 0 && !canSeeTeamReview && !partialFailure && (
        <div className="card p-6 text-center">
          <CheckCircle2 className="mx-auto w-6 h-6 text-success-600" />
          <p className="mt-2 font-semibold text-neutral-900">Nothing assigned to you right now</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Work appears here once a requirement or task is assigned to you with a next action or due date.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <BucketSection bucketKey="overdue" items={buckets.overdue} />
        <BucketSection bucketKey="dueToday" items={buckets.dueToday} />
        <BucketSection bucketKey="blocked" items={buckets.blocked} />
        <BucketSection bucketKey="waiting" items={buckets.waiting} />
        <BucketSection bucketKey="recentlyChanged" items={buckets.recentlyChanged} />

        {canSeeTeamReview && teamReview.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="w-4 h-4 text-neutral-500" />
              <h3 className="font-bold text-neutral-900 text-[13.5px]">Team Review</h3>
              <span className="badge-muted text-[11px]">{teamReview.length}</span>
              <span className="text-[10.5px] text-neutral-400">visible to leads/admins</span>
            </div>
            <div className="space-y-2">
              {teamReview.slice(0, 10).map((action, i) => (
                <a key={i} href="/wizmatch/review-workbench" className="flex items-center justify-between gap-3 rounded-md border border-neutral-100 bg-white px-3 py-2.5 hover:border-primary-300 transition">
                  <div className="min-w-0">
                    <span className="font-medium text-neutral-900 truncate">{action.title || action.verb || action.type}</span>
                    <p className="text-[12px] text-neutral-500 truncate">{action.what || action.description || ''}</p>
                  </div>
                  <span className={`badge-${action.priority === 'hot' ? 'danger' : action.priority === 'warm' ? 'warning' : 'muted'} text-[10px] shrink-0`}>
                    {action.priority || 'watch'}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
