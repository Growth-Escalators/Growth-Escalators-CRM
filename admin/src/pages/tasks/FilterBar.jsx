// FilterBar — sits below the Tasks v2 Header. Mirrors prototype
// tasks/header.jsx FilterBar component.
//
// Surfaces: scope segmented (My/All/Today), assignee avatar chips (first 5
// teammates, current user pinned first), priority pill group, due select,
// Clear link, and the Smart-sort toggle.

import React from 'react';
import { Sparkles, Sun } from 'lucide-react';
import Avatar from './atoms/Avatar.jsx';

// ---- scope segmented -------------------------------------------------------

const SCOPES = [
  { k: 'mine',  label: 'My tasks',  Icon: null },
  { k: 'all',   label: 'All team',  Icon: null },
  { k: 'today', label: 'Today',     Icon: Sun },
];

function ScopeTabs({ value, onChange }) {
  return (
    <div className="inline-flex items-center bg-slate-100 rounded-lg p-0.5">
      {SCOPES.map((s) => {
        const active = value === s.k;
        return (
          <button
            key={s.k}
            type="button"
            onClick={() => onChange(s.k)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 font-medium rounded-md transition-colors px-2.5 py-1 text-xs ${
              active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {s.Icon && <s.Icon className="w-3.5 h-3.5" aria-hidden />}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- priority pill group ---------------------------------------------------

const PRIORITIES = [
  { k: 'high',   label: 'High', activeCls: 'bg-rose-100 text-rose-700' },
  { k: 'medium', label: 'Med',  activeCls: 'bg-sky-100 text-sky-700' },
  { k: 'low',    label: 'Low',  activeCls: 'bg-slate-200 text-slate-700' },
];

// ---- main component --------------------------------------------------------

export default function FilterBar({
  scope, onScope,
  filters, onFilters,
  smartSort, onSmartSort,
  team = [],
  currentUser,
}) {
  function toggleFilter(key, val) {
    onFilters({ ...filters, [key]: filters[key] === val ? null : val });
  }
  const hasFilters = !!(filters.assignee || filters.priority || filters.due);

  // First 5 chips: pin the current user (if in team), then the rest in order.
  const peoplePills = (() => {
    if (!Array.isArray(team) || team.length === 0) return [];
    const me = currentUser?.id;
    const rest = team.filter((m) => m.id !== me);
    const ordered = me && team.find((m) => m.id === me)
      ? [team.find((m) => m.id === me), ...rest]
      : team;
    return ordered.slice(0, 5);
  })();

  return (
    <div className="px-5 py-2 bg-white border-b border-slate-100 flex items-center gap-2 flex-wrap shrink-0">
      <ScopeTabs value={scope} onChange={onScope} />

      <div className="h-5 w-px bg-slate-200 mx-1" aria-hidden />

      {/* Assignee chips */}
      {peoplePills.length > 0 && (
        <div className="flex items-center gap-1">
          {peoplePills.map((m) => {
            const active = filters.assignee === m.id;
            const firstName = (m.name || m.email || '').split(/[\s@]/)[0];
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleFilter('assignee', m.id)}
                title={m.name || m.email}
                aria-pressed={active}
                aria-label={`Filter by ${m.name || m.email}`}
                className={`inline-flex items-center gap-1 px-1 py-0.5 rounded-full transition-all ${
                  active ? 'bg-sky-50 ring-1 ring-sky-300' : 'hover:bg-slate-100'
                }`}
              >
                <Avatar name={m.name || m.email} size="sm" />
                {active && <span className="text-[10px] text-sky-700 font-medium pr-1">{firstName}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="h-5 w-px bg-slate-200 mx-1" aria-hidden />

      {/* Priority pill group */}
      <div className="inline-flex items-center bg-slate-50 rounded-md p-0.5">
        {PRIORITIES.map((p) => {
          const active = filters.priority === p.k;
          return (
            <button
              key={p.k}
              type="button"
              onClick={() => toggleFilter('priority', p.k)}
              aria-pressed={active}
              className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
                active ? p.activeCls : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Due select */}
      <select
        value={filters.due || ''}
        onChange={(e) => onFilters({ ...filters, due: e.target.value || null })}
        aria-label="Filter by due date"
        className="text-xs bg-slate-50 hover:bg-slate-100 border-0 rounded-md px-2 py-1 outline-none cursor-pointer"
      >
        <option value="">Any date</option>
        <option value="overdue">Overdue</option>
        <option value="today">Today</option>
        <option value="week">This week</option>
      </select>

      {hasFilters && (
        <button
          type="button"
          onClick={() => onFilters({ assignee: null, priority: null, due: null })}
          className="text-xs text-sky-600 hover:text-sky-700 font-medium"
        >
          Clear
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSmartSort(!smartSort)}
          aria-pressed={!!smartSort}
          title="Auto-prioritize today's column using urgency, priority, and team load"
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
            smartSort
              ? 'bg-gradient-to-r from-sky-50 to-violet-50 text-sky-700 ring-1 ring-inset ring-sky-200'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden />
          Smart sort
          {smartSort && <span className="text-[10px] bg-sky-600 text-white rounded px-1">ON</span>}
        </button>
      </div>
    </div>
  );
}
