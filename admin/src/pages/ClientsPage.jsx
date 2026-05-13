import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Briefcase, Search, Plus, AlertTriangle, TrendingUp, Trophy,
  Loader2, Building2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'churned', label: 'Churned' },
  { id: 'paused', label: 'Paused' },
];

const STATUS_STYLES = {
  active:  { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  churned: { bg: 'bg-slate-200',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
  paused:  { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
};

// Backend returns amounts in paise (₹ × 100). Convert defensively.
function formatINR(paise) {
  const rupees = Math.round(Number(paise || 0) / 100);
  if (rupees >= 10000000) return `₹${(rupees / 10000000).toFixed(1)}Cr`;
  if (rupees >= 100000)   return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000)     return `₹${(rupees / 1000).toFixed(1)}k`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return '—'; }
}

function getInitials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || '?';
}

function stringToColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#6366F1', '#14B8A6', '#F97316'];
  return colors[Math.abs(hash) % colors.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────
function ClientCard({ client, onOpen }) {
  const status = client.status || 'active';
  const styles = STATUS_STYLES[status] || STATUS_STYLES.active;
  const avatarColor = stringToColor(client.name);
  const hasOpenInvoices = client.openInvoiceCount > 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(client.id)}
      className="text-left bg-white rounded-xl border border-slate-200 hover:border-sky-400 hover:shadow-md transition-all p-5 flex flex-col gap-4 group"
    >
      {/* Header: avatar + name + status */}
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: avatarColor }}
        >
          {getInitials(client.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 truncate group-hover:text-sky-700 transition-colors">
            {client.name}
          </h3>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {client.primaryContactName || 'No primary contact'}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles.bg} ${styles.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
          {status}
        </span>
      </div>

      {/* Middle: MRR + LTV */}
      <div className="flex items-end gap-4 pt-1">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">MRR (30d)</div>
          <div className="text-lg font-bold text-slate-900 leading-tight">{formatINR(client.mrr)}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">Lifetime</div>
          <div className="text-sm font-semibold text-slate-700 leading-tight">{formatINR(client.lifetimeValue)}</div>
        </div>
      </div>

      {/* Footer: open invoices, last paid, deals won */}
      <div className="border-t border-slate-100 pt-3 flex items-center gap-3 text-xs">
        {hasOpenInvoices ? (
          <span className="inline-flex items-center gap-1 text-red-600 font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            {client.openInvoiceCount} open · {formatINR(client.openInvoiceAmount)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
            <TrendingUp className="w-3.5 h-3.5" />
            No open invoices
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-slate-500" title="Deals won">
          <Trophy className="w-3.5 h-3.5 text-amber-500" />
          {client.totalDealsWon}
        </span>
      </div>

      <div className="text-[11px] text-slate-400">
        Last paid: {formatDate(client.lastInvoicePaidAt)}
      </div>
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-100 rounded w-1/2" />
        </div>
        <div className="h-4 w-14 bg-slate-100 rounded-full" />
      </div>
      <div className="flex items-end gap-4">
        <div className="space-y-1">
          <div className="h-2.5 w-12 bg-slate-100 rounded" />
          <div className="h-5 w-16 bg-slate-200 rounded" />
        </div>
        <div className="ml-auto space-y-1 text-right">
          <div className="h-2.5 w-12 bg-slate-100 rounded ml-auto" />
          <div className="h-4 w-14 bg-slate-200 rounded ml-auto" />
        </div>
      </div>
      <div className="border-t border-slate-100 pt-3 h-3 bg-slate-100 rounded" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [toast, setToast] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = statusFilter && statusFilter !== 'all' ? `?status=${encodeURIComponent(statusFilter)}` : '';
    apiFetch(`/api/clients${qs}`)
      .then((data) => {
        if (cancelled) return;
        setClients(Array.isArray(data?.clients) ? data.clients : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ClientsPage] fetch failed', err);
        setError(err?.message || 'Failed to load clients');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const haystack = [c.name, c.primaryContactName].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [clients, search]);

  function openClient(id) {
    navigate(`/client/${id}`);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-sky-700" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Clients</h1>
              <p className="text-xs text-slate-500">Active retainers, billing snapshots, and onboarding status</p>
            </div>
            <button
              type="button"
              onClick={() => showToast('TODO: Add client flow — for now, win a deal in Pipeline to auto-create a client.')}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Client
            </button>
          </div>

          {/* Toolbar: search + status pills */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients by name or contact…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
              {STATUS_PILLS.map((pill) => {
                const active = statusFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setStatusFilter(pill.id)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                      active
                        ? 'bg-white text-sky-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-slate-500 ml-auto">
              {loading ? 'Loading…' : `${filtered.length} of ${clients.length} client${clients.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-700 font-medium">{error}</p>
              <p className="text-red-500 text-sm mt-1">Try refreshing the page or check the API logs.</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <Building2 className="w-7 h-7 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">
                {clients.length === 0 ? 'No clients yet' : 'No clients match this filter'}
              </h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                {clients.length === 0
                  ? 'Won deals in your sales pipeline auto-create clients here. Move a deal to the “Won” stage to onboard your first one.'
                  : 'Try clearing the search or switching the status filter.'}
              </p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((c) => (
                <ClientCard key={c.id} client={c} onOpen={openClient} />
              ))}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-3 rounded-lg shadow-lg max-w-sm z-50 flex items-start gap-2">
            <Loader2 className="w-4 h-4 mt-0.5 shrink-0 opacity-70" />
            <span>{toast}</span>
          </div>
        )}
      </main>
    </div>
  );
}
