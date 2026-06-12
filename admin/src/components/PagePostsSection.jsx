import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { RefreshCw, AlertCircle, FileText, Heart, MessageCircle, Share2 } from 'lucide-react';

function fmtN(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  if (num >= 1000) return `${(num / 1000).toFixed(num >= 10_000 ? 0 : 1)}k`;
  return String(num);
}

function truncate(str, n = 120) {
  if (!str) return '';
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PagePostsSection() {
  const [pages, setPages] = useState([]);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState(null);

  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState(null);

  const loadPages = useCallback(async () => {
    setPagesLoading(true);
    setPagesError(null);
    try {
      const data = await apiFetch('/api/meta/pages');
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      setPages(list);
      if (list.length > 0 && !selectedPageId) {
        setSelectedPageId(list[0].id);
      }
    } catch (err) {
      setPagesError(err?.message || 'Failed to load pages');
    } finally {
      setPagesLoading(false);
    }
  }, [selectedPageId]);

  const loadPosts = useCallback(async (pageId) => {
    if (!pageId) return;
    setPostsLoading(true);
    setPostsError(null);
    try {
      const data = await apiFetch(`/api/meta/pages/${encodeURIComponent(pageId)}/posts`);
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      setPosts(list);
    } catch (err) {
      setPostsError(err?.message || 'Failed to load posts');
      setPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  useEffect(() => {
    if (selectedPageId) loadPosts(selectedPageId);
  }, [selectedPageId, loadPosts]);

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Page Posts</h2>
        </div>
        <button
          onClick={() => selectedPageId && loadPosts(selectedPageId)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
          disabled={postsLoading || !selectedPageId}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${postsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
          Page
        </label>
        {pagesLoading ? (
          <div className="h-9 bg-slate-100 rounded animate-pulse w-64" />
        ) : pagesError ? (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            {pagesError}
          </div>
        ) : pages.length === 0 ? (
          <p className="text-sm text-slate-500">No Pages connected to the system user.</p>
        ) : (
          <select
            value={selectedPageId}
            onChange={(e) => setSelectedPageId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 min-w-[16rem]"
          >
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        )}
      </div>

      {postsError ? (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{postsError}</span>
        </div>
      ) : postsLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-slate-500">No posts found for this Page.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-200">
                <th className="px-3 py-2">Message</th>
                <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1"><Heart className="w-3.5 h-3.5 text-pink-500" /> Reactions</span></th>
                <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5 text-blue-500" /> Comments</span></th>
                <th className="px-3 py-2 text-right"><span className="inline-flex items-center gap-1"><Share2 className="w-3.5 h-3.5 text-green-500" /> Shares</span></th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-800 align-top max-w-md">{truncate(post.message, 140) || <span className="text-slate-400">(no message — image/video only)</span>}</td>
                  <td className="px-3 py-2 text-slate-700 align-top text-right font-medium tabular-nums">{fmtN(post.reactions_count)}</td>
                  <td className="px-3 py-2 text-slate-700 align-top text-right font-medium tabular-nums">{fmtN(post.comments_count)}</td>
                  <td className="px-3 py-2 text-slate-700 align-top text-right font-medium tabular-nums">{fmtN(post.shares_count)}</td>
                  <td className="px-3 py-2 text-slate-500 align-top whitespace-nowrap text-xs">{fmtDate(post.created_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
