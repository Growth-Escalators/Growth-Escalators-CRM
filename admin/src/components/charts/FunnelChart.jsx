import React from 'react';
import { formatNumber } from '../../lib/format.js';

const BAR_COLORS = [
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f59e0b', // amber
];

// Horizontal funnel: each stage rendered as a bar whose width is proportional
// to its count relative to the first stage. Each stage past the first shows
// the conversion-rate-from-previous-stage label.
export default function FunnelChart({ stages = [] }) {
  if (!stages || stages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
        <p className="text-sm text-slate-400">No funnel data</p>
      </div>
    );
  }

  const top = Math.max(...stages.map(s => Number(s.count) || 0), 1);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      {stages.map((stage, i) => {
        const count = Number(stage.count) || 0;
        const widthPct = Math.max((count / top) * 100, 2);
        const prev = i > 0 ? Number(stages[i - 1].count) || 0 : null;
        const conv = stage.conversionRate != null
          ? Number(stage.conversionRate)
          : (prev != null && prev > 0 ? Math.round((count / prev) * 100) : null);
        const color = BAR_COLORS[i % BAR_COLORS.length];

        return (
          <div key={stage.name || i} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-slate-700">{stage.name}</span>
              <span className="text-slate-500">
                <span className="font-semibold text-slate-800">{formatNumber(count)}</span>
                {conv != null && i > 0 && (
                  <span className="ml-2 text-emerald-600 font-medium">{conv}%</span>
                )}
              </span>
            </div>
            <div className="h-7 bg-slate-50 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all duration-500 flex items-center justify-end pr-2"
                style={{ width: `${widthPct}%`, backgroundColor: color }}
                title={`${stage.name}: ${formatNumber(count)}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
