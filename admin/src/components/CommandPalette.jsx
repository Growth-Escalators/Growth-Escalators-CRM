import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { GROUP_LABELS } from './navEntries.js';

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
  const navigate = useNavigate();

  // Reset state every time the palette opens, and focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(e => e.label.toLowerCase().includes(q))
      : entries;
    return filtered.slice(0, 8);
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
        className="w-[480px] max-w-[92vw] bg-primary-900 text-white border border-white/10 rounded-xl shadow-modal overflow-hidden animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
          <Search className="w-4 h-4 text-primary-300 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="Jump to..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-primary-300/50"
          />
        </div>
        <ul className="max-h-[320px] overflow-y-auto py-1">
          {matches.length === 0 && (
            <li className="px-3 py-3 text-sm text-primary-300/70">No matches</li>
          )}
          {matches.map((m, i) => {
            const Icon = m.icon;
            const active = i === activeIdx;
            // Section path — for grouped entries the "section" already equals
            // the group's display label, so we just render "Section → Label".
            const path = `${m.section} → ${m.label}`;
            return (
              <li
                key={m.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => go(m)}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm ${
                  active ? 'bg-white/10' : ''
                }`}
              >
                <Icon className="w-4 h-4 text-primary-300 flex-shrink-0" />
                <span className="flex-1 truncate text-white">{m.label}</span>
                <span className="text-xs text-primary-300/70 truncate ml-2">{path}</span>
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
