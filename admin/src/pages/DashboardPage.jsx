import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { apiFetch, getUser } from '../lib/api.js';
import {
  Users, TrendingUp, DollarSign, Receipt, BarChart2, Kanban,
  FileText, Share2, MessageSquare, Brain, Search, Activity,
  AlertTriangle, CheckCircle, ArrowUp, ArrowDown, RefreshCw,
  Clock, Zap, Target, CreditCard
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Small stat card
// ---------------------------------------------------------------------------
function StatCard({ icon: Icon, title, value, sub, color = 'text-slate-900', alert = false }) {
  return (
    <div className={`bg-white rounded-xl border ${alert ? 'border-red-200' : 'border-slate-200'} p-4 flex items-start gap-3`}>
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
// Mini status badge
// ---------------------------------------------------------------------------
function StatusBadge({ ok, label }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
      ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {label}
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

  // Row 1 — today's numbers
  const [contacts, setContacts] = useState(0);
  const [deals, setDeals] = useState(0);
  const [billing, setBilling] = useState(null);
  const [pipelineSummary, setPipelineSummary] = useState(null);

  // Row 2 — intelligence + SEO + outreach (admin only)
  const [intelligence, setIntelligence] = useState(null);
  const [seoOverview, setSeoOverview] = useState([]);
  const [outreach, setOutreach] = useState(null);

  // Row 3 — system status (admin only)
  const [cronHealth, setCronHealth] = useState(null);

  // Today's priority actions
  const [actions, setActions] = useState([]);

  const loadStats = useCallback(async () => {
    try {
      // Core data (all roles)
      const [contactData, dealData, billingData, pipelineData] = await Promise.all([
        apiFetch('/contacts?limit=1').catch(() => null),
        apiFetch('/deals?limit=1').catch(() => null),
        apiFetch('/api/billing/stats').catch(() => null),
        apiFetch('/api/deals/pipeline-summary').catch(() => null),
      ]);
      setContacts(contactData?.total ?? 0);
      setDeals(dealData?.total ?? 0);
      setBilling(billingData);
      setPipelineSummary(pipelineData);

      // Admin-only data
      if (isAdmin) {
        const [intelData, seoData, outreachData, cronData] = await Promise.all([
          apiFetch('/api/intelligence/today').catch(() => null),
          apiFetch('/api/seo/overview').catch(() => null),
          apiFetch('/api/outreach/leads/dashboard').catch(() => null),
          apiFetch('/api/intelligence/system-health').catch(() => null),
        ]);
        setIntelligence(intelData?.report ?? null);
        setSeoOverview(seoData?.clients ?? []);
        setOutreach(outreachData);
        setCronHealth(cronData);

        // Today's priority actions for logged-in user
        try {
          const problems = intelData?.report?.problems;
          if (problems) {
            const parsed = typeof problems === 'string' ? JSON.parse(problems) : problems;
            const firstName = user?.name?.split(' ')[0];
            const myActions = (Array.isArray(parsed) ? parsed : [])
              .filter(p => !firstName || (p.owner || '').toLowerCase().includes(firstName.toLowerCase()))
              .slice(0, 3);
            setActions(myActions);
          }
        } catch {}
      }

      setLastUpdated(Date.now());
      setSecondsAgo(0);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, [isAdmin]);

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

  // Derived metrics
  const mrr = billing?.totalMrr;
  const outstanding = billing?.outstanding;
  const overdueCount = billing?.overdueCount ?? 0;
  const pipelineValue = pipelineSummary?.totalValue ?? 0;
  const dealsInProposal = pipelineSummary?.stages?.find(s => s.stage?.toLowerCase() === 'proposal')?.count ?? 0;
  const intelScore = intelligence?.overall_score;
  const intelFocus = intelligence?.analysis;

  // SEO summary
  const seoKeywordsUp = seoOverview.reduce((sum, c) => sum + (Number(c.total_clicks) || 0), 0);
  const seoClients = seoOverview.length;

  // Outreach summary
  const outreachTotal = outreach?.totalLeads ?? 0;
  const outreachInterested = outreach?.interested ?? 0;

  // Cron summary
  const cronFailedCount = cronHealth?.cronJobs?.filter(c => !c.healthy)?.length ?? 0;
  const cronTotal = cronHealth?.cronJobs?.length ?? 0;
  const systemScore = cronHealth?.overallScore;

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
                Welcome back, {user?.name?.split(' ')[0] || 'there'}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-slate-500">Growth Escalators CRM</p>
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

          {/* ── Today's Actions ── */}
          {actions.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Your Priority Today</h2>
              <div className="bg-white rounded-xl border-2 border-sky-200 p-4 mb-6 shadow-sm">
                <div className="space-y-2">
                  {actions.slice(0, 5).map((a, i) => (
                    <div key={i} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 ${
                      a.severity === 'critical' ? 'bg-red-50' : a.severity === 'high' ? 'bg-amber-50' : 'bg-yellow-50'
                    }`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        a.severity === 'critical' ? 'bg-red-500' : a.severity === 'high' ? 'bg-amber-500' : 'bg-yellow-400'
                      }`} />
                      <p className="text-sm text-slate-700"><strong>{a.title}</strong></p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── ROW 1: Core Metrics (all roles) ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Core Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {loading ? (
                [1,2,3,4].map(i => <div key={i} className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />)
              ) : (
                <>
                  <StatCard icon={Users} title="Total Contacts" value={fmtNum(contacts)} color="text-slate-900" />
                  <StatCard icon={TrendingUp} title="Active Deals" value={fmtNum(deals)} sub={dealsInProposal > 0 ? `${dealsInProposal} in proposal` : null} color="text-green-600" />
                  <StatCard icon={DollarSign} title="Monthly MRR" value={fmtINR(mrr)} color="text-sky-600" />
                  <StatCard icon={Receipt} title="Outstanding" value={fmtINR(outstanding)} sub={overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'} color="text-amber-600" alert={overdueCount > 0} />
                </>
              )}
            </div>
          </section>

          {/* ── ROW 2: Pipeline + Intelligence (all roles see pipeline, admin sees intel) ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Pipeline & Intelligence</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Target} title="Pipeline Value" value={fmtINR(pipelineValue)} color="text-indigo-600" />
              {isAdmin && intelligence ? (
                <div className="bg-white rounded-xl border border-slate-200 p-4 col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className={`w-4 h-4 ${intelScore >= 70 ? 'text-green-500' : intelScore >= 50 ? 'text-amber-500' : 'text-red-500'}`} />
                    <span className="text-xs text-slate-500">Today's Intelligence Score</span>
                    <span className={`ml-auto text-2xl font-bold ${intelScore >= 70 ? 'text-green-600' : intelScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {intelScore ?? '—'}
                    </span>
                  </div>
                  {intelFocus && (
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{intelFocus}</p>
                  )}
                </div>
              ) : isAdmin ? (
                <div className="bg-white rounded-xl border border-slate-200 p-4 col-span-2 flex items-center justify-center">
                  <a href="/crm/intelligence" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                    <Brain className="w-3.5 h-3.5" /> Generate today's intelligence report →
                  </a>
                </div>
              ) : null}
              {isAdmin && (
                <StatCard icon={Target} title="Outreach Leads" value={fmtNum(outreachTotal)} sub={outreachInterested > 0 ? `${outreachInterested} interested` : null} color="text-purple-600" />
              )}
            </div>
          </section>

          {/* ── ROW 3: SEO + System (admin only) ── */}
          {isAdmin && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">SEO & System Health</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={Search} title="SEO Clients Tracked" value={seoClients} sub={seoKeywordsUp > 0 ? `${fmtNum(seoKeywordsUp)} total clicks` : 'Run GSC workflow'} color="text-emerald-600" />
                <StatCard icon={Activity} title="System Health" value={systemScore != null ? `${systemScore}/100` : '—'} sub={cronFailedCount > 0 ? `${cronFailedCount}/${cronTotal} crons unhealthy` : `${cronTotal} crons healthy`} color={cronFailedCount > 0 ? 'text-amber-600' : 'text-green-600'} alert={cronFailedCount > 2} />
                <StatCard icon={CreditCard} title="Billing MRR" value={fmtINR(mrr)} sub={mrr ? `₹${((mrr / 100) * 12).toLocaleString('en-IN')} ARR` : null} color="text-sky-600" />
                <StatCard icon={Zap} title="Deals in Pipeline" value={fmtNum(deals)} sub={pipelineSummary?.stages?.length ? `${pipelineSummary.stages.length} stages` : null} color="text-indigo-600" />
              </div>
            </section>
          )}

          {/* ── ROW 4: Quick Links ── */}
          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Access</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { icon: Users, label: 'Contacts', path: '/contacts', color: 'bg-sky-50 text-sky-600', roles: ['admin','manager_ops','sales','staff'] },
                { icon: Kanban, label: 'Pipeline', path: '/pipeline', color: 'bg-indigo-50 text-indigo-600', roles: ['admin','manager_ops','sales','staff'] },
                { icon: MessageSquare, label: 'Inbox', path: '/inbox', color: 'bg-purple-50 text-purple-600', roles: ['admin','manager_ops','sales','staff'] },
                { icon: BarChart2, label: 'Meta Ads', path: '/ads', color: 'bg-green-50 text-green-600', roles: ['admin','manager_ads'] },
                { icon: Search, label: 'SEO', path: '/seo', color: 'bg-emerald-50 text-emerald-600', roles: ['admin','manager_ops','manager_ads'] },
                { icon: Brain, label: 'AI Intelligence', path: '/intelligence', color: 'bg-violet-50 text-violet-600', roles: ['admin'] },
                { icon: FileText, label: 'Reports', path: '/reports', color: 'bg-amber-50 text-amber-600', roles: ['admin','manager_ops','manager_ads'] },
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
