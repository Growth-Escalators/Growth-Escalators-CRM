// DensityMenu — kebab dropdown in the Tasks header for selecting card density.
//
// Three options: Compact / Default / Cozy. Calls onChange(value) on select.
// Closes on outside click or Escape. Anchored top-right below the kebab button.

import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Check } from 'lucide-react';

const OPTIONS = [
  { value: 'compact', label: 'Compact', hint: 'Dense rows' },
  { value: 'default', label: 'Default', hint: 'Balanced spacing' },
  { value: 'cozy',    label: 'Cozy',    hint: 'Roomy spacing' },
];

export default function DensityMenu({ value = 'default', onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(v) {
    onChange?.(v);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Board options"
        title="Board options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="text-slate-400 hover:text-slate-700 p-1.5 rounded-md hover:bg-slate-100"
      >
        <MoreVertical className="w-4 h-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Card density"
          className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg p-1 z-20"
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
            Density
          </div>
          {OPTIONS.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(opt.value)}
                className={`w-full flex items-center gap-2 rounded-md text-left text-xs px-2 py-2 transition-colors ${
                  active
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex-1">
                  <span className="font-medium block leading-tight">{opt.label}</span>
                  <span className="text-[10px] text-slate-400 leading-tight">{opt.hint}</span>
                </span>
                {active && <Check className="w-3.5 h-3.5 text-sky-600" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
