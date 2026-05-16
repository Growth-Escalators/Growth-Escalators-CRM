import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import { BarChart2, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, AlertCircle, Settings, Bell, Plus, Trash2, MessageSquare, Send, CheckCircle, Clock, Zap } from 'lucide-react';

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
  { value: 'custom', label: 'Custom range…' },
];

const ADS_RANGE_KEY = 'ge-crm-ads-date-range';
const todayIso = () => new Date().toISOString().split('T')[0];

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

function CampaignRow({ campaign, insights, accountId, dateQS }) {
  const [expanded, setExpanded] = useState(false);
  const [adsets, setAdsets] = useState([]);
  const [loadingAdsets, setLoadingAdsets] = useState(false);
  const [expandedAdset, setExpandedAdset] = useState(null);
  const [adsetAds, setAdsetAds] = useState({});

  const ins = insights.find(i => i.campaignId === campaign.id) || {};

  async function loadAdsets() {
    if (adsets.length > 0) { setExpanded(e => !e); return; }
    if (!dateQS) return;
    setExpanded(true);
    setLoadingAdsets(true);
    try {
      const data = await apiFetch(`/api/ads/adsets?accountId=${accountId}&campaignId=${campaign.id}&${dateQS}`);
      setAdsets(data?.insights || []);
    } finally {
      setLoadingAdsets(false);
    }
  }

  async function loadAds(adsetId) {
    if (expandedAdset === adsetId) { setExpandedAdset(null); return; }
    setExpandedAdset(adsetId);
    if (adsetAds[adsetId] || !dateQS) return;
    try {
      const data = await apiFetch(`/api/ads/ads?accountId=${accountId}&adsetId=${adsetId}&${dateQS}`);
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
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

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

  async function handleEditSave(id) {
    if (!editingName.trim()) { setEditingId(null); return; }
    try {
      await apiFetch(`/api/marketing/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ clientName: editingName.trim(), accountName: editingName.trim() }),
      });
      loadAccounts();
    } catch {}
    setEditingId(null);
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
            {accounts.map(a => {
              const metaId = a.accountId || a.account_id || '';
              const name = a.clientName || a.client_name || a.accountName || a.account_name || '';
              const status = a.isActive === false ? 'inactive' : (a.removalRequestedAt || a.removal_requested_at) ? 'pending_removal' : 'active';
              return (
                <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm font-mono text-slate-700">{metaId}</td>
                  <td className="px-6 py-3 text-sm text-slate-800 font-medium">
                    {editingId === a.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => handleEditSave(a.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleEditSave(a.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="w-full text-sm border border-sky-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    ) : (
                      <span className="flex items-center gap-2 group">
                        {name || '—'}
                        <button
                          onClick={() => { setEditingId(a.id); setEditingName(name); }}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-sky-600 transition-opacity"
                          title="Edit name"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      status === 'active' ? 'bg-green-100 text-green-700' :
                      status === 'pending_removal' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>{status}</span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => handleRemove(a.id)}
                      className="text-red-400 hover:text-red-600 p-1" title="Request removal">
                      <Trash2 className="w-4 h-4" />
                    </button>
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

function AlertsTab({ adAccounts }) {
  const [thresholds, setThresholds] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/ads/settings')
      .then(d => { if (d?.roasThresholds) setThresholds(d.roasThresholds); })
      .catch(() => {});
  }, []);

  function handleChange(accountId, value) {
    setThresholds(prev => ({ ...prev, [accountId]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch('/api/ads/settings', {
        method: 'PATCH',
        body: JSON.stringify({ roasThresholds: thresholds }),
      });
    } catch {} finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ROAS Alert Thresholds</p>
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save All'}
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

function SlackAutomationTab({ adAccounts, insights, dateRange, customSince, customUntil }) {
  // Build the Slack request body that the backend resolveDateRange() expects.
  function rangePayload() {
    if (dateRange === 'custom' && customSince && customUntil) {
      return { dateRange: 'custom', since: customSince, until: customUntil };
    }
    return { dateRange };
  }
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const [automations, setAutomations] = useState({});

  useEffect(() => {
    apiFetch('/api/ads/settings')
      .then(d => { if (d?.slackAutomations) setAutomations(d.slackAutomations); })
      .catch(() => {});
  }, []);

  async function saveAutomations(next) {
    setAutomations(next);
    try {
      await apiFetch('/api/ads/settings', {
        method: 'PATCH',
        body: JSON.stringify({ slackAutomations: next }),
      });
    } catch {}
  }

  function toggleAutomation(key) {
    saveAutomations({ ...automations, [key]: !automations[key] });
  }

  async function sendSlackDigest() {
    setSending(true);
    try {
      const data = await apiFetch('/api/ads/slack-digest', {
        method: 'POST',
        body: JSON.stringify(rangePayload()),
      });
      setToast(data?.sent ? 'Digest sent to Slack!' : (data?.error || 'Failed to send'));
    } catch (e) {
      setToast('Failed: ' + e.message);
    }
    setSending(false);
  }

  async function sendSlackAlert(type) {
    setSending(true);
    try {
      const data = await apiFetch('/api/ads/slack-alert', {
        method: 'POST',
        body: JSON.stringify({ type, ...rangePayload() }),
      });
      setToast(data?.sent ? `${type} alert sent!` : (data?.error || 'Failed'));
    } catch (e) {
      setToast('Failed: ' + e.message);
    }
    setSending(false);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const AUTOMATION_PRESETS = [
    { key: 'daily_digest', label: 'Daily Performance Digest', desc: 'Auto-send spend, ROAS, purchases summary to Slack at 10 AM', icon: Clock },
    { key: 'roas_drop', label: 'ROAS Drop Alert', desc: 'Notify when any account ROAS drops below threshold', icon: TrendingDown },
    { key: 'high_spend', label: 'High Spend Alert', desc: 'Alert when daily spend exceeds ₹10K on any account', icon: AlertCircle },
    { key: 'zero_purchases', label: 'Zero Purchases Alert', desc: 'Alert when an active campaign gets 0 purchases for the day', icon: Zap },
  ];

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Send className="w-3.5 h-3.5 text-sky-500" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Quick Slack Actions</p>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={sendSlackDigest}
            disabled={sending}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-dashed border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-all disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-sky-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Send Performance Digest</p>
              <p className="text-xs text-slate-500 mt-0.5">Spend, ROAS, top campaigns → #performance-marketing</p>
            </div>
          </button>

          <button
            onClick={() => sendSlackAlert('roas_check')}
            disabled={sending}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-dashed border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition-all disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-amber-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Check ROAS Now</p>
              <p className="text-xs text-slate-500 mt-0.5">Flag underperforming campaigns</p>
            </div>
          </button>

          <button
            onClick={() => sendSlackAlert('spend_check')}
            disabled={sending}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-dashed border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Spend Summary</p>
              <p className="text-xs text-slate-500 mt-0.5">Current spend across all accounts</p>
            </div>
          </button>
        </div>
      </div>

      {/* Automation Toggles */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-purple-500" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Automated Slack Alerts</p>
          <span className="ml-auto text-xs text-slate-400">Runs via daily CRON</span>
        </div>
        <div className="divide-y divide-slate-100">
          {AUTOMATION_PRESETS.map(a => {
            const enabled = !!automations[a.key];
            return (
              <div key={a.key} className="px-6 py-4 flex items-center gap-4">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${enabled ? 'bg-purple-100' : 'bg-slate-100'}`}>
                  <a.icon className={`w-4 h-4 ${enabled ? 'text-purple-600' : 'text-slate-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{a.label}</p>
                  <p className="text-xs text-slate-500">{a.desc}</p>
                </div>
                <button
                  onClick={() => toggleAutomation(a.key)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-purple-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5.5 left-auto right-0.5' : 'left-0.5'}`}
                    style={enabled ? { left: 'auto', right: '2px' } : { left: '2px' }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Slack Channel Config */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-4 h-4 text-slate-500" />
          <p className="text-sm font-semibold text-slate-800">Slack Channel</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
            <span className="text-sm text-slate-500">#</span>
            <span className="text-sm font-medium text-slate-800">performance-marketing</span>
          </div>
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span className="text-xs text-green-600 font-medium">Connected</span>
          <span className="text-xs text-slate-400 ml-auto">Digests go to #performance-marketing, alerts DM to Jatin</span>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function AdsPage() {
  const [selectedAccount, setSelectedAccount] = useState('all');
  // Hydrate dateRange + custom dates from localStorage so refresh keeps the
  // user's window. Persisted shape: { preset, since, until, applied }.
  const persisted = (() => {
    try {
      const raw = localStorage.getItem(ADS_RANGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object' && DATE_RANGES.some(r => r.value === p.preset)) return p;
    } catch { /* ignore */ }
    return null;
  })();
  const [dateRange, setDateRange] = useState(persisted?.preset || 'last_7d');
  const [customSince, setCustomSince] = useState(persisted?.since || '');
  const [customUntil, setCustomUntil] = useState(persisted?.until || '');
  const [customApplied, setCustomApplied] = useState(
    persisted?.preset === 'custom' && !!persisted?.since && !!persisted?.until,
  );
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState(null);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState('performance');
  const [adAccounts, setAdAccounts] = useState(FALLBACK_ACCOUNTS);
  const [aiInsights, setAiInsights] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

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
    if (tab && ['performance', 'accounts', 'alerts', 'slack'].includes(tab)) setActiveTab(tab);
  }, []);

  const accountsToFetch = selectedAccount === 'all' ? adAccounts.map(a => a.id) : [selectedAccount];

  // Single source of truth for the date-range query string. Re-fetches whenever
  // the preset changes OR the user clicks "Apply" in custom mode.
  const dateQS = useMemo(() => {
    if (dateRange === 'custom') {
      if (!customApplied || !customSince || !customUntil) return null; // gate fetch
      return `dateRange=custom&since=${customSince}&until=${customUntil}`;
    }
    return `dateRange=${dateRange}`;
  }, [dateRange, customApplied, customSince, customUntil]);

  // Persist preset + custom dates so refresh keeps the window.
  useEffect(() => {
    try {
      localStorage.setItem(ADS_RANGE_KEY, JSON.stringify({
        preset: dateRange,
        since: customSince,
        until: customUntil,
      }));
    } catch { /* ignore */ }
  }, [dateRange, customSince, customUntil]);

  const loadData = useCallback(async () => {
    if (!dateQS) return; // custom mode without applied dates → wait
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        accountsToFetch.map(async accountId => {
          const [ins, camps] = await Promise.all([
            apiFetch(`/api/ads/insights?accountId=${accountId}&${dateQS}&level=campaign`),
            apiFetch(`/api/ads/campaigns?accountId=${accountId}&${dateQS}`),
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
  }, [selectedAccount, dateQS]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadInsights = useCallback(async () => {
    if (insights.length === 0) return;
    setInsightsLoading(true);
    try {
      const spend = insights.reduce((s, i) => s + Number(i.spend || 0), 0);
      const purchases = insights.reduce((s, i) => s + Number(i.purchases || 0), 0);
      const impr = insights.reduce((s, i) => s + Number(i.impressions || 0), 0);
      const clicks = insights.reduce((s, i) => s + Number(i.clicks || 0), 0);
      const pval = insights.reduce((s, i) => s + Number(i.purchaseValue || 0), 0);
      const topCampaigns = [...insights]
        .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
        .slice(0, 5)
        .map(i => ({ name: i.campaignName || '', spend: Number(i.spend || 0), purchases: Number(i.purchases || 0), roas: Number(i.roas || 0) }));
      const body = {
        metrics: {
          totalSpend: spend,
          totalPurchases: purchases,
          avgRoas: spend > 0 ? pval / spend : 0,
          avgCtr: impr > 0 ? (clicks / impr) * 100 : 0,
          avgCpc: clicks > 0 ? spend / clicks : 0,
          totalImpressions: impr,
          topCampaigns,
        },
        dateRange,
        ...(dateRange === 'custom' && customSince && customUntil
          ? { since: customSince, until: customUntil }
          : {}),
      };
      const data = await apiFetch('/api/ads/ai-insights', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAiInsights(data?.insights || []);
    } catch { setAiInsights([]); }
    setInsightsLoading(false);
  }, [insights, dateRange, customSince, customUntil]);

  useEffect(() => {
    if (activeTab === 'performance' && insights.length > 0) loadInsights();
  }, [activeTab, insights]);

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
              onChange={e => {
                setDateRange(e.target.value);
                // Switching off custom resets the applied flag so the next
                // fetch uses the new preset immediately.
                if (e.target.value !== 'custom') setCustomApplied(false);
              }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>

            {dateRange === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customSince}
                  max={customUntil || todayIso()}
                  onChange={e => { setCustomSince(e.target.value); setCustomApplied(false); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customSince && customUntil) setCustomApplied(true);
                  }}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  aria-label="Start date"
                />
                <span className="text-xs text-slate-400">→</span>
                <input
                  type="date"
                  value={customUntil}
                  min={customSince || undefined}
                  max={todayIso()}
                  onChange={e => { setCustomUntil(e.target.value); setCustomApplied(false); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customSince && customUntil) setCustomApplied(true);
                  }}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  aria-label="End date"
                />
                <button
                  type="button"
                  onClick={() => setCustomApplied(true)}
                  disabled={!customSince || !customUntil || customApplied}
                  className="text-sm bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-3 py-1.5 rounded-lg"
                >
                  {customApplied ? 'Applied' : 'Apply'}
                </button>
              </div>
            )}

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
              { id: 'slack', label: 'Slack Automation', icon: MessageSquare },
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

              {/* AI Insights panel */}
              {(insightsLoading || aiInsights.length > 0) && (
                <div className="mb-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-slate-50 flex items-center gap-2">
                    <svg className="w-4 h-4 text-violet-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">AI Insights</p>
                    <span className="text-xs text-slate-400">claude-sonnet · {
                      dateRange === 'custom' && customSince && customUntil
                        ? `${customSince} → ${customUntil}`
                        : DATE_RANGES.find(r => r.value === dateRange)?.label || dateRange
                    }</span>
                    <button onClick={loadInsights} disabled={insightsLoading}
                      className="ml-auto flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 disabled:opacity-50 font-medium">
                      <RefreshCw className={`w-3 h-3 ${insightsLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {insightsLoading ? (
                      [1, 2, 3].map(i => (
                        <div key={i} className="rounded-lg border border-slate-100 p-4 space-y-2">
                          <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                          <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
                          <div className="h-3 bg-slate-100 rounded animate-pulse w-5/6" />
                        </div>
                      ))
                    ) : (
                      aiInsights.map((ins, i) => {
                        const colors = {
                          positive: 'bg-green-50 border-green-200',
                          warning: 'bg-amber-50 border-amber-200',
                          opportunity: 'bg-blue-50 border-blue-200',
                        };
                        const titleColors = {
                          positive: 'text-green-800',
                          warning: 'text-amber-800',
                          opportunity: 'text-blue-800',
                        };
                        const bodyColors = {
                          positive: 'text-green-700',
                          warning: 'text-amber-700',
                          opportunity: 'text-blue-700',
                        };
                        const t = ins.type || 'opportunity';
                        return (
                          <div key={i} className={`rounded-lg border p-4 ${colors[t] || colors.opportunity}`}>
                            <p className={`text-sm font-semibold mb-1 ${titleColors[t] || titleColors.opportunity}`}>{ins.title}</p>
                            <p className={`text-xs leading-relaxed ${bodyColors[t] || bodyColors.opportunity}`}>{ins.body}</p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

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
                            dateQS={dateQS}
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

          {activeTab === 'slack' && <SlackAutomationTab adAccounts={adAccounts} insights={insights} dateRange={dateRange} customSince={customSince} customUntil={customUntil} />}
        </div>
      </main>
    </div>
  );
}
