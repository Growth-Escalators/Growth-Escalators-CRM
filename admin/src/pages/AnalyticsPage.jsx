import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import TeamPerformanceSection from '../components/TeamPerformanceSection.jsx';
import KpiTile from '../components/charts/KpiTile.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import FunnelChart from '../components/charts/FunnelChart.jsx';
import StackedBars from '../components/charts/StackedBars.jsx';
import { apiFetch } from '../lib/api.js';
import { formatINRFromPaise, formatNumber } from '../lib/format.js';
import { TrendingUp, Users, AlertCircle, RefreshCw } from 'lucide-react';

const PERIODS = [
  { id: '30d',  label: '30 days',    days: 30,  months: 2 },
  { id: '90d',  label: '90 days',    days: 90,  months: 4 },
  { id: 'ytd',  label: 'Year-to-date', days: 365, months: 12 },
  { id: 'custom', label: 'Custom',   days: 180, months: 12 },
];

const PERIOD_KEY = 'ge-analytics-period';

// Stable colour palette for lead-source segments in the stacked-bar chart.
const SOURCE_PALETTE = [
  '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#84cc16', '#ec4899', '#6366f1', '#94a3b8',
];

function loadInitialPeriod() {
  try {
    const stored = localStorage.getItem(PERIOD_KEY);
    if (stored && PERIODS.some(p => p.id === stored)) return stored;
  } catch {}
  return '30d';
}

function ErrorBanner({ error, onRetry }) {
  return (
    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-rose-700">
        <AlertCircle className="w-5 h-5" />
        <div>
          <p className="text-sm font-semibold">Failed to load analytics</p>
          <p className="text-xs text-rose-600 mt-0.5">{error}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-200 rounded-md text-sm font-medium text-rose-700 hover:bg-rose-50"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 min-h-[120px] animate-pulse space-y-3">
      <div className="h-3 bg-slate-100 rounded w-24" />
      <div className="h-7 bg-slate-200 rounded w-32" />
      <div className="h-8 bg-slate-100 rounded mt-auto" />
    </div>
  );
}

function SkeletonChart({ height = 240 }) {
  return (
    <div
      className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse"
      style={{ height: height + 32 }}
    >
      <div className="flex items-end gap-2 h-full pb-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-slate-100 rounded"
            style={{ height: `${30 + Math.random() * 60}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data shaping helpers
// ---------------------------------------------------------------------------

// Revenue trend endpoint returns monthly buckets. Trim to the selected period
// (the backend defaults to 12 months; we'll request the period's month count).
function shapeRevenueSeries(payload) {
  const data = payload?.data || [];
  return data.map(d => ({
    date: d.month,
    value: Number(d.totalPaise || 0) / 100, // rupees for nicer axis labels
  }));
}

function shapeMrrSeries(payload) {
  const trend = payload?.trend || [];
  return trend.map(d => ({
    date: d.month,
    value: Number(d.mrrPaise || 0) / 100,
  }));
}

// Convert lead-sources + trends into stacked bars: x = day bucket, segments = source.
// The /trends endpoint doesn't return source breakdown per day, so we use
// lead-sources totals split into a single column when no time-series is available.
// As a useful approximation we render one stacked column per source totals,
// grouped into a single "Period" bar — but a richer breakdown is preferable.
// The endpoint best-suited for monthly source data is /lead-sources (aggregate);
// we render it as one column per source group instead to keep the chart honest.
function shapeSourceStacks(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return [];
  // Render a single column per source ("Leads by source"), with one segment each.
  return sources
    .slice()
    .sort((a, b) => (b.totalLeads || 0) - (a.totalLeads || 0))
    .slice(0, 10) // keep chart legible
    .map((s, i) => ({
      label: String(s.source || 'unknown').replace(/_/g, ' '),
      segments: [
        {
          name: 'Leads',
          value: Number(s.totalLeads) || 0,
          color: SOURCE_PALETTE[i % SOURCE_PALETTE.length],
        },
        {
          name: 'Won',
          value: Number(s.wonCount) || 0,
          color: '#0f766e', // dark teal for won overlay
        },
      ],
    }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [periodId, setPeriodId] = useState(loadInitialPeriod);
  const [activeTab, setActiveTab] = useState('leads');
  const [searchOpen, setSearchOpen] = useState(false);

  // Server payloads
  const [funnel, setFunnel] = useState(null);
  const [sources, setSources] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [mrr, setMrr] = useState(null);
  const [deals, setDeals] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const period = PERIODS.find(p => p.id === periodId) || PERIODS[0];

  // Persist period selection
  useEffect(() => {
    try { localStorage.setItem(PERIOD_KEY, periodId); } catch {}
  }, [periodId]);

  // Global search shortcut
  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const fetchAll = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch('/api/analytics/funnel'),
      apiFetch('/api/analytics/lead-sources'),
      apiFetch(`/api/analytics/revenue-trend?months=${period.months}`),
      apiFetch(`/api/analytics/mrr-trend?months=${Math.min(period.months, 12)}`),
      apiFetch('/api/deals?limit=1000').catch(() => ({ deals: [] })),
    ])
      .then(([f, s, r, m, d]) => {
        setFunnel(f);
        setSources(s);
        setRevenue(r);
        setMrr(m);
        setDeals(d);
      })
      .catch(e => setError(e?.message || 'Unknown error'))
      .finally(() => setLoading(false));
  }, [period.months]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ---- Derived KPIs ----
  const revenueSeries = useMemo(() => shapeRevenueSeries(revenue), [revenue]);
  const mrrSeries = useMemo(() => shapeMrrSeries(mrr), [mrr]);

  const currentMrr = Number(mrr?.currentMrrPaise || 0) / 100;
  const lastMrrMonth = mrrSeries.length > 0 ? mrrSeries[mrrSeries.length - 1].value : 0;
  const prevMrrMonth = mrrSeries.length > 1 ? mrrSeries[mrrSeries.length - 2].value : 0;
  const mrrDelta = prevMrrMonth > 0
    ? ((lastMrrMonth - prevMrrMonth) / prevMrrMonth) * 100
    : null;

  const revenueTotal = revenueSeries.reduce((acc, d) => acc + d.value, 0);
  const halfIdx = Math.floor(revenueSeries.length / 2);
  const recent = revenueSeries.slice(halfIdx).reduce((a, d) => a + d.value, 0);
  const older = revenueSeries.slice(0, halfIdx).reduce((a, d) => a + d.value, 0);
  const revenueDelta = older > 0 ? ((recent - older) / older) * 100 : null;

  const wonStage = funnel?.stages?.find(s => s.name === 'Won');
  const wonCount = wonStage?.count || 0;

  // Pipeline value: sum(value * probability/100) over open stages (not won/lost).
  const openDeals = (deals?.deals || []).filter(d => {
    const st = String(d.stage || '').toLowerCase();
    return st && st !== 'won' && st !== 'lost' && st !== 'closed_lost';
  });
  const pipelineValuePaise = openDeals.reduce((acc, d) => {
    const v = Number(d.value || d.dealValue || 0);
    const p = Number(d.probability != null ? d.probability : 50);
    return acc + (v * p) / 100;
  }, 0);
  const wonDealsValue = (deals?.deals || [])
    .filter(d => String(d.stage || '').toLowerCase() === 'won')
    .reduce((acc, d) => acc + Number(d.value || d.dealValue || 0), 0);

  // Sparkline values for tiles
  const revenueSpark = revenueSeries.map(d => d.value);
  const mrrSpark = mrrSeries.map(d => d.value);
  const wonSpark = funnel?.stages ? funnel.stages.map(s => s.count) : [];

  const sourceStacks = useMemo(() => shapeSourceStacks(sources?.sources || []), [sources]);

  // ---- Render ----
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-6 h-6 text-sky-600" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
                <p className="text-sm text-slate-500">KPIs, funnel, revenue, MRR</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Tab toggle */}
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('leads')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'leads' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <TrendingUp className="w-4 h-4" /> Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('team')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'team' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Users className="w-4 h-4" /> Team
                </button>
              </div>

              {/* Period selector */}
              {activeTab === 'leads' && (
                <div className="flex bg-slate-100 rounded-lg p-1">
                  {PERIODS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPeriodId(p.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${periodId === p.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && activeTab === 'leads' && (
            <ErrorBanner error={error} onRetry={fetchAll} />
          )}

          {activeTab === 'leads' && (
            <>
              {/* KPI tiles row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)
                ) : (
                  <>
                    <KpiTile
                      label="MRR"
                      value={currentMrr}
                      valueFormat="currency"
                      delta={mrrDelta}
                      sparklineValues={mrrSpark}
                      sparklineColor="#10b981"
                      hint="Active retainers"
                    />
                    <KpiTile
                      label="Revenue (period)"
                      value={revenueTotal}
                      valueFormat="currency"
                      delta={revenueDelta}
                      sparklineValues={revenueSpark}
                      sparklineColor="#0ea5e9"
                      hint={`${revenueSeries.length} month buckets`}
                    />
                    <KpiTile
                      label="Won deals"
                      value={wonCount}
                      valueFormat="number"
                      sparklineValues={wonSpark}
                      sparklineColor="#8b5cf6"
                      hint={wonDealsValue > 0 ? `${formatINRFromPaise(wonDealsValue)} closed value` : 'All-time'}
                    />
                    <KpiTile
                      label="Pipeline value"
                      value={pipelineValuePaise / 100}
                      valueFormat="currency"
                      sparklineValues={openDeals.map(d => Number(d.value || 0) / 100)}
                      sparklineColor="#f59e0b"
                      hint={`${openDeals.length} open deals (weighted)`}
                    />
                  </>
                )}
              </div>

              {/* Revenue chart */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-700">Revenue Trend</h2>
                  <span className="text-xs text-slate-400">Monthly (paise from /payments)</span>
                </div>
                {loading ? (
                  <SkeletonChart />
                ) : revenueSeries.length > 0 ? (
                  <LineChart data={revenueSeries} color="#0ea5e9" valueFormat="currency" height={240} />
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 h-40 flex items-center justify-center text-sm text-slate-400">
                    No revenue recorded yet
                  </div>
                )}
              </section>

              {/* MRR chart */}
              <section>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-700">MRR Trend</h2>
                  <span className="text-xs text-slate-400">From invoices</span>
                </div>
                {loading ? (
                  <SkeletonChart />
                ) : mrrSeries.length > 0 ? (
                  <LineChart data={mrrSeries} color="#10b981" valueFormat="currency" height={220} />
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 h-40 flex items-center justify-center text-sm text-slate-400">
                    No invoices yet
                  </div>
                )}
              </section>

              {/* Two-column row: Funnel + Lead sources */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-700 mb-2">Conversion Funnel</h2>
                  {loading ? (
                    <SkeletonChart height={280} />
                  ) : (
                    <FunnelChart stages={funnel?.stages || []} />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-700 mb-2">Lead Sources</h2>
                  {loading ? (
                    <SkeletonChart height={280} />
                  ) : sourceStacks.length > 0 ? (
                    <StackedBars data={sourceStacks} height={240} />
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200 h-40 flex items-center justify-center text-sm text-slate-400">
                      No lead-source data yet
                    </div>
                  )}
                </div>
              </section>

              {/* Source breakdown table — keeps the most-actionable detail */}
              {!loading && (sources?.sources || []).length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-slate-700 mb-2">Source Performance</h2>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500">Source</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Leads</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Avg Score</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Booking %</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Conversion %</th>
                          <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Hot %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sources.sources.map(s => (
                          <tr key={s.source} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className="px-4 py-2 text-sm font-medium text-slate-800 capitalize">
                              {String(s.source || 'unknown').replace(/_/g, ' ')}
                            </td>
                            <td className="px-4 py-2 text-sm text-slate-700 text-right">{formatNumber(s.totalLeads)}</td>
                            <td className="px-4 py-2 text-sm text-slate-700 text-right">{s.avgScore}</td>
                            <td className="px-4 py-2 text-sm text-slate-700 text-right">{s.bookingRate}%</td>
                            <td className="px-4 py-2 text-sm text-right">
                              <span className={`font-semibold ${s.conversionRate > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {s.conversionRate}%
                              </span>
                            </td>
                            <td className="px-4 py-2 text-sm text-slate-700 text-right">{s.hotLeadRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}

          {activeTab === 'team' && <TeamPerformanceSection />}
        </div>
      </main>
    </div>
  );
}
