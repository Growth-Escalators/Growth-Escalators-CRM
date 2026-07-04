import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

const STAGES = ['submitted', 'interviewing', 'offered', 'started', 'ended', 'lost'];
const STAGE_COLORS = { submitted: '#3b82f6', interviewing: '#f59e0b', offered: '#8b5cf6', started: '#22c55e', ended: '#94a3b8', lost: '#ef4444' };

export default function WizmatchPlacementsPage() {
  const [placements, setPlacements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState(null);

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

  if (loading) return <div className="p-6"><p className="text-neutral-400">Loading...</p></div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[20px] font-bold text-neutral-900">Placements Pipeline</h1>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map(stage => (
          <div key={stage} className="flex-shrink-0 w-64" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, stage)}>
            <div className="rounded-t-lg p-2 text-white text-[13.5px] font-semibold" style={{ backgroundColor: STAGE_COLORS[stage] }}>
              {stage.charAt(0).toUpperCase() + stage.slice(1)} ({placements.filter(p => p.status === stage).length})
            </div>
            <div className="bg-neutral-100 border border-neutral-200 rounded-b-lg min-h-[200px] p-2 space-y-2">
              {placements.filter(p => p.status === stage).map(p => (
                <div key={p.id} draggable onDragStart={() => setDraggedId(p.id)} className="bg-white rounded-lg shadow-card p-2 cursor-move hover:shadow-hover transition-shadow">
                  <div className="font-medium text-sm text-neutral-900">{p.candidate_first} {p.candidate_last}</div>
                  <div className="text-xs text-neutral-500">{p.company_name}</div>
                  <div className="text-xs text-neutral-400">{p.job_title}</div>
                  {p.margin_hourly && <div className="text-xs font-medium text-success-600">${p.margin_hourly}/hr margin</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}