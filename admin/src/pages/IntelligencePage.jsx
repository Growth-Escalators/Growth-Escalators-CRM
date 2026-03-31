import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Brain, Sparkles, RefreshCw, TrendingUp, AlertTriangle,
  CheckCircle, ChevronDown, ChevronRight, Eye, EyeOff,
  Zap, Target, Users, BarChart2, Search, Activity, Cpu, ExternalLink
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function scoreColor(s) {
  if (s >= 90) return 'text-emerald-500';
  if (s >= 75) return 'text-sky-500';
  if (s >= 60) return 'text-yellow-500';
  return 'text-red-500';
}

function scoreBg(s) {
  if (s >= 90) return 'bg-emerald-50 border-emerald-200';
  if (s >= 75) return 'bg-sky-50 border-sky-200';
  if (s >= 60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

function scoreRing(s) {
  if (s >= 90) return '#10b981';
  if (s >= 75) return '#0ea5e9';
  if (s >= 60) return '#eab308';
  return '#ef4444';
}

function scoreEmoji(s) {
  if (s >= 90) return '🚀';
  if (s >= 75) return '✅';
  if (s >= 60) return '🟡';
  return '🔴';
}

function severityColor(s) {
  if (s === 'high')   return 'bg-red-100 text-red-700 border-red-200';
  if (s === 'medium') return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function priorityColor(p) {
  if (p === 'urgent') return 'bg-red-100 text-red-700';
  if (p === 'high')   return 'bg-orange-100 text-orange-700';
  return 'bg-blue-100 text-blue-700';
}

function ownerColor(o) {
  const map = {
    Jatin:   'bg-purple-100 text-purple-700',
    Sakcham: 'bg-orange-100 text-orange-700',
    Vishal:  'bg-sky-100 text-sky-700',
    Nimisha: 'bg-pink-100 text-pink-700',
    Keshav:  'bg-emerald-100 text-emerald-700',
  };
  return map[o] ?? 'bg-slate-100 text-slate-700';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function parseJson(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Score circle (SVG)
// ---------------------------------------------------------------------------
function ScoreCircle({ score, size = 120, label }) {
  const r = (size / 2) - 10;
  const circ = 2 * Math.PI * r;
  const dash = circ * (score / 100);
  const color = scoreRing(score);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2 + 8} textAnchor="middle" fontSize="22" fontWeight="700" fill={color}>
          {score}
        </text>
      </svg>
      {label && <p className="text-xs text-slate-500">{label}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini score card
// ---------------------------------------------------------------------------
function ScoreCard({ label, score, icon: Icon }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${scoreBg(score)}`}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${scoreColor(score)}`} />
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`text-xl font-bold ${scoreColor(score)}`}>{score}<span className="text-xs font-normal text-slate-400">/100</span></p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG line chart (no recharts)
// ---------------------------------------------------------------------------
function ScoreTrendChart({ scores }) {
  if (!scores || scores.length < 2) {
    return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No trend data yet</div>;
  }
  const sorted = [...scores].reverse(); // oldest first
  const W = 640, H = 200;
  const PAD = { top: 16, right: 16, bottom: 36, left: 36 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  const x = i => PAD.left + (i / (sorted.length - 1)) * iW;
  const y = v => PAD.top + iH - ((v ?? 0) / 100) * iH;

  const lines = [
    { key: 'overall_score', color: '#6366f1', label: 'Overall', width: 3 },
    { key: 'ads_score',     color: '#0ea5e9', label: 'Ads',     width: 1.5 },
    { key: 'seo_score',     color: '#10b981', label: 'SEO',     width: 1.5 },
    { key: 'sales_score',   color: '#f97316', label: 'Sales',   width: 1.5 },
    { key: 'ops_score',     color: '#a855f7', label: 'Ops',     width: 1.5 },
  ];

  const toPath = key =>
    sorted.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(Number(d[key] ?? 0)).toFixed(1)}`).join(' ');

  const xTick = Math.ceil(sorted.length / 6);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 360 }}>
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={PAD.left + iW} y2={y(v)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
          </g>
        ))}
        {lines.map(l => (
          <path key={l.key} d={toPath(l.key)} fill="none" stroke={l.color}
            strokeWidth={l.width} strokeLinejoin="round" />
        ))}
        {sorted.filter((_, i) => i % xTick === 0 || i === sorted.length - 1).map((d, _, arr) => {
          const origIdx = sorted.indexOf(d);
          return (
            <text key={origIdx} x={x(origIdx)} y={H - 4}
              textAnchor="middle" fontSize="9" fill="#94a3b8">
              {String(d.report_date ?? '').slice(5)}
            </text>
          );
        })}
        {/* Legend */}
        {lines.map((l, i) => (
          <g key={l.key} transform={`translate(${PAD.left + i * 90}, 0)`}>
            <line x1="0" y1="5" x2="14" y2="5" stroke={l.color} strokeWidth={l.width === 3 ? 3 : 1.5} />
            <text x="18" y="9" fontSize="9" fill="#475569">{l.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SEO Workflow Health panel (shown before wins/problems when workflows broken)
// ---------------------------------------------------------------------------
function SEOWorkflowHealthSection({ wfData }) {
  if (!wfData) return null;

  const allHealthy = wfData.allHealthy;
  const n8nOnline  = wfData.n8nAlive;
  const total      = wfData.totalCount || 0;
  const healthy    = wfData.healthyCount || 0;
  const pct        = total > 0 ? Math.round((healthy / total) * 100) : 0;
  const workflows  = wfData.workflows || [];

  const barColor = allHealthy ? 'bg-emerald-500' : (pct >= 70 ? 'bg-yellow-400' : 'bg-red-500');

  return (
    <div className={`rounded-xl border p-4 ${allHealthy ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-3 mb-3">
        <Cpu className={`w-4 h-4 flex-shrink-0 ${allHealthy ? 'text-emerald-500' : 'text-orange-500'}`} />
        <p className="text-sm font-semibold text-slate-800">SEO Workflow Health</p>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${n8nOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          n8n {n8nOnline ? '🟢 Online' : '🔴 Offline'}
        </span>
        <a href="/crm/seo" className="flex items-center gap-1 text-xs text-sky-600 hover:underline">
          Fix <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>{healthy}/{total} workflows healthy</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Workflow list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {workflows.map(wf => {
          const dot    = wf.healthy ? '🟢' : (wf.critical ? '🔴' : '🟡');
          const daysText = !wf.healthy
            ? (wf.daysSince === 999 ? 'never run' : `${wf.daysSince}d overdue`)
            : (wf.lastRun ? `ran ${Math.floor((Date.now() - new Date(wf.lastRun).getTime()) / 86400000)}d ago` : 'ok');
          return (
            <div key={wf.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${wf.healthy ? 'bg-slate-50' : wf.critical ? 'bg-red-50 border border-red-100' : 'bg-yellow-50 border border-yellow-100'}`}>
              <span>{dot}</span>
              <span className={`font-medium flex-1 truncate ${wf.critical && !wf.healthy ? 'text-red-700' : 'text-slate-700'}`}>{wf.name}</span>
              <span className="text-slate-400 flex-shrink-0">{daysText}</span>
              {wf.critical && !wf.healthy && (
                <span className="flex-shrink-0 px-1 py-0.5 bg-red-100 text-red-600 text-[9px] font-bold rounded uppercase">!</span>
              )}
            </div>
          );
        })}
      </div>

      {allHealthy && (
        <p className="text-xs text-emerald-600 mt-2 text-center">All SEO data pipelines running ✓</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's report
// ---------------------------------------------------------------------------
function TodayReport({ report, onGenerate, generating }) {
  const [showRaw, setShowRaw] = useState(false);
  const [doneActions, setDoneActions] = useState({});

  if (!report) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
        <Brain className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <p className="text-slate-600 font-medium mb-2">No report yet for today</p>
        <p className="text-slate-400 text-sm mb-6">Reports are generated automatically at 8:30 AM IST.<br />Or generate one now for instant insights.</p>
        <button onClick={onGenerate} disabled={generating}
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? 'Generating…' : 'Generate Today\'s Report'}
        </button>
      </div>
    );
  }

  const wins        = parseJson(report.wins)        ?? [];
  const problems    = parseJson(report.problems)    ?? [];
  const actions     = parseJson(report.actions)     ?? [];
  const anomalies   = parseJson(report.anomalies)   ?? [];
  const predictions = parseJson(report.predictions) ?? [];
  const overall     = report.overall_score ?? 0;
  const rawData     = parseJson(report.raw_data);
  const wfData      = rawData?.seoWorkflows ?? null;

  return (
    <div className="space-y-5">
      {/* Score + summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start gap-6 flex-wrap">
          <ScoreCircle score={overall} size={120} label={`${scoreEmoji(overall)} Overall`} />
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs text-slate-400 mb-1">{fmtDate(report.report_date)}</p>
            <p className="text-slate-700 text-sm leading-relaxed mb-4">{report.analysis}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <ScoreCard label="Ads"   score={report.ads_score ?? 0}   icon={BarChart2} />
              <ScoreCard label="SEO"   score={report.seo_score ?? 0}   icon={Search} />
              <ScoreCard label="Sales" score={report.sales_score ?? 0} icon={TrendingUp} />
              <ScoreCard label="Ops"   score={report.ops_score ?? 0}   icon={Activity} />
            </div>
          </div>
        </div>
      </div>

      {/* One thing */}
      {report.analysis && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex gap-3">
          <Target className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-indigo-600 mb-0.5">FOCUS FOR TODAY</p>
            <p className="text-sm font-medium text-indigo-800">{report.analysis}</p>
          </div>
        </div>
      )}

      {/* SEO Workflow Health — shown prominently before wins/problems */}
      <SEOWorkflowHealthSection wfData={wfData} />

      {/* 3-column: wins / problems / actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Wins */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <p className="text-sm font-semibold text-emerald-700">Wins ({wins.length})</p>
          </div>
          <div className="p-4 space-y-2">
            {wins.length === 0 && <p className="text-xs text-slate-400">No wins recorded</p>}
            {wins.map((w, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>
                <span className="text-slate-700">{w}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Problems */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <p className="text-sm font-semibold text-red-700">Issues ({problems.length})</p>
          </div>
          <div className="p-4 space-y-3">
            {problems.length === 0 && <p className="text-xs text-slate-400">No issues detected</p>}
            {problems.map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${severityColor(p.severity)}`}>{p.severity}</span>
                  <p className="text-sm font-medium text-slate-800">{p.issue}</p>
                </div>
                <p className="text-xs text-slate-500 ml-0.5">{p.impact}</p>
                <p className="text-xs text-sky-600 ml-0.5">→ {p.fix}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-sky-50 border-b border-sky-100 flex items-center gap-2">
            <Zap className="w-4 h-4 text-sky-500" />
            <p className="text-sm font-semibold text-sky-700">Actions ({actions.length})</p>
          </div>
          <div className="p-4 space-y-3">
            {actions.length === 0 && <p className="text-xs text-slate-400">No actions required</p>}
            {actions.map((a, i) => (
              <div key={i} className={`flex gap-2 ${doneActions[i] ? 'opacity-40 line-through' : ''}`}>
                <input type="checkbox" checked={!!doneActions[i]}
                  onChange={e => setDoneActions(prev => ({ ...prev, [i]: e.target.checked }))}
                  className="mt-0.5 flex-shrink-0 cursor-pointer" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1 mb-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${ownerColor(a.owner)}`}>{a.owner}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${priorityColor(a.priority)}`}>{a.priority}</span>
                  </div>
                  <p className="text-sm text-slate-700">{a.action}</p>
                  <p className="text-xs text-slate-400">{a.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Anomalies + Predictions */}
      {(anomalies.length > 0 || predictions.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <Eye className="w-4 h-4 text-amber-500" />
              <p className="text-sm font-semibold text-slate-700">Anomalies</p>
            </div>
            <div className="p-4 space-y-1">
              {anomalies.length === 0
                ? <p className="text-xs text-slate-400">Nothing unusual</p>
                : anomalies.map((a, i) => <p key={i} className="text-sm text-slate-700">• {a}</p>)}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-500" />
              <p className="text-sm font-semibold text-slate-700">Predictions</p>
            </div>
            <div className="p-4 space-y-1">
              {predictions.length === 0
                ? <p className="text-xs text-slate-400">No predictions</p>
                : predictions.map((p, i) => <p key={i} className="text-sm text-slate-700">• {p}</p>)}
            </div>
          </div>
        </div>
      )}

      {/* Raw data toggle */}
      <div>
        <button onClick={() => setShowRaw(v => !v)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors">
          {showRaw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showRaw ? 'Hide raw data' : 'View raw data'}
        </button>
        {showRaw && (
          <pre className="mt-2 p-4 bg-slate-900 text-slate-100 rounded-xl text-xs overflow-x-auto max-h-96">
            {JSON.stringify(report, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report history row
// ---------------------------------------------------------------------------
function HistoryTable({ reports }) {
  const [expanded, setExpanded] = useState(null);

  if (!reports || reports.length === 0) {
    return <p className="text-sm text-slate-400 py-4">No reports yet</p>;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Date</th>
            <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Score</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden md:table-cell">Top Win</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden md:table-cell">Top Issue</th>
            <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {reports.map((r, i) => {
            const wins     = parseJson(r.wins)     ?? [];
            const problems = parseJson(r.problems) ?? [];
            const actions  = parseJson(r.actions)  ?? [];
            const isOpen   = expanded === i;

            return (
              <React.Fragment key={r.id ?? i}>
                <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(isOpen ? null : i)}>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">{fmtDate(r.report_date)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-bold ${scoreColor(r.overall_score ?? 0)}`}>
                      {r.overall_score ?? '—'} {scoreEmoji(r.overall_score ?? 0)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs hidden md:table-cell">{wins[0] ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs hidden md:table-cell">{problems[0]?.issue ?? '—'}</td>
                  <td className="px-3 py-2.5 text-center text-slate-500">{actions.length}</td>
                  <td className="pr-3 text-slate-400">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 bg-slate-50">
                      <p className="text-xs text-slate-600 mb-2">{r.analysis}</p>
                      {wins.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-semibold text-emerald-600 mb-1">Wins</p>
                          {wins.map((w, j) => <p key={j} className="text-xs text-slate-600">✓ {w}</p>)}
                        </div>
                      )}
                      {problems.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-red-600 mb-1">Issues</p>
                          {problems.map((p, j) => <p key={j} className="text-xs text-slate-600">• {p.issue} ({p.severity})</p>)}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function IntelligencePage() {
  const [todayReport, setTodayReport]   = useState(undefined);   // undefined=loading, null=no report
  const [allReports, setAllReports]     = useState([]);
  const [scores, setScores]             = useState([]);
  const [generating, setGenerating]     = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  const [loading, setLoading]           = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [todayRes, reportsRes, scoresRes] = await Promise.all([
      apiFetch('/api/intelligence/today').catch(() => null),
      apiFetch('/api/intelligence/reports').catch(() => null),
      apiFetch('/api/intelligence/scores').catch(() => null),
    ]);
    setTodayReport(todayRes?.report ?? null);
    setAllReports(reportsRes?.reports ?? []);
    setScores(scoresRes?.scores ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateReport() {
    setGenerating(true);
    setGenerateResult(null);
    try {
      const r = await apiFetch('/api/intelligence/generate', { method: 'POST' });
      if (r?.ok) {
        setGenerateResult({ ok: true, score: r.score, summary: r.summary });
        await load();
      } else {
        setGenerateResult({ ok: false, error: r?.error ?? 'Unknown error' });
      }
    } catch (e) {
      setGenerateResult({ ok: false, error: String(e) });
    }
    setGenerating(false);
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-md">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">AI Intelligence</h1>
                <p className="text-xs text-slate-500">Daily agency health report powered by Claude</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {!process.env.CLAUDE_API_KEY && (
                <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-lg">
                  ⚠ CLAUDE_API_KEY not set
                </span>
              )}
              <button onClick={load} disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button onClick={generateReport} disabled={generating}
                className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? 'Generating…' : 'Generate Now'}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-8">

          {/* Generation result toast */}
          {generateResult && (
            <div className={`rounded-xl border p-4 text-sm ${generateResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {generateResult.ok
                ? `✓ Report generated. Overall score: ${generateResult.score}/100`
                : `✗ Generation failed: ${generateResult.error}`}
            </div>
          )}

          {/* Section 1 — Today's report */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              Today's Intelligence Report
            </h2>
            {loading
              ? <div className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />
              : <TodayReport report={todayReport} onGenerate={generateReport} generating={generating} />
            }
          </section>

          {/* Section 2 — Score trend */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-500" />
              Score Trend (last 30 days)
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <ScoreTrendChart scores={scores} />
            </div>
          </section>

          {/* Section 3 — Report history */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              Report History ({allReports.length})
            </h2>
            {loading
              ? <div className="h-32 bg-white rounded-xl border border-slate-200 animate-pulse" />
              : <HistoryTable reports={allReports} />
            }
          </section>

        </div>
      </main>
    </div>
  );
}
