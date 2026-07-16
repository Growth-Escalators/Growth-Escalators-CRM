import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { applyClientPipeline } from './filterPipeline.js';

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

const presetsKey = (pageId) => `wizmatch:presets:${pageId}`;
function readPresets(pageId) {
  try { return JSON.parse(localStorage.getItem(presetsKey(pageId)) || '[]'); } catch { return []; }
}

// Stable identity so a caller that omits `defaults` doesn't get a new object each
// render (which would thrash the memoized filters → refetch loop on server pages).
const NO_DEFAULTS = {};

export function useTableControls({ pageId, spec, columns, defaults = NO_DEFAULTS }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = {};
    for (const def of spec) {
      const raw = searchParams.get(def.key);
      out[def.key] = raw != null ? decodeValue(def, raw)
        : (defaults[def.key] != null ? defaults[def.key] : emptyValue(def));
    }
    return out;
  }, [searchParams, spec, defaults]);

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

  const mutate = useCallback((fn) => {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); fn(next); return next; }, { replace: true });
  }, [setSearchParams]);

  const setFilter = useCallback((key, value) => {
    const def = spec.find((d) => d.key === key);
    const enc = def ? encodeValue(def, value) : (value ? String(value) : null);
    mutate((p) => { if (enc == null) p.delete(key); else p.set(key, enc); p.set('page', '0'); });
  }, [spec, mutate]);

  const clearFilter = useCallback((key) => mutate((p) => { p.delete(key); p.set('page', '0'); }), [mutate]);

  const clearAll = useCallback(() => {
    mutate((p) => { for (const def of spec) p.delete(def.key); p.delete('page'); });
  }, [mutate, spec]);

  const setSort = useCallback((key) => {
    mutate((p) => {
      const [curKey, curDir] = (p.get('sort') || '').split(':');
      const dir = curKey === key && curDir === 'asc' ? 'desc' : 'asc';
      p.set('sort', `${key}:${dir}`);
      p.set('page', '0'); // server pages sort globally — jump to the first page
    });
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

  const setPage = useCallback((n) => mutate((p) => p.set('page', String(n))), [mutate]);

  const toQueryParams = useCallback((extra = {}) => {
    const qp = new URLSearchParams();
    for (const def of spec) if (isActive(def, filters[def.key])) serializeForServer(qp, def, filters[def.key]);
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

  // ── presets (localStorage) ──────────────────────────────────────────────────
  const presets = useMemo(() => readPresets(pageId), [pageId, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const savePreset = useCallback((name) => {
    const list = readPresets(pageId).filter((p) => p.name !== name);
    list.push({ name, query: searchParams.toString() });
    localStorage.setItem(presetsKey(pageId), JSON.stringify(list));
  }, [pageId, searchParams]);
  const applyPreset = useCallback((preset) => {
    setSearchParams(new URLSearchParams(preset.query), { replace: true });
  }, [setSearchParams]);
  const deletePreset = useCallback((name) => {
    localStorage.setItem(presetsKey(pageId), JSON.stringify(readPresets(pageId).filter((p) => p.name !== name)));
  }, [pageId]);

  return {
    filters, setFilter, clearFilter, clearAll,
    sort, setSort,
    hiddenColumns, toggleColumn, visibleColumns,
    page, setPage,
    toQueryParams, applyClient, activeChips,
    presets, savePreset, applyPreset, deletePreset,
  };
}
