import React from 'react';
import { formatValue, formatDelta } from '../../lib/format.js';

// Tiny inline SVG sparkline (no axes, no tooltips — just a shape).
function Sparkline({ values, color = '#0ea5e9' }) {
  const data = Array.isArray(values) ? values.filter(v => Number.isFinite(Number(v))).map(Number) : [];
  if (data.length < 2) {
    return <div className="h-8" />;
  }
  const w = 120;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const poly = pts.join(' ');
  const area = `0,${h} ${poly} ${w},${h}`;
  const gradId = `spark-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradId})`} points={area} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={poly}
      />
    </svg>
  );
}

export default function KpiTile({
  label,
  value,
  valueFormat = 'number',
  delta = null,
  sparklineValues = [],
  sparklineColor,
  hint = null,
}) {
  const deltaText = formatDelta(delta);
  const isPositive = delta != null && delta >= 0;
  const deltaClass = deltaText
    ? isPositive
      ? 'text-emerald-600 bg-emerald-50 border-emerald-100'
      : 'text-rose-600 bg-rose-50 border-rose-100'
    : '';
  const sparkColor = sparklineColor || (isPositive ? '#10b981' : '#0ea5e9');

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3 min-h-[120px]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        {deltaText && (
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${deltaClass}`}>
            {deltaText}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 leading-tight">
          {formatValue(value, valueFormat)}
        </p>
        {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
      <div className="mt-auto">
        <Sparkline values={sparklineValues} color={sparkColor} />
      </div>
    </div>
  );
}
