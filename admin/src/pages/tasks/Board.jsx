// Board — kanban container. Wraps every column in a single DragDropContext
// so cards can be moved across columns via @hello-pangea/dnd.
//
// Sort within a column: smart-rank (when smart-sort is on) → priority →
// dueAt → createdAt. Matches prototype board.jsx grouped sort.

import React, { useMemo } from 'react';
import { DragDropContext } from '@hello-pangea/dnd';
import Column from './Column.jsx';
import { COLUMNS, PRIORITY_RANK } from './lib/tokens.js';

function sortTasks(tasks, smartSort) {
  return [...tasks].sort((a, b) => {
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
    if (ad !== bd) return ad - bd;
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return cb - ca;
  });
}

export default function Board({
  tasks,
  onOpenTask,
  onQuickAdd,
  density,
  smartSort,
  onMoveTask,
  onToggleDone,
  team,
  collapsedColumns = [],
  onToggleCollapse,
}) {
  const grouped = useMemo(() => {
    const out = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
    for (const t of tasks) {
      const k = out[t.status] ? t.status : 'not_started';
      out[k].push(t);
    }
    for (const k of Object.keys(out)) out[k] = sortTasks(out[k], smartSort);
    return out;
  }, [tasks, smartSort]);

  function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    onMoveTask(draggableId, destination.droppableId);
  }

  return (
    <div className="flex-1 min-w-0 overflow-x-auto bg-slate-100/60">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 px-5 py-4 h-full">
          {COLUMNS.map((c) => (
            <Column
              key={c.key}
              col={c}
              tasks={grouped[c.key] || []}
              onOpenTask={onOpenTask}
              onQuickAdd={onQuickAdd}
              density={density}
              smartSort={smartSort}
              onToggleDone={onToggleDone}
              team={team}
              collapsed={collapsedColumns.includes(c.key)}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}
