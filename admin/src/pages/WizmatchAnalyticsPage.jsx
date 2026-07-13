import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const STATUS_BADGE = {
  healthy: 'badge-success',
  watch: 'badge-warning',
  blocked: 'badge-danger',
};

const DEMO_ROI = {
  generatedAt: '2026-07-06T00:00:00.000Z',
  from: '2026-06-06',
  to: '2026-07-06',
  guardrails: {
    paidEnrichment: 'disabled_until_qualified',
    sending: 'manual_review_only',
    deterministicBeforeAi: true,
    scope: 'internal_it_tech_staffing_only',
  },
  kpis: {
    prioritySignalRate: 31,
    indiaSignalShare: 82,
    matchRate: 54,
    draftRate: 48,
    sendRate: 42,
    positiveReplyRate: 12,
    contactApprovalRate: 63,
    contactLinkRate: 70,
    requirementCoverage: 67,
    placementStartRate: 18,
    monthlyMargin: 384000,
    estimatedAnnualRunRate: 4608000,
    costCentsTotal: 0,
    costPerApprovedContactCents: 0,
  },
  funnel: [
    { stage: 'Signals captured', count: 126, conversionFromPrevious: null, status: 'healthy' },
    { stage: 'Priority signals', count: 39, conversionFromPrevious: 31, status: 'watch' },
    { stage: 'Matched signals', count: 21, conversionFromPrevious: 53.8, status: 'healthy' },
    { stage: 'Drafted outreach', count: 10, conversionFromPrevious: 47.6, status: 'healthy' },
    { stage: 'Sent outreach', count: 7, conversionFromPrevious: 70, status: 'healthy' },
    { stage: 'Positive replies', count: 2, conversionFromPrevious: 28.6, status: 'watch' },
    { stage: 'Active placements', count: 1, conversionFromPrevious: 50, status: 'healthy' },
  ],
  moduleScorecards: [
    { module: 'Client Discovery', score: 89, status: 'healthy', summary: '39/126 signals are priority; India share is 82%.' },
    { module: 'Contact Intelligence', score: 100, status: 'healthy', summary: '5 approved contacts from 8 reviewed companies.' },
    { module: 'Candidate Intelligence', score: 76, status: 'healthy', summary: '64/92 candidates are available; 11 certified.' },
    { module: 'Requirement Intake', score: 100, status: 'healthy', summary: '6/9 open requirements have sheet/review coverage.' },
    { module: 'Placement ROI', score: 100, status: 'healthy', summary: '1 active placement; estimated monthly margin 384000.' },
  ],
  sourceBreakdown: [
    { source: 'naukri', count: 74, avgScore: 7.4 },
    { source: 'manual', count: 31, avgScore: 6.8 },
    { source: 'ats', count: 21, avgScore: 6.1 },
  ],
  recommendations: [
    'Keep current guardrails: deterministic scoring, manual review, and qualified-only enrichment.',
    'Push urgent requirements through sheet/review readiness before widening discovery.',
  ],
  risks: ['No critical ROI risks detected from current deterministic metrics.'],
};

const DEMO_ANALYTICS = {
  domains: [
    { domain: 'growthescalators.com', sends_7d: 7, reply_rate_7d: 0.12, bounce_rate_7d: 0.01, status: 'healthy' },
    { domain: 'example-outreach.com', sends_7d: 4, reply_rate_7d: 0.05, bounce_rate_7d: 0.04, status: 'watch' },
  ],
  pipeline: [
    { status: 'submitted', count: 3, monthly_value: 0 },
    { status: 'interviewing', count: 2, monthly_value: 0 },
    { status: 'started', count: 1, monthly_value: 384000 },
  ],
  sources: DEMO_ROI.sourceBreakdown.map((source) => ({ source: source.source, count: source.count, avg_score: source.avgScore })),
};

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary-500" />
      <div className="text-[12.5px] text-neutral-500 font-medium">{label}</div>
      <div className="text-[26px] font-bold text-neutral-900 mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </div>
  );
}

function FunnelRow({ item, max }) {
  const width = Math.max(5, Math.round((Number(item.count || 0) / Math.max(max, 1)) * 100));
  return (
    <div className="grid grid-cols-[150px_1fr_90px] gap-3 items-center">
      <div>
        <p className="text-sm font-semibold text-neutral-800">{item.stage}</p>
        <p className="text-[12px] text-neutral-500">
          {item.conversionFromPrevious == null ? 'Start' : `${formatPct(item.conversionFromPrevious)} from previous`}
        </p>
      </div>
      <div className="h-8 bg-neutral-100 rounded-md overflow-hidden">
        <div className="h-full bg-primary-500 rounded-md flex items-center justify-end px-2" style={{ width: `${width}%` }}>
          <span className="text-xs font-bold text-white">{item.count}</span>
        </div>
      </div>
      <span className={STATUS_BADGE[item.status] || 'badge-muted'}>{item.status}</span>
    </div>
  );
}

function ModuleScorecard({ item }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">{item.module}</p>
          <p className="text-[12.5px] text-neutral-500 mt-1">{item.summary}</p>
        </div>
        <div className="text-right">
          <span className={STATUS_BADGE[item.status] || 'badge-muted'}>{item.status}</span>
          <p className="mt-2 text-lg font-bold text-neutral-900">{item.score}</p>
        </div>
      </div>
    </div>
  );
}

export default function WizmatchAnalyticsPage({ demoMode = false }) {
  const [analytics, setAnalytics] = useState(demoMode ? DEMO_ANALYTICS : null);
  const [digest, setDigest] = useState(null);
  const [roi, setRoi] = useState(demoMode ? DEMO_ROI : null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setAnalytics(DEMO_ANALYTICS);
      setRoi(DEMO_ROI);
      setDigest({ stats: { signals_captured: 126, signals_priority: 39, sends: 7, positive_replies: 2, candidates_sourced: 92 } });
      setLoading(false);
      return;
    }
    try {
      const [a, d, r] = await Promise.all([
        apiFetch('/api/wizmatch/analytics'),
        apiFetch('/api/wizmatch/digest'),
        apiFetch('/api/wizmatch/analytics/roi'),
      ]);
      setAnalytics(a);
      setDigest(d);
      setRoi(r);
    } catch (e) {
      console.error(e);
      setAnalytics(null);
      setRoi(null);
      setDigest({ stats: {} });
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => { load(); }, [load]);

  const s = digest?.stats || {};
  const maxFunnel = useMemo(() => Math.max(...(roi?.funnel || []).map((item) => item.count || 0), 1), [roi]);

  if (loading) return <div className="p-6"><p className="text-neutral-400">Loading...</p></div>;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Wizmatch Analytics / ROI</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Discovery → contact review → candidate readiness → requirements → placements{demoMode ? ' · demo data' : ''}
          </p>
        </div>
        <button onClick={load} className="btn-standard btn-compact self-start" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Signals Today" value={s.signals_captured || 0} sub={`${s.signals_priority || 0} priority`} />
        <KpiCard label="Positive Reply Rate" value={formatPct(roi?.kpis?.positiveReplyRate)} sub={`${s.sends || 0} sends today`} />
        <KpiCard label="India Signal Share" value={formatPct(roi?.kpis?.indiaSignalShare)} sub="Target: 80%" />
        <KpiCard label="Monthly Margin" value={formatCurrency(roi?.kpis?.monthlyMargin)} sub={`${formatCurrency(roi?.kpis?.estimatedAnnualRunRate)} ARR run-rate`} />
        <KpiCard label="Enrichment Cost" value={formatCurrency((roi?.kpis?.costCentsTotal || 0) / 100)} sub="Phase 1 should stay near zero" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Operating Funnel</h2>
          </div>
          <div className="space-y-4">
            {(roi?.funnel || []).map((item) => (
              <FunnelRow key={item.stage} item={item} max={maxFunnel} />
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-primary-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Guardrails</h2>
          </div>
          <div className="space-y-2 text-[12.5px] text-neutral-600">
            <p className="rounded-md bg-neutral-50 px-3 py-2">Paid enrichment: {roi?.guardrails?.paidEnrichment?.replace(/_/g, ' ')}</p>
            <p className="rounded-md bg-neutral-50 px-3 py-2">Sending: {roi?.guardrails?.sending?.replace(/_/g, ' ')}</p>
            <p className="rounded-md bg-neutral-50 px-3 py-2">Deterministic before AI: {roi?.guardrails?.deterministicBeforeAi ? 'yes' : 'no'}</p>
            <p className="rounded-md bg-neutral-50 px-3 py-2">Scope: internal IT/Tech staffing only</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-6">
        {(roi?.moduleScorecards || []).map((item) => (
          <ModuleScorecard key={item.module} item={item} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-success-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Recommended Next Moves</h2>
          </div>
          <div className="space-y-2">
            {(roi?.recommendations || []).map((item) => (
              <p key={item} className="text-[12.5px] text-neutral-700 rounded-md bg-neutral-50 px-3 py-2">{item}</p>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-warning-600" />
            <h2 className="text-[15px] font-semibold text-neutral-800">Risks</h2>
          </div>
          <div className="space-y-2">
            {(roi?.risks || []).map((item) => (
              <p key={item} className="text-[12.5px] text-neutral-700 rounded-md bg-neutral-50 px-3 py-2">{item}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Domain Performance</h2>
          <div className="card p-4 overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="text-left text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Domain</th>
                  <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Sends 7d</th>
                  <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Reply</th>
                  <th className="text-right text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Bounce</th>
                  <th className="text-center text-[11px] text-neutral-500 uppercase font-semibold tracking-wider pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(analytics?.domains || []).map((d) => (
                  <tr key={d.domain} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2 text-sm font-medium text-neutral-900">{d.domain}</td>
                    <td className="py-2 text-sm text-neutral-600 text-right">{d.sends_7d}</td>
                    <td className="py-2 text-sm text-neutral-600 text-right">{formatPct((d.reply_rate_7d || 0) * 100)}</td>
                    <td className="py-2 text-sm text-neutral-600 text-right">{formatPct((d.bounce_rate_7d || 0) * 100)}</td>
                    <td className="py-2 text-center"><span className={d.status === 'healthy' ? 'badge-success' : 'badge-warning'}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(analytics?.domains || []).length === 0 && <p className="text-neutral-400 text-sm">No domain stats yet</p>}
          </div>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Signals by Source</h2>
          <div className="card p-4">
            {(roi?.sourceBreakdown || analytics?.sources || []).map((src) => (
              <div key={src.source} className="flex justify-between items-center py-2 border-b border-neutral-100 last:border-0">
                <span className="text-sm font-medium text-neutral-900 capitalize">{src.source}</span>
                <div className="flex gap-4">
                  <span className="text-sm text-neutral-600">{src.count} signals</span>
                  <span className="text-sm text-neutral-500">avg score {Number(src.avgScore ?? src.avg_score ?? 0).toFixed(1)}</span>
                </div>
              </div>
            ))}
            {(roi?.sourceBreakdown || analytics?.sources || []).length === 0 && <p className="text-neutral-400 text-sm">No signals yet</p>}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-semibold text-neutral-700 mb-3">Pipeline Value by Stage</h2>
        <div className="card p-4">
          {(analytics?.pipeline || []).map((p) => (
            <div key={p.status} className="flex items-center gap-3 mb-2">
              <span className="text-sm text-neutral-700 w-32 capitalize">{p.status}</span>
              <div className="flex-1 bg-neutral-100 rounded-full h-6 relative">
                <div
                  className="bg-primary-500 h-6 rounded-full flex items-center justify-end px-2 transition-all duration-200"
                  style={{ width: `${Math.min(100, (p.count / Math.max(...(analytics?.pipeline?.map((x) => x.count) || [1]))) * 100)}%` }}
                >
                  <span className="text-xs text-white font-medium">{p.count}</span>
                </div>
              </div>
              <span className="text-sm text-success-600 w-28 text-right font-medium">{formatCurrency(p.monthly_value || 0)}</span>
            </div>
          ))}
          {(analytics?.pipeline || []).length === 0 && <p className="text-neutral-400 text-sm">No placements yet</p>}
        </div>
      </div>
    </div>
  );
}
