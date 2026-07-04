import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

const MSA_BADGE = { none: 'badge-muted', in_progress: 'badge-warning', signed: 'badge-success' };

export default function WizmatchPrimesPage() {
  const [primes, setPrimes] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await apiFetch('/api/wizmatch/primes'); setPrimes(data.items || []); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-6">Primes Management</h1>
      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Company</th>
              <th>Domain</th>
              <th>MSA Status</th>
              <th>Signed Date</th>
              <th>Active Placements</th>
              <th>Monthly Margin</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="6" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            : primes.length === 0 ? <tr><td colSpan="6" className="px-4 py-8 text-center text-neutral-400">No prime companies yet</td></tr>
            : primes.map(p => (
              <tr key={p.id}>
                <td className="font-medium text-neutral-900">{p.name}</td>
                <td>{p.domain || '—'}</td>
                <td><span className={MSA_BADGE[p.prime_msa_status] || 'badge-muted'}>{p.prime_msa_status}</span></td>
                <td className="text-neutral-500">{p.prime_msa_signed_at ? new Date(p.prime_msa_signed_at).toLocaleDateString() : '—'}</td>
                <td>{p.active_placements || 0}</td>
                <td className="font-medium text-success-600">${((p.monthly_margin || 0)).toLocaleString()}/mo</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}