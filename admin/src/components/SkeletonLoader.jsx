import React from 'react';

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 animate-pulse ${className}`}>
      <div className="h-3 bg-slate-100 rounded w-1/3 mb-3" />
      <div className="h-7 bg-slate-100 rounded w-2/3 mb-2" />
      <div className="h-2.5 bg-slate-50 rounded w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 6 }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 border-b border-slate-100 bg-slate-50">
        {Array(cols).fill(0).map((_, i) => (
          <div key={i} className="h-3 bg-slate-200 rounded flex-1" style={{ maxWidth: `${60 + Math.random() * 60}px` }} />
        ))}
      </div>
      {/* Rows */}
      {Array(rows).fill(0).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3 border-b border-slate-50 last:border-0">
          {Array(cols).fill(0).map((_, c) => (
            <div key={c} className="h-4 bg-slate-50 rounded flex-1" style={{ maxWidth: `${40 + Math.random() * 80}px` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 animate-pulse ${className}`}>
      {Array(lines).fill(0).map((_, i) => (
        <div key={i} className="h-3 bg-slate-100 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
      ))}
    </div>
  );
}
