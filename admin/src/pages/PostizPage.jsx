import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import { Calendar, Send, ExternalLink, AlertCircle, Loader2 } from 'lucide-react';

const POSTIZ_FRONTEND_URL = 'https://postiz-frontend-production-2e4c.up.railway.app';

function SetupBanner({ message }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
      <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h3 className="text-base font-semibold text-amber-900 mb-1">Postiz not configured</h3>
        <p className="text-sm text-amber-800 mb-3">
          {message || 'Postiz API key is missing. Generate one in your Postiz instance to enable scheduling from the CRM.'}
        </p>
        <a
          href={POSTIZ_FRONTEND_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors"
        >
          Open Postiz <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

function ScheduleForm({ integrations, onScheduled }) {
  const [integrationId, setIntegrationId] = useState(integrations[0]?.id || '');
  const [content, setContent] = useState('');
  const [publishAt, setPublishAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!integrationId || !content.trim() || !publishAt) {
      setError('All fields are required');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const isoPublish = new Date(publishAt).toISOString();
      await apiFetch('/api/postiz/schedule', {
        method: 'POST',
        body: JSON.stringify({ integrationId, content, publishAt: isoPublish }),
      });
      setSuccess('Post scheduled.');
      setContent('');
      setPublishAt('');
      onScheduled();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to schedule');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <Send className="w-4 h-4 text-sky-600" /> Schedule a post
      </h3>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Channel</label>
        <select
          value={integrationId}
          onChange={e => setIntegrationId(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {integrations.map(i => (
            <option key={i.id} value={i.id}>{i.name} ({i.type})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Content</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={5}
          placeholder="What would you like to post?"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Publish at</label>
        <input
          type="datetime-local"
          value={publishAt}
          onChange={e => setPublishAt(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2.5 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
      >
        {submitting ? 'Scheduling…' : 'Schedule Post'}
      </button>
    </form>
  );
}

function ScheduledList({ posts }) {
  if (!posts.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No scheduled posts yet.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Scheduled & Recent Posts</p>
      </div>
      <div className="divide-y divide-slate-100">
        {posts.map(p => (
          <div key={p.id} className="px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700 truncate">{p.content}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {p.integration?.name ? `${p.integration.name} · ` : ''}
                {p.publishAt ? new Date(p.publishAt).toLocaleString('en-IN') : ''}
              </p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              p.status === 'PUBLISHED' ? 'bg-green-100 text-green-700'
                : p.status === 'SCHEDULED' ? 'bg-sky-100 text-sky-700'
                : p.status === 'ERROR' ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-500'
            }`}>{p.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PostizPage() {
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [integrations, setIntegrations] = useState([]);
  const [posts, setPosts] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setSetupError('');
      try {
        const intResp = await apiFetch('/api/postiz/integrations');
        if (cancelled) return;
        setIntegrations(intResp?.integrations || []);
        const postsResp = await apiFetch('/api/postiz/scheduled');
        if (cancelled) return;
        setPosts(postsResp?.posts || []);
      } catch (e) {
        if (cancelled) return;
        const msg = e?.message || '';
        if (msg.includes('POSTIZ_NOT_CONFIGURED') || msg.includes('503')) {
          setSetupError(msg.replace(/^.*POSTIZ_NOT_CONFIGURED[:\s-]*/i, '') || 'Postiz API key not set.');
        } else {
          setSetupError(msg || 'Failed to reach Postiz');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4">
          <Send className="w-5 h-5 text-sky-600" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Social (Postiz)</h1>
            <p className="text-xs text-slate-500">Schedule posts across connected channels</p>
          </div>
          <a
            href={POSTIZ_FRONTEND_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-sky-600"
          >
            Open Postiz dashboard <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="p-6 space-y-6 max-w-5xl">
          {loading && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          )}

          {!loading && setupError && <SetupBanner message={setupError} />}

          {!loading && !setupError && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ScheduleForm integrations={integrations} onScheduled={() => setRefreshKey(k => k + 1)} />
              <ScheduledList posts={posts} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
