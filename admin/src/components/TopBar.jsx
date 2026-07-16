import React, { useState } from 'react';
import { Search, Bell, MessageSquarePlus, X, Send, Bug, Lightbulb, HelpCircle, CheckCircle } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs.jsx';
import { getUser, apiFetch } from '../lib/api.js';
import { getTenantSlug } from '../lib/auth.js';

function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('suggestion');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const user = getUser();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          type,
          message: message.trim(),
          page: window.location.pathname,
          userName: user?.name,
          userEmail: user?.email,
          userRole: user?.role,
        }),
      });
      setSent(true);
      setTimeout(() => { setSent(false); setOpen(false); setMessage(''); setType('suggestion'); }, 2000);
    } catch (submitError) {
      setError(submitError?.message || 'Feedback could not be sent. Your message is still here—please retry.');
    } finally {
      setSending(false);
    }
  }

  const TYPES = [
    { id: 'suggestion', label: 'Suggestion', icon: Lightbulb, color: 'text-warning-600', bg: 'bg-warning-500/10 border-warning-500/20' },
    { id: 'bug', label: 'Bug Report', icon: Bug, color: 'text-danger-600', bg: 'bg-danger-500/10 border-danger-500/20' },
    { id: 'question', label: 'Question', icon: HelpCircle, color: 'text-primary-600', bg: 'bg-primary-500/10 border-primary-500/20' },
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setError(''); }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-neutral-500 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors text-sm"
        title="Send feedback or suggestion"
      >
        <MessageSquarePlus className="w-4 h-4" />
        <span className="hidden lg:inline text-xs font-medium">Feedback</span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Panel */}
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-neutral-200 shadow-modal z-50 overflow-hidden" role="dialog" aria-label="Send feedback">
            {sent ? (
              <div className="p-8 text-center">
                <CheckCircle className="w-10 h-10 text-success-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-neutral-800">Thank you!</p>
                <p className="text-xs text-neutral-500 mt-1">Your feedback has been received.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {/* Header */}
                <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-neutral-800">Send Feedback</h3>
                  <button type="button" aria-label="Close feedback" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Type selector */}
                <div className="px-4 pt-3 flex gap-2">
                  {TYPES.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      type === t.id ? t.bg + ' ' + t.color : 'bg-white border-neutral-200 text-neutral-500 hover:bg-neutral-50'
                    }`}
                    >
                      <t.icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Message */}
                <div className="p-4">
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder={
                      type === 'suggestion' ? "What feature or improvement would help you?" :
                      type === 'bug' ? "Describe what happened and what you expected..." :
                      "What would you like to know?"
                    }
                    rows={4}
                    className="w-full border border-neutral-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"
                    autoFocus
                    required
                  />
                  <p className="text-[10px] text-neutral-400 mt-1.5">
                    From: {user?.name || 'Unknown'} ({user?.email || 'no email'}) &middot; Page: {window.location.pathname}
                  </p>
                  {error && (
                    <div role="alert" className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">
                      {error}
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div className="px-4 pb-4">
                  <button
                    type="submit"
                    disabled={sending || !message.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sending ? 'Sending...' : 'Send Feedback'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function TopBar({ onSearchOpen }) {
  const user = getUser();
  const isWizmatch = String(getTenantSlug()).toLowerCase() === 'wizmatch';

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-neutral-200 pl-14 pr-3 md:px-6 py-2.5 flex items-center gap-3 md:gap-4 shadow-card">
      {/* Left: breadcrumbs */}
      <div className="flex-1 min-w-0">
        <Breadcrumbs />
      </div>

      {/* Center: search trigger */}
      <button
        onClick={onSearchOpen}
        className="hidden sm:flex items-center gap-2 w-[420px] max-w-full px-3 py-1.5 bg-neutral-100 border border-neutral-200 rounded-md text-sm text-neutral-700 hover:bg-neutral-200 transition-colors"
      >
        <Search className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left truncate">{isWizmatch ? 'Search companies, contacts, roles, candidates…' : 'Search contacts and deals…'}</span>
        <span className="inline-flex px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-white rounded border border-neutral-200">Records</span>
      </button>
      <button
        onClick={onSearchOpen}
        className="sm:hidden p-2 text-neutral-500 hover:text-neutral-700 rounded-md hover:bg-neutral-100 transition-colors"
        aria-label="Search records"
      >
        <Search className="w-4 h-4" />
      </button>

      {/* Right: feedback + notifications + user */}
      <div className="flex items-center gap-2">
        <FeedbackWidget />
        <button type="button" aria-label="Notifications" className="w-9 h-9 flex items-center justify-center text-neutral-400 hover:text-neutral-600 rounded-md hover:bg-neutral-100 transition-colors relative">
          <Bell className="w-4.5 h-4.5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-[30px] h-[30px] rounded-full bg-primary-500 flex items-center justify-center text-white text-xs font-bold uppercase">
            {user?.name?.[0] || '?'}
          </div>
        </div>
      </div>
    </div>
  );
}
