import { useEffect, useRef, useState } from 'react';
import { X, SlidersHorizontal, Columns3, Download, Bookmark, Filter, Users, Lock } from 'lucide-react';

// Declarative filter toolbar for the Wizmatch filter/table system. Renders the
// `spec` as controls, an active-filter chip row (remove per chip + Clear all),
// and a Presets / Columns / Export toolbar. State lives in useTableControls; this
// component is presentational and reused by every page.

// How many controls stay visible before the rest fold into "More filters".
// Requirements declares 17 filters; rendered flat they wrapped to 3–4 rows and
// pushed the table below the fold before any data had loaded. The active-filter
// chip row below already tells you what is applied, so hiding controls costs
// nothing. A page can override placement explicitly with `primary: true` /
// `advanced: true` on a filter def.
const PRIMARY_LIMIT = 5;
const FOLD_THRESHOLD = 7;

function splitSpec(spec) {
  const explicit = spec.some((d) => d.primary || d.advanced);
  if (explicit) {
    return {
      primary: spec.filter((d) => d.primary || !d.advanced),
      advanced: spec.filter((d) => d.advanced && !d.primary),
    };
  }
  if (spec.length < FOLD_THRESHOLD) return { primary: spec, advanced: [] };
  return { primary: spec.slice(0, PRIMARY_LIMIT), advanced: spec.slice(PRIMARY_LIMIT) };
}

// Text/number inputs keep their own state and only push upstream after the user
// stops typing. Previously every keystroke called setFilter -> setSearchParams
// -> refetch, so typing "react" into Candidates issued 5 requests and blanked
// the table 5 times. 300ms matches the debounce GlobalSearch already uses.
const DEBOUNCE_MS = 300;

function DebouncedInput({ value, onCommit, ...props }) {
  const [local, setLocal] = useState(value ?? '');
  const timer = useRef(null);
  const latestCommit = useRef(onCommit);
  latestCommit.current = onCommit;

  // Resync when the value changes from OUTSIDE (Clear all, applying a preset,
  // back/forward). Skipped while the user is mid-edit — the local value is
  // authoritative until it has been committed.
  useEffect(() => {
    if (timer.current) return;
    setLocal(value ?? '');
  }, [value]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (v) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      latestCommit.current(v);
    }, DEBOUNCE_MS);
  };

  const flush = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    latestCommit.current(local);
  };

  return (
    <input
      {...props}
      value={local}
      onChange={(e) => onChange(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => { if (e.key === 'Enter') flush(); }}
    />
  );
}

function MultiSelect({ def, value, onChange }) {
  const count = value.length;
  const options = def.options || [];
  const [query, setQuery] = useState('');
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const shown = query
    ? options.filter((o) => String(o.label).toLowerCase().includes(query.toLowerCase()))
    : options;
  return (
    <details className="relative">
      <summary className="input w-auto cursor-pointer list-none inline-flex items-center gap-1 select-none">
        {def.label}{count ? ` (${count})` : ''}
      </summary>
      <div className="absolute z-30 mt-1 bg-white border border-neutral-200 rounded-md shadow-modal p-2 min-w-[200px] max-h-64 overflow-auto">
        {options.length > 6 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${def.label.toLowerCase()}…`}
            aria-label={`Filter ${def.label} options`}
            className="input w-full text-[12px] mb-1.5"
          />
        )}
        {shown.length === 0 && <p className="text-[11.5px] text-neutral-500 px-1 py-1">No matching options</p>}
        {shown.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[12.5px] py-0.5 cursor-pointer hover:bg-neutral-50 rounded px-1">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        {count > 0 && (
          <button type="button" onClick={() => onChange([])} aria-label={`Clear ${def.label}`} className="mt-1 text-[11px] text-neutral-500 hover:text-neutral-700">Clear</button>
        )}
      </div>
    </details>
  );
}

function FilterControl({ def, value, setFilter }) {
  const onChange = (v) => setFilter(def.key, v);
  switch (def.type) {
    case 'search':
      return <DebouncedInput type="text" placeholder={def.placeholder || `${def.label}…`} value={value} onCommit={onChange} className="input w-48" aria-label={def.label} />;
    case 'select':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="input w-auto" aria-label={def.label}>
          <option value="">{def.placeholder || `Any ${def.label}`}</option>
          {(def.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'multiselect':
      return <MultiSelect def={def} value={value} onChange={onChange} />;
    case 'numberRange':
      return (
        <span className="inline-flex items-center gap-1" title={def.label}>
          <DebouncedInput type="number" placeholder={`${def.label} min`} value={value.min} onCommit={(v) => onChange({ ...value, min: v })} className="input w-24" aria-label={`${def.label} min`} />
          <span className="text-neutral-500">–</span>
          <DebouncedInput type="number" placeholder="max" value={value.max} onCommit={(v) => onChange({ ...value, max: v })} className="input w-20" aria-label={`${def.label} max`} />
        </span>
      );
    case 'dateRange':
      return (
        <span className="inline-flex items-center gap-1" title={def.label}>
          <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="input w-auto" aria-label={`${def.label} from`} />
          <span className="text-neutral-500">→</span>
          <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className="input w-auto" aria-label={`${def.label} to`} />
        </span>
      );
    case 'toggle':
      return (
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-neutral-700 cursor-pointer">
          <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {def.label}
        </label>
      );
    default:
      return null;
  }
}

export default function FilterBar({
  spec, filters, setFilter, activeChips, clearFilter, clearAll,
  columns, hiddenColumns, toggleColumn,
  onExport, presets, savePreset, applyPreset, deletePreset, setPresetShared, presetsError,
  rightSlot,
}) {
  const [presetName, setPresetName] = useState('');
  const [shareNew, setShareNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const { primary, advanced } = splitSpec(spec);
  const advancedActiveCount = advanced.filter((d) => activeChips.some((c) => c.key === d.key)).length;

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
        </span>
        {primary.map((def) => <FilterControl key={def.key} def={def} value={filters[def.key]} setFilter={setFilter} />)}

        {advanced.length > 0 && (
          <details className="relative">
            <summary className="btn-standard btn-compact cursor-pointer list-none inline-flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" />
              More filters{advancedActiveCount ? ` (${advancedActiveCount})` : ` (${advanced.length})`}
            </summary>
            <div className="absolute z-30 mt-1 bg-white border border-neutral-200 rounded-md shadow-modal p-3 min-w-[320px] max-w-[520px] max-h-[70vh] overflow-auto">
              <div className="flex flex-wrap items-center gap-2">
                {advanced.map((def) => <FilterControl key={def.key} def={def} value={filters[def.key]} setFilter={setFilter} />)}
              </div>
            </div>
          </details>
        )}

        <div className="ml-auto flex items-center gap-2">
          {columns && toggleColumn && (
            <details className="relative">
              <summary className="btn-standard btn-compact cursor-pointer list-none inline-flex items-center gap-1"><Columns3 className="w-3.5 h-3.5" /> Columns</summary>
              <div className="absolute right-0 z-30 mt-1 bg-white border border-neutral-200 rounded-md shadow-modal p-2 min-w-[180px] max-h-64 overflow-auto">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-[12.5px] py-0.5 cursor-pointer hover:bg-neutral-50 rounded px-1">
                    <input type="checkbox" checked={!hiddenColumns.has(c.key)} onChange={() => toggleColumn(c.key)} /> {c.label}
                  </label>
                ))}
              </div>
            </details>
          )}
          {presets && (
            <details className="relative">
              <summary className="btn-standard btn-compact cursor-pointer list-none inline-flex items-center gap-1"><Bookmark className="w-3.5 h-3.5" /> Views</summary>
              <div className="absolute right-0 z-30 mt-1 bg-white border border-neutral-200 rounded-md shadow-modal p-2 min-w-[280px]">
                {presetsError && (
                  <p role="alert" className="text-[11.5px] text-danger-700 bg-danger-500/10 border border-danger-500/20 rounded px-1.5 py-1 mb-1.5">
                    {presetsError}. Showing the last list loaded on this device.
                  </p>
                )}
                {presets.length === 0 && !presetsError && <p className="text-[11.5px] text-neutral-500 px-1 pb-1">No saved views yet</p>}
                {presets.map((p) => (
                  <div key={p.id || p.name} className="flex items-center justify-between gap-2 text-[12.5px] py-0.5 px-1 hover:bg-neutral-50 rounded">
                    <button type="button" onClick={() => applyPreset(p)} className="flex-1 text-left truncate">
                      {p.name}
                      {/* A shared view made by someone else is labelled with its
                          owner — otherwise a teammate's view is indistinguishable
                          from your own and deleting it looks like a bug. */}
                      {p.isShared && !p.isOwner && p.ownerName && (
                        <span className="text-neutral-500"> — {p.ownerName}</span>
                      )}
                    </button>
                    {p.isOwner ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPresetShared?.(p, !p.isShared)}
                          aria-label={p.isShared ? `Make ${p.name} private` : `Share ${p.name} with the team`}
                          title={p.isShared ? 'Shared with the team — click to make private' : 'Private to you — click to share'}
                          className={`shrink-0 rounded px-1 ${p.isShared ? 'text-primary-700' : 'text-neutral-500 hover:text-neutral-700'}`}
                        >
                          {p.isShared ? <Users className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        </button>
                        <button type="button" onClick={() => deletePreset(p)} aria-label={`Delete view ${p.name}`} className="shrink-0 text-neutral-500 hover:text-danger-600"><X className="w-3.5 h-3.5" /></button>
                      </>
                    ) : (
                      // Someone else's shared view: usable, not editable. No
                      // delete button rather than a button that 403s.
                      <Users className="w-3.5 h-3.5 shrink-0 text-neutral-400" aria-label="Shared by a teammate" />
                    )}
                  </div>
                ))}
                <div className="mt-2 border-t border-neutral-100 pt-2 space-y-1.5">
                  <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current view as…" aria-label="Name for the saved view" className="input w-full text-[12px]" />
                  <label className="flex items-center gap-1.5 text-[11.5px] text-neutral-600 px-0.5 cursor-pointer">
                    <input type="checkbox" checked={shareNew} onChange={(e) => setShareNew(e.target.checked)} />
                    Share with the team
                  </label>
                  <button
                    type="button"
                    disabled={!presetName.trim() || saving}
                    onClick={async () => {
                      setSaving(true);
                      try { await savePreset(presetName.trim(), { isShared: shareNew }); setPresetName(''); setShareNew(false); }
                      finally { setSaving(false); }
                    }}
                    className="btn-standard btn-compact w-full disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save view'}
                  </button>
                </div>
              </div>
            </details>
          )}
          {onExport && (
            <button type="button" onClick={onExport} className="btn-standard btn-compact inline-flex items-center gap-1"><Download className="w-3.5 h-3.5" /> CSV</button>
          )}
          {rightSlot}
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-1 bg-primary-500/10 text-primary-700 border border-primary-500/20 rounded-full px-2 py-0.5 text-[11.5px]">
              {chip.label}
              <button type="button" onClick={() => clearFilter(chip.key)} aria-label={`Remove ${chip.label}`} className="hover:text-primary-900"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <button type="button" onClick={clearAll} className="text-[11.5px] text-neutral-500 hover:text-neutral-700 underline ml-1">Clear all</button>
        </div>
      )}
    </div>
  );
}
