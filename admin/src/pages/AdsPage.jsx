import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import { BarChart2, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, AlertCircle, Settings, Bell, Plus, Trash2 } from 'lucide-react';

const FALLBACK_ACCOUNTS = [
  { id: 'act_323237510625803', name: 'GE Agency' },
  { id: 'act_689363376592426', name: 'Paraiso' },
];

const DATE_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
];

function fmt(n, prefix = '', suffix = '') {
  if (n === null || n === undefined) return '—';
  return `${prefix}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${suffix}`;
}

function StatusBadge({ status }) {
  const s = (status || '').toUpperCase();
  const colors = {
    ACTIVE: 'bg-green-100 text-green-700',
    PAUSED: 'bg-yellow-100 text-yellow-700',
    ARCHIVED: 'bg-slate-100 text-slate-500',
    DELETED: 'bg-red-100 text-red-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || 'bg-slate-100 text-slate-500'}`}>
      {s}
    </span>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {[1,2,3,4,5,6,7,8].map(i => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-slate-100 rounded animate-pulse" style={{width: `${40+Math.random()*40}%`}} />
        </td>
      ))}
    </tr>
  );
}

function TokenMissingBanner({ onDismiss }) {
  return (
    <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-800">Meta Ads token not configured yet</p>
        <p className="text-sm text-amber-700 mt-0.5">
          Add <code className="bg-amber-100 px-1 rounded font-mono text-xs">META_ADS_TOKEN</code> to Railway environment variables to activate this dashboard.
        </p>
      </div>
      <button onClick={onDismiss} className="text-amber-400 hover:text-amber-600 text-lg leading-none">&times;</button>
    </div>
  );
}

function CampaignRow({ campaign, insights, accountId, dateRange }) {
  const [expanded, setExpanded] = useState(false);
  const [adsets, setAdsets] = useState([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [expandedAdset, setExpandedAdset] = useState(null);
  const [adsetAds, setAdsetAds] = useState({});

  const ins = insights.find(i => i.campaignId === campaign.id) || {};

  async function loadAdsets() {
    if (adsets.length > 0) { setExpanded(e => !e); return; }
    setExpanded(true);
    setLoadingAdsets(true);
    try {
      const data = await apiFetch(`/api/ads/adsets?accountId=${accountId}&campaignId=${campaign.id}&dateRange=${dateRange}`);
      setAdsets(data?.insights || []);
    } finally {
      setLoadingAdsets(false);
    }
  }

  async function loadAds(adsetId) {
    if (expandedAdset === adsetId) { setExpandedAdset(null); return; }
    setExpandedAdset(adsetId);
    if (adsetAds[adsetId]) return;
    try {
      const data = await apiFetch(`/api/ads/ads?accountId=${accountId}&adsetId=${adsetId}&dateRange=${dateRange}`);
      setAdsetAds(prev => ({ ...prev, [adsetId]: data?.insights || [] }));
    } catch {}
  }

  return (
    <>
      <tr
        className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
        onClick={loadAdsets}
      >
        <td className="px-4 py-3 text-sm font-medium text-slate-800 flex items-center gap-2">
          <span className="text-slate-400">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
          {campaign.name}
        </td>
        <td className="px-4 py-3"><StatusBadge status={campaign.effective_status || campaign.status} /></td>
        <td className="px-4 py-3 text-sm text-slate-700 text-right">{ins.spend != null ? `₹${fmt(ins.spend)}` : '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-700 text-right">{ins.purchases ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-700 text-right">{ins.roas != null ? `${ins.roas}x` : '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-700 text-right">{ins.ctr != null ? `${ins.ctr}%` : '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-700 text-right">{ins.cpc != null ? `₹${ins.cpc}` : '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-700 text-right">{ins.impressions ? Number(ins.impressions).toLocaleString('en-IN') : '—'}</td>
      </tr>
      {expanded && (
        <>
          {loadingAdsets && (
            <tr><td colSpan={8} className="px-4 py-3 text-center text-sm text-slate-400">Loading ad sets…</td></tr>
          )}
          {adsets.map(adset => (
            <React.Fragment key={adset.adsetId}>
              <tr
                className="bg-slate-50 border-b border-slate-100 hover:bg-sky-50 cursor-pointer"
                onClick={() => loadAds(adset.adsetId)}
              >
                <td className="px-4 py-2 text-xs text-slate-600 pl-12 flex items-center gap-1">
                  {expandedAdset === adset.adsetId ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <span className="font-medium">{adset.adsetName}</span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">Ad Set</td>
                <td className="px-4 py-2 text-xs text-right">{adset.spend != null ? `₹${fmt(adset.spend)}` : '—'}</td>
                <td className="px-4 py-2 text-xs text-right">{adset.purchases ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-right">{adset.roas != null ? `${adset.roas}x` : '—'}</td>
                <td className="px-4 py-2 text-xs text-right">{adset.ctr != null ? `${adset.ctr}%` : '—'}</td>
                <td className="px-4 py-2 text-xs text-right">{adset.cpc != null ? `₹${adset.cpc}` : '—'}</td>
                <td className="px-4 py-2 text-xs text-right">{adset.impressions ? Number(adset.impressions).toLocaleString('en-IN') : '—'}</td>
              </tr>
              {expandedAdset === adset.adsetId && (adsetAds[adset.adsetId] || []).map(ad => (
                <tr key={ad.adId} className="bg-sky-50 border-b border-sky-100">
                  <td className="px-4 py-1.5 text-xs text-slate-500 pl-20">{ad.adName}</td>
                  <td className="px-4 py-1.5 text-xs text-slate-400">Ad</td>
                  <td className="px-4 py-1.5 text-xs text-right">{ad.spend != null ? `₹${fmt(ad.spend)}` : '—'}</td>
                  <td className="px-4 py-1.5 text-xs text-right">{ad.purchases ?? '—'}</td>
                  <td className="px-4 py-1.5 text-xs text-right">{ad.roas != null ? `${ad.roas}x` : '—'}</td>
                  <td className="px-4 py-1.5 text-xs text-right">{ad.ctr != null ? `${ad.ctr}%` : '—'}</td>
                  <td className="px-4 py-1.5 text-xs text-right">{ad.cpc != null ? `₹${ad.cpc}` : '—'}</td>
                  <td className="px-4 py-1.5 text-xs text-right">{ad.impressions ? Number(ad.impressions).toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </>
      )}
    </>
  );
}

function AccountsTab() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/marketing/accounts');
      setAccounts(data?.accounts || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!formId.startsWith('act_') || !formName.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/marketing/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: formId, accountName: formName, clientName: formName }),
      });
      setFormId(''); setFormName(''); setShowForm(false);
      loadAccounts();
    } catch {} finally { setSubmitting(false); }
  }

  async function handleRemove(id) {
    try {
      await apiFetch(`/api/marketing/accounts/${id}/request-removal`, { method: 'POST' });
      loadAccounts();
    } catch {}
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ad Accounts</p>
        <button onClick={() => setShowForm(f => !f)} className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 font-medium">
          <Plus className="w-3.5 h-3.5" /> Add Account
        </button>
      </div>
      {showForm && (
        <form onSubmit={handleAdd} className="px-6 py-3 border-b border-slate-100 bg-sky-50 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-500 font-medium">Account ID</label>
            <input value={formId} onChange={e => setFormId(e.target.value)} placeholder="act_123456789"
              className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div className="flex-1">
            <label className="text-xs text-slate-500 font-medium">Client Name</label>
            <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Client name"
              className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <button type="submit" disabled={submitting || !formId.startsWith('act_') || !formName.trim()}
            className="px-4 py-1.5 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50">
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-6 py-2 text-xs font-semibold text-slate-500">Account ID</th>
              <th className="px-6 py-2 text-xs font-semibold text-slate-500">Client Name</th>
              <th className="px-6 py-2 text-xs font-semibold text-slate-500">Status</th>
              <th className="px-6 py-2 text-xs font-semibold text-slate-500 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">Loading accounts…</td></tr>
            )}
            {!loading && accounts.length === 0 && (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">No accounts found</td></tr>
            )}
            {accounts.map(a => (
              <tr key={a.account_id || a.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-6 py-3 text-sm font-mono text-slate-700">{a.account_id || a.id}</td>
                <td className="px-6 py-3 text-sm text-slate-800">{a.client_name || a.name}</td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    a.status === 'active' ? 'bg-green-100 text-green-700' :
                    a.status === 'pending_removal' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>{a.status || 'active'}</span>
                </td>
                <td className="px-6 py-3 text-right">
                  <button onClick={() => handleRemove(a.account_id || a.id)}
                    className="text-red-400 hover:text-red-600 p-1" title="Request removal">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertsTab({ adAccounts }) {
  const STORAGE_KEY = 'ge_roas_alerts';
  const [thresholds, setThresholds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  });

  function handleChange(accountId, value) {
    setThresholds(prev => ({ ...prev, [accountId]: value }));
  }

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ROAS Alert Thresholds</p>
        <button onClick={handleSave}
          className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700">
          Save All
        </button>
      </div>
      <div className="divide-y divide-slate-100">
        {adAccounts.map(a => {
          const val = thresholds[a.id] ?? 2.0;
          const isBreach = Number(val) < 2.0;
          return (
            <div key={a.id} className="px-6 py-4 flex items-center gap-4">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isBreach ? 'bg-red-500' : 'bg-green-500'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">{a.name}</p>
                <p className="text-xs text-slate-400">{a.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Min ROAS:</label>
                <input type="number" step="0.1" min="0" value={val}
                  onChange={e => handleChange(a.id, e.target.value)}
                  className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
            </div>
          );
        })}
        {adAccounts.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-slate-400">No accounts to configure alerts for</div>
        )}
      </div>
    </div>
  );
}

export default function AdsPage() {
  const [selectedAccount, setSelectedAccount] = useState('all');
  const [dateRange, setDateRange] = useState('last_7d');
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState(null);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState('performance');
  const [adAccounts, setAdAccounts] = useState(FALLBACK_ACCOUNTS);

  // Load accounts from DB
  useEffect(() => {
    apiFetch('/api/ads/accounts')
      .then(d => {
        const accts = (d?.accounts || []).map(a => {
          const rawId = a.account_id || a.id || '';
          const id = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
          return { id, name: a.client_name || a.name || id };
        });
        if (accts.length > 0) setAdAccounts(accts);
      })
      .catch(() => {});
  }, []);

  // Check URL for tab param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && ['performance', 'accounts', 'alerts'].includes(tab)) setActiveTab(tab);
  }, []);

  const accountsToFetch = selectedAccount === 'all' ? adAccounts.map(a => a.id) : [selectedAccount];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        accountsToFetch.map(async accountId => {
          const [ins, camps] = await Promise.all([
            apiFetch(`/api/ads/insights?accountId=${accountId}&dateRange=${dateRange}&level=campaign`),
            apiFetch(`/api/ads/campaigns?accountId=${accountId}&dateRange=${dateRange}`),
          ]);
          if (ins?.error === 'token_missing') setTokenMissing(true);
          return {
            insights: ins?.insights || [],
            campaigns: camps?.campaigns || [],
          };
        })
      );
      setInsights(results.flatMap(r => r.insights));
      setCampaigns(results.flatMap(r => r.campaigns));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, dateRange]);

  useEffect(() => { loadData(); }, [loadData]);

  // Summary metrics
  const totalSpend = insights.reduce((s, i) => s + Number(i.spend || 0), 0);
  const totalPurchases = insights.reduce((s, i) => s + Number(i.purchases || 0), 0);
  const totalImpressions = insights.reduce((s, i) => s + Number(i.impressions || 0), 0);
  const totalClicks = insights.reduce((s, i) => s + Number(i.clicks || 0), 0);
  const totalPurchaseValue = insights.reduce((s, i) => s + Number(i.purchaseValue || 0), 0);
  const avgRoas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

  // Best performers
  const byRoas = [...insights].sort((a, b) => Number(b.roas) - Number(a.roas)).slice(0, 3);
  const byPurchases = [...insights].sort((a, b) => Number(b.purchases) - Number(a.purchases)).slice(0, 3);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3">
          <div className="flex items-center gap-4">
            <BarChart2 className="w-5 h-5 text-sky-600" />
            <h1 className="text-lg font-bold text-slate-900 mr-auto">Meta Ads</h1>

            {/* Account selector */}
            <select
              value={selectedAccount}
              onChange={e => setSelectedAccount(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="all">All Accounts</option>
              {adAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

            {/* Date range */}
            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>

            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-3">
            {[
              { id: 'performance', label: 'Performance', icon: BarChart2 },
              { id: 'accounts', label: 'Accounts', icon: Settings },
              { id: 'alerts', label: 'ROAS Alerts', icon: Bell },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.id ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Token missing banner */}
          {tokenMissing && !bannerDismissed && (
            <TokenMissingBanner onDismiss={() => setBannerDismissed(true)} />
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}

          {activeTab === 'performance' && (
            <>
              {/* Metrics row */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                <MetricCard label="Total Spend" value={`₹${totalSpend.toLocaleString('en-IN', {maximumFractionDigits: 0})}`} />
                <MetricCard label="Purchases" value={totalPurchases.toLocaleString('en-IN')} />
                <MetricCard label="ROAS" value={`${avgRoas.toFixed(2)}x`} />
                <MetricCard label="Avg CTR" value={`${avgCtr.toFixed(2)}%`} />
                <MetricCard label="Avg CPC" value={`₹${avgCpc.toFixed(2)}`} />
                <MetricCard label="Impressions" value={totalImpressions.toLocaleString('en-IN')} />
              </div>

              <div className="flex gap-6">
                {/* Campaigns table */}
                <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Campaigns</p>
                    <p className="text-xs text-slate-400">{campaigns.length} campaigns</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500">Campaign</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500">Status</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Spend</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Purchases</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">ROAS</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">CTR</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">CPC</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Impressions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading && !campaigns.length && [1,2,3,4,5].map(i => <SkeletonRow key={i} />)}
                        {!loading && campaigns.length === 0 && (
                          <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-sm">
                            {tokenMissing ? 'Connect Meta Ads token to see campaigns' : 'No campaigns found for this period'}
                          </td></tr>
                        )}
                        {campaigns.map(c => (
                          <CampaignRow
                            key={c.id}
                            campaign={c}
                            insights={insights}
                            accountId={accountsToFetch[0] || selectedAccount}
                            dateRange={dateRange}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Best performers panel */}
                <div className="w-72 flex-shrink-0 space-y-4">
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-green-500" /> Top ROAS
                      </p>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {byRoas.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">No data</p>}
                      {byRoas.map((ins, i) => (
                        <div key={i} className="px-4 py-3">
                          <p className="text-sm font-medium text-slate-800 truncate">{ins.campaignName || '—'}</p>
                          <p className="text-lg font-bold text-green-600">{ins.roas}x</p>
                          <p className="text-xs text-slate-400">₹{ins.spend} spend</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-sky-500" /> Top Purchases
                      </p>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {byPurchases.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">No data</p>}
                      {byPurchases.map((ins, i) => (
                        <div key={i} className="px-4 py-3">
                          <p className="text-sm font-medium text-slate-800 truncate">{ins.campaignName || '—'}</p>
                          <p className="text-lg font-bold text-sky-600">{ins.purchases}</p>
                          <p className="text-xs text-slate-400">ROAS: {ins.roas}x</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'accounts' && <AccountsTab />}

          {activeTab === 'alerts' && <AlertsTab adAccounts={adAccounts} />}
        </div>
      </main>
    </div>
  );
}
