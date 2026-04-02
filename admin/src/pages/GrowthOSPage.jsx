import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function fmt(n) {
  if (!n && n !== 0) return '₹0';
  return '₹' + Number(n).toLocaleString('en-IN');
}

function scoreColor(s) {
  if (s >= 80) return 'text-emerald-400';
  if (s >= 60) return 'text-sky-400';
  if (s >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBg(s) {
  if (s >= 80) return 'border-emerald-400';
  if (s >= 60) return 'border-sky-400';
  if (s >= 40) return 'border-amber-400';
  return 'border-red-400';
}

function fatigueColor(status) {
  if (status === 'saturated' || status === 'fatiguing') return 'text-red-400 bg-red-400/10';
  if (status === 'aging') return 'text-amber-400 bg-amber-400/10';
  return 'text-emerald-400 bg-emerald-400/10';
}

function fatigueEmoji(status) {
  if (status === 'saturated') return '🔴 Saturated';
  if (status === 'fatiguing') return '🔴 Fatiguing';
  if (status === 'aging') return '🟡 Aging';
  return '🟢 Healthy';
}

// ---------------------------------------------------------------------------
// Score Circle
// ---------------------------------------------------------------------------

function ScoreCircle({ score }) {
  const r = 52, c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score || 0));
  const dash = (pct / 100) * c;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#1e293b" strokeWidth="12" />
      <circle cx="70" cy="70" r={r} fill="none"
        stroke={pct >= 80 ? '#34d399' : pct >= 60 ? '#38bdf8' : pct >= 40 ? '#fbbf24' : '#f87171'}
        strokeWidth="12" strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round" transform="rotate(-90 70 70)" />
      <text x="70" y="67" textAnchor="middle" fontSize="28" fontWeight="bold"
        fill={pct >= 80 ? '#34d399' : pct >= 60 ? '#38bdf8' : pct >= 40 ? '#fbbf24' : '#f87171'}>
        {pct}
      </text>
      <text x="70" y="85" textAnchor="middle" fontSize="11" fill="#64748b">/100</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mini Trend SVG
// ---------------------------------------------------------------------------

function TrendLine({ scores }) {
  if (!scores || scores.length < 2) return <span className="text-slate-500 text-xs">No trend data</span>;
  const vals = scores.map(s => s.overall_score || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const W = 200, H = 40;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ');
  return (
    <svg width={W} height={H + 4}>
      <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({ clients, selectedClient, setSelectedClient }) {
  const [scores, setScores] = useState([]);
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!selectedClient) return;
    setLoading(true);
    apiFetch(`/api/growth-os/health/${encodeURIComponent(selectedClient)}`)
      .then(d => { setScores(d?.scores ?? []); setLatest(d?.latest ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient]);

  async function generate() {
    setGenerating(true);
    try {
      await apiFetch('/api/growth-os/health/generate', { method: 'POST' });
      setTimeout(() => {
        apiFetch(`/api/growth-os/health/${encodeURIComponent(selectedClient)}`)
          .then(d => { setScores(d?.scores ?? []); setLatest(d?.latest ?? null); });
        setGenerating(false);
      }, 8000);
    } catch { setGenerating(false); }
  }

  const alerts = parseJson(latest?.alerts) ?? [];
  const overall = latest?.overall_score ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <select
          value={selectedClient}
          onChange={e => setSelectedClient(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm"
        >
          {clients.map(c => <option key={c.client_name} value={c.client_name}>{c.client_name}</option>)}
        </select>
        <button onClick={generate} disabled={generating}
          className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50">
          {generating ? 'Generating…' : 'Generate Score'}
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}

      {!loading && latest && (
        <>
          <div className="flex gap-6 items-center mb-6">
            <div className="flex flex-col items-center">
              <ScoreCircle score={overall} />
              <p className="text-slate-400 text-xs mt-1">Brand Health</p>
              {latest.score_change !== 0 && latest.score_change != null && (
                <p className={`text-xs font-medium ${latest.score_change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {latest.score_change > 0 ? `↑ ${latest.score_change}` : `↓ ${Math.abs(latest.score_change)}`} from yesterday
                </p>
              )}
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              {[
                { label: 'Ads', value: latest.ads_score, icon: '📊' },
                { label: 'SEO', value: latest.seo_score, icon: '🔍' },
                { label: 'WhatsApp', value: latest.whatsapp_score, icon: '💬' },
                { label: 'Email', value: latest.email_score, icon: '📧' },
                { label: 'Retention', value: latest.retention_score, icon: '🔄' },
              ].map(item => (
                <div key={item.label} className="bg-slate-800 rounded-xl p-3 border border-slate-700">
                  <p className="text-slate-400 text-xs mb-1">{item.icon} {item.label}</p>
                  <p className={`text-xl font-bold ${scoreColor(item.value)}`}>{item.value ?? '--'}<span className="text-xs text-slate-500">/100</span></p>
                </div>
              ))}
            </div>
          </div>

          {scores.length > 1 && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-4">
              <p className="text-slate-400 text-xs mb-2">30-day trend</p>
              <TrendLine scores={[...scores].reverse()} />
            </div>
          )}

          {alerts.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4 border border-amber-500/30">
              <p className="text-amber-400 text-sm font-medium mb-2">⚠️ Active Alerts</p>
              {alerts.map((a, i) => (
                <div key={i} className="text-sm text-slate-300 mb-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs mr-2 ${a.severity === 'high' ? 'bg-red-400/20 text-red-400' : 'bg-amber-400/20 text-amber-400'}`}>{a.severity}</span>
                  {a.message}
                </div>
              ))}
            </div>
          )}

          {alerts.length === 0 && (
            <div className="bg-emerald-400/10 border border-emerald-400/30 rounded-xl p-4 text-emerald-400 text-sm">
              ✅ All systems healthy today
            </div>
          )}
        </>
      )}

      {!loading && !latest && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">No health data yet</p>
          <p className="text-sm">Click "Generate Score" to calculate the first score</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money on Table Tab
// ---------------------------------------------------------------------------

function MoneyTab({ clients, selectedClient }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!selectedClient) return;
    setLoading(true);
    apiFetch(`/api/growth-os/opportunity/${encodeURIComponent(selectedClient)}`)
      .then(d => setReport(d?.latest ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient]);

  async function generate() {
    setGenerating(true);
    try {
      await apiFetch('/api/growth-os/opportunity/generate', { method: 'POST' });
      setTimeout(() => {
        apiFetch(`/api/growth-os/opportunity/${encodeURIComponent(selectedClient)}`)
          .then(d => setReport(d?.latest ?? null));
        setGenerating(false);
      }, 8000);
    } catch { setGenerating(false); }
  }

  const detail = parseJson(report?.detail) ?? {};

  const opportunities = report ? [
    { name: '🛒 Cart Abandonment', value: report.cart_abandonment_opportunity, status: detail.has_cart_sequence ? '✅ Sequence running' : '❌ No recovery sequence' },
    { name: '😴 Lapsed Customers', value: report.winback_opportunity, status: detail.has_winback_sequence ? '✅ Win-back running' : '❌ No win-back' },
    { name: '📱 WhatsApp Opt-ins', value: report.whatsapp_optin_opportunity, status: `~${detail.missed_optins_per_month ?? 0} contacts/month not captured` },
    { name: '📧 Email Gaps', value: report.email_sequence_opportunity, status: `${(detail.missing_sequences ?? []).length} sequences missing` },
    { name: '💎 Upsell Missed', value: report.upsell_opportunity, status: 'Based on order history' },
  ] : [];

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button onClick={generate} disabled={generating}
          className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50">
          {generating ? 'Calculating…' : 'Recalculate'}
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}

      {!loading && report && (
        <>
          <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-2xl p-6 mb-6 text-center">
            <p className="text-slate-400 text-sm mb-1">Money Left on Table This Week</p>
            <p className="text-4xl font-bold text-amber-400">{fmt(report.total_opportunity)}</p>
          </div>

          <div className="space-y-3 mb-6">
            {opportunities.map(o => (
              <div key={o.name} className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">{o.name}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{o.status}</p>
                </div>
                <p className="text-amber-400 font-bold text-lg">{fmt(o.value)}</p>
              </div>
            ))}
          </div>

          <div className="bg-slate-800 rounded-xl p-4 border border-sky-500/30">
            <p className="text-sky-400 font-medium mb-2">ROI Calculator</p>
            <p className="text-slate-400 text-sm">Your Growth OS fee: <span className="text-white font-medium">₹35,000/mo</span></p>
            <p className="text-slate-400 text-sm">If we capture just 10%: <span className="text-emerald-400 font-bold">{fmt(report.total_opportunity * 0.1)}</span> ROI</p>
          </div>
        </>
      )}

      {!loading && !report && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">No opportunity data yet</p>
          <p className="text-sm">Click "Recalculate" to run the first analysis</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creatives Tab
// ---------------------------------------------------------------------------

function CreativesTab({ clients, selectedClient }) {
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const client = clients.find(c => c.client_name === selectedClient);

  useEffect(() => {
    if (!client?.ad_account_id) return;
    setLoading(true);
    apiFetch(`/api/growth-os/creatives/${encodeURIComponent(client.ad_account_id)}`)
      .then(d => setCreatives(d?.creatives ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient, client?.ad_account_id]);

  async function scan() {
    setScanning(true);
    try {
      await apiFetch('/api/growth-os/creatives/scan', { method: 'POST' });
      setTimeout(() => {
        if (client?.ad_account_id) {
          apiFetch(`/api/growth-os/creatives/${encodeURIComponent(client.ad_account_id)}`)
            .then(d => setCreatives(d?.creatives ?? []));
        }
        setScanning(false);
      }, 15000);
    } catch { setScanning(false); }
  }

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button onClick={scan} disabled={scanning}
          className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50">
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}

      {!loading && creatives.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-6 gap-2 px-3 text-xs text-slate-500 mb-1">
            <span className="col-span-2">Ad Name</span>
            <span>Days</span><span>ROAS</span><span>CTR%</span><span>Status</span>
          </div>
          {creatives.map(c => (
            <div key={c.id}>
              <div
                className="bg-slate-800 rounded-xl p-3 border border-slate-700 grid grid-cols-6 gap-2 items-center cursor-pointer hover:border-slate-500"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                <div className="col-span-2">
                  <p className="text-white text-sm font-medium truncate">{c.ad_name}</p>
                  <p className="text-slate-500 text-xs truncate">{c.campaign_name}</p>
                </div>
                <span className="text-slate-300 text-sm">{c.days_running ?? 0}d</span>
                <span className="text-slate-300 text-sm">{Number(c.latest_roas ?? 0).toFixed(2)}x</span>
                <span className="text-slate-300 text-sm">{Number(c.latest_ctr ?? 0).toFixed(2)}%</span>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${fatigueColor(c.fatigue_status)}`}>
                  {fatigueEmoji(c.fatigue_status)}
                </span>
              </div>
              {expanded === c.id && (
                <div className="bg-slate-900 border border-slate-700 border-t-0 rounded-b-xl p-4 text-sm">
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div><p className="text-slate-500 text-xs">Peak ROAS</p><p className="text-white">{Number(c.peak_roas ?? 0).toFixed(2)}x</p></div>
                    <div><p className="text-slate-500 text-xs">Peak CTR</p><p className="text-white">{Number(c.peak_ctr ?? 0).toFixed(2)}%</p></div>
                    <div><p className="text-slate-500 text-xs">Frequency</p><p className={Number(c.latest_frequency) >= 3.5 ? 'text-red-400' : 'text-white'}>{Number(c.latest_frequency ?? 0).toFixed(1)}</p></div>
                    <div><p className="text-slate-500 text-xs">Spend to Date</p><p className="text-white">{fmt(c.spend_to_date)}</p></div>
                    <div><p className="text-slate-500 text-xs">First Seen</p><p className="text-white">{c.first_seen?.slice(0, 10) ?? '--'}</p></div>
                  </div>
                  {c.creative_brief && (
                    <div className="bg-slate-800 rounded-lg p-3">
                      <p className="text-amber-400 text-xs font-medium mb-2">🎨 Creative Brief</p>
                      <p className="text-slate-300 text-xs whitespace-pre-line">{c.creative_brief}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && creatives.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">No creative data yet</p>
          <p className="text-sm">Click "Scan Now" to analyse active ads</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitor Tab
// ---------------------------------------------------------------------------

function CompetitorTab({ clients, selectedClient }) {
  const [pulse, setPulse] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!selectedClient) return;
    setLoading(true);
    apiFetch(`/api/growth-os/competitor/${encodeURIComponent(selectedClient)}`)
      .then(d => setPulse(d?.pulse ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient]);

  async function runPulse() {
    setRunning(true);
    try {
      await apiFetch('/api/growth-os/competitor/run', { method: 'POST' });
      setTimeout(() => {
        apiFetch(`/api/growth-os/competitor/${encodeURIComponent(selectedClient)}`)
          .then(d => setPulse(d?.pulse ?? []));
        setRunning(false);
      }, 30000);
    } catch { setRunning(false); }
  }

  const latest = pulse[0];
  const trending = parseJson(latest?.trending_formats) ?? [];
  const offers = parseJson(latest?.new_offers) ?? [];
  const recs = parseJson(latest?.recommendations) ?? [];

  return (
    <div>
      <div className="flex justify-end mb-6">
        <button onClick={runPulse} disabled={running}
          className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50">
          {running ? 'Running…' : 'Run Pulse'}
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}

      {!loading && latest && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-slate-400 text-xs mb-1">Competitor</p>
              <p className="text-white font-medium">{latest.competitor_name ?? 'Multiple'}</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-slate-400 text-xs mb-1">Ads Found</p>
              <p className="text-white font-medium">{latest.ads_found ?? 0}</p>
            </div>
          </div>

          {trending.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-amber-400 text-sm font-medium mb-2">🔥 Trending Formats</p>
              {trending.map((f, i) => <p key={i} className="text-slate-300 text-sm">• {f}</p>)}
            </div>
          )}

          {offers.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-emerald-400 text-sm font-medium mb-2">💰 New Offers Spotted</p>
              {offers.map((o, i) => <p key={i} className="text-slate-300 text-sm">• {o}</p>)}
            </div>
          )}

          {latest.insights && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-sky-400 text-sm font-medium mb-2">💡 Strategic Insights</p>
              <p className="text-slate-300 text-sm">{latest.insights}</p>
            </div>
          )}

          {recs.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4 border border-sky-500/30">
              <p className="text-sky-400 text-sm font-medium mb-2">🎯 Recommendations</p>
              {recs.map((r, i) => <p key={i} className="text-slate-300 text-sm">• {r}</p>)}
            </div>
          )}
        </div>
      )}

      {!loading && !latest && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">No competitor data yet</p>
          <p className="text-sm">Click "Run Pulse" or wait for Friday 9 AM IST cron</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Co-Pilot Tab
// ---------------------------------------------------------------------------

function CopilotTab({ selectedClient }) {
  const [convs, setConvs] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!selectedClient) return;
    setLoading(true);
    apiFetch(`/api/growth-os/copilot/${encodeURIComponent(selectedClient)}`)
      .then(d => setConvs(d?.conversations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClient]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400 text-sm font-medium">Co-Pilot Active</span>
          <span className="text-slate-500 text-xs">· Listening on WhatsApp · Polled every 2 min</span>
        </div>
        <button onClick={load} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 bg-slate-800 rounded-lg">Refresh</button>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-3 mb-4 text-xs text-slate-400">
        Send any message starting with: <code className="bg-slate-700 px-1 rounded">?</code> <code className="bg-slate-700 px-1 rounded">how</code> <code className="bg-slate-700 px-1 rounded">should</code> <code className="bg-slate-700 px-1 rounded">what</code> <code className="bg-slate-700 px-1 rounded">why</code> <code className="bg-slate-700 px-1 rounded">is</code> <code className="bg-slate-700 px-1 rounded">can</code> <code className="bg-slate-700 px-1 rounded">show</code>
        &nbsp;from your founder WhatsApp to trigger the Co-Pilot.
      </div>

      {loading && <p className="text-slate-400 text-sm text-center py-8">Loading…</p>}

      {!loading && convs.length > 0 && (
        <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
          {convs.map(c => (
            <div key={c.id} className="space-y-2">
              <div className="flex justify-end">
                <div className="bg-sky-600/20 border border-sky-600/30 rounded-2xl rounded-tr-sm px-4 py-2 max-w-xs">
                  <p className="text-white text-sm">{c.message}</p>
                  <p className="text-sky-400/60 text-xs mt-1 text-right">{new Date(c.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm px-4 py-2 max-w-sm">
                  <p className="text-slate-300 text-sm whitespace-pre-line">{c.response}</p>
                  <p className="text-slate-500 text-xs mt-1">{c.tokens_used ? `~${c.tokens_used} tokens` : ''}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && convs.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">No conversations yet</p>
          <p className="text-sm">Send a question from the founder's WhatsApp number to start</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'money', label: '💰 Money on Table' },
  { id: 'creatives', label: '🎨 Creatives' },
  { id: 'competitor', label: '🔍 Competitor' },
  { id: 'copilot', label: '🤖 Co-Pilot' },
];

export default function GrowthOSPage() {
  const [tab, setTab] = useState('overview');
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');

  useEffect(() => {
    apiFetch('/api/growth-os/clients')
      .then(d => {
        const list = d?.clients ?? [];
        setClients(list);
        if (list.length > 0 && !selectedClient) setSelectedClient(list[0].client_name);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              ⚡ Growth OS
            </h1>
            <p className="text-slate-400 text-sm">D2C Intelligence Layer — Brand health, opportunities, and AI co-pilot</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {tab === 'overview' && <OverviewTab clients={clients} selectedClient={selectedClient} setSelectedClient={setSelectedClient} />}
          {tab === 'money' && <MoneyTab clients={clients} selectedClient={selectedClient} />}
          {tab === 'creatives' && <CreativesTab clients={clients} selectedClient={selectedClient} />}
          {tab === 'competitor' && <CompetitorTab clients={clients} selectedClient={selectedClient} />}
          {tab === 'copilot' && <CopilotTab selectedClient={selectedClient} />}
        </div>
      </div>
    </div>
  );
}
