import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Calendar, Plus, RefreshCw, AlertCircle, CheckCircle, Clock, XCircle,
  Send, ChevronDown, ChevronLeft, ChevronRight, Settings, Trash2, Image
} from 'lucide-react';

const STATUS_META = {
  published:  { color: 'bg-green-100 text-green-700', label: 'Published', icon: CheckCircle },
  publishing: { color: 'bg-sky-100 text-sky-700',     label: 'Publishing', icon: Clock },
  scheduled:  { color: 'bg-sky-100 text-sky-700',     label: 'Scheduled', icon: Clock },
  failed:     { color: 'bg-red-100 text-red-700',     label: 'Failed',    icon: XCircle },
  draft:      { color: 'bg-slate-100 text-slate-500', label: 'Draft',     icon: Clock },
};

const PLATFORM_COLORS = {
  facebook:  { label: 'Facebook',  color: 'text-blue-600',  bg: 'bg-blue-50',  dot: 'bg-blue-500' },
  instagram: { label: 'Instagram', color: 'text-pink-600',  bg: 'bg-pink-50',  dot: 'bg-pink-500' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function PlatformBadge({ platform }) {
  const p = PLATFORM_COLORS[platform] ?? { label: platform, color: 'text-slate-600', bg: 'bg-slate-50' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${p.bg} ${p.color}`}>{p.label}</span>;
}

function StatusBadge({ status }) {
  const s = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = s.icon;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.color}`}><Icon className="w-3 h-3" /> {s.label}</span>;
}

// Calendar month view
function CalendarView({ posts, month, onMonthChange }) {
  const [year, mon] = month.split('-').map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const lastDay = new Date(year, mon, 0);
  const startDow = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const dayPosts = {};
  (posts || []).forEach(p => {
    const d = p.scheduledAt || p.createdAt;
    if (!d) return;
    const key = new Date(d).toISOString().slice(0, 10);
    if (!dayPosts[key]) dayPosts[key] = [];
    dayPosts[key].push(p);
  });

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  function prevMonth() {
    const prev = new Date(year, mon - 2, 1);
    onMonthChange(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  }
  function nextMonth() {
    const next = new Date(year, mon, 1);
    onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }

  const monthLabel = firstDay.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <button onClick={prevMonth} className="p-1 hover:bg-slate-100 rounded"><ChevronLeft className="w-4 h-4 text-slate-500" /></button>
        <h3 className="text-sm font-bold text-slate-800">{monthLabel}</h3>
        <button onClick={nextMonth} className="p-1 hover:bg-slate-100 rounded"><ChevronRight className="w-4 h-4 text-slate-500" /></button>
      </div>
      <div className="grid grid-cols-7">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="px-1 py-2 text-center text-[10px] font-semibold text-slate-400 uppercase border-b border-slate-100">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} className="min-h-[80px] border-b border-r border-slate-50 bg-slate-50/50" />;
          const dateKey = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dp = dayPosts[dateKey] || [];
          const isToday = dateKey === todayStr;
          return (
            <div key={dateKey} className={`min-h-[80px] border-b border-r border-slate-50 p-1 ${isToday ? 'bg-sky-50' : ''}`}>
              <div className={`text-xs font-medium mb-0.5 ${isToday ? 'text-sky-600 font-bold' : 'text-slate-500'}`}>{day}</div>
              {dp.slice(0, 3).map((p, j) => {
                const plat = PLATFORM_COLORS[p.platform] ?? PLATFORM_COLORS.facebook;
                return (
                  <div key={j} className={`text-[10px] px-1 py-0.5 rounded mb-0.5 truncate ${plat.bg} ${plat.color}`} title={p.content}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${plat.dot} mr-1`} />
                    {fmtTime(p.scheduledAt || p.createdAt)}
                  </div>
                );
              })}
              {dp.length > 3 && <p className="text-[9px] text-slate-400 pl-1">+{dp.length - 3} more</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Compose form
function ComposeForm({ accounts, onCreated }) {
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [content, setContent] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setScheduledAt(local.toISOString().slice(0, 16));
  }, []);

  function toggleAccount(id) {
    setSelectedAccounts(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (selectedAccounts.length === 0 || !content.trim()) { setError('Select accounts and write content'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch('/api/social/posts', {
        method: 'POST',
        body: JSON.stringify({
          socialAccountIds: selectedAccounts,
          content: content.trim(),
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          mediaUrls: [],
        }),
      });
      setSuccess(true);
      setContent('');
      setSelectedAccounts([]);
      setTimeout(() => { setSuccess(false); onCreated(); }, 2000);
    } catch (e) {
      setError(e.message || 'Failed to schedule');
    } finally { setSaving(false); }
  }

  const isPublishNow = !scheduledAt || new Date(scheduledAt) <= new Date();

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
        <Send className="w-4 h-4 text-sky-500" /> {isPublishNow ? 'Publish Now' : 'Schedule Post'}
      </h2>
      {success ? (
        <div className="py-6 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-emerald-700">{isPublishNow ? 'Published!' : 'Scheduled!'}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Account selector — checkboxes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Post to</label>
            {accounts.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                No social accounts connected. <a href="/social" className="text-sky-600 underline">Connect accounts →</a>
              </div>
            ) : (
              <div className="space-y-1.5">
                {accounts.map(a => {
                  const plat = PLATFORM_COLORS[a.platform] ?? PLATFORM_COLORS.facebook;
                  const checked = selectedAccounts.includes(a.id);
                  return (
                    <label key={a.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-sky-300 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAccount(a.id)} className="rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                      {a.thumbnailUrl ? (
                        <img src={a.thumbnailUrl} className="w-6 h-6 rounded-full" alt="" />
                      ) : (
                        <div className={`w-6 h-6 rounded-full ${plat.bg} flex items-center justify-center`}>
                          <span className={`text-[10px] font-bold ${plat.color}`}>{a.platform[0].toUpperCase()}</span>
                        </div>
                      )}
                      <span className="text-sm text-slate-700 flex-1 truncate">{a.accountName}</span>
                      <PlatformBadge platform={a.platform} />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Content</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={4}
              placeholder="Write your post..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
            <p className="text-right text-xs text-slate-400 mt-0.5">{content.length} chars</p>
          </div>

          {/* Schedule time */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">When</label>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <p className="text-xs text-slate-400 mt-0.5">{isPublishNow ? 'Will publish immediately' : `Scheduled for ${fmtDate(scheduledAt)} at ${fmtTime(scheduledAt)}`}</p>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={saving || accounts.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {saving ? 'Posting...' : isPublishNow ? 'Publish Now' : 'Schedule'}
          </button>
        </form>
      )}
    </div>
  );
}

// Posts list
function PostsList({ posts, loading, onCancel }) {
  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-white rounded-xl border border-slate-200 animate-pulse" />)}</div>;
  if (!posts.length) return (
    <div className="py-12 text-center bg-white rounded-xl border border-slate-200">
      <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500 font-medium">No posts yet</p>
      <p className="text-slate-400 text-sm mt-1">Create your first post using the form</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {posts.map(p => (
        <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800 line-clamp-2">{p.content}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <PlatformBadge platform={p.platform} />
                <StatusBadge status={p.status} />
                {p.scheduledAt && <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(p.scheduledAt)} {fmtTime(p.scheduledAt)}</span>}
                {p.errorMessage && <span className="text-xs text-red-500">{p.errorMessage}</span>}
              </div>
            </div>
            {p.status === 'scheduled' && (
              <button onClick={() => onCancel(p.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Cancel">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Main page
export default function SocialSchedulingPage() {
  const [posts, setPosts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [calendarPosts, setCalendarPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeTab, setActiveTab] = useState('calendar');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [postsRes, accountsRes, calRes] = await Promise.all([
      apiFetch('/api/social/posts').catch(() => ({ posts: [] })),
      apiFetch('/api/social/accounts').catch(() => ({ accounts: [] })),
      apiFetch(`/api/social/calendar?month=${month}`).catch(() => ({ posts: [] })),
    ]);
    setPosts(postsRes?.posts ?? []);
    setAccounts((accountsRes?.accounts ?? []).filter(a => a.isActive !== false));
    setCalendarPosts(calRes?.posts ?? []);
    setLoading(false);
  }, [month]);

  useEffect(() => { loadData(); }, [loadData]);

  async function cancelPost(id) {
    await apiFetch(`/api/social/posts/${id}`, { method: 'DELETE' });
    loadData();
  }

  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  const publishedCount = posts.filter(p => p.status === 'published').length;
  const failedCount = posts.filter(p => p.status === 'failed').length;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center shadow-md">
                <Calendar className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Social Scheduling</h1>
                <p className="text-xs text-slate-500">Schedule and publish to Facebook & Instagram</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {/* Stats */}
              <div className="hidden sm:flex items-center gap-2 text-xs">
                <span className="bg-sky-50 text-sky-700 px-2 py-1 rounded-full font-medium">{scheduledCount} scheduled</span>
                <span className="bg-green-50 text-green-700 px-2 py-1 rounded-full font-medium">{publishedCount} published</span>
                {failedCount > 0 && <span className="bg-red-50 text-red-700 px-2 py-1 rounded-full font-medium">{failedCount} failed</span>}
              </div>
              <button onClick={loadData} disabled={loading}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <a href="/social"
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                <Settings className="w-3.5 h-3.5" /> Accounts
              </a>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {[
              { id: 'calendar', label: 'Calendar', icon: Calendar },
              { id: 'list', label: 'All Posts', icon: Send },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.id ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* No accounts banner */}
          {!loading && accounts.length === 0 && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">No social accounts connected</p>
                <p className="text-xs text-amber-700 mt-0.5">Connect your Facebook or Instagram accounts to start scheduling posts.</p>
              </div>
              <a href="/social" className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 flex-shrink-0">
                Connect Accounts
              </a>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left — Calendar or List */}
            <div className="lg:col-span-2">
              {activeTab === 'calendar' && (
                <CalendarView posts={calendarPosts} month={month} onMonthChange={setMonth} />
              )}
              {activeTab === 'list' && (
                <>
                  <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Send className="w-4 h-4 text-sky-500" />
                    All Posts
                    {posts.length > 0 && <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">{posts.length}</span>}
                  </h2>
                  <PostsList posts={posts} loading={loading} onCancel={cancelPost} />
                </>
              )}
            </div>

            {/* Right — Compose */}
            <div>
              <ComposeForm accounts={accounts} onCreated={loadData} />

              {/* Connected accounts */}
              {accounts.length > 0 && (
                <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="text-xs font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5" /> Connected ({accounts.length})
                  </h3>
                  <div className="space-y-2">
                    {accounts.map(a => {
                      const plat = PLATFORM_COLORS[a.platform] ?? PLATFORM_COLORS.facebook;
                      return (
                        <div key={a.id} className="flex items-center gap-2">
                          {a.thumbnailUrl ? (
                            <img src={a.thumbnailUrl} className="w-6 h-6 rounded-full" alt="" />
                          ) : (
                            <div className={`w-6 h-6 rounded-full ${plat.bg} flex items-center justify-center`}>
                              <span className={`text-[10px] font-bold ${plat.color}`}>{a.platform[0].toUpperCase()}</span>
                            </div>
                          )}
                          <p className="text-xs text-slate-700 truncate flex-1">{a.accountName}</p>
                          <PlatformBadge platform={a.platform} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
