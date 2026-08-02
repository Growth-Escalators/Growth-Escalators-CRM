// ListView — flat sortable, groupable table view of tasks.
// Extracted from legacy admin/src/pages/TasksBoardPage.jsx (line 1862) for the
// Tasks v2 cutover. Reuses the new tasks/atoms + tasks/lib utilities.
//
// Public export: ListView. ListRow is private to this file.
//
// Props (mirrors legacy contract so the wiring step in TasksPage is mechanical):
//   tasks          : Task[]
//   team           : { id, email, name }[]
//   selectedIds    : string[]  (legacy uses Array.includes; not a Set)
//   onToggleSelect : (id) => void
//   onOpen         : (task) => void
//   onPatchTask    : (id, patch) => void
//   onDelete       : (id) => void  (accepted for API symmetry; not wired here,
//                                   matching legacy which routed delete via the
//                                   bulk toolbar / detail modal)

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';

import TagChip from './atoms/TagChip.jsx';
import { displayAssignee } from './lib/format.js';
import { COLUMNS, PRIORITY_RANK, DUE_PILL } from './lib/tokens.js';

// ---------------------------------------------------------------------------
// Inlined helpers — kept private to this file per cutover instructions
// ---------------------------------------------------------------------------

// Tailwind background+text classes for the priority <select>. The shared
// PRIORITY_STYLES token is an object ({ dot, text, label }) tailored for the
// kanban PriorityFlag atom; the list view needs a single bg+text className.
const LIST_PRIORITY_PILL = {
  low: 'bg-slate-200 text-slate-700',
  medium: 'bg-sky-100 text-sky-700',
  high: 'bg-red-100 text-red-700',
};

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

// yyyy-mm-dd string for <input type="date">. Returns '' for missing/invalid.
function toDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// Returns the DUE_PILL className string for an input, or '' if no dueAt.
// Mirrors legacy dueAtPill ageing buckets but reuses the shared DUE_PILL tones.
function dueInputCls(task) {
  if (!task?.dueAt) return '';
  const d = new Date(task.dueAt);
  if (isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d); dueDay.setHours(0, 0, 0, 0);
  const diff = Math.round((dueDay - today) / 86400000);
  const isDone = task.status === 'done';
  if (isDone) return DUE_PILL.neutral;
  if (diff < 0) return DUE_PILL.overdue;
  if (diff <= 1) return DUE_PILL.soon;
  if (diff <= 7) return DUE_PILL.week;
  return DUE_PILL.later;
}

const LIST_COLUMNS = [
  { key: 'title',    label: 'Title',    sortable: true,  align: 'left' },
  { key: 'assignee', label: 'Assignee', sortable: true,  align: 'left' },
  { key: 'priority', label: 'Priority', sortable: true,  align: 'left' },
  { key: 'dueAt',    label: 'Due',      sortable: true,  align: 'left' },
  { key: 'tags',     label: 'Tags',     sortable: false, align: 'left' },
  { key: 'status',   label: 'Status',   sortable: true,  align: 'left' },
];

// ---------------------------------------------------------------------------
// ListView — public export
// ---------------------------------------------------------------------------
export default function ListView({
  tasks, team, selectedIds, onToggleSelect, onOpen,
  onPatchTask, onDelete,
}) {
  const [sortKey, setSortKey] = useState('priority');
  const [sortDir, setSortDir] = useState('asc'); // asc | desc
  const [groupBy, setGroupBy] = useState('status'); // none | status | assignee | priority
  const [collapsed, setCollapsed] = useState({});

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    function compare(a, b) {
      if (sortKey === 'title') {
        return (a.title || '').localeCompare(b.title || '') * dir;
      }
      if (sortKey === 'priority') {
        const pa = PRIORITY_RANK[a.priority || 'medium'] ?? 1;
        const pb = PRIORITY_RANK[b.priority || 'medium'] ?? 1;
        return (pa - pb) * dir;
      }
      if (sortKey === 'dueAt') {
        const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return (da - db) * dir;
      }
      if (sortKey === 'assignee') {
        const na = displayAssignee(a.assignedTo, team) || '~';
        const nb = displayAssignee(b.assignedTo, team) || '~';
        return na.localeCompare(nb) * dir;
      }
      if (sortKey === 'status') {
        const sa = COLUMNS.findIndex((c) => c.key === a.status);
        const sb = COLUMNS.findIndex((c) => c.key === b.status);
        return (sa - sb) * dir;
      }
      return 0;
    }
    return [...tasks].sort(compare);
  }, [tasks, sortKey, sortDir, team]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '__all', label: null, items: sorted }];
    const map = new Map();
    function keyOf(t) {
      if (groupBy === 'status') return t.status || 'not_started';
      if (groupBy === 'priority') return t.priority || 'medium';
      if (groupBy === 'assignee') return t.assignedTo || '__unassigned';
      return '__all';
    }
    function labelOf(k) {
      if (groupBy === 'status') return COLUMNS.find((c) => c.key === k)?.label || k;
      if (groupBy === 'priority') return PRIORITY_LABEL[k] || k;
      if (groupBy === 'assignee') {
        if (k === '__unassigned') return 'Unassigned';
        return displayAssignee(k, team) || k;
      }
      return k;
    }
    for (const t of sorted) {
      const k = keyOf(t);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    return Array.from(map.entries()).map(([k, items]) => ({
      key: k,
      label: labelOf(k),
      items,
    }));
  }, [sorted, groupBy, team]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-500">Group by:</span>
        {[
          { k: 'none',     label: 'None' },
          { k: 'status',   label: 'Status' },
          { k: 'assignee', label: 'Assignee' },
          { k: 'priority', label: 'Priority' },
        ].map((g) => (
          <button
            key={g.k}
            onClick={() => setGroupBy(g.k)}
            className={`text-xs px-2 py-1 rounded font-medium ${
              groupBy === g.k
                ? 'bg-sky-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="w-8 px-3 py-2" aria-label="Select"></th>
              {LIST_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium text-${c.align} ${c.sortable ? 'cursor-pointer hover:text-slate-700' : ''}`}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key && (
                      sortDir === 'asc'
                        ? <ChevronUp className="w-3 h-3" />
                        : <ChevronDown className="w-3 h-3" />
                    )}
                  </span>
                </th>
              ))}
              <th className="w-8 px-2 py-2" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.key}>
                {g.label && (
                  <tr className="bg-slate-50/60 border-t border-slate-200">
                    <td colSpan={LIST_COLUMNS.length + 2} className="px-3 py-1.5">
                      <button
                        onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-sky-700"
                      >
                        {collapsed[g.key] ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {g.label}
                        <span className="text-slate-600 font-normal">({g.items.length})</span>
                      </button>
                    </td>
                  </tr>
                )}
                {!collapsed[g.key] && g.items.map((t) => (
                  <ListRow
                    key={t.id}
                    task={t}
                    team={team}
                    selected={selectedIds.includes(t.id)}
                    onToggleSelect={onToggleSelect}
                    onOpen={onOpen}
                    onPatchTask={onPatchTask}
                    onDelete={onDelete}
                  />
                ))}
              </React.Fragment>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={LIST_COLUMNS.length + 2} className="px-3 py-8 text-center text-xs text-slate-500">
                  No tasks match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ListRow — private to ListView. Renders a single <tr> with inline editors.
// ---------------------------------------------------------------------------
function ListRow({ task, team, selected, onToggleSelect, onOpen, onPatchTask, onDelete }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title || '');
  useEffect(() => setTitleDraft(task.title || ''), [task.title]);

  const assigneeName = displayAssignee(task.assignedTo, team);
  const statusMeta = COLUMNS.find((c) => c.key === task.status) || COLUMNS[0];
  const dueCls = dueInputCls(task);
  const priorityKey = task.priority || 'medium';

  function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === task.title) return;
    onPatchTask(task.id, { title: next });
  }

  return (
    <tr className="border-t border-slate-100 hover:bg-sky-50/30">
      <td className="px-3 py-2 align-middle">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(task.id)}
          className="cursor-pointer accent-sky-600"
          aria-label={`Select task ${task.title || 'untitled'}`}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
              if (e.key === 'Escape') { e.preventDefault(); setTitleDraft(task.title || ''); setEditingTitle(false); }
            }}
            className="w-full text-sm border-b border-sky-300 focus:outline-none bg-transparent"
            aria-label="Task title"
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            onDoubleClick={() => onOpen(task)}
            className="text-left text-sm text-slate-800 hover:text-sky-700"
            title="Click to rename · Double-click to open"
          >
            {task.title}
          </button>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        <select
          value={task.assignedTo || ''}
          onChange={(e) => onPatchTask(task.id, { assignedTo: e.target.value || null })}
          className="text-xs border border-transparent hover:border-slate-200 focus:border-slate-300 rounded px-1.5 py-0.5 bg-transparent focus:outline-none"
          aria-label={`Assignee for ${task.title || 'task'}`}
        >
          <option value="">Unassigned</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {assigneeName && !team.some((m) => m.id === task.assignedTo) && (
          <span className="text-xs text-slate-500 ml-1">{assigneeName}</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        <select
          value={priorityKey}
          onChange={(e) => onPatchTask(task.id, { priority: e.target.value })}
          className={`text-[11px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 border-0 focus:outline-none focus:ring-1 focus:ring-sky-300 ${LIST_PRIORITY_PILL[priorityKey] || LIST_PRIORITY_PILL.medium}`}
          aria-label={`Priority for ${task.title || 'task'}`}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </td>
      <td className="px-3 py-2 align-middle">
        <input
          type="date"
          value={toDateInput(task.dueAt)}
          onChange={(e) => onPatchTask(task.id, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className={`text-xs rounded px-1.5 py-0.5 border-0 focus:outline-none focus:ring-1 focus:ring-sky-300 ${dueCls || 'bg-transparent text-slate-600'}`}
          aria-label={`Due date for ${task.title || 'task'}`}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex flex-wrap gap-1">
          {(task.tags || []).slice(0, 3).map((t) => <TagChip key={t} tag={t} />)}
          {(task.tags || []).length > 3 && (
            <span className="text-[10px] text-slate-600">+{task.tags.length - 3}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <select
          value={task.status}
          onChange={(e) => onPatchTask(task.id, { status: e.target.value })}
          className="text-xs border-0 rounded px-1.5 py-0.5 font-medium focus:outline-none focus:ring-1 focus:ring-sky-300"
          style={{ background: `${statusMeta.dot}15`, color: statusMeta.dot }}
          aria-label={`Status for ${task.title || 'task'}`}
        >
          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-2 align-middle text-right">
        <button
          onClick={() => onOpen(task)}
          className="text-[11px] text-slate-600 hover:text-sky-700"
          title="Open"
        >
          Open
        </button>
      </td>
    </tr>
  );
}
