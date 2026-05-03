import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, X, Trash2, Calendar, User, ChevronDown } from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import TodoSidebar from '../components/TodoSidebar.jsx';
import { apiFetch } from '../lib/api.js';

const COLUMNS = [
  { key: 'not_started', label: 'Not Started', color: '#64748b', light: 'bg-slate-50 border-slate-200' },
  { key: 'in_progress', label: 'In Progress', color: '#0284c7', light: 'bg-sky-50 border-sky-200' },
  { key: 'review',      label: 'Review',      color: '#f59e0b', light: 'bg-amber-50 border-amber-200' },
  { key: 'done',        label: 'Done',        color: '#16a34a', light: 'bg-emerald-50 border-emerald-200' },
];

function fmtDueAt(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : '2-digit',
  });
}

function toDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

function isOverdue(t) {
  if (!t.dueAt || t.status === 'done') return false;
  return new Date(t.dueAt).getTime() < Date.now() - 24 * 3600 * 1000;
}

// Resolve the user-facing display for tasks.assignedTo. New rows store the
// teammate's UUID (looked up in `team`); legacy rows may store a free-text
// name like "Jatin" or an email — fall back to that string.
function displayAssignee(rawValue, team) {
  if (!rawValue) return null;
  const member = team.find((m) => m.id === rawValue || m.email === rawValue);
  return member?.name || rawValue;
}

// ---------------------------------------------------------------------------
// AssigneeMenu — small inline dropdown used on Kanban cards. Lets the user
// reassign a task to a teammate without opening the modal.
// ---------------------------------------------------------------------------
function AssigneeMenu({ task, team, onAssigned }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function pick(value) {
    setOpen(false);
    try {
      const { task: updated } = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedTo: value }),
      });
      onAssigned(updated);
    } catch (e) {
      alert(`Couldn't assign: ${e.message}`);
    }
  }

  const label = displayAssignee(task.assignedTo, team) || 'Unassigned';

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium ${
          task.assignedTo
            ? 'bg-sky-50 text-sky-700 hover:bg-sky-100'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`}
      >
        <User className="w-3 h-3" /> {label} <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto">
          <button
            onClick={() => pick(null)}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Unassigned
          </button>
          <div className="border-t border-slate-100 my-0.5" />
          {team.length === 0 ? (
            <p className="px-3 py-1.5 text-xs text-slate-400">No teammates found</p>
          ) : team.map((m) => (
            <button
              key={m.id}
              onClick={() => pick(m.id)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-sky-50 ${
                task.assignedTo === m.id ? 'bg-sky-50 text-sky-800 font-medium' : 'text-slate-700'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card (used in both Kanban and the right-side checklist)
// ---------------------------------------------------------------------------
function TaskCard({ task, index, team, onOpen, onAssigned }) {
  const overdue = isOverdue(task);
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onOpen}
          className={`bg-white border rounded-lg p-2.5 cursor-pointer transition-all select-none ${
            snapshot.isDragging ? 'shadow-lg ring-2 ring-sky-200 border-sky-300' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <p className="text-sm font-medium text-slate-800 leading-tight mb-1">{task.title}</p>
          {task.description && (
            <p className="text-[11px] text-slate-500 line-clamp-2 mb-1.5">{task.description}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            {task.dueAt && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium ${
                overdue ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'
              }`}>
                <Calendar className="w-3 h-3" /> {fmtDueAt(task.dueAt)}
              </span>
            )}
            <AssigneeMenu task={task} team={team} onAssigned={onAssigned} />
            {task.contactName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-medium">
                {task.contactName}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------------
function TaskModal({ task, team, onClose, onSaved, onDeleted }) {
  const isEdit = !!task?.id;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? '');
  const [dueAt, setDueAt] = useState(toDateInput(task?.dueAt));
  const [status, setStatus] = useState(task?.status ?? 'not_started');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e?.preventDefault?.();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        assignedTo: assignedTo || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        status,
      };
      const resp = isEdit
        ? await apiFetch(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
      onSaved(resp.task);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!isEdit) { onClose(); return; }
    if (!confirm('Delete this task?')) return;
    setSaving(true);
    try {
      await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      onDeleted(task.id);
    } catch (err) {
      setError(err.message || 'Delete failed');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{isEdit ? 'Edit Task' : 'New Task'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Notes, context, links…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Due date</label>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Assigned to</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
              {/* If the existing value isn't a known teammate (legacy free-text), keep it visible */}
              {assignedTo && !team.some((m) => m.id === assignedTo) && (
                <option value={assignedTo}>{assignedTo}</option>
              )}
            </select>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-slate-600 hover:text-slate-800 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function TasksBoardPage() {
  const [tasks, setTasks] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalTask, setModalTask] = useState(null); // null=closed, {} = new, {id...} = edit

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksResp, teamResp] = await Promise.all([
        apiFetch('/api/tasks'),
        apiFetch('/api/team').catch(() => ({ team: [] })),
      ]);
      setTasks(tasksResp.tasks ?? []);
      setTeam(teamResp.team ?? []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Optimistic update helpers
  function upsertTask(updated) {
    setTasks((ts) => {
      const idx = ts.findIndex((x) => x.id === updated.id);
      if (idx === -1) return [updated, ...ts];
      const next = ts.slice();
      next[idx] = { ...next[idx], ...updated };
      return next;
    });
  }

  function removeTask(id) {
    setTasks((ts) => ts.filter((t) => t.id !== id));
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const newStatus = destination.droppableId;
    // Optimistic
    setTasks((ts) => ts.map((t) => t.id === draggableId ? { ...t, status: newStatus } : t));
    try {
      await apiFetch(`/api/tasks/${draggableId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      // revert on failure
      setTasks((ts) => ts.map((t) => t.id === draggableId ? { ...t, status: source.droppableId } : t));
      alert(`Couldn't move task: ${e.message}`);
    }
  }

  const tasksByColumn = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
    for (const t of tasks) {
      const col = COLUMNS.find((c) => c.key === t.status) ? t.status : 'not_started';
      map[col].push(t);
    }
    return map;
  }, [tasks]);

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const totalCount = tasks.length;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Tasks Board</h1>
            <p className="text-xs text-slate-500">
              {loading ? 'Loading…' : `${totalCount} task${totalCount === 1 ? '' : 's'} · ${doneCount} done`}
            </p>
          </div>
          <button
            onClick={() => setModalTask({})}
            className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-4 h-4" /> New Task
          </button>
        </header>

        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-6 py-2">
            {error}
          </div>
        )}

        {/* Body: Kanban | Checklist */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Kanban */}
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex gap-3 px-4 py-4 overflow-x-auto flex-1">
                {COLUMNS.map((col) => {
                  const list = tasksByColumn[col.key] ?? [];
                  return (
                    <div
                      key={col.key}
                      className={`flex flex-col rounded-xl border ${col.light} w-[260px] shrink-0`}
                    >
                      <div
                        className="rounded-t-xl px-3 py-2.5 flex items-center justify-between"
                        style={{ background: col.color }}
                      >
                        <h2 className="text-white font-semibold text-xs uppercase tracking-wide">
                          {col.label}
                        </h2>
                        <span className="bg-white/25 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                          {list.length}
                        </span>
                      </div>
                      <Droppable droppableId={col.key}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`flex-1 p-2 space-y-2 min-h-[120px] rounded-b-xl transition-colors ${
                              snapshot.isDraggingOver ? 'bg-white/70' : ''
                            }`}
                          >
                            {list.map((t, i) => (
                              <TaskCard
                                key={t.id}
                                task={t}
                                index={i}
                                team={team}
                                onOpen={() => setModalTask(t)}
                                onAssigned={(updated) => upsertTask(updated)}
                              />
                            ))}
                            {provided.placeholder}
                            {list.length === 0 && !snapshot.isDraggingOver && (
                              <p className="text-center text-xs text-slate-400 py-3">Drop tasks here</p>
                            )}
                          </div>
                        )}
                      </Droppable>
                      <div className="px-2 pb-2 shrink-0">
                        <button
                          onClick={() => setModalTask({ status: col.key })}
                          className="w-full text-xs text-slate-400 hover:text-slate-600 hover:bg-white border border-dashed border-slate-200 hover:border-slate-300 rounded-lg py-1.5 transition-colors"
                        >
                          + Add task
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          </div>

          {/* Right: To-Do workspace (lists + checklist subitems) */}
          <TodoSidebar
            tasks={tasks}
            onTaskCreated={(t) => upsertTask(t)}
            onTaskUpdated={(t) => upsertTask(t)}
            onTaskDeleted={(id) => removeTask(id)}
          />
        </div>
      </div>

      {modalTask !== null && (
        <TaskModal
          task={modalTask}
          team={team}
          onClose={() => setModalTask(null)}
          onSaved={(t) => { upsertTask(t); setModalTask(null); }}
          onDeleted={(id) => { removeTask(id); setModalTask(null); }}
        />
      )}
    </div>
  );
}
