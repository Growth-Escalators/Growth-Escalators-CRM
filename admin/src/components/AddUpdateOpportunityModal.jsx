import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';

export default function AddUpdateOpportunityModal({ contactIds, contacts = [], onClose, onDone }) {
  const [pipelines, setPipelines] = useState([]);
  const [selectedPipeline, setSelectedPipeline] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [actionName, setActionName] = useState('');
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }

  useEffect(() => {
    apiFetch('/api/pipelines').then((data) => {
      if (Array.isArray(data)) {
        setPipelines(data);
        if (data.length > 0) {
          setSelectedPipeline(data[0].id);
          const stages = data[0].stages ?? [];
          if (stages.length > 0) setSelectedStage(stages[0]);
        }
      }
    });
  }, []);

  const activePipeline = pipelines.find((p) => p.id === selectedPipeline);
  const stageList = (activePipeline?.stages ?? []) ;

  function handlePipelineChange(pipelineId) {
    setSelectedPipeline(pipelineId);
    const p = pipelines.find((x) => x.id === pipelineId);
    const stages = p?.stages ?? [];
    setSelectedStage(stages[0] ?? '');
  }

  async function handleSubmit() {
    if (!selectedPipeline || !selectedStage) return;
    setSubmitting(true);
    setProgress({ done: 0, total: contactIds.length });

    let done = 0;
    for (const contactId of contactIds) {
      await apiFetch('/deals/add-or-update', {
        method: 'POST',
        body: JSON.stringify({
          contactId,
          pipelineId: selectedPipeline,
          stage: selectedStage,
          title: actionName || `Opportunity — ${activePipeline?.name}`,
          ...(assignedTo ? { assignedTo } : {}),
          ...(dealValue ? { dealValue: parseInt(dealValue, 10) } : {}),
          ...(notes ? { notes } : {}),
        }),
      });
      done += 1;
      setProgress({ done, total: contactIds.length });
    }

    setSubmitting(false);
    setProgress(null);
    onDone?.();
  }

  // Show first 3 avatars + overflow count
  const shownContacts = contacts.slice(0, 3);
  const overflowCount = contacts.length - shownContacts.length;

  function initials(c) {
    return `${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add/Update Opportunity</h2>
            <p className="text-sm text-slate-500 mt-0.5">Add or update opportunities for all selected contacts</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Selected contacts avatars */}
          {contacts.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {shownContacts.map((c) => (
                  <div
                    key={c.id}
                    className="w-8 h-8 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: stringToColor(c.id) }}
                    title={`${c.firstName} ${c.lastName ?? ''}`}
                  >
                    {initials(c)}
                  </div>
                ))}
                {overflowCount > 0 && (
                  <div className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-xs font-semibold text-slate-600">
                    +{overflowCount}
                  </div>
                )}
              </div>
              <span className="text-sm text-slate-500">{contacts.length} contact{contacts.length > 1 ? 's' : ''} selected</span>
            </div>
          )}

          {/* Action Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Action Name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="relative">
              <input
                type="text"
                maxLength={256}
                value={actionName}
                onChange={(e) => setActionName(e.target.value)}
                placeholder="Write a name for this action…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{actionName.length}/256</span>
            </div>
          </div>

          {/* Pipeline */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Select Pipeline <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedPipeline}
              onChange={(e) => handlePipelineChange(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose pipeline…</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Stage */}
          {stageList.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Select Stage <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Choose stage…</option>
                {stageList.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {/* Extra fields toggle */}
          <button
            type="button"
            onClick={() => setShowExtraFields(!showExtraFields)}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <svg className={`w-4 h-4 transition-transform ${showExtraFields ? 'rotate-45' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
            </svg>
            {showExtraFields ? 'Hide' : 'Add'} Fields
          </button>

          {showExtraFields && (
            <div className="space-y-4 border border-slate-100 rounded-xl p-4 bg-slate-50">
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
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Deal Value (₹)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">₹</span>
                  <input
                    type="number"
                    min="0"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    placeholder="0"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 pl-7 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Any notes about this opportunity…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            Please note the action will be performed over a period of time. You can track the progress below.
          </div>

          {/* Progress */}
          {progress && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="flex justify-between text-sm text-slate-600 mb-2">
                <span>Processing…</span>
                <span>{progress.done} of {progress.total}</span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedPipeline || !selectedStage}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Processing…
              </>
            ) : 'Add/Update Opportunity'}
          </button>
        </div>
      </div>
    </div>
  );
}

function stringToColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#6366F1','#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}
