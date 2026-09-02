import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api.js';

const VIEWS = [
  { id: 'firstSources', label: 'First source' },
  { id: 'lastSources', label: 'Last source' },
  { id: 'firstLandingPages', label: 'First landing page' },
  { id: 'conversionPages', label: 'Conversion page' },
];

function formatRupees(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPaise(value) {
  return formatRupees(Number(value || 0) / 100);
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'unknown') return raw;
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, 'https://growthescalators.com');
    const path = url.pathname || '/';
    return path === '/' ? '/' : path.replace(/\/+$/, '') || '/';
  } catch {
    const path = raw.split(/[?#]/)[0] || '/';
    return path === '/' ? '/' : path.replace(/\/+$/, '') || '/';
  }
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="mt-1 block text-xl font-bold text-slate-900">{value}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}

export default function WebsiteAttributionAnalytics({
  periodId,
  days = 30,
  customSince = '',
  customUntil = '',
  customApplied = false,
}) {
  const [view, setView] = useState('firstSources');
  const [data, setData] = useState(null);
  const [seoData, setSeoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    if (periodId === 'custom') {
      if (!customApplied || !customSince || !customUntil) return null;
      return `since=${encodeURIComponent(customSince)}&until=${encodeURIComponent(customUntil)}`;
    }
    return `days=${Math.max(1, Number(days) || 30)}`;
  }, [periodId, days, customSince, customUntil, customApplied]);

  useEffect(() => {
    if (!query) {
      setLoading(false);
      setData(null);
      setSeoData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      apiFetch(`/api/analytics/website-attribution?${query}`),
      // Search Console is supplemental context. If it has not been configured
      // or the latest pull failed, commercial attribution must still render.
      apiFetch('/api/marketing/website-seo-pages').catch(() => null),
    ])
      .then(([payload, seoPayload]) => {
        if (cancelled) return;
        setData(payload);
        setSeoData(seoPayload);
      })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load website attribution'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  const seoByPath = useMemo(() => {
    const map = new Map();
    for (const page of seoData?.pages || []) {
      const path = normalizePath(page.pageUrl);
      if (path) map.set(path, page);
    }
    return map;
  }, [seoData]);

  const rows = useMemo(() => {
    const baseRows = data?.[view] || [];
    if (view !== 'firstLandingPages') return baseRows;
    return baseRows.map((row) => ({
      ...row,
      gsc: seoByPath.get(normalizePath(row.label)) || null,
    }));
  }, [data, view, seoByPath]);
  const totals = data?.totals || {};
  const showGsc = view === 'firstLandingPages';

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Website Attribution → Revenue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Website-lead cohort: acquisition, manual quality review, won deal value and payments received.
          </p>
        </div>
        <span className="text-[11px] text-slate-400">
          Cash received is counted only when the billing client is linked to the CRM contact.
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          Apply a date range to load website attribution.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Website leads" value={Number(totals.leads || 0).toLocaleString('en-IN')} hint={`${Number(totals.submissions || 0).toLocaleString('en-IN')} form submissions`} />
            <Stat label="Good + Hot" value={Number(totals.qualified || 0).toLocaleString('en-IN')} hint={`${Number(totals.qualificationRate || 0)}% of reviewed · ${Number(totals.reviewRate || 0)}% reviewed`} />
            <Stat label="Won deal value" value={formatRupees(totals.wonDealValue)} hint={`${Number(totals.wonDeals || 0).toLocaleString('en-IN')} won deal${Number(totals.wonDeals || 0) === 1 ? '' : 's'}`} />
            <Stat label="Cash received" value={formatPaise(totals.receivedRevenuePaise)} hint="Payments linked back to website-acquired contacts" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 p-2 flex-wrap">
              <div className="flex items-center gap-1 overflow-x-auto">
                {VIEWS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      view === item.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {showGsc && seoData?.snapshotDate && (
                <span className="px-2 text-[11px] text-slate-400">
                  GSC columns: latest {Number(seoData.windowDays || 28)}d snapshot ending {seoData.snapshotDate}
                </span>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">No website-lead data in this period yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500">{VIEWS.find((item) => item.id === view)?.label}</th>
                      {showGsc && <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">GSC impressions</th>}
                      {showGsc && <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">GSC clicks</th>}
                      {showGsc && <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">GSC CTR</th>}
                      {showGsc && <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Avg position</th>}
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Leads</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Reviewed</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Good + Hot</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Won</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Won value</th>
                      <th className="px-4 py-2 text-xs font-semibold text-slate-500 text-right">Cash received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 15).map((row) => (
                      <tr key={row.label} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="max-w-[360px] px-4 py-2 text-sm font-medium text-slate-800 break-all">{row.label}</td>
                        {showGsc && <td className="px-4 py-2 text-sm text-slate-600 text-right">{row.gsc ? Number(row.gsc.impressions || 0).toLocaleString('en-IN') : '—'}</td>}
                        {showGsc && <td className="px-4 py-2 text-sm text-slate-600 text-right">{row.gsc ? Number(row.gsc.clicks || 0).toLocaleString('en-IN') : '—'}</td>}
                        {showGsc && <td className="px-4 py-2 text-sm text-slate-600 text-right">{row.gsc?.avgCtr == null ? '—' : `${(Number(row.gsc.avgCtr) * 100).toFixed(1)}%`}</td>}
                        {showGsc && <td className="px-4 py-2 text-sm text-slate-600 text-right">{row.gsc?.avgPosition == null ? '—' : Number(row.gsc.avgPosition).toFixed(1)}</td>}
                        <td className="px-4 py-2 text-sm text-slate-700 text-right">{Number(row.leads || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2 text-sm text-slate-700 text-right">{Number(row.reviewed || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-sky-700 text-right">{Number(row.qualified || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-emerald-700 text-right">{Number(row.wonDeals || 0).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-emerald-700 text-right">{formatRupees(row.wonDealValue)}</td>
                        <td className="px-4 py-2 text-sm font-semibold text-emerald-700 text-right">{formatPaise(row.receivedRevenuePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
