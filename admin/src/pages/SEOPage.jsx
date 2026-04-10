import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  TrendingUp, TrendingDown, BarChart2, Globe, Search, Zap, AlertCircle,
  ChevronDown, RefreshCw, ExternalLink, ArrowUp, ArrowDown, Minus,
  Activity, Shield, FileText, Target, Clock, CheckCircle, XCircle,
  ChevronRight, Database, Play
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CLIENTS = [
  { domain: 'aarohaom.com',               label: 'Aarohaom' },
  { domain: 'blackpandaenterprises.com',   label: 'Black Panda' },
  { domain: 'ageddentistry.org',           label: 'Aged Dentistry' },
];

const DASHBOARD_TABS = [
  { id: 'overview',   label: 'Overview',   icon: BarChart2 },
  { id: 'keywords',   label: 'Keywords',   icon: Search },
  { id: 'alerts',     label: 'Alerts',     icon: AlertCircle },
  { id: 'workflows',  label: 'Workflows',  icon: Activity },
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

function fmtCtr(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(2)}%`;
}

function trendArrow(current, previous, invertColor = false) {
  if (current == null || previous == null) return null;
  const curr = Number(current);
  const prev = Number(previous);
  if (isNaN(curr) || isNaN(prev) || prev === 0) return null;
  const diff = curr - prev;
  const pctChange = ((diff / Math.abs(prev)) * 100).toFixed(1);
  if (Math.abs(diff) < 0.01) return null;

  // For position, lower is better so invert the color logic
  const isPositive = invertColor ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUp : ArrowDown;
  const color = isPositive ? 'text-green-600' : 'text-red-500';

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${color}`}>
      <Icon className="w-3 h-3" />
      {Math.abs(pctChange)}%
    </span>
  );
}

function posColor(pos) {
  const p = Number(pos);
  if (p <= 3)  return 'text-green-600  bg-green-50  border-green-200';
  if (p <= 10) return 'text-blue-600   bg-blue-50   border-blue-200';
  if (p <= 20) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  return               'text-slate-500  bg-slate-50  border-slate-200';
}

function alertBadge(type) {
  const t = (type ?? '').toLowerCase();
  if (t.includes('ranking_drop') || t.includes('rank'))  return 'bg-red-100 text-red-700';
  if (t.includes('traffic_drop') || t.includes('traffic')) return 'bg-orange-100 text-orange-700';
  if (t.includes('ctr'))        return 'bg-yellow-100 text-yellow-700';
  if (t.includes('success') || t.includes('improve'))     return 'bg-green-100 text-green-700';
  return 'bg-slate-100 text-slate-600';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-IN');
}

// ---------------------------------------------------------------------------
// Overview Tab — card per client with metrics + WoW trend
// ---------------------------------------------------------------------------
function OverviewTab({ clients, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-56 bg-white rounded-xl border border-slate-200 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!clients || clients.length === 0) {
    return (
      <div className="py-16 text-center">
        <BarChart2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No SEO data yet. Run the GSC + GA4 Data Pull workflow to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {clients.map(client => {
        const knownClient = CLIENTS.find(c => c.domain === client.client_domain);
        const displayName = client.client_name || knownClient?.label || client.client_domain;

        return (
          <div key={client.client_domain}
            className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <Globe className="w-4 h-4 text-sky-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 text-sm truncate">{displayName}</p>
                <p className="text-xs text-slate-400 truncate">{client.client_domain}</p>
              </div>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {/* Clicks */}
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Total Clicks</p>
                <p className="text-xl font-bold text-slate-900">{fmt(client.total_clicks)}</p>
                <div className="mt-0.5">{trendArrow(client.total_clicks, client.prev_clicks)}</div>
              </div>
              {/* Impressions */}
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Impressions</p>
                <p className="text-xl font-bold text-slate-900">{fmt(client.total_impressions)}</p>
                <div className="mt-0.5">{trendArrow(client.total_impressions, client.prev_impressions)}</div>
              </div>
              {/* Avg CTR */}
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Avg CTR</p>
                <p className="text-xl font-bold text-slate-900">{fmtCtr(client.avg_ctr)}</p>
                <div className="mt-0.5">{trendArrow(client.avg_ctr, client.prev_ctr)}</div>
              </div>
              {/* Avg Position */}
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Avg Position</p>
                <p className="text-xl font-bold text-slate-900">{fmtPos(client.avg_position)}</p>
                <div className="mt-0.5">{trendArrow(client.avg_position, client.prev_position, true)}</div>
              </div>
            </div>

            {/* Footer */}
            {client.last_updated && (
              <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
                Week of {new Date(client.last_updated).toLocaleDateString('en-IN')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keywords Tab — cross-client keyword table with filter + sort
// ---------------------------------------------------------------------------
function KeywordsTab({ keywords, loading }) {
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('all');

  // Derive unique domains for filter
  const domains = [...new Set((keywords ?? []).map(k => k.client_domain).filter(Boolean))];

  const filtered = (keywords ?? [])
    .filter(k => clientFilter === 'all' || k.client_domain === clientFilter)
    .filter(k => !search || k.keyword?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const posA = Number(a.position ?? 999);
      const posB = Number(b.position ?? 999);
      return posA - posB;
    });

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-12 bg-white rounded-lg border border-slate-200 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!keywords || keywords.length === 0) {
    return (
      <div className="py-16 text-center">
        <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No keyword data yet. Run the Rank Tracking workflow to populate keywords.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter keywords..."
            className="pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 w-64" />
        </div>
        <div className="relative">
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">All Clients</option>
            {domains.map(d => {
              const known = CLIENTS.find(c => c.domain === d);
              return <option key={d} value={d}>{known?.label ?? d}</option>;
            })}
          </select>
          <ChevronDown className="absolute right-2.5 top-2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
        <span className="text-xs text-slate-400">{filtered.length} keyword{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Keyword</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Client</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Position</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Previous</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Change</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Last Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((kw, i) => {
                const change = Number(kw.change ?? 0);
                const knownClient = CLIENTS.find(c => c.domain === kw.client_domain);
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{kw.keyword}</td>
                    <td className="px-3 py-2.5 text-slate-600 text-xs">
                      {knownClient?.label ?? kw.client_domain}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${posColor(kw.position)}`}>
                        #{kw.position}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500 text-xs">
                      {kw.previous_position != null ? `#${kw.previous_position}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {change === 0
                        ? <Minus className="w-3.5 h-3.5 text-slate-400 mx-auto" />
                        : change < 0
                          ? <span className="flex items-center justify-center gap-0.5 text-green-600 text-xs font-semibold">
                              <ArrowUp className="w-3 h-3" />{Math.abs(change)}
                            </span>
                          : <span className="flex items-center justify-center gap-0.5 text-red-500 text-xs font-semibold">
                              <ArrowDown className="w-3 h-3" />{change}
                            </span>
                      }
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400 text-xs">
                      {kw.checked_at ? new Date(kw.checked_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-6">No keywords match your filter</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts Tab — recent alerts with color-coded badges
// ---------------------------------------------------------------------------
function AlertsTab({ alerts, loading }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 bg-white rounded-xl border border-slate-200 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <div className="py-16 text-center">
        <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No alerts yet. The alert workflow monitors this automatically.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const knownClient = CLIENTS.find(c => c.domain === a.client_domain);
        return (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
            <span className={`mt-0.5 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${alertBadge(a.alert_type)}`}>
              {(a.alert_type ?? 'info').replace(/_/g, ' ')}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800">{a.message}</p>
              {a.client_domain && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {knownClient?.label ?? a.client_domain}
                  {a.details ? ` - ${a.details}` : ''}
                </p>
              )}
            </div>
            <p className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
              {a.created_at ? timeAgo(a.created_at) : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflows Tab — trigger buttons + data freshness + status
// ---------------------------------------------------------------------------
function WorkflowsTab() {
  const [workflows, setWorkflows] = useState([]);
  const [dataHealth, setDataHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(null);
  const [triggerResult, setTriggerResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [wfRes, dhRes] = await Promise.all([
      apiFetch('/api/seo/workflows').catch(() => null),
      apiFetch('/api/seo-workflows/data-health').catch(() => null),
    ]);
    setWorkflows(wfRes?.workflows ?? []);
    setDataHealth(dhRes ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function triggerWorkflow(wfId, wfName) {
    setTriggering(wfId);
    setTriggerResult(null);
    try {
      const res = await apiFetch(`/api/seo/trigger/${wfId}`, { method: 'POST' });
      setTriggerResult({ ok: true, name: wfName, message: res?.message || 'Triggered successfully' });
    } catch (e) {
      setTriggerResult({ ok: false, name: wfName, message: e.message || 'Failed to trigger' });
    } finally {
      setTriggering(null);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading workflows...</div>;
  }

  const dh = dataHealth;

  return (
    <div className="space-y-5">
      {/* Trigger result banner */}
      {triggerResult && (
        <div className={`rounded-xl border p-3 text-sm flex items-center gap-2 ${triggerResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {triggerResult.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          <strong>{triggerResult.name}:</strong> {triggerResult.message}
          <button onClick={() => setTriggerResult(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Data Freshness */}
      {dh && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4 text-sky-500" /> Data Freshness
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(dh).filter(([k]) => k !== 'checkedAt').map(([table, info]) => {
              const d = info || {};
              const count = d.count ?? 0;
              const lastEntry = d.lastEntry;
              const daysAgo = lastEntry ? Math.floor((Date.now() - new Date(lastEntry).getTime()) / 86400000) : null;
              const freshness = daysAgo === null ? 'empty' : daysAgo <= 2 ? 'fresh' : daysAgo <= 7 ? 'stale' : 'old';
              const dot = freshness === 'fresh' ? 'bg-green-400' : freshness === 'stale' ? 'bg-yellow-400' : freshness === 'old' ? 'bg-red-400' : 'bg-slate-300';
              const label = table.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

              return (
                <div key={table} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-xs">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-700 truncate">{label}</p>
                    <p className="text-slate-400">
                      {count} rows {daysAgo !== null ? `· ${daysAgo === 0 ? 'today' : `${daysAgo}d ago`}` : '· empty'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Workflow Trigger Grid */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" /> n8n SEO Workflows
          </h3>
          <button onClick={load} className="text-xs text-sky-600 hover:underline flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {workflows.map(wf => {
            const isTriggering = triggering === wf.id;
            return (
              <div key={wf.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-100 hover:border-slate-200 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    <span className="text-xs text-slate-400 mr-1">#{wf.num ?? ''}</span>
                    {wf.name}
                  </p>
                  <p className="text-xs text-slate-400">{wf.schedule}</p>
                </div>
                <button
                  onClick={() => triggerWorkflow(wf.id, wf.name)}
                  disabled={isTriggering}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-100 disabled:opacity-50 transition-colors flex-shrink-0"
                >
                  {isTriggering ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  {isTriggering ? 'Running...' : 'Trigger'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SEOPage
// ---------------------------------------------------------------------------
export default function SEOPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [lastUpdated, setLastUpdated] = useState(null);

  // Data state
  const [overview, setOverview] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [alerts, setAlerts] = useState([]);

  // Loading state
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingKeywords, setLoadingKeywords] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch functions
  const fetchOverview = useCallback(() => {
    setLoadingOverview(true);
    return apiFetch('/api/seo/overview')
      .then(d => setOverview(d?.clients ?? []))
      .catch(() => setOverview([]))
      .finally(() => setLoadingOverview(false));
  }, []);

  const fetchKeywords = useCallback(() => {
    setLoadingKeywords(true);
    return apiFetch('/api/seo/keywords-all')
      .then(d => setKeywords(d?.keywords ?? []))
      .catch(() => setKeywords([]))
      .finally(() => setLoadingKeywords(false));
  }, []);

  const fetchAlerts = useCallback(() => {
    setLoadingAlerts(true);
    return apiFetch('/api/seo/alerts')
      .then(d => setAlerts(d?.alerts ?? []))
      .catch(() => setAlerts([]))
      .finally(() => setLoadingAlerts(false));
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([fetchOverview(), fetchKeywords(), fetchAlerts()])
      .then(() => setLastUpdated(new Date()));
  }, [fetchOverview, fetchKeywords, fetchAlerts]);

  // Refresh all
  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchOverview(), fetchKeywords(), fetchAlerts()]);
    setLastUpdated(new Date());
    setRefreshing(false);
  }

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
                <h1 className="text-lg font-bold text-slate-900">SEO Dashboard</h1>
                <p className="text-xs text-slate-500">Search visibility, rankings &amp; alerts across all clients</p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-3">
              {/* Last updated */}
              {lastUpdated && (
                <span className="text-xs text-slate-400 hidden sm:inline">
                  Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {DASHBOARD_TABS.map(t => {
              const Icon = t.icon;
              const count = t.id === 'keywords' ? keywords.length
                          : t.id === 'alerts' ? alerts.length
                          : overview.length;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    activeTab === t.id ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}>
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  {count > 0 && (
                    <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === t.id ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {activeTab === 'overview' && (
            <OverviewTab clients={overview} loading={loadingOverview} />
          )}
          {activeTab === 'keywords' && (
            <KeywordsTab keywords={keywords} loading={loadingKeywords} />
          )}
          {activeTab === 'alerts' && (
            <AlertsTab alerts={alerts} loading={loadingAlerts} />
          )}
          {activeTab === 'workflows' && (
            <WorkflowsTab />
          )}
        </div>
      </main>
    </div>
  );
}
