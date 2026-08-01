import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { applyClientPipeline } from './filterPipeline.js';
import { apiFetch } from '../../../lib/api.js';

// One hook that owns a page's filter/sort/column/page state and keeps it in the
// URL query string, so a filtered view is shareable + survives refresh. Also
// manages saved presets (localStorage) and produces either backend query params
// (server-paginated pages) or a client filter+sort pipeline (fully-loaded pages).
//
// spec = the same declarative filter defs FilterBar renders. Each def:
//   { key, label, type, options?, fields?, accessor?, predicate?,
//     serverKey?, serverMinKey?, serverMaxKey?, serverFromKey?, serverToKey? }
// columns = [{ key, label, sortable?, sortAccessor?, defaultHidden? }, ...]

// ── value <-> URL encoding (keyed by def.key, human-readable + shareable) ──────
function emptyValue(def) {
  switch (def.type) {
    case 'multiselect': return [];
    case 'numberRange': return { min: '', max: '' };
    case 'dateRange': return { from: '', to: '' };
    case 'toggle': return false;
    default: return '';
  }
}
function encodeValue(def, v) {
  if (v == null) return null;
  switch (def.type) {
    case 'multiselect': return v.length ? v.join(',') : null;
    case 'numberRange': return (v.min || v.max) ? `${v.min ?? ''}..${v.max ?? ''}` : null;
    case 'dateRange': return (v.from || v.to) ? `${v.from ?? ''}..${v.to ?? ''}` : null;
    case 'toggle': return v ? '1' : null;
    default: return v === '' ? null : String(v);
  }
}
function decodeValue(def, raw) {
  switch (def.type) {
    case 'multiselect': return raw ? raw.split(',').filter(Boolean) : [];
    case 'numberRange': { const [min, max] = raw.split('..'); return { min: min || '', max: max || '' }; }
    case 'dateRange': { const [from, to] = raw.split('..'); return { from: from || '', to: to || '' }; }
    case 'toggle': return raw === '1';
    default: return raw;
  }
}

// ── value -> backend query params (uses each def's serverKey mapping) ──────────
function serializeForServer(qp, def, v) {
  switch (def.type) {
    case 'numberRange':
      if (v.min !== '' && v.min != null) qp.set(def.serverMinKey || `${def.key}_min`, String(v.min));
      if (v.max !== '' && v.max != null) qp.set(def.serverMaxKey || `${def.key}_max`, String(v.max));
      return;
    case 'dateRange':
      if (v.from) qp.set(def.serverFromKey || `${def.key}_from`, v.from);
      if (v.to) qp.set(def.serverToKey || `${def.key}_to`, v.to);
      return;
    case 'multiselect':
      if (v.length) qp.set(def.serverKey || def.key, v.join(','));
      return;
    case 'toggle':
      if (v) qp.set(def.serverKey || def.key, '1');
      return;
    default:
      if (v !== '' && v != null) qp.set(def.serverKey || def.key, String(v));
  }
}

function chipLabel(def, v) {
  switch (def.type) {
    case 'multiselect': return `${def.label}: ${v.join(', ')}`;
    case 'numberRange': return `${def.label}: ${v.min || '−∞'}–${v.max || '∞'}`;
    case 'dateRange': return `${def.label}: ${v.from || '…'} → ${v.to || '…'}`;
    case 'toggle': return def.label;
    case 'select': {
      const opt = (def.options || []).find((o) => String(o.value) === String(v));
      return `${def.label}: ${opt ? opt.label : v}`;
    }
    default: return `${def.label}: ${v}`;
  }
}

function isActive(def, v) {
  if (v == null) return false;
  if (def.type === 'toggle') return v === true;
  if (def.type === 'multiselect') return v.length > 0;
  if (def.type === 'numberRange') return Boolean(v.min || v.max);
  if (def.type === 'dateRange') return Boolean(v.from || v.to);
  return v !== '';
}

// ── saved views ─────────────────────────────────────────────────────────────
// Views live in the database (GET/POST/PATCH/DELETE /api/saved-views) so they
// are tenant-scoped and can be shared with the team. They used to live in
// localStorage, which meant a view died with the browser that made it and
// "Hot ATS leads" meant something different to every person who built it.
//
// localStorage is kept ONLY as a read-through fallback for when the API is
// unreachable: losing your saved views because a request failed would be worse
// than showing a slightly stale list. Every successful fetch refreshes the
// cache, so the fallback is never far behind.
const presetsKey = (pageId) => `wizmatch:presets:${pageId}`;

function readCachedPresets(pageId) {
  try { return JSON.parse(localStorage.getItem(presetsKey(pageId)) || '[]'); } catch { return []; }
}
function writeCachedPresets(pageId, list) {
  try { localStorage.setItem(presetsKey(pageId), JSON.stringify(list)); } catch { /* quota / private mode */ }
}

// Stable identity so a caller that omits `defaults` doesn't get a new object each
// render (which would thrash the memoized filters → refetch loop on server pages).
const NO_DEFAULTS = {};

export function useTableControls({ pageId, spec, columns, defaults = NO_DEFAULTS }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Three states, not two — this is the whole reason a default filter can be
  // cleared at all:
  //   param ABSENT  -> the page's default applies (e.g. Requirements opens on
  //                    region=india)
  //   param EMPTY   -> the user explicitly cleared it; the default must NOT
  //                    come back
  //   param SET     -> that value
  //
  // Previously "cleared" and "absent" were the same thing, so on Requirements
  // choosing "Any region", clearing the chip, and "Clear all" all deleted the
  // param — and the memo below immediately reapplied `india`. India and US were
  // reachable; "any region" was not, by any route through the UI.
  const filters = useMemo(() => {
    const out = {};
    for (const def of spec) {
      const raw = searchParams.get(def.key);
      out[def.key] = raw != null ? decodeValue(def, raw)
        : (defaults[def.key] != null ? defaults[def.key] : emptyValue(def));
    }
    return out;
  }, [searchParams, spec, defaults]);

  // Clearing a filter that HAS a default must write an explicit empty param
  // rather than deleting the key, or the default silently returns.
  const clearKey = useCallback((p, key) => {
    if (defaults[key] != null) p.set(key, '');
    else p.delete(key);
  }, [defaults]);

  const sort = useMemo(() => {
    const raw = searchParams.get('sort');
    if (raw) { const [key, dir] = raw.split(':'); return { key, dir: dir || 'asc' }; }
    return defaults.sort || { key: null, dir: 'asc' };
  }, [searchParams, defaults.sort]);

  const hiddenColumns = useMemo(() => {
    const raw = searchParams.get('hide');
    if (raw != null) return new Set(raw.split(',').filter(Boolean));
    return new Set((columns || []).filter((c) => c.defaultHidden).map((c) => c.key));
  }, [searchParams, columns]);

  const page = Number(searchParams.get('page') || 0);

  // `push` decides whether this change becomes a browser history entry.
  //
  // Filters, sort and paging PUSH: Back then means "undo my last filter", which
  // is what every user expects. Previously everything replaced, so Back from a
  // filtered list exited the page entirely and lost the whole view.
  //
  // Column visibility REPLACES: showing/hiding a column is a display preference,
  // not a navigation step, and pushing it would bury the real filter history
  // under a pile of column toggles.
  const mutate = useCallback((fn, { push = false } = {}) => {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); fn(next); return next; }, { replace: !push });
  }, [setSearchParams]);

  const setFilter = useCallback((key, value) => {
    const def = spec.find((d) => d.key === key);
    const enc = def ? encodeValue(def, value) : (value ? String(value) : null);
    mutate((p) => { if (enc == null) clearKey(p, key); else p.set(key, enc); p.set('page', '0'); }, { push: true });
  }, [spec, mutate, clearKey]);

  const clearFilter = useCallback((key) => mutate((p) => { clearKey(p, key); p.set('page', '0'); }, { push: true }), [mutate, clearKey]);

  const clearAll = useCallback(() => {
    mutate((p) => { for (const def of spec) clearKey(p, def.key); p.delete('page'); }, { push: true });
  }, [mutate, spec, clearKey]);

  const setSort = useCallback((key) => {
    mutate((p) => {
      const [curKey, curDir] = (p.get('sort') || '').split(':');
      const dir = curKey === key && curDir === 'asc' ? 'desc' : 'asc';
      p.set('sort', `${key}:${dir}`);
      p.set('page', '0'); // server pages sort globally — jump to the first page
    }, { push: true });
  }, [mutate]);

  const toggleColumn = useCallback((key) => {
    mutate((p) => {
      const base = p.get('hide') != null
        ? p.get('hide').split(',').filter(Boolean)
        : (columns || []).filter((c) => c.defaultHidden).map((c) => c.key);
      const set = new Set(base);
      if (set.has(key)) set.delete(key); else set.add(key);
      if (set.size) p.set('hide', [...set].join(',')); else p.set('hide', '');
    });
  }, [mutate, columns]);

  const setPage = useCallback((n) => mutate((p) => p.set('page', String(n)), { push: true }), [mutate]);

  const toQueryParams = useCallback((extra = {}) => {
    const qp = new URLSearchParams();
    for (const def of spec) {
      // A def with no `serverKey` still emits `?<def.key>=<value>`, which a route
      // that expects a different param name ignores WITHOUT erroring — so the
      // filter silently stops working and the list quietly returns everything.
      // (Real case: the staffing routes read `search`, not `q`.) A serverOnly def
      // has no client-side fallback, so that silence is total. Fail loudly in dev.
      if (import.meta.env.DEV && def.serverOnly && !def.serverKey) {
        throw new Error(
          `Filter "${def.key}" is marked serverOnly but has no serverKey, so it would be sent as ` +
          `"${def.key}" and silently ignored by a route expecting a different name. Add serverKey.`,
        );
      }
      if (isActive(def, filters[def.key])) serializeForServer(qp, def, filters[def.key]);
    }
    if (sort.key) qp.set('sort', `${sort.key}:${sort.dir}`);
    for (const [k, v] of Object.entries(extra)) if (v != null) qp.set(k, String(v));
    return qp;
  }, [spec, filters, sort]);

  const applyClient = useCallback((rows) => applyClientPipeline(rows, spec, filters, sort, columns), [spec, filters, sort, columns]);

  const activeChips = useMemo(() =>
    spec.filter((def) => isActive(def, filters[def.key]))
      .map((def) => ({ key: def.key, label: chipLabel(def, filters[def.key]) })),
    [spec, filters]);

  const visibleColumns = useMemo(() => (columns || []).filter((c) => !hiddenColumns.has(c.key)), [columns, hiddenColumns]);

  // ── presets (localStorage, mirrored in React state) ─────────────────────────
  // The list is held in state, not derived with useMemo. It used to be
  // `useMemo(() => readPresets(pageId), [pageId, searchParams])` while
  // savePreset wrote only to localStorage — so saving changed no state and no
  // search param, no re-render happened, and the panel kept saying "No saved
  // presets" until an unrelated filter was touched. The feature worked; it just
  // never redrew, which made it look broken.
  const [presets, setPresets] = useState(() => readCachedPresets(pageId));
  const [presetsError, setPresetsError] = useState(null);

  const refreshPresets = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/saved-views?pageId=${encodeURIComponent(pageId)}`);
      const list = data.items || [];
      setPresets(list);
      writeCachedPresets(pageId, list);
      setPresetsError(null);
    } catch (e) {
      // Keep whatever is on screen (cache or previous fetch) and say so, rather
      // than blanking the list — an empty panel reads as "you have no views".
      setPresetsError(e.message || 'Could not load saved views');
    }
  }, [pageId]);

  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  const savePreset = useCallback(async (name, { isShared = false } = {}) => {
    // POST upserts on (tenant, owner, pageId, name), so saving twice under the
    // same name updates your view instead of creating a duplicate.
    await apiFetch('/api/saved-views', {
      method: 'POST',
      body: JSON.stringify({ pageId, name, query: searchParams.toString(), isShared }),
    });
    await refreshPresets();
  }, [pageId, searchParams, refreshPresets]);

  const applyPreset = useCallback((preset) => {
    setSearchParams(new URLSearchParams(preset.query), { replace: false });
  }, [setSearchParams]);

  const deletePreset = useCallback(async (preset) => {
    // Takes the view object, not a name: names are only unique per owner, so a
    // name is not enough to identify a shared view from someone else.
    await apiFetch(`/api/saved-views/${preset.id}`, { method: 'DELETE' });
    await refreshPresets();
  }, [refreshPresets]);

  const setPresetShared = useCallback(async (preset, isShared) => {
    await apiFetch(`/api/saved-views/${preset.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isShared }),
    });
    await refreshPresets();
  }, [refreshPresets]);

  return {
    filters, setFilter, clearFilter, clearAll,
    sort, setSort,
    hiddenColumns, toggleColumn, visibleColumns,
    page, setPage,
    toQueryParams, applyClient, activeChips,
    presets, savePreset, applyPreset, deletePreset, setPresetShared, presetsError,
  };
}
