// Workspace header for Tasks v2 — mirrors prototype tasks/header.jsx.
// Renders: title + count + current date, the quick-capture input, the
// view-switcher (Board/Focus/List/Calendar), and the New-task button.
//
// Layer A: quick-capture is a styled-but-inert input. Natural-language
// parsing + preview chips land in Layer D (lib/parser.js + QuickCapture.jsx).

import React, { useRef, useState } from 'react';
import { Sparkles, Sun, LayoutGrid, List as ListIcon, Calendar, Plus } from 'lucide-react';
import FilterBar from './FilterBar.jsx';
import DensityMenu from './DensityMenu.jsx';

const VIEW_TABS = [
  { k: 'board',    label: 'Board',    Icon: LayoutGrid },
  { k: 'focus',    label: 'Focus',    Icon: Sun },
  { k: 'list',     label: 'List',     Icon: ListIcon },
  { k: 'calendar', label: 'Calendar', Icon: Calendar },
];

function todayLabel(d = new Date()) {
  // e.g. "Saturday, May 17 · IST"
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const day = d.getDate();
  return `${weekday}, ${month} ${day} · IST`;
}

function QuickCapture({ onCreate }) {
  // Layer A stub: text input that submits a bare title. The full parser
  // (priority/assignee/tags/due tokens + preview row) ships in Layer D.
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  function submit(e) {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    onCreate({ title });
    setText('');
  }

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
    </form>
  );
}

function ViewSwitcher({ value, onChange }) {
  return (
    <div className="inline-flex items-center bg-slate-100 rounded-lg p-0.5">
      {VIEW_TABS.map((t) => {
        const active = value === t.k;
        return (
          <button
            key={t.k}
            type="button"
            onClick={() => onChange(t.k)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 font-medium rounded-md transition-colors px-2.5 py-1 text-xs ${
              active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <t.Icon className="w-3.5 h-3.5" aria-hidden />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function Header({
  subView, onSubView,
  scope, onScope,
  filters, onFilters,
  smartSort, onSmartSort,
  onCreate,
  count, doneCount,
  team, currentUser,
  density, onDensityChange,
}) {
  return (
    <header className="bg-white shrink-0 border-b border-slate-200">
      <div className="px-5 py-3 flex items-center gap-4">
        <div className="shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-slate-800 leading-none">Tasks</h1>
            <span className="text-[11px] text-slate-400" aria-hidden>·</span>
            <span className="text-[11px] text-slate-500 font-medium">
              {count} active · {doneCount} done
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{todayLabel()}</p>
        </div>

        <QuickCapture onCreate={onCreate} />

        <div className="ml-auto flex items-center gap-2">
          <ViewSwitcher value={subView} onChange={onSubView} />
          <DensityMenu value={density} onChange={onDensityChange} />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
            aria-label="Create new task"
            title="Create new task"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> New task
          </button>
        </div>
      </div>

      <FilterBar
        scope={scope}
        onScope={onScope}
        filters={filters}
        onFilters={onFilters}
        smartSort={smartSort}
        onSmartSort={onSmartSort}
        team={team}
        currentUser={currentUser}
      />
    </header>
  );
}
