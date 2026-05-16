// Focus view — "today buckets" for the assigned-to-me tasks. Renders four
// stat tiles (Overdue / Due today / In progress / Done today) and four
// sections (Overdue / Due today / In progress / Up next).
//
// Ports prototype tasks/today.jsx with these adaptations:
//   - real API field names: `assignedTo` (not `assignee`), `commentCount`
//   - real `new Date()` rather than the prototype's frozen 2026-05-17 NOW
//   - sort uses PRIORITY_RANK from lib/tokens.js

import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import FocusRow from './FocusRow.jsx';
import { dueTone } from './lib/format.js';
import { PRIORITY_RANK } from './lib/tokens.js';

const TONE_CARD = {
  slate:   'bg-white border-slate-200',
  rose:    'bg-rose-50 border-rose-200',
  amber:   'bg-amber-50 border-amber-200',
  sky:     'bg-sky-50 border-sky-200',
  emerald: 'bg-emerald-50 border-emerald-200',
};
const TONE_VALUE = {
  slate:   'text-slate-800',
  rose:    'text-rose-700',
  amber:   'text-amber-700',
  sky:     'text-sky-700',
  emerald: 'text-emerald-700',
};
const TONE_DOT = {
  rose:    'bg-rose-500',
  amber:   'bg-amber-500',
  sky:     'bg-sky-500',
  emerald: 'bg-emerald-500',
  slate:   'bg-slate-400',
};

function StatCard({ label, value, tone, sub }) {
  return (
    <div className={`flex-1 min-w-0 border rounded-xl px-4 py-3 ${TONE_CARD[tone] || TONE_CARD.slate}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${TONE_VALUE[tone] || TONE_VALUE.slate}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function FocusSection({ title, hint, count, tone, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 mb-2 text-left"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[tone] || TONE_DOT.slate}`} aria-hidden />
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5">{count}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
        <span className="ml-auto text-slate-400">
          {open ? <ChevronUp className="w-4 h-4" aria-hidden /> : <ChevronDown className="w-4 h-4" aria-hidden />}
        </span>
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </section>
  );
}

function sortBucket(arr, smartSort) {
  return [...arr].sort((a, b) => {
    if (smartSort) {
      const ar = a.smartRank ?? 999;
      const br = b.smartRank ?? 999;
      if (ar !== br) return ar - br;
    }
    const pa = PRIORITY_RANK[a.priority || 'medium'] ?? 1;
    const pb = PRIORITY_RANK[b.priority || 'medium'] ?? 1;
    if (pa !== pb) return pa - pb;
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return ad - bd;
  });
}

function todayDateLabel(d = new Date()) {
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday}, ${month} ${d.getDate()}`;
}

export default function FocusView({
  tasks,
  team = [],
  currentUserId,
  onOpenTask,
  onToggleDone,
  onPatchTask,
  smartSort,
}) {
  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d;
  }, [now]);

  // Bucket calculation — only against my (non-done) tasks. If we don't know
  // who "I" am yet, show no buckets (defensive).
  const buckets = useMemo(() => {
    const safe = Array.isArray(tasks) ? tasks : [];
    const mine = currentUserId
      ? safe.filter((t) => t.assignedTo === currentUserId && t.status !== 'done')
      : [];

    const overdue = mine.filter((t) => t.dueAt && dueTone(t, now) === 'overdue');
    const dueToday = mine.filter((t) => t.dueAt && dueTone(t, now) === 'soon' && new Date(t.dueAt) >= todayStart);
    const overdueSet = new Set(overdue.map((t) => t.id));
    const todaySet = new Set(dueToday.map((t) => t.id));
    const inProgress = mine.filter((t) =>
      t.status === 'in_progress' && !overdueSet.has(t.id) && !todaySet.has(t.id)
    );
    const inProgressSet = new Set(inProgress.map((t) => t.id));
    const upNext = mine.filter((t) =>
      !overdueSet.has(t.id) && !todaySet.has(t.id) && !inProgressSet.has(t.id) && dueTone(t, now) === 'week'
    );

    const completedToday = safe.filter((t) => {
      if (t.status !== 'done') return false;
      if (currentUserId && t.assignedTo !== currentUserId) return false;
      // Use completedAt/updatedAt if present, otherwise count any "done" assigned to me.
      const stamp = t.completedAt || t.updatedAt;
      if (!stamp) return true;
      const d = new Date(stamp);
      return !isNaN(d.getTime()) && d >= todayStart;
    }).length;

    return { overdue, dueToday, inProgress, upNext, completedToday };
  }, [tasks, currentUserId, now, todayStart]);

  const onDefer = (task) => {
    if (!onPatchTask) return;
    const base = task.dueAt ? new Date(task.dueAt) : new Date(now);
    if (isNaN(base.getTime())) base.setTime(now.getTime());
    base.setDate(base.getDate() + 1);
    onPatchTask(task.id, { dueAt: base.toISOString() });
  };

  const { overdue, dueToday, inProgress, upNext, completedToday } = buckets;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-slate-50/60">
      <div className="max-w-3xl mx-auto px-6 py-6">
        {/* Greeting */}
        <div className="mb-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Focus</h1>
            <span className="text-sm text-slate-500">{todayDateLabel(now)}</span>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            {overdue.length > 0 ? (
              <>You have <span className="font-semibold text-rose-700">{overdue.length} overdue {overdue.length === 1 ? 'task' : 'tasks'}</span>{' '}
                and <span className="font-semibold text-amber-700">{dueToday.length} due today</span>.</>
            ) : dueToday.length > 0 ? (
              <>You have <span className="font-semibold text-amber-700">{dueToday.length} {dueToday.length === 1 ? 'task' : 'tasks'} due today</span>.</>
            ) : (
              <>You're caught up — nothing overdue, nothing due today.</>
            )}
          </p>
        </div>

        {/* Stat strip */}
        <div className="flex gap-3 mb-6">
          <StatCard label="Overdue"     value={overdue.length}    tone={overdue.length ? 'rose' : 'slate'} sub={overdue.length ? 'Tackle first' : 'All clear'} />
          <StatCard label="Due today"   value={dueToday.length}   tone="amber"   sub="Plan your day" />
          <StatCard label="In progress" value={inProgress.length} tone="sky"     sub="Active work" />
          <StatCard label="Done today"  value={completedToday}    tone="emerald" sub="Nice work" />
        </div>

        {/* Sections */}
        {overdue.length > 0 && (
          <FocusSection title="Overdue" hint="Past due — handle or defer" count={overdue.length} tone="rose">
            {sortBucket(overdue, smartSort).map((t) => (
              <FocusRow
                key={t.id}
                task={t}
                team={team}
                smartSort={smartSort}
                onOpen={onOpenTask}
                onToggleDone={onToggleDone}
                onDefer={onDefer}
              />
            ))}
          </FocusSection>
        )}

        <FocusSection title="Due today" hint="On your plate now" count={dueToday.length} tone="amber">
          {dueToday.length === 0 && (
            <p className="text-xs text-slate-400 italic py-2">Nothing due today — enjoy a clear afternoon ☕</p>
          )}
          {sortBucket(dueToday, smartSort).map((t) => (
            <FocusRow
              key={t.id}
              task={t}
              team={team}
              smartSort={smartSort}
              onOpen={onOpenTask}
              onToggleDone={onToggleDone}
              onDefer={onDefer}
            />
          ))}
        </FocusSection>

        {inProgress.length > 0 && (
          <FocusSection title="In progress" hint="Pick up where you left off" count={inProgress.length} tone="sky">
            {sortBucket(inProgress, smartSort).map((t) => (
              <FocusRow
                key={t.id}
                task={t}
                team={team}
                smartSort={smartSort}
                onOpen={onOpenTask}
                onToggleDone={onToggleDone}
                onDefer={onDefer}
              />
            ))}
          </FocusSection>
        )}

        {upNext.length > 0 && (
          <FocusSection title="Up next" hint="This week" count={upNext.length} tone="slate" defaultOpen={false}>
            {sortBucket(upNext, smartSort).map((t) => (
              <FocusRow
                key={t.id}
                task={t}
                team={team}
                smartSort={smartSort}
                onOpen={onOpenTask}
                onToggleDone={onToggleDone}
                onDefer={onDefer}
              />
            ))}
          </FocusSection>
        )}
      </div>
    </div>
  );
}
