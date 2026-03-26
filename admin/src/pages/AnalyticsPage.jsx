import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { SkeletonCard, SkeletonTable } from '../components/SkeletonLoader.jsx';
import { apiFetch } from '../lib/api.js';
import { TrendingUp, ArrowRight } from 'lucide-react';

function FunnelStage({ name, count, conversionRate, isFirst, color }) {
  return (
    <div className="flex items-center gap-2">
      {!isFirst && (
        <div className="flex flex-col items-center">
          <ArrowRight className="w-5 h-5 text-slate-400" />
          {conversionRate != null && (
            <span className="text-xs text-slate-400">{conversionRate}%</span>
          )}
        </div>
      )}
      <div className={`flex-1 rounded-xl border p-4 text-center ${color}`}>
        <p className="text-2xl font-bold">{count.toLocaleString('en-IN')}</p>
        <p className="text-xs text-slate-500 mt-1">{name}</p>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [sources, setSources] = useState([]);
  const [funnel, setFunnel] = useState([]);
  const [trends, setTrends] = useState([]);
  const [trendDays, setTrendDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/analytics/lead-sources').catch(() => ({ sources: [] })),
      apiFetch('/api/analytics/funnel').catch(() => ({ stages: [] })),
      apiFetch(`/api/analytics/trends?days=${trendDays}`).catch(() => ({ data: [] })),
    ]).then(([src, fun, trd]) => {
      setSources(src?.sources || []);
      setFunnel(fun?.stages || []);
      setTrends(trd?.data || []);
      setLoading(false);
    });
  }, [trendDays]);

  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const funnelColors = [
    'bg-sky-50 border-sky-200 text-sky-900',
    'bg-blue-50 border-blue-200 text-blue-900',
    'bg-indigo-50 border-indigo-200 text-indigo-900',
    'bg-purple-50 border-purple-200 text-purple-900',
    'bg-green-50 border-green-200 text-green-900',
  ];

  const bestSource = sources.length > 0 ? sources.reduce((a, b) => b.conversionRate > a.conversionRate ? b : a, sources[0]) : null;

  // Simple sparkline SVG from trends
  const maxCount = Math.max(...trends.map(t => Number(t.count) || 0), 1);
  const sparkPoints = trends.map((t, i) => {
    const x = (i / Math.max(trends.length - 1, 1)) * 280;
    const y = 50 - ((Number(t.count) || 0) / maxCount) * 45;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 space-y-8">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-sky-600" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Lead Analytics</h1>
              <p className="text-sm text-slate-500">Source performance and funnel conversion</p>
            </div>
          </div>

          {/* Section 1: Lead Sources */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Lead Sources</h2>
            {loading ? <SkeletonTable rows={5} cols={7} /> : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Source</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Leads</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Avg Score</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Booking Rate</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Conversion</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Hot Lead %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map(s => (
                      <tr key={s.source} className={`border-b border-slate-50 hover:bg-slate-50 ${bestSource?.source === s.source ? 'bg-green-50' : ''}`}>
                        <td className="px-4 py-3 text-sm font-medium text-slate-800 capitalize">{s.source.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 text-right">{s.totalLeads}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 text-right">{s.avgScore}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 text-right">{s.bookingRate}%</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <span className={`font-semibold ${s.conversionRate > 0 ? 'text-green-600' : 'text-slate-400'}`}>{s.conversionRate}%</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700 text-right">{s.hotLeadRate}%</td>
                      </tr>
                    ))}
                    {sources.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">No lead data yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Funnel */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Funnel Conversion</h2>
            {loading ? (
              <div className="flex gap-4">{[1,2,3,4,5].map(i => <SkeletonCard key={i} className="flex-1" />)}</div>
            ) : (
              <div className="flex items-center gap-2">
                {funnel.map((stage, i) => (
                  <FunnelStage
                    key={stage.name}
                    name={stage.name}
                    count={stage.count}
                    conversionRate={stage.conversionRate}
                    isFirst={i === 0}
                    color={funnelColors[i] || funnelColors[0]}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Trends */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">Daily Lead Trend</h2>
              <div className="flex bg-slate-100 rounded-lg p-1">
                {[7, 30, 90].map(d => (
                  <button key={d} onClick={() => { setTrendDays(d); setLoading(true); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium ${trendDays === d ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              {trends.length > 1 ? (
                <svg viewBox="0 0 280 55" className="w-full h-20">
                  <polyline fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={sparkPoints} />
                </svg>
              ) : (
                <p className="text-sm text-slate-400 text-center py-6">Not enough data for trend chart</p>
              )}
              <div className="flex justify-between text-xs text-slate-400 mt-2">
                <span>{trends[0]?.day || ''}</span>
                <span>{trends[trends.length - 1]?.day || ''}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
