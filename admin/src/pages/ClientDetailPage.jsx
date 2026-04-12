import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  ArrowLeft, User, Mail, Phone, MapPin, Receipt,
  TrendingUp, Search, Globe, Loader2, AlertCircle
} from 'lucide-react';

function inr(paise) {
  return `\u20B9${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value, color = 'text-slate-900', icon: Icon }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
        <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{label}</p>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    apiFetch(`/api/clients/${clientId}/360`)
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [clientId]);

  const client = data?.client;
  const billing = data?.billing;
  const ads = data?.ads;
  const seo = data?.seo;
  const deals = data?.deals || [];
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
          <Link to="/billing" className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          {client ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-lg">
                {(client.name || 'C')[0].toUpperCase()}
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">{client.name}</h1>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {client.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{client.email}</span>}
                  {client.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-lg font-bold text-slate-900">Client Detail</h1>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="p-6">
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-700 font-medium">{error}</p>
              <p className="text-red-500 text-sm mt-1">Could not load client data. The client may not exist.</p>
            </div>
          </div>
        )}

        {/* Content */}
        {!loading && !error && data && (
          <div className="p-6 space-y-6">
            {/* Row 1: Client Info + Billing Summary */}
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" /> Client Information
                </h3>
                <div className="space-y-2 text-sm">
                  {client?.address && (
                    <p className="flex items-start gap-2 text-slate-600">
                      <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                      {client.address}
                    </p>
                  )}
                  {client?.gstin && (
                    <p className="text-slate-600"><span className="font-medium text-slate-700">GSTIN:</span> {client.gstin}</p>
                  )}
                  {client?.retainerAmount != null && (
                    <p className="text-slate-600">
                      <span className="font-medium text-slate-700">Retainer:</span> {inr(client.retainerAmount)}/mo
                    </p>
                  )}
                  {!client?.address && !client?.gstin && !client?.retainerAmount && (
                    <p className="text-slate-400">No additional info available</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-slate-400" /> Billing Summary
                </h3>
                {billing ? (
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard label="Invoiced" value={inr(billing.invoiced)} />
                    <StatCard label="Paid" value={inr(billing.paid)} color="text-green-600" />
                    <StatCard label="Outstanding" value={inr(billing.outstanding)} color={billing.outstanding > 0 ? 'text-red-600' : 'text-slate-900'} />
                    <StatCard label="Retainer" value={inr(billing.retainer)} />
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No billing data available</p>
                )}
              </div>
            </div>

            {/* Row 2: Meta Ads */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-slate-400" /> Meta Ads Metrics
              </h3>
              {ads && !ads.error ? (
                <div className="grid grid-cols-4 gap-3">
                  <StatCard label="Spend" value={`\u20B9${Number(ads.spend || 0).toLocaleString('en-IN')}`} />
                  <StatCard label="ROAS" value={`${ads.roas || 0}x`} color={Number(ads.roas) >= 2 ? 'text-green-600' : 'text-red-500'} />
                  <StatCard label="Clicks" value={Number(ads.clicks || 0).toLocaleString('en-IN')} />
                  <StatCard label="Impressions" value={Number(ads.impressions || 0).toLocaleString('en-IN')} />
                </div>
              ) : (
                <p className="text-sm text-slate-400">No ad account linked for this client.</p>
              )}
            </div>

            {/* Row 3: SEO */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" /> SEO Summary
              </h3>
              {seo ? (
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="PageSpeed (Mobile)" value={seo.pageSpeedMobile ?? 'N/A'} color={Number(seo.pageSpeedMobile) >= 80 ? 'text-green-600' : 'text-amber-600'} />
                  <StatCard label="PageSpeed (Desktop)" value={seo.pageSpeedDesktop ?? 'N/A'} color={Number(seo.pageSpeedDesktop) >= 80 ? 'text-green-600' : 'text-amber-600'} />
                  <StatCard label="Keywords Tracked" value={seo.keywordCount || 0} />
                </div>
              ) : (
                <p className="text-sm text-slate-400">No SEO data available for this client.</p>
              )}
            </div>

            {/* Row 4: Active Deals */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Active Deals</p>
              </div>
              {deals.length === 0 ? (
                <p className="p-5 text-sm text-slate-400 text-center">No active deals</p>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Stage</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Value</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Assigned To</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((deal, i) => (
                      <tr key={deal.id || i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{deal.stage}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 text-right">{inr(deal.value)}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{deal.assignedTo || '-'}</td>
                        <td className="px-4 py-3 text-xs text-slate-400 text-right">
                          {deal.updatedAt ? new Date(deal.updatedAt).toLocaleDateString('en-IN') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Row 5: Invoices + Payments side by side */}
            <div className="grid grid-cols-2 gap-6">
              {/* Recent Invoices */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recent Invoices</p>
                </div>
                {invoices.length === 0 ? (
                  <p className="p-5 text-sm text-slate-400 text-center">No invoices</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {invoices.slice(0, 10).map((inv, i) => (
                      <div key={inv.id || i} className="px-5 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{inv.number || `INV-${i + 1}`}</p>
                          <p className="text-xs text-slate-400">{inv.date ? new Date(inv.date).toLocaleDateString('en-IN') : ''}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-900">{inr(inv.amount)}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {inv.status || 'pending'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Payments */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recent Payments</p>
                </div>
                {payments.length === 0 ? (
                  <p className="p-5 text-sm text-slate-400 text-center">No payments</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {payments.slice(0, 10).map((pay, i) => (
                      <div key={pay.id || i} className="px-5 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{pay.method || 'Payment'}</p>
                          <p className="text-xs text-slate-400">{pay.date ? new Date(pay.date).toLocaleDateString('en-IN') : ''}</p>
                        </div>
                        <p className="text-sm font-semibold text-green-600">{inr(pay.amount)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
