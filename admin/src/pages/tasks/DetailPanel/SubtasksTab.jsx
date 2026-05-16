// SubtasksTab — checklist items for a task.
// GET    /api/tasks/:id/checklist-items
// POST   /api/tasks/:id/checklist-items   { label }
// PATCH  /api/tasks/:id/checklist-items/:itemId  { isDone | label | position }
// DELETE /api/tasks/:id/checklist-items/:itemId
// Optimistic mutations everywhere; rollback on error.

import React, { useEffect, useState } from 'react';
import { CheckSquare, Square, X } from 'lucide-react';
import { apiFetch } from '../../../lib/api.js';

export default function SubtasksTab({ task }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [label, setLabel] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/api/tasks/${task.id}/checklist-items`)
      .then((d) => { if (alive) setItems(Array.isArray(d?.items) ? d.items : []); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [task.id]);

  const addItem = async () => {
    const v = label.trim();
    if (!v) return;
    const tempId = `temp-${Date.now()}`;
    const optimistic = { id: tempId, label: v, isDone: false, position: items.length + 1 };
    setItems((it) => [...it, optimistic]);
    setLabel('');
    try {
      const d = await apiFetch(`/api/tasks/${task.id}/checklist-items`, {
        method: 'POST',
        body: JSON.stringify({ label: v }),
      });
      if (d?.item) setItems((it) => it.map((x) => (x.id === tempId ? d.item : x)));
    } catch (e) {
      setItems((it) => it.filter((x) => x.id !== tempId));
      setError(e.message || 'Add failed');
    }
  };

  const toggle = async (item) => {
    const next = !item.isDone;
    setItems((it) => it.map((x) => (x.id === item.id ? { ...x, isDone: next } : x)));
    try {
      await apiFetch(`/api/tasks/${task.id}/checklist-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDone: next }),
      });
    } catch (e) {
      setItems((it) => it.map((x) => (x.id === item.id ? { ...x, isDone: !next } : x)));
      setError(e.message || 'Update failed');
    }
  };

  const remove = async (item) => {
    const snapshot = items;
    setItems((it) => it.filter((x) => x.id !== item.id));
    try {
      await apiFetch(`/api/tasks/${task.id}/checklist-items/${item.id}`, { method: 'DELETE' });
    } catch (e) {
      setItems(snapshot);
      setError(e.message || 'Delete failed');
    }
  };

  const total = items.length;
  const done = items.filter((i) => i.isDone).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (loading) {
    return <p className="text-xs text-slate-400">Loading subtasks…</p>;
  }

  return (
    <div>
      {error && (
        <p className="text-xs text-rose-600 mb-2">{error}</p>
      )}
      {total > 0 && (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-slate-500 font-medium">{done}/{total} complete</span>
            <span className="text-[11px] text-slate-400">{pct}%</span>
          </div>
          <div className="h-1 bg-slate-100 rounded overflow-hidden mb-2">
            <div className="h-full bg-emerald-500 rounded transition-all" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 group">
            <button
              type="button"
              onClick={() => toggle(it)}
              className={`shrink-0 ${it.isDone ? 'text-emerald-500' : 'text-slate-300 hover:text-sky-500'}`}
            >
              {it.isDone ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
            <span className={`flex-1 text-sm ${it.isDone ? 'line-through text-slate-400' : 'text-slate-700'}`}>
              {it.label}
            </span>
            <button
              type="button"
              onClick={() => remove(it)}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500"
              aria-label="Remove subtask"
              title="Remove subtask"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addItem(); }
          }}
          placeholder="Add subtask…"
          className="flex-1 text-sm bg-transparent border-b border-slate-200 focus:border-sky-300 outline-none py-1 placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!label.trim()}
          className="text-xs font-medium text-sky-600 hover:text-sky-700 disabled:text-slate-300"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
