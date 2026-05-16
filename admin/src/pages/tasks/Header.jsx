// Workspace header for Tasks v2 — mirrors prototype tasks/header.jsx.
// Renders: title + count + current date, the quick-capture input, the
// view-switcher (Board/Focus/List/Calendar), and the New-task button.
//
// Layer D: QuickCapture lives in ./QuickCapture.jsx with full token parsing
// + a preview-chip popover. Header forwards `team` so the parser can resolve
// @-mentions against real users.

import React from 'react';
import { Sun, LayoutGrid, List as ListIcon, Calendar, Plus } from 'lucide-react';
import FilterBar from './FilterBar.jsx';
import QuickCapture from './QuickCapture.jsx';

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

        <QuickCapture onCreate={onCreate} team={team} />

        <div className="ml-auto flex items-center gap-2">
          <ViewSwitcher value={subView} onChange={onSubView} />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
            aria-label="Create new task"
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
