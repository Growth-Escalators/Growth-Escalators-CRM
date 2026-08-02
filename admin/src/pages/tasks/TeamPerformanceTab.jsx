// TeamPerformanceTab — per-member task throughput, on-time %, active load,
// overdue count + 30d trend sparkline, with an aging-bucket donut for all
// open tasks. Self-contained: owns its own data fetch from
// `/api/tasks/team-performance?period=<7d|30d|90d>` and its private SVG
// helpers (Sparkline, AgingDonut) live inline because they're only used here.
//
// Extracted verbatim from the legacy admin/src/pages/TasksBoardPage.jsx so
// the legacy file can be deleted once the v2 shell is wired up.

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.js';
import Avatar from './atoms/Avatar.jsx';

// ---------------------------------------------------------------------------
// Sparkline (60x16 SVG)
// ---------------------------------------------------------------------------
function Sparkline({ values }) {
  if (!values || values.length === 0) {
    return <svg width="60" height="16" />;
  }
  const W = 60;
  const H = 16;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        fill="none"
        stroke="#0284c7"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(' ')}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Aging donut (SVG, no external lib)
// ---------------------------------------------------------------------------
function AgingDonut({ buckets }) {
  const SLICES = [
    { key: 'lt1d',   label: '< 1 day',   color: '#16a34a' },
    { key: '1to3d',  label: '1-3 days',  color: '#0284c7' },
    { key: '3to7d',  label: '3-7 days',  color: '#f59e0b' },
    { key: 'gt7d',   label: '> 7 days',  color: '#dc2626' },
  ];
  const values = SLICES.map((s) => buckets?.[s.key] || 0);
  const total = values.reduce((a, b) => a + b, 0);
  const R = 60;
  const r = 38;
  const C = 70;
  // build arcs
  let acc = 0;
  const arcs = SLICES.map((s, i) => {
    const v = values[i];
    const frac = total > 0 ? v / total : 0;
    const start = acc;
    acc += frac;
    const end = acc;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const x0 = C + R * Math.cos(a0);
    const y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1);
    const y1 = C + R * Math.sin(a1);
    const ix0 = C + r * Math.cos(a0);
    const iy0 = C + r * Math.sin(a0);
    const ix1 = C + r * Math.cos(a1);
    const iy1 = C + r * Math.sin(a1);
    const large = (end - start) > 0.5 ? 1 : 0;
    if (frac <= 0) return null;
    if (frac >= 0.999) {
      // full ring — draw as two halves
      return (
        <g key={s.key}>
          <path d={`M ${C + R} ${C} A ${R} ${R} 0 1 1 ${C - R} ${C} L ${C - r} ${C} A ${r} ${r} 0 1 0 ${C + r} ${C} Z`} fill={s.color} />
        </g>
      );
    }
    const d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${r} ${r} 0 ${large} 0 ${ix0} ${iy0} Z`;
    return <path key={s.key} d={d} fill={s.color} />;
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={C * 2} height={C * 2}>
        {total === 0 ? (
          <circle cx={C} cy={C} r={(R + r) / 2} stroke="#e2e8f0" strokeWidth={R - r} fill="none" />
        ) : arcs}
        <text x={C} y={C + 4} textAnchor="middle" className="fill-slate-700" fontSize="14" fontWeight="600">{total}</text>
      </svg>
      <ul className="space-y-1 text-xs">
        {SLICES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-600 w-20">{s.label}</span>
            <span className="text-slate-800 font-medium">{values[i]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team Performance tab content
// ---------------------------------------------------------------------------
export default function TeamPerformanceTab() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/tasks/team-performance?period=${period}`)
      .then((d) => { if (!cancelled) { setData(d); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const members = data?.members || [];
  const aging = data?.aging || data?.agingTotals || null;

  return (
    <div className="px-6 py-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-slate-500">Period:</span>
        {[
          { k: '7d', label: '7 days' },
          { k: '30d', label: '30 days' },
          { k: '90d', label: '90 days' },
        ].map((p) => (
          <button
            key={p.k}
            onClick={() => setPeriod(p.k)}
            className={`text-xs px-2.5 py-1 rounded-md font-medium ${
              period === p.k ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-slate-500 py-12 text-center">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-600 py-12 text-center">{error}</p>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Member</th>
                  <th className="text-right px-4 py-2 font-medium">Done</th>
                  <th className="text-right px-4 py-2 font-medium">On-time %</th>
                  <th className="text-right px-4 py-2 font-medium">Active</th>
                  <th className="text-right px-4 py-2 font-medium">Overdue</th>
                  <th className="text-left px-4 py-2 font-medium">30d trend</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-500 text-xs py-8">No data for this period.</td>
                  </tr>
                ) : members.map((m) => (
                  <tr key={m.id || m.email} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={m.name || m.email} size="lg" />
                        <div>
                          <p className="text-sm font-medium text-slate-800">{m.name || m.email}</p>
                          {m.email && m.name && <p className="text-[11px] text-slate-600">{m.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{m.donePeriod ?? m.done ?? 0}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-sm font-medium ${
                        (m.onTimePct ?? 0) >= 80 ? 'text-emerald-700'
                          : (m.onTimePct ?? 0) >= 60 ? 'text-amber-700'
                          : 'text-red-600'
                      }`}>
                        {m.onTimePct != null ? `${Math.round(m.onTimePct)}%` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{m.activeLoad ?? m.active ?? 0}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={(m.overdue ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}>
                        {m.overdue ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Sparkline values={m.trend30d || m.trend || []} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Aging breakdown (open tasks)</h3>
            <AgingDonut buckets={aging} />
          </div>
        </>
      )}
    </div>
  );
}
