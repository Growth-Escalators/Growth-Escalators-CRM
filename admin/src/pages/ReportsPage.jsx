import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import { FileText, Send, Download, RefreshCw, Check, ChevronLeft, ChevronRight, Globe, Receipt } from 'lucide-react';

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function inr(paise) {
  return `\u20B9${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getLast12Months() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    months.push({ value, label });
  }
  return months;
}

function MetricCard({ label, value, sub, color = 'text-slate-900' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ReportsPage() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [weekDate, setWeekDate] = useState(() => getMonday(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [clientsLoading, setClientsLoading] = useState(true);
  const [reportType, setReportType] = useState('weekly');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => {
    apiFetch('/api/reports/clients')
      .then(d => setClients(d?.clients || []))
      .catch(e => setError(e.message))
      .finally(() => setClientsLoading(false));
  }, []);

  const weekOf = weekDate.toISOString().split('T')[0];
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const last12 = getLast12Months();

  function prevWeek() {
    const d = new Date(weekDate);
    d.setDate(d.getDate() - 7);
    setWeekDate(d);
    setReport(null);
  }

  function nextWeek() {
    const d = new Date(weekDate);
    d.setDate(d.getDate() + 7);
    setWeekDate(d);
    setReport(null);
  }

  async function generateReport() {
    if (!selectedClient) return;
    setLoading(true);
    setError('');
    setReport(null);
    try {
      let data;
      if (reportType === 'monthly') {
        data = await apiFetch(`/api/reports/generate-monthly?clientId=${selectedClient.id}&month=${selectedMonth}`);
      } else {
        data = await apiFetch(`/api/reports/generate?clientId=${selectedClient.id}&weekOf=${weekOf}`);
      }
      setReport(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendPdf() {
    if (!selectedClient) return;
    setSending(true);
    setSent(false);
    setError('');
    try {
      await apiFetch(`/api/reports/send-pdf?clientId=${selectedClient.id}&weekOf=${weekOf}`, { method: 'POST' });
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function downloadPdf() {
    if (!selectedClient) return;
    const token = localStorage.getItem('ge_crm_token');
    let url;
    if (reportType === 'monthly') {
      url = `/api/reports/monthly-pdf?clientId=${selectedClient.id}&month=${selectedMonth}`;
    } else {
      url = `/api/reports/pdf?clientId=${selectedClient.id}&weekOf=${weekOf}`;
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { setError('PDF download failed'); return; }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const suffix = reportType === 'monthly' ? selectedMonth : weekOf;
    a.download = `GE_Report_${selectedClient.name}_${suffix}.pdf`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }

  const adM = report?.adMetrics;
  const reportData = report;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
          <FileText className="w-5 h-5 text-sky-600" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Client Reports</h1>
            <p className="text-xs text-slate-500">Generate and send weekly or monthly performance reports</p>
          </div>
        </div>

        <div className="p-6 flex gap-6 h-full">
          {/* Left panel — client list */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Clients</p>
              </div>
              {clientsLoading && (
                <div className="p-4 text-center text-sm text-slate-400">Loading…</div>
              )}
              {!clientsLoading && clients.length === 0 && (
                <div className="p-4 text-center text-sm text-slate-400">No active clients</div>
              )}
              {clients.map(client => (
                <button
                  key={client.id}
                  onClick={() => { setSelectedClient(client); setReport(null); setError(''); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-50 last:border-0 transition-colors ${
                    selectedClient?.id === client.id ? 'bg-sky-50 border-l-2 border-l-sky-600' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-sm">
                    {(client.name || 'C')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{client.name}</p>
                    <p className="text-xs text-slate-400 truncate">{client.metaAdAccountId ? 'Ads linked' : 'No ads account'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1">
            {!selectedClient ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">Select a client to generate their report</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Report type toggle */}
                <div className="flex bg-slate-100 rounded-lg p-1 w-fit">
                  <button
                    onClick={() => { setReportType('weekly'); setReport(null); }}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportType === 'weekly' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Weekly
                  </button>
                  <button
                    onClick={() => { setReportType('monthly'); setReport(null); }}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${reportType === 'monthly' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Monthly
                  </button>
                </div>

                {/* Date selector + actions */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
                  {reportType === 'weekly' ? (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Selected Week</p>
                      <div className="flex items-center gap-2">
                        <button onClick={prevWeek} className="p-1 hover:bg-slate-100 rounded"><ChevronLeft className="w-4 h-4" /></button>
                        <span className="text-sm font-medium text-slate-800">
                          {formatDate(weekDate)} – {formatDate(weekEnd)}
                        </span>
                        <button onClick={nextWeek} className="p-1 hover:bg-slate-100 rounded"><ChevronRight className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Selected Month</p>
                      <select
                        value={selectedMonth}
                        onChange={e => { setSelectedMonth(e.target.value); setReport(null); }}
                        className="text-sm font-medium text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        {last12.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex items-center gap-2 ml-auto">
                    {error && <span className="text-xs text-red-500">{error}</span>}
                    {sent && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Sent!</span>}
                    <button
                      onClick={generateReport}
                      disabled={loading}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                      Generate
                    </button>
                    {report && (
                      <>
                        <button
                          onClick={downloadPdf}
                          className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200"
                        >
                          <Download className="w-4 h-4" />
                          Download PDF
                        </button>
                        {reportType === 'weekly' && (
                          <button
                            onClick={sendPdf}
                            disabled={sending}
                            className="flex items-center gap-1.5 px-3 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                            {sending ? 'Sending…' : 'Send PDF to Client'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Report preview */}
                {loading && (
                  <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
                    Generating report…
                  </div>
                )}

                {report && (
                  <>
                    {/* Client header */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-lg">
                        {(report.client?.name || 'C')[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-lg">{report.client?.name}</p>
                        {reportType === 'weekly' ? (
                          <p className="text-sm text-slate-500">Report for {formatDate(new Date(report.weekStart))} – {formatDate(new Date(report.weekEnd))}</p>
                        ) : (
                          <p className="text-sm text-slate-500">Monthly Report for {last12.find(m => m.value === selectedMonth)?.label || selectedMonth}</p>
                        )}
                      </div>
                    </div>

                    {/* Ad metrics */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">Meta Ads Performance</h3>
                      {!adM && <p className="text-sm text-slate-400">No Meta Ads account linked for this client.</p>}
                      {adM && adM.error && <p className="text-sm text-red-500">Ads error: {adM.error}</p>}
                      {adM && !adM.error && (
                        <div className="grid grid-cols-4 gap-3">
                          <MetricCard label="Spend" value={`\u20B9${Number(adM.spend).toLocaleString('en-IN')}`} color="text-slate-900" />
                          <MetricCard label="Purchases" value={adM.purchases} color="text-green-600" />
                          <MetricCard label="ROAS" value={`${adM.roas}x`} color={Number(adM.roas) >= 2 ? 'text-green-600' : 'text-red-500'} />
                          <MetricCard label="CTR" value={`${adM.ctr}%`} />
                          <MetricCard label="CPC" value={`\u20B9${adM.cpc}`} />
                          <MetricCard label="CPM" value={`\u20B9${adM.cpm}`} />
                          <MetricCard label="Impressions" value={Number(adM.impressions).toLocaleString('en-IN')} />
                          <MetricCard label="Clicks" value={Number(adM.clicks).toLocaleString('en-IN')} />
                        </div>
                      )}
                    </div>

                    {/* SEO Section */}
                    {reportData?.seo && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <Globe className="w-4 h-4 text-slate-400" /> SEO Performance
                        </h3>
                        <div className="grid grid-cols-4 gap-3">
                          <MetricCard
                            label="PageSpeed (Mobile)"
                            value={reportData.seo.pageSpeedMobile ?? 'N/A'}
                            color={Number(reportData.seo.pageSpeedMobile) >= 80 ? 'text-green-600' : 'text-amber-600'}
                          />
                          <MetricCard
                            label="PageSpeed (Desktop)"
                            value={reportData.seo.pageSpeedDesktop ?? 'N/A'}
                            color={Number(reportData.seo.pageSpeedDesktop) >= 80 ? 'text-green-600' : 'text-amber-600'}
                          />
                          <MetricCard
                            label="Keyword Gains"
                            value={reportData.seo.keywordGains ?? 0}
                            color="text-green-600"
                          />
                          <MetricCard
                            label="Keyword Losses"
                            value={reportData.seo.keywordLosses ?? 0}
                            color={Number(reportData.seo.keywordLosses) > 0 ? 'text-red-500' : 'text-slate-900'}
                          />
                          {reportData.seo.alertCount != null && (
                            <MetricCard
                              label="Alerts"
                              value={reportData.seo.alertCount}
                              color={Number(reportData.seo.alertCount) > 0 ? 'text-amber-600' : 'text-green-600'}
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Billing Section */}
                    {reportData?.billing && (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <Receipt className="w-4 h-4 text-slate-400" /> Billing Summary
                        </h3>
                        <div className="grid grid-cols-4 gap-3">
                          <MetricCard label="Invoiced" value={inr(reportData.billing.invoiced)} />
                          <MetricCard label="Paid" value={inr(reportData.billing.paid)} color="text-green-600" />
                          <MetricCard
                            label="Outstanding"
                            value={inr(reportData.billing.outstanding)}
                            color={Number(reportData.billing.outstanding) > 0 ? 'text-red-500' : 'text-slate-900'}
                          />
                          <MetricCard label="Retainer" value={inr(reportData.billing.retainer)} />
                        </div>
                      </div>
                    )}

                    {/* Completed tasks */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Completed Tasks {reportType === 'weekly' ? 'This Week' : 'This Month'}
                        </p>
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          {report.completedTasks?.length || 0} tasks
                        </span>
                      </div>
                      {(report.completedTasks || []).length === 0 && (
                        <p className="p-5 text-sm text-slate-400 text-center">No completed tasks found for this {reportType === 'weekly' ? 'week' : 'month'}.</p>
                      )}
                      <div className="divide-y divide-slate-50">
                        {(report.completedTasks || []).map(task => (
                          <div key={task.id} className="px-5 py-3 flex items-center gap-3">
                            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-green-600" />
                            </div>
                            <p className="text-sm text-slate-700 flex-1">{task.name}</p>
                            <p className="text-xs text-slate-400 flex-shrink-0">
                              {task.completedAt ? new Date(Number(task.completedAt)).toLocaleDateString('en-IN') : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
