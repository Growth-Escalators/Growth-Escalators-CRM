import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Settings, Archive, X } from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getStageStyle(stageName, index) {
  const PALETTE = [
    { color: '#64748b', light: 'bg-neutral-50 border-neutral-200' },
    { color: '#3b82f6', light: 'bg-blue-50 border-blue-200' },
    { color: '#6366f1', light: 'bg-indigo-50 border-indigo-200' },
    { color: '#8b5cf6', light: 'bg-violet-50 border-violet-200' },
    { color: '#0ea5e9', light: 'bg-primary-50 border-sky-200' },
    { color: '#f59e0b', light: 'bg-amber-50 border-amber-200' },
    { color: '#f97316', light: 'bg-orange-50 border-orange-200' },
    { color: '#ec4899', light: 'bg-rose-50 border-rose-200' },
    { color: '#14b8a6', light: 'bg-teal-50 border-teal-200' },
    { color: '#06b6d4', light: 'bg-cyan-50 border-cyan-200' },
  ];
  const lc = (stageName ?? '').toLowerCase();
  if (lc.includes('won')) return { color: '#16a34a', light: 'bg-emerald-50 border-emerald-200' };
  if (lc.includes('lost')) return { color: '#dc2626', light: 'bg-red-50 border-red-200' };
  return PALETTE[index % PALETTE.length];
}

function isTerminalStage(name) {
  const lc = (name ?? '').toLowerCase();
  return lc.includes('won') || lc.includes('lost') || lc.includes('abandoned');
}
function isWonStage(name) { return (name ?? '').toLowerCase().includes('won'); }
function isLostStage(name) { return (name ?? '').toLowerCase().includes('lost'); }
function isAbandonedStage(name) { return (name ?? '').toLowerCase().includes('abandoned'); }

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function fmtInr(val) {
  if (!val || val <= 0) return null;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  return `₹${Number(val).toLocaleString('en-IN')}`;
}

function stringToColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}

const ASSIGNEE_COLORS = { jatin: '#F97316', saksham: '#3B82F6' };

// ---------------------------------------------------------------------------
// DealCard
// ---------------------------------------------------------------------------
function DealCard({ deal, index, onClick, onArchive, onUnarchive, selected = false, onToggleSelect, selectionMode = false }) {
  const days = daysAgo(deal.updatedAt || deal.createdAt);
  const isArchived = deal.metadata?.archived === true;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function h(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const scoreColor = deal.score >= 70
    ? 'bg-green-100 text-green-700'
    : deal.score >= 40
    ? 'bg-amber-100 text-amber-700'
    : deal.score > 0
    ? 'bg-red-100 text-danger-600'
    : 'bg-neutral-100 text-neutral-400';

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={(e) => {
            // In selection mode, clicks toggle selection instead of opening detail.
            if (selectionMode && onToggleSelect) { onToggleSelect(); return; }
            onClick?.(e);
          }}
          className={`bg-white rounded-xl border p-3 shadow-sm hover:shadow-md cursor-pointer transition-all relative select-none ${selected ? 'border-blue-400 ring-2 ring-blue-200' : 'border-neutral-200'} ${snapshot.isDragging ? 'shadow-xl rotate-1 scale-105' : ''} ${isArchived ? 'opacity-60' : ''}`}
          style={{ width: 220, ...provided.draggableProps.style }}
        >
          {/* Row 1: name + days + menu */}
          <div className="flex items-start justify-between gap-1 mb-0.5">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
                className="mt-0.5 mr-1 rounded border-neutral-300 text-primary-500 focus:ring-blue-400 cursor-pointer"
                aria-label="Select deal"
              />
            )}
            <p className="text-sm font-bold text-neutral-900 leading-tight line-clamp-1 flex-1">
              {deal.contactName ?? 'Unknown'}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              {deal.score > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${scoreColor}`}>
                  {deal.score}
                </span>
              )}
              <div ref={menuRef} className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                  className="text-neutral-300 hover:text-neutral-500 p-0.5 rounded"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute top-5 right-0 z-20 bg-white border border-neutral-200 rounded-xl shadow-lg py-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                    {isArchived ? (
                      <button onClick={() => { onUnarchive(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Unarchive</button>
                    ) : (
                      <button onClick={() => { onArchive(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-danger-600 hover:bg-red-50">Archive</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Company */}
          {deal.companyName && (
            <p className="text-xs text-neutral-400 mb-1.5 line-clamp-1">{deal.companyName}</p>
          )}

          {/* Bottom row */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              {fmtInr(deal.dealValue) && (
                <span className="text-xs font-semibold text-success-600">{fmtInr(deal.dealValue)}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-[10px] text-neutral-400 ${days > 3 ? 'text-red-400' : ''}`}>{days}d</span>
              {deal.assignedTo ? (
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold uppercase"
                  style={{ background: ASSIGNEE_COLORS[deal.assignedTo.toLowerCase()] ?? stringToColor(deal.assignedTo) }}
                  title={deal.assignedTo}
                >
                  {deal.assignedTo[0]}
                </span>
              ) : (
                <span className="w-5 h-5 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-400 text-[9px]">?</span>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ---------------------------------------------------------------------------
// Won/Lost confirmation modal
// ---------------------------------------------------------------------------
const LOST_REASONS = [
  'Price too high',
  'Went with competitor',
  'Not ready — bad timing',
  'No budget',
  'Wrong fit',
  'Went unresponsive',
  'Other',
];

function WonLostModal({ stageName, contactName, onConfirm, onCancel }) {
  const won = isWonStage(stageName);
  const abandoned = isAbandonedStage(stageName);
  const lost = !won && !abandoned;
  const [lostReason, setLostReason] = useState('');
  const [notes, setNotes] = useState('');
  const canConfirm = won || abandoned || !!lostReason;

  const iconBg = won ? 'bg-emerald-100' : abandoned ? 'bg-amber-100' : 'bg-red-100';
  const icon = won ? (
    <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
  ) : abandoned ? (
    <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
  ) : (
    <svg className="w-6 h-6 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
  );
  const title = won ? 'Deal Won!' : abandoned ? 'Mark as Abandoned?' : 'Why was this deal lost?';
  const btnClass = won ? 'bg-emerald-600 hover:bg-emerald-700' : abandoned ? 'bg-warning-500 hover:bg-amber-600' : 'bg-danger-600 hover:bg-red-700';
  const btnLabel = won ? 'Save & Confirm' : abandoned ? 'Mark Abandoned' : 'Mark as Lost';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${iconBg}`}>
            {icon}
          </div>
          <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
          <p className="text-sm text-neutral-500 mt-1">
            {contactName} &rarr; <span className="font-medium text-neutral-700">{stageName}</span>
          </p>

          {lost && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Reason <span className="text-danger-500">*</span>
              </label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                <option value="">Select a reason…</option>
                {LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              {won ? 'Notes about this win?' : 'Additional notes'} <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={won ? 'What made this deal happen?' : 'Any additional context…'}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-100 bg-neutral-50 rounded-b-2xl">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-800 border border-neutral-200 rounded-lg hover:bg-white">
            Cancel
          </button>
          {won && (
            <button onClick={() => onConfirm(null, null)} className="px-4 py-2 text-sm font-medium text-neutral-600 border border-neutral-200 rounded-lg hover:bg-white">
              Skip
            </button>
          )}
          <button
            onClick={() => onConfirm(lostReason || null, notes || null)}
            disabled={!canConfirm}
            className={`px-5 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${btnClass}`}
          >
            {btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Deal Modal
// ---------------------------------------------------------------------------
function AddDealModal({ pipelineId, stageName, onAdded, onClose }) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [dealValue, setDealValue] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (search.length < 2) { setContacts([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const d = await apiFetch(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`);
      setContacts(d?.contacts ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function handleAdd() {
    if (!selectedContact) return;
    setSaving(true);
    const result = await apiFetch('/api/deals/add-or-update', {
      method: 'POST',
      body: JSON.stringify({
        contactId: selectedContact.id,
        pipelineId,
        stage: stageName,
        title: `${selectedContact.firstName} ${selectedContact.lastName ?? ''} — opportunity`.trim(),
        ...(dealValue ? { dealValue: parseInt(dealValue, 10) } : {}),
        ...(assignedTo ? { assignedTo } : {}),
        ...(source ? { source } : {}),
      }),
    });
    setSaving(false);
    if (result?.deal) onAdded(result.deal);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-neutral-100">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">Add Deal</h2>
            <p className="text-sm text-neutral-400 mt-0.5">Stage: <span className="font-medium text-neutral-600">{stageName}</span></p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Contact <span className="text-danger-500">*</span></label>
            {selectedContact ? (
              <div className="flex items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 bg-blue-50">
                <span className="text-sm font-medium text-blue-800">{selectedContact.firstName} {selectedContact.lastName ?? ''}</span>
                <button onClick={() => { setSelectedContact(null); setSearch(''); }} className="text-blue-400 hover:text-primary-600 text-xs">Change</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contact name..."
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {(searching || contacts.length > 0) && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searching && <p className="px-3 py-2 text-sm text-neutral-400">Searching…</p>}
                    {contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedContact(c); setSearch(''); setContacts([]); }}
                        className="w-full text-left px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
                      >
                        <span className="font-medium">{c.firstName} {c.lastName ?? ''}</span>
                        {c.phone && <span className="text-neutral-400 text-xs">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Deal Value (&#8377;) <span className="text-neutral-400 font-normal">(optional)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">&#8377;</span>
              <input
                type="number"
                min="0"
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
                placeholder="0"
                className="w-full border border-neutral-200 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Assigned To</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Unassigned</option>
              <option value="jatin">Jatin</option>
              <option value="saksham">Saksham</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Source <span className="text-neutral-400 font-normal">(optional)</span></label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Unknown</option>
              <option value="form">Website Form</option>
              <option value="paid_ad">Paid Ad</option>
              <option value="referral">Referral</option>
              <option value="cold_outreach">Cold Outreach</option>
              <option value="checkout">Checkout</option>
              <option value="inbound">Inbound Call</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-100 bg-neutral-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-neutral-600 border border-neutral-200 rounded-lg hover:bg-white">Cancel</button>
          <button
            onClick={handleAdd}
            disabled={saving || !selectedContact}
            className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Add Deal
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deal Detail Slide-In
// ---------------------------------------------------------------------------
const SOURCE_LABELS = {
  form: 'Website Form', paid_ad: 'Paid Ad', referral: 'Referral',
  cold_outreach: 'Cold Outreach', checkout: 'Checkout', inbound: 'Inbound Call',
};

function DealDetailSlideIn({ dealId, onClose, onViewContact, onUpdated }) {
  const [deal, setDeal] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [editValues, setEditValues] = useState(null); // null = not editing

  const loadActivities = useCallback(async () => {
    const acts = await apiFetch(`/api/deals/${dealId}/activities`);
    setActivities(Array.isArray(acts) ? acts : []);
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      apiFetch(`/api/deals/${dealId}`),
      apiFetch(`/api/deals/${dealId}/activities`),
    ]).then(([d, acts]) => {
      setDeal(d);
      setActivities(Array.isArray(acts) ? acts : []);
    }).catch((err) => {
      setLoadError(err?.message || 'Failed to load deal');
      console.error('[DealDetailSlideIn] load failed for', dealId, err);
    }).finally(() => setLoading(false));
  }, [dealId]);

  async function addNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    await apiFetch(`/api/deals/${dealId}/activities`, {
      method: 'POST',
      body: JSON.stringify({ note: noteText, activityType: 'note' }),
    });
    setNoteText('');
    await loadActivities();
    setAddingNote(false);
  }

  function startEdit() {
    setEditValues({
      deal_value: deal?.deal_value ?? '',
      assigned_to: deal?.assigned_to ?? '',
      source: deal?.source ?? '',
      probability: deal?.probability ?? '',
      expected_close_date: deal?.expected_close_date ? new Date(deal.expected_close_date).toISOString().slice(0, 10) : '',
      notes: deal?.notes ?? '',
    });
  }

  async function saveEdit() {
    if (!editValues) return;
    setAddingNote(true); // reuse spinner state
    await apiFetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(editValues.deal_value !== '' ? { dealValue: Number(editValues.deal_value) } : {}),
        ...(editValues.assigned_to !== undefined ? { assignedTo: editValues.assigned_to || null } : {}),
        ...(editValues.source !== undefined ? { source: editValues.source || null } : {}),
        ...(editValues.probability !== '' ? { probability: Number(editValues.probability) } : {}),
        ...(editValues.expected_close_date !== undefined ? { expectedCloseDate: editValues.expected_close_date || null } : {}),
        ...(editValues.notes !== undefined ? { notes: editValues.notes || null } : {}),
      }),
    });
    // Re-fetch deal
    const [d, acts] = await Promise.all([
      apiFetch(`/api/deals/${dealId}`),
      apiFetch(`/api/deals/${dealId}/activities`),
    ]);
    setDeal(d);
    setActivities(Array.isArray(acts) ? acts : []);
    setEditValues(null);
    setAddingNote(false);
    if (onUpdated) onUpdated();
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-white shadow-2xl flex flex-col border-l border-neutral-200">
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between shrink-0">
        <div className="flex-1 mr-3">
          {loading ? (
            <div className="h-5 w-32 bg-neutral-200 rounded animate-pulse mb-1"/>
          ) : (
            <>
              <h2 className="text-base font-bold text-neutral-900 leading-tight">
                {deal?.first_name} {deal?.last_name ?? ''}
              </h2>
              {deal?.company_name && <p className="text-sm text-neutral-400">{deal.company_name}</p>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {deal?.contact_id && (
            <button
              onClick={() => onViewContact(deal)}
              className="text-xs font-medium text-primary-600 hover:text-blue-800 border border-blue-200 hover:bg-blue-50 px-2.5 py-1 rounded-lg"
            >
              View Contact
            </button>
          )}
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-2 text-center">
          <p className="text-danger-600 text-sm font-medium">Could not load deal</p>
          <p className="text-neutral-400 text-xs">{loadError}</p>
          <p className="text-neutral-300 text-[10px] font-mono break-all">id: {dealId}</p>
        </div>
      ) : !deal ? (
        <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">Deal not found</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Deal stats grid */}
          <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold">Deal Info</p>
              {editValues === null && (
                <button onClick={startEdit} className="text-xs text-primary-600 hover:text-blue-800 font-medium">Edit</button>
              )}
            </div>
            {editValues === null ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Value</p>
                  <p className="text-lg font-bold text-success-600">{fmtInr(deal.deal_value) || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Stage</p>
                  <span className="text-xs font-semibold text-neutral-700 bg-white border border-neutral-200 px-2 py-0.5 rounded-lg">{deal.stage}</span>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Source</p>
                  <p className="text-sm text-neutral-600">{SOURCE_LABELS[deal.source] ?? deal.source ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Assigned To</p>
                  <p className="text-sm text-neutral-600">{deal.assigned_to ?? '—'}</p>
                </div>
                {deal.probability != null && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Probability</p>
                    <p className="text-sm font-semibold text-primary-600">{deal.probability}%</p>
                  </div>
                )}
                {deal.expected_close_date && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Expected Close</p>
                    <p className="text-sm text-neutral-600">{new Date(deal.expected_close_date).toLocaleDateString('en-IN')}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Pipeline</p>
                  <p className="text-sm text-neutral-600">{deal.pipeline_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">Created</p>
                  <p className="text-sm text-neutral-600">{new Date(deal.created_at).toLocaleDateString('en-IN')}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase text-neutral-400">Value (₹)</label>
                  <input type="number" value={editValues.deal_value} onChange={e => setEditValues({...editValues, deal_value: e.target.value})}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-neutral-400">Assigned To</label>
                  <select value={editValues.assigned_to} onChange={e => setEditValues({...editValues, assigned_to: e.target.value})}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mt-0.5 bg-white">
                    <option value="">Unassigned</option>
                    <option value="jatin">Jatin</option>
                    <option value="saksham">Saksham</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-neutral-400">Source</label>
                  <select value={editValues.source} onChange={e => setEditValues({...editValues, source: e.target.value})}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mt-0.5 bg-white">
                    <option value="">Unknown</option>
                    <option value="form">Website Form</option>
                    <option value="paid_ad">Paid Ad</option>
                    <option value="referral">Referral</option>
                    <option value="cold_outreach">Cold Outreach</option>
                    <option value="checkout">Checkout</option>
                    <option value="inbound">Inbound Call</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-neutral-400">Probability (%)</label>
                  <input type="number" min="0" max="100" value={editValues.probability} onChange={e => setEditValues({...editValues, probability: e.target.value})}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-neutral-400">Expected Close</label>
                  <input type="date" value={editValues.expected_close_date} onChange={e => setEditValues({...editValues, expected_close_date: e.target.value})}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mt-0.5" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-neutral-400">Notes</label>
                  <textarea rows={3} value={editValues.notes} onChange={e => setEditValues({...editValues, notes: e.target.value})}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 mt-0.5" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveEdit} disabled={addingNote}
                    className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-blue-700 rounded-xl disabled:opacity-50">
                    {addingNote ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditValues(null)}
                    className="px-4 py-2 text-sm font-medium text-neutral-600 border border-neutral-200 rounded-xl hover:bg-neutral-50">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          {deal.notes && (
            <div className="px-5 py-3 border-b border-neutral-100">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5">Deal Notes</p>
              <p className="text-sm text-neutral-600">{deal.notes}</p>
            </div>
          )}
          {deal.lost_reason && (
            <div className="px-5 py-3 border-b border-neutral-100 bg-red-50">
              <p className="text-[10px] uppercase tracking-wide text-red-400 mb-1">Lost Reason</p>
              <p className="text-sm text-red-700 font-medium">{deal.lost_reason}</p>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="px-5 py-4">
            <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-3 font-semibold">Activity Timeline</p>
            {activities.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-6">No activity yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-2.5 top-0 bottom-0 w-px bg-neutral-200"/>
                <div className="space-y-4 pl-8">
                  {activities.map((a, i) => (
                    <div key={i} className="relative">
                      <div className="absolute -left-[22px] w-5 h-5 rounded-full bg-white border-2 flex items-center justify-center"
                        style={{ borderColor: a.activity_type === 'stage_change' ? '#3b82f6' : '#64748b' }}>
                        {a.activity_type === 'stage_change' ? (
                          <svg className="w-2.5 h-2.5 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                          </svg>
                        ) : (
                          <svg className="w-2.5 h-2.5 text-neutral-400" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="4"/>
                          </svg>
                        )}
                      </div>
                      <div>
                        {a.activity_type === 'stage_change' ? (
                          <p className="text-sm text-neutral-700">
                            Moved <span className="font-medium text-neutral-500">{a.from_stage}</span>
                            {' → '}
                            <span className="font-semibold text-neutral-800">{a.to_stage}</span>
                          </p>
                        ) : (
                          <p className="text-sm text-neutral-700">{a.note}</p>
                        )}
                        <p className="text-[11px] text-neutral-400 mt-0.5">{fmtDate(a.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add Note */}
            <div className="mt-5 pt-4 border-t border-neutral-100">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                placeholder="Add a note…"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 bg-neutral-50"
              />
              <button
                onClick={addNote}
                disabled={addingNote || !noteText.trim()}
                className="mt-2 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 transition-colors"
              >
                {addingNote ? 'Saving…' : 'Add Note'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PipelinePage
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [pipelinesList, setPipelinesList] = useState([]);
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [kanbanStages, setKanbanStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [wonLostModal, setWonLostModal] = useState(null);
  const [addDealModal, setAddDealModal] = useState(null);
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [filterAge, setFilterAge] = useState('');
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  // Bulk-selection state — Set of deal ids currently checked. Empty Set = selection mode off.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    apiFetch('/api/pipelines').then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setPipelinesList(data);
        setActivePipelineId(data[0].id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const loadDeals = useCallback(async () => {
    if (!activePipelineId) return;
    setLoading(true);
    const url = `/api/pipelines/${activePipelineId}/deals${showArchived ? '?includeArchived=true' : ''}`;
    const data = await apiFetch(url);
    if (data?.stages) setKanbanStages(data.stages);
    setLoading(false);
  }, [activePipelineId, showArchived]);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  // Clear bulk selection when switching pipelines or toggling archived view
  useEffect(() => { setSelectedIds(new Set()); }, [activePipelineId, showArchived]);

  function toggleSelect(dealId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId); else next.add(dealId);
      return next;
    });
  }

  async function bulkArchive() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Archive ${ids.length} deal${ids.length === 1 ? '' : 's'}? They'll disappear from the board.`)) return;
    setBulkBusy(true);
    try {
      const res = await apiFetch('/api/deals/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ dealIds: ids, updates: { archived: true } }),
      });
      if (!res || res.error) throw new Error(res?.error || 'bulk archive failed');
      // Optimistic: drop the archived deals from local state if we're not showing archived
      if (!showArchived) {
        const idSet = new Set(ids);
        setKanbanStages((prev) => prev.map((s) => ({ ...s, deals: s.deals.filter((d) => !idSet.has(d.id)) })));
      } else {
        loadDeals();
      }
      setSelectedIds(new Set());
    } catch (err) {
      window.alert('Failed to archive deals. Reloading the board.');
      loadDeals();
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    if (!showAnalytics || !activePipelineId) return;
    apiFetch(`/api/pipelines/${activePipelineId}/analytics?days=90`)
      .then(d => setAnalytics(d))
      .catch(() => {});
  }, [showAnalytics, activePipelineId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dealId = params.get('dealId');
    if (dealId) setSelectedDealId(dealId);
  }, []);

  const activePipeline = pipelinesList.find((p) => p.id === activePipelineId);
  const totalDeals = kanbanStages.reduce((s, st) => s + st.deals.length, 0);
  const totalValue = kanbanStages.reduce((s, st) => s + (st.totalValue ?? 0), 0);

  async function archiveDeal(dealId, archived) {
    let deal = null;
    for (const s of kanbanStages) { deal = s.deals.find((d) => d.id === dealId); if (deal) break; }
    if (!deal) return;
    await apiFetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { ...(deal.metadata ?? {}), archived } }),
    });
    if (!showArchived) {
      // Remove card from view immediately — no reload needed
      setKanbanStages((prev) =>
        prev.map((s) => ({ ...s, deals: s.deals.filter((d) => d.id !== dealId) }))
      );
    } else {
      loadDeals();
    }
  }

  function applyMove(deal, fromStage, toStage, destIndex) {
    setKanbanStages((prev) => prev.map((s) => {
      if (s.stageName === fromStage) return { ...s, deals: s.deals.filter((d) => d.id !== deal.id) };
      if (s.stageName === toStage) {
        const arr = [...s.deals];
        arr.splice(destIndex, 0, { ...deal, stage: toStage });
        return { ...s, deals: arr };
      }
      return s;
    }));
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const fromStage = source.droppableId;
    const toStage = destination.droppableId;
    const fromData = kanbanStages.find((s) => s.stageName === fromStage);
    const deal = fromData?.deals.find((d) => d.id === draggableId);
    if (!deal) return;
    if (isTerminalStage(toStage)) {
      setWonLostModal({ deal, fromStage, toStage, destIndex: destination.index });
      return;
    }
    applyMove(deal, fromStage, toStage, destination.index);
    await apiFetch(`/api/deals/${draggableId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: toStage }),
    });
  }

  async function confirmWonLost(lostReason, wonNotes) {
    if (!wonLostModal) return;
    const { deal, fromStage, toStage, destIndex } = wonLostModal;
    setWonLostModal(null);
    applyMove(deal, fromStage, toStage, destIndex ?? 0);
    await apiFetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        stage: toStage,
        ...(lostReason ? { lostReason } : {}),
        ...(wonNotes ? { wonNotes } : {}),
      }),
    });
  }

  function openDeal(deal) {
    setSelectedDealId(deal.id);
    setSelectedContact(null);
  }

  function openContactFromDeal(deal) {
    const nameParts = (deal.first_name ? [deal.first_name, deal.last_name].filter(Boolean) : (deal.contactName ?? '').split(' '));
    setSelectedContact({
      id: deal.contact_id ?? deal.contactId,
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || null,
      companyName: deal.company_name ?? deal.companyName ?? null,
      score: deal.score ?? 0,
    });
  }

  function handleDealAdded(deal) {
    loadDeals();
    setAddDealModal(null);
  }

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Pipeline dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-500 shrink-0">Pipeline:</span>
              <div className="relative">
                <select
                  value={activePipelineId ?? ''}
                  onChange={(e) => setActivePipelineId(e.target.value)}
                  className="appearance-none border border-neutral-200 rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-neutral-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 cursor-pointer"
                  style={{ minWidth: 180 }}
                >
                  {pipelinesList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </div>
              </div>
              {totalDeals > 0 && (
                <span className="text-xs text-neutral-400 bg-neutral-100 px-2.5 py-1 rounded-full font-medium">
                  {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
                  {totalValue > 0 && ` · ${fmtInr(totalValue)}`}
                </span>
              )}
              <Link
                to="/pipelines/settings"
                className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
                title="Pipeline Settings"
              >
                <Settings className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex-1" />

            {/* Show archived toggle */}
            <label className="flex items-center gap-2 text-sm text-neutral-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-neutral-300 text-orange-500 focus:ring-orange-400"
              />
              Show archived
            </label>

            {/* Analytics toggle */}
            <button
              onClick={() => setShowAnalytics(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAnalytics ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-neutral-200 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
              </svg>
              Analytics
            </button>

            {/* Add Deal — top right */}
            <button
              onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: kanbanStages[0]?.stageName ?? '' })}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Deal
            </button>
          </div>

          {/* Filters — compact inline row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <select value={filterAssigned} onChange={(e) => setFilterAssigned(e.target.value)}
              className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Owners</option>
              <option value="jatin">Jatin</option>
              <option value="saksham">Saksham</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
              className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Values</option>
              <option value="high">High (10L+)</option>
              <option value="medium">Medium (1-10L)</option>
              <option value="low">Low (&lt; 1L)</option>
            </select>
            <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}
              className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-sky-400">
              <option value="">All Ages</option>
              <option value="stale">Stale (3+ days)</option>
              <option value="week">This Week</option>
              <option value="today">Today</option>
            </select>
            {(filterAssigned || filterValue || filterAge) && (
              <button onClick={() => { setFilterAssigned(''); setFilterValue(''); setFilterAge(''); }}
                className="text-xs text-danger-500 hover:text-red-700 font-medium">Clear</button>
            )}
          </div>
        </div>

        {showAnalytics && analytics && (
          <div className="bg-white border-b border-neutral-100 px-6 py-3 shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Weighted Forecast', value: analytics.forecast > 0 ? fmtInr(analytics.forecast) : '₹0', color: 'text-success-600' },
                { label: 'Win Rate', value: `${Math.round(analytics.winRate * 100)}%`, color: 'text-primary-600' },
                { label: 'Avg Cycle', value: analytics.avgCycleDays ? `${analytics.avgCycleDays}d` : '—', color: 'text-violet-600' },
                { label: 'Open Deals', value: `${analytics.openCount}`, color: 'text-neutral-700' },
              ].map(kpi => (
                <div key={kpi.label} className="bg-neutral-50 rounded-xl px-4 py-3 border border-neutral-100">
                  <p className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{kpi.label}</p>
                  <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
            {analytics.byStage?.length > 0 && (
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                {analytics.byStage.map(s => (
                  <div key={s.stage} className="shrink-0 bg-neutral-50 rounded-lg px-3 py-1.5 border border-neutral-100 text-xs">
                    <span className="font-medium text-neutral-700">{s.stage}</span>
                    <span className="text-neutral-400 ml-2">{s.count} deals</span>
                    {s.value > 0 && <span className="text-success-600 ml-2">{fmtInr(s.value)}</span>}
                    <span className="text-warning-500 ml-2">{s.avg_age_days}d avg</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {pipelinesList.length === 0 && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-neutral-700 mb-2">No pipelines yet</h3>
            <Link to="/pipelines/settings" className="text-sm font-medium text-orange-500 hover:text-orange-700">
              Create your first pipeline &rarr;
            </Link>
          </div>
        ) : loading ? (
          <div className="flex gap-3 px-4 py-4 overflow-x-auto">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="min-w-[220px] w-[220px] shrink-0 rounded-xl border border-neutral-200 bg-neutral-100 animate-pulse h-64"/>
            ))}
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-3 px-4 py-4 overflow-x-auto snap-x snap-mandatory md:overflow-x-visible flex-1">
              {kanbanStages.map((stageData, stageIndex) => {
                const { color, light } = getStageStyle(stageData.stageName, stageIndex);
                const stageDeals = (stageData.deals ?? []).filter(deal => {
                  if (filterAssigned) {
                    if (filterAssigned === 'unassigned' && deal.assignedTo) return false;
                    if (filterAssigned !== 'unassigned' && deal.assignedTo?.toLowerCase() !== filterAssigned) return false;
                  }
                  if (filterValue) {
                    const v = Number(deal.dealValue || 0);
                    if (filterValue === 'high' && v < 1000000) return false;
                    if (filterValue === 'medium' && (v < 100000 || v >= 1000000)) return false;
                    if (filterValue === 'low' && v >= 100000) return false;
                  }
                  if (filterAge) {
                    const days = daysAgo(deal.updatedAt || deal.createdAt);
                    if (filterAge === 'stale' && days < 3) return false;
                    if (filterAge === 'week' && days > 7) return false;
                    if (filterAge === 'today' && days > 0) return false;
                  }
                  return true;
                });
                return (
                  <div key={stageData.stageName} className={`snap-center min-w-[85vw] md:min-w-[220px] flex flex-col rounded-xl border ${light} w-[220px] shrink-0`}>
                    {/* Column header */}
                    <div
                      className="rounded-t-xl px-3 py-2.5"
                      style={{ background: color }}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <h2 className="text-white font-semibold text-xs uppercase tracking-wide truncate flex-1 mr-1">
                          {stageData.stageName}
                        </h2>
                        <span className="bg-white/25 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0">
                          {stageDeals.length}
                        </span>
                      </div>
                      {stageData.totalValue > 0 && (
                        <p className="text-white/75 text-[10px] font-medium">{fmtInr(stageData.totalValue)}</p>
                      )}
                    </div>

                    {/* Droppable */}
                    <Droppable droppableId={stageData.stageName}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 p-2 space-y-2 min-h-[100px] rounded-b-xl transition-colors ${snapshot.isDraggingOver ? 'bg-white/70' : ''}`}
                        >
                          {stageDeals.map((deal, index) => (
                            <DealCard
                              key={deal.id}
                              deal={deal}
                              index={index}
                              onClick={() => openDeal(deal)}
                              onArchive={() => archiveDeal(deal.id, true)}
                              onUnarchive={() => archiveDeal(deal.id, false)}
                              selected={selectedIds.has(deal.id)}
                              onToggleSelect={() => toggleSelect(deal.id)}
                              selectionMode={selectedIds.size > 0}
                            />
                          ))}
                          {provided.placeholder}
                          {stageDeals.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-center text-xs text-neutral-300 py-2">Empty</p>
                          )}
                        </div>
                      )}
                    </Droppable>

                    {/* Add deal button */}
                    <div className="px-2 pb-2 shrink-0">
                      <button
                        onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: stageData.stageName })}
                        className="w-full text-xs text-neutral-400 hover:text-neutral-600 hover:bg-white border border-dashed border-neutral-200 hover:border-neutral-300 rounded-lg py-1.5 transition-colors"
                      >
                        + Add Deal
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </main>

      {/* Floating bulk-action bar — visible whenever at least one deal is selected */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-white border border-neutral-200 shadow-xl rounded-2xl px-4 py-2.5 flex items-center gap-3">
          <span className="text-sm font-medium text-neutral-700">
            {selectedIds.size} selected
          </span>
          <div className="w-px h-5 bg-neutral-200" />
          <button
            onClick={bulkArchive}
            disabled={bulkBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 hover:text-danger-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
            title="Archive selected deals"
          >
            <Archive className="w-4 h-4" />
            {bulkBusy ? 'Archiving…' : 'Archive'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkBusy}
            className="flex items-center gap-1 px-2 py-1.5 text-sm text-neutral-400 hover:text-neutral-700 rounded-lg transition-colors disabled:opacity-50"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {wonLostModal && (
        <WonLostModal
          stageName={wonLostModal.toStage}
          contactName={wonLostModal.deal.contactName ?? 'this contact'}
          onConfirm={confirmWonLost}
          onCancel={() => setWonLostModal(null)}
        />
      )}

      {addDealModal && (
        <AddDealModal
          pipelineId={addDealModal.pipelineId}
          stageName={addDealModal.stageName}
          onAdded={handleDealAdded}
          onClose={() => setAddDealModal(null)}
        />
      )}

      {selectedDealId && !selectedContact && (
        <DealDetailSlideIn
          dealId={selectedDealId}
          onClose={() => setSelectedDealId(null)}
          onViewContact={openContactFromDeal}
          onUpdated={loadDeals}
        />
      )}

      {selectedContact && (
        <ContactSlideIn
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdated={() => { loadDeals(); setSelectedContact(null); }}
        />
      )}
    </div>
  );
}
