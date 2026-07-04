import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

export default function WizmatchCompliancePage() {
  const [suppressions, setSuppressions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (filters.reason) params.set('reason', filters.reason);
      const data = await apiFetch(`/api/wizmatch/suppression?${params}`);
      setSuppressions(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-6">Compliance Log</h1>
      <div className="mb-4 flex gap-3 items-center">
        <select value={filters.reason} onChange={e => setFilters({ reason: e.target.value })} className="input w-auto">
          <option value="">All Reasons</option>
          <option value="unsubscribe">Unsubscribe</option>
          <option value="hard_bounce">Hard Bounce</option>
          <option value="complaint">Complaint</option>
          <option value="do_not_contact">Do Not Contact</option>
          <option value="manual">Manual</option>
        </select>
        <span className="text-[12.5px] text-neutral-500">{total} suppressed emails</span>
      </div>
      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Email</th>
              <th>Reason</th>
              <th>Channel</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="4" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            : suppressions.map(s => (
              <tr key={s.id}>
                <td className="font-medium text-neutral-900">{s.email}</td>
                <td><span className="badge-danger">{s.reason}</span></td>
                <td className="text-neutral-500">{s.source_channel}</td>
                <td className="text-neutral-500">{s.suppressed_at ? new Date(s.suppressed_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}