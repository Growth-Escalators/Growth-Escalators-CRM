import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

function fmtInr(val) {
  if (!val || val <= 0) return null;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  return `₹${Number(val).toLocaleString('en-IN')}`;
}

const SOURCE_LABELS = {
  form: 'Website Form', paid_ad: 'Paid Ad', referral: 'Referral',
  cold_outreach: 'Cold Outreach', checkout: 'Checkout', inbound: 'Inbound Call',
};

export default function DealDrawer({ dealId, onClose, onViewContact, onUpdated }) {
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
      console.error('[DealDrawer] load failed for', dealId, err);
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
