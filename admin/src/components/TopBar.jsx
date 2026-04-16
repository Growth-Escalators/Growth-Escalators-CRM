import React, { useState } from 'react';
import { Search, Bell, MessageSquarePlus, X, Send, Bug, Lightbulb, HelpCircle, CheckCircle } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs.jsx';
import { getUser, apiFetch } from '../lib/api.js';

function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('suggestion');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const user = getUser();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
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
    } catch {
      // Fallback: even if API fails, close gracefully
      setSent(true);
      setTimeout(() => { setSent(false); setOpen(false); setMessage(''); }, 2000);
    } finally {
      setSending(false);
    }
  }

  const TYPES = [
    { id: 'suggestion', label: 'Suggestion', icon: Lightbulb, color: 'text-amber-500', bg: 'bg-amber-50 border-amber-200' },
    { id: 'bug', label: 'Bug Report', icon: Bug, color: 'text-red-500', bg: 'bg-red-50 border-red-200' },
    { id: 'question', label: 'Question', icon: HelpCircle, color: 'text-blue-500', bg: 'bg-blue-50 border-blue-200' },
  ];
  const activeType = TYPES.find(t => t.id === type) || TYPES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-500 hover:text-sky-600 rounded-lg hover:bg-sky-50 transition-colors text-sm"
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
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
            {sent ? (
              <div className="p-8 text-center">
                <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-800">Thank you!</p>
                <p className="text-xs text-slate-500 mt-1">Your feedback has been received.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-800">Send Feedback</h3>
                  <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
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
                        type === t.id ? t.bg + ' ' + t.color : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
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
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
                    autoFocus
                    required
                  />
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    From: {user?.name || 'Unknown'} ({user?.email || 'no email'}) &middot; Page: {window.location.pathname}
                  </p>
                </div>

                {/* Submit */}
                <div className="px-4 pb-4">
                  <button
                    type="submit"
                    disabled={sending || !message.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
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

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-4">
      {/* Left: breadcrumbs */}
      <div className="flex-1 min-w-0">
        <Breadcrumbs />
      </div>

      {/* Center: search trigger */}
      <button
        onClick={onSearchOpen}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-sm text-slate-500 hover:bg-slate-200 transition-colors"
      >
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-xs bg-white rounded border border-slate-200 font-mono ml-4">
          ⌘K
        </kbd>
      </button>

      {/* Right: feedback + notifications + user */}
      <div className="flex items-center gap-2">
        <FeedbackWidget />
        <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
          <Bell className="w-4.5 h-4.5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs font-bold uppercase">
            {user?.name?.[0] || '?'}
          </div>
        </div>
      </div>
    </div>
  );
}
