import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Stage color palette — assigned by index; special overrides for terminal stages
// ---------------------------------------------------------------------------
const PALETTE = [
  { color: 'bg-slate-500',   light: 'bg-slate-50 border-slate-200' },
  { color: 'bg-blue-500',    light: 'bg-blue-50 border-blue-200' },
  { color: 'bg-indigo-500',  light: 'bg-indigo-50 border-indigo-200' },
  { color: 'bg-violet-500',  light: 'bg-violet-50 border-violet-200' },
  { color: 'bg-sky-500',     light: 'bg-sky-50 border-sky-200' },
  { color: 'bg-amber-500',   light: 'bg-amber-50 border-amber-200' },
  { color: 'bg-orange-500',  light: 'bg-orange-50 border-orange-200' },
  { color: 'bg-rose-500',    light: 'bg-rose-50 border-rose-200' },
  { color: 'bg-teal-500',    light: 'bg-teal-50 border-teal-200' },
  { color: 'bg-cyan-500',    light: 'bg-cyan-50 border-cyan-200' },
];

function getStageStyle(stageName, index) {
  const lc = (stageName ?? '').toLowerCase();
  if (lc === 'won' || lc === 'client won' || lc === 'client')
    return { color: 'bg-emerald-600', light: 'bg-emerald-50 border-emerald-200' };
  if (lc === 'lost' || lc === 'disqualified')
    return { color: 'bg-red-500', light: 'bg-red-50 border-red-200' };
  return PALETTE[index % PALETTE.length];
}

function isTerminalStage(stageName) {
  const lc = (stageName ?? '').toLowerCase();
  return lc === 'won' || lc === 'lost' || lc === 'client won' || lc === 'disqualified';
}
function isWonStage(stageName) {
  const lc = (stageName ?? '').toLowerCase();
  return lc === 'won' || lc === 'client won' || lc === 'client';
}

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function stringToColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#EF4444', '#6366F1', '#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}

function initials(name = '') {
  const parts = name.trim().split(' ');
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
}

// ---------------------------------------------------------------------------
// DealCard
// ---------------------------------------------------------------------------
function DealCard({ deal, index, onClick, onArchive, onUnarchive }) {
  const days = daysAgo(deal.updatedAt || deal.createdAt);
  const isArchived = deal.metadata?.archived === true;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md transition-all relative ${snapshot.isDragging ? 'shadow-xl rotate-1 scale-105' : ''} ${isArchived ? 'bg-slate-100 opacity-60' : 'bg-white'}`}
        >
          {/* Row 1: name + days badge + menu */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p
              onClick={onClick}
              className="font-semibold text-slate-900 text-sm leading-tight line-clamp-1 cursor-pointer flex-1 hover:text-blue-600"
            >
              {deal.contactName ?? 'Unknown'}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${days > 3 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                {days}d
              </span>
              <div ref={menuRef} className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                  className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </button>
                {menuOpen && (
                  <div
                    className="absolute top-6 right-0 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[140px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isArchived ? (
                      <button
                        onClick={() => { onUnarchive(); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Unarchive
                      </button>
                    ) : (
                      <button
                        onClick={() => { onArchive(); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        Archive (hide)
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: company name */}
          {deal.companyName && (
            <p className="text-xs text-slate-400 mb-1.5 line-clamp-1">{deal.companyName}</p>
          )}

          {/* Row 3: badges */}
          <div className="flex flex-wrap items-center gap-1">
            {deal.dealValue > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                ₹{Number(deal.dealValue).toLocaleString('en-IN')}
              </span>
            )}
            {deal.score > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${deal.score >= 70 ? 'bg-green-100 text-green-700' : deal.score >= 40 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-600'}`}>
                {deal.score}pt
              </span>
            )}
            {deal.assignedTo && (
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold uppercase"
                style={{ background: stringToColor(deal.assignedTo) }}
                title={deal.assignedTo}
              >
                {deal.assignedTo.slice(0, 2)}
              </span>
            )}
            {isArchived && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-300 text-slate-600 font-medium">Archived</span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ---------------------------------------------------------------------------
// Won/Lost confirmation modal
// ---------------------------------------------------------------------------
function WonLostModal({ stageName, contactName, onConfirm, onCancel }) {
  const isWon = isWonStage(stageName);
  const [lostReason, setLostReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isWon ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {isWon ? (
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
            Mark as {stageName}?
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {contactName} will be moved to <span className="font-medium text-slate-700">{stageName}</span>.
          </p>

          {!isWon && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Lost reason <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">Select a reason…</option>
                <option value="price_too_high">Price too high</option>
                <option value="no_budget">No budget</option>
                <option value="went_with_competitor">Went with competitor</option>
                <option value="not_interested">Not interested</option>
                <option value="bad_timing">Bad timing</option>
                <option value="no_response">No response / Ghosted</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-white"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(lostReason || null)}
            className={`px-5 py-2 text-sm font-semibold text-white rounded-lg transition-colors ${isWon ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {isWon ? 'Mark Won' : 'Mark Lost'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [pipelines, setPipelines] = useState([]);
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [kanbanStages, setKanbanStages] = useState([]); // [{stageName, deals, totalValue}]
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);
  const [wonLostModal, setWonLostModal] = useState(null); // { deal, fromStage, toStage }

  // Load pipelines once
  useEffect(() => {
    apiFetch('/api/pipelines').then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setPipelines(data);
        setActivePipelineId(data[0].id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  // Load kanban data when pipeline or showArchived changes
  const loadDeals = useCallback(async () => {
    if (!activePipelineId) return;
    setLoading(true);
    const url = `/api/pipelines/${activePipelineId}/deals${showArchived ? '?includeArchived=true' : ''}`;
    const data = await apiFetch(url);
    if (data?.stages) {
      setKanbanStages(data.stages);
    }
    setLoading(false);
  }, [activePipelineId, showArchived]);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  const totalDeals = kanbanStages.reduce((sum, s) => sum + s.deals.length, 0);
  const totalValue = kanbanStages.reduce((sum, s) => sum + (s.totalValue ?? 0), 0);

  async function archiveDeal(dealId, archived) {
    // Find deal across all stages
    let deal = null;
    for (const s of kanbanStages) {
      deal = s.deals.find((d) => d.id === dealId);
      if (deal) break;
    }
    if (!deal) return;
    await apiFetch(`/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { ...(deal.metadata ?? {}), archived } }),
    });
    loadDeals();
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;

    const fromStage = source.droppableId;
    const toStage = destination.droppableId;

    // Find the deal
    const fromStageData = kanbanStages.find((s) => s.stageName === fromStage);
    const deal = fromStageData?.deals.find((d) => d.id === draggableId);
    if (!deal) return;

    // If moving to a terminal stage, show confirmation modal
    if (isTerminalStage(toStage)) {
      setWonLostModal({ deal, fromStage, toStage, destIndex: destination.index });
      return;
    }

    // Optimistic update
    applyMove(deal, fromStage, toStage, destination.index);

    // Persist
    await apiFetch(`/deals/${draggableId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: toStage }),
    });
  }

  function applyMove(deal, fromStage, toStage, destIndex) {
    setKanbanStages((prev) => {
      return prev.map((s) => {
        if (s.stageName === fromStage) {
          return { ...s, deals: s.deals.filter((d) => d.id !== deal.id) };
        }
        if (s.stageName === toStage) {
          const arr = [...s.deals];
          arr.splice(destIndex, 0, { ...deal, stage: toStage });
          return { ...s, deals: arr };
        }
        return s;
      });
    });
  }

  async function confirmWonLost(lostReason) {
    if (!wonLostModal) return;
    const { deal, fromStage, toStage, destIndex } = wonLostModal;
    setWonLostModal(null);

    applyMove(deal, fromStage, toStage, destIndex ?? 0);

    await apiFetch(`/deals/${deal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        stage: toStage,
        ...(lostReason ? { lostReason } : {}),
      }),
    });
  }

  function openContact(deal) {
    // Build minimal contact object from deal enrichment
    const nameParts = (deal.contactName ?? '').split(' ');
    setSelectedContact({
      id: deal.contactId,
      firstName: nameParts[0] ?? '',
      lastName: nameParts.slice(1).join(' ') || null,
      companyName: deal.companyName ?? null,
      score: deal.score ?? 0,
    });
  }

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {activePipeline?.name ?? 'Pipeline'}
              </h1>
              <p className="text-sm text-slate-400">
                {totalDeals} deal{totalDeals !== 1 ? 's' : ''}
                {totalValue > 0 && (
                  <span className="ml-2 text-green-600 font-medium">
                    · ₹{totalValue.toLocaleString('en-IN')}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Pipeline tabs */}
              {pipelines.length > 1 && (
                <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
                  {pipelines.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setActivePipelineId(p.id)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activePipelineId === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {p.name}
                      {p.dealCount > 0 && (
                        <span className="ml-1.5 text-xs font-normal opacity-70">{p.dealCount}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {/* Show archived toggle */}
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                Show archived
              </label>
            </div>
          </div>
        </div>

        {pipelines.length === 0 && !loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">No pipelines yet</h3>
            <p className="text-sm text-slate-400">Create a pipeline to get started tracking your deals.</p>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading pipeline…</div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex-1 flex gap-3 px-4 py-4 overflow-x-auto">
              {kanbanStages.map((stageData, stageIndex) => {
                const { color, light } = getStageStyle(stageData.stageName, stageIndex);
                const stageDeals = stageData.deals ?? [];
                return (
                  <div
                    key={stageData.stageName}
                    className={`flex flex-col rounded-xl border ${light} min-w-[220px] w-[220px] shrink-0`}
                  >
                    {/* Stage header */}
                    <div className={`${color} rounded-t-xl px-3 py-2.5`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <h2 className="text-white font-semibold text-xs uppercase tracking-wide truncate flex-1 mr-1">
                          {stageData.stageName}
                        </h2>
                        <span className="bg-white/25 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0">
                          {stageDeals.length}
                        </span>
                      </div>
                      {stageData.totalValue > 0 && (
                        <p className="text-white/70 text-[10px] font-medium">
                          ₹{Number(stageData.totalValue).toLocaleString('en-IN')}
                        </p>
                      )}
                    </div>

                    {/* Droppable area */}
                    <Droppable droppableId={stageData.stageName}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 p-2 space-y-2 min-h-[120px] rounded-b-xl transition-colors ${snapshot.isDraggingOver ? 'bg-white/60' : ''}`}
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
                            <p className="text-center text-xs text-slate-300 py-3">Empty</p>
                          )}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </main>

      {/* Won/Lost modal */}
      {wonLostModal && (
        <WonLostModal
          stageName={wonLostModal.toStage}
          contactName={wonLostModal.deal.contactName ?? 'this contact'}
          onConfirm={confirmWonLost}
          onCancel={() => setWonLostModal(null)}
        />
      )}

      {/* Contact slide-in */}
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
