// CalendarView — month grid view for tasks, drag a card to a different day to
// reschedule. Click a day cell number to create a new task on that day. When a
// day has more tasks than fit, "+N more" opens a DayModal listing every task
// for that date; clicking one bubbles up via onOpen so the parent can render
// the new DetailPanel.
//
// Extracted self-contained from legacy admin/src/pages/TasksBoardPage.jsx
// (CalendarView at line 2160, DayModal at line 2333, date helpers at 2152-2159).

import React, { useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import Avatar from './atoms/Avatar.jsx';
import PriorityFlag from './atoms/PriorityFlag.jsx';
import { displayAssignee, initials } from './lib/format.js';
import { PRIORITY_RANK } from './lib/tokens.js';

// ---------------------------------------------------------------------------
// Tiny date helpers — private to this file; not worth promoting to lib/format.
// ---------------------------------------------------------------------------
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// CalendarView
// Props:
//   tasks          — Task[]; tasks without dueAt are silently skipped
//   team           — Teammate[]; used for assignee display resolution
//   onOpen(task)   — open the task in the parent's DetailPanel
//   onCreateOnDay(date)        — user clicked a day number to create
//   onPatchTask(id, patch)     — drop on a different day → { dueAt: iso }
// ---------------------------------------------------------------------------
export default function CalendarView({ tasks, team, onOpen, onCreateOnDay, onPatchTask }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [dayModalDate, setDayModalDate] = useState(null);

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Build a 6-row × 7-col grid starting from the Monday on/before the 1st.
  const grid = useMemo(() => {
    const first = startOfMonth(cursor);
    const jsDay = first.getDay(); // 0=Sun
    const mondayOffset = (jsDay + 6) % 7;
    const start = new Date(first);
    start.setDate(start.getDate() - mondayOffset);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  // Bucket tasks by their due day, sorted high-priority first within each day.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const d = new Date(t.dueAt);
      if (isNaN(d.getTime())) continue;
      const k = dayKey(d);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority || 'medium'] ?? 1;
        const pb = PRIORITY_RANK[b.priority || 'medium'] ?? 1;
        return pa - pb;
      });
    }
    return map;
  }, [tasks]);

  function onDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    const targetDate = destination.droppableId; // YYYY-MM-DD
    const iso = new Date(`${targetDate}T12:00:00`).toISOString();
    onPatchTask(draggableId, { dueAt: iso });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const n = new Date(cursor);
              n.setMonth(n.getMonth() - 1);
              setCursor(n);
            }}
            className="p-1.5 rounded hover:bg-slate-100"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="text-sm font-semibold text-slate-800 min-w-[160px] text-center">
            {monthLabel}
          </h3>
          <button
            onClick={() => {
              const n = new Date(cursor);
              n.setMonth(n.getMonth() + 1);
              setCursor(n);
            }}
            className="p-1.5 rounded hover:bg-slate-100"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="ml-2 text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Today
          </button>
        </div>
        <p className="text-xs text-slate-500">Drag a task to a new day to reschedule</p>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden text-xs">
          {DAY_NAMES.map((n) => (
            <div
              key={n}
              className="bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-500 uppercase tracking-wide"
            >
              {n}
            </div>
          ))}
          {grid.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = isSameDay(d, today);
            const k = dayKey(d);
            const items = byDay.get(k) || [];
            const visible = items.slice(0, 4);
            const overflow = items.length - visible.length;
            return (
              <Droppable droppableId={k} key={i}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`bg-white min-h-[110px] p-1.5 flex flex-col gap-1 ${snapshot.isDraggingOver ? 'bg-sky-50' : ''} ${!inMonth ? 'opacity-50' : ''}`}
                  >
                    <button
                      onClick={() => onCreateOnDay(d)}
                      className={`text-[11px] font-medium text-left w-fit px-1 rounded hover:bg-sky-50 ${isToday ? 'bg-sky-600 text-white hover:bg-sky-700' : 'text-slate-600'}`}
                      title="Click to create a task on this day"
                    >
                      {d.getDate()}
                    </button>
                    {visible.map((t, idx) => (
                      <Draggable draggableId={t.id} index={idx} key={t.id}>
                        {(prov) => (
                          <button
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            onClick={() => onOpen(t)}
                            className="text-left text-[11px] px-1.5 py-0.5 rounded bg-slate-50 hover:bg-sky-50 border border-slate-100 truncate flex items-center gap-1"
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{
                                background:
                                  t.priority === 'high'
                                    ? '#dc2626'
                                    : t.priority === 'low'
                                      ? '#94a3b8'
                                      : '#0284c7',
                              }}
                            />
                            <span className="truncate flex-1">{t.title}</span>
                            {t.assignedTo && (
                              <span className="shrink-0 text-[9px] text-slate-500">
                                {initials(displayAssignee(t.assignedTo, team))}
                              </span>
                            )}
                          </button>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {overflow > 0 && (
                      <button
                        onClick={() => setDayModalDate(d)}
                        className="text-[10px] text-sky-600 hover:underline self-start"
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {dayModalDate && (
        <DayModal
          date={dayModalDate}
          tasks={byDay.get(dayKey(dayModalDate)) || []}
          team={team}
          onClose={() => setDayModalDate(null)}
          onOpen={(t) => {
            setDayModalDate(null);
            onOpen(t);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayModal — private overflow viewer when a day has more tasks than fit in the
// cell. Clicking a task bubbles to the parent's DetailPanel via onOpen.
// ---------------------------------------------------------------------------
function DayModal({ date, tasks, team, onClose, onOpen }) {
  const label = date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="overflow-y-auto divide-y divide-slate-100">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onOpen(t)}
                className="w-full text-left px-5 py-2.5 hover:bg-sky-50 flex items-center gap-2"
              >
                <PriorityFlag priority={t.priority} />
                <span className="text-sm text-slate-800 flex-1 truncate">{t.title}</span>
                <Avatar name={displayAssignee(t.assignedTo, team)} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
