import React, { useEffect, useState, useRef, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';
import { getAuthToken } from '../lib/auth.js';
import { safeLower, safeText } from '../lib/safe.js';
import { MessageSquare, Send, Search, Check, CheckCheck, Image, FileText, Phone, User, ArrowLeft, Pencil, Mail } from 'lucide-react';
import { io } from 'socket.io-client';

function timeAgo(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function StatusIcon({ status }) {
  if (status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-primary-500" />;
  if (status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-neutral-400" />;
  if (status === 'sent') return <Check className="w-3.5 h-3.5 text-neutral-400" />;
  if (status === 'failed') return <span className="text-xs text-danger-500">!</span>;
  return null;
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound';
  const isTemplate = msg.messageType === 'template';
  const hasMedia = msg.mediaUrl && msg.messageType !== 'text';

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className={`max-w-xs lg:max-w-md xl:max-w-lg rounded-2xl px-4 py-2 ${
        isOut ? 'bg-success-600 text-white rounded-br-sm' : 'bg-white text-neutral-800 border border-neutral-100 rounded-bl-sm'
      }`}>
        {isTemplate && (
          <p className="text-xs italic opacity-75 mb-1">[Template: {msg.templateName}]</p>
        )}
        {hasMedia && (
          <div className="flex items-center gap-2 mb-1">
            {msg.messageType === 'image' ? <Image className="w-4 h-4 opacity-75" /> : <FileText className="w-4 h-4 opacity-75" />}
            <span className="text-xs opacity-75">[{msg.messageType}]</span>
          </div>
        )}
        <p className="text-sm break-words whitespace-pre-wrap">{msg.content}</p>
        <div className={`flex items-center gap-1 mt-1 ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className={`text-xs ${isOut ? 'text-success-500/10' : 'text-neutral-400'}`}>
            {timeAgo(msg.sentAt)}
          </span>
          {isOut && <StatusIcon status={msg.status} />}
        </div>
      </div>
    </div>
  );
}

function TemplateSelector({ templates, onSelect, onClose }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl border border-neutral-200 shadow-lg w-72 max-h-60 overflow-y-auto z-10">
      <div className="px-3 py-2 border-b border-neutral-100">
        <p className="text-xs font-semibold text-neutral-500">Send Template</p>
      </div>
      {templates.length === 0 && <p className="p-3 text-xs text-neutral-400 text-center">No approved templates</p>}
      {templates.map(t => (
        <button
          key={t.id}
          onClick={() => { onSelect(t); onClose(); }}
          className="w-full text-left px-3 py-2 hover:bg-neutral-50 border-b border-neutral-50 last:border-0"
        >
          <p className="text-sm font-medium text-neutral-800">{t.templateName}</p>
          <p className="text-xs text-neutral-400">{t.category} · {t.language}</p>
        </button>
      ))}
    </div>
  );
}

export default function InboxPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [editContactId, setEditContactId] = useState(null);
  const [toast, setToast] = useState('');
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const selectedConvRef = useRef(null);

  // Load conversations + templates
  useEffect(() => {
    Promise.all([
      apiFetch('/api/inbox/conversations').catch(() => ({ conversations: [] })),
      apiFetch('/api/inbox/templates').catch(() => ({ templates: [] })),
    ]).then(([convData, tmplData]) => {
      setConversations(convData?.conversations || []);
      setTemplates(tmplData?.templates || []);
      setLoading(false);
    });
  }, []);

  // Keep ref in sync with selectedConv for socket handlers
  useEffect(() => { selectedConvRef.current = selectedConv; }, [selectedConv]);

  // Socket.io for real-time — connect once on mount
  useEffect(() => {
    const socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'], auth: { token: getAuthToken() } });
    socketRef.current = socket;

    socket.on('new_message', (msg) => {
      // Update message list if this contact is selected (use ref to avoid stale closure)
      if (selectedConvRef.current && msg.contactId === selectedConvRef.current.contactId) {
        setMessages(prev => [...prev, msg]);
      }
      // Update conversation list
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.contactId === msg.contactId) {
            return {
              ...c,
              lastMessage: msg.content,
              lastMessageAt: msg.sentAt,
              lastDirection: msg.direction,
              unreadCount: msg.direction === 'inbound' ? Number(c.unreadCount || 0) + 1 : c.unreadCount,
            };
          }
          return c;
        });
        // Add new conversation if not present
        if (!prev.find(c => c.contactId === msg.contactId)) {
          return [{ contactId: msg.contactId, contactName: 'New Contact', lastMessage: msg.content, lastMessageAt: msg.sentAt, lastDirection: msg.direction, unreadCount: msg.direction === 'inbound' ? 1 : 0 }, ...updated];
        }
        return updated.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      });
    });

    socket.on('message_status', ({ waMessageId, status }) => {
      setMessages(prev => prev.map(m =>
        m.externalId === waMessageId ? { ...m, status } : m
      ));
    });

    return () => socket.disconnect();
  }, []);

  // Join/leave socket room on conversation change
  useEffect(() => {
    if (!socketRef.current || !selectedConv) return;
    socketRef.current.emit('join_contact', selectedConv.contactId);
    return () => {
      if (socketRef.current && selectedConv) {
        socketRef.current.emit('leave_contact', selectedConv.contactId);
      }
    };
  }, [selectedConv]);

  // Load messages for selected conversation
  const loadMessages = useCallback(async (conv) => {
    setSelectedConv(conv);
    setMsgLoading(true);
    setMessages([]);
    try {
      const data = await apiFetch(`/api/inbox/conversations/${conv.contactId}/messages`);
      setMessages(data?.messages || []);
      // Mark as read
      await apiFetch(`/api/inbox/conversations/${conv.contactId}/read`, { method: 'POST' }).catch(() => {});
      setConversations(prev => prev.map(c =>
        c.contactId === conv.contactId ? { ...c, unreadCount: '0' } : c
      ));
    } finally {
      setMsgLoading(false);
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function sendMessage() {
    if (!newMsg.trim() || !selectedConv || sending) return;
    setSending(true);
    try {
      const data = await apiFetch(`/api/inbox/conversations/${selectedConv.contactId}/send`, {
        method: 'POST',
        body: JSON.stringify({ message: newMsg }),
      });
      setMessages(prev => [...prev, data.message]);
      setNewMsg('');
      setToast('Message sent successfully');
    } catch { /* send failed */ } finally {
      setSending(false);
    }
  }

  async function sendTemplate(template) {
    if (!selectedConv) return;
    try {
      const data = await apiFetch(`/api/inbox/conversations/${selectedConv.contactId}/send-template`, {
        method: 'POST',
        body: JSON.stringify({ templateName: template.templateName, languageCode: template.language || 'en' }),
      });
      setMessages(prev => [...prev, data.message]);
      setToast('Template sent successfully');
    } catch { /* template send failed */ }
  }

  const filtered = conversations.filter(c => {
    const q = safeLower(search);
    return !q || safeLower(c.contactName).includes(q) || safeText(c.contactPhone).includes(search) || safeLower(c.contactEmail).includes(q);
  });
  const totalUnread = conversations.reduce((sum, c) => sum + Number(c.unreadCount || 0), 0);

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />

      {/* Conversation list — hidden on mobile when chat is open */}
      <div className={`w-full md:w-80 flex-shrink-0 bg-white border-r border-neutral-200 flex flex-col ${selectedConv ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="px-4 py-4 border-b border-neutral-100">
          <h2 className="font-bold text-neutral-900 mb-3 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary-600" />
            Inbox
            {totalUnread > 0 && (
              <span className="bg-accent-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                {totalUnread} unread
              </span>
            )}
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 text-center text-sm text-neutral-400">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center">
              <MessageSquare className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
              <p className="text-sm text-neutral-400">No conversations yet</p>
              <p className="text-xs text-neutral-400 mt-1">Messages will appear here when WhatsApp is connected</p>
            </div>
          )}
          {filtered.map(conv => {
            const unread = Number(conv.unreadCount || 0);
            const isSelected = selectedConv?.contactId === conv.contactId;
            return (
              <button
                key={conv.contactId}
                onClick={() => loadMessages(conv)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-neutral-50 transition-colors ${
                  isSelected ? 'bg-primary-50 shadow-[inset_3px_0_0_theme(colors.primary.500)]' : 'hover:bg-neutral-50'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-600 font-bold text-sm flex-shrink-0">
                  {(conv.contactName || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {(conv.lastChannel === 'email' || (!conv.contactPhone && conv.contactEmail)) ? (
                        <Mail className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                      ) : (
                        <MessageSquare className="w-3.5 h-3.5 text-success-500 flex-shrink-0" />
                      )}
                      <p className={`text-sm truncate ${unread > 0 ? 'font-bold text-neutral-900' : 'font-medium text-neutral-800'}`}>
                        {conv.contactName || conv.contactPhone || 'Unknown'}
                      </p>
                    </div>
                    <p className="text-xs text-neutral-400 flex-shrink-0 ml-2">{timeAgo(conv.lastMessageAt)}</p>
                  </div>
                  {conv.companyName && (
                    <p className="text-xs text-neutral-400 mb-0.5 truncate">{conv.companyName}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <p className={`text-xs truncate ${unread > 0 ? 'text-neutral-700' : 'text-neutral-400'}`}>
                      {conv.lastDirection === 'outbound' && '→ '}
                      {(conv.lastMessage || '').slice(0, 50)}
                    </p>
                    {unread > 0 && (
                      <span className="ml-2 flex-shrink-0 bg-accent-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat view — hidden on mobile when no chat selected */}
      <div className={`flex-1 flex flex-col ${!selectedConv ? 'hidden md:flex' : 'flex'}`}>
        {!selectedConv ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 text-neutral-300 mx-auto mb-4" />
              <p className="text-neutral-500 font-medium">Select a conversation</p>
              <p className="text-neutral-400 text-sm mt-1">Choose a contact to see your WhatsApp messages</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="bg-white border-b border-neutral-200 px-4 md:px-6 py-3 flex items-center gap-3 md:gap-4">
              <button onClick={() => setSelectedConv(null)} className="md:hidden p-1 text-neutral-500 hover:text-neutral-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-9 h-9 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-600 font-bold text-sm">
                {(selectedConv.contactName || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-neutral-900">{selectedConv.contactName || 'Unknown'}</p>
                  <button
                    onClick={() => setEditContactId(selectedConv.contactId)}
                    className="p-1 text-neutral-400 hover:text-primary-600 rounded hover:bg-neutral-100 transition-colors"
                    title="Edit contact"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {selectedConv.contactPhone || '—'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 bg-neutral-50">
              {msgLoading && <p className="text-center text-sm text-neutral-400 py-8">Loading messages…</p>}
              {!msgLoading && messages.length === 0 && (
                <p className="text-center text-sm text-neutral-400 py-8">No messages yet. Send the first message!</p>
              )}
              {messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="bg-white border-t border-neutral-200 px-4 py-3">
              <div className="flex items-center gap-2">
                {/* Template button */}
                <div className="relative">
                  <button
                    onClick={() => setShowTemplates(s => !s)}
                    className="p-2 text-neutral-500 hover:bg-neutral-100 rounded-lg transition-colors text-xs font-medium"
                    title="Send Template"
                  >
                    Templates
                  </button>
                  {showTemplates && (
                    <TemplateSelector
                      templates={templates}
                      onSelect={sendTemplate}
                      onClose={() => setShowTemplates(false)}
                    />
                  )}
                </div>

                {/* Text input */}
                <input
                  value={newMsg}
                  onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Type a message…"
                  className="flex-1 border border-neutral-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />

                <button
                  onClick={sendMessage}
                  disabled={sending || !newMsg.trim()}
                  className="p-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="pointer-events-auto fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">
          {toast}
        </div>
      )}

      {editContactId && (
        <ContactSlideIn
          contact={{ id: editContactId, firstName: selectedConv?.contactName?.split(' ')[0] ?? '', lastName: selectedConv?.contactName?.split(' ').slice(1).join(' ') || null }}
          onClose={() => setEditContactId(null)}
          onUpdated={() => setEditContactId(null)}
        />
      )}
    </div>
  );
}
