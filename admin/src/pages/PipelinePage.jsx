import React, { useEffect, useState, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';

const PIPELINES = {
  ecom: {
    label: 'Ecom Buyers',
    serviceType: 'ecom',
    stages: [
      { id: 'paid_9',            label: '₹9',               color: 'bg-slate-500',   light: 'bg-slate-50 border-slate-200' },
      { id: 'paid_208',          label: '₹208',             color: 'bg-blue-500',    light: 'bg-blue-50 border-blue-200' },
      { id: 'paid_508',          label: '₹508',             color: 'bg-indigo-500',  light: 'bg-indigo-50 border-indigo-200' },
      { id: 'paid_707',          label: '₹707',             color: 'bg-violet-500',  light: 'bg-violet-50 border-violet-200' },
      { id: 'appointment_booked',label: 'Appt Booked',      color: 'bg-sky-500',     light: 'bg-sky-50 border-sky-200' },
      { id: 'no_show',           label: 'No Show',          color: 'bg-rose-500',    light: 'bg-rose-50 border-rose-200' },
      { id: 'call_done',         label: 'Call Done',        color: 'bg-amber-500',   light: 'bg-amber-50 border-amber-200' },
      { id: 'final_followup',    label: 'Final Follow-up',  color: 'bg-orange-500',  light: 'bg-orange-50 border-orange-200' },
      { id: 'won',               label: 'Client Won',       color: 'bg-emerald-600', light: 'bg-emerald-50 border-emerald-200' },
    ],
  },
  direct: {
    label: 'Direct / Booking',
    serviceType: 'direct',
    stages: [
      { id: 'appointment', label: 'Appointment',  color: 'bg-blue-500',    light: 'bg-blue-50 border-blue-200' },
      { id: 'booked',      label: 'Booked',       color: 'bg-emerald-500', light: 'bg-emerald-50 border-emerald-200' },
      { id: 'no_show',     label: 'No Show',      color: 'bg-rose-500',    light: 'bg-rose-50 border-rose-200' },
      { id: 'follow_up',   label: 'Follow-up',    color: 'bg-amber-500',   light: 'bg-amber-50 border-amber-200' },
      { id: 'won',         label: 'Client',       color: 'bg-violet-600',  light: 'bg-violet-50 border-violet-200' },
    ],
  },
};

const SEGMENT_COLORS = {
  ecom_brand:   'bg-orange-100 text-orange-700',
  agency_owner: 'bg-blue-100 text-blue-700',
  freelancer:   'bg-purple-100 text-purple-700',
};

const SEGMENT_LABELS = {
  ecom_brand:   'Ecom Brand',
  agency_owner: 'Agency',
  freelancer:   'Freelancer',
};

function daysAgo(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function DealCard({ deal, contact, index, onClick, onArchive, onUnarchive }) {
  const days = daysAgo(deal.updatedAt || deal.createdAt);
  const segment = contact?.metadata?.segment;
  const isArchived = deal.metadata?.archived === true;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md transition-all relative ${snapshot.isDragging ? 'shadow-xl rotate-1 scale-105' : ''} ${isArchived ? 'bg-slate-100 opacity-60' : 'bg-white'}`}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <p
              onClick={onClick}
              className="font-semibold text-slate-900 text-sm leading-tight line-clamp-1 cursor-pointer flex-1"
            >
              {contact?.firstName ?? '?'} {contact?.lastName ?? ''}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${days > 3 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                {days}d
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {segment && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${SEGMENT_COLORS[segment] ?? 'bg-slate-100 text-slate-500'}`}>
                {SEGMENT_LABELS[segment] ?? segment}
              </span>
            )}
            {deal.value && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                ₹{Number(deal.value).toLocaleString('en-IN')}
              </span>
            )}
            {isArchived && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-300 text-slate-600 font-medium">Archived</span>
            )}
          </div>

          {/* Overflow menu */}
          {menuOpen && (
            <div
              className="absolute top-8 right-2 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[140px]"
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
      )}
    </Draggable>
  );
}

export default function PipelinePage() {
  const [activePipeline, setActivePipeline] = useState('ecom');
  const [segmentFilter, setSegmentFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [dealsByStage, setDealsByStage] = useState({});
  const [contactsMap, setContactsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);

  const pipeline = PIPELINES[activePipeline];

  const load = useCallback(async () => {
    setLoading(true);
    const url = `/deals?serviceType=${pipeline.serviceType}&limit=500${showArchived ? '&includeArchived=true' : ''}`;
    const data = await apiFetch(url);
    if (!data) return;

    const deals = data.deals ?? [];
    const grouped = {};
    pipeline.stages.forEach((s) => { grouped[s.id] = []; });
    deals.forEach((d) => {
      if (grouped[d.stage] !== undefined) grouped[d.stage].push(d);
    });

    // Apply segment filter client-side (contacts loaded below)
    setDealsByStage(grouped);

    // Load contacts
    const ids = [...new Set(deals.map((d) => d.contactId).filter(Boolean))];
    const map = { ...contactsMap };
    await Promise.all(ids.filter((id) => !map[id]).map(async (id) => {
      const c = await apiFetch(`/contacts/${id}`);
      if (c?.contact) map[id] = c.contact;
    }));
    setContactsMap(map);
    setLoading(false);
  }, [activePipeline, pipeline.serviceType, showArchived]);

  useEffect(() => { load(); }, [load]);

  // Filter deals by segment (client-side since segment is in contact metadata)
  const filteredDealsByStage = {};
  pipeline.stages.forEach((s) => {
    filteredDealsByStage[s.id] = (dealsByStage[s.id] ?? []).filter((d) => {
      if (!segmentFilter) return true;
      const contact = contactsMap[d.contactId];
      return contact?.metadata?.segment === segmentFilter;
    });
  });

  const totalDeals = Object.values(filteredDealsByStage).flat().length;

  async function archiveDeal(dealId, archived) {
    const deal = Object.values(dealsByStage).flat().find((d) => d.id === dealId);
    if (!deal) return;
    await apiFetch(`/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { ...(deal.metadata ?? {}), archived } }),
    });
    load();
  }

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;

    const fromStage = source.droppableId;
    const toStage = destination.droppableId;
    const deal = dealsByStage[fromStage]?.find((d) => d.id === draggableId);
    if (!deal) return;

    setDealsByStage((prev) => {
      const next = { ...prev };
      next[fromStage] = next[fromStage].filter((d) => d.id !== draggableId);
      const updated = { ...deal, stage: toStage };
      const arr = [...(next[toStage] ?? [])];
      arr.splice(destination.index, 0, updated);
      next[toStage] = arr;
      return next;
    });

    await apiFetch(`/deals/${draggableId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: toStage }),
    });
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-8 py-4 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Pipeline</h1>
              <p className="text-sm text-slate-400">{totalDeals} deals</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Pipeline switcher */}
              <div className="flex bg-slate-100 rounded-lg p-1">
                {Object.entries(PIPELINES).map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => { setActivePipeline(key); setSegmentFilter(''); }}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activePipeline === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Segment filter */}
              <select
                value={segmentFilter}
                onChange={(e) => setSegmentFilter(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">All Segments</option>
                <option value="ecom_brand">Ecom Brand</option>
                <option value="agency_owner">Agency Owner</option>
                <option value="freelancer">Freelancer</option>
              </select>
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

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading pipeline…</div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex-1 flex gap-3 px-4 py-4 overflow-x-auto">
              {pipeline.stages.map((stage) => {
                const stageDeals = filteredDealsByStage[stage.id] ?? [];
                return (
                  <div key={stage.id} className={`flex flex-col rounded-xl border ${stage.light} min-w-[220px] w-[220px] shrink-0`}>
                    <div className={`${stage.color} rounded-t-xl px-3 py-2.5 flex items-center justify-between`}>
                      <h2 className="text-white font-semibold text-xs uppercase tracking-wide">{stage.label}</h2>
                      <span className="bg-white/25 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{stageDeals.length}</span>
                    </div>
                    <Droppable droppableId={stage.id}>
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
                              contact={contactsMap[deal.contactId]}
                              index={index}
                              onClick={() => { const c = contactsMap[deal.contactId]; if (c) setSelectedContact(c); }}
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

      {selectedContact && (
        <ContactSlideIn
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdated={() => { load(); setSelectedContact(null); }}
        />
      )}
    </div>
  );
}
