import { useCallback, useEffect, useState } from 'react';
import { Building2, Mail, Phone, Plus, RefreshCw, UserRound } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const ROLE_OPTIONS = ['talent_acquisition','hiring_manager','coordinator','approver','interviewer','procurement','vendor_manager','source'];

export default function WizmatchRelationshipsPage() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState('');
  const [detail, setDetail] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadCompanies = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await apiFetch('/api/wizmatch/staffing/companies'); setCompanies(data.items || []); setSelectedCompany(v => v || data.items?.[0]?.id || ''); }
    catch (e) { setError(e.message || 'Companies could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  const loadDetail = useCallback(async () => {
    if (!selectedCompany) return;
    setError('');
    try { setDetail(await apiFetch(`/api/wizmatch/staffing/companies/${selectedCompany}`)); }
    catch (e) { setDetail(null); setError(e.message || 'Company could not be loaded.'); }
  }, [selectedCompany]);
  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const openContact = async (id) => {
    try { setSelectedContact(await apiFetch(`/api/wizmatch/staffing/company-contacts/${id}`)); }
    catch (e) { setError(e.message); }
  };

  return <div className="p-6 space-y-5">
    <div className="flex justify-between items-start"><div><h1 className="text-[20px] font-bold text-neutral-900">Companies & Hiring Contacts</h1><p className="text-[12.5px] text-neutral-500 mt-1">Company 360 and person-level role attribution. A person’s SAP history remains separate from another person’s Java history.</p></div><button className="btn-standard btn-compact" onClick={() => { loadCompanies(); loadDetail(); }}><RefreshCw className="w-3.5 h-3.5"/> Refresh</button></div>
    {error && <div role="alert" className="border border-danger-200 bg-danger-50 text-danger-700 rounded-md p-3">{error}</div>}
    <div className="flex gap-3 items-center"><label className="text-[12px] font-semibold text-neutral-600">Company</label><select className="input min-w-[280px]" value={selectedCompany} onChange={e => { setSelectedCompany(e.target.value); setSelectedContact(null); }}>{companies.map(c => <option key={c.id} value={c.id}>{c.name} · {c.contact_count} contacts · {c.open_requirement_count} open roles</option>)}</select></div>
    {loading || !detail ? <div className="card p-8 text-center text-neutral-400">{loading ? 'Loading companies…' : 'Select a company.'}</div> : <>
      <div className="grid md:grid-cols-4 gap-3"><Metric label="Hiring contacts" value={detail.contacts.length}/><Metric label="Requirements" value={detail.requirements.length}/><Metric label="Open work" value={detail.tasks.length}/><Metric label="Timeline events" value={detail.events.length}/></div>
      <section><div className="flex justify-between mb-2"><h2 className="text-[14px] font-bold flex items-center gap-2"><UserRound className="w-4 h-4"/> Hiring contacts</h2><button className="btn-primary btn-compact" onClick={() => setShowAdd(true)}><Plus className="w-3.5 h-3.5"/> Link CRM person</button></div>
        <div className="card overflow-hidden"><table className="table-fluent"><thead><tr><th>Person</th><th>Roles</th><th>Contact</th><th>Requirements</th><th>Next action</th></tr></thead><tbody>{!detail.contacts.length ? <tr><td colSpan="5" className="text-center py-8 text-neutral-400">No hiring contacts linked yet.</td></tr> : detail.contacts.map(c => <tr key={c.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => openContact(c.id)}><td className="font-semibold">{[c.first_name,c.last_name].filter(Boolean).join(' ')}</td><td>{(c.roles || []).map(r => <span className="badge-info mr-1" key={r}>{r.replaceAll('_',' ')}</span>)}</td><td><div><Mail className="w-3 h-3 inline mr-1"/>{c.email || '—'}</div><div><Phone className="w-3 h-3 inline mr-1"/>{c.phone || '—'}</div></td><td>{c.active_requirement_count}</td><td>{c.next_action || '—'}</td></tr>)}</tbody></table></div>
      </section>
      <section><h2 className="text-[14px] font-bold flex items-center gap-2 mb-2"><Building2 className="w-4 h-4"/> Requirements by source person</h2><div className="card overflow-hidden"><table className="table-fluent"><thead><tr><th>Role</th><th>Source person</th><th>Stage</th><th>Next action</th></tr></thead><tbody>{!detail.requirements.length ? <tr><td colSpan="4" className="text-center py-8 text-neutral-400">No requirements for this company.</td></tr> : detail.requirements.map(r => <tr key={r.id}><td><div className="font-semibold">{r.title}</div><div className="text-[11px] text-neutral-500">{(r.required_skills || []).join(', ')}</div></td><td>{[r.source_first_name,r.source_last_name].filter(Boolean).join(' ') || <span className="text-warning-700">Needs attribution</span>}</td><td>{(r.stage || 'draft').replaceAll('_',' ')}</td><td>{r.next_action || '—'}</td></tr>)}</tbody></table></div></section>
    </>}
    {showAdd && <AddContactDialog companyId={selectedCompany} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); loadDetail(); }}/>}
    {selectedContact && <Contact360 data={selectedContact} onClose={() => setSelectedContact(null)}/>}
  </div>;
}

function Metric({ label, value }) { return <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</div><div className="text-[24px] font-bold text-neutral-900 mt-1">{value}</div></div>; }

function AddContactDialog({ companyId, onClose, onSaved }) {
  const [contacts,setContacts]=useState([]); const [contactId,setContactId]=useState(''); const [roles,setRoles]=useState(['talent_acquisition']); const [saving,setSaving]=useState(false); const [error,setError]=useState('');
  useEffect(() => { apiFetch('/api/wizmatch/staffing/contacts').then(d => { setContacts(d.items || []); setContactId(d.items?.[0]?.id || ''); }).catch(e => setError(e.message)); }, []);
  const save=async()=>{ setSaving(true);setError('');try{await apiFetch(`/api/wizmatch/companies/${companyId}/contacts`,{method:'POST',body:JSON.stringify({contactId,roles,sourceType:'manual'})});onSaved();}catch(e){setError(e.message);}finally{setSaving(false);}};
  return <div className="fixed inset-0 bg-black/40 z-50 grid place-items-center" onClick={onClose}><div className="bg-white rounded-lg shadow-modal w-[520px] max-w-[94vw] p-5" onClick={e=>e.stopPropagation()}><h2 className="font-bold text-[17px]">Link canonical CRM person</h2><p className="text-[12px] text-neutral-500 mt-1">The person already exists in CRM, so email and phone stay canonical and deduplicated.</p>{error&&<div className="text-danger-600 text-[12px] mt-3">{error}</div>}<label className="block text-[11px] font-semibold uppercase mt-4">Person</label><select className="input w-full mt-1" value={contactId} onChange={e=>setContactId(e.target.value)}>{contacts.map(c=><option key={c.id} value={c.id}>{[c.first_name,c.last_name].filter(Boolean).join(' ')} · {c.email || c.company_name || 'no email'}</option>)}</select><div className="mt-4"><div className="text-[11px] font-semibold uppercase mb-2">Roles</div><div className="flex flex-wrap gap-2">{ROLE_OPTIONS.map(role=><label key={role} className="text-[12px] flex gap-1"><input type="checkbox" checked={roles.includes(role)} onChange={e=>setRoles(v=>e.target.checked?[...v,role]:v.filter(x=>x!==role))}/>{role.replaceAll('_',' ')}</label>)}</div></div><div className="flex justify-end gap-2 mt-5"><button className="btn-standard" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving||!contactId||!roles.length} onClick={save}>{saving?'Linking…':'Link person'}</button></div></div></div>;
}

function Contact360({ data, onClose }) { const c=data.contact; return <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}><div className="bg-white w-[580px] max-w-[96vw] h-full overflow-auto p-6" onClick={e=>e.stopPropagation()}><button className="float-right text-neutral-500" onClick={onClose}>Close</button><h2 className="text-[20px] font-bold">{[c.first_name,c.last_name].filter(Boolean).join(' ')}</h2><p className="text-neutral-500">{c.company_name} · {(c.roles||[]).join(', ')}</p><div className="card p-4 my-4"><div>{c.email||'No email'}</div><div>{c.phone||'No phone'}</div></div><h3 className="font-bold mb-2">Requirement history</h3>{!data.requirements.length?<div className="text-neutral-400">No attributed requirements.</div>:data.requirements.map(r=><div key={`${r.id}-${r.contact_role}`} className="card p-3 mb-2"><div className="font-semibold">{r.title}</div><div className="text-[12px] text-neutral-500">{r.contact_role} · {r.is_primary_source?'primary source':'supporting'} · {r.stage}</div></div>)}<h3 className="font-bold mt-5 mb-2">Activity</h3>{data.events.map(e=><div key={e.id} className="border-l-2 border-primary-200 pl-3 py-2 text-[12px]"><div className="font-semibold">{e.event_type.replaceAll('_',' ')}</div><div className="text-neutral-500">{new Date(e.occurred_at).toLocaleString()}</div></div>)}</div></div>; }
