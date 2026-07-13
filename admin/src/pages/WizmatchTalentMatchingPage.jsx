import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, UserCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

export default function WizmatchTalentMatchingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems((await apiFetch('/api/wizmatch/staffing/recruiter-work')).items || []); }
    catch (e) { setItems([]); setError(e.message || 'Candidate matching could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(id, decision) {
    setBusy(id); setError('');
    try { await apiFetch(`/api/wizmatch/staffing/matches/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }); await load(); }
    catch (e) { setError(e.message || 'Decision could not be saved.'); }
    finally { setBusy(''); }
  }
  return <div className="p-6 space-y-5">
    <div className="flex items-start justify-between"><div><h1 className="text-[20px] font-bold text-neutral-900">Talent Matching</h1><p className="text-[12.5px] text-neutral-500 mt-1">Explainable, requirement-specific matches. Decisions never submit or contact a candidate.</p></div><button className="btn-standard btn-compact" onClick={load}><RefreshCw className="w-3.5 h-3.5"/> Refresh</button></div>
    <div className="rounded-md border border-info-200 bg-info-50 p-3 text-[12.5px] text-info-800 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0"/> SAP ABAP/FICO and Java/JavaScript stay separate unless a requirement explicitly allows a broad-family rule.</div>
    {error && <div role="alert" className="border border-danger-200 bg-danger-50 text-danger-700 rounded-md p-3">{error} <button className="underline font-semibold ml-2" onClick={load}>Retry</button></div>}
    {loading ? <div className="card p-8 text-center text-neutral-400">Loading recruiter decisions…</div> : <div className="grid lg:grid-cols-2 gap-3">
      {!items.length ? <div className="card p-8 text-center text-neutral-400 lg:col-span-2">No candidate matches need your review.</div> : items.map(item => <article className="card p-4" key={item.id}>
        <div className="flex justify-between gap-3"><div><div className="font-semibold text-neutral-900">{[item.first_name,item.last_name].filter(Boolean).join(' ')}</div><div className="text-[12px] text-neutral-500">{item.requirement_title}</div></div><div className="text-right"><div className="text-xl font-bold text-primary-700">{item.score}</div><div className="text-[10px] text-neutral-400">{item.score_version}</div></div></div>
        <div className="mt-3 flex flex-wrap gap-1">{(item.blockers || []).map(value => <span className="badge-danger" key={value}>{String(value).replaceAll('_',' ')}</span>)}{!(item.blockers || []).length && <span className="badge-success">No hard blockers</span>}</div>
        <div className="text-[11.5px] text-neutral-500 mt-2">Missing evidence: {(item.missing_evidence || []).join(', ') || 'none recorded'}</div>
        <div className="mt-4 flex gap-2"><button disabled={busy===item.id} className="btn-standard btn-compact" onClick={()=>decide(item.id,'shortlisted')}><UserCheck className="w-3.5 h-3.5"/> Shortlist</button><button disabled={busy===item.id} className="btn-standard btn-compact" onClick={()=>decide(item.id,'watch')}>Watch</button><button disabled={busy===item.id} className="btn-standard btn-compact text-danger-700" onClick={()=>decide(item.id,'rejected')}>Reject</button></div>
      </article>)}
    </div>}
  </div>;
}
