import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { apiFetch, getUser } from '../lib/api.js';
import { KpiTile, Card, Badge } from '../components/ui/index.js';
import {
  Users, TrendingUp, DollarSign, Receipt, BarChart2, Kanban,
  FileText, Share2, MessageSquare, Brain, Search, Activity,
  AlertTriangle, CheckCircle, ArrowUp, ArrowDown, RefreshCw,
  Clock, Zap, Target, CreditCard, ChevronRight, ChevronDown,
  Sparkles, AlertCircle
} from 'lucide-react';

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

function severityDot(s) {
  if (s === 'critical') return 'bg-danger-500';
  if (s === 'high') return 'bg-warning-500';
  return 'bg-neutral-400';
}
function severityBadgeType(s) {
  if (s === 'critical') return 'danger';
  if (s === 'high') return 'warning';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Action Item with expand — a row inside the shared Priority Actions Card
// ---------------------------------------------------------------------------
function ActionItem({ action, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-neutral-100 last:border-b-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-neutral-50 transition-colors"
      >
        <span className={`w-[9px] h-[9px] rounded-full flex-shrink-0 ${severityDot(action.severity)}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{action.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {action.owner && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 font-medium">{action.owner}</span>
            )}
            {action.deadline && (
              <span className="text-xs text-neutral-500 flex items-center gap-1"><Clock className="w-3 h-3" />{action.deadline}</span>
            )}
          </div>
        </div>
        <Badge type={severityBadgeType(action.severity)}>{action.severity || 'normal'}</Badge>
        {open ? <ChevronDown className="w-4 h-4 text-neutral-400" /> : <ChevronRight className="w-4 h-4 text-neutral-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-2 bg-neutral-50/60">
          {action.business_impact && (
            <p className="text-xs text-neutral-600"><span className="font-semibold">Impact:</span> {action.business_impact}</p>
          )}
          {action.what_is_broken && (
            <p className="text-xs text-neutral-600"><span className="font-semibold">What's broken:</span> {action.what_is_broken}</p>
          )}
          {action.fix_steps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-600 mb-1">Fix steps:</p>
              <ol className="space-y-1 ml-1">
                {action.fix_steps.map((s, i) => (
                  <li key={i} className="text-xs text-neutral-700 flex gap-2">
                    <span className="w-4 h-4 bg-neutral-200 rounded-full text-neutral-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">{i + 1}</span>
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
function HighlightCard({ icon: Icon, title, items, accent, iconColor }) {
  if (!items || items.length === 0) return null;
  return (
    <Card accent={accent}>
      <Card.Header title={<span className="flex items-center gap-2"><Icon className={`w-4 h-4 ${iconColor}`} />{title}</span>} />
      <div className="divide-y divide-neutral-50">
        {items.map((item, i) => (
          <div key={i} className="px-5 py-3">
            {typeof item === 'string' ? (
              <p className="text-sm text-neutral-700">{item}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-neutral-800">{item.title || item.metric || item.description}</p>
                {item.detail && <p className="text-xs text-neutral-500 mt-0.5">{item.detail}</p>}
                {item.change && <p className="text-xs text-neutral-500 mt-0.5">{item.change}</p>}
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
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
  const [pendingLeaves, setPendingLeaves] = useState(0);

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
        const [intelData, seoData, outreachData, cronData, pendingLeaveData] = await Promise.all([
          apiFetch('/api/intelligence/today').catch(() => null),
          apiFetch('/api/seo/overview').catch(() => null),
          apiFetch('/api/outreach/leads/dashboard').catch(() => null),
          apiFetch('/api/intelligence/system-health').catch(() => null),
          apiFetch('/api/finance/leaves/pending-count').catch(() => null),
        ]);
        const report = intelData?.report ?? null;
        setIntelligence(report);
        setSeoOverview(seoData?.clients ?? []);
        setOutreach(outreachData);
        setCronHealth(cronData);
        setPendingLeaves(pendingLeaveData?.count ?? 0);

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
    admin: 'bg-primary-100 text-primary-700',
    manager_ops: 'bg-primary-100 text-primary-700',
    manager_ads: 'bg-primary-100 text-primary-700',
    sales: 'bg-accent-100 text-accent-700',
    staff: 'bg-neutral-100 text-neutral-500',
  };

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 space-y-6">
          {/* Welcome + refresh */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900">
                Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {firstName}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-neutral-500">Here's what needs your attention today</p>
                {user?.role && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE[user.role] || ROLE_BADGE.staff}`}>
                    {user.role.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-neutral-400">
                  {secondsAgo < 10 ? 'Just now' : `${secondsAgo}s ago`}
                </span>
              )}
              <button onClick={loadStats} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-neutral-200 rounded-lg bg-white hover:bg-neutral-50 disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-danger-500/10 border border-danger-500/20 rounded-lg p-4 text-sm text-danger-700">
              Could not load some dashboard data. Try refreshing.
            </div>
          )}

          {isAdmin && pendingLeaves > 0 && (
            <a href="/finance" className="block bg-accent-50 border border-accent-200 rounded-lg px-4 py-3 hover:bg-accent-100 transition-colors">
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-accent-600 flex-shrink-0" />
                <p className="text-sm text-[#7c2d12] flex-1">
                  <span className="font-semibold">{pendingLeaves} leave request{pendingLeaves === 1 ? '' : 's'}</span> pending your approval
                </p>
                <span className="text-accent-600 text-sm font-medium flex items-center gap-0.5">Review <ChevronRight className="w-4 h-4" /></span>
              </div>
            </a>
          )}

          {/* ── YOUR PRIORITY ACTIONS (personalized) ── */}
          {myActions.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-warning-500" />
                Your Priority Actions Today
              </h2>
              <Card>
                {myActions.slice(0, 5).map((a, i) => (
                  <ActionItem key={i} action={a} defaultOpen={i === 0} />
                ))}
              </Card>
            </section>
          )}

          {/* ── AI INTELLIGENCE SCORE + COACHING ── */}
          {isAdmin && coachingScore && (
            <section>
              <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-primary-500" />
                AI Coaching Score
              </h2>
              <Card>
                <Card.Body>
                  <div className="flex items-center gap-6 mb-4">
                    <div
                      className="w-[76px] h-[76px] rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: `conic-gradient(#3b82f6 ${Math.min(Math.max(intelScore ?? 0, 0), 100) * 3.6}deg, #e2e8f0 0deg)` }}
                    >
                      <div className="w-[60px] h-[60px] rounded-full bg-white flex flex-col items-center justify-center">
                        <p className="text-xl font-bold text-neutral-900 leading-none">{intelScore ?? '—'}</p>
                        <p className="text-[9px] text-neutral-400 mt-0.5">Overall</p>
                      </div>
                    </div>
                    <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        { label: 'Ads', score: coachingScore.ads, icon: BarChart2 },
                        { label: 'SEO', score: coachingScore.seo, icon: Search },
                        { label: 'Sales', score: coachingScore.sales, icon: TrendingUp },
                        { label: 'Ops', score: coachingScore.ops, icon: Activity },
                      ].map(s => (
                        <div key={s.label} className="text-center bg-neutral-50 rounded-lg py-2.5">
                          <s.icon className="w-3.5 h-3.5 mx-auto text-neutral-400 mb-1" />
                          <p className={`text-lg font-bold ${(s.score ?? 0) >= 70 ? 'text-success-600' : (s.score ?? 0) >= 50 ? 'text-warning-600' : 'text-danger-600'}`}>
                            {s.score ?? '—'}
                          </p>
                          <p className="text-[10px] text-neutral-500 uppercase font-semibold">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {intelFocus && (
                    <div className="bg-[rgba(59,130,246,0.06)] border border-primary-100 rounded-lg px-4 py-3">
                      <p className="text-xs font-semibold text-[#1d4ed8] mb-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> AI Focus Summary
                      </p>
                      <p className="text-sm text-primary-900 leading-relaxed">{intelFocus}</p>
                    </div>
                  )}
                  <div className="mt-3 text-right">
                    <a href="/intelligence" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                      View full AI Intelligence report →
                    </a>
                  </div>
                </Card.Body>
              </Card>
            </section>
          )}

          {/* ── HIGHLIGHTS: Wins + Anomalies ── */}
          {isAdmin && (wins.length > 0 || anomalies.length > 0) && (
            <section>
              <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-success-500" />
                Today's Highlights
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <HighlightCard
                  icon={CheckCircle}
                  title="Wins"
                  items={wins}
                  accent="success"
                  iconColor="text-success-600"
                />
                <HighlightCard
                  icon={AlertTriangle}
                  title="Anomalies"
                  items={anomalies}
                  accent="accent"
                  iconColor="text-accent-600"
                />
              </div>
            </section>
          )}

          {/* ── CORE METRICS ── */}
          <section>
            <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">Core Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {loading ? (
                [1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-white rounded-lg border border-neutral-200 animate-pulse" />)
              ) : (
                <>
                  <KpiTile label="Total Contacts" value={fmtNum(contacts)} onClick={() => window.location.href = '/contacts'} />
                  <KpiTile label="Active Deals" value={fmtNum(deals)} sub={dealsInProposal > 0 ? `${dealsInProposal} in proposal` : null} onClick={() => window.location.href = '/pipeline'} />
                  <KpiTile label="Monthly MRR" value={fmtINR(mrr)} />
                  <KpiTile label="Outstanding" value={fmtINR(outstanding)} sub={overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'} accent="accent" />
                </>
              )}
            </div>
          </section>

          {/* ── PIPELINE & OUTREACH ── */}
          <section>
            <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">Pipeline & Growth</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile label="Pipeline Value" value={fmtINR(pipelineValue)} onClick={() => window.location.href = '/pipeline'} />
              {isAdmin && (
                <>
                  <KpiTile label="Outreach Leads" value={fmtNum(outreachTotal)} sub={outreachInterested > 0 ? `${outreachInterested} interested` : null} onClick={() => window.location.href = '/outreach-dashboard'} />
                  <KpiTile label="System Health" value={cronHealth?.overallScore != null ? `${cronHealth.overallScore}/100` : '—'} sub={cronFailedCount > 0 ? `${cronFailedCount}/${cronTotal} crons unhealthy` : `${cronTotal} crons healthy`} accent={cronFailedCount > 2 ? 'accent' : 'primary'} />
                </>
              )}
            </div>
          </section>

          {/* ── ALL TEAM ACTIONS (admin can see everyone's) ── */}
          {isAdmin && allActions.length > myActions.length && (
            <section>
              <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">All Team Actions</h2>
              <div className="space-y-2">
                {allActions.filter(a => !myActions.includes(a)).slice(0, 5).map((a, i) => (
                  <ActionItem key={i} action={a} />
                ))}
              </div>
            </section>
          )}

          {/* ── QUICK ACCESS ── */}
          <section>
            <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">Quick Access</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { icon: Users, label: 'Contacts', path: '/contacts', roles: ['admin', 'manager_ops', 'sales', 'staff'] },
                { icon: Kanban, label: 'Pipeline', path: '/pipeline', roles: ['admin', 'manager_ops', 'sales', 'staff'] },
                { icon: MessageSquare, label: 'Inbox', path: '/inbox', roles: ['admin', 'manager_ops', 'sales', 'staff'] },
                { icon: BarChart2, label: 'Meta Ads', path: '/ads', roles: ['admin', 'manager_ads'] },
                { icon: Search, label: 'SEO', path: '/seo', roles: ['admin', 'manager_ops', 'manager_ads'] },
                { icon: Brain, label: 'AI Intelligence', path: '/intelligence', roles: ['admin'] },
                { icon: FileText, label: 'Reports', path: '/reports', roles: ['admin', 'manager_ops', 'manager_ads'] },
                { icon: Share2, label: 'Outreach', path: '/outreach-dashboard', roles: ['admin'] },
              ].filter(link => link.roles.includes(user?.role || 'staff')).map(link => (
                <a key={link.path} href={`/crm${link.path}`}
                  className="bg-white rounded-lg border border-neutral-200 p-4 flex items-center gap-3 hover:shadow-hover transition-all">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-neutral-50">
                    <link.icon className="w-4 h-4 text-primary-600" />
                  </div>
                  <p className="text-[12px] font-semibold text-neutral-800">{link.label}</p>
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
