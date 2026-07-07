import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import PagePostsSection from '../components/PagePostsSection.jsx';
import { apiFetch } from '../lib/api.js';
import { getAuthToken } from '../lib/auth.js';
import { Building2, FileText, RefreshCw, AlertCircle, ShieldCheck } from 'lucide-react';

function maskToken(token) {
  if (!token || typeof token !== 'string') return '—';
  if (token.length <= 12) return '✓ present';
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function VerificationBadge({ status }) {
  const s = (status || '').toLowerCase();
  const styles = {
    verified: 'bg-green-100 text-green-700',
    not_verified: 'bg-slate-100 text-slate-500',
    pending: 'bg-amber-100 text-amber-700',
    expired: 'bg-red-100 text-red-600',
    revoked: 'bg-red-100 text-red-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[s] || 'bg-slate-100 text-slate-500'}`}>
      {status || 'unknown'}
    </span>
  );
}

function SectionCard({ title, icon: Icon, count, children, onRefresh, loading }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        <Icon className="w-4 h-4 text-sky-500" />
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
        {count != null && <span className="text-xs text-slate-400">{count} total</span>}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="ml-auto flex items-center gap-1 text-xs text-sky-600 hover:text-sky-800 disabled:opacity-50 font-medium"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export default function MetaAssetsPage() {
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState(null);

  const [businesses, setBusinesses] = useState([]);
  const [bizLoading, setBizLoading] = useState(true);
  const [bizError, setBizError] = useState(null);

  const loadPages = useCallback(async () => {
    setPagesLoading(true);
    setPagesError(null);
    try {
      const data = await apiFetch('/api/meta/pages');
      if (data?.error) setPagesError(data.error);
      setPages(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      setPagesError(e.message);
      setPages([]);
    } finally {
      setPagesLoading(false);
    }
  }, []);

  const loadBusinesses = useCallback(async () => {
    setBizLoading(true);
    setBizError(null);
    try {
      const data = await apiFetch('/api/meta/businesses');
      if (data?.error) setBizError(data.error);
      setBusinesses(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      setBizError(e.message);
      setBusinesses([]);
    } finally {
      setBizLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadPages(), loadBusinesses()]);
  }, [loadPages, loadBusinesses]);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-sky-600" />
            <div className="mr-auto">
              <h1 className="text-lg font-bold text-slate-900">Meta Assets</h1>
              <p className="text-xs text-slate-500">Pages and Business Manager assets connected via the Meta Graph API.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                const t = getAuthToken();
                window.location.href = `/api/social/oauth/facebook/start?token=${t}`;
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1877F2] text-white rounded-lg text-sm hover:bg-[#0f5fc2] mr-2"
              title="Connect a Facebook account — grants pages_show_list, pages_read_engagement, business_management, ads_read, ads_management, and more in one flow."
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89H7.898V12h2.54V9.797c0-2.506 1.493-3.89 3.776-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.244 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.99C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/></svg>
              Connect Facebook
            </button>
            <button
              onClick={() => Promise.all([loadPages(), loadBusinesses()])}
              disabled={pagesLoading || bizLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${(pagesLoading || bizLoading) ? 'animate-spin' : ''}`} />
              Refresh All
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* ── Pages ─────────────────────────────────────────────── */}
          <SectionCard
            title="Facebook Pages"
            icon={FileText}
            count={pages.length}
            onRefresh={loadPages}
            loading={pagesLoading}
          >
            {pagesError && (
              <div className="mx-6 mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{pagesError}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Page ID</th>
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Name</th>
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Category</th>
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Page Access Token</th>
                  </tr>
                </thead>
                <tbody>
                  {pagesLoading && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">Loading pages…</td></tr>
                  )}
                  {!pagesLoading && pages.length === 0 && !pagesError && (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">No Pages connected to this Meta user.</td></tr>
                  )}
                  {pages.map(p => (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-6 py-3 text-sm font-mono text-slate-700">{p.id}</td>
                      <td className="px-6 py-3 text-sm font-medium text-slate-800">{p.name || '—'}</td>
                      <td className="px-6 py-3 text-sm text-slate-600">{p.category || '—'}</td>
                      <td className="px-6 py-3 text-xs font-mono text-slate-500">{maskToken(p.access_token)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* ── Businesses ────────────────────────────────────────── */}
          <SectionCard
            title="Business Manager"
            icon={Building2}
            count={businesses.length}
            onRefresh={loadBusinesses}
            loading={bizLoading}
          >
            {bizError && (
              <div className="mx-6 mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{bizError}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Business ID</th>
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Name</th>
                    <th className="px-6 py-2 text-xs font-semibold text-slate-500">Verification Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bizLoading && (
                    <tr><td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-400">Loading businesses…</td></tr>
                  )}
                  {!bizLoading && businesses.length === 0 && !bizError && (
                    <tr><td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-400">No Business Manager assets connected.</td></tr>
                  )}
                  {businesses.map(b => (
                    <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-6 py-3 text-sm font-mono text-slate-700">{b.id}</td>
                      <td className="px-6 py-3 text-sm font-medium text-slate-800">{b.name || '—'}</td>
                      <td className="px-6 py-3"><VerificationBadge status={b.verification_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* ── Page Posts ────────────────────────────────────────── */}
          <PagePostsSection />
        </div>
      </main>
    </div>
  );
}
