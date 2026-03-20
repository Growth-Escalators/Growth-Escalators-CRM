import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';

const SOURCE_COLORS = {
  facebook: 'bg-blue-100 text-blue-700',
  instagram: 'bg-pink-100 text-pink-700',
  whatsapp: 'bg-green-100 text-green-700',
  organic: 'bg-emerald-100 text-emerald-700',
  referral: 'bg-purple-100 text-purple-700',
  email: 'bg-yellow-100 text-yellow-700',
};

const STATUS_COLORS = {
  lead: 'bg-slate-100 text-slate-600',
  prospect: 'bg-sky-100 text-sky-700',
  qualified: 'bg-violet-100 text-violet-700',
  client: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-600',
};

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value ?? '—'}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // Stats
  const [stats, setStats] = useState({ total: 0, todayNew: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
      sort: 'newest',
    });
    if (search) params.set('search', search);
    if (source) params.set('source', source);
    if (status) params.set('status', status);

    const data = await apiFetch(`/contacts?${params}`);
    if (data) {
      setContacts(data.contacts ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [search, source, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Stats: total and today new
  useEffect(() => {
    apiFetch('/contacts?limit=1&sort=newest').then((d) => {
      if (d) setStats((s) => ({ ...s, total: d.total ?? 0 }));
    });
    const today = new Date().toISOString().split('T')[0];
    apiFetch(`/contacts?limit=1&dateFrom=${today}`).then((d) => {
      if (d) setStats((s) => ({ ...s, todayNew: d.total ?? 0 }));
    });
  }, []);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b px-8 py-5">
          <h1 className="text-xl font-bold text-slate-900">Contacts</h1>
          <p className="text-sm text-slate-400 mt-0.5">{total.toLocaleString()} total contacts</p>
        </div>

        {/* Stats */}
        <div className="px-8 py-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Contacts" value={stats.total.toLocaleString()} />
          <StatCard label="Added Today" value={stats.todayNew} />
          <StatCard label="Checkout Leads" value="—" sub="from ecom.growthescalators.com" />
          <StatCard label="Cal Bookings" value="—" sub="confirmed this month" />
        </div>

        {/* Filters */}
        <div className="px-8 pb-4 flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Search name, phone, email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 w-64"
          />
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          >
            <option value="">All sources</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="organic">Organic</option>
            <option value="referral">Referral</option>
            <option value="email">Email</option>
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          >
            <option value="">All statuses</option>
            <option value="lead">Lead</option>
            <option value="prospect">Prospect</option>
            <option value="qualified">Qualified</option>
            <option value="client">Client</option>
            <option value="lost">Lost</option>
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 px-8 pb-8">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left border-b border-slate-200">
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">WhatsApp</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Source</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Tags</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Added</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Loading…</td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No contacts found</td>
                  </tr>
                ) : (
                  contacts.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 uppercase shrink-0">
                            {c.firstName?.[0] ?? '?'}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{c.firstName} {c.lastName ?? ''}</p>
                            {c.doNotContact && <p className="text-xs text-red-500">DNC</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.phone ?? c.waPhone ?? '—'}</td>
                      <td className="px-4 py-3">
                        {c.source ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[c.source] ?? 'bg-slate-100 text-slate-600'}`}>
                            {c.source}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 2).map((tag) => (
                            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                              {tag}
                            </span>
                          ))}
                          {(c.tags?.length ?? 0) > 2 && (
                            <span className="text-xs text-slate-400">+{c.tags.length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] ?? 'bg-slate-100 text-slate-600'}`}>
                          {c.status ?? 'lead'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
                <p className="text-xs text-slate-400">
                  Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-white transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {selected && (
        <ContactSlideIn
          contact={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { load(); setSelected(null); }}
        />
      )}
    </div>
  );
}
