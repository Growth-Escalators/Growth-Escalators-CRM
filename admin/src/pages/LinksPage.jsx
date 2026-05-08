import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Link, Copy, ExternalLink, RefreshCw, Search, Globe, Check, FileCode,
} from 'lucide-react';

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
// Main page — read-only viewer of src/config/shortLinks.ts
// ---------------------------------------------------------------------------
export default function LinksPage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadLinks = useCallback(() => {
    setLoading(true);
    apiFetch('/api/links')
      .then(d => {
        setLinks(d?.links ?? []);
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
                <h1 className="text-lg font-bold text-slate-900">Short Links</h1>
                <p className="text-xs text-slate-500">Static config — edit src/config/shortLinks.ts to add or change</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-400 hidden sm:inline">
                  Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button onClick={loadLinks} disabled={loading}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 disabled:opacity-50 transition-colors">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Info banner */}
          <div className="mt-3 flex items-start gap-2 p-3 bg-sky-50 border border-sky-100 rounded-lg text-xs text-sky-800">
            <FileCode className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Static config — adding a new short link is a code change.</p>
              <p>
                Edit <code className="bg-white px-1 rounded text-sky-900">src/config/shortLinks.ts</code>, append a row, commit + push.
                Railway redeploys automatically. No more shlink — saves ~2 GB RAM.
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="mt-3 relative max-w-sm">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search slugs, URLs, tags..."
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
                {search ? 'No links match your search' : 'No short links configured yet'}
              </p>
              <p className="text-slate-400 text-sm">
                {search ? 'Try a different search term' : 'Add entries to src/config/shortLinks.ts and redeploy.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <span className="text-xs text-slate-500">{filtered.length} link{filtered.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {filtered.map((link, i) => {
                  const shortUrl = `${link.domain ?? 'links.growthescalators.com'}/${link.shortCode}`;
                  return (
                    <div key={link.shortCode ?? i} className="px-4 py-3.5 flex items-center gap-4 hover:bg-slate-50 transition-colors">
                      <div className="w-8 h-8 bg-sky-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Globe className="w-4 h-4 text-sky-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <a href={`https://${shortUrl}`} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-semibold text-sky-600 hover:underline">
                            {shortUrl}
                          </a>
                          <CopyBtn text={`https://${shortUrl}`} small />
                        </div>
                        <p className="text-xs text-slate-500 truncate">{link.longUrl}</p>
                        {link.title && <p className="text-[11px] text-slate-400 mt-0.5">{link.title}</p>}
                        {link.tags?.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {link.tags.map(t => (
                              <span key={t} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded-full">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <a href={link.longUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors flex-shrink-0">
                        <ExternalLink className="w-3 h-3" /> Open
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
