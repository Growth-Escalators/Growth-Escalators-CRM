import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

const STATUS_BADGE = { healthy: 'badge-success', warn: 'badge-warning', paused: 'badge-accent', blacklisted: 'badge-danger' };

export default function WizmatchDomainsPage() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await apiFetch('/api/wizmatch/domains'); setDomains(data.items || []); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(load, 300000); return () => clearInterval(i); }, [load]);

  const pauseDomain = async (id, reason) => {
    try { await apiFetch(`/api/wizmatch/domains/${id}/pause`, { method: 'POST', body: JSON.stringify({ reason }) }); load(); }
    catch (e) { alert(e.message); }
  };
  const resumeDomain = async (id) => {
    try { await apiFetch(`/api/wizmatch/domains/${id}/resume`, { method: 'POST' }); load(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-6">Domain Health</h1>
      <div className="grid grid-cols-3 gap-4">
        {loading ? <p className="text-neutral-400">Loading...</p>
        : domains.map(d => (
          <div key={d.id} className="card p-4">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-[15px] font-semibold text-neutral-900">{d.domain}</h3>
              <span className={STATUS_BADGE[d.status] || 'badge-muted'}>{d.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3 text-neutral-600">
              <div><span className="font-medium text-neutral-700">SPF:</span> {d.spf_ok === null ? '—' : d.spf_ok ? '✅' : '❌'}</div>
              <div><span className="font-medium text-neutral-700">DMARC:</span> {d.dmarc_ok === null ? '—' : d.dmarc_ok ? '✅' : '❌'}</div>
              <div><span className="font-medium text-neutral-700">Sends 7d:</span> {d.sends_7d}</div>
              <div><span className="font-medium text-neutral-700">Reply rate:</span> {(d.reply_rate_7d * 100).toFixed(1)}%</div>
            </div>
            <div className="text-xs text-neutral-400 mb-2">Last check: {d.last_check_at ? new Date(d.last_check_at).toLocaleString() : 'Never'}</div>
            <div className="text-xs text-neutral-400 mb-3">Inboxes: {d.inbox_addresses?.join(', ')}</div>
            <div className="flex gap-2">
              {d.status === 'healthy' ? (
                <button onClick={() => { const r = prompt('Reason for pausing?'); if (r) pauseDomain(d.id, r); }} className="btn-accent btn-compact">Pause</button>
              ) : (
                <button onClick={() => resumeDomain(d.id)} className="btn-primary btn-compact">Resume</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}