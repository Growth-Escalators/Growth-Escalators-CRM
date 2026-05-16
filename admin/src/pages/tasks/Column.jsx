// Column — kanban column shell + droppable + inline quick-add.
// Wraps Droppable from @hello-pangea/dnd; collapsed state shown as a thin
// rail (40px wide) with rotated label.

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Droppable } from '@hello-pangea/dnd';
import TaskCard from './TaskCard.jsx';

export default function Column({
  col, tasks, onOpenTask, onQuickAdd,
  density, smartSort, onToggleDone, team,
  collapsed, onToggleCollapse,
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  function submit(e) {
    e?.preventDefault();
    const title = text.trim();
    if (!title) { setAdding(false); return; }
    onQuickAdd(col.key, title);
    setText('');
    inputRef.current?.focus();
  }

  // Collapsed rail
  if (collapsed) {
    return (
      <div className="w-10 shrink-0 bg-white border border-slate-200 rounded-xl flex flex-col items-center py-2 gap-2">
        <button
          type="button"
          onClick={() => onToggleCollapse(col.key)}
          aria-label={`Expand ${col.label} column`}
          className="text-slate-400 hover:text-slate-600"
        >
          <ChevronRight className="w-4 h-4" aria-hidden />
        </button>
        <div className="rotate-180 [writing-mode:vertical-rl] text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
          {col.label}
        </div>
        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5 mt-auto">
          {tasks.length}
        </span>
      </div>
    );
  }

  return (
    <Droppable droppableId={col.key}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`flex flex-col w-[300px] shrink-0 rounded-xl border transition-all ${
            snapshot.isDraggingOver
              ? 'border-sky-300 bg-sky-50/40 ring-2 ring-sky-100'
              : 'border-slate-200 bg-slate-50/60'
          }`}
        >
          {/* Header */}
          <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: col.dot }}
              aria-hidden
            />
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              {col.label}
            </h2>
            <span className="text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 rounded-full px-1.5 py-0.5">
              {tasks.length}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setAdding(true)}
                aria-label={`Add task to ${col.label}`}
                title="Add task"
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-white"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onToggleCollapse(col.key)}
                aria-label={`Collapse ${col.label} column`}
                title="Collapse column"
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded hover:bg-white"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Cards */}
          <div className="flex-1 px-2 pb-2 space-y-1.5 overflow-y-auto min-h-[120px]">
            {tasks.map((t, i) => (
              <TaskCard
                key={t.id}
                task={t}
                index={i}
                onOpen={() => onOpenTask(t)}
                density={density}
                smartSort={smartSort}
                onToggleDone={onToggleDone}
                team={team}
              />
            ))}
            {provided.placeholder}

            {adding && (
              <form
                onSubmit={submit}
                className="bg-white border border-sky-300 ring-2 ring-sky-100 rounded-lg p-1.5"
              >
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => { if (!text.trim()) setAdding(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); setAdding(false); } }}
                  placeholder="Task title…"
                  aria-label={`New task title for ${col.label}`}
                  className="w-full text-sm outline-none placeholder:text-slate-400"
                />
                <div className="flex items-center gap-1.5 mt-1.5">
                  <button
                    type="submit"
                    disabled={!text.trim()}
                    className="text-xs bg-sky-600 hover:bg-sky-700 text-white font-medium px-2 py-0.5 rounded disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setText(''); setAdding(false); }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-1"
                  >
                    Cancel
                  </button>
                  <span className="text-[10px] text-slate-400 ml-auto">↵ to add</span>
                </div>
              </form>
            )}

            {!adding && tasks.length === 0 && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 hover:bg-white border border-dashed border-slate-200 hover:border-slate-300 rounded-lg py-3 italic"
              >
                Drop a task or + add
              </button>
            )}

            {!adding && tasks.length > 0 && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 hover:bg-white border border-dashed border-transparent hover:border-slate-200 rounded-lg py-1.5"
              >
                + Add task
              </button>
            )}
          </div>
        </div>
      )}
    </Droppable>
  );
}
