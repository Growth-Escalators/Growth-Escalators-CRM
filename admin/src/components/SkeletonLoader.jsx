import React from 'react';

// Loading placeholders that keep a page's shape while its data arrives.
//
// Two things worth knowing before editing:
//
// 1. `tone`. Most of the admin is light, but a dark-toned page (e.g.
//    bg-slate-950 with slate-800 cards) needs tone="dark" — otherwise the
//    skeleton falls back to hardcoded bg-white / border-slate-200 and loads
//    as a stack of white boxes on black.
//
// 2. Widths are DETERMINISTIC, derived from the row/column index. They used to
//    come from Math.random(), which re-rolled on every render — so a skeleton
//    that re-rendered while loading visibly jumped its bar widths around, which
//    reads as breakage rather than as waiting.

const TONES = {
  light: {
    surface: 'bg-white border-slate-200',
    headerRow: 'border-slate-100 bg-slate-50',
    rowBorder: 'border-slate-50',
    barStrong: 'bg-slate-200',
    bar: 'bg-slate-100',
    barFaint: 'bg-slate-50',
  },
  dark: {
    surface: 'bg-slate-800 border-slate-700',
    headerRow: 'border-slate-700 bg-slate-800/60',
    rowBorder: 'border-slate-700/60',
    barStrong: 'bg-slate-600',
    bar: 'bg-slate-700',
    barFaint: 'bg-slate-700/60',
  },
};

const toneOf = (tone) => TONES[tone] || TONES.light;

/** Stable pseudo-width in [min, min+span) from an integer seed. */
const widthFor = (seed, min, span) => min + ((seed * 37) % span);

export function SkeletonCard({ className = '', tone = 'light' }) {
  const t = toneOf(tone);
  return (
    <div className={`${t.surface} rounded-xl border p-4 animate-pulse ${className}`}>
      <div className={`h-3 ${t.bar} rounded w-1/3 mb-3`} />
      <div className={`h-7 ${t.bar} rounded w-2/3 mb-2`} />
      <div className={`h-2.5 ${t.barFaint} rounded w-1/2`} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 6, tone = 'light' }) {
  const t = toneOf(tone);
  return (
    <div className={`${t.surface} rounded-xl border overflow-hidden animate-pulse`} aria-hidden="true">
      {/* Header */}
      <div className={`flex gap-4 px-4 py-3 border-b ${t.headerRow}`}>
        {Array(cols).fill(0).map((_, i) => (
          <div key={i} className={`h-3 ${t.barStrong} rounded flex-1`} style={{ maxWidth: `${widthFor(i + 1, 60, 60)}px` }} />
        ))}
      </div>
      {/* Rows */}
      {Array(rows).fill(0).map((_, r) => (
        <div key={r} className={`flex gap-4 px-4 py-3 border-b ${t.rowBorder} last:border-0`}>
          {Array(cols).fill(0).map((_, c) => (
            <div key={c} className={`h-4 ${t.barFaint} rounded flex-1`} style={{ maxWidth: `${widthFor(r * cols + c + 1, 40, 80)}px` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, className = '', tone = 'light' }) {
  const t = toneOf(tone);
  return (
    <div className={`space-y-2 animate-pulse ${className}`} aria-hidden="true">
      {Array(lines).fill(0).map((_, i) => (
        <div key={i} className={`h-3 ${t.bar} rounded`} style={{ width: `${widthFor(i + 1, 60, 40)}%` }} />
      ))}
    </div>
  );
}
