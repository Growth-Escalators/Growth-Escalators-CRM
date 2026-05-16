// Single row inside a FocusView bucket. Slimmer than TaskCard — designed
// for the "what should I do right now" list, not a kanban card.
//
// Layout (left → right):
//   priority bar · checkbox · title (+ smart badge) · due chip · avatar · Defer link (hover)
//
// Click row body → onOpenTask(task). Click checkbox → onToggleDone(task).
// Click "Defer →" → pushes dueAt by +1 day via onPatchTask.

import React from 'react';
import { CheckSquare, Square } from 'lucide-react';
import Avatar from './atoms/Avatar.jsx';
import DueChip from './atoms/DueChip.jsx';
import TagChip from './atoms/TagChip.jsx';
import SmartBadge from './atoms/SmartBadge.jsx';
import { PRIORITY_STYLES } from './lib/tokens.js';
import { displayAssignee } from './lib/format.js';

export default function FocusRow({ task, team = [], smartSort, onOpen, onToggleDone, onDefer }) {
  const isDone = task.status === 'done';
  const pStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
  const name = task.assignedTo ? displayAssignee(task.assignedTo, team) : null;

  return (
    <div
      onClick={() => onOpen?.(task)}
      className="group relative bg-white border border-slate-200 hover:border-sky-300 hover:shadow-sm rounded-lg flex items-center gap-3 pl-3 pr-2 py-2 cursor-pointer transition-all"
    >
      <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded ${pStyle.dot}`} aria-hidden />

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleDone?.(task); }}
        aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
        className={`shrink-0 ${isDone ? 'text-emerald-500' : 'text-slate-300 hover:text-sky-500'}`}
      >
        {isDone
          ? <CheckSquare className="w-4 h-4" aria-hidden />
          : <Square className="w-4 h-4" aria-hidden />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium text-slate-800 truncate ${isDone ? 'line-through text-slate-500' : ''}`}>
            {task.title}
          </p>
          {smartSort && task.smartRank && <SmartBadge rank={task.smartRank} />}
        </div>
        {(task.tags?.length > 0 || task.subtasksTotal > 0 || task.commentCount > 0) && (
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 flex-wrap">
            {task.subtasksTotal > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <CheckSquare className="w-2.5 h-2.5" aria-hidden /> {task.subtasksDone || 0}/{task.subtasksTotal}
              </span>
            )}
            {(task.tags || []).slice(0, 2).map((t) => <TagChip key={t} tag={t} />)}
          </div>
        )}
      </div>

      <DueChip task={task} big />

      {name
        ? <Avatar name={name} size="md" title={name} />
        : <span
            className="w-6 h-6 rounded-full border border-dashed border-slate-300 flex items-center justify-center text-slate-400"
            title="Unassigned"
            aria-hidden
          >
            <span className="text-[9px] font-medium">?</span>
          </span>}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDefer?.(task); }}
        className="text-[10px] text-slate-400 hover:text-sky-700 hover:bg-sky-50 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        title="Push to tomorrow"
      >
        Defer →
      </button>
    </div>
  );
}
