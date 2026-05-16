// FieldStrip — inline-editable property rows shown directly under the task
// title. Slate-50/40 background per prototype. Each row commits via the
// passed-in onPatch callback (parent owns optimistic update + rollback).
//
// Rendered rows: Assignee, Due date, Priority, List, Tags, Linked deal (RO).

import React, { useEffect, useRef, useState } from 'react';
import { User, Calendar, Flag, Tag, Building2, ArrowRight, X } from 'lucide-react';
import { apiFetch } from '../../../lib/api.js';
import Avatar from '../atoms/Avatar.jsx';
import DueChip from '../atoms/DueChip.jsx';
import TagChip from '../atoms/TagChip.jsx';
import { PRIORITY_STYLES } from '../lib/tokens.js';
import { displayAssignee } from '../lib/format.js';

function FieldRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-b-0">
      <div className="w-32 shrink-0 flex items-center gap-2 text-xs font-medium text-slate-500 pt-1">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 text-sm">{children}</div>
    </div>
  );
}

function inlineBtnCls() {
  return 'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-slate-100 text-left -mx-1.5';
}

export default function FieldStrip({ task, team = [], onPatch }) {
  const pStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
  const assigneeName = displayAssignee(task.assignedTo, team);

  // ─── inline editors (one open at a time) ────────────────────────────────
  const [editing, setEditing] = useState(null); // 'assignee' | 'due' | 'priority' | 'list' | 'tags' | null
  useEffect(() => { setEditing(null); }, [task.id]);

  // ─── lists (lazy fetch on first open) ───────────────────────────────────
  const [lists, setLists] = useState(null);
  const [listsLoading, setListsLoading] = useState(false);
  const fetchLists = async () => {
    if (lists || listsLoading) return;
    setListsLoading(true);
    try {
      const data = await apiFetch('/api/task-lists');
      setLists(Array.isArray(data?.lists) ? data.lists : []);
    } catch {
      setLists([]);
    } finally {
      setListsLoading(false);
    }
  };
  const listName = lists?.find((l) => l.id === task.listId)?.name;

  // ─── tags ───────────────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState('');
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { setTagInput(''); return; }
    onPatch({ tags: [...tags, t] });
    setTagInput('');
  };
  const removeTag = (t) => onPatch({ tags: tags.filter((x) => x !== t) });

  return (
    <div className="px-5 border-t border-b border-slate-100 bg-slate-50/40">
      {/* ── Assignee ───────────────────────────────────────────────────── */}
      <FieldRow icon={User} label="Assignee">
        {editing === 'assignee' ? (
          <select
            autoFocus
            value={task.assignedTo || ''}
            onChange={(e) => { onPatch({ assignedTo: e.target.value || null }); setEditing(null); }}
            onBlur={() => setEditing(null)}
            className="text-sm border border-slate-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>{m.name || m.email}</option>
            ))}
          </select>
        ) : (
          <button type="button" className={inlineBtnCls()} onClick={() => setEditing('assignee')}>
            {assigneeName ? (
              <>
                <Avatar name={assigneeName} size="md" />
                <span className="text-sm text-slate-800 font-medium">{assigneeName}</span>
              </>
            ) : (
              <span className="text-slate-400">Unassigned</span>
            )}
          </button>
        )}
      </FieldRow>

      {/* ── Due date ───────────────────────────────────────────────────── */}
      <FieldRow icon={Calendar} label="Due date">
        {editing === 'due' ? (
          <input
            type="date"
            autoFocus
            defaultValue={task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : ''}
            onBlur={(e) => {
              const v = e.target.value;
              onPatch({ dueAt: v ? new Date(v).toISOString() : null });
              setEditing(null);
            }}
            className="text-sm border border-slate-200 rounded px-1.5 py-0.5 bg-white"
          />
        ) : (
          <button type="button" className={inlineBtnCls()} onClick={() => setEditing('due')}>
            {task.dueAt ? (
              <>
                <DueChip task={task} big />
                <span className="text-[11px] text-slate-500">
                  · {new Date(task.dueAt).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
              </>
            ) : (
              <span className="text-slate-400">No date</span>
            )}
          </button>
        )}
      </FieldRow>

      {/* ── Priority ───────────────────────────────────────────────────── */}
      <FieldRow icon={Flag} label="Priority">
        {editing === 'priority' ? (
          <div className="flex items-center gap-3 text-xs">
            {['high', 'medium', 'low'].map((p) => (
              <label key={p} className="inline-flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="priority"
                  value={p}
                  checked={task.priority === p}
                  onChange={() => { onPatch({ priority: p }); setEditing(null); }}
                />
                <span className={`w-2 h-2 rounded-sm ${PRIORITY_STYLES[p].dot}`} />
                <span className="capitalize">{PRIORITY_STYLES[p].label}</span>
              </label>
            ))}
          </div>
        ) : (
          <button type="button" className={inlineBtnCls()} onClick={() => setEditing('priority')}>
            <span className={`w-2 h-2 rounded-sm ${pStyle.dot}`} />
            <span className="text-sm text-slate-800 capitalize">{pStyle.label}</span>
          </button>
        )}
      </FieldRow>

      {/* ── List ───────────────────────────────────────────────────────── */}
      <FieldRow icon={Tag} label="List">
        {editing === 'list' ? (
          <select
            autoFocus
            value={task.listId || ''}
            onChange={(e) => { onPatch({ listId: e.target.value || null }); setEditing(null); }}
            onBlur={() => setEditing(null)}
            className="text-sm border border-slate-200 rounded px-1.5 py-0.5 bg-white"
          >
            <option value="">None</option>
            {(lists || []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className={inlineBtnCls()}
            onClick={() => { fetchLists(); setEditing('list'); }}
          >
            {listName ? (
              <span className="text-sm text-slate-800">{listName}</span>
            ) : task.listId ? (
              <span className="text-xs text-slate-500">{task.listId}</span>
            ) : (
              <span className="text-slate-400">None</span>
            )}
          </button>
        )}
      </FieldRow>

      {/* ── Tags ───────────────────────────────────────────────────────── */}
      <FieldRow icon={Tag} label="Tags">
        <div className="flex items-center gap-1 flex-wrap">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center">
              <TagChip tag={t} onRemove={removeTag} />
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(); }
              if (e.key === 'Escape') setTagInput('');
            }}
            onBlur={addTag}
            placeholder="+ tag"
            className="text-[10px] text-slate-600 placeholder:text-slate-400 px-1.5 py-0.5 rounded border border-dashed border-slate-200 bg-transparent outline-none focus:border-sky-300 focus:bg-white w-16"
          />
        </div>
      </FieldRow>

      {/* ── Linked deal (read-only chip when present) ──────────────────── */}
      {task.deal && (
        <FieldRow icon={Building2} label="Linked deal">
          <span className={inlineBtnCls()}>
            <span className="text-sm text-slate-800">{task.deal}</span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </span>
        </FieldRow>
      )}
    </div>
  );
}
