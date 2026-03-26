import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import { SkeletonTable } from '../components/SkeletonLoader.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { apiFetch, getUser } from '../lib/api.js';
import { ClipboardList, Download, Filter, ChevronLeft, ChevronRight } from 'lucide-react';

const ACTION_COLORS = {
  LOGIN: 'bg-sky-100 text-sky-700',
  LOGOUT: 'bg-slate-100 text-slate-600',
  EXPORT_CONTACTS: 'bg-amber-100 text-amber-700',
  BULK_DELETE: 'bg-red-100 text-red-700',
  ADD_AD_ACCOUNT: 'bg-green-100 text-green-700',
  REQUEST_REMOVAL: 'bg-amber-100 text-amber-700',
  APPROVE_REMOVAL: 'bg-red-100 text-red-700',
  SEND_REPORT: 'bg-sky-100 text-sky-700',
  CONNECT_SOCIAL: 'bg-purple-100 text-purple-700',
  POST_SOCIAL: 'bg-pink-100 text-pink-700',
  CHANGE_ROLE: 'bg-indigo-100 text-indigo-700',
};

export default function AuditPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ action: '', userId: '', from: '', to: '' });
  const [searchOpen, setSearchOpen] = useState(false);

  async function loadEvents(p = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '30' });
      if (filters.action) params.set('action', filters.action);
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const data = await apiFetch(`/api/audit/events?${params.toString()}`);
      setEvents(data?.events || []);
      setTotal(data?.total || 0);
      setTotalPages(data?.totalPages || 1);
    } catch {} finally { setLoading(false); }
  }

  async function loadUsers() {
    try {
      const data = await apiFetch('/api/audit/users');
      setUsers(data?.users || []);
    } catch {}
  }

  useEffect(() => { loadEvents(); loadUsers(); }, []);
  useEffect(() => { loadEvents(page); }, [page, filters]);

  useEffect(() => {
    const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function exportCsv() {
    const params = new URLSearchParams({ format: 'csv' });
    if (filters.action) params.set('action', filters.action);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    const token = localStorage.getItem('ge_crm_token');
    const res = await fetch(`/api/audit/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit_log.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const actions = [...new Set(events.map(e => e.action))].sort();

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <ClipboardList className="w-6 h-6 text-sky-600" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">Audit Log</h1>
                <p className="text-sm text-slate-500">{total} events recorded</p>
              </div>
            </div>
            <button onClick={exportCsv}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={filters.action} onChange={e => { setFilters(f => ({...f, action: e.target.value})); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5">
              <option value="">All Actions</option>
              {['LOGIN','EXPORT_CONTACTS','BULK_DELETE','ADD_AD_ACCOUNT','REQUEST_REMOVAL','APPROVE_REMOVAL','SEND_REPORT','CONNECT_SOCIAL','POST_SOCIAL','CHANGE_ROLE'].map(a => (
                <option key={a} value={a}>{a.replace(/_/g,' ')}</option>
              ))}
            </select>
            <select value={filters.userId} onChange={e => { setFilters(f => ({...f, userId: e.target.value})); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5">
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="date" value={filters.from} onChange={e => { setFilters(f => ({...f, from: e.target.value})); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5" />
            <span className="text-slate-400 text-sm">to</span>
            <input type="date" value={filters.to} onChange={e => { setFilters(f => ({...f, to: e.target.value})); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5" />
          </div>

          {loading ? <SkeletonTable rows={8} cols={6} /> : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Date/Time</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">User</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Action</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Resource</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Details</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 && (
                    <tr><td colSpan={6}>
                      <EmptyState icon={ClipboardList} title="No audit events" description="Actions will be logged here automatically." />
                    </td></tr>
                  )}
                  {events.map(evt => (
                    <tr key={evt.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                        {new Date(evt.created_at).toLocaleDateString('en-IN')} {new Date(evt.created_at).toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700 font-medium">{evt.user_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[evt.action] || 'bg-slate-100 text-slate-600'}`}>
                          {evt.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {evt.resource_type && <span className="capitalize">{evt.resource_type}</span>}
                        {evt.resource_id && <span className="text-slate-400 ml-1 font-mono text-xs">{evt.resource_id.slice(0, 8)}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-48 truncate">
                        {evt.metadata && typeof evt.metadata === 'object' ? JSON.stringify(evt.metadata) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 font-mono">{evt.ip_address || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                  <p className="text-xs text-slate-400">Page {page} of {totalPages} ({total} events)</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                      className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                      className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
