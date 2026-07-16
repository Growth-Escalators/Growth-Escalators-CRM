import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { GROUP_LABELS } from './navEntries.js';
import { safeLower } from '../lib/safe.js';
import { DIALOG_FOCUSABLE_SELECTOR, trappedDialogFocusTarget } from '../lib/focusManagement.js';

// Cmd+K / Ctrl+K command palette. Filters the visible nav entries by
// case-insensitive substring match on label, shows top 8, supports
// arrow-key navigation + Enter to navigate. Esc / click-outside closes.
//
// Props:
//   open      — boolean
//   onClose   — () => void
//   entries   — array of nav entries already filtered by permissions
export default function CommandPalette({ open, onClose, entries }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const navigate = useNavigate();

  // Reset state every time the palette opens, and focus the input.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement;
    setQuery('');
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = safeLower(query).trim();
    const filtered = q
      ? entries.filter((entry) => safeLower([
          entry.label,
          entry.description,
          entry.section,
          GROUP_LABELS[entry.group],
          ...(entry.keywords || []),
        ].filter(Boolean).join(' ')).includes(q))
      : entries;
    return filtered.slice(0, 10);
  }, [entries, query]);

  // Keep activeIdx within bounds when matches shrink.
  useEffect(() => {
    if (activeIdx >= matches.length) setActiveIdx(0);
  }, [matches.length, activeIdx]);

  function go(entry) {
    if (!entry) return;
    if (entry.external) {
      window.open(entry.href, '_blank', 'noopener,noreferrer');
    } else if (entry.newTab) {
      window.open(entry.to, '_blank', 'noopener,noreferrer');
    } else {
      navigate(entry.to);
    }
    onClose();
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR) || [];
      const target = trappedDialogFocusTarget(focusable, document.activeElement, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(matches[activeIdx]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        ref={dialogRef}
        className="w-[480px] max-w-[92vw] bg-primary-900 text-white border border-white/10 rounded-xl shadow-modal overflow-hidden animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
          <Search className="w-4 h-4 text-primary-200 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="Search pages and workflows…"
            aria-label="Search pages and workflows"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={matches.length > 0}
            aria-controls="command-palette-results"
            aria-activedescendant={matches[activeIdx] ? `command-palette-option-${matches[activeIdx].id}` : undefined}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-primary-200"
          />
          <button type="button" onClick={onClose} aria-label="Close command palette" className="rounded-md p-1 text-primary-100 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <ul id="command-palette-results" className="max-h-[360px] overflow-y-auto py-1" role="listbox" aria-label="Available destinations">
          {matches.length === 0 && (
            <li className="px-3 py-3 text-sm text-primary-300/70">No matches</li>
          )}
          {matches.map((m, i) => {
            const Icon = m.icon;
            const active = i === activeIdx;
            const path = m.group ? GROUP_LABELS[m.group] : m.section;
            return (
              <li
                key={m.id}
                id={`command-palette-option-${m.id}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => go(m)}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm ${
                  active ? 'bg-white/10' : ''
                }`}
              >
                <Icon className="w-4 h-4 text-primary-300 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-white">{m.label}</span>
                  {m.description && <span className="block truncate text-xs text-primary-300/65">{m.description}</span>}
                </span>
                <span className="max-w-36 truncate text-xs text-primary-300/70 ml-2">{path}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// Re-export for callers that want the label map (unused today, here for completeness).
export { GROUP_LABELS };
