// Quick-capture input — natural-language task creation. Lives in the Header.
// Mirrors prototype tasks/header.jsx QuickCapture: Sparkles icon, ⌘K hint,
// inline Add button, and a popover row below the input that surfaces
// auto-detected priority/assignee/tags/due tokens as preview chips.
//
// Parsing lives in ./lib/parser.js (pure function, easy to test). This file
// is presentation-only.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { parseQuickCapture } from './lib/parser.js';
import { displayAssignee } from './lib/format.js';
import Avatar from './atoms/Avatar.jsx';

function PriorityChip({ priority }) {
  const cls =
    priority === 'high' ? 'bg-rose-50 text-rose-700'
      : priority === 'low' ? 'bg-slate-100 text-slate-600'
        : 'bg-sky-50 text-sky-700';
  return (
    <span className={`px-1.5 py-px rounded font-medium ${cls}`}>
      {priority} priority
    </span>
  );
}

function AssigneeChip({ assigneeId, team }) {
  const name = displayAssignee(assigneeId, team) || 'Assignee';
  const first = String(name).split(' ')[0];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-slate-50 text-slate-700">
      <Avatar name={name} size="sm" /> {first}
    </span>
  );
}

export default function QuickCapture({ onCreate, team = [] }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseQuickCapture(text, team);
  }, [text, team]);

  // Global ⌘K / Ctrl+K → focus the input.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function submit(e) {
    e.preventDefault();
    if (!parsed?.title) return;
    onCreate({
      title: parsed.title,
      priority: parsed.priority || 'medium',
      assignee: parsed.assignee, // TasksPage.onCreateFromHeader maps → assignedTo
      tags: parsed.tags,
      dueLabel: parsed.dueLabel,
      dueAt: parsed.dueAt,
    });
    setText('');
  }

  const hasPreviewTokens = Boolean(
    parsed && (parsed.priority || parsed.assignee || parsed.assigneeAmbiguous || parsed.dueLabel || (parsed.tags && parsed.tags.length))
  );

  return (
    <form onSubmit={submit} className="relative flex-1 max-w-2xl">
      <div className="flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100 rounded-lg px-3 py-1.5 transition-all">
        <Sparkles className="w-4 h-4 text-sky-500 shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Add a task — try "Draft Q3 deck @sneha !high #planning due tomorrow"'
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
          aria-label="Quick-capture new task"
        />
        <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">
          ⌘K
        </kbd>
        {text && (
          <button
            type="submit"
            className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium px-2.5 py-1 rounded-md shrink-0"
          >
            Add
          </button>
        )}
      </div>

      {parsed && text && hasPreviewTokens && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-2 z-30">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-1 mb-1.5">Auto-detected</p>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-medium text-slate-700">"{parsed.title || '…'}"</span>
            {parsed.priority && <PriorityChip priority={parsed.priority} />}
            {parsed.assignee && <AssigneeChip assigneeId={parsed.assignee} team={team} />}
            {parsed.assigneeAmbiguous && (
              <span className="px-1.5 py-px rounded bg-rose-50 text-rose-700" title="More than one team member matched — type more characters">
                @? ambiguous
              </span>
            )}
            {parsed.dueLabel && (
              <span className="px-1.5 py-px rounded bg-amber-50 text-amber-700 capitalize">Due {parsed.dueLabel}</span>
            )}
            {parsed.tags.map((tag) => (
              <span key={tag} className="px-1.5 py-px rounded bg-violet-50 text-violet-700">#{tag}</span>
            ))}
            <span className="ml-auto text-[10px] text-slate-400">Enter ↵ to add</span>
          </div>
        </div>
      )}
    </form>
  );
}
