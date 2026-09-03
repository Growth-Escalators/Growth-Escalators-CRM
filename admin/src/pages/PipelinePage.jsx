import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  Archive,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import DealDrawer from '../components/DealDrawer.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import { apiFetch } from '../lib/api.js';
import { productPath } from '../lib/auth.js';
import { isLostOutcome, isTerminalOutcome, isWonOutcome } from '../lib/pipelineStageOutcomes.js';
import { safeInitial, safeLower, safeText } from '../lib/safe.js';

const TRASH_RETENTION_DAYS = 60;
const SAVED_VIEW_KEY = 'ge-crm:pipeline-saved-views:v1';
const ASSIGNEE_COLORS = { jatin: '#F97316', saksham: '#3B82F6' };

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

function trashDaysRemaining(dateStr) {
  if (!dateStr) return TRASH_RETENTION_DAYS;
  return Math.max(0, TRASH_RETENTION_DAYS - daysAgo(dateStr));
}

function isTrashRestoreExpired(dateStr) {
  return Boolean(dateStr) && daysAgo(dateStr) >= TRASH_RETENTION_DAYS;
}

function fmtInr(value) {
  const val = Number(value || 0);
  if (val <= 0) return null;
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  return `₹${val.toLocaleString('en-IN')}`;
}

function stringToColor(str = '') {
  str = safeText(str);
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}

function getStageStyle(stageName, index, stageOutcome = 'open') {
  if (stageOutcome === 'won') return { color: '#22c55e', light: 'bg-success-500/10 border-success-500/20' };
  if (stageOutcome === 'lost') return { color: '#dc2626', light: 'bg-danger-500/10 border-danger-500/20' };
  if (stageOutcome === 'abandoned') return { color: '#f59e0b', light: 'bg-warning-500/10 border-warning-500/20' };
  const lc = safeLower(stageName);
  if (lc.includes('proposal')) return { color: '#f97316', light: 'bg-accent-50 border-accent-200' };
  if (lc.includes('qualified')) return { color: '#14b8a6', light: 'bg-success-500/10 border-success-500/20' };
  if (lc.includes('meeting')) return { color: '#8b5cf6', light: 'bg-primary-50 border-primary-200' };
  if (lc.includes('follow')) return { color: '#6366f1', light: 'bg-primary-50 border-primary-200' };
  if (lc.includes('contact')) return { color: '#3b82f6', light: 'bg-primary-50 border-primary-200' };
  if (lc.includes('new') || lc.includes('lead')) return { color: '#94a3b8', light: 'bg-neutral-50 border-neutral-200' };
  const palette = [
    { color: '#64748b', light: 'bg-neutral-50 border-neutral-200' },
    { color: '#3b82f6', light: 'bg-primary-50 border-primary-200' },
    { color: '#6366f1', light: 'bg-primary-50 border-primary-200' },
    { color: '#14b8a6', light: 'bg-success-500/10 border-success-500/20' },
    { color: '#f97316', light: 'bg-accent-50 border-accent-200' },
  ];
  return palette[index % palette.length];
}

function isDeleted(deal) {
  return Boolean(deal?.metadata?.deletedAt);
}

function isArchivedOnly(deal) {
  return deal?.metadata?.archived === true && !isDeleted(deal);
}

function inScope(deal, scope) {
  if (scope === 'trash') return isDeleted(deal);
  if (scope === 'archived') return isArchivedOnly(deal);
  return deal?.metadata?.archived !== true && !isDeleted(deal);
}

function stripTrashMetadata(metadata = {}) {
  const next = { ...metadata };
  delete next.deletedAt;
  delete next.purgeAfter;
  delete next.preDeleteArchived;
  return next;
}

function makeTrashMetadata(metadata = {}) {
  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 86400000);
  return {
    ...metadata,
    preDeleteArchived: metadata.archived === true,
    archived: true,
    deletedAt: deletedAt.toISOString(),
    purgeAfter: purgeAfter.toISOString(),
  };
}

function matchesFilters(deal, filters) {
  const query = safeLower(filters.search).trim();
  if (query) {
    const haystack = safeLower([
      deal.contactName,
      deal.companyName,
      deal.title,
      deal.source,
      deal.assignedTo,
      deal.stage,
      ...(Array.isArray(deal.tags) ? deal.tags : []),
    ].filter(Boolean).join(' '));
    if (!haystack.includes(query)) return false;
  }
  if (filters.owner) {
    if (filters.owner === 'unassigned' && deal.assignedTo) return false;
    if (filters.owner !== 'unassigned' && safeLower(deal.assignedTo) !== filters.owner) return false;
  }
  if (filters.stage && deal.stage !== filters.stage) return false;
  if (filters.source && safeLower(deal.source) !== safeLower(filters.source)) return false;
  if (filters.value) {
    const value = Number(deal.dealValue || 0);
    if (filters.value === 'high' && value < 1000000) return false;
    if (filters.value === 'medium' && (value < 100000 || value >= 1000000)) return false;
    if (filters.value === 'low' && value >= 100000) return false;
  }
  if (filters.age) {
    const age = daysAgo(deal.updatedAt || deal.createdAt);
    if (filters.age === 'stale' && age < 3) return false;
    if (filters.age === 'week' && age > 7) return false;
    if (filters.age === 'today' && age > 0) return false;
  }
  return true;
}

function DealCard({ deal, index, stageLabel, selectionMode, selected, scope, onToggleSelect, onOpen, onArchive, onDelete, onRestore }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const days = daysAgo(deal.updatedAt || deal.createdAt);
  const assignedTo = safeText(deal.assignedTo);
  const restoreExpired = scope === 'trash' && isTrashRestoreExpired(deal.metadata?.deletedAt);
  const scoreColor = deal.score >= 70
    ? 'bg-success-500/10 text-success-700'
    : deal.score >= 40
      ? 'bg-warning-500/10 text-warning-700'
      : deal.score > 0
        ? 'bg-danger-500/10 text-danger-600'
        : 'bg-neutral-100 text-neutral-500';

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <Draggable draggableId={deal.id} index={index} isDragDisabled={selectionMode || scope !== 'active'}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => {
            if (selectionMode) onToggleSelect();
            else onOpen();
          }}
          className={`w-full rounded-xl border bg-white p-3 shadow-sm transition-all ${
            selected ? 'border-primary-400 ring-2 ring-primary-200' : 'border-neutral-200 hover:border-neutral-300 hover:shadow-md'
          } ${snapshot.isDragging ? 'rotate-1 scale-[1.02] shadow-xl' : ''} ${scope !== 'active' ? 'opacity-85' : ''}`}
        >
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => { event.stopPropagation(); onToggleSelect(); }}
              className="mt-0.5 rounded border-neutral-300 text-primary-500 focus:ring-primary-400"
              aria-label={`Select ${deal.contactName || 'deal'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-bold leading-tight text-neutral-900">{deal.contactName || deal.title || 'Unknown'}</p>
                <div className="flex shrink-0 items-center gap-1">
                  {deal.score > 0 && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreColor}`}>{deal.score}</span>}
                  <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setMenuOpen((value) => !value)}
                      className="rounded p-0.5 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600"
                      aria-label={`Actions for ${deal.contactName || 'deal'}`}
                    >
                      <span className="block px-1 text-lg leading-none">⋮</span>
                    </button>
                    {menuOpen && (
                      <div className="absolute right-0 top-6 z-30 min-w-[180px] rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">
                        {scope === 'active' && (
                          <>
                            <button type="button" onClick={() => { onArchive(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"><Archive className="h-4 w-4" /> Archive</button>
                            <button type="button" onClick={() => { onDelete(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger-600 hover:bg-danger-500/10"><Trash2 className="h-4 w-4" /> Move to Trash</button>
                          </>
                        )}
                        {scope === 'archived' && (
                          <>
                            <button type="button" onClick={() => { onRestore(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"><RotateCcw className="h-4 w-4" /> Unarchive</button>
                            <button type="button" onClick={() => { onDelete(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger-600 hover:bg-danger-500/10"><Trash2 className="h-4 w-4" /> Move to Trash</button>
                          </>
                        )}
                        {scope === 'trash' && (
                          <button type="button" onClick={() => { if (!restoreExpired) onRestore(); setMenuOpen(false); }} disabled={restoreExpired} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"><RotateCcw className="h-4 w-4" /> {restoreExpired ? 'Restore window expired' : 'Restore'}</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {deal.companyName && <p className="mt-1 truncate text-xs text-neutral-500">{deal.companyName}</p>}
              {scope === 'trash' && <p className={`mt-2 flex items-center gap-1 text-[10px] font-medium ${restoreExpired ? 'text-neutral-500' : 'text-danger-600'}`}><Trash2 className="h-3 w-3" /> {restoreExpired ? 'Restore window expired' : `${trashDaysRemaining(deal.metadata?.deletedAt)}d left to restore`}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {deal.source && <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{deal.source}</span>}
                {fmtInr(deal.dealValue) && <span className="rounded-md bg-success-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-success-700">{fmtInr(deal.dealValue)}</span>}
                {scope !== 'active' && <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">{stageLabel}</span>}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className={`text-[10px] ${days >= 3 ? 'font-semibold text-danger-600' : 'text-neutral-500'}`}>{days}d since activity</span>
                {assignedTo ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold uppercase text-white" style={{ background: ASSIGNEE_COLORS[safeLower(assignedTo)] || stringToColor(assignedTo) }} title={assignedTo}>{safeInitial(assignedTo)}</span>
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[9px] text-neutral-600" title="Unassigned">?</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

function WonLostModal({ move, onConfirm, onCancel }) {
  const won = isWonOutcome(move?.stageOutcome);
  const lost = isLostOutcome(move?.stageOutcome);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const reasons = ['Price too high', 'Went with competitor', 'Bad timing', 'No budget', 'Wrong fit', 'Went unresponsive', 'Other'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="p-6">
          <h2 className="text-lg font-bold text-neutral-900">{won ? 'Deal won' : lost ? 'Mark deal as lost' : 'Confirm stage change'}</h2>
          <p className="mt-1 text-sm text-neutral-500">{move?.deal?.contactName || 'Deal'} → {move?.toStageLabel}</p>
          {lost && (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-neutral-700">Reason <span className="text-danger-600">*</span></label>
              <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm" aria-label="Lost reason"><option value="">Choose a reason…</option>{reasons.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            </div>
          )}
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-neutral-700">Notes <span className="font-normal text-neutral-400">(optional)</span></label>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" aria-label="Stage change notes" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700">Cancel</button>
          <button type="button" disabled={lost && !reason} onClick={() => onConfirm(reason || null, notes || null)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm</button>
        </div>
      </div>
    </div>
  );
}

function AddDealModal({ pipelineId, stageName, onAdded, onClose }) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [dealValue, setDealValue] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedContact || search.trim().length < 2) { setContacts([]); return undefined; }
    const timer = setTimeout(async () => {
      const data = await apiFetch(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`).catch(() => null);
      setContacts(data?.contacts || []);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, selectedContact]);

  async function save() {
    if (!selectedContact) return;
    setSaving(true);
    try {
      const result = await apiFetch('/api/deals/add-or-update', {
        method: 'POST',
        body: JSON.stringify({
          contactId: selectedContact.id,
          pipelineId,
          stage: stageName,
          title: `${selectedContact.firstName || ''} ${selectedContact.lastName || ''} — opportunity`.trim(),
          ...(dealValue ? { dealValue: Number(dealValue) } : {}),
          ...(assignedTo ? { assignedTo } : {}),
          ...(source ? { source } : {}),
        }),
      });
      if (result?.deal) onAdded(result.deal); else onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-5">
          <div><h2 className="text-lg font-bold text-neutral-900">Add Deal</h2><p className="mt-0.5 text-sm text-neutral-500">Stage: {stageName}</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="relative">
            <label className="mb-1.5 block text-sm font-medium text-neutral-700">Contact <span className="text-danger-600">*</span></label>
            {selectedContact ? (
              <div className="flex items-center justify-between rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm"><span className="font-medium text-primary-800">{selectedContact.firstName} {selectedContact.lastName || ''}</span><button type="button" onClick={() => { setSelectedContact(null); setSearch(''); }} className="text-xs font-medium text-primary-700">Change</button></div>
            ) : (
              <>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contact name…" className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" aria-label="Search contacts" autoFocus />
                {contacts.length > 0 && <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-xl">{contacts.map((contact) => <button key={contact.id} type="button" onClick={() => { setSelectedContact(contact); setContacts([]); }} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-neutral-50"><span className="font-medium text-neutral-800">{contact.firstName} {contact.lastName || ''}</span><span className="text-xs text-neutral-400">{contact.companyName || contact.phone || ''}</span></button>)}</div>}
              </>
            )}
          </div>
          <div><label className="mb-1.5 block text-sm font-medium text-neutral-700">Deal value</label><input type="number" min="0" value={dealValue} onChange={(event) => setDealValue(event.target.value)} placeholder="₹ 0" className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1.5 block text-sm font-medium text-neutral-700">Owner</label><select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm"><option value="">Unassigned</option><option value="jatin">Jatin</option><option value="saksham">Saksham</option></select></div>
            <div><label className="mb-1.5 block text-sm font-medium text-neutral-700">Source</label><select value={source} onChange={(event) => setSource(event.target.value)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm"><option value="">Unknown</option><option value="form">Website</option><option value="paid_ad">Paid Ad</option><option value="referral">Referral</option><option value="cold_outreach">Cold Outreach</option><option value="inbound">Inbound</option></select></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-6 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700">Cancel</button><button type="button" onClick={save} disabled={!selectedContact || saving} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Adding…' : 'Add Deal'}</button></div>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { showError, showSuccess } = useToast();
  const [pipelines, setPipelines] = useState([]);
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [scope, setScope] = useState('active');
  const [viewMode, setViewMode] = useState('board');
  const [filters, setFilters] = useState({ search: '', owner: '', stage: '', source: '', value: '', age: '' });
  const [savedViews, setSavedViews] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStage, setBulkStage] = useState('');
  const [bulkOwner, setBulkOwner] = useState('');
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [addDealModal, setAddDealModal] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [sortBy, setSortBy] = useState('updated');
  const boardRef = useRef(null);

  const loadPipelines = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch('/api/pipelines');
      const list = Array.isArray(data) ? data : [];
      setPipelines(list);
      setActivePipelineId((current) => list.some((item) => item.id === current) ? current : list[0]?.id || null);
    } catch (error) {
      setLoadError(error?.message || 'Unable to load pipelines.');
      setPipelines([]);
      setActivePipelineId(null);
    } finally { setLoading(false); }
  }, []);

  const loadDeals = useCallback(async () => {
    if (!activePipelineId) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiFetch(`/api/pipelines/${activePipelineId}/deals?includeArchived=true`);
      setStages(Array.isArray(data?.stages) ? data.stages : []);
    } catch (error) {
      setStages([]);
      setLoadError(error?.message || 'Unable to load pipeline deals.');
    } finally { setLoading(false); }
  }, [activePipelineId]);

  useEffect(() => { loadPipelines(); }, [loadPipelines]);
  useEffect(() => { loadDeals(); }, [loadDeals]);
  useEffect(() => { setSelectedIds(new Set()); }, [activePipelineId, scope, viewMode]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVED_VIEW_KEY) || '[]');
      if (Array.isArray(parsed)) setSavedViews(parsed);
    } catch { setSavedViews([]); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dealId = params.get('dealId');
    if (dealId) setSelectedDealId(dealId);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('newDeal') !== '1' || !activePipelineId || stages.length === 0) return;
    setAddDealModal({ pipelineId: activePipelineId, stageName: stages[0]?.stageName || '' });
    params.delete('newDeal');
    const rest = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  }, [activePipelineId, stages]);

  useEffect(() => {
    if (!showAnalytics || !activePipelineId) return;
    apiFetch(`/api/pipelines/${activePipelineId}/analytics?days=90`).then(setAnalytics).catch(() => setAnalytics(null));
  }, [showAnalytics, activePipelineId]);

  const flattened = useMemo(() => stages.flatMap((stage, stageIndex) => (stage.deals || []).map((deal) => ({ ...deal, _stageIndex: stageIndex, _stageLabel: stage.stageLabel || stage.stageName, _stageOutcome: stage.stageOutcome }))), [stages]);
  const scopedDeals = useMemo(() => flattened.filter((deal) => inScope(deal, scope) && matchesFilters(deal, filters)), [flattened, filters, scope]);
  const selectedDeals = useMemo(() => scopedDeals.filter((deal) => selectedIds.has(deal.id)), [scopedDeals, selectedIds]);
  const totalValue = scopedDeals.reduce((sum, deal) => sum + Number(deal.dealValue || 0), 0);
  const sources = useMemo(() => Array.from(new Set(flattened.map((deal) => deal.source).filter(Boolean))).sort(), [flattened]);
  const ownerOptions = useMemo(() => Array.from(new Set(flattened.map((deal) => safeLower(deal.assignedTo)).filter(Boolean))).sort(), [flattened]);

  const sortedList = useMemo(() => {
    const next = [...scopedDeals];
    next.sort((a, b) => {
      if (sortBy === 'value') return Number(b.dealValue || 0) - Number(a.dealValue || 0);
      if (sortBy === 'age') return daysAgo(b.updatedAt || b.createdAt) - daysAgo(a.updatedAt || a.createdAt);
      if (sortBy === 'name') return safeText(a.contactName).localeCompare(safeText(b.contactName));
      return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
    });
    return next;
  }, [scopedDeals, sortBy]);

  function updateFilter(key, value) { setFilters((current) => ({ ...current, [key]: value })); }
  function clearFilters() { setFilters({ search: '', owner: '', stage: '', source: '', value: '', age: '' }); }
  function toggleSelect(id) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function selectAllVisible() { setSelectedIds((current) => current.size === scopedDeals.length ? new Set() : new Set(scopedDeals.map((deal) => deal.id))); }
  function scrollBoard(direction) { boardRef.current?.scrollBy({ left: direction * Math.max(560, boardRef.current.clientWidth * 0.7), behavior: 'smooth' }); }

  function saveCurrentView() {
    const name = window.prompt('Name this pipeline view');
    if (!name?.trim()) return;
    const entry = { id: `${Date.now()}`, name: name.trim(), filters, scope, viewMode };
    const next = [...savedViews.filter((item) => item.name !== entry.name), entry].slice(-12);
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(next));
    showSuccess(`Saved view “${entry.name}”`);
  }

  function applySavedView(id) {
    const view = savedViews.find((item) => item.id === id);
    if (!view) return;
    setFilters({ search: '', owner: '', stage: '', source: '', value: '', age: '', ...(view.filters || {}) });
    setScope(view.scope || 'active');
    setViewMode(view.viewMode || 'board');
  }

  function optimisticPatchDeal(dealId, updater) {
    setStages((current) => current.map((stage) => ({ ...stage, deals: (stage.deals || []).map((deal) => deal.id === dealId ? updater(deal) : deal) })));
  }

  async function patchMetadata(deal, metadata) {
    await apiFetch(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ metadata }) });
    optimisticPatchDeal(deal.id, (item) => ({ ...item, metadata }));
  }

  async function archiveDeal(deal) {
    await patchMetadata(deal, { ...(deal.metadata || {}), archived: true });
    showSuccess('Deal archived');
  }

  async function restoreDeal(deal) {
    if (scope === 'trash' && isTrashRestoreExpired(deal.metadata?.deletedAt)) {
      showError('The 60-day restore window for this deal has expired.');
      return;
    }
    const wasArchived = deal.metadata?.preDeleteArchived === true;
    const metadata = { ...stripTrashMetadata(deal.metadata || {}), archived: scope === 'trash' ? wasArchived : false };
    await patchMetadata(deal, metadata);
    showSuccess(scope === 'trash' ? (wasArchived ? 'Deal restored to Archived' : 'Deal restored to active pipeline') : 'Deal unarchived');
  }

  function requestDelete(deal) { setConfirmAction({ type: 'delete-one', deal }); }

  async function moveToTrash(deal) {
    await patchMetadata(deal, makeTrashMetadata(deal.metadata || {}));
    showSuccess(`Moved to Trash · restorable for ${TRASH_RETENTION_DAYS} days`);
  }

  async function runBulkMetadata(mode) {
    let deals = selectedDeals;
    if (!deals.length) return;
    if (mode === 'restore') {
      const restorable = deals.filter((deal) => !isTrashRestoreExpired(deal.metadata?.deletedAt));
      if (!restorable.length) { showError('The restore window has expired for the selected Trash records.'); return; }
      if (restorable.length !== deals.length) showError(`${deals.length - restorable.length} expired deal${deals.length - restorable.length === 1 ? '' : 's'} were left in Trash.`);
      deals = restorable;
    }
    setBulkBusy(true);
    try {
      await Promise.all(deals.map(async (deal) => {
        let metadata;
        if (mode === 'delete') metadata = makeTrashMetadata(deal.metadata || {});
        else if (mode === 'archive') metadata = { ...(deal.metadata || {}), archived: true };
        else {
          const wasArchived = deal.metadata?.preDeleteArchived === true;
          metadata = { ...stripTrashMetadata(deal.metadata || {}), archived: scope === 'trash' ? wasArchived : false };
        }
        await apiFetch(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ metadata }) });
      }));
      setSelectedIds(new Set());
      await loadDeals();
      showSuccess(mode === 'delete' ? `Moved ${deals.length} deal${deals.length === 1 ? '' : 's'} to Trash` : mode === 'archive' ? `Archived ${deals.length} deal${deals.length === 1 ? '' : 's'}` : `Restored ${deals.length} deal${deals.length === 1 ? '' : 's'}`);
    } catch {
      showError('Some deals could not be updated. The board has been refreshed.');
      await loadDeals();
    } finally { setBulkBusy(false); }
  }

  async function runBulkFieldUpdate() {
    if (!selectedIds.size || (!bulkStage && !bulkOwner)) return;
    setBulkBusy(true);
    try {
      const updates = {};
      if (bulkStage) updates.stage = bulkStage;
      if (bulkOwner) updates.assignedTo = bulkOwner === 'unassigned' ? '' : bulkOwner;
      await apiFetch('/api/deals/bulk-update', { method: 'POST', body: JSON.stringify({ dealIds: Array.from(selectedIds), updates }) });
      setBulkStage(''); setBulkOwner(''); setSelectedIds(new Set()); await loadDeals(); showSuccess('Selected deals updated');
    } catch { showError('Bulk update failed.'); } finally { setBulkBusy(false); }
  }

  function applyMove(deal, fromStage, toStage, index) {
    setStages((current) => current.map((stage) => {
      if (stage.stageName === fromStage) return { ...stage, deals: (stage.deals || []).filter((item) => item.id !== deal.id) };
      if (stage.stageName === toStage) { const deals = [...(stage.deals || [])]; deals.splice(index, 0, { ...deal, stage: toStage }); return { ...stage, deals }; }
      return stage;
    }));
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId || scope !== 'active' || selectedIds.size > 0) return;
    const fromStage = stages.find((stage) => stage.stageName === source.droppableId);
    const toStage = stages.find((stage) => stage.stageName === destination.droppableId);
    const deal = fromStage?.deals?.find((item) => item.id === draggableId);
    if (!deal || !toStage) return;
    if (isTerminalOutcome(toStage.stageOutcome)) {
      setPendingMove({ deal, fromStage: source.droppableId, toStage: destination.droppableId, toStageLabel: toStage.stageLabel || toStage.stageName, stageOutcome: toStage.stageOutcome, destIndex: destination.index });
      return;
    }
    applyMove(deal, source.droppableId, destination.droppableId, destination.index);
    try { await apiFetch(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage: destination.droppableId }) }); }
    catch { showError('Stage move failed. Reloading the board.'); loadDeals(); }
  }

  async function confirmTerminalMove(reason, notes) {
    const move = pendingMove;
    if (!move) return;
    setPendingMove(null);
    applyMove(move.deal, move.fromStage, move.toStage, move.destIndex || 0);
    try { await apiFetch(`/api/deals/${move.deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage: move.toStage, ...(reason ? { lostReason: reason } : {}), ...(notes ? { wonNotes: notes } : {}) }) }); }
    catch { showError('Stage move failed. Reloading the board.'); loadDeals(); }
  }

  function openContactFromDeal(deal) {
    const nameParts = deal.first_name ? [deal.first_name, deal.last_name].filter(Boolean) : safeText(deal.contactName).split(' ');
    setSelectedContact({ id: deal.contact_id || deal.contactId, firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || null, companyName: deal.company_name || deal.companyName || null, score: deal.score || 0 });
  }

  async function confirmDialogAction() {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    if (action.type === 'delete-one') await moveToTrash(action.deal);
    if (action.type === 'delete-bulk') await runBulkMetadata('delete');
    if (action.type === 'archive-bulk') await runBulkMetadata('archive');
    if (action.type === 'restore-bulk') await runBulkMetadata('restore');
  }

  const hasFilters = Object.values(filters).some(Boolean);
  const scopeCounts = flattened.reduce((acc, deal) => { if (isDeleted(deal)) acc.trash += 1; else if (isArchivedOnly(deal)) acc.archived += 1; else acc.active += 1; return acc; }, { active: 0, archived: 0, trash: 0 });

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <h1 className="sr-only">Pipeline</h1>
        <header className="shrink-0 border-b border-neutral-200 bg-white px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-500">Pipeline:</span>
              <select value={activePipelineId || ''} onChange={(event) => setActivePipelineId(event.target.value)} className="min-w-[220px] rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-primary-400" aria-label="Pipeline">{pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</select>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{scopedDeals.length} deal{scopedDeals.length === 1 ? '' : 's'}{totalValue > 0 ? ` · ${fmtInr(totalValue)}` : ''}</span>
              <Link to={productPath('/pipelines/settings')} className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100" title="Pipeline settings"><Settings className="h-4 w-4" /></Link>
            </div>
            <div className="flex-1" />
            {viewMode === 'board' && <div className="hidden items-center gap-1 md:flex"><button type="button" onClick={() => scrollBoard(-1)} className="rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50" aria-label="Scroll pipeline left"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => scrollBoard(1)} className="rounded-lg border border-neutral-200 p-2 text-neutral-500 hover:bg-neutral-50" aria-label="Scroll pipeline right"><ChevronRight className="h-4 w-4" /></button></div>}
            <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"><button type="button" onClick={() => setViewMode('board')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${viewMode === 'board' ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500'}`}><LayoutGrid className="h-3.5 w-3.5" /> Board</button><button type="button" onClick={() => setViewMode('list')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${viewMode === 'list' ? 'bg-white text-primary-700 shadow-sm' : 'text-neutral-500'}`}><List className="h-3.5 w-3.5" /> List</button></div>
            <button type="button" onClick={() => setShowAnalytics((value) => !value)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${showAnalytics ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}><BarChart3 className="h-3.5 w-3.5" /> Analytics</button>
            <button type="button" onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: stages[0]?.stageName || '' })} disabled={!activePipelineId || !stages.length || scope !== 'active'} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"><Plus className="h-4 w-4" /> Add Deal</button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1 max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Search lead, company, source, owner…" className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-primary-400" /></div>
            <select value={filters.owner} onChange={(event) => updateFilter('owner', event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs" aria-label="Filter by owner"><option value="">All owners</option><option value="unassigned">Unassigned</option>{ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select>
            <select value={filters.stage} onChange={(event) => updateFilter('stage', event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs" aria-label="Filter by stage"><option value="">All stages</option>{stages.map((stage) => <option key={stage.stageName} value={stage.stageName}>{stage.stageLabel || stage.stageName}</option>)}</select>
            <select value={filters.source} onChange={(event) => updateFilter('source', event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs" aria-label="Filter by source"><option value="">All sources</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select>
            <select value={filters.value} onChange={(event) => updateFilter('value', event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs" aria-label="Filter by value"><option value="">All values</option><option value="high">₹10L+</option><option value="medium">₹1L–₹10L</option><option value="low">Below ₹1L</option></select>
            <select value={filters.age} onChange={(event) => updateFilter('age', event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs" aria-label="Filter by age"><option value="">All ages</option><option value="stale">Stale 3+ days</option><option value="week">Last 7 days</option><option value="today">Today</option></select>
            {hasFilters && <button type="button" onClick={clearFilters} className="text-xs font-medium text-danger-600 hover:text-danger-700">Clear</button>}
            <div className="ml-auto flex items-center gap-2">{savedViews.length > 0 && <select defaultValue="" onChange={(event) => { applySavedView(event.target.value); event.target.value = ''; }} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs" aria-label="Saved views"><option value="" disabled>Saved views</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select>}<button type="button" onClick={saveCurrentView} className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50"><Save className="h-3.5 w-3.5" /> Save view</button></div>
          </div>

          <div className="mt-3 flex w-fit items-center gap-1 rounded-lg bg-neutral-100 p-1">{[['active', 'Active', scopeCounts.active], ['archived', 'Archived', scopeCounts.archived], ['trash', 'Trash', scopeCounts.trash]].map(([value, label, count]) => <button key={value} type="button" onClick={() => setScope(value)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === value ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'}`}>{label} <span className="ml-1 text-neutral-400">{count}</span></button>)}</div>
        </header>

        {showAnalytics && analytics && <div className="shrink-0 border-b border-neutral-200 bg-white px-5 py-3"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Weighted Forecast', analytics.forecast > 0 ? fmtInr(analytics.forecast) : '₹0'], ['Win Rate', `${Math.round((analytics.winRate || 0) * 100)}%`], ['Avg Cycle', analytics.avgCycleDays ? `${analytics.avgCycleDays}d` : '—'], ['Open Deals', `${analytics.openCount || 0}`]].map(([label, value]) => <div key={label} className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-2.5"><p className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</p><p className="mt-0.5 text-lg font-bold text-neutral-800">{value}</p></div>)}</div></div>}

        {loadError && !loading ? (
          <div className="flex flex-1 items-center justify-center p-8"><div className="max-w-lg rounded-xl border border-danger-200 bg-danger-50 px-5 py-4 text-center text-danger-800"><h3 className="font-semibold">Could not load the pipeline</h3><p className="mt-1 text-sm">{loadError}</p><button type="button" onClick={loadDeals} className="mt-4 rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white">Retry</button></div></div>
        ) : loading ? (
          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-full min-w-[280px] animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />)}</div>
        ) : !pipelines.length ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center"><div><h3 className="text-lg font-semibold text-neutral-800">No pipelines yet</h3><Link to={productPath('/pipelines/settings')} className="mt-2 inline-block text-sm font-medium text-primary-600">Create your first pipeline →</Link></div></div>
        ) : viewMode === 'board' ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <div ref={boardRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 py-4 overscroll-x-contain scroll-smooth">
              {stages.map((stage, stageIndex) => {
                const label = stage.stageLabel || stage.stageName;
                const style = getStageStyle(label, stageIndex, stage.stageOutcome);
                const deals = (stage.deals || []).filter((deal) => inScope(deal, scope) && matchesFilters(deal, filters));
                const value = deals.reduce((sum, deal) => sum + Number(deal.dealValue || 0), 0);
                return (
                  <section key={stage.stageId || stage.stageName} className={`flex h-full min-h-0 w-[280px] min-w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border ${style.light}`}>
                    <div className="sticky top-0 z-10 shrink-0 rounded-t-xl px-3 py-2.5 text-white" style={{ background: stage.stageColor || style.color }}><div className="flex items-center justify-between gap-2"><h2 className="truncate text-xs font-semibold uppercase tracking-wide">{label}</h2><span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">{deals.length}</span></div><div className="mt-1 flex items-center justify-between text-[10px] text-white/80"><span>{value > 0 ? fmtInr(value) : '—'}</span>{deals.length > 0 && <span>{Math.round(deals.reduce((sum, deal) => sum + daysAgo(deal.updatedAt || deal.createdAt), 0) / deals.length)}d avg</span>}</div></div>
                    <Droppable droppableId={stage.stageName} isDropDisabled={scope !== 'active' || selectedIds.size > 0}>
                      {(provided, snapshot) => <div ref={provided.innerRef} {...provided.droppableProps} className={`min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain p-2 ${snapshot.isDraggingOver ? 'bg-white/70' : ''}`}>{deals.map((deal, index) => <DealCard key={deal.id} deal={deal} index={index} stageLabel={label} scope={scope} selectionMode={selectedIds.size > 0} selected={selectedIds.has(deal.id)} onToggleSelect={() => toggleSelect(deal.id)} onOpen={() => { setSelectedDealId(deal.id); setSelectedContact(null); }} onArchive={() => archiveDeal(deal)} onDelete={() => requestDelete(deal)} onRestore={() => restoreDeal(deal)} />)}{provided.placeholder}{deals.length === 0 && !snapshot.isDraggingOver && <div className="flex h-24 items-center justify-center text-xs text-neutral-500">No matching deals</div>}</div>}
                    </Droppable>
                    {scope === 'active' && <div className="shrink-0 border-t border-neutral-200/60 p-2"><button type="button" onClick={() => setAddDealModal({ pipelineId: activePipelineId, stageName: stage.stageName })} className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-xs font-medium text-neutral-500 hover:border-primary-300 hover:bg-white hover:text-primary-600">+ Add Deal</button></div>}
                  </section>
                );
              })}
              <div className="w-1 shrink-0" aria-hidden="true" />
            </div>
          </DragDropContext>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="min-w-[980px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2.5"><label className="flex items-center gap-2 text-xs font-medium text-neutral-600"><input type="checkbox" checked={scopedDeals.length > 0 && selectedIds.size === scopedDeals.length} onChange={selectAllVisible} className="rounded border-neutral-300 text-primary-500" /> Select all {scopedDeals.length} matching</label><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs"><option value="updated">Last activity</option><option value="value">Deal value</option><option value="age">Oldest first</option><option value="name">Name</option></select></div>
              <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wide text-neutral-500"><tr><th className="w-10 px-3 py-3"></th><th className="px-3 py-3">Lead</th><th className="px-3 py-3">Company</th><th className="px-3 py-3">Stage</th><th className="px-3 py-3">Value</th><th className="px-3 py-3">Owner</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Last activity</th></tr></thead><tbody className="divide-y divide-neutral-100">{sortedList.map((deal) => <tr key={deal.id} onClick={() => selectedIds.size ? toggleSelect(deal.id) : setSelectedDealId(deal.id)} className={`cursor-pointer hover:bg-neutral-50 ${selectedIds.has(deal.id) ? 'bg-primary-50' : ''}`}><td className="px-3 py-3"><input type="checkbox" checked={selectedIds.has(deal.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelect(deal.id)} className="rounded border-neutral-300 text-primary-500" /></td><td className="px-3 py-3"><p className="font-semibold text-neutral-900">{deal.contactName || deal.title || 'Unknown'}</p>{scope === 'trash' && <p className={`mt-1 text-[10px] ${isTrashRestoreExpired(deal.metadata?.deletedAt) ? 'text-neutral-400' : 'text-danger-600'}`}>{isTrashRestoreExpired(deal.metadata?.deletedAt) ? 'Restore expired' : `${trashDaysRemaining(deal.metadata?.deletedAt)}d left to restore`}</p>}</td><td className="px-3 py-3 text-neutral-600">{deal.companyName || '—'}</td><td className="px-3 py-3"><span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700">{deal._stageLabel}</span></td><td className="px-3 py-3 font-medium text-neutral-800">{fmtInr(deal.dealValue) || '—'}</td><td className="px-3 py-3 text-neutral-600">{deal.assignedTo || 'Unassigned'}</td><td className="px-3 py-3 text-neutral-600">{deal.source || '—'}</td><td className={`px-3 py-3 ${daysAgo(deal.updatedAt || deal.createdAt) >= 3 ? 'font-semibold text-danger-600' : 'text-neutral-600'}`}>{daysAgo(deal.updatedAt || deal.createdAt)}d ago</td></tr>)}{sortedList.length === 0 && <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-neutral-500">No matching deals</td></tr>}</tbody></table>
            </div>
          </div>
        )}

        {scope === 'trash' && !loading && <div className="shrink-0 border-t border-warning-200 bg-warning-50 px-5 py-2 text-xs text-warning-800">Trash is recoverable for {TRASH_RETENTION_DAYS} days. Deleting an opportunity never deletes the linked Contact, conversations, emails, tasks or history. Expired Trash records remain retained as non-restorable tombstones for audit/referential safety.</div>}

        {selectedIds.size > 0 && <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-2xl"><span className="whitespace-nowrap px-1 text-sm font-semibold text-neutral-800">{selectedIds.size} selected</span><div className="h-6 w-px bg-neutral-200" />{scope === 'active' && <><select value={bulkStage} onChange={(event) => setBulkStage(event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs"><option value="">Move stage…</option>{stages.map((stage) => <option key={stage.stageName} value={stage.stageName}>{stage.stageLabel || stage.stageName}</option>)}</select><select value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs"><option value="">Assign owner…</option><option value="unassigned">Unassigned</option>{ownerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select>{(bulkStage || bulkOwner) && <button type="button" onClick={runBulkFieldUpdate} disabled={bulkBusy} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Apply</button>}<button type="button" onClick={() => setConfirmAction({ type: 'archive-bulk' })} disabled={bulkBusy} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"><Archive className="h-3.5 w-3.5" /> Archive</button><button type="button" onClick={() => setConfirmAction({ type: 'delete-bulk' })} disabled={bulkBusy} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger-600 hover:bg-danger-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button></>}{scope === 'archived' && <><button type="button" onClick={() => setConfirmAction({ type: 'restore-bulk' })} disabled={bulkBusy} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"><RotateCcw className="h-3.5 w-3.5" /> Unarchive</button><button type="button" onClick={() => setConfirmAction({ type: 'delete-bulk' })} disabled={bulkBusy} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger-600 hover:bg-danger-500/10"><Trash2 className="h-3.5 w-3.5" /> Trash</button></>}{scope === 'trash' && <button type="button" onClick={() => setConfirmAction({ type: 'restore-bulk' })} disabled={bulkBusy} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"><RotateCcw className="h-3.5 w-3.5" /> Restore available</button>}<button type="button" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100" aria-label="Clear selection"><X className="h-4 w-4" /></button></div>}
      </main>

      {pendingMove && <WonLostModal move={pendingMove} onConfirm={confirmTerminalMove} onCancel={() => setPendingMove(null)} />}
      {addDealModal && <AddDealModal pipelineId={addDealModal.pipelineId} stageName={addDealModal.stageName} onAdded={() => { setAddDealModal(null); loadDeals(); }} onClose={() => setAddDealModal(null)} />}
      {selectedDealId && !selectedContact && <DealDrawer dealId={selectedDealId} onClose={() => setSelectedDealId(null)} onViewContact={openContactFromDeal} onUpdated={loadDeals} />}
      {selectedContact && <ContactSlideIn contact={selectedContact} onClose={() => setSelectedContact(null)} onUpdated={() => { setSelectedContact(null); loadDeals(); }} />}
      <ConfirmDialog open={Boolean(confirmAction)} title={confirmAction?.type?.includes('delete') ? `Move ${confirmAction?.deal ? 'this deal' : `${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}`} to Trash?` : confirmAction?.type?.includes('restore') ? `Restore ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?` : `Archive ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?`} impactSummary={confirmAction?.type?.includes('delete') ? `The opportunity will disappear from the active board and can be restored from Trash for ${TRASH_RETENTION_DAYS} days. The linked Contact, conversations and tasks are not deleted.` : confirmAction?.type?.includes('restore') ? 'Restorable opportunities will return to their pre-delete active/archived state. Expired Trash records will be left untouched.' : 'The selected opportunities will move to Archived and can be unarchived later.'} confirmLabel={confirmAction?.type?.includes('delete') ? 'Move to Trash' : confirmAction?.type?.includes('restore') ? 'Restore' : 'Archive'} danger={Boolean(confirmAction?.type?.includes('delete'))} loading={bulkBusy} onConfirm={confirmDialogAction} onCancel={() => setConfirmAction(null)} />
    </div>
  );
}
