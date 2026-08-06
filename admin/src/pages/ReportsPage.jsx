import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { apiFetch } from '../lib/api.js';
import { getAuthToken } from '../lib/auth.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import { SkeletonCard } from '../components/SkeletonLoader.jsx';
import {
  FileText, Calendar, Download, Send, RefreshCw, CheckCircle2,
  AlertCircle, ArrowUp, ArrowDown, Minus, BarChart2, Search, Receipt,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMonthLabel(monthStr) {
  if (!monthStr) return '—';
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m) return monthStr;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function fmtINR(paise) {
  if (paise === null || paise === undefined) return '—';
  return `₹${Math.round(Number(paise) / 100).toLocaleString('en-IN')}`;
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Mirrors the ↑/↓/→ arrows reports.ts's trendArrow() draws into the PDF —
// same three states (up/down/flat), same meaning: "up" is a bigger number
// than last week, not necessarily a "good" one (e.g. spend going up isn't
// inherently positive), so the arrow itself carries no color judgement.
function TrendArrow({ trend }) {
  if (trend === 'up') return <ArrowUp className="w-3 h-3 inline text-neutral-500" aria-label="up from last week" />;
  if (trend === 'down') return <ArrowDown className="w-3 h-3 inline text-neutral-500" aria-label="down from last week" />;
  if (trend === 'flat') return <Minus className="w-3 h-3 inline text-neutral-400" aria-label="flat vs last week" />;
  return null;
}

function MetricCard({ label, value, trend, tone = 'neutral' }) {
  const toneClasses = {
    neutral: 'bg-white border-neutral-200 text-neutral-900',
    primary: 'bg-primary-50 border-primary-200 text-primary-700',
    success: 'bg-success-500/10 border-success-500/20 text-success-700',
  };
  return (
    <div className={`rounded-lg border p-4 ${toneClasses[tone] || toneClasses.neutral}`}>
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold mt-1 flex items-center gap-1">
        {value} {trend && <TrendArrow trend={trend} />}
      </p>
    </div>
  );
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50 flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 text-primary-600" />}
        <p className="text-sm font-semibold text-neutral-800">{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Weekly preview ───────────────────────────────────────────────────────────
function WeeklyPreview({ data }) {
  const { client, weekStart, weekEnd, adMetrics, completedTasks, benchmark, agencyAvg, aiRecommendations, trends } = data;
  const hasAdError = adMetrics && typeof adMetrics === 'object' && 'error' in adMetrics;
  const hasAdMetrics = adMetrics && typeof adMetrics === 'object' && !hasAdError;

  const isEmpty = !hasAdMetrics && !hasAdError
    && (completedTasks || []).length === 0
    && !benchmark && !agencyAvg
    && (aiRecommendations || []).length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={FileText}
        title="No data for this period"
        description={`${client?.name || 'This client'} has no Meta Ads spend, completed tasks, or benchmark data recorded for the week of ${fmtDate(weekStart)} – ${fmtDate(weekEnd)}.`}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">{client?.name}</h2>
        <p className="text-sm text-neutral-500">Week of {fmtDate(weekStart)} – {fmtDate(weekEnd)}</p>
      </div>

      <SectionCard icon={BarChart2} title="Meta Ads Performance">
        {hasAdError && (
          <p className="text-sm text-danger-600">Meta Ads error: {adMetrics.error}</p>
        )}
        {!hasAdError && !hasAdMetrics && (
          <p className="text-sm text-neutral-400">No Meta Ads account linked for this client.</p>
        )}
        {hasAdMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Spend" value={`₹${fmtNum(adMetrics.spend)}`} trend={trends?.spendTrend} />
            <MetricCard label="Impressions" value={fmtNum(adMetrics.impressions)} />
            <MetricCard label="Clicks" value={fmtNum(adMetrics.clicks)} />
            <MetricCard label="CTR" value={`${fmtNum(adMetrics.ctr)}%`} />
            <MetricCard label="CPC" value={`₹${fmtNum(adMetrics.cpc)}`} />
            <MetricCard label="Purchases" value={fmtNum(adMetrics.purchases)} trend={trends?.purchasesTrend} />
            <MetricCard label="ROAS" value={`${fmtNum(adMetrics.roas)}x`} trend={trends?.roasTrend} tone="primary" />
          </div>
        )}
      </SectionCard>

      {hasAdMetrics && (benchmark || agencyAvg) && (
        <SectionCard icon={BarChart2} title="How You Compare">
          <div className="grid grid-cols-2 gap-3">
            {benchmark && (
              <MetricCard label="Your Avg ROAS (month)" value={`${fmtNum(benchmark.avg_roas)}x`} tone="primary" />
            )}
            {agencyAvg && (
              <MetricCard label="Agency Avg ROAS" value={`${fmtNum(agencyAvg.avg_roas)}x`} tone="success" />
            )}
            {benchmark && (
              <MetricCard label="Your Avg CTR (month)" value={`${fmtNum(benchmark.avg_ctr)}%`} tone="primary" />
            )}
            {agencyAvg && (
              <MetricCard label="Agency Avg CTR" value={`${fmtNum(agencyAvg.avg_ctr)}%`} tone="success" />
            )}
          </div>
          {benchmark?.top_creative_type && (
            <p className="text-xs text-neutral-500 mt-3">Best performing creative type: {benchmark.top_creative_type}</p>
          )}
        </SectionCard>
      )}

      {(aiRecommendations || []).length > 0 && (
        <SectionCard icon={FileText} title="Recommendations">
          <ol className="space-y-2">
            {aiRecommendations.slice(0, 3).map((rec, i) => (
              <li key={i} className="text-sm text-warning-700 bg-warning-500/10 border border-warning-500/20 rounded-lg px-3 py-2">
                {i + 1}. {rec}
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      <SectionCard icon={CheckCircle2} title="Completed Tasks This Week">
        {(completedTasks || []).length === 0 ? (
          <p className="text-sm text-neutral-400">No completed tasks found for this week.</p>
        ) : (
          <ul className="space-y-2">
            {completedTasks.slice(0, 15).map(task => (
              <li key={String(task.id)} className="flex items-center justify-between text-sm bg-success-500/10 border border-success-500/20 rounded-lg px-3 py-2">
                <span className="text-success-700">✓ {String(task.name || '')}</span>
                <span className="text-xs text-success-600">{task.completedAt ? fmtDate(new Date(Number(task.completedAt)).toISOString()) : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// ── Monthly preview ──────────────────────────────────────────────────────────
function MonthlyPreview({ data }) {
  const { client, month, adMetrics, seo, billing } = data;
  const hasAdError = adMetrics && typeof adMetrics === 'object' && 'error' in adMetrics;
  const hasAdMetrics = adMetrics && typeof adMetrics === 'object' && !hasAdError;

  const isEmpty = !hasAdMetrics && !hasAdError && !seo && !billing;

  if (isEmpty) {
    return (
      <EmptyState
        icon={FileText}
        title="No data for this period"
        description={`${client?.name || 'This client'} has no Meta Ads, SEO, or billing activity recorded for ${fmtMonthLabel(month)}.`}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">{client?.name}</h2>
        <p className="text-sm text-neutral-500">{fmtMonthLabel(month)}</p>
      </div>

      <SectionCard icon={BarChart2} title="Meta Ads Performance">
        {hasAdError && <p className="text-sm text-danger-600">Meta Ads error: {adMetrics.error}</p>}
        {!hasAdError && !hasAdMetrics && <p className="text-sm text-neutral-400">No Meta Ads account linked.</p>}
        {hasAdMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard label="Spend" value={`₹${fmtNum(adMetrics.spend)}`} />
            <MetricCard label="Impressions" value={fmtNum(adMetrics.impressions)} />
            <MetricCard label="Clicks" value={fmtNum(adMetrics.clicks)} />
            <MetricCard label="ROAS" value={`${fmtNum(adMetrics.roas)}x`} tone="primary" />
            <MetricCard label="Purchases" value={fmtNum(adMetrics.purchases)} />
            <MetricCard label="Revenue" value={`₹${fmtNum(adMetrics.purchaseValue)}`} />
          </div>
        )}
      </SectionCard>

      <SectionCard icon={Search} title="SEO Performance">
        {!seo && <p className="text-sm text-neutral-400">No SEO data available for this period.</p>}
        {seo && (
          <div className="space-y-4">
            {(seo.mobileScore != null || seo.desktopScore != null || seo.alertCount != null) && (
              <div className="grid grid-cols-3 gap-3">
                <MetricCard label="Mobile Score" value={seo.mobileScore != null ? String(seo.mobileScore) : '—'} tone="success" />
                <MetricCard label="Desktop Score" value={seo.desktopScore != null ? String(seo.desktopScore) : '—'} tone="success" />
                <MetricCard label="Alerts This Month" value={String(seo.alertCount ?? 0)} tone="primary" />
              </div>
            )}
            {(seo.keywordGains || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-success-700 mb-1">↑ Top Keyword Gains ({seo.keywordGains.length})</p>
                <ul className="text-sm text-neutral-700 space-y-0.5">
                  {seo.keywordGains.slice(0, 5).map((kw, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{kw.keyword}</span>
                      <span className="text-success-600">+{kw.change} → pos {kw.position}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(seo.keywordLosses || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-danger-600 mb-1">↓ Keyword Losses ({seo.keywordLosses.length})</p>
                <ul className="text-sm text-neutral-700 space-y-0.5">
                  {seo.keywordLosses.slice(0, 3).map((kw, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{kw.keyword}</span>
                      <span className="text-danger-600">{kw.change} → pos {kw.position}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard icon={Receipt} title="Billing Summary">
        {(!billing || billing.invoiceCount === 0) && <p className="text-sm text-neutral-400">No invoices for this month.</p>}
        {billing && billing.invoiceCount > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Invoiced" value={fmtINR(billing.invoicedPaise)} />
            <MetricCard label="Received" value={fmtINR(billing.paidPaise)} tone="success" />
            <MetricCard label="Outstanding" value={fmtINR(billing.duePaise)} tone={billing.duePaise > 0 ? 'neutral' : 'success'} />
            <MetricCard label="Retainer" value={fmtINR(billing.retainerPaise)} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState(null);

  const [selectedClientId, setSelectedClientId] = useState('');
  const [reportType, setReportType] = useState('weekly'); // 'weekly' | 'monthly'
  const [weekOf, setWeekOf] = useState(todayIso());
  const [month, setMonth] = useState(currentMonthValue());

  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);

  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [sendError, setSendError] = useState(null);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      const data = await apiFetch('/api/reports/clients');
      const rows = data?.clients || [];
      setClients(rows);
      if (rows.length > 0 && !selectedClientId) setSelectedClientId(rows[0].id);
    } catch (e) {
      setClientsError(e?.message || 'Failed to load clients');
    } finally {
      setClientsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  const selectedClient = useMemo(
    () => clients.find(c => c.id === selectedClientId) || null,
    [clients, selectedClientId],
  );

  function periodQuery() {
    return reportType === 'weekly'
      ? `weekOf=${encodeURIComponent(weekOf)}`
      : `month=${encodeURIComponent(month)}`;
  }

  async function handleGenerate() {
    if (!selectedClientId) return;
    setReportLoading(true);
    setReportError(null);
    setSendResult(null);
    setSendError(null);
    try {
      const path = reportType === 'weekly'
        ? `/api/reports/generate?clientId=${encodeURIComponent(selectedClientId)}&${periodQuery()}`
        : `/api/reports/generate-monthly?clientId=${encodeURIComponent(selectedClientId)}&${periodQuery()}`;
      const data = await apiFetch(path);
      setReportData(data);
    } catch (e) {
      setReportError(e?.message || 'Failed to generate report');
      setReportData(null);
      showError(e?.message || 'Failed to generate report');
    } finally {
      setReportLoading(false);
    }
  }

  // Mirrors BillingPage.jsx's handleDownloadPDF exactly (admin/src/pages/
  // BillingPage.jsx) — this SPA's PDF endpoints require the bearer token, so
  // a plain <a href> download won't carry auth; fetch the blob manually and
  // click a synthetic link to it instead.
  function handleDownloadPdf() {
    if (!selectedClientId) return;
    setDownloading(true);
    const token = getAuthToken();
    const path = reportType === 'weekly'
      ? `/api/reports/pdf?clientId=${encodeURIComponent(selectedClientId)}&${periodQuery()}`
      : `/api/reports/monthly-pdf?clientId=${encodeURIComponent(selectedClientId)}&${periodQuery()}`;
    const clientName = (reportData?.client?.name || selectedClient?.name || 'report').replace(/\//g, '-');
    const filename = reportType === 'weekly'
      ? `GE_Report_${clientName}_${weekOf}.pdf`
      : `GE_Monthly_${clientName}_${month}.pdf`;

    fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error(`PDF download failed (${r.status})`);
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(e => showError('PDF error: ' + (e.message || 'download failed')))
      .finally(() => setDownloading(false));
  }

  // POST /api/reports/send-pdf only exists for the weekly report (no monthly
  // equivalent in src/routes/reports.ts) — the Send button is hidden in
  // monthly mode below rather than shown-then-failing.
  //
  // canSendWhatsApp() on the backend gates this to Growth Escalators' own
  // tenant only (one shared WhatsApp Business number — see reports.ts's
  // header comment). There is no reliable client-side signal for "is this
  // GE's own tenant": admin/src/lib/auth.js's getTenantSlug() reflects the
  // browser's product-variant heuristic (query param / hostname /
  // localStorage), not the authoritative DB tenantSlug the backend compares
  // against, so it can't be trusted to hide this button for the right set of
  // tenants. The button stays visible for everyone and a rejected send shows
  // the backend's own message plainly instead.
  async function handleSendWhatsapp() {
    if (!selectedClientId || reportType !== 'weekly') return;
    setSending(true);
    setSendResult(null);
    setSendError(null);
    try {
      const data = await apiFetch(
        `/api/reports/send-pdf?clientId=${encodeURIComponent(selectedClientId)}&weekOf=${encodeURIComponent(weekOf)}`,
        { method: 'POST' },
      );
      if (data?.whatsappSent) {
        setSendResult(`Report sent to ${data.clientName} via WhatsApp.`);
        showSuccess('Report sent via WhatsApp');
      } else {
        setSendResult(`PDF generated for ${data?.clientName || 'this client'}, but no WhatsApp number is on file — nothing was sent.`);
      }
    } catch (e) {
      // For the GE-tenant-only 403, e.message is already the backend's own
      // clear sentence ("WhatsApp sending isn't configured for your
      // workspace") — surfaced verbatim rather than a generic failure.
      setSendError(e?.message || 'Failed to send report');
      showError(e?.message || 'Failed to send report');
    } finally {
      setSending(false);
    }
  }

  const canAct = !!selectedClientId;

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary-600" /> Reports
          </h1>
          <p className="text-neutral-500 mt-1 text-sm">Weekly and monthly performance reports for billing clients</p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5 mb-6">
          {clientsError && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-danger-500/10 border border-danger-500/20 rounded-lg px-3 py-2 text-sm text-danger-600">
              <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {clientsError}</span>
              <button onClick={loadClients} className="text-xs font-medium underline">Retry</button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px]">
              <label className="block text-xs font-medium text-neutral-700 mb-1">Client</label>
              <select
                aria-label="Client"
                value={selectedClientId}
                onChange={e => setSelectedClientId(e.target.value)}
                disabled={clientsLoading || clients.length === 0}
                className="w-full text-sm border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-neutral-50 disabled:text-neutral-400"
              >
                {clientsLoading && <option>Loading clients…</option>}
                {!clientsLoading && clients.length === 0 && <option>No clients available</option>}
                {!clientsLoading && clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Period</label>
              <div className="flex rounded-lg border border-neutral-300 overflow-hidden">
                {[['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setReportType(id); setReportData(null); setReportError(null); setSendResult(null); setSendError(null); }}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      reportType === id ? 'bg-primary-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {reportType === 'weekly' ? (
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Week of</label>
                <input
                  type="date"
                  aria-label="Week of"
                  value={weekOf}
                  max={todayIso()}
                  onChange={e => setWeekOf(e.target.value)}
                  className="text-sm border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">Month</label>
                <input
                  type="month"
                  aria-label="Month"
                  value={month}
                  max={currentMonthValue()}
                  onChange={e => setMonth(e.target.value)}
                  className="text-sm border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={!canAct || reportLoading}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${reportLoading ? 'animate-spin' : ''}`} />
              {reportLoading ? 'Generating…' : 'Generate'}
            </button>

            {reportData && (
              <>
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloading}
                  className="flex items-center gap-1.5 px-4 py-2 border border-neutral-300 text-neutral-700 rounded-lg text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" /> {downloading ? 'Downloading…' : 'Download PDF'}
                </button>

                {reportType === 'weekly' && (
                  <button
                    onClick={handleSendWhatsapp}
                    disabled={sending}
                    className="flex items-center gap-1.5 px-4 py-2 border border-success-500/30 text-success-700 bg-success-500/10 rounded-lg text-sm font-medium hover:bg-success-500/20 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send via WhatsApp'}
                  </button>
                )}
              </>
            )}
          </div>

          {sendResult && (
            <div className="mt-4 flex items-center gap-2 bg-success-500/10 border border-success-500/20 rounded-lg px-3 py-2 text-sm text-success-700">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {sendResult}
            </div>
          )}
          {sendError && (
            <div className="mt-4 flex items-center gap-2 bg-danger-500/10 border border-danger-500/20 rounded-lg px-3 py-2 text-sm text-danger-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {sendError}
            </div>
          )}
        </div>

        {/* Body */}
        {clientsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SkeletonCard /><SkeletonCard />
          </div>
        )}

        {!clientsLoading && clients.length === 0 && !clientsError && (
          <EmptyState
            icon={FileText}
            title="No billing clients yet"
            description="Reports are generated for billing clients. Add one to start generating weekly or monthly performance reports."
            ctaLabel="Add a billing client"
            ctaAction={() => navigate('/clients')}
          />
        )}

        {!clientsLoading && clients.length > 0 && (
          <>
            {reportLoading && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
              </div>
            )}

            {!reportLoading && reportError && (
              <div className="flex items-center gap-2 bg-danger-500/10 border border-danger-500/20 rounded-lg px-4 py-3 text-sm text-danger-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {reportError}
              </div>
            )}

            {!reportLoading && !reportError && !reportData && (
              <EmptyState
                icon={Calendar}
                title="No report generated yet"
                description="Pick a client and period above, then click Generate to preview the report before downloading or sending it."
              />
            )}

            {!reportLoading && !reportError && reportData && (
              reportType === 'weekly'
                ? <WeeklyPreview data={reportData} />
                : <MonthlyPreview data={reportData} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
