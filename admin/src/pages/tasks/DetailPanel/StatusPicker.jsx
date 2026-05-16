// StatusPicker — small dropdown that shows the 4 board columns and lets the
// user reassign the task's status. Visual ground truth: prototype tasks/
// detail-panel.jsx StatusPicker.

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { COLUMNS } from '../lib/tokens.js';

export default function StatusPicker({ value, onChange }) {
  const cur = COLUMNS.find((c) => c.key === value) || COLUMNS[0];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="w-2 h-2 rounded-full" style={{ background: cur.dot }} />
        <span className="text-sm font-medium text-slate-800">{cur.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-30 py-1">
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => { setOpen(false); onChange(c.key); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 ${
                value === c.key ? 'bg-sky-50 font-semibold' : ''
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: c.dot }} />
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
