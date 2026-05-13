import React, { useMemo, useState } from 'react';
import { formatNumber } from '../../lib/format.js';

// Vertical stacked-bar chart. Each bar (column) shows segments stacked from
// bottom to top in segment order.
//
// Props:
//   data: [{ label, segments: [{ name, value, color }] }]
export default function StackedBars({ data = [], height = 240 }) {
  const [hover, setHover] = useState(null); // { col, seg } | null

  const { columns, totals, max, legend } = useMemo(() => {
    const cols = (data || []).map(d => ({
      label: d?.label || '',
      segments: Array.isArray(d?.segments) ? d.segments.map(s => ({
        name: s?.name || 'Unknown',
        value: Math.max(0, Number(s?.value) || 0),
        color: s?.color || '#94a3b8',
      })) : [],
    }));
    const tot = cols.map(c => c.segments.reduce((acc, s) => acc + s.value, 0));
    const mx = Math.max(...tot, 1);

    // Build a unique-by-name legend that takes the first colour seen for each name.
    const seen = new Map();
    cols.forEach(c => c.segments.forEach(s => {
      if (!seen.has(s.name)) seen.set(s.name, s.color);
    }));
    const lg = Array.from(seen.entries()).map(([name, color]) => ({ name, color }));

    return { columns: cols, totals: tot, max: mx, legend: lg };
  }, [data]);

  if (columns.length === 0) {
    return (
      <div
        className="bg-white rounded-xl border border-slate-200 flex items-center justify-center"
        style={{ height }}
      >
        <p className="text-sm text-slate-400">No data</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="relative" style={{ height }}>
        <div className="flex items-end gap-2 h-full">
          {columns.map((col, ci) => {
            const total = totals[ci];
            const colHeightPct = (total / max) * 100;
            return (
              <div key={ci} className="flex-1 flex flex-col items-center h-full justify-end">
                <div
                  className="w-full bg-slate-50 rounded-t flex flex-col-reverse overflow-hidden"
                  style={{ height: `${Math.max(colHeightPct, 1)}%` }}
                >
                  {col.segments.map((seg, si) => {
                    const segPct = total > 0 ? (seg.value / total) * 100 : 0;
                    const isHover = hover && hover.col === ci && hover.seg === si;
                    return (
                      <div
                        key={si}
                        onMouseEnter={() => setHover({ col: ci, seg: si })}
                        onMouseLeave={() => setHover(null)}
                        className="w-full transition-opacity cursor-pointer"
                        style={{
                          height: `${segPct}%`,
                          backgroundColor: seg.color,
                          opacity: hover && !isHover ? 0.55 : 1,
                        }}
                        title={`${seg.name}: ${formatNumber(seg.value)}`}
                      />
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 truncate w-full text-center">
                  {col.label}
                </span>
              </div>
            );
          })}
        </div>

        {hover && columns[hover.col]?.segments[hover.seg] && (
          <div className="absolute top-2 right-2 bg-slate-900 text-white text-xs rounded-md px-2 py-1 shadow-lg">
            <div className="text-slate-300">{columns[hover.col].label}</div>
            <div className="font-semibold">
              {columns[hover.col].segments[hover.seg].name}: {formatNumber(columns[hover.col].segments[hover.seg].value)}
            </div>
          </div>
        )}
      </div>

      {legend.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-slate-100">
          {legend.map(l => (
            <div key={l.name} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: l.color }} />
              <span className="capitalize">{l.name.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
