import React from 'react';

const COLOUR_MAP = {
  sky:     'bg-sky-50 text-sky-700 border-sky-100',
  slate:   'bg-slate-50 text-slate-700 border-slate-200',
  violet:  'bg-violet-50 text-violet-700 border-violet-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber:   'bg-amber-50 text-amber-700 border-amber-100',
  rose:    'bg-rose-50 text-rose-700 border-rose-100',
};

// Shared stat tile used by /outbound and /funnels. Keep visual identity
// consistent across analytics surfaces.
export default function StatCard({ label, value, icon: Icon, colour = 'slate', subtext }) {
  const cls = COLOUR_MAP[colour] || COLOUR_MAP.slate;
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-80">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <p className="text-2xl font-bold mt-1">{value ?? 0}</p>
      {subtext && <p className="text-xs opacity-70 mt-0.5">{subtext}</p>}
    </div>
  );
}
