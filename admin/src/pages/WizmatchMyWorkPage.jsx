import { useCallback, useEffect, useState } from 'react';
import { Briefcase, CheckSquare, Clock, RefreshCw, User } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

function dueLabel(value) {
  if (!value) return 'No due date';
  const date = new Date(value);
  const overdue = date.getTime() < Date.now();
  return <span className={overdue ? 'text-danger-600 font-semibold' : 'text-neutral-600'}>{overdue ? 'Overdue · ' : ''}{date.toLocaleString()}</span>;
}
export default function WizmatchMyWorkPage() {
  const [data, setData] = useState({ requirements: [], tasks: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await apiFetch('/api/wizmatch/staffing/my-work')); }
    catch (e) { setError(e.message || 'My Work could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return <div className="p-6 space-y-5">
    <div className="flex items-start justify-between">
      <div><h1 className="text-[20px] font-bold text-neutral-900">My Work / Today</h1><p className="text-[12.5px] text-neutral-500 mt-1">Your assigned requirements, dated next actions and linked staffing tasks.</p></div>
      <button className="btn-standard btn-compact" onClick={load}><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>
    </div>
    {error && <div role="alert" className="border border-danger-200 bg-danger-50 text-danger-700 rounded-md p-3">{error} <button className="underline font-semibold ml-2" onClick={load}>Retry</button></div>}
    {loading ? <div className="card p-8 text-center text-neutral-400">Loading your work…</div> : <>
      <section><h2 className="text-[14px] font-bold text-neutral-800 mb-2 flex items-center gap-2"><Briefcase className="w-4 h-4"/> Assigned requirements ({data.requirements?.length || 0})</h2>
        <div className="card overflow-hidden"><table className="table-fluent"><thead><tr><th>Requirement</th><th>Source</th><th>My role</th><th>Stage</th><th>Next action</th></tr></thead><tbody>
          {!data.requirements?.length ? <tr><td colSpan="5" className="text-center py-8 text-neutral-400">No active requirements are assigned to you.</td></tr> : data.requirements.map(r => <tr key={r.id}>
            <td><div className="font-semibold text-neutral-900">{r.title}</div><div className="text-[11.5px] text-neutral-500">{r.company_name || 'Unknown company'}</div></td>
            <td>{[r.source_first_name,r.source_last_name].filter(Boolean).join(' ') || <span className="text-warning-700">Needs attribution</span>}</td>
            <td>{(r.my_roles || []).map(role => <span key={role} className="badge-info mr-1">{role.replaceAll('_',' ')}</span>)}</td>
            <td><span className="badge-muted">{(r.stage || 'draft').replaceAll('_',' ')}</span></td>
            <td><div>{r.next_action || <span className="text-warning-700">No next action</span>}</div><div className="text-[11px] mt-1"><Clock className="w-3 h-3 inline mr-1"/>{dueLabel(r.next_action_due_at)}</div></td>
          </tr>)}</tbody></table></div>
      </section>
      <section><h2 className="text-[14px] font-bold text-neutral-800 mb-2 flex items-center gap-2"><CheckSquare className="w-4 h-4"/> Open linked tasks ({data.tasks?.length || 0})</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{!data.tasks?.length ? <div className="card p-6 text-neutral-400">No open staffing tasks.</div> : data.tasks.map(t => <div className="card p-4" key={t.id}><div className="font-semibold text-neutral-900">{t.title}</div><div className="text-[12px] text-neutral-500 mt-1">{t.description}</div><div className="text-[11.5px] mt-3 flex items-center gap-1"><User className="w-3 h-3"/>{dueLabel(t.due_at)}</div></div>)}</div>
      </section>
    </>}
  </div>;
}
