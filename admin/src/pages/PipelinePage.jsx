import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Settings, Archive, ChevronLeft, ChevronRight, RotateCcw, Trash2, X } from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import DealDrawer from '../components/DealDrawer.jsx';
import { apiFetch } from '../lib/api.js';
import { productPath } from '../lib/auth.js';
import { isAbandonedOutcome, isLostOutcome, isTerminalOutcome, isWonOutcome } from '../lib/pipelineStageOutcomes.js';
import { safeInitial, safeLower, safeText } from '../lib/safe.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const TRASH_RESTORE_DAYS = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getStageStyle(stageName, index, stageOutcome = 'open') {
  if (stageOutcome === 'won') return { color: '#22c55e', light: 'bg-success-500/10 border-success-500/20' };
  if (stageOutcome === 'lost') return { color: '#dc2626', light: 'bg-danger-500/10 border-danger-500/20' };
  if (stageOutcome === 'abandoned') return { color: '#f59e0b', light: 'bg-warning-500/10 border-warning-500/20' };

  const lc = safeLower(stageName);
  if (lc.includes('proposal')) return { color: '#f97316', light: 'bg-accent-50 border-accent-200' };
  if (lc.includes('discovery')) return { color: '#1d4ed8', light: 'bg-primary-50 border-primary-200' };
  if (lc.includes('qualified')) return { color: '#3b82f6', light: 'bg-primary-50 border-primary-200' };
  if (lc.includes('new') || lc.includes('lead')) return { color: '#94a3b8', light: 'bg-neutral-50 border-neutral-200' };

  const PALETTE = [
    { color: '#64748b', light: 'bg-neutral-50 border-neutral-200' },
    { color: '#3b82f6', light: 'bg-primary-50 border-primary-200' },
    { color: '#1d4ed8', light: 'bg-primary-50 border-primary-200' },
    { color: '#f97316', light: 'bg-accent-50 border-accent-200' },
    { color: '#22c55e', light: 'bg-success-500/10 border-success-500/20' },
  ];
  return PALETTE[index % PALETTE.length];
}

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

function trashDaysRemaining(dateStr) {
  if (!dateStr) return TRASH_RESTORE_DAYS;
  return Math.max(0, TRASH_RESTORE_DAYS - daysAgo(dateStr));
}

function isTrashRestoreExpired(dateStr) {
  if (!dateStr) return false;
  return daysAgo(dateStr) >= TRASH_RESTORE_DAYS;
}

function fmtInr(val) {
  if (!val || val <= 0) return null;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  return `₹${Number(val).toLocaleString('en-IN')}`;
}

function stringToColor(str = '') {
  str = safeText(str);
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}

function withRecalculatedValue(stage, deals) {
  return {
    ...stage,
    deals,
    totalValue: deals.reduce((sum, deal) => sum + Number(deal.dealValue || 0), 0),
  };
}

function filterStagesForView(stages, { showArchived, showTrash }) {
  return stages.map((stage) => {
    const visibleDeals = (stage.deals ?? []).filter((deal) => {
      const deleted = Boolean(deal.metadata?.deletedAt);
      if (showTrash) return deleted;
      if (showArchived) return !deleted;
      return true;
    });
    return withRecalculatedValue(stage, visibleDeals);
  });
}

const ASSIGNEE_COLORS = { jatin: '#F97316', saksham: '#3B82F6' };

// ---------------------------------------------------------------------------
// DealCard
// ---------------------------------------------------------------------------
function DealCard({
  deal,
  index,
  onClick,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  selected = false,
  onToggleSelect,
  selectionMode = false,
}) {
  const days = daysAgo(deal.updatedAt || deal.createdAt);
  const isArchived = deal.metadata?.archived === true;
  const isDeleted = Boolean(deal.metadata?.deletedAt);
  const restoreExpired = isDeleted && isTrashRestoreExpired(deal.metadata?.deletedAt);
  const restoreDaysLeft = isDeleted ? trashDaysRemaining(deal.metadata?.deletedAt) : null;
  const assignedTo = safeText(deal.assignedTo);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const scoreColor = deal.score >= 70
    ? 'bg-success-500/10 text-success-700'
    : deal.score >= 40
    ? 'bg-warning-500/10 text-warning-700'
    : deal.score > 0
    ? 'bg-danger-500/10 text-danger-600'
    : 'bg-neutral-100 text-neutral-500';

  return (
    <Draggable draggableId={deal.id} index={index} isDragDisabled={selectionMode || isDeleted}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={(e) => {
            if (selectionMode && onToggleSelect) {
              onToggleSelect();
              return;
            }
            onClick?.(e);
          }}
          className={`w-full bg-white rounded-xl border p-3 shadow-sm hover:shadow-md cursor-pointer transition-all relative select-none ${selected ? 'border-primary-400 ring-2 ring-primary-200' : 'border-neutral-200'} ${snapshot.isDragging ? 'shadow-xl rotate-1 scale-[1.02]' : ''} ${isDeleted ? 'opacity-80 border-danger-200' : isArchived ? 'opacity-60' : ''}`}
          style={provided.draggableProps.style}
        >
          <div className="flex items-start justify-between gap-1 mb-0.5">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
                className="mt-0.5 mr-1 rounded border-neutral-300 text-primary-500 focus:ring-primary-400 cursor-pointer"
                aria-label={`Select ${deal.contactName ?? 'deal'}`}
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
                  aria-label={`Actions for deal ${deal.contactName ?? 'Unknown'}`}
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute top-5 right-0 z-30 bg-white border border-neutral-200 rounded-xl shadow-lg py-1 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                    {isDeleted ? (
                      <button
                        onClick={() => { if (!restoreExpired) onRestore?.(); setMenuOpen(false); }}
                        disabled={restoreExpired}
                        className="w-full text-left px-3 py-2 text-sm text-primary-700 hover:bg-primary-50 flex items-center gap-2 disabled:text-neutral-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> {restoreExpired ? 'Restore window expired' : 'Restore'}
                      </button>
                    ) : (
                      <>
                        {isArchived ? (
                          <button onClick={() => { onUnarchive?.(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                            Unarchive
                          </button>
                        ) : (
                          <button onClick={() => { onArchive?.(); setMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                            Archive
                          </button>
                        )}
                        <button
                          onClick={() => { onDelete?.(); setMenuOpen(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-danger-600 hover:bg-danger-500/10 flex items-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Move to Trash
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {deal.companyName && (
            <p className="text-xs text-neutral-500 mb-1.5 line-clamp-1">{deal.companyName}</p>
          )}

          {isDeleted && (
            <div className="mt-2 mb-1 flex items-center gap-1.5 text-[10px] font-medium text-danger-600">
              <Trash2 className="w-3 h-3" />
              {restoreExpired ? 'Restore window expired' : `${restoreDaysLeft}d left in restore window`}
            </div>
          )}

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              {fmtInr(deal.dealValue) && (
                <span className="text-xs font-semibold text-success-700">{fmtInr(deal.dealValue)}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-[10px] text-neutral-500 ${days > 3 ? 'text-danger-600' : ''}`}>{days}d</span>
              {assignedTo ? (
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold uppercase"
                  style={{ background: ASSIGNEE_COLORS[safeLower(assignedTo)] ?? stringToColor(assignedTo) }}
                  title={assignedTo}
                >
                  {safeInitial(assignedTo)}
                </span>
              ) : (
                <span className="w-5 h-5 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-600 text-[9px]">?</span>
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

function WonLostModal({ stageName, stageOutcome, contactName, onConfirm, onCancel }) {
  const won = isWonOutcome(stageOutcome);
  const abandoned = isAbandonedOutcome(stageOutcome);
  const lost = isLostOutcome(stageOutcome);
  const [lostReason, setLostReason] = useState('');
  const [notes, setNotes] = useState('');
  const canConfirm = won || abandoned || !!lostReason;

  const title = won ? 'Deal Won!' : abandoned ? 'Mark as Abandoned?' : 'Why was this deal lost?';
  const btnClass = won ? 'bg-success-600 hover:bg-success-700' : abandoned ? 'bg-warning-500 hover:bg-warning-600' : 'bg-danger-600 hover:opacity-90';
  const btnLabel = won ? 'Save & Confirm' : abandoned ? 'Mark Abandoned' : 'Mark as Lost';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
          <p className="text-sm text-neutral-500 mt-1">
            {contactName} &rarr; <span className="font-medium text-neutral-700">{stageName}</span>
          </p>

          {lost && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Reason <span className="text-danger-600">*</span>
              </label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-danger-500"
                aria-label="Reason"
              >
                <option value="">Select a reason…</option>
                {LOST_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </div>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              {won ? 'Notes about this win?' : 'Additional notes'} <span className="text-neutral-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={won ? 'What made this deal happen?' : 'Any additional context…'}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
              aria-label={won ? 'Notes about this win' : 'Additional notes'}
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
    if (search.length < 2) {
      setContacts([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`);
        setContacts(data?.contacts ?? []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleAdd() {
    if (!selectedContact) return;
    setSaving(true);
    try {
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
      if (result?.deal) onAdded(result.deal);
      else onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-neutral-100">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">Add Deal</h2>
            <p className="text-sm text-neutral-500 mt-0.5">Stage: <span className="font-medium text-neutral-600">{stageName}</span></p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Contact <span className="text-danger-600">*</span></label>
            {selectedContact ? (
              <div className="flex items-center justify-between border border-neutral-200 rounded-lg px-3 py-2.5 bg-primary-50">
                <span className="text-sm font-medium text-primary-800">{selectedContact.firstName} {selectedContact.lastName ?? ''}</span>
                <button onClick={() => { setSelectedContact(null); setSearch(''); }} className="text-primary-700 hover:text-primary-800 text-xs">Change</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contact name..."
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  aria-label="Search contact"
                />
                {(searching || contacts.length > 0) && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {searching && <p className="px-3 py-2 text-sm text-neutral-500">Searching…</p>}
                    {contacts.map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => { setSelectedContact(contact); setSearch(''); setContacts([]); }}
                        className="w-full text-left px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
                      >
                        <span className="font-medium">{contact.firstName} {contact.lastName ?? ''}</span>
                        {contact.phone && <span className="text-neutral-500 text-xs">{contact.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Deal Value (&#8377;) <span className="text-neutral-500 font-normal">(optional)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">&#8377;</span>
              <input
                type="number"
                min="0"
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value)}
                placeholder="0"
                className="w-full border border-neutral-200 rounded-lg pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                aria-label="Deal value in rupees"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Assigned To</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Assigned To"
            >
              <option value="">Unassigned</option>
              <option value="jatin">Jatin</option>
              <option value="saksham">Saksham</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Source <span className="text-neutral-500 font-normal">(optional)</span></label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Source"
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
            className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? 'Adding…' : 'Add Deal'}
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
  const { showSuccess, showError } = useToast();
  const boardRef = useRef(null);
  const [pipelinesList, setPipelinesList] = useState([]);
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [kanbanStages, setKanbanStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [wonLostModal, setWonLostModal] = useState(null);
  const [addDealModal, setAddDealModal] = useState(null);
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [filterAge, setFilterAge] = useState('');
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState([]);

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch('/api/pipelines');
      if (Array.isArray(data) && data.length > 0) {
        setPipelinesList(data);
        setActivePipelineId((current) => data.some((pipeline) => pipeline.id === current) ? current : data[0].id);
      } else {
        setPipelinesList([]);
        setActivePipelineId(null);
        setKanbanStages([]);
      }
    } catch (error) {
      setPipelinesList([]);
      setActivePipelineId(null);
      setKanbanStages([]);
      setLoadError(error?.message || 'Unable to load pipelines.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPipelines(); }, [loadPipelines]);

  const loadDeals = useCallback(async () => {
    if (!activePipelineId) return;
    setLoading(true);
    setLoadError('');
    try {
      const includeArchived = showArchived || showTrash;
      const url = `/api/pipelines/${activePipelineId}/deals${includeArchived ? '?includeArchived=true' : ''}`;
      const data = await apiFetch(url);
      const stages = Array.isArray(data?.stages) ? data.stages : [];
      setKanbanStages(filterStagesForView(stages, { showArchived, showTrash }));
    } catch (error) {
      setKanbanStages([]);
      setLoadError(error?.message || 'Unable to load pipeline deals.');
    } finally {
      setLoading(false);
    }
  }, [activePipelineId, showArchived, showTrash]);

  useEffect(() => { loadDeals(); }, [loadDeals]);
  useEffect(() => { setSelectedIds(new Set()); }, [activePipelineId, showArchived, showTrash]);

  useEffect(() => {
    if (!showAnalytics || !activePipelineId) return;
    apiFetch(`/api/pipelines/${activePipelineId}/analytics?days=90`)
      .then((data) => setAnalytics(data))
      .catch(() => {});
  }, [showAnalytics, activePipelineId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dealId = params.get('dealId');
    if (dealId) setSelectedDealId(dealId);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('newDeal') !== '1') return;
    if (!activePipelineId || kanbanStages.length === 0) return;
    setAddDealModal({ pipelineId: activePipelineId, stageName: kanbanStages[0]?.stageName ?? '' });
    params.delete('newDeal');
    const rest = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  }, [activePipelineId, kanbanStages]);

  const totalDeals = kanbanStages.reduce((sum, stage) => sum + (Array.isArray(stage.deals) ? stage.deals.length : 0), 0);
  const totalValue = kanbanStages.reduce((sum, stage) => sum + Number(stage.totalValue ?? 0), 0);

  function toggleSelect(dealId) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  function findDeal(dealId) {
    for (const stage of kanbanStages) {
      const deal = (stage.deals ?? []).find((candidate) => candidate.id === dealId);
      if (deal) return deal;
    }
    return null;
  }

  const selectedTrashHasExpired = showTrash && Array.from(selectedIds).some((id) => {
    const deal = findDeal(id);
    return isTrashRestoreExpired(deal?.metadata?.deletedAt);
  });

  function removeDealsLocally(ids) {
    const idSet = new Set(ids);
    setKanbanStages((previous) => previous.map((stage) => {
      const deals = (stage.deals ?? []).filter((deal) => !idSet.has(deal.id));
      return withRecalculatedValue(stage, deals);
    }));
  }

  function scrollBoard(direction) {
    boardRef.current?.scrollBy({ left: direction * 330, behavior: 'smooth' });
  }

  function requestDelete(ids) {
    if (!ids?.length) return;
    setPendingDeleteIds(Array.from(ids));
  }

  async function runDeleteToTrash() {
    const ids = pendingDeleteIds;
    if (ids.length === 0) return;
    const deletedAt = new Date().toISOString();
    setBulkBusy(true);
    try {
      await Promise.all(ids.map(async (id) => {
        const deal = findDeal(id);
        if (!deal) return;
        await apiFetch(`/api/deals/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            metadata: {
              ...(deal.metadata ?? {}),
              archived: true,
              deletedAt,
              deletedWasArchived: deal.metadata?.archived === true,
            },
          }),
        });
      }));
      removeDealsLocally(ids);
      setSelectedIds(new Set());
      setPendingDeleteIds([]);
      showSuccess(`Moved ${ids.length} deal${ids.length === 1 ? '' : 's'} to Trash`);
    } catch (error) {
      setPendingDeleteIds([]);
      showError('Could not move every deal to Trash. Reloading the board.');
      loadDeals();
    } finally {
      setBulkBusy(false);
    }
  }

  async function restoreDeals(ids) {
    if (!ids?.length) return;
    const dealsToRestore = Array.from(ids).map((id) => findDeal(id)).filter(Boolean);
    if (dealsToRestore.some((deal) => isTrashRestoreExpired(deal.metadata?.deletedAt))) {
      showError(`One or more selected deals are past the ${TRASH_RESTORE_DAYS}-day restore window.`);
      return;
    }

    setBulkBusy(true);
    try {
      await Promise.all(dealsToRestore.map(async (deal) => {
        const wasArchived = deal.metadata?.deletedWasArchived === true;
        await apiFetch(`/api/deals/${deal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            metadata: {
              ...(deal.metadata ?? {}),
              archived: wasArchived,
              deletedAt: null,
              deletedWasArchived: null,
            },
          }),
        });
      }));
      removeDealsLocally(dealsToRestore.map((deal) => deal.id));
      setSelectedIds(new Set());
      showSuccess(`Restored ${dealsToRestore.length} deal${dealsToRestore.length === 1 ? '' : 's'}`);
    } catch (error) {
      showError('Could not restore every deal. Reloading the Trash view.');
      loadDeals();
    } finally {
      setBulkBusy(false);
    }
  }

  async function archiveDeal(dealId, archived) {
    const deal = findDeal(dealId);
    if (!deal) return;
    try {
      await apiFetch(`/api/deals/${dealId}`, {
        method: 'PATCH',
        body: JSON.stringify({ metadata: { ...(deal.metadata ?? {}), archived } }),
      });
      if (!showArchived) removeDealsLocally([dealId]);
      else loadDeals();
    } catch (error) {
      showError(archived ? 'Could not archive this deal.' : 'Could not unarchive this deal.');
      loadDeals();
    }
  }

  async function runBulkArchive() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const response = await apiFetch('/api/deals/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ dealIds: ids, updates: { archived: true } }),
      });
      if (!response || response.error) throw new Error(response?.error || 'bulk archive failed');
      if (!showArchived) removeDealsLocally(ids);
      else loadDeals();
      setSelectedIds(new Set());
      setConfirmArchive(false);
      showSuccess(`Archived ${ids.length} deal${ids.length === 1 ? '' : 's'}`);
    } catch (error) {
      setConfirmArchive(false);
      showError('Failed to archive deals. Reloading the board.');
      loadDeals();
    } finally {
      setBulkBusy(false);
    }
  }

  function applyMove(deal, fromStage, toStage, destIndex) {
    setKanbanStages((previous) => previous.map((stage) => {
      if (stage.stageName === fromStage) {
        const deals = (stage.deals ?? []).filter((candidate) => candidate.id !== deal.id);
        return withRecalculatedValue(stage, deals);
      }
      if (stage.stageName === toStage) {
        const deals = [...(stage.deals ?? [])];
        deals.splice(destIndex, 0, { ...deal, stage: toStage });
        return withRecalculatedValue(stage, deals);
      }
      return stage;
    }));
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const fromStage = source.droppableId;
    const toStage = destination.droppableId;
    const fromData = kanbanStages.find((stage) => stage.stageName === fromStage);
    const toData = kanbanStages.find((stage) => stage.stageName === toStage);
    const deal = fromData?.deals?.find((candidate) => candidate.id === draggableId);
    if (!deal) return;

    if (isTerminalOutcome(toData?.stageOutcome)) {
      setWonLostModal({
        deal,
        fromStage,
        toStage,
        toStageLabel: toData.stageLabel || toData.stageName,
        stageOutcome: toData.stageOutcome,
        destIndex: destination.index,
      });
      return;
    }

    applyMove(deal, fromStage, toStage, destination.index);
    try {
      await apiFetch(`/api/deals/${draggableId}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: toStage }),
      });
    } catch (error) {
      showError('Could not move this deal. Reloading the board.');
      loadDeals();
    }
  }

  async function confirmWonLost(lostReason, wonNotes) {
    if (!wonLostModal) return;
    const { deal, fromStage, toStage, destIndex } = wonLostModal;
    setWonLostModal(null);
    applyMove(deal, fromStage, toStage, destIndex ?? 0);
    try {
      await apiFetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          stage: toStage,
          ...(lostReason ? { lostReason } : {}),
          ...(wonNotes ? { wonNotes } : {}),
        }),
      });
    } catch (error) {
      showError('Could not update the deal outcome. Reloading the board.');
      loadDeals();
    }
  }

  function openDeal(deal) {
    setSelectedDealId(deal.id);
    setSelectedContact(null);
  }

  function openContactFromDeal(deal) {
    const nameParts = deal.first_name
      ? [deal.first_name, deal.last_name].filter(Boolean)
      : (deal.contactName ?? '').split(' ');
    setSelectedContact({
      id: deal.contact_id ?? deal.contactId,
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || null,
      companyName: deal.company_name ?? deal.companyName ?? null,
      score: deal.score ?? 0,
    });
  }

  function handleDealAdded() {
    loadDeals();
    setAddDealModal(null);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="bg-white border-b px-6 py-4 shrink-0">
          <h1 className="sr-only">Pipeline</h1>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-500 shrink-0">Pipeline:</span>
              <div className="relative">
                <select
                  value={activePipelineId ?? ''}
                  onChange={(e) => setActivePipelineId(e.target.value)}
                  className="appearance-none border border-neutral-200 rounded-xl pl-3 pr-8 py-2 text-sm font-semibold text-neutral-800 bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 cursor-pointer"
                  style={{ minWidth: 180 }}
                  aria-label="Pipeline"
                >
                  {pipelinesList.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </div>
              </div>
              {totalDeals > 0 && (
                <span className="text-xs text-neutral-500 bg-neutral-100 px-2.5 py-1 rounded-full font-medium">
                  {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
                  {totalValue > 0 && ` · ${fmtInr(totalValue)}`}
                </span>
              )}
              <Link
                to={productPath('/pipelines/settings')}
                className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-600 transition-colors"
                title="Pipeline Settings"
              >
                <Settings className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex-1" />

            <label className={`flex items-center gap-2 text-sm cursor-pointer select-none ${showTrash ? 'text-neutral-400' : 'text-neutral-500'}`}>
              <input
                type="checkbox"
                checked={showArchived}
                disabled={showTrash}
                onChange={(e) => { setShowArchived(e.target.checked); setShowTrash(false); }}
                className="rounded border-neutral-300 text-primary-500 focus:ring-primary-400 disabled:opacity-50"
              />
              Show archived
            </label>

            <button
              onClick={() => {
                setShowTrash((current) => !current);
                setShowArchived(false);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showTrash ? 'bg-danger-500/10 border-danger-200 text-danger-700' : 'border-neutral-200 text-neutral-500 hover:text-danger-700 hover:bg-danger-500/10'}`}
              title="Trash contains deleted opportunities; linked contacts are not deleted"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Trash
            </button>

            <button
              onClick={() => setShowAnalytics((current) => !current)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAnalytics ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-neutral-200 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50'}`}
            >
              Analytics
            </button>

            <button
              onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: kanbanStages[0]?.stageName ?? '' })}
              disabled={!activePipelineId || showTrash}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Add Deal
            </button>
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <select value={filterAssigned} onChange={(e) => setFilterAssigned(e.target.value)}
              aria-label="Filter by owner"
              className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400">
              <option value="">All Owners</option>
              <option value="jatin">Jatin</option>
              <option value="saksham">Saksham</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
              aria-label="Filter by deal value"
              className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400">
              <option value="">All Values</option>
              <option value="high">High (10L+)</option>
              <option value="medium">Medium (1-10L)</option>
              <option value="low">Low (&lt; 1L)</option>
            </select>
            <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}
              aria-label="Filter by deal age"
              className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400">
              <option value="">All Ages</option>
              <option value="stale">Stale (3+ days)</option>
              <option value="week">This Week</option>
              <option value="today">Today</option>
            </select>
            {(filterAssigned || filterValue || filterAge) && (
              <button onClick={() => { setFilterAssigned(''); setFilterValue(''); setFilterAge(''); }}
                className="text-xs text-danger-600 hover:text-danger-700 font-medium">Clear</button>
            )}

            <div className="flex-1" />
            <span className="hidden md:inline text-[11px] text-neutral-400">Scroll pipeline</span>
            <button
              type="button"
              onClick={() => scrollBoard(-1)}
              className="p-1.5 border border-neutral-200 rounded-lg text-neutral-500 hover:bg-neutral-50"
              aria-label="Scroll pipeline left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollBoard(1)}
              className="p-1.5 border border-neutral-200 rounded-lg text-neutral-500 hover:bg-neutral-50"
              aria-label="Scroll pipeline right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {showTrash && (
            <div className="mt-2 text-xs text-danger-700 bg-danger-500/10 border border-danger-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              Deleted opportunities can be restored for {TRASH_RESTORE_DAYS} days. Their linked contacts, conversations, emails and tasks are kept.
            </div>
          )}
        </div>

        {showAnalytics && analytics && (
          <div className="bg-white border-b border-neutral-100 px-6 py-3 shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Weighted Forecast', value: analytics.forecast > 0 ? fmtInr(analytics.forecast) : '₹0', color: 'text-success-700' },
                { label: 'Win Rate', value: `${Math.round(analytics.winRate * 100)}%`, color: 'text-primary-600' },
                { label: 'Avg Cycle', value: analytics.avgCycleDays ? `${analytics.avgCycleDays}d` : '—', color: 'text-accent-700' },
                { label: 'Open Deals', value: `${analytics.openCount}`, color: 'text-neutral-700' },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-neutral-50 rounded-xl px-4 py-3 border border-neutral-100">
                  <p className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">{kpi.label}</p>
                  <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
            {analytics.byStage?.length > 0 && (
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                {analytics.byStage.map((stage) => (
                  <div key={stage.stage} className="shrink-0 bg-neutral-50 rounded-lg px-3 py-1.5 border border-neutral-100 text-xs">
                    <span className="font-medium text-neutral-700">{stage.stage}</span>
                    <span className="text-neutral-500 ml-2">{stage.count} deals</span>
                    {stage.value > 0 && <span className="text-success-700 ml-2">{fmtInr(stage.value)}</span>}
                    <span className="text-warning-700 ml-2">{stage.avg_age_days}d avg</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loadError && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8" role="alert">
            <div className="max-w-lg rounded-xl border border-danger-200 bg-danger-50 px-5 py-4 text-danger-800">
              <h3 className="text-base font-semibold">Could not load the pipeline</h3>
              <p className="mt-1 text-sm">{loadError}</p>
              <button type="button" onClick={loadPipelines} className="btn-primary btn-compact mt-4">Retry</button>
            </div>
          </div>
        ) : pipelinesList.length === 0 && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 012-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-neutral-700 mb-2">No pipelines yet</h3>
            <Link to={productPath('/pipelines/settings')} className="text-sm font-medium text-accent-600 hover:text-accent-700">
              Create your first pipeline &rarr;
            </Link>
          </div>
        ) : loading ? (
          <div className="flex flex-1 min-h-0 gap-4 px-4 py-4 overflow-x-auto overflow-y-hidden">
            {[1, 2, 3, 4].map((number) => (
              <div key={number} className="min-w-[280px] w-[280px] h-full shrink-0 rounded-xl border border-neutral-200 bg-neutral-100 animate-pulse"/>
            ))}
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div
              ref={boardRef}
              className="flex flex-1 min-h-0 gap-4 px-4 py-4 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth"
            >
              {kanbanStages.map((stageData, stageIndex) => {
                const displayStageName = stageData.stageLabel || stageData.stageName;
                const { color, light } = getStageStyle(displayStageName, stageIndex, stageData.stageOutcome);
                const headerColor = stageData.stageColor || color;
                const stageDeals = (stageData.deals ?? []).filter((deal) => {
                  if (filterAssigned) {
                    if (filterAssigned === 'unassigned' && deal.assignedTo) return false;
                    if (filterAssigned !== 'unassigned' && safeLower(deal.assignedTo) !== filterAssigned) return false;
                  }
                  if (filterValue) {
                    const value = Number(deal.dealValue || 0);
                    if (filterValue === 'high' && value < 1000000) return false;
                    if (filterValue === 'medium' && (value < 100000 || value >= 1000000)) return false;
                    if (filterValue === 'low' && value >= 100000) return false;
                  }
                  if (filterAge) {
                    const age = daysAgo(deal.updatedAt || deal.createdAt);
                    if (filterAge === 'stale' && age < 3) return false;
                    if (filterAge === 'week' && age > 7) return false;
                    if (filterAge === 'today' && age > 0) return false;
                  }
                  return true;
                });

                return (
                  <div
                    key={stageData.stageId || stageData.stageName}
                    className={`min-w-[85vw] w-[85vw] md:min-w-[280px] md:w-[280px] shrink-0 self-stretch min-h-0 flex flex-col rounded-xl border ${light}`}
                  >
                    <div className="rounded-t-xl px-3 py-2.5 shrink-0" style={{ background: headerColor }}>
                      <div className="flex items-center justify-between mb-0.5">
                        <h2 className="text-white font-semibold text-xs uppercase tracking-wide truncate flex-1 mr-1">
                          {displayStageName}
                        </h2>
                        <span className="bg-white/25 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0">
                          {stageDeals.length}
                        </span>
                      </div>
                      {stageDeals.length > 0 && (
                        <p className="text-white/75 text-[10px] font-medium">
                          {fmtInr(stageDeals.reduce((sum, deal) => sum + Number(deal.dealValue || 0), 0)) || 'No value set'}
                        </p>
                      )}
                    </div>

                    <Droppable droppableId={stageData.stageName} isDropDisabled={showTrash}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 min-h-0 overflow-y-auto p-2 space-y-2 rounded-b-xl transition-colors overscroll-contain ${snapshot.isDraggingOver ? 'bg-white/70' : ''}`}
                        >
                          {stageDeals.map((deal, index) => (
                            <DealCard
                              key={deal.id}
                              deal={deal}
                              index={index}
                              onClick={() => openDeal(deal)}
                              onArchive={() => archiveDeal(deal.id, true)}
                              onUnarchive={() => archiveDeal(deal.id, false)}
                              onDelete={() => requestDelete([deal.id])}
                              onRestore={() => restoreDeals([deal.id])}
                              selected={selectedIds.has(deal.id)}
                              onToggleSelect={() => toggleSelect(deal.id)}
                              selectionMode={selectedIds.size > 0}
                            />
                          ))}
                          {provided.placeholder}
                          {stageDeals.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-center text-xs text-neutral-600 py-4">{showTrash ? 'No deleted deals' : 'Empty'}</p>
                          )}
                        </div>
                      )}
                    </Droppable>

                    {!showTrash && (
                      <div className="px-2 pb-2 shrink-0">
                        <button
                          onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: stageData.stageName })}
                          className="w-full text-xs text-neutral-500 hover:text-neutral-600 hover:bg-white border border-dashed border-neutral-200 hover:border-neutral-300 rounded-lg py-1.5 transition-colors"
                        >
                          + Add Deal
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}

        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-white border border-neutral-200 shadow-xl rounded-2xl px-4 py-2.5 flex items-center gap-3">
            <span className="text-sm font-medium text-neutral-700">{selectedIds.size} selected</span>
            <div className="w-px h-5 bg-neutral-200" />

            {showTrash ? (
              <button
                onClick={() => restoreDeals(Array.from(selectedIds))}
                disabled={bulkBusy || selectedTrashHasExpired}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary-700 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={selectedTrashHasExpired ? `One or more selected deals are past the ${TRASH_RESTORE_DAYS}-day restore window` : 'Restore selected deals'}
              >
                <RotateCcw className="w-4 h-4" />
                {bulkBusy ? 'Restoring…' : 'Restore'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setConfirmArchive(true)}
                  disabled={bulkBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 rounded-lg transition-colors disabled:opacity-50"
                  title="Archive selected deals"
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </button>
                <button
                  onClick={() => requestDelete(Array.from(selectedIds))}
                  disabled={bulkBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-danger-600 hover:bg-danger-500/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Move selected deals to Trash"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </>
            )}

            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-neutral-600 hover:text-neutral-700 rounded-lg transition-colors disabled:opacity-50"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </main>

      {wonLostModal && (
        <WonLostModal
          stageName={wonLostModal.toStageLabel}
          stageOutcome={wonLostModal.stageOutcome}
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
        <DealDrawer
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

      <ConfirmDialog
        open={confirmArchive}
        title={`Archive ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?`}
        impactSummary="They'll disappear from the active board. You can still see them with the Show archived toggle."
        confirmLabel={`Archive ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}`}
        danger
        loading={bulkBusy}
        onConfirm={runBulkArchive}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        open={pendingDeleteIds.length > 0}
        title={`Move ${pendingDeleteIds.length} deal${pendingDeleteIds.length === 1 ? '' : 's'} to Trash?`}
        impactSummary={`The opportunity will leave the pipeline, but the linked Contact, conversations, emails and tasks are kept. It can be restored from Trash for ${TRASH_RESTORE_DAYS} days.`}
        confirmLabel={`Move ${pendingDeleteIds.length} to Trash`}
        danger
        loading={bulkBusy}
        onConfirm={runDeleteToTrash}
        onCancel={() => setPendingDeleteIds([])}
      />
    </div>
  );
}
