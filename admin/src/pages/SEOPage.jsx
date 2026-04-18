import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  TrendingUp, TrendingDown, BarChart2, Globe, Search, Zap, AlertCircle,
  ChevronDown, RefreshCw, ExternalLink, ArrowUp, ArrowDown, Minus,
  Activity, Shield, FileText, Target, Clock, CheckCircle, XCircle,
  ChevronRight, Database, Play, Link2, Layers, X, ChevronLeft
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
  { id: 'overview',      label: 'Overview',      icon: BarChart2 },
  { id: 'keywords',      label: 'Keywords',      icon: Search },
  { id: 'content-gaps',  label: 'Content Gaps',  icon: Layers },
  { id: 'backlinks',     label: 'Backlinks',     icon: Link2 },
  { id: 'alerts',        label: 'Alerts',        icon: AlertCircle },
  { id: 'workflows',     label: 'Workflows',     icon: Activity },
  { id: 'content',       label: 'Content Engine', icon: FileText },
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
function OverviewTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/seo/overview')
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-slate-400" /></div>;

  if (!data || !data.clients || data.clients.length === 0) {
    return (
      <div className="py-16 text-center">
        <BarChart2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm font-medium">No SEO data yet</p>
        <p className="text-slate-400 text-xs mt-1">Go to Workflows tab and click "Run All Workflows" to populate data.</p>
      </div>
    );
  }

  const t = data.totals || {};

  return (
    <div className="space-y-6">
      {/* Aggregate summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Keywords', value: t.total_keywords || 0, color: 'text-sky-600' },
          { label: 'Page 1', value: t.total_page_1 || 0, color: 'text-green-600' },
          { label: 'Improved', value: t.total_improved || 0, color: 'text-emerald-600' },
          { label: 'Dropped', value: t.total_dropped || 0, color: 'text-red-500' },
          { label: 'Featured', value: t.total_featured || 0, color: 'text-amber-500' },
          { label: 'Opportunities', value: data.openOpportunities || 0, color: 'text-purple-600' },
          { label: 'Backlinks', value: data.activeBacklinks || 0, color: 'text-blue-600' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-lg p-3 text-center">
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-slate-500 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Per-client cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.clients.map(c => {
          const health = data.health?.[c.client_domain];
          const lastChecked = c.last_checked ? new Date(c.last_checked).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Never';
          return (
            <div key={c.client_domain} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-slate-800">{c.client_domain}</h3>
                  <p className="text-xs text-slate-400">Last checked: {lastChecked}</p>
                </div>
                {c.avg_position && (
                  <div className="text-right">
                    <p className="text-lg font-bold text-slate-700">{c.avg_position}</p>
                    <p className="text-xs text-slate-400">Avg Pos</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-sky-600">{c.total_keywords}</p>
                  <p className="text-[10px] text-slate-500">Keywords</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-green-600">{c.page_1}</p>
                  <p className="text-[10px] text-slate-500">Page 1</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-amber-500">{c.top_3}</p>
                  <p className="text-[10px] text-slate-500">Top 3</p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs mb-3">
                <span className="text-green-600 font-medium">{'\u2191'} {c.keywords_improved} improved</span>
                <span className="text-red-500 font-medium">{'\u2193'} {c.keywords_dropped} dropped</span>
                <span className="text-slate-400">{'\u2192'} {c.keywords_stable} stable</span>
              </div>

              {parseInt(c.featured_snippets) > 0 && (
                <p className="text-xs text-amber-600 mb-3">{'\u2B50'} {c.featured_snippets} featured snippet{parseInt(c.featured_snippets) > 1 ? 's' : ''}</p>
              )}

              {health && (
                <div className="border-t border-slate-100 pt-3 mt-3">
                  <div className="flex items-center gap-4 text-xs text-slate-600">
                    {health.pagespeed_mobile != null && <span>Mobile: <strong>{Math.round(Number(health.pagespeed_mobile))}</strong></span>}
                    {health.pagespeed_desktop != null && <span>Desktop: <strong>{Math.round(Number(health.pagespeed_desktop))}</strong></span>}
                    {health.lcp != null && (
                      <span>LCP: <strong className={Number(health.lcp) <= 2.5 ? 'text-green-600' : Number(health.lcp) <= 4 ? 'text-amber-500' : 'text-red-500'}>{Number(health.lcp).toFixed(1)}s</strong></span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
// Content Gaps Tab — keyword gaps across all clients
// ---------------------------------------------------------------------------
function ContentGapsTab() {
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/seo/content-gaps')
      .then(d => setGaps(d?.gaps ?? []))
      .catch(() => setGaps([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading content gaps...</div>;

  if (gaps.length === 0) {
    return (
      <div className="py-16 text-center">
        <Layers className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No content gap data yet.</p>
        <p className="text-slate-400 text-xs mt-1">Run the Content Gap Analysis workflow (WF-07) to identify gaps.</p>
      </div>
    );
  }

  const filtered = filter
    ? gaps.filter(g => g.project_name?.toLowerCase().includes(filter.toLowerCase()) || g.target_keyword?.toLowerCase().includes(filter.toLowerCase()))
    : gaps;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text" placeholder="Filter by keyword or client..."
          value={filter} onChange={e => setFilter(e.target.value)}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <span className="text-xs text-slate-400">{filtered.length} gaps</span>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Keyword</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Client</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Our Pos</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Word Gap</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Priority</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((g, i) => {
              const priority = parseFloat(g.priority_score ?? '0');
              const priorityColor = priority >= 7 ? 'text-red-600 bg-red-50' : priority >= 4 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
              const statusColor = g.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : g.status === 'addressed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600';
              const client = CLIENTS.find(c => c.domain === g.project_name) || CLIENTS.find(c => g.project_name?.includes(c.domain?.split('.')[0]));
              return (
                <tr key={g.id ?? i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-700">{g.target_keyword}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs">{client?.label ?? g.project_name}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${posColor(g.our_position)}`}>
                      {g.our_position ? fmtPos(g.our_position) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-600 text-xs">
                    {g.word_count_gap > 0 ? `+${g.word_count_gap} words` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${priorityColor}`}>
                      {priority.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>{g.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backlinks Tab — backlink profile across all clients
// ---------------------------------------------------------------------------
function BacklinksTab() {
  const [backlinks, setBacklinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/seo/backlinks')
      .then(d => setBacklinks(d?.backlinks ?? []))
      .catch(() => setBacklinks([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading backlinks...</div>;

  if (backlinks.length === 0) {
    return (
      <div className="py-16 text-center">
        <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No backlink data yet.</p>
        <p className="text-slate-400 text-xs mt-1">Run the Backlink Monitor workflow (WF-08) to track backlinks.</p>
      </div>
    );
  }

  const filtered = filter
    ? backlinks.filter(b => b.source_url?.toLowerCase().includes(filter.toLowerCase()) || b.anchor_text?.toLowerCase().includes(filter.toLowerCase()) || b.project_name?.toLowerCase().includes(filter.toLowerCase()))
    : backlinks;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text" placeholder="Filter by URL, anchor text or client..."
          value={filter} onChange={e => setFilter(e.target.value)}
          className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <span className="text-xs text-slate-400">{filtered.length} backlinks</span>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Source URL</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Client</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">DA</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Anchor</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Type</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">First Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((b, i) => {
              const da = parseFloat(b.domain_authority ?? '0');
              const daColor = da >= 50 ? 'text-green-600 bg-green-50' : da >= 20 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
              const client = CLIENTS.find(c => c.domain === b.project_name) || CLIENTS.find(c => b.project_name?.includes(c.domain?.split('.')[0]));
              const typeColor = b.link_type === 'dofollow' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600';
              return (
                <tr key={b.id ?? i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-700 text-xs truncate max-w-[280px]" title={b.source_url}>
                    <a href={b.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-sky-600 hover:underline">
                      {b.source_url?.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs">{client?.label ?? b.project_name}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${daColor}`}>{da}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-xs truncate max-w-[150px]">{b.anchor_text || '—'}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typeColor}`}>{b.link_type || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-slate-400 text-xs">{b.first_seen ? new Date(b.first_seen).toLocaleDateString('en-IN') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Detail Panel — slide-in from right when clicking an Overview card
// ---------------------------------------------------------------------------
function ClientDetailPanel({ domain, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!domain) return;
    setLoading(true);
    apiFetch(`/api/seo/client/${domain}`)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [domain]);

  if (!domain) return null;

  const client = CLIENTS.find(c => c.domain === domain);
  const displayName = client?.label ?? domain;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-2xl bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 z-10">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
          <Globe className="w-5 h-5 text-sky-500" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">{displayName}</h2>
            <p className="text-xs text-slate-400">{domain}</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading client data...
            </div>
          ) : !data ? (
            <div className="py-12 text-center text-red-500 text-sm">Failed to load data for {domain}</div>
          ) : (
            <>
              {/* PageSpeed / Health */}
              {data.health && (
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-500" /> Core Web Vitals
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: 'Mobile', value: data.health.pagespeed_mobile, suffix: '', color: parseFloat(data.health.pagespeed_mobile ?? 0) >= 70 ? 'text-green-600' : 'text-red-500' },
                      { label: 'Desktop', value: data.health.pagespeed_desktop, suffix: '', color: parseFloat(data.health.pagespeed_desktop ?? 0) >= 70 ? 'text-green-600' : 'text-red-500' },
                      { label: 'LCP', value: data.health.lcp, suffix: 's', color: parseFloat(data.health.lcp ?? 0) <= 2.5 ? 'text-green-600' : 'text-amber-600' },
                      { label: 'FID', value: data.health.fid, suffix: 'ms', color: parseFloat(data.health.fid ?? 0) <= 100 ? 'text-green-600' : 'text-amber-600' },
                      { label: 'CLS', value: data.health.cls, suffix: '', color: parseFloat(data.health.cls ?? 0) <= 0.1 ? 'text-green-600' : 'text-amber-600' },
                    ].map(m => (
                      <div key={m.label} className="bg-slate-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-slate-500 mb-1">{m.label}</p>
                        <p className={`text-xl font-bold ${m.color}`}>
                          {m.value != null ? `${parseFloat(m.value).toFixed(m.label === 'CLS' ? 3 : 1)}${m.suffix}` : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Weekly Trend */}
              {data.weekly?.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-sky-500" /> Weekly Trend (last {data.weekly.length} weeks)
                  </h3>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 text-slate-500">Week</th>
                          <th className="text-right px-3 py-2 text-slate-500">Clicks</th>
                          <th className="text-right px-3 py-2 text-slate-500">Impressions</th>
                          <th className="text-right px-3 py-2 text-slate-500">Avg Pos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.weekly.slice(0, 8).map((w, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-600">{w.week_start ? new Date(w.week_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                            <td className="px-3 py-2 text-right font-medium text-slate-700">{fmt(w.total_clicks)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmt(w.total_impressions)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmtPos(w.avg_position)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Top Keywords */}
              {data.keywords?.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Search className="w-4 h-4 text-indigo-500" /> Keywords ({data.keywords.length})
                  </h3>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 text-slate-500">Keyword</th>
                          <th className="text-center px-3 py-2 text-slate-500">Position</th>
                          <th className="text-center px-3 py-2 text-slate-500">Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.keywords.slice(0, 20).map((kw, i) => {
                          const change = kw.position_change != null ? Number(kw.position_change) : null;
                          return (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-700 font-medium">{kw.keyword}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${posColor(kw.position)}`}>
                                  {kw.position ? fmtPos(kw.position) : '—'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                {change != null && change !== 0 ? (
                                  <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${change < 0 ? 'text-green-600' : 'text-red-500'}`}>
                                    {change < 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                    {Math.abs(change)}
                                  </span>
                                ) : <Minus className="w-3 h-3 text-slate-300 mx-auto" />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Alerts */}
              {data.alerts?.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" /> Recent Alerts ({data.alerts.length})
                  </h3>
                  <div className="space-y-2">
                    {data.alerts.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${alertBadge(a.alert_type)}`}>
                          {(a.alert_type ?? 'info').replace(/_/g, ' ')}
                        </span>
                        <span className="text-slate-600 flex-1">{a.message}</span>
                        <span className="text-slate-400 flex-shrink-0">{a.created_at ? timeAgo(a.created_at) : ''}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Opportunities */}
              {data.opportunities?.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4 text-purple-500" /> Open Opportunities ({data.opportunities.length})
                  </h3>
                  <div className="space-y-2">
                    {data.opportunities.map((opp, i) => (
                      <div key={i} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{opp.opportunity_type}</span>
                          <span className="text-xs text-slate-400">Impact: {opp.estimated_impact} · Effort: {opp.effort_level}</span>
                        </div>
                        <p className="text-sm text-slate-700">{opp.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Content Gaps */}
              {data.content?.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-orange-500" /> Content Gaps ({data.content.length})
                  </h3>
                  <div className="space-y-2">
                    {data.content.map((gap, i) => (
                      <div key={i} className="bg-orange-50 border border-orange-100 rounded-lg px-4 py-3">
                        <p className="text-sm font-semibold text-orange-800">{gap.target_keyword}</p>
                        {gap.word_count_gap > 0 && <p className="text-xs text-orange-600 mt-0.5">Word count gap: +{gap.word_count_gap} words needed</p>}
                        {gap.our_url && <p className="text-xs text-slate-500 mt-0.5 truncate">Current URL: {gap.our_url}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Empty state */}
              {!data.weekly?.length && !data.keywords?.length && !data.health && (
                <div className="py-12 text-center text-slate-400 text-sm">
                  No data available for {displayName}. Run the SEO workflows to start collecting data.
                </div>
              )}
            </>
          )}
        </div>
      </div>
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
  const [runAllLoading, setRunAllLoading] = useState(false);
  const [runAllResult, setRunAllResult] = useState(null);

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
      {/* Run All Workflows */}
      <div className="mb-2">
        <div className="flex items-center gap-4 mb-3">
          <button
            onClick={async () => {
              setRunAllLoading(true);
              setRunAllResult(null);
              try {
                const d = await apiFetch('/api/seo-workflows/trigger-all', { method: 'POST' });
                setRunAllResult(d);
                load(); // Refresh data freshness
              } catch {
                setRunAllResult({ error: 'Failed to run workflows' });
              } finally {
                setRunAllLoading(false);
              }
            }}
            disabled={runAllLoading}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 text-sm font-medium"
          >
            {runAllLoading ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Running all workflows...</>
            ) : (
              <><Zap className="w-4 h-4" /> Run All Workflows</>
            )}
          </button>
          {runAllResult && !runAllResult.error && (
            <span className="text-sm text-green-600 font-medium">{'\u2713'} {runAllResult.succeeded}/{runAllResult.triggered} completed</span>
          )}
          {runAllResult?.error && (
            <span className="text-sm text-red-600">{runAllResult.error}</span>
          )}
        </div>
        {runAllResult?.results && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
            <p className="text-sm font-medium text-slate-700 mb-2">Results:</p>
            <div className="space-y-1">
              {runAllResult.results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={r.ok ? 'text-green-600' : 'text-red-500'}>{r.ok ? '\u2713' : '\u2717'}</span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-slate-500">{'\u2014'} {r.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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

      {/* Spotlight cards — the three workflows most likely to silently break */}
      <div className="space-y-3">
        <ContentDecayCard />
        <BacklinksCard />
        <DigestCard />
      </div>

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
// SpotlightWorkflowCard — shared card for critical SEO workflows.
// Shows: last-run status, last-run result count, one domain-specific stat,
// upstream-staleness banner (when applicable), Run Now, run history.
// ---------------------------------------------------------------------------
function SpotlightWorkflowCard({
  workflowId,
  title,
  description,
  icon: Icon,
  accentColor,     // 'rose' | 'indigo' | 'emerald' — drives button & header tint
  runService,      // path segment for POST /api/seo-workflows/run/:runService
  statsEndpoint,   // full path, e.g. '/api/seo-workflows/content-decay-stats'
  recordsLabel,    // e.g. 'opportunities', 'new backlinks'
  thirdStat,       // { label, value, hint, loading } derived per card
  staleBanner,     // optional { show, message }
}) {
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const logsRes = await apiFetch(`/api/seo-workflows/logs?workflowId=${workflowId}`).catch(() => null);
    setLogs(logsRes?.logs ?? []);
    setLoading(false);
  }, [workflowId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function runNow() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await apiFetch(`/api/seo-workflows/run/${runService}`, { method: 'POST' });
      setRunResult({ ok: res?.ok !== false, detail: res?.detail ?? 'Done' });
      refresh();
    } catch (e) {
      setRunResult({ ok: false, detail: e?.message ?? 'Failed' });
    } finally {
      setRunning(false);
    }
  }

  const lastLog = logs[0] ?? null;
  const lastRunAt = lastLog?.created_at ? new Date(lastLog.created_at) : null;
  const daysAgo = lastRunAt ? Math.floor((Date.now() - lastRunAt.getTime()) / 86400000) : null;
  const lastStatus = lastLog?.status ?? 'never';
  const lastRecords = lastLog?.records_processed;
  const lastError = lastLog?.error_message;

  const statusColor =
    lastStatus === 'success' ? 'text-green-600 bg-green-50 border-green-200'
    : lastStatus === 'error' ? 'text-red-600 bg-red-50 border-red-200'
    : 'text-slate-500 bg-slate-50 border-slate-200';

  const btnTint = {
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    hover: 'hover:bg-rose-100',    iconColor: 'text-rose-500' },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  hover: 'hover:bg-indigo-100',  iconColor: 'text-indigo-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', hover: 'hover:bg-emerald-100', iconColor: 'text-emerald-500' },
  }[accentColor] ?? { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', hover: 'hover:bg-sky-100', iconColor: 'text-sky-500' };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <Icon className={`w-4 h-4 ${btnTint.iconColor}`} /> {title}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${btnTint.bg} ${btnTint.text} border ${btnTint.border} rounded-lg ${btnTint.hover} disabled:opacity-50 flex-shrink-0`}
        >
          {running ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running ? 'Running...' : 'Run Now'}
        </button>
      </div>

      {runResult && (
        <div className={`mb-3 rounded-lg border p-2 text-xs flex items-center gap-2 ${runResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {runResult.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          <span>{runResult.detail}</span>
        </div>
      )}

      {staleBanner?.show && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{staleBanner.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className={`rounded-lg border p-3 ${statusColor}`}>
          <p className="text-[10px] uppercase tracking-wide opacity-70">Last run</p>
          <p className="text-sm font-semibold mt-0.5">
            {loading ? '…' : lastRunAt ? (daysAgo === 0 ? 'Today' : `${daysAgo}d ago`) : 'Never'}
          </p>
          <p className="text-[11px] opacity-70 mt-0.5 capitalize">{lastStatus}{lastLog?.triggered_by ? ` · ${lastLog.triggered_by}` : ''}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Last result</p>
          <p className="text-sm font-semibold text-slate-700 mt-0.5">
            {loading ? '…' : lastRecords != null ? `${lastRecords} ${recordsLabel}` : '—'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">from most recent run</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{thirdStat?.label ?? ''}</p>
          <p className="text-sm font-semibold text-slate-700 mt-0.5">
            {thirdStat?.loading ? '…' : (thirdStat?.value ?? '—')}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">{thirdStat?.hint ?? ''}</p>
        </div>
      </div>

      {lastError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span><strong>Last error:</strong> {lastError}</span>
        </div>
      )}

      {logs.length > 1 && (
        <details className="mt-3">
          <summary className="text-xs text-sky-600 cursor-pointer hover:underline">Run history ({logs.length})</summary>
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {logs.slice(0, 10).map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-slate-50">
                <span className={l.status === 'success' ? 'text-green-600' : 'text-red-600'}>
                  {l.status === 'success' ? '✓' : '✗'}
                </span>
                <span className="text-slate-600">{new Date(l.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{l.records_processed != null ? `${l.records_processed} ${recordsLabel}` : l.status}</span>
                {l.triggered_by && <span className="text-slate-400 ml-auto">{l.triggered_by}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content Decay card — wraps SpotlightWorkflowCard with decay-specific stats
// ---------------------------------------------------------------------------
function ContentDecayCard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    apiFetch('/api/seo-workflows/content-decay-stats').then(setStats).catch(() => setStats(null));
  }, []);
  const recent = stats?.keywordRankingsLast10d;
  return (
    <SpotlightWorkflowCard
      workflowId="Ss2Bfps5lXBWUUs4"
      title="Content Decay Detection"
      description="Every Monday 9 AM IST · finds keywords that slipped >5 positions or fell out of top 100"
      icon={TrendingDown}
      accentColor="rose"
      runService="content-decay"
      statsEndpoint="/api/seo-workflows/content-decay-stats"
      recordsLabel="opportunities"
      thirdStat={{
        label: 'Open decay opportunities',
        value: stats?.openOpportunities,
        hint: 'total across all clients',
        loading: stats == null,
      }}
      staleBanner={{
        show: recent === 0,
        message: (
          <>
            <strong>Upstream data is stale.</strong> keyword_rankings has 0 rows in the last 10 days.
            The rank tracker (Tuesday 9 AM IST) is not writing — check <code>SERPER_API_KEY</code> on the Railway worker.
            Content Decay cannot produce opportunities until this is fixed.
          </>
        ),
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Backlinks card — shows new backlinks in last 7 days, flags stale discovery
// ---------------------------------------------------------------------------
function BacklinksCard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    apiFetch('/api/seo-workflows/backlinks-stats').then(setStats).catch(() => setStats(null));
  }, []);
  const lastAt = stats?.lastDiscoveredAt ? new Date(stats.lastDiscoveredAt) : null;
  const daysSinceDiscovery = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86400000) : null;
  const isStale = daysSinceDiscovery != null && daysSinceDiscovery > 14;
  return (
    <SpotlightWorkflowCard
      workflowId="19R3BStSY2S1N9H1"
      title="Backlink Monitor"
      description="Every Friday 9 AM IST · finds new pages linking to client domains via Serper.dev"
      icon={Link2}
      accentColor="indigo"
      runService="backlinks"
      statsEndpoint="/api/seo-workflows/backlinks-stats"
      recordsLabel="new backlinks"
      thirdStat={{
        label: 'Active backlinks · last 7d',
        value: stats ? `${stats.totalBacklinks ?? 0} · +${stats.newLast7d ?? 0}` : '—',
        hint: lastAt ? `last discovered ${daysSinceDiscovery === 0 ? 'today' : `${daysSinceDiscovery}d ago`}` : 'none discovered yet',
        loading: stats == null,
      }}
      staleBanner={{
        show: isStale,
        message: (
          <>
            <strong>No new backlinks discovered in {daysSinceDiscovery}+ days.</strong> Either the
            Friday cron isn&apos;t running or <code>SERPER_API_KEY</code> is unset on the Railway worker.
            Click Run Now to diagnose.
          </>
        ),
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Digest card — shows what the NEXT Friday digest would contain right now
// ---------------------------------------------------------------------------
function DigestCard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    apiFetch('/api/seo-workflows/digest-stats').then(setStats).catch(() => setStats(null));
  }, []);
  const allEmpty = stats && stats.openOpportunities === 0 && stats.recentAlerts === 0 && stats.keywordRankingsLast10d === 0;
  return (
    <SpotlightWorkflowCard
      workflowId="M4rbRZL5jh0jJHku"
      title="Weekly Opportunity Digest"
      description="Every Friday 5 PM IST · summarizes opportunities, alerts, and rank wins to #seo on Slack"
      icon={FileText}
      accentColor="emerald"
      runService="digest"
      statsEndpoint="/api/seo-workflows/digest-stats"
      recordsLabel="sections"
      thirdStat={{
        label: 'Next digest would contain',
        value: stats ? `${stats.openOpportunities ?? 0} opps · ${stats.recentAlerts ?? 0} alerts` : '—',
        hint: `${stats?.keywordRankingsLast10d ?? 0} ranking rows in last 10d`,
        loading: stats == null,
      }}
      staleBanner={{
        show: !!allEmpty,
        message: (
          <>
            <strong>All upstream SEO pipelines are empty.</strong> The digest would go out blank.
            Digest will self-skip and post a health alert to #seo instead — but fix the upstream crons
            (rank tracker, alerts, content decay) before Friday.
          </>
        ),
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Content Engine Tab — generate content, analyze visibility, view briefs
// ---------------------------------------------------------------------------
function ContentEngineTab() {
  // --- Section A: Generate Content ---
  const [genClient, setGenClient] = useState(CLIENTS[0].domain);
  const [genKeyword, setGenKeyword] = useState('');
  const [genAiOptimized, setGenAiOptimized] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [genError, setGenError] = useState(null);

  // --- Section B: AI Visibility Analyzer ---
  const [vizUrl, setVizUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [vizResult, setVizResult] = useState(null);
  const [vizError, setVizError] = useState(null);

  // --- Section C: Content Briefs ---
  const [briefs, setBriefs] = useState(null);
  const [briefsLoading, setBriefsLoading] = useState(true);
  const [briefsError, setBriefsError] = useState(null);

  useEffect(() => {
    setBriefsLoading(true);
    apiFetch('/api/seo/content-briefs')
      .then(d => setBriefs(d))
      .catch(e => setBriefsError(e.message || 'Failed to load content briefs'))
      .finally(() => setBriefsLoading(false));
  }, []);

  async function handleGenerate() {
    if (!genKeyword.trim()) return;
    setGenerating(true);
    setGenResult(null);
    setGenError(null);
    try {
      const res = await apiFetch('/api/seo/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientDomain: genClient, keyword: genKeyword.trim(), aiOptimized: genAiOptimized }),
      });
      setGenResult(res);
    } catch (e) {
      setGenError(e.message || 'Failed to generate content');
    } finally {
      setGenerating(false);
    }
  }

  async function handleAnalyze() {
    if (!vizUrl.trim()) return;
    setAnalyzing(true);
    setVizResult(null);
    setVizError(null);
    try {
      const res = await apiFetch('/api/seo/analyze-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: vizUrl.trim() }),
      });
      setVizResult(res);
    } catch (e) {
      setVizError(e.message || 'Failed to analyze visibility');
    } finally {
      setAnalyzing(false);
    }
  }

  function scoreColor(score) {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-amber-500';
    return 'text-red-500';
  }

  function scoreBgColor(score) {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-amber-400';
    return 'bg-red-500';
  }

  return (
    <div className="space-y-6">
      {/* Section A: Generate Content */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-sky-500" /> Generate Content
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Client</label>
            <div className="relative">
              <select
                value={genClient}
                onChange={e => setGenClient(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {CLIENTS.map(c => (
                  <option key={c.domain} value={c.domain}>{c.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Keyword</label>
            <input
              type="text"
              value={genKeyword}
              onChange={e => setGenKeyword(e.target.value)}
              placeholder="Enter target keyword..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer pb-0.5">
            <input
              type="checkbox"
              checked={genAiOptimized}
              onChange={e => setGenAiOptimized(e.target.checked)}
              className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            AI Optimized
          </label>
          <button
            onClick={handleGenerate}
            disabled={generating || !genKeyword.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
          >
            {generating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {generating ? 'Generating...' : 'Generate Content'}
          </button>
        </div>

        {genError && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" /> {genError}
          </div>
        )}

        {genResult && (
          <div className="mt-4 space-y-3">
            {/* Title + Meta */}
            {genResult.title && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm font-semibold text-slate-800">{genResult.title}</p>
                {genResult.metaDescription && (
                  <p className="text-xs text-slate-500 mt-1">{genResult.metaDescription}</p>
                )}
              </div>
            )}

            {/* Schema badges */}
            {genResult.schemas && genResult.schemas.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {genResult.schemas.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                    <CheckCircle className="w-3 h-3" /> {s}
                  </span>
                ))}
              </div>
            )}

            {/* Content HTML preview */}
            {genResult.contentHtml && (
              <div className="border border-slate-200 rounded-lg p-4 prose prose-sm max-w-none text-slate-700"
                dangerouslySetInnerHTML={{ __html: genResult.contentHtml }} />
            )}

            {/* FAQ items */}
            {genResult.faqItems && genResult.faqItems.length > 0 && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-bold text-slate-600 mb-2">FAQ Items</p>
                <div className="space-y-2">
                  {genResult.faqItems.map((faq, i) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium text-slate-700">{faq.question}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Draft status badge */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                <Clock className="w-3 h-3" /> Stored as draft
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Section B: AI Visibility Analyzer */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-purple-500" /> AI Visibility Analyzer
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">URL</label>
            <input
              type="text"
              value={vizUrl}
              onChange={e => setVizUrl(e.target.value)}
              placeholder="https://example.com/page"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !vizUrl.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {analyzing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {vizError && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" /> {vizError}
          </div>
        )}

        {vizResult && (
          <div className="mt-4 space-y-4">
            {/* Score */}
            <div className="text-center">
              <p className={`text-5xl font-extrabold ${scoreColor(vizResult.score ?? 0)}`}>
                {vizResult.score ?? 0}
              </p>
              <p className="text-xs text-slate-400 mt-1">AI Visibility Score</p>
            </div>

            {/* Score breakdowns */}
            {vizResult.breakdown && (
              <div className="space-y-2">
                {['schema', 'faq', 'firstSentence', 'depth', 'freshness'].map(key => {
                  const val = vizResult.breakdown[key] ?? 0;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-28 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${scoreBgColor(val)}`} style={{ width: `${val}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-600 w-8 text-right">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recommendations */}
            {vizResult.recommendations && vizResult.recommendations.length > 0 && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-bold text-slate-600 mb-2">Recommendations</p>
                <ul className="space-y-1">
                  {vizResult.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section C: Content Briefs */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-500" /> Content Briefs
        </h3>

        {briefsLoading && (
          <div className="py-8 text-center text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading content briefs...
          </div>
        )}

        {briefsError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" /> {briefsError}
          </div>
        )}

        {briefs && !briefsLoading && (
          <div className="space-y-5">
            {/* Generated Pages table */}
            {briefs.pages && briefs.pages.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-600 mb-2">Generated Pages</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Title</th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500">Client</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Type</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {briefs.pages.map((p, i) => {
                        const statusColor = p.status === 'draft_wp' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
                        const client = CLIENTS.find(c => c.domain === p.client_domain);
                        return (
                          <tr key={p.id ?? i} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-700 truncate max-w-[250px]">{p.page_title}</td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs">{client?.label ?? p.client_domain}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>{p.status?.replace(/_/g, ' ')}</span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-slate-500 text-xs">{p.page_type || '—'}</td>
                            <td className="px-4 py-2.5 text-right text-slate-400 text-xs">
                              {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Content Briefs table */}
            {briefs.briefs && briefs.briefs.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-600 mb-2">Content Briefs</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Target Keyword</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Our Pos</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Priority</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Topics Missing</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Word Gap</th>
                        <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {briefs.briefs.map((b, i) => {
                        const priority = parseFloat(b.priority_score ?? '0');
                        const priorityColor = priority >= 7 ? 'text-red-600 bg-red-50' : priority >= 4 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
                        const statusColor = b.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : b.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600';
                        const topicsMissing = Array.isArray(b.topics_missing) ? b.topics_missing.length : (b.topics_missing ?? 0);
                        return (
                          <tr key={b.id ?? i} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-700">{b.target_keyword}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${posColor(b.our_position)}`}>
                                {b.our_position ? fmtPos(b.our_position) : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${priorityColor}`}>
                                {priority.toFixed(1)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center text-slate-600 text-xs">{topicsMissing}</td>
                            <td className="px-3 py-2.5 text-center text-slate-600 text-xs">
                              {b.word_count_gap > 0 ? `+${b.word_count_gap}` : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>{b.status}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Empty state */}
            {(!briefs.pages || briefs.pages.length === 0) && (!briefs.briefs || briefs.briefs.length === 0) && (
              <div className="py-8 text-center">
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No content briefs or generated pages yet.</p>
              </div>
            )}
          </div>
        )}
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
  const [selectedClient, setSelectedClient] = useState(null); // domain string for detail panel

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
            <OverviewTab />
          )}
          {activeTab === 'keywords' && (
            <KeywordsTab keywords={keywords} loading={loadingKeywords} />
          )}
          {activeTab === 'content-gaps' && (
            <ContentGapsTab />
          )}
          {activeTab === 'backlinks' && (
            <BacklinksTab />
          )}
          {activeTab === 'alerts' && (
            <AlertsTab alerts={alerts} loading={loadingAlerts} />
          )}
          {activeTab === 'workflows' && (
            <WorkflowsTab />
          )}
          {activeTab === 'content' && (
            <ContentEngineTab />
          )}
        </div>

        {/* Client Detail Slide-In Panel */}
        {selectedClient && (
          <ClientDetailPanel domain={selectedClient} onClose={() => setSelectedClient(null)} />
        )}
      </main>
    </div>
  );
}
