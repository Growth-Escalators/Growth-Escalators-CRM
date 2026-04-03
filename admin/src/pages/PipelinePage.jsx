import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getStageStyle(stageName, index) {
  const PALETTE = [
    { color: '#64748b', light: 'bg-slate-50 border-slate-200' },
    { color: '#3b82f6', light: 'bg-blue-50 border-blue-200' },
    { color: '#6366f1', light: 'bg-indigo-50 border-indigo-200' },
    { color: '#8b5cf6', light: 'bg-violet-50 border-violet-200' },
    { color: '#0ea5e9', light: 'bg-sky-50 border-sky-200' },
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
  return lc.includes('won') || lc.includes('lost');
}
function isWonStage(name) { return (name ?? '').toLowerCase().includes('won'); }
function isLostStage(name) { return (name ?? '').toLowerCase().includes('lost'); }

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
function DealCard({ deal, index, onClick, onArchive, onUnarchive }) {
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
    ? 'bg-red-100 text-red-600'
    : 'bg-slate-100 text-slate-400';

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={`bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md cursor-pointer transition-all relative select-none ${snapshot.isDragging ? 'shadow-xl rotate-1 scale-105' : ''} ${isArchived ? 'opacity-60' : ''}`}
          style={{ width: 220, ...provided.draggableProps.style }}
        >
          {/* Row 1: name + days + menu */}
          <div className="flex items-start justify-between gap-1 mb-0.5">
            <p className="text-sm font-bold text-slate-900 leading-tight line-clamp-1 flex-1">
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
                  className="text-slate-300 hover:text-slate-500 p-0.5 rounded"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute top-5 right-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                    {isArchived ? (
                      <button onClick={() => { onUnarchive(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Unarchive</button>
                    ) : (
                      <button onClick={() => { onArchive(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">Archive</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Company */}
          {deal.companyName && (
            <p className="text-xs text-slate-400 mb-1.5 line-clamp-1">{deal.companyName}</p>
          )}

          {/* Bottom row */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              {fmtInr(deal.dealValue) && (
                <span className="text-xs font-semibold text-green-600">{fmtInr(deal.dealValue)}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-[10px] text-slate-400 ${days > 3 ? 'text-red-400' : ''}`}>{days}d</span>
              {deal.assignedTo ? (
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold uppercase"
                  style={{ background: ASSIGNEE_COLORS[deal.assignedTo.toLowerCase()] ?? stringToColor(deal.assignedTo) }}
                  title={deal.assignedTo}
                >
                  {deal.assignedTo[0]}
                </span>
              ) : (
                <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 text-[9px]">?</span>
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
  const [lostReason, setLostReason] = useState('');
  const [notes, setNotes] = useState('');
  const canConfirm = won || !!lostReason;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${won ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {won ? (
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            ) : (
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            )}
          </div>
          <h2 className="text-lg font-bold text-slate-900">
            {won ? 'Deal Won!' : 'Why was this deal lost?'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {contactName} &rarr; <span className="font-medium text-slate-700">{stageName}</span>
          </p>

          {!won && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Reason <span className="text-red-500">*</span>
              </label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                <option value="">Select a reason…</option>
                {LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {won ? 'Notes about this win?' : 'Additional notes'} <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={won ? 'What made this deal happen?' : 'Any additional context…'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-white">
            Cancel
          </button>
          {won && (
            <button onClick={() => onConfirm(null, null)} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-white">
              Skip
            </button>
          )}
          <button
            onClick={() => onConfirm(lostReason || null, notes || null)}
            disabled={!canConfirm}
            className={`px-5 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${won ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {won ? 'Save & Confirm' : 'Mark as Lost'}
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
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (search.length < 2) { setContacts([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const d = await apiFetch(`/contacts?search=${encodeURIComponent(search)}&limit=10`);
      setContacts(d?.contacts ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function handleAdd() {
    if (!selectedContact) return;
    setSaving(true);
    const result = await apiFetch('/deals/add-or-update', {
      method: 'POST',
      body: JSON.stringify({
        contactId: selectedContact.id,
        pipelineId,
        stage: stageName,
        title: `${selectedContact.firstName} ${selectedContact.lastName ?? ''} — opportunity`.trim(),
        ...(dealValue ? { dealValue: parseInt(dealValue, 10) } : {}),
        ...(assignedTo ? { assignedTo } : {}),
      }),
    });
    setSaving(false);
    if (result?.deal) onAdded(result.deal);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add Deal</h2>
            <p className="text-sm text-slate-400 mt-0.5">Stage: <span className="font-medium text-slate-600">{stageName}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact <span className="text-red-500">*</span></label>
            {selectedContact ? (
              <div className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2.5 bg-blue-50">
                <span className="text-sm font-medium text-blue-800">{selectedContact.firstName} {selectedContact.lastName ?? ''}</span>
                <button onClick={() => { setSelectedContact(null); setSearch(''); }} className="text-blue-400 hover:text-blue-600 text-xs">Change</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contact name..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {(searching || contacts.length > 0) && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searching && <p className="px-3 py-2 text-sm text-slate-400">Searching…</p>}
                    {contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedContact(c); setSearch(''); setContacts([]); }}
                        className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <span className="font-medium">{c.firstName} {c.lastName ?? ''}</span>
                        {c.phone && <span className="text-slate-400 text-xs">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Deal Value (&#8377;) <span className="text-slate-400 font-normal">(optional)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">&#8377;</span>
              <input
                type="number"
                min="0"
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
                placeholder="0"
                className="w-full border border-slate-200 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Assigned To</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              <option value="jatin">Jatin</option>
              <option value="saksham">Saksham</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-white">Cancel</button>
          <button
            onClick={handleAdd}
            disabled={saving || !selectedContact}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
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
// Main PipelinePage
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [pipelinesList, setPipelinesList] = useState([]);
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [kanbanStages, setKanbanStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);
  const [wonLostModal, setWonLostModal] = useState(null);
  const [addDealModal, setAddDealModal] = useState(null);

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

  const activePipeline = pipelinesList.find((p) => p.id === activePipelineId);
  const totalDeals = kanbanStages.reduce((s, st) => s + st.deals.length, 0);
  const totalValue = kanbanStages.reduce((s, st) => s + (st.totalValue ?? 0), 0);

  async function archiveDeal(dealId, archived) {
    let deal = null;
    for (const s of kanbanStages) { deal = s.deals.find((d) => d.id === dealId); if (deal) break; }
    if (!deal) return;
    await apiFetch(`/deals/${dealId}`, {
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
    await apiFetch(`/deals/${draggableId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: toStage }),
    });
  }

  async function confirmWonLost(lostReason, wonNotes) {
    if (!wonLostModal) return;
    const { deal, fromStage, toStage, destIndex } = wonLostModal;
    setWonLostModal(null);
    applyMove(deal, fromStage, toStage, destIndex ?? 0);
    await apiFetch(`/deals/${deal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        stage: toStage,
        ...(lostReason ? { lostReason } : {}),
        ...(wonNotes ? { wonNotes } : {}),
      }),
    });
  }

  function openContact(deal) {
    const nameParts = (deal.contactName ?? '').split(' ');
    setSelectedContact({
      id: deal.contactId,
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || null,
      companyName: deal.companyName ?? null,
      score: deal.score ?? 0,
    });
  }

  function handleDealAdded(deal) {
    loadDeals();
    setAddDealModal(null);
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Pipeline dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-500 shrink-0">Pipeline:</span>
              <div className="relative">
                <select
                  value={activePipelineId ?? ''}
                  onChange={(e) => setActivePipelineId(e.target.value)}
                  className="appearance-none border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400 cursor-pointer"
                  style={{ minWidth: 180 }}
                >
                  {pipelinesList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </div>
              </div>
              {totalDeals > 0 && (
                <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                  {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
                  {totalValue > 0 && ` · ${fmtInr(totalValue)}`}
                </span>
              )}
              <Link
                to="/pipelines/settings"
                className="text-xs text-orange-500 hover:text-orange-700 font-medium ml-1 flex items-center gap-1"
              >
                Manage Pipelines &rarr;
              </Link>
            </div>

            <div className="flex-1"/>

            {/* Show archived toggle */}
            <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-slate-300 text-orange-500 focus:ring-orange-400"
              />
              Show archived
            </label>
          </div>
        </div>

        {pipelinesList.length === 0 && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">No pipelines yet</h3>
            <Link to="/pipelines/settings" className="text-sm font-medium text-orange-500 hover:text-orange-700">
              Create your first pipeline &rarr;
            </Link>
          </div>
        ) : loading ? (
          <div className="flex gap-3 px-4 py-4 overflow-x-auto">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="min-w-[220px] w-[220px] shrink-0 rounded-xl border border-slate-200 bg-slate-100 animate-pulse h-64"/>
            ))}
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            {totalDeals === 0 && (
              <div className="text-center py-16">
                <p className="text-slate-400 text-lg mb-3">No deals yet</p>
                <p className="text-slate-400 text-sm mb-4">Add your first deal to get started</p>
                <button onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: kanbanStages[0]?.stageName ?? '' })} className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700">+ Add Deal</button>
              </div>
            )}
            <div className="flex gap-3 px-4 py-4 overflow-x-auto snap-x snap-mandatory md:overflow-x-visible flex-1">
              {kanbanStages.map((stageData, stageIndex) => {
                const { color, light } = getStageStyle(stageData.stageName, stageIndex);
                const stageDeals = stageData.deals ?? [];
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
                              onClick={() => openContact(deal)}
                              onArchive={() => archiveDeal(deal.id, true)}
                              onUnarchive={() => archiveDeal(deal.id, false)}
                            />
                          ))}
                          {provided.placeholder}
                          {stageDeals.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-center text-xs text-slate-300 py-2">Empty</p>
                          )}
                        </div>
                      )}
                    </Droppable>

                    {/* Add deal button */}
                    <div className="px-2 pb-2 shrink-0">
                      <button
                        onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: stageData.stageName })}
                        className="w-full text-xs text-slate-400 hover:text-slate-600 hover:bg-white border border-dashed border-slate-200 hover:border-slate-300 rounded-lg py-1.5 transition-colors"
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
