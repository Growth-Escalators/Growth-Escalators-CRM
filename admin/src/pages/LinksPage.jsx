import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Link, Plus, Copy, BarChart2, ExternalLink, RefreshCw,
  Tag, Trash2, Check, ChevronRight, Search, Globe, MousePointer
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------
function CopyBtn({ text, small = false }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* ignore */ }
  }
  return (
    <button onClick={copy}
      className={`flex items-center gap-1 ${small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors`}>
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stats modal
// ---------------------------------------------------------------------------
function StatsModal({ link, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/links/${encodeURIComponent(link.shortCode)}/stats`)
      .then(d => setStats(d))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [link.shortCode]);

  const shortUrl = `${link.domain ?? 'links.growthescalators.com'}/${link.shortCode}`;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Link Stats</h2>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{shortUrl}</p>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse"/>)}</div>
          ) : !stats ? (
            <p className="text-sm text-slate-500 text-center py-6">No stats available</p>
          ) : (
            <div className="space-y-4">
              {/* Total clicks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { label: 'Total Clicks', value: stats.visitsSummary?.total ?? stats.visits ?? 0 },
                  { label: 'Unique Visitors', value: stats.visitsSummary?.nonBots ?? '—' },
                  { label: 'Created', value: fmtDate(link.dateCreated) },
                ].map(m => (
                  <div key={m.label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">{m.value}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.label}</p>
                  </div>
                ))}
              </div>

              {/* Original URL */}
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-slate-500 mb-1">Original URL</p>
                <a href={link.longUrl} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-sky-600 hover:underline truncate block">
                  {link.longUrl}
                </a>
              </div>

              {/* Tags */}
              {link.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {link.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 bg-sky-50 text-sky-700 text-xs rounded-full border border-sky-200">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-6 pb-4 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create link slide-in panel
// ---------------------------------------------------------------------------
function CreatePanel({ onClose, onCreated }) {
  const [url, setUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) { setError('URL is required'); return; }
    setSaving(true);
    setError('');
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      const body = { destinationUrl: url.trim(), ...(slug.trim() && { customSlug: slug.trim() }), ...(tagList.length && { tags: tagList }) };
      const result = await apiFetch('/api/links/create', { method: 'POST', body: JSON.stringify(body) });
      onCreated(result);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to create link');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Create Short Link</h2>
          <p className="text-xs text-slate-500 mt-0.5">Track clicks across outreach and campaigns</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Destination URL *</label>
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://ageddentistry.org/landing-page"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Custom Slug (optional)</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 whitespace-nowrap">links.growthescalators.com/</span>
              <input
                value={slug} onChange={e => setSlug(e.target.value)}
                placeholder="aged-oct-outreach"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tags (comma separated)</label>
            <input
              value={tags} onChange={e => setTags(e.target.value)}
              placeholder="outreach, linkedin, q2"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors">
              {saving ? 'Creating...' : 'Create Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function LinksPage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [statsFor, setStatsFor] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadLinks = useCallback(() => {
    setLoading(true);
    apiFetch('/api/links')
      .then(d => {
        setLinks(d?.links ?? d?.data ?? []);
        setLastUpdated(new Date());
      })
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const filtered = (links ?? []).filter(l =>
    !search || l.shortCode?.toLowerCase().includes(search.toLowerCase()) ||
    l.longUrl?.toLowerCase().includes(search.toLowerCase()) ||
    l.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  function handleCreated(newLink) {
    loadLinks();
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">

        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md">
                <Link className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Link Shortener</h1>
                <p className="text-xs text-slate-500">Track clicks across outreach and campaigns</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-400 hidden sm:inline">
                  Updated {timeAgo(lastUpdated)}
                </span>
              )}
              <button onClick={loadLinks} disabled={loading}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 disabled:opacity-50 transition-colors">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors">
                <Plus className="w-4 h-4" /> Create Link
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="mt-3 relative max-w-sm">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search links, URLs, tags..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-white rounded-xl border border-slate-200 animate-pulse"/>)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Link className="w-7 h-7 text-sky-400" />
              </div>
              <p className="text-slate-600 font-medium mb-1">
                {search ? 'No links match your search' : 'No short links yet'}
              </p>
              <p className="text-slate-400 text-sm mb-6">
                {search ? 'Try a different search term' : 'Create your first tracked link for outreach or campaigns'}
              </p>
              {!search && (
                <button onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 transition-colors">
                  <Plus className="w-4 h-4" /> Create First Link
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <span className="text-xs text-slate-500">{filtered.length} link{filtered.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {filtered.map((link, i) => {
                  const shortUrl = `${link.domain ?? 'links.growthescalators.com'}/${link.shortCode}`;
                  const clicks = link.visitsSummary?.total ?? link.visits ?? 0;
                  return (
                    <div key={link.shortCode ?? i} className="px-4 py-3.5 flex items-center gap-4 hover:bg-slate-50 transition-colors">
                      {/* Icon */}
                      <div className="w-8 h-8 bg-sky-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Globe className="w-4 h-4 text-sky-500" />
                      </div>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <a href={`https://${shortUrl}`} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-semibold text-sky-600 hover:underline">
                            {shortUrl}
                          </a>
                          <CopyBtn text={`https://${shortUrl}`} small />
                        </div>
                        <p className="text-xs text-slate-500 truncate">{link.longUrl}</p>
                        {link.tags?.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {link.tags.map(t => (
                              <span key={t} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Clicks */}
                      <div className="text-center flex-shrink-0 hidden sm:block">
                        <div className="flex items-center gap-1 text-slate-700">
                          <MousePointer className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-semibold text-sm">{clicks}</span>
                        </div>
                        <p className="text-[10px] text-slate-400">clicks</p>
                      </div>

                      {/* Date */}
                      <div className="text-right flex-shrink-0 hidden md:block">
                        <p className="text-xs text-slate-400">{fmtDate(link.dateCreated)}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => setStatsFor(link)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors">
                          <BarChart2 className="w-3 h-3" /> Stats
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {showCreate && <CreatePanel onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      {statsFor && <StatsModal link={statsFor} onClose={() => setStatsFor(null)} />}
    </div>
  );
}
