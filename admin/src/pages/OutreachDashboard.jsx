import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';

async function fetchOutreach(path) {
  const token = localStorage.getItem('ge_crm_token');
  const res = await fetch(`/api/outreach/leads${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const COUNTRY_COLORS = { UK: '#3b82f6', AU: '#22c55e', CA: '#f59e0b', US: '#a855f7' };

function MetricCard({ label, value, color = 'text-slate-800' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

export default function OutreachDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchOutreach('/dashboard');
      setData(d);
      setLastUpdated(new Date());
    } catch { /* handled */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);

  const p = data?.pipeline ?? {};
  const maxWeekly = Math.max(...(data?.weeklyTrend ?? []).map(d => d.count), 1);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Outreach Pipeline</h1>
            <p className="text-slate-500 text-sm mt-0.5">White-label agency outreach — UK, AU, CA, US</p>
          </div>
          {lastUpdated && <p className="text-xs text-slate-400">Updated {lastUpdated.toLocaleTimeString('en-IN')}</p>}
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading...</div>
        ) : !data ? (
          <div className="text-center py-16 text-red-500 text-sm">Failed to load outreach data</div>
        ) : (
          <>
            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              <MetricCard label="Total" value={p.total ?? 0} />
              <MetricCard label="Active" value={p.active ?? 0} color="text-green-600" />
              <MetricCard label="Uploaded" value={p.uploaded ?? 0} color="text-sky-600" />
              <MetricCard label="Replied" value={p.replied ?? 0} color="text-purple-600" />
              <MetricCard label="Interested" value={p.interested ?? 0} color="text-amber-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
              {/* Interested Leads */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="font-bold text-sm text-slate-800 mb-3">Interested Leads</h2>
                {(data.interestedLeads ?? []).length === 0 ? (
                  <p className="text-slate-400 text-sm py-6 text-center">No interested replies yet</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {data.interestedLeads.map(l => (
                      <div key={l.id} className="flex items-center justify-between p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{l.company}</p>
                          <p className="text-xs text-slate-500">{l.email} · {l.country}</p>
                        </div>
                        <span className="text-xs text-amber-600 font-medium">{l.notes?.slice(0, 40) || 'Interested'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Country Breakdown */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="font-bold text-sm text-slate-800 mb-3">By Country</h2>
                <div className="space-y-2">
                  {(data.byCountry ?? []).map(c => {
                    const pct = p.total > 0 ? Math.round((c.count / p.total) * 100) : 0;
                    const color = COUNTRY_COLORS[c.country] || '#94a3b8';
                    return (
                      <div key={c.country}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="font-medium text-slate-700">{c.country}</span>
                          <span className="text-slate-400">{c.count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
              {/* Weekly Trend */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="font-bold text-sm text-slate-800 mb-3">Leads Added (Last 7 Days)</h2>
                <div className="flex items-end gap-1.5 h-24">
                  {(data.weeklyTrend ?? []).map(d => (
                    <div key={d.date} className="flex-1 flex flex-col items-center">
                      <div className="w-full bg-sky-500 rounded-t" style={{ height: `${(d.count / maxWeekly) * 80}px`, minHeight: d.count > 0 ? '4px' : '0' }} />
                      <span className="text-[9px] text-slate-400 mt-1">{new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pipeline breakdown */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="font-bold text-sm text-slate-800 mb-3">Pipeline Breakdown</h2>
                <div className="space-y-1.5 text-sm">
                  {[
                    { label: 'New', count: p.new, color: 'bg-slate-400' },
                    { label: 'Enriching', count: p.enriching, color: 'bg-yellow-400' },
                    { label: 'Active', count: p.active, color: 'bg-green-500' },
                    { label: 'Uploaded', count: p.uploaded, color: 'bg-sky-500' },
                    { label: 'Replied', count: p.replied, color: 'bg-purple-500' },
                    { label: 'Not Found', count: p.notFound, color: 'bg-red-400' },
                    { label: 'Closed', count: p.closed, color: 'bg-slate-300' },
                  ].filter(s => s.count > 0).map(s => (
                    <div key={s.label} className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                      <span className="text-slate-600 flex-1">{s.label}</span>
                      <span className="font-semibold text-slate-800">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="font-bold text-sm text-slate-800 mb-3">Recent Activity</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b">
                      <th className="text-left py-2 px-2">Company</th>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-left py-2 px-2">Email</th>
                      <th className="text-left py-2 px-2">Source</th>
                      <th className="text-left py-2 px-2">Country</th>
                      <th className="text-left py-2 px-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recentActivity ?? []).map(r => (
                      <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-medium text-slate-800">{r.company}</td>
                        <td className="py-1.5 px-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            r.status === 'Active' ? 'bg-green-100 text-green-700' :
                            r.status === 'Replied' ? 'bg-purple-100 text-purple-700' :
                            r.status === 'Not_Found' ? 'bg-red-100 text-red-600' :
                            'bg-slate-100 text-slate-600'
                          }`}>{r.status}</span>
                        </td>
                        <td className="py-1.5 px-2 text-slate-500 text-xs">{r.email || '—'}</td>
                        <td className="py-1.5 px-2 text-slate-400 text-xs">{r.email_source || '—'}</td>
                        <td className="py-1.5 px-2 text-slate-500">{r.country || '—'}</td>
                        <td className="py-1.5 px-2 text-slate-400 text-xs">{r.updated_at ? new Date(r.updated_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
