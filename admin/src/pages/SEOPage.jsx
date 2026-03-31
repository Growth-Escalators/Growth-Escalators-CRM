import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  TrendingUp, TrendingDown, BarChart2, Globe, Search, Zap, AlertCircle,
  ChevronDown, RefreshCw, ExternalLink, ArrowUp, ArrowDown, Minus,
  Activity, Shield, FileText, Target
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CLIENTS = [
  { domain: 'aarohaom.com',               label: 'Aarohaom' },
  { domain: 'blackpandaenterprises.com',   label: 'Black Panda' },
  { domain: 'ageddentistry.org',           label: 'Aged Dentistry' },
];

const TABS = [
  { id: 'performance',  label: 'Performance',  icon: BarChart2 },
  { id: 'keywords',     label: 'Keywords',     icon: Search },
  { id: 'health',       label: 'Site Health',  icon: Shield },
  { id: 'opportunities',label: 'Opportunities',icon: Target },
  { id: 'alerts',       label: 'Alerts',       icon: AlertCircle },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString('en-IN');
}

function fmtPos(n) {
  if (n == null) return '—';
  return Number(n).toFixed(1);
}

function pct(curr, prev) {
  if (!prev || prev === 0) return null;
  return (((curr - prev) / prev) * 100).toFixed(1);
}

function posColor(pos) {
  const p = Number(pos);
  if (p <= 3)  return 'text-green-600  bg-green-50  border-green-200';
  if (p <= 10) return 'text-blue-600   bg-blue-50   border-blue-200';
  if (p <= 20) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  return               'text-slate-500  bg-slate-50  border-slate-200';
}

function priorityBadge(p) {
  if (p === 'high')   return 'bg-red-100 text-red-700';
  if (p === 'medium') return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-600';
}

function alertBadge(type) {
  if (type === 'ranking_drop')  return 'bg-red-100 text-red-700';
  if (type === 'traffic_drop')  return 'bg-orange-100 text-orange-700';
  if (type === 'ctr_fall')      return 'bg-yellow-100 text-yellow-700';
  return 'bg-slate-100 text-slate-600';
}

// ---------------------------------------------------------------------------
// SVG Line Chart (lightweight — no recharts dependency)
// ---------------------------------------------------------------------------
function LineChart({ data, xKey, y1Key, y2Key, y1Label = 'Clicks', y2Label = 'Impressions' }) {
  if (!data || data.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
        Not enough data to render chart
      </div>
    );
  }

  const W = 600, H = 180, PAD = { top: 16, right: 16, bottom: 32, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const sorted = [...data].reverse();
  const y1Vals = sorted.map(d => Number(d[y1Key] ?? 0));
  const y2Vals = sorted.map(d => Number(d[y2Key] ?? 0));
  const maxY1 = Math.max(...y1Vals, 1);
  const maxY2 = Math.max(...y2Vals, 1);

  const x = i => PAD.left + (i / (sorted.length - 1)) * innerW;
  const y1 = v => PAD.top + innerH - (v / maxY1) * innerH;
  const y2 = v => PAD.top + innerH - (v / maxY2) * innerH;

  const toPath = (vals, yFn) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yFn(v).toFixed(1)}`).join(' ');

  const xLabels = sorted.filter((_, i) => i % Math.ceil(sorted.length / 5) === 0 || i === sorted.length - 1);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <line key={r}
            x1={PAD.left} y1={PAD.top + innerH * (1 - r)}
            x2={PAD.left + innerW} y2={PAD.top + innerH * (1 - r)}
            stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {/* Y1 labels (left) */}
        {[0, 0.5, 1].map(r => (
          <text key={r} x={PAD.left - 6} y={PAD.top + innerH * (1 - r) + 4}
            textAnchor="end" fontSize="10" fill="#94a3b8">
            {fmt(maxY1 * r)}
          </text>
        ))}
        {/* Clicks line (navy) */}
        <path d={toPath(y1Vals, y1)} fill="none" stroke="#1e3a5f" strokeWidth="2" strokeLinejoin="round" />
        {/* Impressions line (orange) */}
        <path d={toPath(y2Vals, y2)} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 2" />
        {/* X axis labels */}
        {xLabels.map((d, i) => {
          const origIdx = sorted.indexOf(d);
          return (
            <text key={i} x={x(origIdx)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">
              {String(d[xKey] ?? '').slice(5)}
            </text>
          );
        })}
        {/* Legend */}
        <rect x={PAD.left} y={2} width={8} height={8} fill="#1e3a5f" rx="1" />
        <text x={PAD.left + 12} y={10} fontSize="10" fill="#475569">{y1Label}</text>
        <rect x={PAD.left + 70} y={2} width={8} height={8} fill="#f97316" rx="1" />
        <text x={PAD.left + 82} y={10} fontSize="10" fill="#475569">{y2Label}</text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------
function MetricCard({ label, value, prev, small }) {
  const change = pct(Number(value), Number(prev));
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 ${small ? '' : ''}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{fmt(value)}</p>
      {change !== null && (
        <p className={`text-xs mt-1 flex items-center gap-1 ${Number(change) > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {Number(change) > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {Math.abs(change)}% vs prev period
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ message = 'No data yet — workflows will populate this automatically', workflowId, onTrigger }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function run() {
    if (!workflowId) return;
    setLoading(true);
    try {
      await apiFetch(`/api/seo/trigger/${workflowId}`, { method: 'POST' });
      setDone(true);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="py-12 text-center">
      <BarChart2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500 text-sm mb-4">{message}</p>
      {workflowId && !done && (
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50">
          <Zap className="w-4 h-4" />
          {loading ? 'Running…' : 'Run workflows now'}
        </button>
      )}
      {done && <p className="text-green-600 text-sm">Workflow triggered! Data will appear shortly.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance tab
// ---------------------------------------------------------------------------
function PerformanceTab({ clientData, domain }) {
  const weekly = clientData?.weekly ?? [];
  if (weekly.length === 0) {
    return <EmptyState workflowId="YXmClFSKZB9DMkyu" />;
  }

  const curr = weekly[0] ?? {};
  const prev = weekly[1] ?? {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Clicks"       value={curr.total_clicks}       prev={prev.total_clicks} />
        <MetricCard label="Total Impressions"  value={curr.total_impressions}  prev={prev.total_impressions} />
        <MetricCard label="Avg Position"       value={fmtPos(curr.avg_position)} prev={fmtPos(prev.avg_position)} />
        <MetricCard label="Total Sessions"     value={curr.total_sessions}     prev={prev.total_sessions} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-4">Clicks &amp; Impressions (last 12 weeks)</p>
        <LineChart data={weekly} xKey="week_start" y1Key="total_clicks" y2Key="total_impressions" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keywords tab
// ---------------------------------------------------------------------------
function KeywordsTab({ clientData }) {
  const [search, setSearch] = useState('');
  const keywords = (clientData?.keywords ?? []).filter(k =>
    !search || k.keyword?.toLowerCase().includes(search.toLowerCase())
  );

  if ((clientData?.keywords ?? []).length === 0) {
    return <EmptyState workflowId="BwO187curjMMA60i" />;
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter keywords…"
          className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Keyword</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Position</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Change</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500">Volume</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden md:table-cell">URL</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 hidden md:table-cell">Checked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {keywords.map((kw, i) => {
              const change = Number(kw.position_change ?? kw.change ?? 0);
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{kw.keyword}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${posColor(kw.position)}`}>
                      #{kw.position}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {change === 0
                      ? <Minus className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                      : change < 0
                        ? <span className="flex items-center justify-center gap-0.5 text-green-600 text-xs font-semibold"><ArrowUp className="w-3 h-3" />{Math.abs(change)}</span>
                        : <span className="flex items-center justify-center gap-0.5 text-red-500 text-xs font-semibold"><ArrowDown className="w-3 h-3" />{change}</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{fmt(kw.search_volume)}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs truncate max-w-[180px] hidden md:table-cell">{kw.url}</td>
                  <td className="px-4 py-2.5 text-right text-slate-400 text-xs hidden md:table-cell">
                    {kw.checked_at ? new Date(kw.checked_at).toLocaleDateString('en-IN') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {keywords.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-6">No keywords match your filter</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site Health tab
// ---------------------------------------------------------------------------
function HealthTab({ clientData, domain, onTrigger }) {
  const health = clientData?.health;

  if (!health) {
    return <EmptyState message="No PageSpeed data yet" workflowId="z21W6MDWBF0dukkT" />;
  }

  function scoreColor(s) {
    const n = Number(s);
    if (n >= 90) return 'text-green-600';
    if (n >= 50) return 'text-orange-500';
    return 'text-red-500';
  }

  function vitBadge(val, good, ok) {
    if (val == null) return 'text-slate-400';
    const v = Number(val);
    if (v <= good) return 'text-green-600';
    if (v <= ok)   return 'text-orange-500';
    return 'text-red-500';
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {/* Mobile score */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
          <p className="text-xs text-slate-500 mb-2">Mobile Performance</p>
          <p className={`text-5xl font-bold mb-1 ${scoreColor(health.mobile_performance_score)}`}>
            {health.mobile_performance_score ?? '—'}
          </p>
          <p className="text-xs text-slate-400">/ 100</p>
        </div>
        {/* Desktop score */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
          <p className="text-xs text-slate-500 mb-2">Desktop Performance</p>
          <p className={`text-5xl font-bold mb-1 ${scoreColor(health.desktop_performance_score)}`}>
            {health.desktop_performance_score ?? '—'}
          </p>
          <p className="text-xs text-slate-400">/ 100</p>
        </div>
      </div>

      {/* Core Web Vitals */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-4">Core Web Vitals</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500">LCP (mobile)</p>
            <p className={`text-xl font-bold mt-0.5 ${vitBadge(health.mobile_lcp, 2500, 4000)}`}>
              {health.mobile_lcp ? `${(Number(health.mobile_lcp) / 1000).toFixed(1)}s` : '—'}
            </p>
            <p className="text-xs text-slate-400">good &lt; 2.5s</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">CLS (mobile)</p>
            <p className={`text-xl font-bold mt-0.5 ${vitBadge(health.mobile_cls, 0.1, 0.25)}`}>
              {health.mobile_cls ?? '—'}
            </p>
            <p className="text-xs text-slate-400">good &lt; 0.1</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Speed Index</p>
            <p className={`text-xl font-bold mt-0.5 ${vitBadge(health.mobile_speed_index, 3400, 5800)}`}>
              {health.mobile_speed_index ? `${(Number(health.mobile_speed_index) / 1000).toFixed(1)}s` : '—'}
            </p>
            <p className="text-xs text-slate-400">good &lt; 3.4s</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Last checked: {health.checked_at ? new Date(health.checked_at).toLocaleString('en-IN') : '—'}
        </p>
        <button onClick={() => onTrigger('z21W6MDWBF0dukkT')}
          className="flex items-center gap-2 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs hover:bg-sky-700">
          <RefreshCw className="w-3.5 h-3.5" /> Run PageSpeed
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opportunities tab
// ---------------------------------------------------------------------------
function OpportunitiesTab({ clientData }) {
  const [filter, setFilter] = useState('all');
  const opps = (clientData?.opportunities ?? []).filter(
    o => filter === 'all' || o.priority === filter
  );

  if ((clientData?.opportunities ?? []).length === 0) {
    return <EmptyState message="No open SEO opportunities yet" workflowId="M4rbRZL5jh0jJHku" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {['all', 'high', 'medium', 'low'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === f ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-600 hover:border-slate-400'
            }`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {opps.map((o, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${priorityBadge(o.priority)}`}>
                {o.priority ?? 'low'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm">{o.title}</p>
                {o.description && <p className="text-xs text-slate-500 mt-0.5">{o.description}</p>}
              </div>
              <p className="text-xs text-slate-400 flex-shrink-0">
                {o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN') : ''}
              </p>
            </div>
          </div>
        ))}
        {opps.length === 0 && <p className="text-center text-slate-400 text-sm py-6">No {filter} priority items</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts tab
// ---------------------------------------------------------------------------
function AlertsTab({ clientData }) {
  const alerts = clientData?.alerts ?? [];
  if (alerts.length === 0) {
    return <EmptyState message="No alerts yet — the alert workflow monitors this automatically" workflowId="5FVX2kEjuD7vWD0e" />;
  }
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
          <span className={`mt-0.5 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${alertBadge(a.alert_type)}`}>
            {(a.alert_type ?? 'info').replace('_', ' ')}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-800">{a.message}</p>
            {a.client_domain && <p className="text-xs text-slate-400 mt-0.5">{a.client_domain}</p>}
          </div>
          <p className="text-xs text-slate-400 flex-shrink-0">
            {a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN') : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview cards — all clients side by side
// ---------------------------------------------------------------------------
function OverviewCards({ clients, onSelect }) {
  if (!clients || clients.length === 0) {
    return (
      <EmptyState
        message="No SEO data yet — run the GSC + GA4 Data Pull workflow to get started"
        workflowId="YXmClFSKZB9DMkyu"
      />
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {CLIENTS.map(c => {
        const d = clients.find(cl => cl.client_domain === c.domain);
        return (
          <button key={c.domain} onClick={() => onSelect(c.domain)}
            className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:border-sky-300 hover:shadow-md transition-all group">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-4 h-4 text-sky-500" />
              <p className="font-semibold text-slate-800 text-sm">{c.domain}</p>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {d ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500">Total Clicks</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(d.total_clicks)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Impressions</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(d.total_impressions)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Avg Position</p>
                  <p className="text-xl font-bold text-slate-900">{fmtPos(d.avg_position)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Sessions</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(d.total_sessions)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No data yet</p>
            )}
            {d?.last_updated && (
              <p className="text-xs text-slate-400 mt-3">
                Updated {new Date(d.last_updated).toLocaleDateString('en-IN')}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflows panel
// ---------------------------------------------------------------------------
function WorkflowsPanel() {
  const [workflows, setWorkflows] = useState([]);
  const [triggering, setTriggering] = useState({});
  const [lastRun, setLastRun] = useState({});

  useEffect(() => {
    apiFetch('/api/seo/workflows')
      .then(d => setWorkflows(d?.workflows ?? []))
      .catch(() => {});
  }, []);

  async function trigger(id, name) {
    setTriggering(prev => ({ ...prev, [id]: true }));
    try {
      await apiFetch(`/api/seo/trigger/${id}`, { method: 'POST' });
      setLastRun(prev => ({ ...prev, [id]: new Date() }));
    } catch {}
    setTriggering(prev => ({ ...prev, [id]: false }));
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Zap className="w-4 h-4 text-sky-500" />
        <p className="text-sm font-semibold text-slate-800">n8n Workflows</p>
        <span className="ml-auto text-xs text-slate-400">{workflows.length} active</span>
      </div>
      <div className="divide-y divide-slate-50">
        {workflows.map(w => (
          <div key={w.id} className="px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 truncate">{w.name}</p>
              <p className="text-xs text-slate-400">{w.schedule}</p>
              {lastRun[w.id] && (
                <p className="text-xs text-green-600">
                  Triggered {lastRun[w.id].toLocaleTimeString('en-IN')}
                </p>
              )}
            </div>
            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400" title="Active" />
            <button
              onClick={() => trigger(w.id, w.name)}
              disabled={triggering[w.id]}
              className="flex-shrink-0 px-2 py-1 text-xs border border-slate-200 rounded text-slate-600 hover:border-sky-300 hover:text-sky-600 transition-colors disabled:opacity-40"
            >
              {triggering[w.id] ? '…' : 'Run'}
            </button>
          </div>
        ))}
        {workflows.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-400 text-center">Loading workflows…</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content opportunities panel
// ---------------------------------------------------------------------------
function ContentPanel({ clientData }) {
  const content = clientData?.content ?? [];
  if (content.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <FileText className="w-4 h-4 text-emerald-500" />
        <p className="text-sm font-semibold text-slate-800">Content Opportunities</p>
      </div>
      <div className="divide-y divide-slate-50">
        {content.map((c, i) => (
          <div key={i} className="px-4 py-3">
            <p className="text-xs font-medium text-slate-700">{c.topic ?? c.title ?? 'Untitled'}</p>
            {c.competitor_keyword && (
              <p className="text-xs text-slate-400 mt-0.5">Competitor keyword: {c.competitor_keyword}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SEOPage
// ---------------------------------------------------------------------------
export default function SEOPage() {
  const [selectedDomain, setSelectedDomain] = useState(null); // null = overview
  const [tab, setTab] = useState('performance');
  const [overview, setOverview] = useState([]);
  const [clientData, setClientData] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingClient, setLoadingClient] = useState(false);
  const [triggeringWorkflow, setTriggeringWorkflow] = useState({});

  // Fetch overview
  useEffect(() => {
    setLoadingOverview(true);
    apiFetch('/api/seo/overview')
      .then(d => setOverview(d?.clients ?? []))
      .catch(() => setOverview([]))
      .finally(() => setLoadingOverview(false));
  }, []);

  // Fetch client detail when domain selected
  useEffect(() => {
    if (!selectedDomain) { setClientData(null); return; }
    setLoadingClient(true);
    apiFetch(`/api/seo/client/${encodeURIComponent(selectedDomain)}`)
      .then(d => setClientData(d))
      .catch(() => setClientData({}))
      .finally(() => setLoadingClient(false));
  }, [selectedDomain]);

  async function triggerWorkflow(workflowId) {
    setTriggeringWorkflow(prev => ({ ...prev, [workflowId]: true }));
    try { await apiFetch(`/api/seo/trigger/${workflowId}`, { method: 'POST' }); } catch {}
    setTriggeringWorkflow(prev => ({ ...prev, [workflowId]: false }));
  }

  const selectedClient = CLIENTS.find(c => c.domain === selectedDomain);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <BarChart2 className="w-5 h-5 text-sky-600" />
              <div>
                <h1 className="text-lg font-bold text-slate-900">SEO Performance</h1>
                <p className="text-xs text-slate-500">Search visibility &amp; rankings across all clients</p>
              </div>
            </div>

            {/* Client selector */}
            <div className="ml-auto flex items-center gap-3">
              <div className="relative">
                <select
                  value={selectedDomain ?? ''}
                  onChange={e => { setSelectedDomain(e.target.value || null); setTab('performance'); }}
                  className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">All Clients</option>
                  {CLIENTS.map(c => (
                    <option key={c.domain} value={c.domain}>{c.label} ({c.domain})</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {selectedDomain && (
                <button onClick={() => setSelectedDomain(null)}
                  className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 border border-slate-200 rounded-lg">
                  ← All clients
                </button>
              )}
            </div>
          </div>

          {/* Client tabs */}
          {selectedDomain && (
            <div className="flex gap-1 mt-3 overflow-x-auto">
              {TABS.map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      tab === t.id ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                    }`}>
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          <div className="flex gap-6">

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-5">

              {/* Overview mode */}
              {!selectedDomain && (
                <>
                  <p className="text-sm font-semibold text-slate-700">
                    {overview.length > 0
                      ? `${overview.length} client${overview.length !== 1 ? 's' : ''} tracked`
                      : 'Client Overview'}
                  </p>
                  {loadingOverview
                    ? <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <div key={i} className="h-40 bg-white rounded-xl border border-slate-200 animate-pulse" />)}</div>
                    : <OverviewCards clients={overview} onSelect={d => { setSelectedDomain(d); setTab('performance'); }} />
                  }
                </>
              )}

              {/* Client detail mode */}
              {selectedDomain && (
                <>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-sky-500" />
                    <p className="text-sm font-semibold text-slate-700">
                      {selectedClient?.label} — {selectedDomain}
                    </p>
                    {loadingClient && <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
                  </div>

                  {loadingClient ? (
                    <div className="space-y-3">
                      {[1,2,3].map(i => <div key={i} className="h-20 bg-white rounded-xl border border-slate-200 animate-pulse" />)}
                    </div>
                  ) : (
                    <>
                      {tab === 'performance'   && <PerformanceTab clientData={clientData} domain={selectedDomain} />}
                      {tab === 'keywords'      && <KeywordsTab clientData={clientData} />}
                      {tab === 'health'        && <HealthTab clientData={clientData} domain={selectedDomain} onTrigger={triggerWorkflow} />}
                      {tab === 'opportunities' && <OpportunitiesTab clientData={clientData} />}
                      {tab === 'alerts'        && <AlertsTab clientData={clientData} />}
                    </>
                  )}

                  {/* Content opportunities — always shown below tabs */}
                  {!loadingClient && <ContentPanel clientData={clientData} />}
                </>
              )}
            </div>

            {/* Right panel: Workflows */}
            <div className="w-64 flex-shrink-0 space-y-4">
              <WorkflowsPanel />
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
