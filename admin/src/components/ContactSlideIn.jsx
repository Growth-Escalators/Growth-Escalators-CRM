import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { productPath } from '../lib/auth.js';
import { safeLower } from '../lib/safe.js';

const BUSINESS_TYPES = [
  { value: 'd2c_brand', label: 'D2C Brand', color: 'bg-success-500/10 text-success-700' },
  { value: 'agency_owner', label: 'Agency Owner', color: 'bg-primary-100 text-primary-700' },
  { value: 'freelancer', label: 'Freelancer', color: 'bg-primary-100 text-primary-700' },
  { value: 'ecom_brand', label: 'Ecom Brand', color: 'bg-accent-100 text-accent-700' },
  { value: 'healthcare', label: 'Healthcare', color: 'bg-success-500/10 text-success-700' },
];

const ASSIGNED_OPTIONS = [
  { value: 'jatin', label: 'Jatin', color: '#F97316' },
  { value: 'saksham', label: 'Saksham', color: '#3B82F6' },
];

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A handful of source slugs read oddly when title-cased word-by-word
// (acronyms, brand names) — override those, fall back to Title Case for the rest.
const SOURCE_LABEL_OVERRIDES = {
  wizmatch_github: 'GitHub (Wizmatch)',
  wizmatch_xray: 'LinkedIn X-Ray (Wizmatch)',
  wizmatch_enrichment: 'Wizmatch Enrichment',
  wizmatch_contact_intelligence: 'Wizmatch Contact Intelligence',
  wizmatch_candidate_intake: 'Wizmatch Candidate Intake',
  wizmatch_manual: 'Wizmatch Manual',
  github: 'GitHub',
  xray: 'X-Ray',
  csv_import: 'CSV Import',
  theirstack: 'TheirStack',
  remoteok: 'RemoteOK',
};

function formatSourceLabel(source) {
  if (!source) return '—';
  if (SOURCE_LABEL_OVERRIDES[source]) return SOURCE_LABEL_OVERRIDES[source];
  return source
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

// Business Type + lead Score are Growth-Escalators D2C concepts (agency/ecom/
// healthcare lead classification) — they never apply to a Wizmatch-sourced
// contact (a job-signal company or a sourced candidate), so hide them there
// instead of showing a permanently-empty "Unknown"/"0/100".
function isWizmatchSourcedContact(contact) {
  if (contact?.source?.startsWith('wizmatch_')) return true;
  return (contact?.tags ?? []).some((t) => t === 'Candidate' || t === 'Client Lead');
}

function stringToColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}

function ConversationItem({ item }) {
  const type = item.item_type;

  if (type === 'message') {
    const isWA = item.channel === 'whatsapp';
    const isOut = item.direction === 'outbound';
    if (isWA && isOut) {
      return (
        <div className="flex justify-end mb-3">
          <div className="max-w-[75%]">
            <div className="rounded-2xl rounded-tr-sm px-4 py-2.5" style={{ background: '#075E54' }}>
              <p className="text-white text-sm whitespace-pre-wrap">{item.content}</p>
            </div>
            {item.templateName && (
              <p className="text-xs text-neutral-400 mt-0.5 text-right">{item.templateName}</p>
            )}
            <p className="text-xs text-neutral-400 mt-0.5 text-right">{relativeTime(item.created_at)}</p>
          </div>
        </div>
      );
    }
    if (isWA && !isOut) {
      return (
        <div className="flex justify-start mb-3">
          <div className="max-w-[75%]">
            <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-white border border-neutral-200">
              <p className="text-neutral-900 text-sm whitespace-pre-wrap">{item.content}</p>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">{relativeTime(item.created_at)}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="mb-3 border-l-4 border-primary-400 bg-primary-50 rounded-r-xl px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">Email sent</span>
          <span className="text-xs text-neutral-400">{relativeTime(item.created_at)}</span>
        </div>
        {item.templateName && <p className="text-xs text-neutral-500 mb-1">{item.templateName}</p>}
        {item.content && <p className="text-sm text-neutral-700 whitespace-pre-wrap">{item.content}</p>}
      </div>
    );
  }

  if (type === 'booking') {
    const tierColor = item.tier === 'hot'
      ? 'bg-success-500/10 text-success-700'
      : item.tier === 'warm' ? 'bg-warning-500/10 text-warning-700' : 'bg-neutral-100 text-neutral-500';
    return (
      <div className="mb-3 border-l-4 border-accent-400 bg-accent-50 rounded-r-xl px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-accent-700">📅 Strategy Call Booked</span>
          <span className="text-xs text-neutral-400">{relativeTime(item.created_at)}</span>
        </div>
        {item.scheduledAt && (
          <p className="text-xs text-neutral-600 mb-1">{formatDateTime(item.scheduledAt)}</p>
        )}
        {(item.tier || item.score) && (
          <div className="flex items-center gap-2">
            {item.tier && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColor}`}>
                {item.tier}
              </span>
            )}
            {item.score != null && (
              <span className="text-xs text-neutral-500">Score: {item.score}/100</span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (type === 'event') {
    let label = item.eventType ?? 'Event';
    try {
      const d = typeof item.data === 'string' ? JSON.parse(item.data || '{}') : (item.data ?? {});
      if (item.eventType === 'deal_stage_changed') label = `Deal moved to ${d.newStage ?? d.stage ?? '?'}`;
      else if (item.eventType === 'sequence_enrolled') label = `Enrolled in ${d.sequenceName ?? '?'}`;
      else if (item.eventType === 'purchase_completed') label = `Purchased ₹${d.amount ?? '?'}`;
    } catch {}
    return (
      <div className="mb-2 flex flex-col items-center">
        <span className="text-xs text-neutral-400 bg-neutral-100 rounded-full px-3 py-1">{label}</span>
        <span className="text-[10px] text-neutral-300 mt-0.5">{relativeTime(item.created_at)}</span>
      </div>
    );
  }

  if (type === 'note') {
    return (
      <div className="mb-3 border-l-4 border-warning-500 bg-warning-500/10 rounded-r-xl px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-warning-700">✏️ Note by {item.createdBy ?? 'team'}</span>
          <span className="text-xs text-neutral-400">{relativeTime(item.created_at)}</span>
        </div>
        <p className="text-sm text-neutral-700 whitespace-pre-wrap">{item.content}</p>
      </div>
    );
  }

  return null;
}

export default function ContactSlideIn({ contact: initialContact, onClose, onUpdated }) {
  const [contact, setContact] = useState(initialContact);
  const [activeTab, setActiveTab] = useState('details');
  const [channels, setChannels] = useState([]);
  const [wizmatchCandidate, setWizmatchCandidate] = useState(null);
  const [wizmatchContactCandidate, setWizmatchContactCandidate] = useState(null);
  const [wizmatchCompany, setWizmatchCompany] = useState(null);
  const [wizmatchCompanyIntelligence, setWizmatchCompanyIntelligence] = useState(null);
  const [deals, setDeals] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [notes, setNotes] = useState([]);
  const [convLoading, setConvLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editNoteId, setEditNoteId] = useState(null);
  const [editNoteContent, setEditNoteContent] = useState('');
  const slideRef = useRef(null);

  const id = contact?.id;

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/contacts/${id}`).then((d) => {
      if (d?.contact) setContact((prev) => ({ ...prev, ...d.contact }));
      if (d?.channels) setChannels(d.channels);
      setWizmatchCandidate(d?.wizmatchCandidate ?? null);
      setWizmatchContactCandidate(d?.wizmatchContactCandidate ?? null);
      setWizmatchCompany(d?.wizmatchCompany ?? null);
      setWizmatchCompanyIntelligence(d?.wizmatchCompanyIntelligence ?? null);
    });
    apiFetch(`/api/deals?contactId=${id}&limit=20`).then((d) => {
      if (d?.deals) setDeals(d.deals);
    });
  }, [id]);

  const loadConversation = useCallback(async () => {
    if (!id) return;
    setConvLoading(true);
    try {
      const d = await apiFetch(`/api/contacts/${id}/conversation`);
      if (d?.items) setConversation(d.items);
    } catch { /* API error — stop spinner */ }
    finally { setConvLoading(false); }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'conversation') loadConversation();
  }, [activeTab, loadConversation]);

  const loadNotes = useCallback(async () => {
    if (!id) return;
    setNotesLoading(true);
    try {
      const d = await apiFetch(`/api/contacts/${id}/notes`);
      if (d?.notes) setNotes(d.notes);
    } catch { /* API error — stop spinner */ }
    finally { setNotesLoading(false); }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'activity') loadNotes();
  }, [activeTab, loadNotes]);

  const loadTasks = useCallback(async () => {
    if (!id) return;
    setTasksLoading(true);
    try {
      const d = await apiFetch(`/api/clickup/tasks/${id}`);
      if (d?.tasks) setTasks(d.tasks);
    } catch { /* API error — stop spinner */ }
    finally { setTasksLoading(false); }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'activity') loadTasks();
  }, [activeTab, loadTasks]);

  useEffect(() => {
    function handler(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function patchContact(updates) {
    const updated = await apiFetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (updated) { setContact((prev) => ({ ...prev, ...updated })); onUpdated?.(); }
  }

  async function addNote() {
    if (!noteInput.trim()) return;
    setAddingNote(true);
    await apiFetch(`/api/contacts/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content: noteInput.trim(), createdBy: 'jatin' }),
    });
    setNoteInput('');
    setAddingNote(false);
    if (activeTab === 'conversation') loadConversation();
    else loadNotes();
  }

  async function saveEditNote() {
    if (!editNoteContent.trim() || !editNoteId) return;
    await apiFetch(`/api/contacts/${id}/notes/${editNoteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: editNoteContent.trim() }),
    });
    setEditNoteId(null);
    setEditNoteContent('');
    loadNotes();
  }

  async function deleteNote(noteId) {
    await apiFetch(`/api/contacts/${id}/notes/${noteId}`, { method: 'DELETE' });
    loadNotes();
  }

  const phone = channels.find((c) => c.channelType === 'whatsapp' || c.channelType === 'phone')?.channelValue;
  const email = channels.find((c) => c.channelType === 'email')?.channelValue;
  const btType = BUSINESS_TYPES.find((b) => b.value === contact?.businessType);
  const isWizmatchContact = isWizmatchSourcedContact(contact);
  const fullName = `${contact?.firstName ?? ''} ${contact?.lastName ?? ''}`.trim();
  const initials = ((contact?.firstName?.[0] ?? '') + (contact?.lastName?.[0] ?? '')).toUpperCase() || '?';

  const TABS = [
    { id: 'details', label: 'Details' },
    { id: 'conversation', label: 'Conversation' },
    { id: 'activity', label: `Notes & Tasks${tasks.length > 0 ? ` (${tasks.length})` : ''}` },
    { id: 'deals', label: `Deals${deals.length > 0 ? ` (${deals.length})` : ''}` },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]" onClick={onClose}>
      <div
        ref={slideRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white shadow-modal flex flex-col h-full animate-[drawerIn_300ms_cubic-bezier(0.4,0,0.2,1)]"
      >

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100 shrink-0">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0"
            style={{ background: stringToColor(id ?? '') }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-neutral-900 text-base truncate">{fullName || 'Unknown'}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {contact?.companyName && (
                <span className="text-xs text-neutral-400 truncate">{contact.companyName}</span>
              )}
              {btType && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${btType.color}`}>
                  {btType.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {phone && (
              <a
                href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-neutral-400 hover:text-success-600 rounded-lg hover:bg-neutral-100"
                title="Open WhatsApp"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.122 1.528 5.857L0 24l6.293-1.508A11.954 11.954 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.886 0-3.655-.5-5.189-1.375l-.371-.219-3.837.919.938-3.726-.241-.385A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                </svg>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-neutral-600 rounded-lg hover:bg-neutral-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-100 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors border-b-[2.5px] ${
                activeTab === tab.id
                  ? 'text-primary-600 border-primary-500'
                  : 'text-neutral-400 border-transparent hover:text-neutral-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* CONVERSATION TAB */}
          {activeTab === 'conversation' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {convLoading ? (
                  <div className="flex justify-center py-8 text-neutral-400 text-sm">Loading…</div>
                ) : conversation.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-neutral-300">
                    <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-sm">No conversation yet</p>
                  </div>
                ) : (
                  conversation.map((item) => <ConversationItem key={item.id} item={item} />)
                )}
              </div>
              <div className="px-4 py-3 border-t border-neutral-100 bg-white shrink-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && addNote()}
                    placeholder="Add a note…"
                    className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    onClick={addNote}
                    disabled={addingNote || !noteInput.trim()}
                    className="px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DETAILS TAB */}
          {activeTab === 'details' && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Contact Info</h3>
                {phone && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 w-20 shrink-0">Phone</span>
                    <a href={`tel:${phone}`} className="text-sm text-primary-600 hover:underline">{phone}</a>
                  </div>
                )}
                {email && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 w-20 shrink-0">Email</span>
                    <a href={`mailto:${email}`} className="text-sm text-primary-600 hover:underline">{email}</a>
                  </div>
                )}
                {contact?.companyName && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 w-20 shrink-0">Company</span>
                    <span className="text-sm text-neutral-700">{contact.companyName}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-neutral-400 w-20 shrink-0">Source</span>
                  <span className="text-sm text-neutral-700">{formatSourceLabel(contact?.source)}</span>
                </div>
                {!isWizmatchContact && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-400 w-20 shrink-0">Score</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      (contact?.score ?? 0) >= 70
                        ? 'bg-success-500/10 text-success-700'
                        : (contact?.score ?? 0) >= 40
                        ? 'bg-warning-500/10 text-warning-700'
                        : 'bg-neutral-100 text-neutral-500'
                    }`}>
                      {contact?.score ?? 0}/100
                    </span>
                  </div>
                )}
              </div>

              {!isWizmatchContact && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Business Type</h3>
                  <select
                    value={contact?.businessType ?? ''}
                    onChange={(e) => patchContact({ businessType: e.target.value || null })}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Unknown</option>
                    {BUSINESS_TYPES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {wizmatchCandidate && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Candidate Info</h3>
                  {(wizmatchCandidate.githubUrl || wizmatchCandidate.linkedinUrl || wizmatchCandidate.resumeUrl) && (
                    <div className="flex flex-wrap gap-3">
                      {wizmatchCandidate.githubUrl && (
                        <a
                          href={wizmatchCandidate.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary-600 hover:underline"
                        >
                          GitHub profile ↗
                        </a>
                      )}
                      {wizmatchCandidate.linkedinUrl && (
                        <a
                          href={wizmatchCandidate.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary-600 hover:underline"
                        >
                          LinkedIn ↗
                        </a>
                      )}
                      {wizmatchCandidate.resumeUrl && (
                        <a
                          href={wizmatchCandidate.resumeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary-600 hover:underline"
                        >
                          Resume ↗
                        </a>
                      )}
                    </div>
                  )}
                  {wizmatchCandidate.skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {wizmatchCandidate.skills.map((s) => (
                        <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">{s}</span>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {wizmatchCandidate.location && (
                      <div><span className="text-xs text-neutral-400 block">Location</span>{wizmatchCandidate.location}</div>
                    )}
                    {wizmatchCandidate.experienceYears != null && (
                      <div><span className="text-xs text-neutral-400 block">Experience</span>{wizmatchCandidate.experienceYears} yrs</div>
                    )}
                    {wizmatchCandidate.visaStatus && wizmatchCandidate.visaStatus !== 'unknown' && (
                      <div><span className="text-xs text-neutral-400 block">Visa</span>{wizmatchCandidate.visaStatus}</div>
                    )}
                    {wizmatchCandidate.availabilityStatus && (
                      <div><span className="text-xs text-neutral-400 block">Availability</span>{wizmatchCandidate.availabilityStatus}</div>
                    )}
                    {wizmatchCandidate.availabilityDate && (
                      <div><span className="text-xs text-neutral-400 block">Available from</span>{formatDate(wizmatchCandidate.availabilityDate)}</div>
                    )}
                    {wizmatchCandidate.rateHourly != null && (
                      <div><span className="text-xs text-neutral-400 block">Rate</span>{wizmatchCandidate.rateCurrency ?? 'USD'} {wizmatchCandidate.rateHourly}/hr</div>
                    )}
                    {wizmatchCandidate.matchScore != null && (
                      <div>
                        <span className="text-xs text-neutral-400 block">Match score (at intake)</span>
                        {wizmatchCandidate.matchScore}/100
                        {wizmatchCandidate.createdAt && <span className="text-xs text-neutral-400"> · {formatDate(wizmatchCandidate.createdAt)}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {wizmatchContactCandidate && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Client Lead Info</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {wizmatchContactCandidate.title && (
                      <div><span className="text-xs text-neutral-400 block">Title</span>{wizmatchContactCandidate.title}</div>
                    )}
                    {wizmatchContactCandidate.roleCategory && (
                      <div><span className="text-xs text-neutral-400 block">Role category</span>{wizmatchContactCandidate.roleCategory}</div>
                    )}
                    {wizmatchContactCandidate.region && (
                      <div><span className="text-xs text-neutral-400 block">Region</span>{wizmatchContactCandidate.region}</div>
                    )}
                    {wizmatchContactCandidate.deliverabilityStatus && (
                      <div><span className="text-xs text-neutral-400 block">Deliverability</span>{wizmatchContactCandidate.deliverabilityStatus}</div>
                    )}
                    {wizmatchContactCandidate.confidenceScore != null && (
                      <div><span className="text-xs text-neutral-400 block">Confidence</span>{wizmatchContactCandidate.confidenceScore}/100</div>
                    )}
                    {wizmatchContactCandidate.source && (
                      <div>
                        <span className="text-xs text-neutral-400 block">Source</span>
                        {wizmatchContactCandidate.sourceUrl ? (
                          <a href={wizmatchContactCandidate.sourceUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                            {formatSourceLabel(wizmatchContactCandidate.source)} ↗
                          </a>
                        ) : formatSourceLabel(wizmatchContactCandidate.source)}
                      </div>
                    )}
                  </div>
                  {wizmatchContactCandidate.status === 'rejected' && wizmatchContactCandidate.rejectionReason && (
                    <div className="text-xs px-2 py-1.5 rounded-md bg-danger-50 text-danger-700">
                      Rejected: {wizmatchContactCandidate.rejectionReason}
                    </div>
                  )}
                </div>
              )}

              {wizmatchCompany && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Company Info</h3>
                  {wizmatchCompanyIntelligence && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        wizmatchCompanyIntelligence.qualificationTier === 'A'
                          ? 'bg-success-500/10 text-success-700'
                          : wizmatchCompanyIntelligence.qualificationTier === 'B'
                          ? 'bg-warning-500/10 text-warning-700'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}>
                        Tier {wizmatchCompanyIntelligence.qualificationTier ?? '—'}
                      </span>
                      {wizmatchCompanyIntelligence.qualificationScore != null && (
                        <span className="text-xs text-neutral-500">Score: {wizmatchCompanyIntelligence.qualificationScore}/100</span>
                      )}
                      {wizmatchCompanyIntelligence.reviewStatus && (
                        <span className="text-xs text-neutral-500 capitalize">{wizmatchCompanyIntelligence.reviewStatus.replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {wizmatchCompany.domain && (
                      <div>
                        <span className="text-xs text-neutral-400 block">Domain</span>
                        <a href={`https://${wizmatchCompany.domain}`} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                          {wizmatchCompany.domain} ↗
                        </a>
                      </div>
                    )}
                    {wizmatchCompany.industry && (
                      <div><span className="text-xs text-neutral-400 block">Industry</span>{wizmatchCompany.industry}</div>
                    )}
                    {wizmatchCompany.employeeCount != null && (
                      <div><span className="text-xs text-neutral-400 block">Employees</span>{wizmatchCompany.employeeCount}</div>
                    )}
                    {wizmatchCompany.atsType && wizmatchCompany.atsType !== 'none' && (
                      <div><span className="text-xs text-neutral-400 block">ATS</span>{formatSourceLabel(wizmatchCompany.atsType)}</div>
                    )}
                    {wizmatchCompany.h1bSponsorCount > 0 && (
                      <div><span className="text-xs text-neutral-400 block">H-1B sponsorships</span>{wizmatchCompany.h1bSponsorCount}</div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Assigned To</h3>
                <div className="flex gap-2">
                  {ASSIGNED_OPTIONS.map((a) => (
                    <button
                      key={a.value}
                      onClick={() => patchContact({ assignedTo: contact?.assignedTo === a.value ? null : a.value })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        contact?.assignedTo === a.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: a.color }}
                      >
                        {a.label[0]}
                      </span>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {contact?.tags?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Tags</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(contact.tags ?? []).map((tag) => (
                      <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {contact?.notes && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Contact Notes</h3>
                  <p className="text-sm text-neutral-700 whitespace-pre-wrap">{contact.notes}</p>
                </div>
              )}

              <div className="space-y-1 pt-2 border-t border-neutral-100">
                <p className="text-xs text-neutral-400">
                  Created:{' '}
                  {contact?.createdAt
                    ? new Date(contact.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })
                    : '—'}
                </p>
                {contact?.lastActivityAt && (
                  <p className="text-xs text-neutral-400">
                    Last activity:{' '}
                    {new Date(contact.lastActivityAt).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* NOTES & TASKS TAB (merged: note composer + notes on top, ClickUp tasks below) */}
          {activeTab === 'activity' && (
            <div className="flex-1 overflow-y-auto flex flex-col">
              <div className="px-5 py-4 border-b border-neutral-100 shrink-0">
                <textarea
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  rows={3}
                  placeholder="Write a note…"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={addNote}
                    disabled={addingNote || !noteInput.trim()}
                    className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    Add Note
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Notes</h3>
                {notesLoading ? (
                  <p className="text-sm text-neutral-400 text-center py-4">Loading…</p>
                ) : notes.length === 0 ? (
                  <p className="text-sm text-neutral-300 text-center py-8">No notes yet</p>
                ) : (
                  notes.map((note) => (
                    <div key={note.id} className="border border-neutral-200 rounded-xl p-4 bg-white">
                      {editNoteId === note.id ? (
                        <>
                          <textarea
                            value={editNoteContent}
                            onChange={(e) => setEditNoteContent(e.target.value)}
                            rows={3}
                            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none mb-2"
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => { setEditNoteId(null); setEditNoteContent(''); }}
                              className="px-3 py-1.5 text-xs text-neutral-600 border border-neutral-200 rounded-lg hover:bg-neutral-50"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveEditNote}
                              className="px-3 py-1.5 text-xs text-white bg-primary-600 rounded-lg hover:bg-primary-700"
                            >
                              Save
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-neutral-700 whitespace-pre-wrap mb-2">{note.content}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-neutral-400">
                              {note.createdBy} · {relativeTime(note.createdAt || note.created_at)}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => { setEditNoteId(note.id); setEditNoteContent(note.content); }}
                                className="text-xs text-neutral-400 hover:text-primary-600 px-2 py-1"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteNote(note.id)}
                                className="text-xs text-neutral-400 hover:text-danger-600 px-2 py-1"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide pt-4 mt-2 border-t border-neutral-100">Tasks</h3>
                {tasksLoading ? (
                <div className="flex justify-center py-8 text-neutral-400 text-sm">Loading tasks…</div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-neutral-300">
                  <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-sm">No ClickUp tasks yet</p>
                </div>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="border border-neutral-200 rounded-xl p-4 bg-white">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold text-neutral-900 flex-1">{task.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                        task.status?.status === 'complete' || task.status?.status === 'closed'
                          ? 'bg-success-500/10 text-success-700'
                          : task.status?.status === 'in progress'
                          ? 'bg-primary-100 text-primary-700'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}>
                        {task.status?.status ?? 'to do'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {task.priority?.priority && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          task.priority.priority === '1' ? 'bg-danger-500/10 text-danger-600'
                          : task.priority.priority === '2' ? 'bg-accent-100 text-accent-700'
                          : 'bg-neutral-100 text-neutral-500'
                        }`}>
                          {task.priority.priority === '1' ? 'Urgent' : task.priority.priority === '2' ? 'High' : 'Normal'}
                        </span>
                      )}
                      {task.due_date && (
                        <span className="text-xs text-neutral-400">
                          Due: {new Date(Number(task.due_date)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {task.assignees?.length > 0 && (
                        <span className="text-xs text-neutral-400">
                          → {task.assignees.map(a => a.username).join(', ')}
                        </span>
                      )}
                    </div>
                    {task.url && (
                      <a
                        href={task.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary-500 hover:text-primary-700 mt-2 inline-block"
                      >
                        Open in ClickUp →
                      </a>
                    )}
                  </div>
                ))
              )}
              </div>
            </div>
          )}

          {/* DEALS TAB */}
          {activeTab === 'deals' && (
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {deals.length === 0 ? (
                <p className="text-sm text-neutral-300 text-center py-8">No deals yet</p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="border border-neutral-200 rounded-xl p-4 bg-white">
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-sm font-semibold text-neutral-900">{deal.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {deal.dealValue > 0 && (
                          <span className="text-sm font-semibold text-success-600">
                            ₹{Number(deal.dealValue).toLocaleString('en-IN')}
                          </span>
                        )}
                        <a
                          href={productPath(`/pipeline?dealId=${deal.id}`)}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium ml-auto shrink-0"
                        >
                          Open in Pipeline →
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        safeLower(deal.stage).includes('won')
                          ? 'bg-success-500/10 text-success-700'
                          : safeLower(deal.stage).includes('lost')
                          ? 'bg-danger-500/10 text-danger-600'
                          : 'bg-primary-100 text-primary-700'
                      }`}>
                        {deal.stage ?? 'Unknown'}
                      </span>
                      {deal.pipelineName && (
                        <span className="text-xs text-neutral-400">{deal.pipelineName}</span>
                      )}
                      {deal.assignedTo && (
                        <span className="text-xs text-neutral-400">→ {deal.assignedTo}</span>
                      )}
                    </div>
                    {deal.lostReason && (
                      <p className="text-xs text-danger-500 mt-1">Lost: {deal.lostReason}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
