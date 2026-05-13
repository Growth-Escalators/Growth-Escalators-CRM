import React, { useMemo, useState } from 'react';
import { formatValue } from '../../lib/format.js';

// Single-series line/area chart, plain SVG. Y axis (left), X axis (bottom),
// gridlines, and tooltip on hover.
export default function LineChart({
  data = [],
  height = 240,
  color = '#0ea5e9',
  valueFormat = 'number',
}) {
  const series = useMemo(() => {
    return (data || [])
      .map(d => ({
        date: d?.date ?? d?.day ?? d?.month ?? '',
        value: Number(d?.value ?? d?.amount ?? d?.mrr ?? 0),
      }))
      .filter(d => Number.isFinite(d.value));
  }, [data]);

  const [hover, setHover] = useState(null); // index | null

  if (series.length < 2) {
    return (
      <div
        className="bg-white rounded-xl border border-slate-200 flex items-center justify-center"
        style={{ height }}
      >
        <p className="text-sm text-slate-400">Not enough data to plot</p>
      </div>
    );
  }

  // Layout
  const W = 800; // viewBox width — chart will scale via preserveAspectRatio
  const H = height;
  const padding = { top: 16, right: 16, bottom: 32, left: 56 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;

  const min = Math.min(...series.map(d => d.value));
  const max = Math.max(...series.map(d => d.value));
  const valueMin = Math.min(0, min);
  const valueMax = max === valueMin ? valueMin + 1 : max;
  const range = valueMax - valueMin;

  const xFor = i => padding.left + (i / (series.length - 1)) * innerW;
  const yFor = v => padding.top + innerH - ((v - valueMin) / range) * innerH;

  const linePts = series.map((d, i) => `${xFor(i).toFixed(1)},${yFor(d.value).toFixed(1)}`).join(' ');
  const areaPts = `${padding.left},${padding.top + innerH} ${linePts} ${padding.left + innerW},${padding.top + innerH}`;

  // Y axis ticks (5 evenly spaced)
  const yTicks = [];
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const v = valueMin + (range * i) / tickCount;
    yTicks.push({ v, y: yFor(v) });
  }

  // X axis ticks (up to 6 evenly spaced labels)
  const xTickCount = Math.min(series.length, 6);
  const xTicks = [];
  for (let i = 0; i < xTickCount; i++) {
    const idx = Math.round((i / Math.max(xTickCount - 1, 1)) * (series.length - 1));
    xTicks.push({ idx, x: xFor(idx), label: series[idx].date });
  }

  const gradId = `line-grad-${color.replace('#', '')}`;

  // Hover handling: map mouse x to nearest data index
  const handleMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const inner = svgX - padding.left;
    if (inner < 0 || inner > innerW) {
      setHover(null);
      return;
    }
    const i = Math.round((inner / innerW) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };

  const point = hover != null ? series[hover] : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines + Y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              x2={padding.left + innerW}
              y1={t.y}
              y2={t.y}
              stroke="#e2e8f0"
              strokeWidth="1"
              strokeDasharray="2,3"
            />
            <text
              x={padding.left - 8}
              y={t.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill="#64748b"
            >
              {formatValue(t.v, valueFormat)}
            </text>
          </g>
        ))}

        {/* Area + line */}
        <polygon fill={`url(#${gradId})`} points={areaPts} />
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePts}
        />

        {/* X axis labels */}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={padding.top + innerH + 18}
            textAnchor="middle"
            fontSize="11"
            fill="#64748b"
          >
            {t.label}
          </text>
        ))}

        {/* Hover marker */}
        {point && (
          <g>
            <line
              x1={xFor(hover)}
              x2={xFor(hover)}
              y1={padding.top}
              y2={padding.top + innerH}
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
            <circle cx={xFor(hover)} cy={yFor(point.value)} r="4" fill={color} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {point && (
        <div
          className="absolute pointer-events-none bg-slate-900 text-white text-xs rounded-md px-2 py-1 shadow-lg"
          style={{
            left: `${((xFor(hover) / W) * 100).toFixed(2)}%`,
            top: 8,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="text-slate-300">{point.date}</div>
          <div className="font-semibold">{formatValue(point.value, valueFormat)}</div>
        </div>
      )}
    </div>
  );
}
