import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { SkeletonTable } from '../components/SkeletonLoader.jsx';
import { apiFetch, getUser } from '../lib/api.js';
import { TrendingUp, Plus, Trash2, RotateCcw, CheckCircle, AlertCircle, X, Clock } from 'lucide-react';

function StatusBadge({ account }) {
  if (!account.isActive && account.removalApprovedAt) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">Inactive</span>;
  }
  if (account.removalRequestedAt && !account.removalApprovedAt) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Removal Requested</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>;
}

function AddModal({ onClose, onSave }) {
  const [accountId, setAccountId] = useState('act_');
  const [accountName, setAccountName] = useState('');
  const [clientName, setClientName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!accountId.startsWith('act_') || !accountName) { setError('Valid account ID and name required'); return; }
    setSaving(true);
    try {
      await apiFetch('/api/marketing/accounts', {
        method: 'POST',
        body: JSON.stringify({ accountId, accountName, clientName, notes }),
      });
      onSave();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">Add Ad Account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Account ID</label>
            <input value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="act_323237510625803"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Account Name</label>
            <input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="e.g. GE Agency"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Client Name (optional)</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Paraiso Comfortwear"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MarketingPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState('accounts');
  const user = getUser();
  const isAdmin = user?.role === 'admin';

  async function loadAccounts() {
    setLoading(true);
    try {
      const data = await apiFetch('/api/marketing/accounts');
      setAccounts(data?.accounts || []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { loadAccounts(); }, []);

  // Cmd+K
  useEffect(() => {
    const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function requestRemoval(id) {
    if (!confirm('This will notify Jatin for approval. Historical data will be preserved.')) return;
    await apiFetch(`/api/marketing/accounts/${id}/request-removal`, { method: 'POST' });
    loadAccounts();
  }

  async function approveRemoval(id) {
    await apiFetch(`/api/marketing/accounts/${id}/approve-removal`, { method: 'POST' });
    loadAccounts();
  }

  async function reactivate(id) {
    await apiFetch(`/api/marketing/accounts/${id}/reactivate`, { method: 'POST' });
    loadAccounts();
  }

  const pendingRemovals = accounts.filter(a => a.removalRequestedAt && !a.removalApprovedAt && a.isActive);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-6 h-6 text-sky-600" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">Marketing Accounts</h1>
                <p className="text-sm text-slate-500">Manage Meta ad accounts</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex bg-slate-100 rounded-lg p-1">
                {['accounts', 'sync'].map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                      tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}>{t === 'sync' ? 'Sync Status' : 'Ad Accounts'}</button>
                ))}
              </div>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700">
                <Plus className="w-4 h-4" /> Add Account
              </button>
            </div>
          </div>

          {/* Pending removal banners */}
          {pendingRemovals.map(acct => (
            <div key={acct.id} className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">
                  "{acct.accountName}" removal requested by {acct.requestedByName || 'team member'} on {new Date(acct.removalRequestedAt).toLocaleDateString('en-IN')}
                </p>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => approveRemoval(acct.id)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700">Approve</button>
                  <button onClick={() => {}} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs hover:bg-slate-50">Reject</button>
                </div>
              )}
            </div>
          ))}

          {tab === 'accounts' && (
            <>
              {loading ? <SkeletonTable rows={4} cols={7} /> : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Account Name</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Client</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Account ID</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500">Added</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.length === 0 && (
                        <tr><td colSpan={6}>
                          <EmptyState icon={TrendingUp} title="No ad accounts" description="Add your first Meta ad account to get started." ctaLabel="Add Account" ctaAction={() => setShowAdd(true)} />
                        </td></tr>
                      )}
                      {accounts.map(acct => (
                        <tr key={acct.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm font-medium text-slate-800">{acct.accountName}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{acct.clientName || '—'}</td>
                          <td className="px-4 py-3 text-sm text-slate-500 font-mono">{acct.accountId}</td>
                          <td className="px-4 py-3"><StatusBadge account={acct} /></td>
                          <td className="px-4 py-3 text-sm text-slate-400">{acct.createdAt ? new Date(acct.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {acct.isActive && !acct.removalRequestedAt && !isAdmin && (
                                <button onClick={() => requestRemoval(acct.id)}
                                  className="px-2.5 py-1 text-xs text-amber-600 bg-amber-50 rounded-lg hover:bg-amber-100">
                                  Request Removal
                                </button>
                              )}
                              {acct.isActive && isAdmin && !acct.removalRequestedAt && (
                                <button onClick={() => approveRemoval(acct.id)}
                                  className="px-2.5 py-1 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100">
                                  Remove
                                </button>
                              )}
                              {!acct.isActive && isAdmin && (
                                <button onClick={() => reactivate(acct.id)}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-sky-600 bg-sky-50 rounded-lg hover:bg-sky-100">
                                  <RotateCcw className="w-3 h-3" /> Reactivate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'sync' && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">Sync Status</p>
              <p className="text-slate-400 text-xs mt-1">Cache refresh runs hourly. Ad insights are cached for 1 hour.</p>
              <p className="text-slate-400 text-xs mt-1">{accounts.filter(a => a.isActive).length} active account(s) being synced.</p>
            </div>
          )}
        </div>

        {showAdd && <AddModal onClose={() => setShowAdd(false)} onSave={loadAccounts} />}
      </main>
    </div>
  );
}
