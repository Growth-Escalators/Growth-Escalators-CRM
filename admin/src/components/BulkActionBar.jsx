import React, { useState } from 'react';
import { apiFetch } from '../lib/api.js';

const PIPELINE_STAGES = {
  ecom: [
    { id: 'paid_9', label: '₹9' },
    { id: 'paid_208', label: '₹208' },
    { id: 'paid_508', label: '₹508' },
    { id: 'paid_707', label: '₹707' },
    { id: 'appointment_booked', label: 'Appt Booked' },
    { id: 'no_show', label: 'No Show' },
    { id: 'call_done', label: 'Call Done' },
    { id: 'final_followup', label: 'Final Follow-up' },
    { id: 'won', label: 'Client Won' },
  ],
  direct: [
    { id: 'appointment', label: 'Appointment' },
    { id: 'booked', label: 'Booked' },
    { id: 'no_show', label: 'No Show' },
    { id: 'follow_up', label: 'Follow-up' },
    { id: 'won', label: 'Client' },
  ],
};

export default function BulkActionBar({ selectedIds, onClear, onDone }) {
  const count = selectedIds.size;

  // Tag panel state
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagging, setTagging] = useState(false);

  // Pipeline panel state
  const [showPipelinePanel, setShowPipelinePanel] = useState(false);
  const [pipeline, setPipeline] = useState('direct');
  const [stage, setStage] = useState('booked');
  const [adding, setAdding] = useState(false);

  async function handleBulkTag() {
    const tags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    setTagging(true);
    await apiFetch('/contacts/bulk-tag', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds], tags, mode: 'add' }),
    });
    setTagging(false);
    setTagInput('');
    setShowTagPanel(false);
    onDone?.();
  }

  async function handleAddToPipeline() {
    setAdding(true);
    await apiFetch('/deals/bulk-create', {
      method: 'POST',
      body: JSON.stringify({
        contactIds: [...selectedIds],
        stage,
        serviceType: pipeline,
        title: 'Manual Pipeline Entry',
      }),
    });
    setAdding(false);
    setShowPipelinePanel(false);
    onDone?.();
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {/* Tag panel */}
      {showTagPanel && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 flex items-center gap-2 min-w-[360px]">
          <input
            autoFocus
            type="text"
            placeholder="Tags (comma-separated)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBulkTag()}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            onClick={handleBulkTag}
            disabled={tagging || !tagInput.trim()}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {tagging ? 'Tagging…' : 'Apply'}
          </button>
          <button onClick={() => setShowTagPanel(false)} className="text-slate-400 hover:text-slate-600 text-sm">
            Cancel
          </button>
        </div>
      )}

      {/* Pipeline panel */}
      {showPipelinePanel && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 flex items-center gap-2 min-w-[420px] flex-wrap">
          <select
            value={pipeline}
            onChange={(e) => { setPipeline(e.target.value); setStage(PIPELINE_STAGES[e.target.value][0].id); }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="direct">Direct / Booking</option>
            <option value="ecom">Ecom Buyers</option>
          </select>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {PIPELINE_STAGES[pipeline].map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleAddToPipeline}
            disabled={adding}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {adding ? 'Adding…' : 'Add to Pipeline'}
          </button>
          <button onClick={() => setShowPipelinePanel(false)} className="text-slate-400 hover:text-slate-600 text-sm">
            Cancel
          </button>
        </div>
      )}

      {/* Main action bar */}
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4">
        <span className="text-sm font-semibold text-slate-300">
          {count} selected
        </span>
        <div className="w-px h-4 bg-slate-600" />
        <button
          onClick={() => { setShowTagPanel(!showTagPanel); setShowPipelinePanel(false); }}
          className="text-sm font-medium hover:text-violet-300 transition-colors"
        >
          Tag
        </button>
        <button
          onClick={() => { setShowPipelinePanel(!showPipelinePanel); setShowTagPanel(false); }}
          className="text-sm font-medium hover:text-emerald-300 transition-colors"
        >
          Add to Pipeline
        </button>
        <div className="w-px h-4 bg-slate-600" />
        <button
          onClick={onClear}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
