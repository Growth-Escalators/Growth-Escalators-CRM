import { useState } from 'react';
import { X, SlidersHorizontal, Columns3, Download, Bookmark } from 'lucide-react';

// Declarative filter toolbar for the Wizmatch filter/table system. Renders the
// `spec` as controls, an active-filter chip row (remove per chip + Clear all),
// and a Presets / Columns / Export toolbar. State lives in useTableControls; this
// component is presentational and reused by every page.

function MultiSelect({ def, value, onChange }) {
  const count = value.length;
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <details className="relative">
      <summary className="input w-auto cursor-pointer list-none inline-flex items-center gap-1 select-none">
        {def.label}{count ? ` (${count})` : ''}
      </summary>
      <div className="absolute z-30 mt-1 bg-white border border-neutral-200 rounded-md shadow-modal p-2 min-w-[180px] max-h-64 overflow-auto">
        {(def.options || []).map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[12.5px] py-0.5 cursor-pointer hover:bg-neutral-50 rounded px-1">
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        {count > 0 && (
          <button type="button" onClick={() => onChange([])} className="mt-1 text-[11px] text-neutral-500 hover:text-neutral-700">Clear</button>
        )}
      </div>
    </details>
  );
}

function FilterControl({ def, value, setFilter }) {
  const onChange = (v) => setFilter(def.key, v);
  switch (def.type) {
    case 'search':
      return <input type="text" placeholder={def.placeholder || `${def.label}…`} value={value} onChange={(e) => onChange(e.target.value)} className="input w-48" aria-label={def.label} />;
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
          <input type="number" placeholder={`${def.label} min`} value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} className="input w-24" aria-label={`${def.label} min`} />
          <span className="text-neutral-400">–</span>
          <input type="number" placeholder="max" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} className="input w-20" aria-label={`${def.label} max`} />
        </span>
      );
    case 'dateRange':
      return (
        <span className="inline-flex items-center gap-1" title={def.label}>
          <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="input w-auto" aria-label={`${def.label} from`} />
          <span className="text-neutral-400">→</span>
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
  onExport, presets, savePreset, applyPreset, deletePreset,
  rightSlot,
}) {
  const [presetName, setPresetName] = useState('');

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
        </span>
        {spec.map((def) => <FilterControl key={def.key} def={def} value={filters[def.key]} setFilter={setFilter} />)}

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
              <summary className="btn-standard btn-compact cursor-pointer list-none inline-flex items-center gap-1"><Bookmark className="w-3.5 h-3.5" /> Presets</summary>
              <div className="absolute right-0 z-30 mt-1 bg-white border border-neutral-200 rounded-md shadow-modal p-2 min-w-[220px]">
                {presets.length === 0 && <p className="text-[11.5px] text-neutral-400 px-1 pb-1">No saved presets</p>}
                {presets.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-2 text-[12.5px] py-0.5 px-1 hover:bg-neutral-50 rounded">
                    <button type="button" onClick={() => applyPreset(p)} className="flex-1 text-left truncate">{p.name}</button>
                    <button type="button" onClick={() => deletePreset(p.name)} aria-label={`Delete preset ${p.name}`} className="text-neutral-400 hover:text-danger-600"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <div className="mt-2 flex items-center gap-1 border-t border-neutral-100 pt-2">
                  <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current as…" className="input w-full text-[12px]" />
                  <button type="button" disabled={!presetName.trim()} onClick={() => { savePreset(presetName.trim()); setPresetName(''); }} className="btn-standard btn-compact disabled:opacity-50">Save</button>
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
