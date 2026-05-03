import React, { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import {
  Send, Bot, User, Loader2, CheckCircle2, XCircle,
  Zap, BarChart2, Search, DollarSign, Clock, Cpu
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Markdown-lite renderer (bold, bullet points, inline code)
// ---------------------------------------------------------------------------
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let listItems = [];

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-none space-y-0.5 my-1">
          {listItems.map((item, i) => (
            <li key={i} className="flex gap-1.5 text-sm">
              <span className="text-slate-400 flex-shrink-0 mt-0.5">•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  }

  function renderInline(str) {
    const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="text-xs bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      listItems.push(trimmed.slice(2));
    } else {
      flushList();
      if (trimmed) {
        elements.push(
          <p key={`p-${elements.length}`} className="text-sm leading-relaxed">
            {renderInline(trimmed)}
          </p>
        );
      }
    }
  }
  flushList();
  return elements;
}

// ---------------------------------------------------------------------------
// Typewriter effect hook
// ---------------------------------------------------------------------------
function useTypewriter(text, speed = 12) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed('');
    setDone(false);
    if (!text) { setDone(true); return; }
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return { displayed, done };
}

// ---------------------------------------------------------------------------
// Message bubble components
// ---------------------------------------------------------------------------
function UserBubble({ text }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="flex items-end gap-2 max-w-[82%]">
        <div className="bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">
          {text}
        </div>
        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <User className="w-3.5 h-3.5 text-indigo-600" />
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({ text, isLatest, isLoading }) {
  const { displayed, done } = useTypewriter(isLatest && !isLoading ? text : null, 8);
  const content = isLatest && !isLoading ? displayed : text;

  return (
    <div className="flex justify-start mb-3">
      <div className="flex items-end gap-2 max-w-[88%]">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
          {isLoading ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span className="text-sm text-slate-400">Thinking…</span>
            </div>
          ) : (
            <div className="space-y-1 text-slate-700">
              {renderMarkdown(content)}
              {isLatest && !done && <span className="inline-block w-0.5 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmBubble({ text, onConfirm, onCancel, confirmed }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="flex items-end gap-2 max-w-[88%]">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="bg-white border border-amber-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
          <div className="space-y-1 text-slate-700 mb-3">
            {renderMarkdown(text)}
          </div>
          {confirmed === null ? (
            <div className="flex gap-2">
              <button
                onClick={onConfirm}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
              </button>
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-200 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          ) : (
            <span className={`text-xs font-semibold ${confirmed ? 'text-indigo-600' : 'text-slate-400'}`}>
              {confirmed ? '✓ Confirmed' : '✗ Cancelled'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starter prompts shown when history is empty
// ---------------------------------------------------------------------------
const STARTER_PROMPTS = [
  { icon: BarChart2, label: 'Meta Ads performance today', q: 'How are our Meta Ads performing today?' },
  { icon: Search,   label: 'SEO keyword changes',         q: 'Which SEO keywords dropped this week?' },
  { icon: Zap,      label: 'Pipeline & deals',            q: 'What is our current pipeline value and how many deals are in proposal?' },
  { icon: Clock,    label: 'Overdue ClickUp tasks',       q: 'Which tasks are overdue in ClickUp right now?' },
  { icon: DollarSign, label: 'MRR & billing status',     q: 'What is our current MRR and any overdue invoices?' },
  { icon: Cpu,      label: 'Cron & system health',        q: 'Show me which cron jobs failed recently.' },
];

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function IntelligenceChatPanel() {
  const [messages, setMessages] = useState([
    {
      id: 'init',
      role: 'assistant',
      text: "Hi Jatin 👋 I have today's live data loaded. Ask me anything about Meta Ads, SEO, pipeline, billing, or ClickUp — or tell me to trigger an action.",
      isConfirm: false,
      confirmed: undefined,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null); // message id awaiting confirm
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // History for context (only user/assistant text turns, max 10)
  const getHistory = useCallback(() => {
    return messages
      .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.isConfirm))
      .slice(-10)
      .map(m => ({ role: m.role, content: m.text }));
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const userText = text.trim();
    setInput('');

    const userMsg = { id: `u-${Date.now()}`, role: 'user', text: userText, isConfirm: false };
    const loadingMsg = { id: `l-${Date.now()}`, role: 'assistant', text: '', isLoading: true, isConfirm: false };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    try {
      const data = await apiFetch('/api/intelligence/chat', {
        method: 'POST',
        body: JSON.stringify({ message: userText, history: getHistory() }),
      });

      const reply = data?.reply ?? 'Sorry, I could not get a response.';
      const isConfirm = data?.isConfirmRequest === true;

      const replyMsgId = `a-${Date.now()}`;
      setMessages(prev => {
        const filtered = prev.filter(m => !m.isLoading);
        const replyMsg = {
          id: replyMsgId,
          role: 'assistant',
          text: reply,
          isConfirm,
          confirmed: isConfirm ? null : undefined,
        };
        return [...filtered, replyMsg];
      });

      if (isConfirm) setPendingConfirm(replyMsgId);
    } catch (e) {
      setMessages(prev => {
        const filtered = prev.filter(m => !m.isLoading);
        return [...filtered, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: `Error: ${e.message || 'Request failed'}`,
          isConfirm: false,
        }];
      });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  async function handleConfirm(msgId) {
    setPendingConfirm(null);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, confirmed: true } : m));

    // Send "yes" to execute the confirmed action
    await sendMessage('Yes, go ahead.');
  }

  function handleCancel(msgId) {
    setPendingConfirm(null);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, confirmed: false } : m));
    setMessages(prev => [...prev, {
      id: `cancel-${Date.now()}`,
      role: 'assistant',
      text: 'Got it — action cancelled. What else can I help with?',
      isConfirm: false,
    }]);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const showStarters = messages.length <= 1;

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Operations Co-Pilot</p>
          <p className="text-xs text-slate-400">Live data · Admin only</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-slate-400">Online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.map((msg, idx) => {
          if (msg.role === 'user') {
            return <UserBubble key={msg.id} text={msg.text} />;
          }
          if (msg.isLoading) {
            return <AssistantBubble key={msg.id} text="" isLoading={true} />;
          }
          if (msg.isConfirm) {
            return (
              <ConfirmBubble
                key={msg.id}
                text={msg.text}
                confirmed={msg.confirmed ?? null}
                onConfirm={() => handleConfirm(msg.id)}
                onCancel={() => handleCancel(msg.id)}
              />
            );
          }
          return (
            <AssistantBubble
              key={msg.id}
              text={msg.text}
              isLatest={idx === messages.length - 1}
              isLoading={false}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Starter prompts (shown when empty) */}
      {showStarters && (
        <div className="px-4 pb-3">
          <p className="text-xs text-slate-400 mb-2 font-medium">Quick questions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {STARTER_PROMPTS.map(({ icon: Icon, label, q }) => (
              <button
                key={label}
                onClick={() => sendMessage(q)}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all text-left disabled:opacity-50"
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="bg-white border-t border-slate-200 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about data or say 'trigger rank tracking'…"
            rows={1}
            disabled={loading || pendingConfirm !== null}
            className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-slate-400 disabled:opacity-50 max-h-28 overflow-auto"
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim() || pendingConfirm !== null}
            className="w-9 h-9 flex-shrink-0 bg-indigo-600 text-white rounded-xl flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {pendingConfirm && (
          <p className="text-xs text-amber-600 mt-1.5 text-center">
            Confirm or cancel the action above before sending a new message
          </p>
        )}
        <p className="text-[10px] text-slate-300 mt-1.5 text-center">Powered by Claude Sonnet · Admin only</p>
      </div>
    </div>
  );
}
