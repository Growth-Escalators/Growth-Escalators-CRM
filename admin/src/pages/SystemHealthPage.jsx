import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

// ── Helpers ──────────────────────────────────────────────
function relTime(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLORS = {
  healthy: { dot: 'bg-emerald-500', border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600' },
  warning: { dot: 'bg-amber-400',   border: 'border-l-amber-400',   badge: 'bg-amber-100 text-amber-700',   text: 'text-amber-600' },
  error:   { dot: 'bg-red-500',     border: 'border-l-red-500',     badge: 'bg-red-100 text-red-600',       text: 'text-red-600' },
};

function StatusBadge({ status, label }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.healthy;
  const text = label ?? (status === 'healthy' ? 'Healthy' : status === 'warning' ? 'Warning' : 'Error');
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${c.badge}`}>{text}</span>;
}

function MetricPill({ label, value, color }) {
  const colors = { green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-600', blue: 'bg-blue-50 text-blue-700', gray: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${colors[color ?? 'gray']}`}>
      {label}: <span className="font-bold">{value ?? '—'}</span>
    </span>
  );
}

const SERVICE_BADGE_COLORS = {
  n8n: 'bg-blue-100 text-blue-700', brevo: 'bg-emerald-100 text-emerald-700',
  meta: 'bg-purple-100 text-purple-700', calcom: 'bg-amber-100 text-amber-700',
  cashfree: 'bg-red-100 text-red-600', backend: 'bg-slate-100 text-slate-600',
  gcp: 'bg-sky-100 text-sky-700',
};

function ServiceTag({ service }) {
  const label = { n8n: 'n8n', brevo: 'Brevo', meta: 'Meta WA', calcom: 'Cal.com', cashfree: 'Cashfree', backend: 'Backend', gcp: 'GCP' }[service] ?? service;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SERVICE_BADGE_COLORS[service] ?? 'bg-slate-100 text-slate-500'}`}>{label}</span>;
}

// ── Service Card ─────────────────────────────────────────
function ServiceCard({ name, url, status, metrics, footer, lastActivity }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.healthy;
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 border-l-4 ${c.border} p-5 shadow-sm`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{name}</p>
          {url && <p className="text-xs text-slate-400 mt-0.5 font-mono truncate max-w-[200px]">{url}</p>}
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {metrics.map((m, i) => <MetricPill key={i} {...m} />)}
      </div>
      {footer && <p className="text-xs text-slate-400 font-mono bg-slate-50 rounded-lg px-2.5 py-1.5 mb-2">{footer}</p>}
      {lastActivity && <p className="text-xs text-slate-400">Last activity: {relTime(lastActivity)}</p>}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 px-8 py-6 space-y-6 max-w-6xl">
        <div className="h-8 bg-slate-200 rounded-xl w-64 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(n => <div key={n} className="h-24 bg-slate-200 rounded-2xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1,2,3,4,5,6,7,8].map(n => <div key={n} className="h-40 bg-slate-200 rounded-2xl animate-pulse" />)}
        </div>
      </main>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────
const ACTIVITY_FILTERS = ['All', 'Backend', 'n8n', 'Brevo', 'Meta', 'Cal.com', 'Cashfree'];
const FILTER_MAP = { 'Backend': 'backend', 'n8n': 'n8n', 'Brevo': 'brevo', 'Meta': 'meta', 'Cal.com': 'calcom', 'Cashfree': 'cashfree' };

export default function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [capiData, setCapiData] = useState(null);
  const [clickupData, setClickupData] = useState(null);
  const [blockerData, setBlockerData] = useState(null);
  const [blockerChecking, setBlockerChecking] = useState(false);
  const [dismissedBlockers, setDismissedBlockers] = useState(new Set());
  const [alertHistoryOpen, setAlertHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [activityFilter, setActivityFilter] = useState('All');
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());
  const secondsRef = useRef(null);
  const refreshRef = useRef(null);

  const fetchData = useCallback(async () => {
    const [result, capiResult, clickupResult, blockerResult] = await Promise.all([
      apiFetch('/api/system/health'),
      apiFetch('/api/capi/status').catch(() => null),
      apiFetch('/api/clickup/workspace').catch(() => null),
      apiFetch('/api/blockers').catch(() => null),
    ]);
    if (result?.checkedAt) {
      setData(result);
      setSecondsAgo(0);
    }
    setCapiData(capiResult);
    setClickupData(clickupResult);
    setBlockerData(blockerResult);
    setLoading(false);
  }, []);

  async function triggerBlockerCheck() {
    setBlockerChecking(true);
    await apiFetch('/api/blockers/check', { method: 'POST' }).catch(() => null);
    const fresh = await apiFetch('/api/blockers').catch(() => null);
    if (fresh) setBlockerData(fresh);
    setBlockerChecking(false);
  }

  async function dismissBlocker(taskId) {
    await apiFetch(`/api/blockers/dismiss/${taskId}`, { method: 'POST' }).catch(() => null);
    setDismissedBlockers(s => new Set([...s, taskId]));
  }

  useEffect(() => {
    fetchData();
    refreshRef.current = setInterval(fetchData, 30000);
    secondsRef.current = setInterval(() => setSecondsAgo(s => s + 1), 1000);
    return () => { clearInterval(refreshRef.current); clearInterval(secondsRef.current); };
  }, [fetchData]);

  if (loading) return <Skeleton />;
  if (!data) return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <p className="text-slate-400">Failed to load health data. <button onClick={fetchData} className="text-orange-500 underline">Retry</button></p>
      </main>
    </div>
  );

  const { overallStatus, services, alerts, recentActivity } = data;
  const { backend, database, metaWhatsapp, brevo, n8n, cashfree, calcom, roundRobin } = services;

  const visibleAlerts = alerts.filter((_, i) => !dismissedAlerts.has(i));
  const errorCount = alerts.filter(a => a.level === 'error').length;
  const warnCount = alerts.filter(a => a.level === 'warning').length;

  const overallBadge = overallStatus === 'healthy'
    ? { text: 'All systems healthy', cls: 'bg-emerald-500' }
    : overallStatus === 'warning'
    ? { text: `${warnCount} warning${warnCount !== 1 ? 's' : ''}`, cls: 'bg-amber-400' }
    : { text: `${errorCount} error${errorCount !== 1 ? 's' : ''}`, cls: 'bg-red-500' };

  const filteredActivity = activityFilter === 'All'
    ? recentActivity
    : recentActivity.filter(i => i.service === FILTER_MAP[activityFilter]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

          {/* SECTION 1 — Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-slate-900">System Health</h1>
              <p className="text-sm text-slate-400 mt-0.5">Live status across all infrastructure</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`text-sm font-semibold text-white px-4 py-2 rounded-full ${overallBadge.cls}`}>
                {overallBadge.text}
              </span>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Last checked {secondsAgo}s ago · Auto-refreshes every 30s</span>
                <button onClick={fetchData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg transition-colors" title="Refresh">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 2 — Alerts */}
          {visibleAlerts.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <p className="text-sm font-bold text-amber-900 mb-3">{visibleAlerts.length} item{visibleAlerts.length !== 1 ? 's' : ''} need attention</p>
              <div className="space-y-2">
                {visibleAlerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-3 bg-white rounded-xl px-4 py-3 border border-amber-100">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${alert.level === 'error' ? 'bg-red-500' : alert.level === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{alert.message}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{alert.action}</p>
                    </div>
                    <button onClick={() => setDismissedAlerts(s => new Set([...s, alerts.indexOf(alert)]))} className="text-slate-300 hover:text-slate-500 text-xs p-1 shrink-0">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 3 — Service grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ServiceCard
              name="Railway Backend"
              url="api.growthescalators.com"
              status={backend.status}
              metrics={[
                { label: 'Uptime', value: backend.uptimeFormatted, color: 'green' },
                { label: 'Database', value: backend.database ? 'Connected' : 'Error', color: backend.database ? 'green' : 'red' },
                { label: 'Seq worker', value: backend.workers?.sequenceWorker ?? '—', color: 'green' },
                { label: 'Job worker', value: backend.workers?.stuckJobWorker ?? '—', color: 'green' },
              ]}
              footer={backend.lastDeployedAt ? `Deployed: ${new Date(backend.lastDeployedAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : null}
            />
            <ServiceCard
              name="PostgreSQL Database"
              url="Railway managed"
              status={database.status}
              metrics={[
                { label: 'Contacts', value: database.contactsCount, color: 'blue' },
                { label: 'Jobs pending', value: database.jobsPending, color: database.jobsPending > 10 ? 'amber' : 'gray' },
                { label: 'Failed', value: database.jobsFailed, color: database.jobsFailed > 0 ? 'red' : 'gray' },
                { label: 'Enrolments', value: database.activeEnrolments, color: database.activeEnrolments > 0 ? 'green' : 'amber' },
                ...(database.jobsDeadLetter > 0 ? [{ label: 'Dead letter', value: database.jobsDeadLetter, color: 'red' }] : []),
              ]}
              lastActivity={database.lastActivityAt}
            />
            <ServiceCard
              name="Meta WhatsApp API"
              status={metaWhatsapp.status}
              metrics={[
                { label: 'Phone ID', value: metaWhatsapp.phoneNumberId ? metaWhatsapp.phoneNumberId.slice(-6) : 'Not set', color: metaWhatsapp.phoneNumberId ? 'green' : 'red' },
                { label: 'Token', value: metaWhatsapp.tokenSet ? 'Set' : 'Missing', color: metaWhatsapp.tokenSet ? 'green' : 'red' },
                { label: 'Webhook', value: metaWhatsapp.webhookConfigured ? 'Configured' : 'Missing', color: metaWhatsapp.webhookConfigured ? 'green' : 'amber' },
                { label: metaWhatsapp.phoneNumberId === '197226183475191' ? 'Test number' : 'Number', value: metaWhatsapp.phoneNumberId === '197226183475191' ? 'Test' : 'Production', color: metaWhatsapp.phoneNumberId === '197226183475191' ? 'amber' : 'green' },
              ]}
            />
            <ServiceCard
              name="Brevo Email"
              status={brevo.status}
              metrics={[
                { label: 'API Key', value: brevo.apiKeySet ? 'Set' : 'Missing', color: brevo.apiKeySet ? 'green' : 'red' },
                { label: 'SMTP', value: brevo.smtpConfigured ? 'Configured' : 'Missing', color: brevo.smtpConfigured ? 'green' : 'amber' },
                { label: 'List ID', value: brevo.listD2cId ?? 'Not set', color: brevo.listD2cId ? 'green' : 'gray' },
                { label: 'Emails sent', value: brevo.emailsSentTotal, color: 'blue' },
              ]}
            />
            <ServiceCard
              name="n8n Automations"
              url="primary-production-6c6f5.up.railway.app"
              status={n8n.status}
              metrics={[
                { label: 'Reachable', value: n8n.reachable ? 'Yes' : 'No', color: n8n.reachable ? 'green' : 'red' },
                { label: 'Workflows', value: n8n.workflowsActive, color: 'blue' },
                { label: 'Jobs today', value: n8n.jobsProcessedToday, color: 'green' },
              ]}
              lastActivity={n8n.lastJobAt}
            />
            <ServiceCard
              name="Cashfree Payments"
              status={cashfree.status}
              metrics={[
                { label: 'App ID', value: cashfree.appIdSet ? 'Set' : 'Missing', color: cashfree.appIdSet ? 'green' : 'red' },
                { label: 'Secret', value: cashfree.secretSet ? 'Set' : 'Missing', color: cashfree.secretSet ? 'green' : 'red' },
                { label: 'Webhook', value: 'Registered', color: 'green' },
                { label: 'Purchases today', value: cashfree.purchasesToday, color: 'blue' },
              ]}
            />
            <ServiceCard
              name="Cal.com Bookings"
              status={calcom.status}
              metrics={[
                { label: 'API Key', value: calcom.apiKeySet ? 'Set' : 'Missing', color: calcom.apiKeySet ? 'green' : 'amber' },
                { label: 'Bookings today', value: calcom.bookingsToday, color: 'blue' },
                { label: 'Hot leads today', value: calcom.hotLeadsToday, color: calcom.hotLeadsToday > 0 ? 'green' : 'gray' },
              ]}
              footer={`Webhook: /webhooks/calcom`}
            />
            <ServiceCard
              name="Booking Rotation"
              status={roundRobin.status}
              metrics={[
                { label: 'Active funnels', value: roundRobin.funnelsActive, color: roundRobin.funnelsActive > 0 ? 'green' : 'amber' },
                { label: 'Assigned today', value: roundRobin.totalAssignmentsToday, color: 'blue' },
              ]}
              footer={roundRobin.members?.length > 0 ? roundRobin.members.map(m => `${m.name}: ${m.assigned}`).join(' · ') : null}
            />
            <ServiceCard
              name="Meta CAPI"
              status={capiData?.pixelId && capiData?.tokenConfigured ? 'healthy' : 'warning'}
              metrics={[
                { label: 'Pixel ID', value: capiData?.pixelId ? capiData.pixelId.toString().slice(-6) : 'Not set', color: capiData?.pixelId ? 'green' : 'red' },
                { label: 'Token', value: capiData?.tokenConfigured ? 'Set' : 'Missing', color: capiData?.tokenConfigured ? 'green' : 'red' },
                { label: 'Recent events', value: capiData?.recentEvents?.length ?? 0, color: 'blue' },
              ]}
              footer="Server-side pixel events via Conversions API"
            />
            <ServiceCard
              name="ClickUp CRM Tasks"
              status={
                clickupData?.configured?.listId && clickupData.configured.listId !== 'not set' && clickupData.configured.listId !== 'placeholder_will_update'
                  ? 'healthy'
                  : 'warning'
              }
              metrics={[
                { label: 'List ID', value: clickupData?.configured?.listId && clickupData.configured.listId !== 'not set' ? 'Set' : 'Not set', color: clickupData?.configured?.listId && clickupData.configured.listId !== 'not set' ? 'green' : 'amber' },
                { label: 'Jatin ID', value: clickupData?.configured?.jatinId && clickupData.configured.jatinId !== 'not set' ? 'Set' : 'Missing', color: clickupData?.configured?.jatinId && clickupData.configured.jatinId !== 'not set' ? 'green' : 'amber' },
                { label: 'Saksham ID', value: clickupData?.configured?.sakshamId && clickupData.configured.sakshamId !== 'not set' ? 'Set' : 'Missing', color: clickupData?.configured?.sakshamId && clickupData.configured.sakshamId !== 'not set' ? 'green' : 'amber' },
                { label: 'Members', value: clickupData?.members?.length ?? 0, color: 'blue' },
              ]}
              footer={clickupData?.teamName ? `Team: ${clickupData.teamName}` : 'Run /api/clickup/setup to configure'}
            />
          </div>

          {/* SECTION 3b — Blockers panel */}
          {(() => {
            const visibleBlockers = (blockerData?.blockers || []).filter(b => !dismissedBlockers.has(b.taskId));
            const count = visibleBlockers.length;
            const critical = visibleBlockers.filter(b => b.daysOverdue >= 5).length;
            return (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-slate-900">Active blockers</h2>
                    {count > 0 ? (
                      <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-red-100 text-red-600">
                        {count} blocker{count !== 1 ? 's' : ''}
                        {critical > 0 && ` · ${critical} critical`}
                      </span>
                    ) : (
                      <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700">All clear</span>
                    )}
                  </div>
                  <button
                    onClick={triggerBlockerCheck}
                    disabled={blockerChecking}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-50 transition-colors"
                  >
                    {blockerChecking ? 'Checking…' : 'Check now'}
                  </button>
                </div>

                {count === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-300">
                    <svg className="w-10 h-10 mb-2 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <p className="text-sm text-slate-400">No overdue tasks — everything is on track</p>
                    {blockerData && <p className="text-xs text-slate-300 mt-1">Last checked just now</p>}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-400 font-semibold uppercase tracking-wide border-b border-slate-100">
                          <th className="text-left py-2 pr-4">Task</th>
                          <th className="text-left py-2 pr-4">Assigned to</th>
                          <th className="text-left py-2 pr-4">Overdue</th>
                          <th className="text-left py-2 pr-4">Priority</th>
                          <th className="text-right py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleBlockers.map((b) => (
                          <tr key={b.taskId} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className="py-3 pr-4 max-w-[240px]">
                              <a
                                href={b.taskUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-slate-900 hover:text-blue-600 truncate block"
                                title={b.taskName}
                              >
                                {b.taskName}
                              </a>
                            </td>
                            <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">{b.assigneeName}</td>
                            <td className="py-3 pr-4 whitespace-nowrap">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                b.daysOverdue >= 5
                                  ? 'bg-red-100 text-red-600'
                                  : 'bg-amber-100 text-amber-700'
                              }`}>
                                {b.daysOverdue}d overdue
                              </span>
                            </td>
                            <td className="py-3 pr-4">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                b.priority === 'urgent' ? 'bg-red-100 text-red-600'
                                : b.priority === 'high' ? 'bg-orange-100 text-orange-700'
                                : 'bg-slate-100 text-slate-500'
                              }`}>
                                {b.priority || 'normal'}
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <button
                                onClick={() => dismissBlocker(b.taskId)}
                                className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100"
                              >
                                Dismiss
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {blockerData?.alertHistory?.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <button
                      onClick={() => setAlertHistoryOpen(v => !v)}
                      className="text-xs text-slate-400 hover:text-slate-600 font-medium flex items-center gap-1"
                    >
                      Alert history (last 7 days) — {blockerData.alertHistory.length} entries
                      <svg className={`w-3 h-3 transition-transform ${alertHistoryOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                      </svg>
                    </button>
                    {alertHistoryOpen && (
                      <div className="mt-2 space-y-1">
                        {blockerData.alertHistory.map((h, i) => (
                          <div key={i} className="text-xs text-slate-400 flex items-center gap-2 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span className="font-medium text-slate-600">{h.assigneeName}</span>
                            <span className="truncate">{h.taskName}</span>
                            <span className="shrink-0 text-red-400">{h.daysOverdue}d overdue</span>
                            <span className="shrink-0">{h.alertedAt ? relTime(h.alertedAt) : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* SECTION 4 — Activity feed */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Live Activity Feed</h2>
                <p className="text-xs text-slate-400 mt-0.5">Real-time events across all systems — last 50 actions</p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {ACTIVITY_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setActivityFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${activityFilter === f ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {filteredActivity.length === 0 ? (
              <p className="text-sm text-slate-300 text-center py-8">No activity yet</p>
            ) : (
              <div className="space-y-1">
                {filteredActivity.slice(0, 20).map((item, i) => (
                  <div key={item.id ?? i} className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
                    <div className="flex flex-col items-center shrink-0 mt-1">
                      <span className={`w-2 h-2 rounded-full ${item.status === 'error' ? 'bg-red-500' : item.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <ServiceTag service={item.service} />
                        <span className="text-xs font-semibold text-slate-800 truncate">{item.title}</span>
                      </div>
                      {item.detail && <p className="text-xs text-slate-400">{item.detail}</p>}
                    </div>
                    <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">{relTime(item.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SECTION 5 — GCP Cloud Jobs */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-900">GCP Cloud Scheduler</h2>
              <p className="text-xs text-slate-400 mt-0.5">Managed separately at GCP project <span className="font-mono">clickup-auto-prod-260311</span></p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {[
                { name: 'clickup-daily-report', schedule: '8:00 AM IST daily', type: 'Cloud Run' },
                { name: 'Monday health check', schedule: 'Monday 9:00 AM IST', type: 'Cloud Run' },
                { name: 'Saturday client reminder', schedule: 'Saturday 10:00 AM IST', type: 'Cloud Run' },
              ].map((job) => (
                <div key={job.name} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <p className="text-xs font-bold text-slate-700 font-mono mb-1">{job.name}</p>
                  <p className="text-xs text-slate-500 mb-1">{job.type} · {job.schedule}</p>
                  <p className="text-xs text-slate-400">Last status: check GCP console</p>
                  <a
                    href="https://console.cloud.google.com/cloudscheduler?project=clickup-auto-prod-260311"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sky-500 hover:text-sky-700 font-medium mt-2 inline-block"
                  >
                    View in GCP →
                  </a>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
              GCP real-time status will be integrated in a future update. Click "View in GCP" to check manually.
            </p>
          </div>

          {/* SECTION 6 — Quick actions */}
          <div className="flex flex-wrap gap-3 pb-6">
            {[
              { label: 'n8n dashboard ↗', href: 'https://primary-production-6c6f5.up.railway.app', external: true, color: 'blue' },
              { label: 'Railway dashboard ↗', href: 'https://railway.app', external: true, color: 'blue' },
              { label: 'Meta Developer ↗', href: 'https://developers.facebook.com', external: true, color: 'purple' },
              { label: 'Regenerate Meta token ↗', href: 'https://developers.facebook.com/tools/explorer', external: true, color: 'purple' },
            ].map(link => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-sm font-medium px-4 py-2 rounded-xl transition-colors ${link.color === 'purple' ? 'text-purple-600 bg-purple-50 hover:bg-purple-100' : 'text-blue-600 bg-blue-50 hover:bg-blue-100'}`}
              >
                {link.label}
              </a>
            ))}
            <Link to="/automations" className="text-sm font-medium px-4 py-2 rounded-xl text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors">
              Automation Hub →
            </Link>
            <Link to="/pipelines/settings" className="text-sm font-medium px-4 py-2 rounded-xl text-orange-600 bg-orange-50 hover:bg-orange-100 transition-colors">
              Pipeline settings →
            </Link>
          </div>

        </div>
      </main>
    </div>
  );
}
