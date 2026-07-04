import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

export default function WizmatchAnalyticsPage() {
  const [analytics, setAnalytics] = useState(null);
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, d] = await Promise.all([
        apiFetch('/api/wizmatch/analytics'),
        apiFetch('/api/wizmatch/digest'),
      ]);
      setAnalytics(a);
      setDigest(d);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><p className="text-neutral-400">Loading...</p></div>;

  const s = digest?.stats || {};

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-6">Analytics Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard label="Signals Today" value={s.signals_captured || 0} sub={`${s.signals_priority || 0} priority`} />
        <KpiCard label="Sends Today" value={s.sends || 0} />
        <KpiCard label="Positive Replies" value={s.positive_replies || 0} />
        <KpiCard label="Candidates" value={s.candidates_sourced || 0} />
      </div>

      {/* Domain Health */}
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Domain Performance</h2>
        <div className="card p-4">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Domain</th>
                <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Sends 7d</th>
                <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Reply Rate</th>
                <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Bounce Rate</th>
                <th className="text-center text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(analytics?.domains || []).map(d => (
                <tr key={d.domain} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2 text-sm font-medium text-neutral-900">{d.domain}</td>
                  <td className="py-2 text-sm text-neutral-600 text-right">{d.sends_7d}</td>
                  <td className="py-2 text-sm text-neutral-600 text-right">{(d.reply_rate_7d * 100).toFixed(1)}%</td>
                  <td className="py-2 text-sm text-neutral-600 text-right">{(d.bounce_rate_7d * 100).toFixed(1)}%</td>
                  <td className="py-2 text-center"><span className={d.status === 'healthy' ? 'badge-success' : 'badge-warning'}>{d.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pipeline Value */}
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Pipeline Value by Stage</h2>
        <div className="card p-4">
          {(analytics?.pipeline || []).map(p => (
            <div key={p.status} className="flex items-center gap-3 mb-2">
              <span className="text-sm text-neutral-700 w-32 capitalize">{p.status}</span>
              <div className="flex-1 bg-neutral-100 rounded-full h-6 relative">
                <div className="bg-primary-500 h-6 rounded-full flex items-center justify-end px-2 transition-all duration-200" style={{ width: `${Math.min(100, (p.count / Math.max(...(analytics?.pipeline?.map(x => x.count) || [1]))) * 100)}%` }}>
                  <span className="text-xs text-white font-medium">{p.count}</span>
                </div>
              </div>
              <span className="text-sm text-success-600 w-24 text-right font-medium">${((p.monthly_value || 0)).toLocaleString()}</span>
            </div>
          ))}
          {(analytics?.pipeline || []).length === 0 && <p className="text-neutral-400 text-sm">No placements yet</p>}
        </div>
      </div>

      {/* Source Breakdown */}
      <div>
        <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Signals by Source</h2>
        <div className="card p-4">
          {(analytics?.sources || []).map(src => (
            <div key={src.source} className="flex justify-between items-center py-2 border-b border-neutral-100 last:border-0">
              <span className="text-sm font-medium text-neutral-900 capitalize">{src.source}</span>
              <div className="flex gap-4">
                <span className="text-sm text-neutral-600">{src.count} signals</span>
                <span className="text-sm text-neutral-500">avg score {Number(src.avg_score).toFixed(1)}</span>
              </div>
            </div>
          ))}
          {(analytics?.sources || []).length === 0 && <p className="text-neutral-400 text-sm">No signals yet</p>}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary-500"></div>
      <div className="text-[12.5px] text-neutral-500 font-medium">{label}</div>
      <div className="text-[28px] font-bold text-neutral-900 mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </div>
  );
}