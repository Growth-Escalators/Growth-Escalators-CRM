// DetailPanel — right-side slide-in (480px) showing one task in detail.
// Replaces the legacy centered modal. Mounted by TasksPage when openTask is
// truthy; closes on backdrop click, ESC, or X button.
//
// Composition
//   ┌─ backdrop (slate-900/20 + blur) ─────────────────────────────┐
//   │                                                              │
//   │                            ┌─ aside w-[480px] ──────────────┐│
//   │                            │ header: StatusPicker · ↑↓ · ⧉ ✕││
//   │                            │ title (inline-editable)        ││
//   │                            │ FieldStrip                     ││
//   │                            │ Tab bar                        ││
//   │                            │ Tab body                       ││
//   │                            └────────────────────────────────┘│
//   └──────────────────────────────────────────────────────────────┘

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Link as LinkIcon, X } from 'lucide-react';
import StatusPicker from './DetailPanel/StatusPicker.jsx';
import FieldStrip from './DetailPanel/FieldStrip.jsx';
import DescriptionTab from './DetailPanel/DescriptionTab.jsx';
import SubtasksTab from './DetailPanel/SubtasksTab.jsx';
import ActivityTab from './DetailPanel/ActivityTab.jsx';
import FilesTab from './DetailPanel/FilesTab.jsx';

const SLIDE_KEYFRAMES = `
@keyframes ge-tasks-slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes ge-tasks-fadein  { from { opacity: 0; } to { opacity: 1; } }
`;

const TABS = [
  { key: 'description', label: 'Description' },
  { key: 'subtasks',    label: 'Subtasks' },
  { key: 'activity',    label: 'Activity' },
  { key: 'files',       label: 'Files' },
];

function shortId(id) {
  if (!id) return '';
  const tail = String(id).replace(/-/g, '').slice(-4).toUpperCase();
  return `GE-${tail}`;
}

export default function DetailPanel({
  task, team = [], visibleTasks = [], onPatch, onClose, onNavigate,
}) {
  // ─── Always declare hooks before any early-return. ───────────────────
  const [tab, setTab] = useState('description');
  const [titleDraft, setTitleDraft] = useState('');
  const titleRef = useRef(null);

  useEffect(() => {
    setTab('description');
    setTitleDraft(task?.title || '');
  }, [task?.id]);

  const idx = useMemo(() => {
    if (!task) return -1;
    return visibleTasks.findIndex((t) => t.id === task.id);
  }, [visibleTasks, task]);

  const prevTask = idx > 0 ? visibleTasks[idx - 1] : null;
  const nextTask = idx >= 0 && idx < visibleTasks.length - 1 ? visibleTasks[idx + 1] : null;

  if (!task) return null;

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (!next || next === task.title) {
      setTitleDraft(task.title || '');
      return;
    }
    onPatch({ title: next });
  };

  const copyLink = () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}?taskId=${encodeURIComponent(task.id)}`;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url);
    } catch { /* noop */ }
  };

  const counts = {
    subtasks: task.subtasksTotal ? `${task.subtasksDone || 0}/${task.subtasksTotal}` : null,
    activity: task.commentCount || task.comments || null,
    files:    task.attachmentCount || task.attachments || null,
  };

  return (
    <>
      <style>{SLIDE_KEYFRAMES}</style>
      {/* Backdrop — click to close */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/20 backdrop-blur-[1px] z-40"
        style={{ animation: 'ge-tasks-fadein 180ms ease-out both' }}
      />
      <aside
        role="dialog"
        aria-label={`Task: ${task.title}`}
        className="fixed right-0 top-0 bottom-0 w-[480px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col"
        style={{ animation: 'ge-tasks-slidein 220ms cubic-bezier(0.22,0.61,0.36,1) both' }}
      >
        {/* Top bar */}
        <header className="border-b border-slate-100 px-5 py-3 flex items-center gap-2 shrink-0">
          <StatusPicker value={task.status} onChange={(v) => onPatch({ status: v })} />
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              title="Previous task"
              disabled={!prevTask}
              onClick={() => prevTask && onNavigate?.(prevTask)}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Next task"
              disabled={!nextTask}
              onClick={() => nextTask && onNavigate?.(nextTask)}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Copy link"
              onClick={copyLink}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
            >
              <LinkIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 pt-4 pb-5">
            <input
              ref={titleRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setTitleDraft(task.title || '');
                  e.currentTarget.blur();
                }
              }}
              className="w-full text-xl font-semibold text-slate-900 leading-tight bg-transparent outline-none focus:bg-slate-50 rounded px-1 -ml-1"
            />
            <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-slate-500">
              <span>{shortId(task.id)}</span>
              {task.createdAt && (<><span>·</span><span>Created {new Date(task.createdAt).toLocaleDateString()}</span></>)}
              {task.updatedAt && (<><span>·</span><span>Updated {new Date(task.updatedAt).toLocaleDateString()}</span></>)}
            </div>
          </div>

          <FieldStrip task={task} team={team} onPatch={onPatch} />

          {/* Tabs */}
          <div className="px-5 mt-4">
            <div className="flex items-center gap-4 border-b border-slate-200">
              {TABS.map((t) => {
                const c = counts[t.key];
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`relative pb-2 text-xs font-medium transition-colors ${
                      active
                        ? 'text-slate-900 border-b-2 border-sky-500'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t.label}
                    {c != null && <span className="ml-1 text-[10px] text-slate-400">{c}</span>}
                  </button>
                );
              })}
            </div>

            <div className="py-4">
              {tab === 'description' && <DescriptionTab task={task} onPatch={onPatch} />}
              {tab === 'subtasks'    && <SubtasksTab task={task} />}
              {tab === 'activity'    && <ActivityTab task={task} team={team} />}
              {tab === 'files'       && <FilesTab task={task} />}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
