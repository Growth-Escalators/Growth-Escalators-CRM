// TaskCard — kanban card. Adapted from prototype tasks/board.jsx TaskCard.
//
// Differences from prototype:
//   • API uses task.assignedTo (uuid) + task.commentCount/attachmentCount;
//     prototype used task.assignee + task.comments/attachments. Map at the
//     consumption boundary, not via a normalisation pass.
//   • Drag-and-drop is supplied by the parent Column via @hello-pangea/dnd
//     Draggable; this file just renders the inner div + drag handle hint.
//   • task.deal is rendered only when present (it isn't on every task).

import React from 'react';
import { CheckSquare, Square, MessageSquare, Paperclip, User as UserIcon, Building2, GripVertical } from 'lucide-react';
import { Draggable } from '@hello-pangea/dnd';
import Avatar from './atoms/Avatar.jsx';
import DueChip from './atoms/DueChip.jsx';
import PriorityFlag from './atoms/PriorityFlag.jsx';
import SmartBadge from './atoms/SmartBadge.jsx';
import TagChip from './atoms/TagChip.jsx';
import { PRIORITY_STYLES } from './lib/tokens.js';
import { displayAssignee } from './lib/format.js';

export default function TaskCard({
  task, index, onOpen, density = 'default',
  smartSort = false, onToggleDone, team = [],
}) {
  const dense = density === 'compact';
  const cozy  = density === 'cozy';
  const pStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const visibleTags = tags.slice(0, dense ? 1 : 2);
  const extraTags = tags.length - visibleTags.length;
  const checklistDone = task.subtasksTotal > 0 && task.subtasksDone === task.subtasksTotal;
  const isDone = task.status === 'done';
  const assigneeName = displayAssignee(task.assignedTo, team);
  const commentCount = task.commentCount ?? task.comments ?? 0;
  const attachmentCount = task.attachmentCount ?? task.attachments ?? 0;

  return (
    <Draggable draggableId={String(task.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onOpen}
          aria-label={`Open task: ${task.title}`}
          className={`group relative bg-white border rounded-lg cursor-pointer transition-all ${
            snapshot.isDragging
              ? 'shadow-lg border-sky-300 ring-2 ring-sky-100'
              : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
          } ${isDone ? 'opacity-70' : ''}`}
          style={provided.draggableProps.style}
        >
          {/* Left priority bar */}
          <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded ${pStyle.dot}`} aria-hidden />

          <div className={`pl-2.5 pr-2 ${dense ? 'py-1.5' : cozy ? 'py-2' : 'py-2.5'}`}>
            {/* Top row */}
            <div className="flex items-start gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleDone?.(task); }}
                aria-label={isDone ? 'Mark as not done' : 'Mark done'}
                title={isDone ? 'Mark as not done' : 'Mark done'}
                className={`mt-0.5 shrink-0 transition-colors ${
                  isDone ? 'text-emerald-500' : 'text-slate-300 hover:text-sky-500'
                }`}
              >
                {isDone
                  ? <CheckSquare className="w-3.5 h-3.5" aria-hidden />
                  : <Square className="w-3.5 h-3.5" aria-hidden />}
              </button>

              <p
                className={`flex-1 text-slate-800 leading-snug font-medium ${
                  dense ? 'text-[12.5px]' : 'text-sm'
                } ${isDone ? 'line-through text-slate-500' : ''}`}
              >
                {task.title}
              </p>

              <GripVertical
                className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                aria-hidden
              />
            </div>

            {/* Smart-sort + deal context (hidden in compact) */}
            {(smartSort && task.smartRank) || task.deal ? (
              <div className={`mt-1.5 flex items-center gap-1.5 flex-wrap ${dense ? 'hidden' : ''}`}>
                {smartSort && task.smartRank && <SmartBadge rank={task.smartRank} />}
                {task.deal && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-px text-[10px] font-medium rounded bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-100">
                    <Building2 className="w-2.5 h-2.5" aria-hidden />
                    {task.deal}
                  </span>
                )}
              </div>
            ) : null}

            {/* Meta row — due chip + high-priority flag + tags */}
            <div className={`flex items-center gap-1.5 flex-wrap ${dense ? 'mt-1' : 'mt-2'}`}>
              {task.dueAt && <DueChip task={task} />}
              {!dense && task.priority === 'high' && <PriorityFlag priority="high" />}
              {visibleTags.map((t) => <TagChip key={t} tag={t} />)}
              {extraTags > 0 && (
                <span className="text-[10px] text-slate-400 font-medium">+{extraTags}</span>
              )}
            </div>

            {/* Bottom row — counts + assignee */}
            <div className={`flex items-center gap-2 ${dense ? 'mt-1' : 'mt-2'}`}>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                {task.subtasksTotal > 0 && (
                  <span
                    className={`inline-flex items-center gap-0.5 font-medium ${
                      checklistDone ? 'text-emerald-600' : 'text-slate-500'
                    }`}
                    title={`${task.subtasksDone}/${task.subtasksTotal} subtasks`}
                  >
                    <CheckSquare className="w-3 h-3" aria-hidden /> {task.subtasksDone}/{task.subtasksTotal}
                  </span>
                )}
                {commentCount > 0 && (
                  <span className="inline-flex items-center gap-0.5" title={`${commentCount} comments`}>
                    <MessageSquare className="w-3 h-3" aria-hidden /> {commentCount}
                  </span>
                )}
                {attachmentCount > 0 && (
                  <span className="inline-flex items-center gap-0.5" title={`${attachmentCount} attachments`}>
                    <Paperclip className="w-3 h-3" aria-hidden /> {attachmentCount}
                  </span>
                )}
              </div>

              <div className="ml-auto">
                {assigneeName ? (
                  <Avatar name={assigneeName} size={dense ? 'sm' : 'md'} />
                ) : (
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-slate-300 text-slate-400"
                    title="Unassigned"
                  >
                    <UserIcon className="w-2.5 h-2.5" aria-hidden />
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}
