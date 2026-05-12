import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Plus, X, Trash2, Calendar, User, ChevronDown, MessageSquare, Paperclip,
  Image as ImageIcon, FileText, File as FileIcon, Link as LinkIcon, Upload, Reply, Edit2,
  Tag, Filter, Search,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import TodoSidebar from '../components/TodoSidebar.jsx';
import { apiFetch, getUser } from '../lib/api.js';

const COLUMNS = [
  { key: 'not_started', label: 'Not Started', color: '#64748b', light: 'bg-slate-50 border-slate-200' },
  { key: 'in_progress', label: 'In Progress', color: '#0284c7', light: 'bg-sky-50 border-sky-200' },
  { key: 'review',      label: 'Review',      color: '#f59e0b', light: 'bg-amber-50 border-amber-200' },
  { key: 'done',        label: 'Done',        color: '#16a34a', light: 'bg-emerald-50 border-emerald-200' },
];

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PRIORITY_STYLES = {
  low: 'bg-slate-200 text-slate-700',
  medium: 'bg-sky-100 text-sky-700',
  high: 'bg-red-100 text-red-700',
};
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

const VIEW_KEY = 'ge-crm-tasks-view';

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

function fmtTimestamp(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
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

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Resolve the user-facing display for tasks.assignedTo. New rows store the
// teammate's UUID (looked up in `team`); legacy rows may store a free-text
// name like "Jatin" or an email — fall back to that string.
function displayAssignee(rawValue, team) {
  if (!rawValue) return null;
  const member = team.find((m) => m.id === rawValue || m.email === rawValue);
  return member?.name || rawValue;
}

function memberByIdOrEmail(value, team) {
  if (!value) return null;
  return team.find((m) => m.id === value || m.email === value) || null;
}

function mimeIcon(att) {
  const mime = (att.mimeType || '').toLowerCase();
  const name = (att.label || att.filename || '').toLowerCase();
  if (att.kind === 'url') return LinkIcon;
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return ImageIcon;
  if (mime === 'application/pdf' || /\.(pdf|docx?|txt|md|rtf)$/i.test(name)) return FileText;
  return FileIcon;
}

// ---------------------------------------------------------------------------
// Tag palette — auto-assigned per tag-name (Trello-style consistent colours).
// 10 distinct hues, hashed by tag name so the same tag always picks the same.
// ---------------------------------------------------------------------------
const TAG_PALETTE = [
  { bg: 'bg-rose-100',    fg: 'text-rose-700',    ring: 'ring-rose-200' },
  { bg: 'bg-orange-100',  fg: 'text-orange-700',  ring: 'ring-orange-200' },
  { bg: 'bg-amber-100',   fg: 'text-amber-800',   ring: 'ring-amber-200' },
  { bg: 'bg-lime-100',    fg: 'text-lime-800',    ring: 'ring-lime-200' },
  { bg: 'bg-emerald-100', fg: 'text-emerald-700', ring: 'ring-emerald-200' },
  { bg: 'bg-teal-100',    fg: 'text-teal-700',    ring: 'ring-teal-200' },
  { bg: 'bg-sky-100',     fg: 'text-sky-700',     ring: 'ring-sky-200' },
  { bg: 'bg-indigo-100',  fg: 'text-indigo-700',  ring: 'ring-indigo-200' },
  { bg: 'bg-purple-100',  fg: 'text-purple-700',  ring: 'ring-purple-200' },
  { bg: 'bg-pink-100',    fg: 'text-pink-700',    ring: 'ring-pink-200' },
];
function tagColor(tag) {
  const t = String(tag || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

function TagChip({ tag, onRemove, small = true }) {
  const c = tagColor(tag);
  return (
    <span className={`inline-flex items-center gap-1 ${small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'} rounded font-medium ${c.bg} ${c.fg}`}>
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          className="opacity-60 hover:opacity-100"
          aria-label={`Remove ${tag}`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Due-date pill — colour-coded by aging.
//   past  → red, today/tomorrow → amber, within-7d → sky, later → slate
// ---------------------------------------------------------------------------
function dueAtPill(task) {
  if (!task.dueAt) return null;
  const d = new Date(task.dueAt);
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d); dueDay.setHours(0, 0, 0, 0);
  const days = Math.floor((dueDay - today) / (24 * 3600 * 1000));
  const isDone = task.status === 'done';
  let style = 'bg-slate-100 text-slate-600';
  if (!isDone) {
    if (days < 0) style = 'bg-red-50 text-red-700';
    else if (days <= 1) style = 'bg-amber-50 text-amber-700';
    else if (days <= 7) style = 'bg-sky-50 text-sky-700';
  }
  return { style, label: fmtDueAt(task.dueAt) };
}

// ---------------------------------------------------------------------------
// Avatar — initials in a colour-hashed circle.
// ---------------------------------------------------------------------------
const AVATAR_PALETTE = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-600', 'bg-emerald-500',
  'bg-teal-500', 'bg-sky-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500',
];
function avatarColor(name) {
  const t = String(name || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function Avatar({ name, size = 'sm', title }) {
  const px = size === 'lg' ? 'w-7 h-7 text-[11px]' : 'w-5 h-5 text-[9px]';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ${px} ${avatarColor(name)}`}
      title={title || name || 'Unassigned'}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AssigneeMenu — small inline dropdown used on Kanban cards.
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
// PriorityChip
// ---------------------------------------------------------------------------
function PriorityChip({ priority }) {
  const p = priority || 'medium';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[p] || PRIORITY_STYLES.medium}`}>
      {PRIORITY_LABEL[p] || 'Medium'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------
function TaskCard({ task, index, team, onOpen, onAssigned, selected, onToggleSelect, onRename }) {
  const pill = dueAtPill(task);
  const assigneeName = displayAssignee(task.assignedTo, team);
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const visibleTags = tags.slice(0, 3);
  const hiddenTagCount = tags.length - visibleTags.length;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title || '');

  useEffect(() => { setTitleDraft(task.title || ''); }, [task.title]);

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === task.title) return;
    try {
      await onRename(task.id, next);
    } catch { /* parent handles error display */ }
  }

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={editingTitle ? undefined : onOpen}
          className={`bg-white border rounded-lg p-2.5 cursor-pointer transition-all select-none ${
            snapshot.isDragging
              ? 'shadow-lg ring-2 ring-sky-200 border-sky-300'
              : selected
                ? 'border-sky-400 ring-2 ring-sky-100'
                : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-start gap-2 mb-1.5">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={(e) => { e.stopPropagation(); onToggleSelect(task.id); }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 shrink-0 cursor-pointer accent-sky-600"
              aria-label="Select task"
            />
            <div className="min-w-0 flex-1">
              {/* Tags row — sits above the title in Trello style */}
              {visibleTags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mb-1">
                  {visibleTags.map(t => <TagChip key={t} tag={t} />)}
                  {hiddenTagCount > 0 && (
                    <span className="text-[10px] text-slate-400 font-medium">+{hiddenTagCount}</span>
                  )}
                </div>
              )}
              {/* Title + priority */}
              <div className="flex items-start gap-1.5 mb-0.5">
                <PriorityChip priority={task.priority} />
                {editingTitle ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); setTitleDraft(task.title || ''); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 text-sm font-medium text-slate-800 border-b border-sky-300 focus:outline-none bg-transparent"
                  />
                ) : (
                  <p
                    className="text-sm font-medium text-slate-800 leading-tight flex-1 min-w-0"
                    onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
                    title="Click to rename"
                  >
                    {task.title}
                  </p>
                )}
              </div>
              {task.description && (
                <p className="text-[11px] text-slate-500 line-clamp-2 mb-1.5">{task.description}</p>
              )}
            </div>
          </div>
          {/* Footer row: avatar + due pill + counts */}
          <div className="flex items-center gap-2 flex-wrap text-[10px] pl-6">
            <Avatar name={assigneeName} />
            {pill && (
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium ${pill.style}`}>
                <Calendar className="w-3 h-3" /> {pill.label}
              </span>
            )}
            {task.contactName && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-medium">
                {task.contactName}
              </span>
            )}
            {(task.commentCount > 0 || task.attachmentCount > 0) && (
              <span className="inline-flex items-center gap-1.5 text-slate-400 ml-auto">
                {task.commentCount > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <MessageSquare className="w-3 h-3" /> {task.commentCount}
                  </span>
                )}
                {task.attachmentCount > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <Paperclip className="w-3 h-3" /> {task.attachmentCount}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ---------------------------------------------------------------------------
// MentionTextarea — textarea with `@` autocomplete from team list.
// ---------------------------------------------------------------------------
function MentionTextarea({ value, onChange, team, placeholder, rows = 3, autoFocus }) {
  const [popover, setPopover] = useState(null); // { start, query }
  const ref = useRef(null);

  function handleChange(e) {
    const v = e.target.value;
    onChange(v);
    const caret = e.target.selectionStart;
    // find last "@" before caret without intervening whitespace
    const before = v.slice(0, caret);
    const m = before.match(/@([\w.-]*)$/);
    if (m) {
      setPopover({ start: caret - m[0].length, query: m[1].toLowerCase() });
    } else {
      setPopover(null);
    }
  }

  function pick(member) {
    if (!popover || !ref.current) return;
    const v = value;
    const before = v.slice(0, popover.start);
    const after = v.slice(ref.current.selectionStart);
    const token = `@${member.email || member.name}`;
    const next = `${before}${token} ${after}`;
    onChange(next);
    setPopover(null);
    requestAnimationFrame(() => {
      if (ref.current) {
        const pos = before.length + token.length + 1;
        ref.current.focus();
        ref.current.setSelectionRange(pos, pos);
      }
    });
  }

  const filtered = popover
    ? team.filter((m) =>
        !popover.query
        || (m.name || '').toLowerCase().includes(popover.query)
        || (m.email || '').toLowerCase().includes(popover.query)
      ).slice(0, 6)
    : [];

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
      />
      {popover && filtered.length > 0 && (
        <div className="absolute left-2 top-full mt-1 z-30 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-sky-50"
            >
              <span className="font-medium text-slate-800">{m.name}</span>
              <span className="text-slate-400 ml-1">{m.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Render comment body with @-mention chips and \n -> <br>.
function CommentBody({ text }) {
  if (!text) return null;
  const parts = [];
  const re = /@([\w.+-]+@[\w.-]+\.[\w.-]+)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ k: 't', v: text.slice(last, m.index), id: i++ });
    parts.push({ k: 'm', v: m[1], id: i++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ k: 't', v: text.slice(last), id: i++ });

  return (
    <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">
      {parts.map((p) =>
        p.k === 'm' ? (
          <span key={p.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-xs font-medium mx-0.5">
            @{p.v.split('@')[0]}
          </span>
        ) : (
          <span key={p.id}>{p.v}</span>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentChip
// ---------------------------------------------------------------------------
function AttachmentChip({ attachment, taskId, currentUser, onDelete }) {
  const Icon = mimeIcon(attachment);
  const canDelete = currentUser && (currentUser.role === 'admin' || attachment.createdBy === currentUser.id);
  const label = attachment.label || attachment.filename || attachment.url || 'Attachment';

  async function open(e) {
    e.preventDefault();
    if (attachment.kind === 'url' && attachment.url) {
      window.open(attachment.url, '_blank', 'noopener,noreferrer');
      return;
    }
    // upload kind — fetch download endpoint as blob, open in new tab
    try {
      const token = localStorage.getItem('ge_crm_token');
      const res = await fetch(`/api/tasks/${taskId}/attachments/${attachment.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Don't revoke immediately — give the new tab time to load.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      alert(`Couldn't open: ${err.message}`);
    }
  }

  return (
    <span className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 max-w-full">
      <Icon className="w-3.5 h-3.5 shrink-0 text-slate-500" />
      <button onClick={open} className="truncate max-w-[160px] hover:underline" title={label}>
        {label}
      </button>
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(attachment); }}
          className="text-slate-400 hover:text-red-600"
          aria-label="Remove attachment"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AttachUrlForm
// ---------------------------------------------------------------------------
function AttachUrlForm({ onSubmit, onCancel }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex items-center gap-1">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (optional)"
        className="flex-1 min-w-0 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-300"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        className="flex-[2] min-w-0 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-300"
      />
      <button
        type="button"
        onClick={() => { if (url.trim()) onSubmit({ url: url.trim(), label: label.trim() || null }); }}
        disabled={!url.trim()}
        className="text-xs bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded px-2 py-1 font-medium"
      >
        Add
      </button>
      <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentsBlock — used both in the task body and in comment composer.
// ---------------------------------------------------------------------------
function AttachmentsBlock({ taskId, attachments, currentUser, onChanged, compact }) {
  const [showUrl, setShowUrl] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  async function uploadFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('ge_crm_token');
      const res = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.status === 401) {
        localStorage.removeItem('ge_crm_token');
        window.location.href = '/login';
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
      onChanged({ added: data.attachment });
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function attachUrl({ url, label }) {
    try {
      const data = await apiFetch(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'url', url, label }),
      });
      onChanged({ added: data.attachment });
      setShowUrl(false);
    } catch (e) {
      alert(`Couldn't attach: ${e.message}`);
    }
  }

  async function deleteAttachment(att) {
    if (!confirm(`Remove "${att.label || att.filename || 'attachment'}"?`)) return;
    try {
      await apiFetch(`/api/tasks/${taskId}/attachments/${att.id}`, { method: 'DELETE' });
      onChanged({ removedId: att.id });
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  }

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              taskId={taskId}
              currentUser={currentUser}
              onDelete={deleteAttachment}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => uploadFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'} text-slate-600 hover:text-sky-700 border border-slate-200 hover:border-sky-300 rounded px-2 py-1 disabled:opacity-50`}
        >
          <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading…' : 'Attach file'}
        </button>
        <button
          type="button"
          onClick={() => setShowUrl((s) => !s)}
          className={`inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'} text-slate-600 hover:text-sky-700 border border-slate-200 hover:border-sky-300 rounded px-2 py-1`}
        >
          <LinkIcon className="w-3.5 h-3.5" /> Paste URL
        </button>
      </div>
      {showUrl && (
        <AttachUrlForm onSubmit={attachUrl} onCancel={() => setShowUrl(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment item
// ---------------------------------------------------------------------------
function CommentItem({
  comment,
  team,
  taskId,
  currentUser,
  onReply,
  onEdit,
  onDelete,
  isReply,
  parentAuthor,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body || '');
  const author = memberByIdOrEmail(comment.authorId || comment.createdBy, team);
  const authorName = author?.name || comment.authorName || comment.createdBy || 'Unknown';
  const canEdit = currentUser && (comment.authorId === currentUser.id || comment.createdBy === currentUser.id);

  async function saveEdit() {
    const next = draft.trim();
    if (!next) return;
    try {
      const data = await apiFetch(`/api/tasks/${taskId}/comments/${comment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: next }),
      });
      onEdit(data.comment || { ...comment, body: next });
      setEditing(false);
    } catch (e) {
      alert(`Edit failed: ${e.message}`);
    }
  }

  async function remove() {
    if (!confirm('Delete this comment?')) return;
    try {
      await apiFetch(`/api/tasks/${taskId}/comments/${comment.id}`, { method: 'DELETE' });
      onDelete(comment.id);
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  }

  return (
    <div className={`flex gap-2 ${isReply ? 'pl-8' : ''}`}>
      <div className="w-8 h-8 shrink-0 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-semibold">
        {initials(authorName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-800">{authorName}</span>
          <span className="text-[11px] text-slate-400">{fmtTimestamp(comment.createdAt)}</span>
          {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
            <span className="text-[10px] text-slate-400">(edited)</span>
          )}
        </div>
        {isReply && parentAuthor && (
          <p className="text-[11px] text-slate-400 mb-1">in reply to {parentAuthor}</p>
        )}
        {editing ? (
          <div className="mt-1 space-y-1">
            <MentionTextarea value={draft} onChange={setDraft} team={team} rows={2} placeholder="Edit comment…" />
            <div className="flex items-center gap-2">
              <button onClick={saveEdit} className="text-xs bg-sky-600 hover:bg-sky-700 text-white rounded px-2 py-1">Save</button>
              <button onClick={() => { setEditing(false); setDraft(comment.body || ''); }} className="text-xs text-slate-500">Cancel</button>
            </div>
          </div>
        ) : (
          <CommentBody text={comment.body} />
        )}
        {!editing && comment.attachments && comment.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {comment.attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} taskId={taskId} currentUser={currentUser} onDelete={() => {}} />
            ))}
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {!isReply && (
              <button onClick={() => onReply(comment)} className="text-slate-500 hover:text-sky-700 inline-flex items-center gap-1">
                <Reply className="w-3 h-3" /> Reply
              </button>
            )}
            {canEdit && (
              <>
                <button onClick={() => setEditing(true)} className="text-slate-500 hover:text-sky-700 inline-flex items-center gap-1">
                  <Edit2 className="w-3 h-3" /> Edit
                </button>
                <button onClick={remove} className="text-slate-500 hover:text-red-600 inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiscussionTab
// ---------------------------------------------------------------------------
function DiscussionTab({ taskId, team, currentUser }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // comment object
  const [replyDraft, setReplyDraft] = useState('');
  const [replyAttachments, setReplyAttachments] = useState([]); // ids buffer post-create
  const [pendingAttachments, setPendingAttachments] = useState([]); // attachments attached to this composer pre-post

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/tasks/${taskId}/comments`);
      setComments(data.comments || []);
    } catch (e) {
      console.error('[Discussion] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const tree = useMemo(() => {
    const roots = [];
    const repliesByParent = {};
    for (const c of comments) {
      if (c.parentId) {
        (repliesByParent[c.parentId] = repliesByParent[c.parentId] || []).push(c);
      } else {
        roots.push(c);
      }
    }
    return { roots, repliesByParent };
  }, [comments]);

  async function postComment(parentId = null) {
    const body = (parentId ? replyDraft : draft).trim();
    if (!body) return;
    setPosting(true);
    try {
      const data = await apiFetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, parentId: parentId || null }),
      });
      const newComment = data.comment;
      setComments((cs) => [...cs, newComment]);
      if (parentId) {
        setReplyDraft('');
        setReplyTo(null);
      } else {
        setDraft('');
        setPendingAttachments([]);
      }
    } catch (e) {
      alert(`Couldn't post: ${e.message}`);
    } finally {
      setPosting(false);
    }
  }

  function authorOf(c) {
    const m = memberByIdOrEmail(c.authorId || c.createdBy, team);
    return m?.name || c.authorName || c.createdBy || 'Unknown';
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-xs text-slate-400 py-4 text-center">Loading…</p>
      ) : tree.roots.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No comments yet. Start the discussion below.</p>
      ) : (
        <ul className="space-y-3">
          {tree.roots.map((c) => {
            const replies = tree.repliesByParent[c.id] || [];
            return (
              <li key={c.id} className="space-y-2">
                <CommentItem
                  comment={c}
                  team={team}
                  taskId={taskId}
                  currentUser={currentUser}
                  onReply={(p) => { setReplyTo(p); setReplyDraft(''); }}
                  onEdit={(updated) => setComments((cs) => cs.map((x) => x.id === updated.id ? { ...x, ...updated } : x))}
                  onDelete={(id) => setComments((cs) => cs.filter((x) => x.id !== id && x.parentId !== id))}
                />
                {replies.length > 0 && (
                  <ul className="space-y-2">
                    {replies.map((r) => (
                      <li key={r.id}>
                        <CommentItem
                          comment={r}
                          team={team}
                          taskId={taskId}
                          currentUser={currentUser}
                          onReply={() => {}}
                          onEdit={(updated) => setComments((cs) => cs.map((x) => x.id === updated.id ? { ...x, ...updated } : x))}
                          onDelete={(id) => setComments((cs) => cs.filter((x) => x.id !== id))}
                          isReply
                          parentAuthor={authorOf(c)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {replyTo?.id === c.id && (
                  <div className="pl-10 space-y-1">
                    <MentionTextarea
                      value={replyDraft}
                      onChange={setReplyDraft}
                      team={team}
                      rows={2}
                      placeholder={`Reply to ${authorOf(c)}…`}
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => postComment(c.id)}
                        disabled={posting || !replyDraft.trim()}
                        className="text-xs bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium rounded px-2 py-1"
                      >
                        {posting ? 'Posting…' : 'Reply'}
                      </button>
                      <button
                        onClick={() => { setReplyTo(null); setReplyDraft(''); }}
                        className="text-xs text-slate-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          team={team}
          rows={3}
          placeholder="Write a comment… use @ to mention"
        />
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-400">Use @ to mention a teammate</p>
          <button
            onClick={() => postComment(null)}
            disabled={posting || !draft.trim()}
            className="text-xs bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium rounded px-3 py-1.5"
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentsTab
// ---------------------------------------------------------------------------
function AttachmentsTab({ taskId, currentUser }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/tasks/${taskId}/attachments`);
      setAttachments(data.attachments || []);
    } catch (e) {
      console.error('[Attachments] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  function onChanged({ added, removedId }) {
    if (added) setAttachments((xs) => [...xs, added]);
    if (removedId) setAttachments((xs) => xs.filter((x) => x.id !== removedId));
  }

  if (loading) return <p className="text-xs text-slate-400 py-4 text-center">Loading…</p>;

  return (
    <div className="space-y-3">
      <AttachmentsBlock
        taskId={taskId}
        attachments={attachments}
        currentUser={currentUser}
        onChanged={onChanged}
      />
      {attachments.length === 0 && (
        <p className="text-xs text-slate-400">No attachments yet. Use the buttons above to add files or paste URLs.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit modal
// ---------------------------------------------------------------------------
function TaskModal({ task, team, currentUser, onClose, onSaved, onDeleted, allTags = [] }) {
  const isEdit = !!task?.id;
  const [tab, setTab] = useState('details');
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? '');
  const [dueAt, setDueAt] = useState(toDateInput(task?.dueAt));
  const [status, setStatus] = useState(task?.status ?? 'not_started');
  const [priority, setPriority] = useState(task?.priority ?? 'medium');
  const [tags, setTags] = useState(Array.isArray(task?.tags) ? task.tags : []);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function normaliseTag(s) {
    return String(s || '').trim().toLowerCase().slice(0, 32);
  }
  function addTag(raw) {
    const t = normaliseTag(raw);
    if (!t) return;
    if (tags.includes(t)) { setTagDraft(''); return; }
    setTags([...tags, t]);
    setTagDraft('');
  }
  function removeTag(t) {
    setTags(tags.filter(x => x !== t));
  }
  const tagSuggestions = tagDraft
    ? allTags
        .map(a => a.tag || a)
        .filter(a => a.includes(tagDraft.toLowerCase()) && !tags.includes(a))
        .slice(0, 5)
    : [];

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
        priority,
        tags,
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
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800">{isEdit ? 'Edit Task' : 'New Task'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isEdit && (
          <div className="px-5 pt-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-1">
              {[
                { k: 'details', label: 'Details' },
                { k: 'discussion', label: 'Discussion' },
                { k: 'attachments', label: 'Attachments' },
              ].map((t) => (
                <button
                  key={t.k}
                  type="button"
                  onClick={() => setTab(t.k)}
                  className={`text-xs font-medium px-3 py-2 rounded-t-lg border-b-2 ${
                    tab === t.k
                      ? 'border-sky-600 text-sky-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-y-auto flex-1">
          {tab === 'details' && (
            <form onSubmit={save}>
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
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
                    {assignedTo && !team.some((m) => m.id === assignedTo) && (
                      <option value={assignedTo}>{assignedTo}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" /> Tags
                  </label>
                  <div className="border border-slate-200 rounded-lg px-2 py-2 bg-white focus-within:ring-2 focus-within:ring-sky-200">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {tags.map(t => <TagChip key={t} tag={t} onRemove={removeTag} small={false} />)}
                      <input
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); }
                          if (e.key === 'Backspace' && !tagDraft && tags.length) removeTag(tags[tags.length - 1]);
                        }}
                        placeholder={tags.length ? 'Add another…' : 'Add a tag and press Enter'}
                        className="flex-1 min-w-[120px] text-sm bg-transparent outline-none px-1 py-0.5"
                      />
                    </div>
                    {tagSuggestions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {tagSuggestions.map(s => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => addTag(s)}
                            className="text-[11px] px-2 py-0.5 rounded border border-slate-200 hover:border-sky-300 hover:bg-sky-50 text-slate-600"
                          >
                            + {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                {!isEdit && assignedTo && (
                  <p className="text-[11px] text-slate-400">Assignee will be notified on Slack.</p>
                )}
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
          )}

          {tab === 'discussion' && isEdit && (
            <div className="px-5 py-4">
              <DiscussionTab taskId={task.id} team={team} currentUser={currentUser} />
            </div>
          )}

          {tab === 'attachments' && isEdit && (
            <div className="px-5 py-4">
              <AttachmentsTab taskId={task.id} currentUser={currentUser} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk operations toolbar
// ---------------------------------------------------------------------------
function BulkToolbar({ selectedIds, team, onClear, onApplied, onDeleted }) {
  const [showAssignee, setShowAssignee] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!showAssignee) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowAssignee(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showAssignee]);

  async function applyPatch(patch) {
    try {
      const data = await apiFetch('/api/tasks/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds, patch }),
      });
      onApplied(data.tasks || [], patch);
    } catch (e) {
      alert(`Bulk update failed: ${e.message}`);
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'}?`)) return;
    try {
      await apiFetch('/api/tasks/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds }),
      });
      onDeleted(selectedIds);
    } catch (e) {
      alert(`Bulk delete failed: ${e.message}`);
    }
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3 z-40 border border-slate-700">
      <span className="text-xs font-medium">
        {selectedIds.length} selected
      </span>
      <span className="w-px h-5 bg-slate-700" />

      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) { applyPatch({ status: e.target.value }); e.target.value = ''; } }}
        className="bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400"
      >
        <option value="" disabled>Set status…</option>
        {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>

      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) { applyPatch({ priority: e.target.value }); e.target.value = ''; } }}
        className="bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400"
      >
        <option value="" disabled>Set priority…</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <div ref={ref} className="relative">
        <button
          onClick={() => setShowAssignee((v) => !v)}
          className="bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1 hover:bg-slate-700 inline-flex items-center gap-1"
        >
          <User className="w-3 h-3" /> Assign…
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
        {showAssignee && (
          <div className="absolute bottom-full mb-1 right-0 w-48 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl py-1 max-h-60 overflow-y-auto">
            <button
              onClick={() => { setShowAssignee(false); applyPatch({ assignedTo: null }); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              Unassigned
            </button>
            <div className="border-t border-slate-100 my-0.5" />
            {team.map((m) => (
              <button
                key={m.id}
                onClick={() => { setShowAssignee(false); applyPatch({ assignedTo: m.id }); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-sky-50"
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={bulkDelete}
        className="text-xs bg-red-600 hover:bg-red-700 rounded px-2 py-1 inline-flex items-center gap-1"
      >
        <Trash2 className="w-3 h-3" /> Delete
      </button>

      <span className="w-px h-5 bg-slate-700" />
      <button onClick={onClear} className="text-xs text-slate-300 hover:text-white">Clear selection</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (60x16 SVG)
// ---------------------------------------------------------------------------
function Sparkline({ values }) {
  if (!values || values.length === 0) {
    return <svg width="60" height="16" />;
  }
  const W = 60;
  const H = 16;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        fill="none"
        stroke="#0284c7"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(' ')}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Aging donut (SVG, no external lib)
// ---------------------------------------------------------------------------
function AgingDonut({ buckets }) {
  const SLICES = [
    { key: 'lt1d',   label: '< 1 day',   color: '#16a34a' },
    { key: '1to3d',  label: '1-3 days',  color: '#0284c7' },
    { key: '3to7d',  label: '3-7 days',  color: '#f59e0b' },
    { key: 'gt7d',   label: '> 7 days',  color: '#dc2626' },
  ];
  const values = SLICES.map((s) => buckets?.[s.key] || 0);
  const total = values.reduce((a, b) => a + b, 0);
  const R = 60;
  const r = 38;
  const C = 70;
  // build arcs
  let acc = 0;
  const arcs = SLICES.map((s, i) => {
    const v = values[i];
    const frac = total > 0 ? v / total : 0;
    const start = acc;
    acc += frac;
    const end = acc;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const x0 = C + R * Math.cos(a0);
    const y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1);
    const y1 = C + R * Math.sin(a1);
    const ix0 = C + r * Math.cos(a0);
    const iy0 = C + r * Math.sin(a0);
    const ix1 = C + r * Math.cos(a1);
    const iy1 = C + r * Math.sin(a1);
    const large = (end - start) > 0.5 ? 1 : 0;
    if (frac <= 0) return null;
    if (frac >= 0.999) {
      // full ring — draw as two halves
      return (
        <g key={s.key}>
          <path d={`M ${C + R} ${C} A ${R} ${R} 0 1 1 ${C - R} ${C} L ${C - r} ${C} A ${r} ${r} 0 1 0 ${C + r} ${C} Z`} fill={s.color} />
        </g>
      );
    }
    const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${r} ${r} 0 ${large} 0 ${ix0} ${iy0} Z`;
    return <path key={s.key} d={d} fill={s.color} />;
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={C * 2} height={C * 2}>
        {total === 0 ? (
          <circle cx={C} cy={C} r={(R + r) / 2} stroke="#e2e8f0" strokeWidth={R - r} fill="none" />
        ) : arcs}
        <text x={C} y={C + 4} textAnchor="middle" className="fill-slate-700" fontSize="14" fontWeight="600">{total}</text>
      </svg>
      <ul className="space-y-1 text-xs">
        {SLICES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-600 w-20">{s.label}</span>
            <span className="text-slate-800 font-medium">{values[i]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team Performance tab content
// ---------------------------------------------------------------------------
function TeamPerformanceTab() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/tasks/team-performance?period=${period}`)
      .then((d) => { if (!cancelled) { setData(d); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const members = data?.members || [];
  const aging = data?.aging || data?.agingTotals || null;

  return (
    <div className="px-6 py-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-slate-500">Period:</span>
        {[
          { k: '7d', label: '7 days' },
          { k: '30d', label: '30 days' },
          { k: '90d', label: '90 days' },
        ].map((p) => (
          <button
            key={p.k}
            onClick={() => setPeriod(p.k)}
            className={`text-xs px-2.5 py-1 rounded-md font-medium ${
              period === p.k ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-slate-400 py-12 text-center">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-600 py-12 text-center">{error}</p>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Member</th>
                  <th className="text-right px-4 py-2 font-medium">Done</th>
                  <th className="text-right px-4 py-2 font-medium">On-time %</th>
                  <th className="text-right px-4 py-2 font-medium">Active</th>
                  <th className="text-right px-4 py-2 font-medium">Overdue</th>
                  <th className="text-left px-4 py-2 font-medium">30d trend</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-400 text-xs py-8">No data for this period.</td>
                  </tr>
                ) : members.map((m) => (
                  <tr key={m.id || m.email} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[11px] font-semibold">
                          {initials(m.name)}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{m.name || m.email}</p>
                          {m.email && m.name && <p className="text-[11px] text-slate-400">{m.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{m.donePeriod ?? m.done ?? 0}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-sm font-medium ${
                        (m.onTimePct ?? 0) >= 80 ? 'text-emerald-600'
                          : (m.onTimePct ?? 0) >= 60 ? 'text-amber-600'
                          : 'text-red-600'
                      }`}>
                        {m.onTimePct != null ? `${Math.round(m.onTimePct)}%` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{m.activeLoad ?? m.active ?? 0}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={(m.overdue ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}>
                        {m.overdue ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Sparkline values={m.trend30d || m.trend || []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Aging breakdown (open tasks)</h3>
            <AgingDonut buckets={aging} />
          </div>
        </>
      )}
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
  const [modalTask, setModalTask] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [allTags, setAllTags] = useState([]); // [{tag, count}]
  const [filterAssignee, setFilterAssignee] = useState(''); // user id or ''
  const [filterTag, setFilterTag] = useState('');
  const [filterPriority, setFilterPriority] = useState(''); // '' | 'low' | 'medium' | 'high'
  const [filterDue, setFilterDue] = useState(''); // '' | 'overdue' | 'today' | 'week'
  const [quickAddOpen, setQuickAddOpen] = useState({}); // { [colKey]: bool }
  const [quickAddText, setQuickAddText] = useState('');
  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'all' || saved === 'mine' || saved === 'perf') return saved;
    } catch {}
    return 'mine';
  });

  const currentUser = getUser();
  const isAdmin = currentUser?.role === 'admin';

  const hasFilters = filterAssignee || filterTag || filterPriority || filterDue;
  function clearFilters() {
    setFilterAssignee(''); setFilterTag(''); setFilterPriority(''); setFilterDue('');
  }

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  }, [view]);

  // If a non-admin somehow has the perf view persisted, fall back.
  useEffect(() => {
    if (view === 'perf' && !isAdmin) setView('mine');
  }, [view, isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksResp, teamResp, tagsResp] = await Promise.all([
        apiFetch('/api/tasks'),
        apiFetch('/api/team').catch(() => ({ team: [] })),
        apiFetch('/api/tasks/tag-counts').catch(() => ({ tags: [] })),
      ]);
      setTasks(tasksResp.tasks ?? []);
      setTeam(teamResp.team ?? []);
      setAllTags(tagsResp.tags ?? []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  async function renameTask(taskId, newTitle) {
    // Optimistic
    setTasks((ts) => ts.map((t) => t.id === taskId ? { ...t, title: newTitle } : t));
    try {
      const { task: updated } = await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: newTitle }),
      });
      if (updated) upsertTask(updated);
    } catch (e) {
      setError(e.message || 'Rename failed');
      // Best-effort reload to undo optimism on failure
      load();
    }
  }

  async function quickAddSubmit(colKey) {
    const text = quickAddText.trim();
    if (!text) return;
    try {
      const { task: created } = await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: text, status: colKey }),
      });
      if (created) upsertTask(created);
      setQuickAddText('');
      // keep input open for fast multi-add
    } catch (e) {
      setError(e.message || 'Quick add failed');
    }
  }

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
    setSelectedIds((ids) => ids.filter((x) => x !== id));
  }

  function toggleSelect(id) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const newStatus = destination.droppableId;
    setTasks((ts) => ts.map((t) => t.id === draggableId ? { ...t, status: newStatus } : t));
    try {
      await apiFetch(`/api/tasks/${draggableId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      setTasks((ts) => ts.map((t) => t.id === draggableId ? { ...t, status: source.droppableId } : t));
      alert(`Couldn't move task: ${e.message}`);
    }
  }

  // Filter: My Tasks vs All Team + advanced filter bar
  const visibleTasks = useMemo(() => {
    let out = tasks;
    if (view === 'mine' && currentUser?.id) {
      out = out.filter((t) =>
        t.assignedTo === currentUser.id
        || t.assignedTo === currentUser.email
      );
    }
    if (filterAssignee) {
      out = out.filter((t) => t.assignedTo === filterAssignee);
    }
    if (filterTag) {
      out = out.filter((t) => Array.isArray(t.tags) && t.tags.includes(filterTag));
    }
    if (filterPriority) {
      out = out.filter((t) => (t.priority || 'medium') === filterPriority);
    }
    if (filterDue) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
      out = out.filter((t) => {
        if (!t.dueAt) return false;
        const d = new Date(t.dueAt);
        if (isNaN(d.getTime())) return false;
        if (filterDue === 'overdue') return d < today && t.status !== 'done';
        if (filterDue === 'today') return d >= today && d < tomorrow;
        if (filterDue === 'week') return d >= today && d < weekEnd;
        return true;
      });
    }
    return out;
  }, [tasks, view, currentUser, filterAssignee, filterTag, filterPriority, filterDue]);

  // Group visible tasks by status, sorted by priority -> dueAt -> createdAt.
  const tasksByColumn = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
    for (const t of visibleTasks) {
      const col = COLUMNS.find((c) => c.key === t.status) ? t.status : 'not_started';
      map[col].push(t);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority || 'medium'] ?? 1;
        const pb = PRIORITY_RANK[b.priority || 'medium'] ?? 1;
        if (pa !== pb) return pa - pb;
        const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        if (da !== db) return da - db;
        const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return cb - ca;
      });
    }
    return map;
  }, [visibleTasks]);

  const doneCount = visibleTasks.filter((t) => t.status === 'done').length;
  const totalCount = visibleTasks.length;

  function applyBulkResult(updatedTasks, patch) {
    if (Array.isArray(updatedTasks) && updatedTasks.length > 0) {
      setTasks((ts) => ts.map((t) => {
        const u = updatedTasks.find((x) => x.id === t.id);
        return u ? { ...t, ...u } : t;
      }));
    } else {
      // fallback: apply patch locally
      setTasks((ts) => ts.map((t) => selectedIds.includes(t.id) ? { ...t, ...patch } : t));
    }
  }

  function applyBulkDelete(ids) {
    setTasks((ts) => ts.filter((t) => !ids.includes(t.id)));
    setSelectedIds([]);
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Tasks Board</h1>
              <p className="text-xs text-slate-500">
                {loading
                  ? 'Loading…'
                  : view === 'perf'
                    ? 'Team performance metrics'
                    : `${totalCount} task${totalCount === 1 ? '' : 's'} · ${doneCount} done`}
              </p>
            </div>
            {/* Segmented control */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setView('mine')}
                className={`text-xs font-medium px-3 py-1.5 rounded-md ${view === 'mine' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                My Tasks
              </button>
              <button
                onClick={() => setView('all')}
                className={`text-xs font-medium px-3 py-1.5 rounded-md ${view === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
              >
                All Team
              </button>
              {isAdmin && (
                <button
                  onClick={() => setView('perf')}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md ${view === 'perf' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                >
                  Team Performance
                </button>
              )}
            </div>
          </div>
          {view !== 'perf' && (
            <button
              onClick={() => setModalTask({})}
              className="inline-flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
            >
              <Plus className="w-4 h-4" /> New Task
            </button>
          )}
        </header>

        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-6 py-2">
            {error}
          </div>
        )}

        {/* Filter bar — hidden on Team Performance view */}
        {view !== 'perf' && (
          <div className="bg-white border-b border-slate-100 px-6 py-2 flex items-center gap-2 flex-wrap shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
              aria-label="Filter by assignee"
            >
              <option value="">Anyone</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
              aria-label="Filter by tag"
            >
              <option value="">Any tag</option>
              {allTags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
            </select>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
              aria-label="Filter by priority"
            >
              <option value="">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={filterDue}
              onChange={(e) => setFilterDue(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
              aria-label="Filter by due window"
            >
              <option value="">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">Due this week</option>
            </select>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium ml-1"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-slate-400 ml-auto">
              {visibleTasks.length} match{visibleTasks.length === 1 ? '' : 'es'}
            </span>
          </div>
        )}

        {/* Body */}
        {view === 'perf' ? (
          <div className="flex-1 min-h-0">
            <TeamPerformanceTab />
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
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
                                  onRename={renameTask}
                                  selected={selectedIds.includes(t.id)}
                                  onToggleSelect={toggleSelect}
                                />
                              ))}
                              {provided.placeholder}
                              {list.length === 0 && !snapshot.isDraggingOver && (
                                <p className="text-center text-xs text-slate-400 py-3 italic">
                                  {hasFilters ? 'No matches in this column' : 'No tasks here yet — click + below'}
                                </p>
                              )}
                            </div>
                          )}
                        </Droppable>
                        <div className="px-2 pb-2 shrink-0">
                          {quickAddOpen[col.key] ? (
                            <form
                              onSubmit={(e) => { e.preventDefault(); quickAddSubmit(col.key); }}
                              className="bg-white border border-sky-300 ring-2 ring-sky-100 rounded-lg p-1.5"
                            >
                              <input
                                autoFocus
                                value={quickAddText}
                                onChange={(e) => setQuickAddText(e.target.value)}
                                onBlur={() => {
                                  if (!quickAddText.trim()) {
                                    setQuickAddOpen((s) => ({ ...s, [col.key]: false }));
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setQuickAddText('');
                                    setQuickAddOpen((s) => ({ ...s, [col.key]: false }));
                                  }
                                }}
                                placeholder="Task title…"
                                className="w-full text-sm px-2 py-1 outline-none"
                              />
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <button
                                  type="submit"
                                  disabled={!quickAddText.trim()}
                                  className="text-xs bg-sky-600 hover:bg-sky-700 text-white font-medium px-2.5 py-1 rounded disabled:opacity-50"
                                >
                                  Add task
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQuickAddText('');
                                    setQuickAddOpen((s) => ({ ...s, [col.key]: false }));
                                  }}
                                  className="text-xs text-slate-500 hover:text-slate-700 px-1"
                                >
                                  Cancel
                                </button>
                                <span className="text-[10px] text-slate-400 ml-auto">Enter ↵ to add · Esc to close</span>
                              </div>
                            </form>
                          ) : (
                            <button
                              onClick={() => setQuickAddOpen((s) => ({ ...s, [col.key]: true }))}
                              className="w-full text-xs text-slate-400 hover:text-slate-600 hover:bg-white border border-dashed border-slate-200 hover:border-slate-300 rounded-lg py-1.5 transition-colors"
                            >
                              + Add task
                            </button>
                          )}
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
        )}

        {selectedIds.length >= 2 && view !== 'perf' && (
          <BulkToolbar
            selectedIds={selectedIds}
            team={team}
            onClear={() => setSelectedIds([])}
            onApplied={(updated, patch) => applyBulkResult(updated, patch)}
            onDeleted={applyBulkDelete}
          />
        )}
      </div>

      {modalTask !== null && (
        <TaskModal
          task={modalTask}
          team={team}
          currentUser={currentUser}
          allTags={allTags}
          onClose={() => setModalTask(null)}
          onSaved={(t) => { upsertTask(t); setModalTask(null); }}
          onDeleted={(id) => { removeTask(id); setModalTask(null); }}
        />
      )}
    </div>
  );
}
