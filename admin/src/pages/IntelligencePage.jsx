import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Brain, Sparkles, RefreshCw, TrendingUp, AlertTriangle,
  CheckCircle, ChevronDown, ChevronRight, Eye, EyeOff,
  Zap, Target, BarChart2, Search, Activity, Cpu,
  Copy, ExternalLink, Terminal, MessageSquare, Code2,
  AlertCircle, Clock, Database
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function scoreColor(s) {
  if (s >= 80) return 'text-emerald-500';
  if (s >= 60) return 'text-yellow-500';
  return 'text-red-500';
}
function scoreBg(s) {
  if (s >= 80) return 'bg-emerald-50 border-emerald-200';
  if (s >= 60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}
function focusBg(s) {
  if (s >= 80) return 'bg-emerald-50 border-emerald-300 text-emerald-900';
  if (s >= 60) return 'bg-orange-50 border-orange-300 text-orange-900';
  return 'bg-red-50 border-red-400 text-red-900';
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
function severityColor(s) {
  if (s === 'critical') return 'bg-red-100 text-red-700 border-red-200';
  if (s === 'high')     return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-yellow-100 text-yellow-700 border-yellow-200';
}
function ownerColor(o) {
  const m = { Jatin:'bg-purple-100 text-purple-700', Sakcham:'bg-orange-100 text-orange-700',
    Vishal:'bg-sky-100 text-sky-700', Nimisha:'bg-pink-100 text-pink-700', Keshav:'bg-emerald-100 text-emerald-700' };
  return m[o] ?? 'bg-slate-100 text-slate-700';
}

// ---------------------------------------------------------------------------
// Copy to clipboard button
// ---------------------------------------------------------------------------
function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* fallback */ }
  }
  return (
    <button onClick={doCopy}
      className="flex items-center gap-1 px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-600 transition-colors">
      <Copy className="w-3 h-3" />
      {copied ? '✓ Copied!' : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Prompt block (expandable)
// ---------------------------------------------------------------------------
function PromptBlock({ title, type, prompt, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!prompt) return null;
  const typeColor = type === 'code'
    ? 'bg-slate-800 text-slate-200 border-slate-700'
    : 'bg-indigo-900 text-indigo-100 border-indigo-700';
  const typeBadge = type === 'code'
    ? <span className="flex items-center gap-1 text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded"><Code2 className="w-3 h-3"/>Claude Code</span>
    : <span className="flex items-center gap-1 text-xs bg-indigo-700 text-indigo-200 px-1.5 py-0.5 rounded"><MessageSquare className="w-3 h-3"/>Claude Chat</span>;

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-slate-200">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left transition-colors">
        {type === 'code' ? <Code2 className="w-3.5 h-3.5 text-slate-500" /> : <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />}
        <span className="text-xs font-medium text-slate-700 flex-1">{title}</span>
        {typeBadge}
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {open && (
        <div className={`${typeColor} p-3`}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs opacity-60">{type === 'code' ? 'Paste in Claude Code terminal' : 'Paste at claude.ai/new'}</span>
            <div className="flex gap-2">
              <CopyBtn text={prompt} />
              {type !== 'code' && (
                <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors">
                  <ExternalLink className="w-3 h-3" /> Open Claude
                </a>
              )}
            </div>
          </div>
          <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto max-h-64">{prompt}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue card (new coaching format)
// ---------------------------------------------------------------------------
function IssueCard({ issue, idx }) {
  const [expanded, setExpanded] = useState(false);
  const hasPrompts = !!(issue.claude_prompt || issue.claude_code_prompt);
  const hasCmds    = issue.terminal_commands?.length > 0;

  return (
    <div className={`rounded-xl border overflow-hidden ${issue.severity === 'critical' ? 'border-red-200' : issue.severity === 'high' ? 'border-orange-200' : 'border-yellow-200'}`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-start gap-3 ${issue.severity === 'critical' ? 'bg-red-50' : issue.severity === 'high' ? 'bg-orange-50' : 'bg-yellow-50'}`}>
        <span className="text-lg flex-shrink-0 mt-0.5">
          {issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : '🟡'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800">{issue.title}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${severityColor(issue.severity)}`}>{issue.severity}</span>
            {hasPrompts && <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">📋 fix prompt</span>}
          </div>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${ownerColor(issue.owner)}`}>{issue.owner}</span>
            <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3"/>{issue.deadline}</span>
          </div>
        </div>
        <button onClick={() => setExpanded(o => !o)} className="flex-shrink-0 p-1 text-slate-400 hover:text-slate-600">
          {expanded ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
        </button>
      </div>

      {/* Always-visible impact row */}
      <div className="px-4 py-2 bg-white border-t border-slate-100 text-xs text-slate-600">
        <span className="font-medium text-slate-700">Impact: </span>{issue.business_impact}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 bg-white border-t border-slate-100 space-y-3">
          {issue.what_is_broken && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">What's broken</p>
              <p className="text-xs text-slate-700">{issue.what_is_broken}</p>
            </div>
          )}
          {issue.fix_steps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Fix steps</p>
              <ol className="space-y-1">
                {issue.fix_steps.map((s, i) => (
                  <li key={i} className="text-xs text-slate-700 flex gap-2">
                    <span className="flex-shrink-0 w-4 h-4 bg-slate-200 rounded-full text-slate-600 flex items-center justify-center text-[10px] font-bold">{i+1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {hasCmds && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1"><Terminal className="w-3 h-3"/>Terminal commands</p>
              {issue.terminal_commands.map((cmd, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-800 text-slate-200 px-3 py-1.5 rounded text-xs font-mono mb-1">
                  <span className="flex-1">{cmd}</span>
                  <CopyBtn text={cmd} />
                </div>
              ))}
            </div>
          )}
          <PromptBlock title="Claude Chat Prompt — paste at claude.ai/new" type="chat" prompt={issue.claude_prompt} />
          <PromptBlock title="Claude Code Prompt — paste in Claude Code" type="code" prompt={issue.claude_code_prompt} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SEO Workflow Health panel
// ---------------------------------------------------------------------------
function SEOWorkflowHealthSection({ wfData }) {
  if (!wfData) return null;
  const allHealthy = wfData.allHealthy;
  const pct = wfData.totalCount > 0 ? Math.round((wfData.healthyCount / wfData.totalCount) * 100) : 0;
  const barColor = allHealthy ? 'bg-emerald-500' : pct >= 70 ? 'bg-yellow-400' : 'bg-red-500';

  return (
    <div className={`rounded-xl border p-4 ${allHealthy ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-3 mb-3">
        <Cpu className={`w-4 h-4 flex-shrink-0 ${allHealthy ? 'text-emerald-500' : 'text-orange-500'}`} />
        <p className="text-sm font-semibold text-slate-800">SEO Workflow Health</p>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${wfData.n8nAlive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          n8n {wfData.n8nAlive ? '🟢 Online' : '🔴 Offline'}
        </span>
        <a href="/crm/seo" className="flex items-center gap-1 text-xs text-sky-600 hover:underline">
          Fix <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>{wfData.healthyCount}/{wfData.totalCount} workflows healthy</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {(wfData.workflows || []).map(wf => {
          const dot = wf.healthy ? '🟢' : (wf.critical ? '🔴' : '🟡');
          const daysText = !wf.healthy
            ? (wf.daysSince >= 999 ? 'never run' : `${wf.daysSince}d overdue`)
            : wf.lastRun ? `${Math.floor((Date.now() - new Date(wf.lastRun).getTime()) / 86400000)}d ago` : 'ok';
          return (
            <div key={wf.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${wf.healthy ? 'bg-slate-50' : wf.critical ? 'bg-red-50 border border-red-100' : 'bg-yellow-50 border border-yellow-100'}`}>
              <span>{dot}</span>
              <span className={`font-medium flex-1 truncate ${wf.critical && !wf.healthy ? 'text-red-700' : 'text-slate-700'}`}>{wf.name}</span>
              <span className="text-slate-400 flex-shrink-0">{daysText}</span>
            </div>
          );
        })}
      </div>
      {allHealthy && <p className="text-xs text-emerald-600 mt-2 text-center">All SEO data pipelines running ✓</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Prompts tab — all prompts in one place
// ---------------------------------------------------------------------------
function ActionPromptsTab({ report }) {
  const issues = parseJson(report?.problems) ?? [];
  const seoCo  = parseJson(report?.predictions);
  const sysErr = parseJson(report?.anomalies) ?? [];
  const rawData = parseJson(report?.raw_data);
  const wfData  = rawData?.seoWorkflows;

  const prompts = [];

  // From issues
  for (const issue of issues) {
    if (issue.claude_prompt) {
      prompts.push({ title: issue.title, type: 'chat', badge: issue.severity, prompt: issue.claude_prompt });
    }
    if (issue.claude_code_prompt) {
      prompts.push({ title: issue.title, type: 'code', badge: issue.severity, prompt: issue.claude_code_prompt });
    }
    if (issue.terminal_commands?.length > 0) {
      prompts.push({ title: issue.title, type: 'terminal', badge: issue.severity, prompt: issue.terminal_commands.join('\n') });
    }
  }

  // From SEO coaching broken workflows
  if (seoCo?.broken_workflows) {
    for (const wf of seoCo.broken_workflows) {
      if (wf.fix_prompt) {
        prompts.push({ title: `Fix: ${wf.workflow}`, type: 'code', badge: 'seo', prompt: wf.fix_prompt });
      }
    }
  }

  // From system errors
  for (const err of sysErr) {
    if (err.claude_fix_prompt) {
      prompts.push({ title: `Fix: ${err.error_pattern}`, type: 'chat', badge: 'error', prompt: err.claude_fix_prompt });
    }
  }

  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? prompts : prompts.filter(p => p.type === filter);

  if (!report) {
    return <div className="py-12 text-center text-slate-400 text-sm">Generate today's report to see fix prompts</div>;
  }

  const typeBadge = (type) => {
    if (type === 'code')     return <span className="flex items-center gap-1 text-xs bg-slate-700 text-white px-1.5 py-0.5 rounded"><Code2 className="w-3 h-3"/>Claude Code</span>;
    if (type === 'terminal') return <span className="flex items-center gap-1 text-xs bg-green-700 text-white px-1.5 py-0.5 rounded"><Terminal className="w-3 h-3"/>Terminal</span>;
    return <span className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded"><MessageSquare className="w-3 h-3"/>Claude Chat</span>;
  };

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {['all', 'chat', 'code', 'terminal'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === f ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
            {f === 'all' ? `All (${prompts.length})` : f === 'chat' ? `Claude Chat (${prompts.filter(p=>p.type==='chat').length})` : f === 'code' ? `Claude Code (${prompts.filter(p=>p.type==='code').length})` : `Terminal (${prompts.filter(p=>p.type==='terminal').length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-8 text-center text-slate-400 text-sm">
          {prompts.length === 0 ? '✅ No fix prompts needed — great day!' : 'No prompts of this type'}
        </div>
      )}

      {filtered.map((p, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{p.title}</p>
            </div>
            {typeBadge(p.type)}
            <CopyBtn text={p.prompt} label="Copy prompt" />
            {p.type === 'chat' && (
              <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700">
                Open <ExternalLink className="w-3 h-3"/>
              </a>
            )}
          </div>
          <div className="bg-slate-900 p-4">
            <pre className="text-xs text-slate-200 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{p.prompt}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score trend chart (SVG)
// ---------------------------------------------------------------------------
function ScoreTrendChart({ scores }) {
  if (!scores || scores.length < 2) {
    return <div className="h-40 flex items-center justify-center text-slate-400 text-sm">No trend data yet</div>;
  }
  const sorted = [...scores].reverse();
  const W = 640, H = 180;
  const PAD = { top: 16, right: 16, bottom: 32, left: 36 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const x = i => PAD.left + (i / (sorted.length - 1)) * iW;
  const y = v => PAD.top + iH - ((v ?? 0) / 100) * iH;
  const lines = [
    { key: 'overall_score', color: '#6366f1', w: 2.5, label: 'Overall' },
    { key: 'ads_score',     color: '#0ea5e9', w: 1.5, label: 'Ads' },
    { key: 'seo_score',     color: '#10b981', w: 1.5, label: 'SEO' },
    { key: 'sales_score',   color: '#f97316', w: 1.5, label: 'Sales' },
    { key: 'ops_score',     color: '#a855f7', w: 1.5, label: 'Ops' },
  ];
  const toPath = key => sorted.map((d, i) => `${i===0?'M':'L'} ${x(i).toFixed(1)} ${y(Number(d[key]??0)).toFixed(1)}`).join(' ');
  const xTick = Math.ceil(sorted.length / 5);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
        {[0,25,50,75,100].map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={PAD.left+iW} y2={y(v)} stroke="#e2e8f0" strokeWidth="1"/>
            <text x={PAD.left-6} y={y(v)+4} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
          </g>
        ))}
        {lines.map(l => <path key={l.key} d={toPath(l.key)} fill="none" stroke={l.color} strokeWidth={l.w} strokeLinejoin="round"/>)}
        {sorted.filter((_,i) => i % xTick === 0 || i === sorted.length-1).map((d,_,arr) => {
          const oi = sorted.indexOf(d);
          return <text key={oi} x={x(oi)} y={H-4} textAnchor="middle" fontSize="9" fill="#94a3b8">{String(d.report_date??'').slice(5)}</text>;
        })}
        {lines.map((l,i) => (
          <g key={l.key} transform={`translate(${PAD.left + i*90}, 0)`}>
            <line x1="0" y1="5" x2="14" y2="5" stroke={l.color} strokeWidth={l.w}/>
            <text x="18" y="9" fontSize="9" fill="#475569">{l.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report history table
// ---------------------------------------------------------------------------
function HistoryTable({ reports }) {
  const [expanded, setExpanded] = useState(null);
  if (!reports?.length) return <p className="text-sm text-slate-400 py-4">No reports yet</p>;
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Date</th>
            <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Score</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden md:table-cell">Focus</th>
            <th className="text-center px-3 py-2.5 text-xs font-semibold text-slate-500">Issues</th>
            <th className="w-8"/>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {reports.map((r, i) => {
            const issues = parseJson(r.problems) ?? [];
            const meta   = parseJson(r.actions) ?? {};
            const isOpen = expanded === i;
            return (
              <React.Fragment key={r.id ?? i}>
                <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(isOpen ? null : i)}>
                  <td className="px-4 py-2.5 text-slate-700 font-medium">{fmtDate(r.report_date)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-bold ${scoreColor(r.overall_score ?? 0)}`}>{r.overall_score ?? '—'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs hidden md:table-cell truncate max-w-[220px]">{r.analysis ?? '—'}</td>
                  <td className="px-3 py-2.5 text-center text-slate-500">{issues.length}</td>
                  <td className="pr-3 text-slate-400">{isOpen ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}</td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={5} className="px-4 py-3 bg-slate-50">
                    {meta.coaching_summary && <p className="text-xs text-slate-600 mb-2">{meta.coaching_summary}</p>}
                    {issues.slice(0,3).map((iss,j) => (
                      <div key={j} className="text-xs text-slate-600 mb-1">
                        <span className="font-medium">{iss.severity === 'critical' ? '🔴' : iss.severity === 'high' ? '🟠' : '🟡'} {iss.title}</span>
                        <span className="text-slate-400 ml-2">— {iss.owner} / {iss.deadline}</span>
                      </div>
                    ))}
                  </td></tr>
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
// System Health Tab
// ---------------------------------------------------------------------------
function SystemHealthTab() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await apiFetch('/api/intelligence/system-health').catch(() => null);
    setHealth(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5 * 60_000); return () => clearInterval(id); }, [load]);

  if (loading) return <div className="text-center py-12 text-slate-400">Checking systems...</div>;
  if (!health) return <div className="text-center py-12 text-red-500 text-sm">Health check failed</div>;

  const scoreColor = health.overallScore >= 80 ? 'text-green-600' : health.overallScore >= 50 ? 'text-amber-600' : 'text-red-600';
  const statusBadge = (s) => s === 'HEALTHY' ? 'bg-green-100 text-green-700' : s === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';

  return (
    <section className="space-y-4">
      {/* Score */}
      <div className="flex items-center gap-4 mb-4">
        <div className={`text-5xl font-bold ${scoreColor}`}>{health.overallScore}</div>
        <div>
          <p className="text-sm font-medium text-slate-800">System Health Score</p>
          <p className="text-xs text-slate-400">Checked {new Date(health.checkedAt).toLocaleTimeString('en-IN')}</p>
        </div>
        <button onClick={load} className="ml-auto text-xs text-sky-600 hover:underline flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Subsystem cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { name: 'Outreach', data: health.outreach },
          { name: 'SEO', data: health.seo },
          { name: 'CRM', data: health.crm },
          { name: 'Infrastructure', data: health.infrastructure },
        ].map(sub => (
          <div key={sub.name} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">{sub.name}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusBadge(sub.data.status)}`}>{sub.data.status}</span>
            </div>
            <div className="space-y-0.5 text-[11px] text-slate-500">
              {Object.entries(sub.data.metrics || {}).slice(0, 4).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                  <span className="font-medium text-slate-700">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Cron jobs */}
      {health.cronJobs?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-2">Cron Jobs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 border-b">
                <th className="text-left py-1 px-2">Job</th>
                <th className="text-left py-1 px-2">Status</th>
                <th className="text-left py-1 px-2">Last Run</th>
                <th className="text-left py-1 px-2">Duration</th>
                <th className="text-left py-1 px-2">Records</th>
              </tr></thead>
              <tbody>
                {health.cronJobs.map(c => (
                  <tr key={c.name} className="border-b border-slate-50">
                    <td className="py-1 px-2 font-medium text-slate-700">{c.name}</td>
                    <td className="py-1 px-2">
                      {c.healthy ? <span className="text-green-600">✓</span> : <span className="text-red-500">✗</span>}
                    </td>
                    <td className="py-1 px-2 text-slate-500">{c.lastRun ? new Date(c.lastRun).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : 'Never'}</td>
                    <td className="py-1 px-2 text-slate-500">{c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                    <td className="py-1 px-2 text-slate-500">{c.recordsProcessed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function IntelligencePage() {
  const [todayReport, setTodayReport] = useState(undefined);
  const [allReports, setAllReports]   = useState([]);
  const [scores, setScores]           = useState([]);
  const [generating, setGenerating]   = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  const [genProgress, setGenProgress] = useState('');
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState('today');  // 'today' | 'prompts' | 'history'

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

  const PROGRESS_STEPS = [
    { after: 0,  msg: 'Collecting ClickUp task data...' },
    { after: 8,  msg: 'Analysing Meta Ads performance...' },
    { after: 20, msg: 'Collecting SEO & pipeline data...' },
    { after: 35, msg: 'Running AI coaching analysis...' },
    { after: 60, msg: 'Generating action prompts...' },
    { after: 90, msg: 'Finalizing report...' },
  ];

  async function generateReport() {
    setGenerating(true);
    setGenerateResult(null);
    setGenProgress(PROGRESS_STEPS[0].msg);
    const startTime = Date.now();

    // Progress ticker
    const progressId = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const step = [...PROGRESS_STEPS].reverse().find(s => elapsed >= s.after);
      if (step) setGenProgress(step.msg);
    }, 2000);

    try {
      const r = await apiFetch('/api/intelligence/generate', { method: 'POST' });
      if (r?.status === 'generating' || r?.status === 'already_generating') {
        const reportId = r.reportId;
        const deadline = Date.now() + 180_000; // 3 minute timeout

        const poll = async () => {
          if (Date.now() > deadline) {
            clearInterval(progressId);
            setGenerateResult({ ok: false, error: 'Taking longer than expected. Check back in a few minutes.' });
            setGenerating(false);
            return;
          }

          // Poll by reportId if available, fall back to /today
          const statusRes = reportId
            ? await apiFetch(`/api/intelligence/status/${reportId}`).catch(() => null)
            : null;

          if (statusRes?.status === 'complete') {
            clearInterval(progressId);
            await load();
            setGenerateResult({ ok: true, score: statusRes.score, aiEnabled: statusRes.aiEnabled });
            setGenerating(false);
            return;
          }
          if (statusRes?.status === 'failed') {
            clearInterval(progressId);
            setGenerateResult({ ok: false, error: statusRes.error || 'Generation failed' });
            setGenerating(false);
            return;
          }

          // Fall back to checking /today
          if (!reportId) {
            const todayStr = new Date().toISOString().slice(0, 10);
            const t = await apiFetch('/api/intelligence/today').catch(() => null);
            const rpt = t?.report;
            if (rpt && rpt.report_date?.slice(0, 10) === todayStr) {
              clearInterval(progressId);
              await load();
              setGenerateResult({ ok: true, score: rpt.overall_score, aiEnabled: rpt.tokens_used > 0 });
              setGenerating(false);
              return;
            }
          }

          setTimeout(poll, 3000);
        };
        setTimeout(poll, 3000);
      } else {
        clearInterval(progressId);
        setGenerateResult({ ok: false, error: r?.error ?? 'Unknown error' });
        setGenerating(false);
      }
    } catch (e) {
      clearInterval(progressId);
      setGenerateResult({ ok: false, error: String(e) });
      setGenerating(false);
    }
  }

  // Parse today's report data
  const overall       = todayReport?.overall_score ?? 0;
  const issues        = parseJson(todayReport?.problems) ?? [];
  const wins          = parseJson(todayReport?.wins) ?? [];
  const sysErrors     = parseJson(todayReport?.anomalies) ?? [];
  const seoCo         = parseJson(todayReport?.predictions);
  const meta          = parseJson(todayReport?.actions) ?? {};
  const rawData       = parseJson(todayReport?.raw_data);
  const wfData        = rawData?.seoWorkflows ?? null;
  const focusToday    = todayReport?.analysis ?? meta.focus_today ?? '';
  const coachingSummary = meta.coaching_summary ?? '';
  const tomorrowFocus = meta.tomorrow_focus ?? '';
  const promptCount   = issues.reduce((n, iss) => n + (iss.claude_prompt ? 1 : 0) + (iss.claude_code_prompt ? 1 : 0), 0)
    + (seoCo?.broken_workflows?.length ?? 0)
    + sysErrors.filter(e => e.claude_fix_prompt).length;

  const TABS = [
    { id: 'today',   label: 'Today\'s Report', icon: Brain },
    { id: 'prompts', label: `Action Prompts${promptCount > 0 ? ` (${promptCount})` : ''}`, icon: Zap },
    { id: 'health',  label: 'System Health', icon: Activity },
    { id: 'history', label: 'History', icon: Activity },
  ];

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
                <h1 className="text-lg font-bold text-slate-900">AI Coaching</h1>
                <p className="text-xs text-slate-500">Daily operations coaching + auto-generated fix prompts</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <button onClick={load} disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button onClick={generateReport} disabled={generating}
                className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? genProgress : 'Generate Now'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">

          {/* Generation result */}
          {generateResult && (
            <div className={`rounded-xl border p-4 text-sm ${generateResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {generateResult.ok ? (
                <span>
                  ✓ Report generated. Score: {generateResult.score}/100 — {generateResult.aiEnabled ? 'AI coaching active' : '⚠ Fallback mode — CLAUDE_API_KEY not detected by server'}
                </span>
              ) : `✗ Generation failed: ${generateResult.error}`}
            </div>
          )}

          {/* ── TODAY TAB ── */}
          {activeTab === 'today' && (
            <>
              {loading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <div key={i} className="h-20 bg-white rounded-xl border border-slate-200 animate-pulse"/>)}
                </div>
              ) : !todayReport ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                  <Brain className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 font-medium mb-2">No report for today yet</p>
                  <p className="text-slate-400 text-sm mb-6">Auto-generated daily at 8:30 AM IST — or generate now.</p>
                  <button onClick={generateReport} disabled={generating}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {generating ? 'Generating… (polling for result)' : 'Generate Today\'s Report'}
                  </button>
                </div>
              ) : (
                <>
                  {/* FOCUS TODAY — most prominent, replaces score circle */}
                  {focusToday && (
                    <div className={`rounded-xl border-2 px-5 py-4 ${focusBg(overall)}`}>
                      <p className="text-xs font-bold uppercase tracking-wide mb-1 opacity-70">🎯 FOCUS TODAY</p>
                      <p className="text-base font-bold leading-snug">{focusToday}</p>
                      {coachingSummary && <p className="text-sm mt-2 opacity-80">{coachingSummary}</p>}
                    </div>
                  )}

                  {/* SEO Workflow Health — before issues */}
                  <SEOWorkflowHealthSection wfData={wfData} />

                  {/* Issues — leading */}
                  {issues.length > 0 && (
                    <section>
                      <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        {issues.length} Issue{issues.length !== 1 ? 's' : ''} Need Action
                        {promptCount > 0 && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{promptCount} fix prompts ready</span>}
                      </h2>
                      <div className="space-y-3">
                        {issues.map((iss, i) => <IssueCard key={i} issue={iss} idx={i} />)}
                      </div>
                    </section>
                  )}

                  {/* System errors */}
                  {sysErrors.length > 0 && (
                    <section>
                      <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500" /> System Errors Detected
                      </h2>
                      <div className="space-y-2">
                        {sysErrors.map((e, i) => (
                          <div key={i} className="bg-white rounded-xl border border-red-100 p-4">
                            <p className="text-sm font-semibold text-red-700">{e.error_pattern}</p>
                            {e.likely_cause && <p className="text-xs text-slate-500 mt-1">Likely: {e.likely_cause}</p>}
                            <PromptBlock title="Diagnose with Claude" type="chat" prompt={e.claude_fix_prompt} />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* SEO coaching */}
                  {seoCo && (
                    <section>
                      <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <Search className="w-4 h-4 text-emerald-500" /> SEO Coaching
                      </h2>
                      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${seoCo.overall_health === 'healthy' ? 'bg-emerald-100 text-emerald-700' : seoCo.overall_health === 'critical' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {seoCo.overall_health === 'healthy' ? '🟢' : seoCo.overall_health === 'critical' ? '🔴' : '🟡'} {seoCo.overall_health}
                        </div>
                        {seoCo.summary && <p className="text-sm text-slate-700">{seoCo.summary}</p>}
                        {seoCo.keyword_insights && (
                          <div className="text-xs bg-slate-50 rounded-lg p-3 text-slate-600">
                            <span className="font-semibold">Keywords: </span>{seoCo.keyword_insights}
                          </div>
                        )}
                        {seoCo.next_content_action && (
                          <div className="text-xs bg-sky-50 border border-sky-100 rounded-lg p-3 text-sky-700">
                            <span className="font-semibold">Next content action: </span>{seoCo.next_content_action}
                          </div>
                        )}
                        {seoCo.broken_workflows?.map((wf, i) => (
                          <div key={i} className="border-t border-slate-100 pt-3">
                            <p className="text-xs font-semibold text-red-700">🔴 {wf.workflow} — {wf.days_overdue < 0 ? 'never run' : `${wf.days_overdue}d overdue`}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{wf.impact}</p>
                            <PromptBlock title={`Fix: ${wf.workflow}`} type="code" prompt={wf.fix_prompt} />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Wins — brief, at end */}
                  {wins.length > 0 && (
                    <section>
                      <h2 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" /> Wins
                      </h2>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-1">
                        {wins.map((w, i) => <p key={i} className="text-sm text-emerald-800">✓ {w}</p>)}
                      </div>
                    </section>
                  )}

                  {/* Tomorrow focus */}
                  {tomorrowFocus && (
                    <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3">
                      <p className="text-xs font-semibold text-slate-500 mb-0.5">TOMORROW'S FOCUS</p>
                      <p className="text-sm text-slate-700">{tomorrowFocus}</p>
                    </div>
                  )}

                  {/* Scores — bottom */}
                  <section>
                    <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-indigo-500" /> Score Breakdown
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        { label: 'Overall', score: overall, icon: Brain },
                        { label: 'Ads',     score: todayReport.ads_score   ?? 0, icon: TrendingUp },
                        { label: 'SEO',     score: todayReport.seo_score   ?? 0, icon: Search },
                        { label: 'Sales',   score: todayReport.sales_score ?? 0, icon: Target },
                        { label: 'Ops',     score: todayReport.ops_score   ?? 0, icon: Activity },
                      ].map(({ label, score, icon: Icon }) => (
                        <div key={label} className={`flex items-center gap-2 p-3 rounded-xl border ${scoreBg(score)}`}>
                          <Icon className={`w-4 h-4 flex-shrink-0 ${scoreColor(score)}`} />
                          <div>
                            <p className="text-xs text-slate-500">{label}</p>
                            <p className={`text-lg font-bold ${scoreColor(score)}`}>{score}<span className="text-xs font-normal text-slate-400">/100</span></p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Score trend */}
                  {scores.length > 1 && (
                    <section>
                      <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-indigo-500" /> Score Trend
                      </h2>
                      <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <ScoreTrendChart scores={scores} />
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {/* ── PROMPTS TAB ── */}
          {activeTab === 'prompts' && (
            <ActionPromptsTab report={todayReport} />
          )}

          {/* ── SYSTEM HEALTH TAB ── */}
          {activeTab === 'health' && <SystemHealthTab />}

          {/* ── HISTORY TAB ── */}
          {activeTab === 'history' && (
            <section>
              <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-500" /> Report History ({allReports.length})
              </h2>
              {loading
                ? <div className="h-32 bg-white rounded-xl border border-slate-200 animate-pulse"/>
                : <HistoryTable reports={allReports} />
              }
              {scores.length > 1 && (
                <div className="mt-6">
                  <h2 className="text-sm font-bold text-slate-700 mb-3">Score Trend</h2>
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <ScoreTrendChart scores={scores} />
                  </div>
                </div>
              )}
            </section>
          )}

        </div>
      </main>
    </div>
  );
}
