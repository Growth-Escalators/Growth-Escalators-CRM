import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import { Share2, Globe, Camera, Plus, Trash2, AlertCircle, Image, Film, Search, ExternalLink } from 'lucide-react';

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function PlatformIcon({ platform, size = 'w-4 h-4' }) {
  if (platform === 'facebook') return (
    <svg className={size} viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
  if (platform === 'instagram') return (
    <svg className={size} viewBox="0 0 24 24">
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497"/>
          <stop offset="5%" stopColor="#fdf497"/>
          <stop offset="45%" stopColor="#fd5949"/>
          <stop offset="60%" stopColor="#d6249f"/>
          <stop offset="90%" stopColor="#285AEB"/>
        </radialGradient>
      </defs>
      <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  );
  return <Share2 className={`${size} text-slate-400`} />;
}

function StatusBadge({ status }) {
  const map = {
    published: { color: 'bg-green-100 text-green-700', label: 'Published' },
    scheduled: { color: 'bg-sky-100 text-sky-700', label: 'Scheduled' },
    failed: { color: 'bg-red-100 text-red-700', label: 'Failed' },
    draft: { color: 'bg-slate-100 text-slate-500', label: 'Draft' },
  };
  const s = map[status] || map.draft;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>;
}

function ConnectModal({ onClose, onSave }) {
  const [pageId, setPageId] = useState('');
  const [pageName, setPageName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!pageId || !pageName || !accessToken) { setError('All fields required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ pageId, pageName, accessToken });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-1">Connect Facebook Page</h2>
        <p className="text-sm text-slate-500 mb-5">Enter your Facebook Page details. Instagram will be auto-linked if connected.</p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5 text-xs text-amber-800">
          <strong>How to get Page Access Token:</strong><br />
          Go to <em>graph.facebook.com/explorer</em> → select your page → copy the Page Access Token with <em>pages_manage_posts</em> permission.
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Page ID</label>
            <input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="e.g. 123456789"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Page Name</label>
            <input value={pageName} onChange={e => setPageName(e.target.value)} placeholder="e.g. Growth Escalators"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Page Access Token</label>
            <textarea value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="EAA..."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono text-xs" />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Connecting…' : 'Connect Page'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Compose tab
function ComposeTab({ accounts, onPost }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [content, setContent] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const activeAccounts = accounts.filter(a => a.isActive);
  const MAX_FB = 63206;
  const MAX_IG = 2200;
  const hasIG = selectedIds.some(id => accounts.find(a => a.id === id)?.platform === 'instagram');
  const charLimit = hasIG ? MAX_IG : MAX_FB;

  function toggleAccount(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handlePost() {
    if (!selectedIds.length) { setError('Select at least one account'); return; }
    if (!content.trim()) { setError('Add some content'); return; }
    setPosting(true);
    setError('');
    try {
      await apiFetch('/api/social/posts', {
        method: 'POST',
        body: JSON.stringify({
          socialAccountIds: selectedIds,
          content,
          scheduledAt: schedule && scheduledAt ? scheduledAt : null,
        }),
      });
      setDone(true);
      setContent('');
      setSelectedIds([]);
      setSchedule(false);
      setScheduledAt('');
      onPost();
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex gap-6">
      {/* Left: composer */}
      <div className="flex-1 space-y-4">
        {/* Account chips */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Post To</p>
          {activeAccounts.length === 0 && (
            <p className="text-sm text-slate-400">Connect your pages first in the Accounts tab.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {activeAccounts.map(acct => {
              const selected = selectedIds.includes(acct.id);
              const isFB = acct.platform === 'facebook';
              return (
                <button
                  key={acct.id}
                  onClick={() => toggleAccount(acct.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    selected
                      ? isFB
                        ? 'bg-[#1877F2] border-[#1877F2] text-white'
                        : 'border-pink-500 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  <PlatformIcon platform={acct.platform} size="w-3.5 h-3.5" />
                  {acct.accountName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Caption</p>
            <span className={`text-xs ${content.length > charLimit ? 'text-red-500' : 'text-slate-400'}`}>
              {content.length}/{charLimit}
            </span>
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="What would you like to share?"
            rows={6}
            className="w-full border-0 resize-none focus:outline-none text-sm text-slate-800 placeholder-slate-400"
          />
        </div>

        {/* Schedule */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={schedule} onChange={e => setSchedule(e.target.checked)} className="rounded" />
              <span className="text-sm text-slate-700 font-medium">Schedule for later</span>
            </label>
            {schedule && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {done && <p className="text-sm text-green-600">Post submitted!</p>}

        <button
          onClick={handlePost}
          disabled={posting}
          className="w-full py-2.5 bg-sky-600 text-white rounded-xl text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
        >
          {posting ? 'Posting…' : schedule ? 'Schedule Post' : 'Post Now'}
        </button>
      </div>

      {/* Right: preview */}
      <div className="w-72 flex-shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Preview</p>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs font-bold">GE</div>
              <div>
                <p className="text-sm font-medium text-slate-800">Growth Escalators</p>
                <p className="text-xs text-slate-400">Just now</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words min-h-12">
              {content || <span className="text-slate-300">Your post content will appear here…</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Calendar tab
function CalendarTab() {
  const [month, setMonth] = useState(() => new Date());
  const [posts, setPosts] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);

  const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2,'0')}`;

  useEffect(() => {
    apiFetch(`/api/social/calendar?month=${monthStr}`)
      .then(d => setPosts(d?.posts || []))
      .catch(() => {});
  }, [monthStr]);

  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const startPad = firstDay.getDay();

  function postsByDay(day) {
    return posts.filter(p => {
      const d = new Date(p.createdAt);
      return d.getDate() === day && d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
    });
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Month nav */}
      <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
        <button onClick={() => { const d = new Date(month); d.setMonth(d.getMonth()-1); setMonth(d); }}
          className="p-1 hover:bg-slate-100 rounded text-slate-600">&lt;</button>
        <p className="font-semibold text-slate-800">{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
        <button onClick={() => { const d = new Date(month); d.setMonth(d.getMonth()+1); setMonth(d); }}
          className="p-1 hover:bg-slate-100 rounded text-slate-600">&gt;</button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAYS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {Array(startPad).fill(null).map((_, i) => <div key={`pad-${i}`} className="h-24 border-r border-b border-slate-50" />)}
        {Array(daysInMonth).fill(null).map((_, i) => {
          const day = i + 1;
          const dayPosts = postsByDay(day);
          const isSelected = selectedDay === day;
          return (
            <div
              key={day}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className={`h-24 border-r border-b border-slate-50 p-1.5 cursor-pointer transition-colors ${isSelected ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
            >
              <p className={`text-xs font-medium mb-1 ${isSelected ? 'text-sky-600' : 'text-slate-600'}`}>{day}</p>
              <div className="space-y-0.5 overflow-hidden">
                {dayPosts.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center gap-1">
                    <PlatformIcon platform={p.platform} size="w-3 h-3" />
                    <span className="text-xs text-slate-500 truncate">{(p.content || '').slice(0, 20)}</span>
                  </div>
                ))}
                {dayPosts.length > 3 && <p className="text-xs text-slate-400">+{dayPosts.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day detail */}
      {selectedDay && postsByDay(selectedDay).length > 0 && (
        <div className="border-t border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">{selectedDay} {month.toLocaleDateString('en-IN', { month: 'long' })}</p>
          <div className="space-y-2">
            {postsByDay(selectedDay).map(p => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <PlatformIcon platform={p.platform} size="w-4 h-4" />
                <p className="text-sm text-slate-700 flex-1 truncate">{p.content}</p>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Library tab
function LibraryTab({ onUseInPost }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('type', filter);
    if (search) params.set('search', search);
    apiFetch(`/api/social/library?${params.toString()}`)
      .then(d => setFiles(d?.files || []))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [filter, search]);

  async function handleDelete(key) {
    if (!confirm('Delete this file permanently?')) return;
    try {
      await apiFetch(`/api/social/library/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setFiles(prev => prev.filter(f => f.key !== key));
    } catch {}
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex bg-slate-100 rounded-lg p-1">
          {[['all','All'],['images','Images'],['videos','Videos']].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium ${filter === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-32 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && files.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Image className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No media uploaded yet.</p>
          <p className="text-slate-400 text-xs mt-1">Upload images and videos from the Compose tab.</p>
        </div>
      )}

      {!loading && files.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {files.map(f => (
            <div key={f.key} className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
              {f.mimeType.startsWith('image/') ? (
                <img src={f.url} alt={f.key} className="w-full h-28 object-cover" />
              ) : (
                <div className="w-full h-28 bg-slate-100 flex items-center justify-center">
                  <Film className="w-8 h-8 text-slate-400" />
                </div>
              )}
              <div className="p-2">
                <p className="text-xs text-slate-700 truncate">{f.key.split('/').pop()}</p>
                <p className="text-xs text-slate-400">{formatSize(f.size)}</p>
              </div>
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onClick={() => onUseInPost(f.url)} className="px-2 py-1 bg-sky-600 text-white rounded text-xs font-medium">Use</button>
                <button onClick={() => handleDelete(f.key)} className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Accounts tab
function AccountsTab({ accounts, onDelete, onAdd }) {
  const [showManual, setShowManual] = useState(false);
  const [manualPageId, setManualPageId] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');

  async function handleManualConnect(e) {
    e.preventDefault();
    if (!manualPageId || !manualToken || !manualName) { setManualError('All fields required'); return; }
    setManualSaving(true);
    setManualError('');
    try {
      await apiFetch('/api/social/accounts/connect-facebook', {
        method: 'POST',
        body: JSON.stringify({ pageId: manualPageId, pageName: manualName, accessToken: manualToken }),
      });
      onAdd();
      setShowManual(false);
      setManualPageId(''); setManualToken(''); setManualName('');
    } catch (err) {
      setManualError(err.message || 'Failed');
    } finally { setManualSaving(false); }
  }

  return (
    <div className="space-y-6">
      {/* Connect with Facebook — primary action */}
      {accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#1877F2' }}>
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white fill-current"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Connect Your Facebook Pages</h3>
          <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">Link your Facebook Pages and Instagram accounts to post directly from the CRM.</p>
          <button
            onClick={() => { const t = localStorage.getItem('ge_crm_token'); window.location.href = `/api/social/oauth/facebook/start?token=${t}`; }}
            className="inline-flex items-center gap-2 px-6 py-3 text-white font-semibold rounded-xl text-sm hover:opacity-90 transition-opacity cursor-pointer" style={{ backgroundColor: '#1877F2' }}>
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg>
            Connect with Facebook
          </button>
          <div className="mt-4">
            <button onClick={() => setShowManual(s => !s)} className="text-xs text-slate-400 hover:text-slate-600 underline">
              Add page manually instead
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">{accounts.length} account{accounts.length !== 1 ? 's' : ''} connected</p>
          <div className="flex gap-2">
            <button
              onClick={() => { const t = localStorage.getItem('ge_crm_token'); window.location.href = `/api/social/oauth/facebook/start?token=${t}`; }}
              className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm hover:opacity-90 transition-opacity cursor-pointer" style={{ backgroundColor: '#1877F2' }}>
              <Plus className="w-4 h-4" />
              Connect More Pages
            </button>
            <button onClick={() => setShowManual(s => !s)} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-2">
              Manual
            </button>
          </div>
        </div>
      )}

      {/* Manual connect form (collapsed by default) */}
      {showManual && (
        <form onSubmit={handleManualConnect} className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-xs text-slate-500 font-medium">Manual Page Connection (fallback)</p>
          <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Page Name"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <input value={manualPageId} onChange={e => setManualPageId(e.target.value)} placeholder="Page ID (e.g. 123456789)"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
          <textarea value={manualToken} onChange={e => setManualToken(e.target.value)} placeholder="Page Access Token" rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
          {manualError && <p className="text-xs text-red-500">{manualError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={manualSaving} className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm disabled:opacity-50">
              {manualSaving ? 'Connecting…' : 'Connect Page'}
            </button>
            <button type="button" onClick={() => setShowManual(false)} className="px-4 py-2 text-slate-500 text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Count summary */}
      {accounts.length > 0 && (() => {
        const fbAccts = accounts.filter(a => a.platform === 'facebook');
        const igAccts = accounts.filter(a => a.platform === 'instagram');
        return (
          <p className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">{accounts.length} accounts connected</span>
            {' '}({fbAccts.length} Facebook{igAccts.length > 0 ? `, ${igAccts.length} Instagram` : ''})
          </p>
        );
      })()}

      {/* Connected accounts list — FB pages first, then Instagram */}
      <div className="space-y-2">
        {[...accounts].sort((a, b) => {
          if (a.platform === b.platform) return (a.accountName || '').localeCompare(b.accountName || '');
          return a.platform === 'facebook' ? -1 : 1;
        }).map(acct => {
          const isFB = acct.platform === 'facebook';
          const isIG = acct.platform === 'instagram';
          return (
            <div
              key={acct.id}
              className={`bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 ${isIG ? 'ml-6 border-l-4 border-l-pink-200' : ''}`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                isFB ? 'bg-[#e7f0fd]' : 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400'
              }`}>
                <PlatformIcon platform={acct.platform} size={isFB ? 'w-6 h-6' : 'w-5 h-5'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{acct.accountName}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isFB ? 'Facebook Page' : 'Instagram Business'}
                  {' · Connected '}
                  {acct.createdAt ? new Date(acct.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </p>
              </div>
              <button
                onClick={() => { if (confirm(`Disconnect ${acct.accountName}?`)) onDelete(acct.id); }}
                className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
              >
                Disconnect
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
        <strong>Where's Instagram?</strong> Instagram accounts appear automatically when linked to a connected Facebook Page.
        To link: Go to your Facebook Page → Settings → Linked Accounts → Instagram.
        Your Instagram must be a Business or Creator account.
      </p>
    </div>
  );
}

export default function SocialPage() {
  const [tab, setTab] = useState('compose');
  const [accounts, setAccounts] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    apiFetch('/api/social/accounts')
      .then(d => setAccounts(d?.accounts || []))
      .catch(() => {});
  }, [refreshKey]);

  async function deleteAccount(id) {
    try {
      await apiFetch(`/api/social/accounts/${id}`, { method: 'DELETE' });
      setRefreshKey(k => k + 1);
    } catch {}
  }

  const TABS = [
    { id: 'compose', label: 'Compose' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'library', label: 'Library' },
    { id: 'accounts', label: 'Accounts' },
  ];

  const [toast, setToast] = useState(null);

  // Check for OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      const pages = params.get('pages') || '0';
      const instagram = params.get('instagram') || '0';
      const igPart = parseInt(instagram) > 0 ? ` and ${instagram} Instagram account(s)` : '';
      setToast({ type: 'success', msg: `${pages} Facebook page(s)${igPart} connected successfully!` });
      setTab('accounts');
      setRefreshKey(k => k + 1);
      window.history.replaceState({}, '', '/social');
    } else if (params.get('error')) {
      setToast({ type: 'error', msg: 'Connection failed. Please try again or add pages manually.' });
      setTab('accounts');
      window.history.replaceState({}, '', '/social');
    }
  }, []);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
          <Share2 className="w-5 h-5 text-sky-600" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Social Media</h1>
            <p className="text-xs text-slate-500">Post to Facebook & Instagram</p>
          </div>
          {/* Tabs */}
          <div className="ml-auto flex bg-slate-100 rounded-lg p-1">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {toast && (
            <div className={`mb-4 flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
              toast.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <span className="flex-1">{toast.msg}</span>
              <button onClick={() => setToast(null)} className="text-lg leading-none opacity-50 hover:opacity-100">&times;</button>
            </div>
          )}
          {tab === 'compose' && <ComposeTab accounts={accounts} onPost={() => setRefreshKey(k => k+1)} />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'library' && <LibraryTab onUseInPost={(url) => { setTab('compose'); /* media URL will be passed via state */ }} />}
          {tab === 'accounts' && <AccountsTab accounts={accounts} onDelete={deleteAccount} onAdd={() => setRefreshKey(k => k+1)} />}
        </div>
      </main>
    </div>
  );
}
