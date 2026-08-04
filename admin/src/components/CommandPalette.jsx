import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, LogOut, FilterX, Link2, RefreshCw, ArrowRight,
  Users, TrendingUp, Building2, FileText, Briefcase,
} from 'lucide-react';
import { GROUP_LABELS, getVisibleEntries } from './navEntries.js';
import { closedStaffingPhases } from '../lib/staffingAccess.js';
import { apiFetch, getPermissions, getUser, logout } from '../lib/api.js';
import { getTenantFeatureFlags, getTenantSlug, productPath } from '../lib/auth.js';
import { safeLower } from '../lib/safe.js';

// The single ⌘K surface. It used to be one of TWO competing palettes: the
// TopBar box (labelled "Search contacts, deals, signals… ⌘K") opened
// GlobalSearch (records only), while actually pressing ⌘K opened this
// component (nav only) — one label, one shortcut, two different results.
// Everything is folded in here now: Actions, "Go to" (nav), and Records.
// GlobalSearch.jsx is a thin alias onto this so the TopBar box and the ⌘K
// key land on the same thing.
//
// Props (all optional):
//   open      — boolean
//   onClose   — () => void
//   entries   — pre-permission-filtered nav entries. Sidebar passes these
//               because it already resolved live staffing phases from the
//               API; without them we recompute and fail closed (see below).

// Maps a /api/search result `type` to its icon + navigation target — extend
// here when a new searchable entity is added server-side (src/routes/search.ts).
export const RESULT_TYPES = {
  contact: { label: 'Contact', icon: Users, to: (r) => `/contacts?id=${r.id}` },
  deal: { label: 'Deal', icon: TrendingUp, to: (r) => `/pipeline?deal=${r.id}` },
  wizmatch_company: { label: 'Company', icon: Building2, to: (r) => `/wizmatch/companies?id=${r.id}` },
  wizmatch_requirement: { label: 'Requirement', icon: FileText, to: (r) => `/wizmatch/requirements?id=${r.id}` },
  wizmatch_submission: { label: 'Submission', icon: Briefcase, to: (r) => `/wizmatch/submissions?id=${r.id}` },
};

// Nav results are no longer capped at 8. This is a defensive ceiling only —
// the full nav is ~30 entries, so in practice every match is listed and the
// panel scrolls.
const MAX_NAV_RESULTS = 50;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARS = 2;

// Query params that are NOT filters and must survive "Clear filters":
// several pages encode which tab/record is open in the URL the same way
// useTableControls encodes filters, and dropping those would teleport the
// user off the view they were looking at rather than just unfiltering it.
const NON_FILTER_PARAMS = new Set(['tab', 'id', 'deal', 'returnTo', 'tenant']);

// Subsequence scoring, replacing a plain `includes()`. Ranking, best first:
// exact label > prefix > word-boundary substring > substring > scattered
// subsequence (so "hc" finds "Hiring Contacts"). Returns null for no match.
function fuzzyScore(text, query) {
  const t = safeLower(text);
  if (!query) return 0;
  if (t === query) return 10000;

  const idx = t.indexOf(query);
  if (idx === 0) return 9000 - t.length;
  if (idx > 0) {
    const onWordBoundary = /[\s/(-]/.test(t[idx - 1]);
    return (onWordBoundary ? 8000 : 7000) - idx * 10 - t.length;
  }

  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const ch of query) {
    const found = t.indexOf(ch, cursor);
    if (found === -1) return null;
    // Reward consecutive hits and hits right after a separator; penalise gaps.
    streak = found === cursor ? streak + 1 : 0;
    const onWordBoundary = found === 0 || /[\s/(-]/.test(t[found - 1]);
    score += 20 + streak * 10 + (onWordBoundary ? 15 : 0) - Math.min(found - cursor, 20);
    cursor = found + 1;
  }
  return Math.max(score, 1);
}

// Only one palette may be on screen at a time. Two independent mount points
// exist on an AppLayout page — Sidebar mounts this for ⌘K, AppLayout mounts
// GlobalSearch (→ this) for the TopBar box — and each owns its own `open`
// state, so without this a user who clicked the box and then hit ⌘K got two
// stacked dialogs. Whichever opens last wins; the other is told to close.
const liveInstances = new Map();

export default function CommandPalette({ open, onClose, entries }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [records, setRecords] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const close = useCallback(() => { onClose?.(); }, [onClose]);

  // Keep the dedupe registry pointed at a fresh closer without re-running the
  // registration effect on every parent render.
  const closeRef = useRef(close);
  closeRef.current = close;
  const instanceId = useRef(Symbol('command-palette'));

  useEffect(() => {
    const id = instanceId.current;
    if (!open) { liveInstances.delete(id); return undefined; }
    for (const [otherId, otherClose] of liveInstances) {
      if (otherId !== id) otherClose();
    }
    liveInstances.set(id, () => closeRef.current());
    return () => { liveInstances.delete(id); };
  }, [open]);

  // Reset state every time the palette opens, and focus the input.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIdx(0);
    setRecords([]);
    setSearchError('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Nav entries. Sidebar hands us the list it already resolved (including
  // live staffing phases from /api/wizmatch/staffing/access). When we're
  // mounted standalone — the TopBar box via GlobalSearch.jsx — we recompute
  // with phases closed, matching Sidebar's own fail-closed default so the
  // palette can never surface a phase the API has disabled.
  const navEntries = useMemo(() => {
    if (entries) return entries;
    const user = getUser();
    const slug = user?.tenantSlug || getTenantSlug();
    return getVisibleEntries(
      user?.role || 'staff',
      getPermissions(),
      slug,
      closedStaffingPhases(),
      getTenantFeatureFlags(slug),
    );
  }, [entries, open]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read session on each open

  // ── Global actions: page-independent things the palette can DO ────────────
  const clearableParams = useMemo(() => {
    const current = new URLSearchParams(location.search);
    return [...current.keys()].filter((k) => !NON_FILTER_PARAMS.has(k));
  }, [location.search]);

  const actions = useMemo(() => {
    const list = [];
    if (clearableParams.length > 0) {
      list.push({
        id: 'clear-filters',
        label: 'Clear filters on this page',
        hint: `${clearableParams.length} active`,
        icon: FilterX,
        // Every filterable list page keeps its filters in the query string
        // (useTableControls), so stripping them is genuinely generic.
        run: () => {
          const kept = new URLSearchParams();
          const current = new URLSearchParams(location.search);
          for (const key of NON_FILTER_PARAMS) {
            const v = current.get(key);
            if (v != null) kept.set(key, v);
          }
          const qs = kept.toString();
          navigate(`${location.pathname}${qs ? `?${qs}` : ''}`);
        },
      });
    }
    list.push({
      id: 'copy-link',
      label: 'Copy link to this page',
      hint: 'Includes current filters',
      icon: Link2,
      run: () => { navigator.clipboard?.writeText(window.location.href); },
    });
    list.push({
      id: 'reload',
      label: 'Reload this page',
      hint: 'Refetch everything',
      icon: RefreshCw,
      run: () => { window.location.reload(); },
    });
    list.push({
      id: 'logout',
      label: 'Log out',
      hint: 'End this session',
      icon: LogOut,
      run: () => { logout(); },
    });
    return list;
  }, [clearableParams, location.pathname, location.search, navigate]);

  const q = useMemo(() => safeLower(query).trim(), [query]);

  // ── Record search (debounced) ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined;
    if (q.length < MIN_SEARCH_CHARS) { setRecords([]); setSearchError(''); setSearching(false); return undefined; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        setRecords(Array.isArray(data?.results) ? data.results : []);
        setSearchError('');
      } catch (e) {
        if (cancelled) return;
        // A failed search must not look like "no results" (contract rule 2).
        setRecords([]);
        setSearchError(e?.message || 'Search failed');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  // ── One flat, keyboard-addressable item list; sections are render-only ────
  const actionItems = useMemo(() => {
    const scored = [];
    for (const a of actions) {
      const score = fuzzyScore(a.label, q);
      if (score === null) continue;
      scored.push({ a, score });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored.map(({ a, score }) => ({
      kind: 'action',
      key: `action:${a.id}`,
      label: a.label,
      hint: a.hint,
      icon: a.icon,
      score,
      run: a.run,
    }));
  }, [actions, q]);

  const navMatches = useMemo(() => {
    const scored = [];
    for (const e of navEntries) {
      // Match the label first. Fall back to "Section Label" at a quarter of
      // the weight so "settings seo" or "crm contacts" still resolve without
      // outranking a direct label hit.
      const label = fuzzyScore(e.label, q);
      const qualified = fuzzyScore(`${e.section} ${e.label}`, q);
      const score = label !== null ? label : (qualified !== null ? qualified / 4 : null);
      if (score === null) continue;
      scored.push({ e, score });
    }
    scored.sort((x, y) => y.score - x.score);
    return scored;
  }, [navEntries, q]);

  const navItems = useMemo(() => navMatches.slice(0, MAX_NAV_RESULTS).map(({ e, score }) => ({
    kind: 'nav',
    key: `nav:${e.id}`,
    label: e.label,
    hint: `${e.section}${e.group ? ` → ${GROUP_LABELS[e.group] || e.group}` : ''}`,
    icon: e.icon,
    score,
    run: () => {
      if (e.external) window.open(e.href, '_blank', 'noopener,noreferrer');
      else if (e.newTab) window.open(e.to, '_blank', 'noopener,noreferrer');
      else navigate(e.to);
    },
  })), [navMatches, navigate]);

  const recordItems = useMemo(() => records.flatMap((r) => {
    const config = RESULT_TYPES[r.type];
    if (!config) return [];
    return [{
      kind: 'record',
      key: `record:${r.type}:${r.id}`,
      label: r.name,
      hint: [config.label, r.subtitle].filter(Boolean).join(' · '),
      icon: config.icon,
      run: () => navigate(productPath(config.to(r))),
    }];
  }), [records, navigate]);

  // Section order. Empty query = launcher, so destinations lead. With a query,
  // whichever of Go-to / Actions holds the stronger match leads, so typing
  // "log out" doesn't bury the action under a scattered nav subsequence hit.
  // Records stay pinned last: they arrive async and re-ordering on arrival
  // would shift the highlighted row out from under the user's Enter key.
  const sections = useMemo(() => {
    const nav = { kind: 'nav', title: 'Go to', rows: navItems };
    const act = { kind: 'action', title: 'Actions', rows: actionItems };
    const rec = { kind: 'record', title: 'Records', rows: recordItems };
    const navTop = navItems[0]?.score ?? -1;
    const actTop = actionItems[0]?.score ?? -1;
    const head = q && actTop > navTop ? [act, nav] : [nav, act];
    return [...head, rec];
  }, [navItems, actionItems, recordItems, q]);

  const items = useMemo(
    () => sections.flatMap((s) => s.rows),
    [sections],
  );

  // Keep activeIdx within bounds when the result set shrinks.
  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(0);
  }, [items.length, activeIdx]);

  // The list scrolls now that the 8-item cap is gone, so the highlighted row
  // has to be scrolled into view or arrow-keying past row ~9 goes invisible.
  useEffect(() => {
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, items.length]);

  function run(item) {
    if (!item) return;
    close();
    item.run();
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[activeIdx]);
    }
  }

  if (!open) return null;

  let cursor = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Search and commands"
    >
      <div
        className="w-[560px] max-w-[92vw] bg-primary-900 text-white border border-white/10 rounded-xl shadow-modal overflow-hidden animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10">
          <Search className="w-4 h-4 text-primary-300 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="Search contacts, deals, companies… or jump to a page"
            aria-label="Search records, jump to a page, or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={items[activeIdx] ? `command-palette-option-${activeIdx}` : undefined}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-primary-300/50"
          />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] bg-white/10 rounded border border-white/10 font-mono text-primary-300">ESC</kbd>
        </div>

        {/* Listbox pattern: the input keeps focus and drives the highlight via
            aria-activedescendant, so screen readers announce the active row
            without the rows themselves being tab stops. */}
        <ul
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[420px] overflow-y-auto py-1"
        >
          {sections.map((section) => {
            if (section.rows.length === 0 && section.kind !== 'record') return null;
            const isRecords = section.kind === 'record';
            if (isRecords && section.rows.length === 0 && !searching && !searchError && q.length < MIN_SEARCH_CHARS) return null;
            return (
              <React.Fragment key={section.kind}>
                <li role="presentation" className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-300/70">
                  {section.title}
                </li>
                {isRecords && searching && (
                  <li role="presentation" className="px-3 py-2 text-sm text-primary-300/70">Searching…</li>
                )}
                {isRecords && !searching && searchError && (
                  <li role="presentation" className="px-3 py-2 text-sm text-red-300">
                    Couldn’t search records — {searchError}
                  </li>
                )}
                {isRecords && !searching && !searchError && section.rows.length === 0 && q.length >= MIN_SEARCH_CHARS && (
                  <li role="presentation" className="px-3 py-2 text-sm text-primary-300/70">No records match “{query}”</li>
                )}
                {section.rows.map((item) => {
                  const idx = cursor++;
                  const Icon = item.icon || ArrowRight;
                  const active = idx === activeIdx;
                  return (
                    <li
                      key={item.key}
                      id={`command-palette-option-${idx}`}
                      role="option"
                      aria-selected={active}
                      data-active={active ? 'true' : 'false'}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => run(item)}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm ${active ? 'bg-white/10' : ''}`}
                    >
                      <Icon className="w-4 h-4 text-primary-300 flex-shrink-0" />
                      <span className="flex-1 truncate text-white">{item.label}</span>
                      {item.hint && (
                        <span className="text-xs text-primary-300/70 truncate ml-2 max-w-[45%]">{item.hint}</span>
                      )}
                      {active && <CornerDownLeft className="w-3.5 h-3.5 text-primary-300/70 flex-shrink-0" />}
                    </li>
                  );
                })}
              </React.Fragment>
            );
          })}

          {items.length === 0 && !searching && !searchError && (
            <li role="presentation" className="px-3 py-3 text-sm text-primary-300/70">No matches</li>
          )}

          {navMatches.length > MAX_NAV_RESULTS && (
            <li role="presentation" className="px-3 py-2 text-xs text-primary-300/70 border-t border-white/10">
              Showing {MAX_NAV_RESULTS} of {navMatches.length} destinations — keep typing to narrow.
            </li>
          )}
        </ul>

        <div className="flex items-center gap-3 px-3 py-2 border-t border-white/10 text-[10.5px] text-primary-300/70">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// Re-export for callers that want the label map.
export { GROUP_LABELS };
