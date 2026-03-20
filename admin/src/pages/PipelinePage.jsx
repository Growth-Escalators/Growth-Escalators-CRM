import React, { useEffect, useState, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import { apiFetch } from '../lib/api.js';

const STAGES = [
  { id: 'appointment', label: 'Appointment', color: 'bg-blue-50 border-blue-200', headerColor: 'bg-blue-500' },
  { id: 'booked', label: 'Booked', color: 'bg-emerald-50 border-emerald-200', headerColor: 'bg-emerald-500' },
  { id: 'no_show', label: 'No Show', color: 'bg-rose-50 border-rose-200', headerColor: 'bg-rose-500' },
  { id: 'follow_up', label: 'Follow-up', color: 'bg-amber-50 border-amber-200', headerColor: 'bg-amber-500' },
  { id: 'won', label: 'Client', color: 'bg-violet-50 border-violet-200', headerColor: 'bg-violet-500' },
];

function daysInStage(deal) {
  const updated = deal.updatedAt ? new Date(deal.updatedAt) : new Date(deal.createdAt);
  const now = new Date();
  return Math.floor((now - updated) / (1000 * 60 * 60 * 24));
}

function DealCard({ deal, contact, index, onClick }) {
  const days = daysInStage(deal);
  const isStale = days > 3;

  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={`bg-white rounded-xl border border-slate-200 p-3 cursor-pointer shadow-sm hover:shadow-md transition-shadow ${snapshot.isDragging ? 'shadow-lg rotate-1' : ''}`}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="font-semibold text-slate-900 text-sm leading-tight">
              {contact?.firstName ?? '?'} {contact?.lastName ?? ''}
            </p>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${isStale ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
              {days}d
            </span>
          </div>

          <div className="flex flex-wrap gap-1">
            {(contact?.tags ?? []).slice(0, 2).map((tag) => (
              <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">
                {tag}
              </span>
            ))}
            {contact?.source && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {contact.source}
              </span>
            )}
          </div>

          {deal.value && (
            <p className="text-xs text-slate-400 mt-1.5">
              ₹{Number(deal.value).toLocaleString('en-IN')}
            </p>
          )}
        </div>
      )}
    </Draggable>
  );
}

export default function PipelinePage() {
  const [dealsByStage, setDealsByStage] = useState({});
  const [contactsMap, setContactsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch('/deals?limit=500');
    if (!data) return;

    const deals = data.deals ?? [];

    // Group by stage
    const grouped = {};
    STAGES.forEach((s) => { grouped[s.id] = []; });
    deals.forEach((d) => {
      const stage = d.stage ?? 'appointment';
      if (grouped[stage]) grouped[stage].push(d);
      // else ignore stages not in our board
    });
    setDealsByStage(grouped);

    // Load contacts for all deals (deduplicated)
    const contactIds = [...new Set(deals.map((d) => d.contactId).filter(Boolean))];
    const map = {};
    await Promise.all(
      contactIds.map(async (id) => {
        const c = await apiFetch(`/contacts/${id}`);
        if (c?.contact) map[id] = c.contact;
        else if (c?.id) map[id] = c;
      })
    );
    setContactsMap(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDragEnd(result) {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;

    const fromStage = source.droppableId;
    const toStage = destination.droppableId;
    const deal = dealsByStage[fromStage].find((d) => d.id === draggableId);
    if (!deal) return;

    // Optimistic update
    setDealsByStage((prev) => {
      const next = { ...prev };
      next[fromStage] = next[fromStage].filter((d) => d.id !== draggableId);
      const updated = { ...deal, stage: toStage };
      const toArr = [...next[toStage]];
      toArr.splice(destination.index, 0, updated);
      next[toStage] = toArr;
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
        <div className="bg-white border-b px-8 py-5 shrink-0">
          <h1 className="text-xl font-bold text-slate-900">Pipeline</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {Object.values(dealsByStage).flat().length} total deals
          </p>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading pipeline…</div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex-1 flex gap-4 px-6 py-6 overflow-x-auto">
              {STAGES.map((stage) => {
                const deals = dealsByStage[stage.id] ?? [];
                return (
                  <div key={stage.id} className={`flex flex-col rounded-xl border ${stage.color} min-w-[260px] w-[260px] shrink-0`}>
                    {/* Column header */}
                    <div className={`${stage.headerColor} rounded-t-xl px-4 py-3 flex items-center justify-between`}>
                      <h2 className="text-white font-semibold text-sm">{stage.label}</h2>
                      <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        {deals.length}
                      </span>
                    </div>

                    {/* Cards */}
                    <Droppable droppableId={stage.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 p-3 space-y-2 min-h-[200px] transition-colors rounded-b-xl ${snapshot.isDraggingOver ? 'bg-white/60' : ''}`}
                        >
                          {deals.map((deal, index) => (
                            <DealCard
                              key={deal.id}
                              deal={deal}
                              contact={contactsMap[deal.contactId]}
                              index={index}
                              onClick={() => {
                                const contact = contactsMap[deal.contactId];
                                if (contact) setSelectedContact(contact);
                              }}
                            />
                          ))}
                          {provided.placeholder}
                          {deals.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-center text-xs text-slate-400 py-4">No deals</p>
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
