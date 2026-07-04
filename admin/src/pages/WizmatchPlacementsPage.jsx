import { useState, useEffect, useCallback, useMemo } from 'react';
import { Download } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { Modal, Button } from '../components/ui/index.js';

const STAGES = ['submitted', 'interviewing', 'offered', 'started', 'ended', 'lost'];
const STAGE_LABELS = { submitted: 'Submitted', interviewing: 'Interviewing', offered: 'Offered', started: 'Started', ended: 'Ended', lost: 'Lost' };
const STAGE_COLORS = { submitted: '#3b82f6', interviewing: '#f59e0b', offered: '#8b5cf6', started: '#22c55e', ended: '#94a3b8', lost: '#ef4444' };
// Neutral columns match tokens exactly (neutral-100/neutral-200); started/lost use
// the spec's exact tints, which aren't in the token scale.
const COLUMN_BG = {
  submitted: 'bg-neutral-100 border-neutral-200',
  interviewing: 'bg-neutral-100 border-neutral-200',
  offered: 'bg-neutral-100 border-neutral-200',
  started: 'bg-[#f0fdf4] border-[#bbf7d0]',
  ended: 'bg-neutral-100 border-neutral-200',
  lost: 'bg-[#fef2f2] border-[#fecaca]',
};
const HEADER_TEXT = { started: 'text-[#15803d]', lost: 'text-[#b91c1c]' };
const COUNT_PILL = {
  started: 'bg-white border-[#bbf7d0] text-[#15803d]',
  lost: 'bg-white border-[#fecaca] text-[#dc2626]',
};
const SUBTOTAL_TEXT = { started: 'text-[#16a34a]', lost: 'text-[#dc2626]' };
const NEW_CARD_BORDER = {
  started: 'border-[#bbf7d0] text-[#16a34a]',
  lost: 'border-[#fecaca] text-[#dc2626]',
};

export default function WizmatchPlacementsPage() {
  const [placements, setPlacements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await apiFetch('/api/wizmatch/placements?limit=200'); setPlacements(data.items || []); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    try { await apiFetch(`/api/wizmatch/placements/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); load(); }
    catch (e) { alert(e.message); }
  };

  const onDrop = (e, status) => {
    e.preventDefault();
    if (draggedId) { updateStatus(draggedId, status); setDraggedId(null); }
  };

  // Client-side only — derived from already-loaded placements, no new fetch.
  const roles = useMemo(
    () => Array.from(new Set(placements.map(p => p.job_title).filter(Boolean))).sort(),
    [placements],
  );
  const filteredPlacements = roleFilter ? placements.filter(p => p.job_title === roleFilter) : placements;
  const totalMargin = filteredPlacements.reduce((sum, p) => sum + Number(p.margin_hourly || 0), 0);

  if (loading) return <div className="p-6"><p className="text-neutral-400">Loading...</p></div>;

  return (
    <div className="flex flex-col h-full">
      {/* Command bar */}
      <div className="bg-white border-b border-neutral-200 px-6 py-3.5 flex items-center gap-3">
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input w-auto min-w-[170px]">
          <option value="">All roles</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="text-[12.5px] font-semibold text-primary-700 bg-primary-500/10 border border-primary-500/20 px-2.5 py-0.5 rounded-full">
          {filteredPlacements.length} placements · ${totalMargin}/hr margin
        </span>
        <button type="button" disabled className="h-8 px-3 text-[12.5px] font-medium text-neutral-700 bg-white border border-neutral-300 rounded-sm disabled:opacity-100 disabled:cursor-not-allowed">
          All recruiters
        </button>
        <button type="button" disabled className="h-8 px-3 text-[12.5px] font-medium text-neutral-700 bg-white border border-neutral-300 rounded-sm disabled:opacity-100 disabled:cursor-not-allowed">
          All primes
        </button>
        <div className="flex-1" />
        <button className="btn-standard">
          <Download className="w-3.5 h-3.5" /> Export
        </button>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          + Add Placement
        </button>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 pt-[18px] px-6 pb-6 items-start min-w-max">
          {STAGES.map(stage => {
            const stageDeals = filteredPlacements.filter(p => p.status === stage);
            const stageMargin = stageDeals.reduce((sum, p) => sum + Number(p.margin_hourly || 0), 0);
            return (
              <div
                key={stage}
                className={`flex-shrink-0 w-64 rounded-lg border overflow-hidden ${COLUMN_BG[stage]}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, stage)}
              >
                <span className="h-[3px] block" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                  <h2 className={`text-[12.5px] font-semibold flex-1 truncate ${HEADER_TEXT[stage] || 'text-neutral-700'}`}>
                    {STAGE_LABELS[stage]}
                  </h2>
                  <span className={`text-[11px] font-semibold px-1.5 py-px rounded-full border ${COUNT_PILL[stage] || 'bg-white border-neutral-200 text-neutral-500'}`}>
                    {stageDeals.length}
                  </span>
                </div>
                <p className={`px-3 pb-2 text-[11px] font-medium ${SUBTOTAL_TEXT[stage] || 'text-neutral-400'}`}>
                  ${stageMargin}/hr margin
                </p>
                <div className="px-2.5 pb-2.5 space-y-2">
                  {stageDeals.map(p => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={() => setDraggedId(p.id)}
                      className="bg-white rounded-lg shadow-card p-3 cursor-move hover:shadow-hover transition-shadow"
                    >
                      <p className="text-[13.5px] font-semibold text-neutral-900">{p.candidate_first} {p.candidate_last}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">{p.company_name}</p>
                      <p className="text-[11.5px] text-neutral-400 mt-px mb-2">{p.job_title}</p>
                      <div className="flex items-center justify-between">
                        {stage === 'ended' ? (
                          <span className="text-xs font-semibold text-neutral-500">Contract ended</span>
                        ) : stage === 'lost' ? (
                          <span className="text-[11.5px] font-medium text-danger-600">Lost</span>
                        ) : p.margin_hourly ? (
                          <span className="text-xs font-semibold text-success-600">${p.margin_hourly}/hr margin</span>
                        ) : <span />}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setShowAddModal(true)}
                    className={`w-full text-xs font-medium border border-dashed rounded-md py-1.5 transition-colors hover:bg-white/60 ${NEW_CARD_BORDER[stage] || 'border-neutral-300 text-neutral-400'}`}
                  >
                    + New
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showAddModal && (
        <AddPlacementModal onClose={() => setShowAddModal(false)} onDone={() => { setShowAddModal(false); load(); }} />
      )}
    </div>
  );
}

function AddPlacementModal({ onClose, onDone }) {
  const [candidates, setCandidates] = useState([]);
  const [signals, setSignals] = useState([]);
  const [form, setForm] = useState({ candidate_id: '', job_signal_id: '', placement_type: 'contract_c2c', bill_rate_hourly: '', pay_rate_hourly: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/wizmatch/candidates?limit=200').then(d => setCandidates(d.items || [])).catch(() => {});
    apiFetch('/api/wizmatch/signals?limit=200').then(d => setSignals(d.items || [])).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const signal = signals.find(s => s.id === form.job_signal_id);
      await apiFetch('/api/wizmatch/placements', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: form.candidate_id,
          job_signal_id: form.job_signal_id || undefined,
          company_id: signal?.company_id,
          placement_type: form.placement_type,
          bill_rate_hourly: form.bill_rate_hourly ? Number(form.bill_rate_hourly) : undefined,
          pay_rate_hourly: form.pay_rate_hourly ? Number(form.pay_rate_hourly) : undefined,
        }),
      });
      onDone();
    } catch (e) { alert('Failed: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Placement"
      footer={
        <>
          <Button variant="standard" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-placement-form" disabled={saving || !form.candidate_id}>
            {saving ? 'Saving…' : 'Add Placement'}
          </Button>
        </>
      }
    >
      <form id="add-placement-form" onSubmit={submit} className="space-y-3">
        <select required value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })} className="input w-full">
          <option value="">Select candidate…</option>
          {candidates.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
        </select>
        <select value={form.job_signal_id} onChange={e => setForm({ ...form, job_signal_id: e.target.value })} className="input w-full">
          <option value="">Select role (optional)…</option>
          {signals.map(s => <option key={s.id} value={s.id}>{s.job_title} — {s.company_name}</option>)}
        </select>
        <select value={form.placement_type} onChange={e => setForm({ ...form, placement_type: e.target.value })} className="input w-full">
          <option value="contract_c2c">Contract — C2C</option>
          <option value="contract_w2">Contract — W2</option>
          <option value="contract_1099">Contract — 1099</option>
          <option value="permanent">Permanent</option>
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input type="number" placeholder="Bill rate $/hr" value={form.bill_rate_hourly} onChange={e => setForm({ ...form, bill_rate_hourly: e.target.value })} className="input" />
          <input type="number" placeholder="Pay rate $/hr" value={form.pay_rate_hourly} onChange={e => setForm({ ...form, pay_rate_hourly: e.target.value })} className="input" />
        </div>
      </form>
    </Modal>
  );
}
