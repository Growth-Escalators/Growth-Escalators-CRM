import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { apiFetch, getUser } from '../lib/api.js';
import {
  Users, TrendingUp, DollarSign, Receipt, BarChart2, Kanban,
  FileText, Share2, MessageSquare, Brain, Search, Activity,
  AlertTriangle, CheckCircle, ArrowUp, ArrowDown, RefreshCw,
  Clock, Zap, Target, CreditCard, ChevronRight, ChevronDown,
  Sparkles, AlertCircle
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Small stat card
// ---------------------------------------------------------------------------
function StatCard({ icon: Icon, title, value, sub, color = 'text-slate-900', alert = false, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border ${alert ? 'border-red-200' : 'border-slate-200'} p-4 flex items-start gap-3 ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
        alert ? 'bg-red-50' : 'bg-slate-50'
      }`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 mb-0.5">{title}</p>
        <p className={`text-xl font-bold ${alert ? 'text-red-600' : color}`}>{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtINR(paise) {
  if (paise == null || isNaN(paise)) return '—';
  const val = Math.round(paise / 100);
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
  return `₹${val.toLocaleString('en-IN')}`;
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN');
}

function parseJson(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function severityBg(s) {
  if (s === 'critical') return 'bg-red-50 border-red-200';
  if (s === 'high') return 'bg-amber-50 border-amber-200';
  return 'bg-yellow-50 border-yellow-200';
}
function severityDot(s) {
  if (s === 'critical') return 'bg-red-500';
  if (s === 'high') return 'bg-amber-500';
  return 'bg-yellow-400';
}

// ---------------------------------------------------------------------------
// Action Item with expand
// ---------------------------------------------------------------------------
function ActionItem({ action, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border overflow-hidden ${severityBg(action.severity)}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${severityDot(action.severity)}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800">{action.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {action.owner && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">{action.owner}</span>
            )}
            {action.deadline && (
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{action.deadline}</span>
            )}
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          {action.business_impact && (
            <p className="text-xs text-slate-600"><span className="font-semibold">Impact:</span> {action.business_impact}</p>
          )}
          {action.what_is_broken && (
            <p className="text-xs text-slate-600"><span className="font-semibold">What's broken:</span> {action.what_is_broken}</p>
          )}
          {action.fix_steps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Fix steps:</p>
              <ol className="space-y-1 ml-1">
                {action.fix_steps.map((s, i) => (
                  <li key={i} className="text-xs text-slate-700 flex gap-2">
                    <span className="w-4 h-4 bg-slate-200 rounded-full text-slate-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight Card — wins & anomalies
// ---------------------------------------------------------------------------
function HighlightCard({ icon: Icon, title, items, color, iconColor }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden`}>
      <div className={`px-4 py-3 border-b border-slate-100 ${color} flex items-center gap-2`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <p className="text-xs font-bold uppercase tracking-wide">{title}</p>
      </div>
      <div className="divide-y divide-slate-50">
        {items.map((item, i) => (
          <div key={i} className="px-4 py-3">
            {typeof item === 'string' ? (
              <p className="text-sm text-slate-700">{item}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-800">{item.title || item.metric || item.description}</p>
                {item.detail && <p className="text-xs text-slate-500 mt-0.5">{item.detail}</p>}
                {item.change && <p className="text-xs text-slate-500 mt-0.5">{item.change}</p>}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const firstName = user?.name?.split(' ')[0] || 'there';

  // Core metrics
  const [contacts, setContacts] = useState(0);
  const [deals, setDeals] = useState(0);
  const [billing, setBilling] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);

  // Intelligence (admin)
  const [intelligence, setIntelligence] = useState(null);
  const [seoOverview, setSeoOverview] = useState([]);
  const [outreach, setOutreach] = useState(null);
  const [cronHealth, setCronHealth] = useState(null);

  // Parsed AI data
  const [myActions, setMyActions] = useState([]);
  const [allActions, setAllActions] = useState([]);
  const [wins, setWins] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [coachingScore, setCoachingScore] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const [contactData, dealData, billingData, pipelineData] = await Promise.all([
        apiFetch('/api/contacts?limit=1').catch(() => null),
        apiFetch('/api/deals?limit=1').catch(() => null),
        apiFetch('/api/billing/stats').catch(() => null),
        apiFetch('/api/deals/pipeline-summary').catch(() => null),
      ]);
      setContacts(contactData?.total ?? 0);
      setDeals(dealData?.total ?? 0);
      setBilling(billingData);
      setPipelineSummary(pipelineData);

      if (isAdmin) {
        const [intelData, seoData, outreachData, cronData] = await Promise.all([
          apiFetch('/api/intelligence/today').catch(() => null),
          apiFetch('/api/seo/overview').catch(() => null),
          apiFetch('/api/outreach/leads/dashboard').catch(() => null),
          apiFetch('/api/intelligence/system-health').catch(() => null),
        ]);
        const report = intelData?.report ?? null;
        setIntelligence(report);
        setSeoOverview(seoData?.clients ?? []);
        setOutreach(outreachData);
        setCronHealth(cronData);

        // Parse AI coaching data
        if (report) {
          const problems = parseJson(report.problems) ?? [];
          const winsData = parseJson(report.wins) ?? [];
          const anomalyData = parseJson(report.anomalies) ?? [];

          setAllActions(Array.isArray(problems) ? problems : []);
          setWins(Array.isArray(winsData) ? winsData : []);
          setAnomalies(Array.isArray(anomalyData) ? anomalyData : []);

          // Filter to current user's actions
          const myItems = (Array.isArray(problems) ? problems : [])
            .filter(p => !firstName || firstName === 'there' || (p.owner || '').toLowerCase().includes(firstName.toLowerCase()));
          setMyActions(myItems);

          // Set coaching scores
          setCoachingScore({
            overall: report.overall_score,
            ads: report.ads_score,
            seo: report.seo_score,
            sales: report.sales_score,
            ops: report.ops_score,
          });
        }
      }

      setLastUpdated(Date.now());
      setSecondsAgo(0);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, [isAdmin, firstName]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    const refresh = setInterval(loadStats, 90000);
    const tick = setInterval(() => { if (lastUpdated) setSecondsAgo(Math.floor((Date.now() - lastUpdated) / 1000)); }, 10000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [loadStats, lastUpdated]);

  useEffect(() => {
    const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Derived
  const mrr = billing?.totalMrr;
  const outstanding = billing?.outstanding;
  const overdueCount = billing?.overdueCount ?? 0;
  const pipelineValue = pipelineSummary?.totalValue ?? 0;
  const dealsInProposal = pipelineSummary?.stages?.find(s => s.stage?.toLowerCase() === 'proposal')?.count ?? 0;
  const intelScore = intelligence?.overall_score;
  const intelFocus = intelligence?.analysis;
  const outreachTotal = outreach?.totalLeads ?? 0;
  const outreachInterested = outreach?.interested ?? 0;
  const seoClients = seoOverview.length;
  const cronFailedCount = cronHealth?.cronJobs?.filter(c => !c.healthy)?.length ?? 0;
  const cronTotal = cronHealth?.cronJobs?.length ?? 0;

  const ROLE_BADGE = {
    admin: 'bg-purple-100 text-purple-700',
    manager_ops: 'bg-sky-100 text-sky-700',
    manager_ads: 'bg-blue-100 text-blue-700',
    sales: 'bg-orange-100 text-orange-700',
    staff: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 space-y-6">
          {/* Welcome + refresh */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {firstName}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-slate-500">Here's what needs your attention today</p>
                {user?.role && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE[user.role] || ROLE_BADGE.staff}`}>
                    {user.role.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-400">
                  {secondsAgo < 10 ? 'Just now' : `${secondsAgo}s ago`}
                </span>
              )}
              <button onClick={loadStats} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              Could not load some dashboard data. Try refreshing.
            </div>
          )}

          {/* ── YOUR PRIORITY ACTIONS (personalized) ── */}
          {myActions.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                Your Priority Actions Today
              </h2>
              <div className="space-y-2">
                {myActions.slice(0, 5).map((a, i) => (
                  <ActionItem key={i} action={a} defaultOpen={i === 0} />
                ))}
              </div>
            </section>
          )}

          {/* ── AI INTELLIGENCE SCORE + COACHING ── */}
          {isAdmin && coachingScore && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-indigo-500" />
                AI Coaching Score
              </h2>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-6 mb-4">
                  <div className="text-center">
                    <p className={`text-4xl font-black ${intelScore >= 70 ? 'text-emerald-600' : intelScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {intelScore ?? '—'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Overall</p>
                  </div>
                  <div className="flex-1 grid grid-cols-4 gap-3">
                    {[
                      { label: 'Ads', score: coachingScore.ads, icon: BarChart2 },
                      { label: 'SEO', score: coachingScore.seo, icon: Search },
                      { label: 'Sales', score: coachingScore.sales, icon: TrendingUp },
                      { label: 'Ops', score: coachingScore.ops, icon: Activity },
                    ].map(s => (
                      <div key={s.label} className="text-center bg-slate-50 rounded-lg py-2.5">
                        <s.icon className="w-3.5 h-3.5 mx-auto text-slate-400 mb-1" />
                        <p className={`text-lg font-bold ${(s.score ?? 0) >= 70 ? 'text-emerald-600' : (s.score ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {s.score ?? '—'}
                        </p>
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {intelFocus && (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3">
                    <p className="text-xs font-semibold text-indigo-700 mb-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> AI Focus Summary
                    </p>
                    <p className="text-sm text-indigo-900 leading-relaxed">{intelFocus}</p>
                  </div>
                )}
                <div className="mt-3 text-right">
                  <a href="/intelligence" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                    View full AI Intelligence report →
                  </a>
                </div>
              </div>
            </section>
          )}

          {/* ── HIGHLIGHTS: Wins + Anomalies ── */}
          {isAdmin && (wins.length > 0 || anomalies.length > 0) && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                Today's Highlights
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <HighlightCard
                  icon={CheckCircle}
                  title="Wins"
                  items={wins}
                  color="bg-emerald-50"
                  iconColor="text-emerald-600"
                />
                <HighlightCard
                  icon={AlertTriangle}
                  title="Anomalies"
                  items={anomalies}
                  color="bg-amber-50"
                  iconColor="text-amber-600"
                />
              </div>
            </section>
          )}

          {/* ── CORE METRICS ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Core Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {loading ? (
                [1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />)
              ) : (
                <>
                  <StatCard icon={Users} title="Total Contacts" value={fmtNum(contacts)} color="text-slate-900" onClick={() => window.location.href = '/contacts'} />
                  <StatCard icon={TrendingUp} title="Active Deals" value={fmtNum(deals)} sub={dealsInProposal > 0 ? `${dealsInProposal} in proposal` : null} color="text-green-600" onClick={() => window.location.href = '/pipeline'} />
                  <StatCard icon={DollarSign} title="Monthly MRR" value={fmtINR(mrr)} color="text-sky-600" />
                  <StatCard icon={Receipt} title="Outstanding" value={fmtINR(outstanding)} sub={overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'} color="text-amber-600" alert={overdueCount > 0} />
                </>
              )}
            </div>
          </section>

          {/* ── PIPELINE & OUTREACH ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pipeline & Growth</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Target} title="Pipeline Value" value={fmtINR(pipelineValue)} color="text-indigo-600" onClick={() => window.location.href = '/pipeline'} />
              {isAdmin && (
                <>
                  <StatCard icon={Target} title="Outreach Leads" value={fmtNum(outreachTotal)} sub={outreachInterested > 0 ? `${outreachInterested} interested` : null} color="text-purple-600" onClick={() => window.location.href = '/outreach-dashboard'} />
                  <StatCard icon={Search} title="SEO Clients" value={seoClients} color="text-emerald-600" onClick={() => window.location.href = '/seo'} />
                  <StatCard icon={Activity} title="System Health" value={cronHealth?.overallScore != null ? `${cronHealth.overallScore}/100` : '—'} sub={cronFailedCount > 0 ? `${cronFailedCount}/${cronTotal} crons unhealthy` : `${cronTotal} crons healthy`} color={cronFailedCount > 0 ? 'text-amber-600' : 'text-green-600'} alert={cronFailedCount > 2} />
                </>
              )}
            </div>
          </section>

          {/* ── ALL TEAM ACTIONS (admin can see everyone's) ── */}
          {isAdmin && allActions.length > myActions.length && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">All Team Actions</h2>
              <div className="space-y-2">
                {allActions.filter(a => !myActions.includes(a)).slice(0, 5).map((a, i) => (
                  <ActionItem key={i} action={a} />
                ))}
              </div>
            </section>
          )}

          {/* ── QUICK ACCESS ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Access</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { icon: Users, label: 'Contacts', path: '/contacts', color: 'bg-sky-50 text-sky-600', roles: ['admin', 'manager_ops', 'sales', 'staff'] },
                { icon: Kanban, label: 'Pipeline', path: '/pipeline', color: 'bg-indigo-50 text-indigo-600', roles: ['admin', 'manager_ops', 'sales', 'staff'] },
                { icon: MessageSquare, label: 'Inbox', path: '/inbox', color: 'bg-purple-50 text-purple-600', roles: ['admin', 'manager_ops', 'sales', 'staff'] },
                { icon: BarChart2, label: 'Meta Ads', path: '/ads', color: 'bg-green-50 text-green-600', roles: ['admin', 'manager_ads'] },
                { icon: Search, label: 'SEO', path: '/seo', color: 'bg-emerald-50 text-emerald-600', roles: ['admin', 'manager_ops', 'manager_ads'] },
                { icon: Brain, label: 'AI Intelligence', path: '/intelligence', color: 'bg-violet-50 text-violet-600', roles: ['admin'] },
                { icon: FileText, label: 'Reports', path: '/reports', color: 'bg-amber-50 text-amber-600', roles: ['admin', 'manager_ops', 'manager_ads'] },
                { icon: Share2, label: 'Outreach', path: '/outreach-dashboard', color: 'bg-pink-50 text-pink-600', roles: ['admin'] },
              ].filter(link => link.roles.includes(user?.role || 'staff')).map(link => (
                <a key={link.path} href={`/crm${link.path}`}
                  className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 hover:border-sky-200 hover:shadow-sm transition-all">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${link.color}`}>
                    <link.icon className="w-4 h-4" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{link.label}</p>
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
