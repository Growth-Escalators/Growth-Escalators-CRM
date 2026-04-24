import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, X, Trash2, CheckCircle2, Circle, Calendar, User, Edit3 } from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch, getUser } from '../lib/api.js';

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

function isDueToday(t) {
  if (!t.dueAt) return false;
  const d = new Date(t.dueAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// ---------------------------------------------------------------------------
// Card (used in both Kanban and the right-side checklist)
// ---------------------------------------------------------------------------
function TaskCard({ task, index, onOpen }) {
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
            {task.assignedTo && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">
                <User className="w-3 h-3" /> {task.assignedTo}
              </span>
            )}
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
function TaskModal({ task, onClose, onSaved, onDeleted }) {
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
        assignedTo: assignedTo.trim() || null,
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
          <div className="grid grid-cols-2 gap-3">
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
            <input
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Name or email"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
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
  const user = getUser();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalTask, setModalTask] = useState(null); // null=closed, {} = new, {id...} = edit
  const [checklistFilter, setChecklistFilter] = useState('mine'); // mine | all | today

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/tasks');
      setTasks(data.tasks ?? []);
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

  async function toggleChecklist(task) {
    const newStatus = task.status === 'done' ? 'not_started' : 'done';
    setTasks((ts) => ts.map((t) => t.id === task.id ? { ...t, status: newStatus } : t));
    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      setTasks((ts) => ts.map((t) => t.id === task.id ? { ...t, status: task.status } : t));
      alert(`Update failed: ${e.message}`);
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

  const checklistTasks = useMemo(() => {
    const base = tasks.filter((t) => t.status !== 'done');
    const matchesMine = (t) => {
      if (!user) return true;
      const val = (t.assignedTo || '').toLowerCase();
      return val === (user.email || '').toLowerCase() || val === (user.name || '').toLowerCase() || !t.assignedTo;
    };
    const filtered = checklistFilter === 'mine' ? base.filter(matchesMine)
      : checklistFilter === 'today' ? base.filter(isDueToday)
      : base;
    return filtered.sort((a, b) => {
      if (isOverdue(a) && !isOverdue(b)) return -1;
      if (!isOverdue(a) && isOverdue(b)) return 1;
      if (a.dueAt && !b.dueAt) return -1;
      if (!a.dueAt && b.dueAt) return 1;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt) - new Date(b.dueAt);
      return 0;
    });
  }, [tasks, checklistFilter, user]);

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
                                onOpen={() => setModalTask(t)}
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

          {/* Right: Checklist */}
          <aside className="w-[340px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-800">Checklist</h2>
                <span className="text-[11px] text-slate-500">
                  {checklistTasks.length} open
                </span>
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                {[
                  { key: 'mine', label: 'Mine' },
                  { key: 'today', label: 'Today' },
                  { key: 'all', label: 'All' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setChecklistFilter(opt.key)}
                    className={`flex-1 text-xs font-medium py-1 rounded-md transition-colors ${
                      checklistFilter === opt.key
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {loading ? (
                <p className="text-center text-xs text-slate-400 py-8">Loading…</p>
              ) : checklistTasks.length === 0 ? (
                <div className="text-center py-10 px-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">
                    {checklistFilter === 'mine' ? 'Nothing on your plate.' : checklistFilter === 'today' ? 'Nothing due today.' : 'All clear.'}
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {checklistTasks.map((t) => {
                    const overdue = isOverdue(t);
                    return (
                      <li
                        key={t.id}
                        className="group flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-slate-50"
                      >
                        <button
                          onClick={() => toggleChecklist(t)}
                          aria-label={t.status === 'done' ? 'Mark as not done' : 'Mark as done'}
                          className="shrink-0 mt-0.5"
                        >
                          {t.status === 'done' ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-300 hover:text-sky-500 transition-colors" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1" onClick={() => setModalTask(t)} role="button">
                          <p className={`text-sm leading-tight ${t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                            {t.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                            {t.dueAt && (
                              <span className={overdue ? 'text-red-600 font-medium' : ''}>
                                <Calendar className="w-3 h-3 inline -mt-0.5" /> {fmtDueAt(t.dueAt)}
                              </span>
                            )}
                            {t.assignedTo && (
                              <span><User className="w-3 h-3 inline -mt-0.5" /> {t.assignedTo}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setModalTask(t)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition-opacity"
                          aria-label="Edit task"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>

      {modalTask !== null && (
        <TaskModal
          task={modalTask}
          onClose={() => setModalTask(null)}
          onSaved={(t) => { upsertTask(t); setModalTask(null); }}
          onDeleted={(id) => { removeTask(id); setModalTask(null); }}
        />
      )}
    </div>
  );
}
