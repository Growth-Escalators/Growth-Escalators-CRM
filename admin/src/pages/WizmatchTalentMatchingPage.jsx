import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldCheck, UserCheck, ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import FilterBar from '../components/wizmatch/filters/FilterBar.jsx';
import { useTableControls } from '../components/wizmatch/filters/useTableControls.js';
import { exportRowsToCsv } from '../components/wizmatch/filters/exportCsv.js';

// Card-grid review queue: keeps the explainable match cards (blockers, missing
// evidence, decide + RTR flow) but adds the shared filter toolbar. Client-side
// over the loaded matches; default sort score-desc (module-level for stable
// identity so the hook doesn't refetch/rerender in a loop).
const TM_FILTERS = [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Candidate or requirement…', fields: ['first_name', 'last_name', 'requirement_title'] },
  { key: 'requirement', label: 'Requirement', type: 'search', placeholder: 'Requirement…', fields: ['requirement_title'] },
  { key: 'decision', label: 'Decision', type: 'multiselect', accessor: (r) => r.human_decision || 'pending', options: ['shortlisted', 'watch', 'rejected', 'pending'].map((v) => ({ value: v, label: v })) },
  { key: 'score', label: 'Score', type: 'numberRange', accessor: (r) => r.score },
  { key: 'hide_blocked', label: 'Hide blocked', type: 'toggle', predicate: (r) => (r.blockers || []).length === 0 },
];
const TM_DEFAULTS = { sort: { key: 'score', dir: 'desc' } };
const TM_EXPORT_COLUMNS = [
  { key: 'candidate', label: 'Candidate', exportValue: (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') },
  { key: 'requirement_title', label: 'Requirement' },
  { key: 'score', label: 'Score' },
  { key: 'human_decision', label: 'Decision', exportValue: (r) => r.human_decision || 'pending' },
  { key: 'blockers', label: 'Blockers', exportValue: (r) => (r.blockers || []).join('; ') },
  { key: 'missing_evidence', label: 'Missing evidence', exportValue: (r) => (r.missing_evidence || []).join('; ') },
];

export default function WizmatchTalentMatchingPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [consentFiles, setConsentFiles] = useState({});
  const ctl = useTableControls({ pageId: 'wizmatch-talent-matching', spec: TM_FILTERS, columns: undefined, defaults: TM_DEFAULTS });
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
  async function prepare(item) {
    if (!confirm('Confirm that current requirement-specific consent/RTR has been received and record a submission draft? Nothing will be sent.')) return;
    setBusy(item.id); setError('');
    try {
      let documentReference = null;
      if (consentFiles[item.id]) {
        const form = new FormData(); form.append('file', consentFiles[item.id]);
        documentReference = (await apiFetch('/api/wizmatch/staffing/consent-documents', { method: 'POST', body: form })).reference;
      }
      const consent = await apiFetch('/api/wizmatch/staffing/consents', { method: 'POST', body: JSON.stringify({ candidateId: item.candidate_id, requirementId: item.requirement_id, status: 'granted', consentType: 'rtr', documentReference, expiresAt: new Date(Date.now() + 30*86400000).toISOString(), terms: { recordedManually: true, evidence: documentReference ? 'private_document' : 'manual_confirmation' } }) });
      await apiFetch('/api/wizmatch/staffing/submissions', { method: 'POST', body: JSON.stringify({ candidateId: item.candidate_id, requirementId: item.requirement_id, matchId: item.id, consentId: consent.id, payload: { preparedFrom: 'talent_matching' } }) });
      await load();
    } catch (e) { setError(e.message || 'Consent/submission draft could not be recorded.'); }
    finally { setBusy(''); }
  }
  const filtered = ctl.applyClient(items);
  const blockedCount = items.filter(i => (i.blockers || []).length > 0).length;

  return <div className="p-6 space-y-5">
    <div><h1 className="text-[20px] font-bold text-neutral-900">Talent Matching</h1><p className="text-[12.5px] text-neutral-500 mt-1">Explainable, requirement-specific matches, ranked by score. Decisions never submit or contact a candidate. Filters and sort are shareable via the URL.</p></div>
    <div className="rounded-md border border-info-200 bg-info-50 p-3 text-[12.5px] text-info-800 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0"/> SAP ABAP/FICO and Java/JavaScript stay separate unless a requirement explicitly allows a broad-family rule.</div>
    <FilterBar
      spec={TM_FILTERS}
      filters={ctl.filters}
      setFilter={ctl.setFilter}
      activeChips={ctl.activeChips}
      clearFilter={ctl.clearFilter}
      clearAll={ctl.clearAll}
      onExport={() => exportRowsToCsv(filtered, TM_EXPORT_COLUMNS, 'talent-matches.csv')}
      presets={ctl.presets}
      savePreset={ctl.savePreset}
      applyPreset={ctl.applyPreset}
      deletePreset={ctl.deletePreset}
      rightSlot={<button className="btn-standard btn-compact" onClick={load}><RefreshCw className="w-3.5 h-3.5"/> Refresh</button>}
    />
    {error && <div role="alert" className="border border-danger-200 bg-danger-50 text-danger-700 rounded-md p-3">{error} <button className="underline font-semibold ml-2" onClick={load}>Retry</button></div>}
    {loading ? <div className="card p-8 text-center text-neutral-400">Loading recruiter decisions…</div>
      : items.length === 0 ? <div className="card p-8 text-center"><p className="text-neutral-500 font-medium">No candidate matches need your review yet.</p><p className="text-[12.5px] text-neutral-400 mt-1 mb-3">This queue fills from a requirement's "Recalculate matches". Open a requirement and recalculate to populate it.</p><button onClick={() => navigate('/wizmatch/requirements')} className="btn-primary btn-compact inline-flex items-center gap-1">Go to Requirements <ArrowRight className="w-3.5 h-3.5"/></button></div>
      : <div className="grid lg:grid-cols-2 gap-3">
      {filtered.length === 0 ? <div className="card p-8 text-center lg:col-span-2 text-neutral-500">No matches match these filters{blockedCount ? ' — try clearing “Hide blocked”.' : '.'}</div> : filtered.map(item => <article className="card p-4" key={item.id}>
        <div className="flex justify-between gap-3"><div><div className="font-semibold text-neutral-900">{[item.first_name,item.last_name].filter(Boolean).join(' ')}</div><div className="text-[12px] text-neutral-500">{item.requirement_title}</div></div><div className="text-right"><div className="text-xl font-bold text-primary-700">{item.score}</div><div className="text-[10px] text-neutral-400">{item.score_version}</div></div></div>
        <div className="mt-3 flex flex-wrap gap-1">{(item.blockers || []).map(value => <span className="badge-danger" key={value}>{String(value).replaceAll('_',' ')}</span>)}{!(item.blockers || []).length && <span className="badge-success">No hard blockers</span>}</div>
        <div className="text-[11.5px] text-neutral-500 mt-2">Missing evidence: {(item.missing_evidence || []).join(', ') || 'none recorded'}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><button disabled={busy===item.id} className="btn-standard btn-compact" onClick={()=>decide(item.id,'shortlisted')}><UserCheck className="w-3.5 h-3.5"/> Shortlist</button><button disabled={busy===item.id} className="btn-standard btn-compact" onClick={()=>decide(item.id,'watch')}>Watch</button><button disabled={busy===item.id} className="btn-standard btn-compact text-danger-700" onClick={()=>decide(item.id,'rejected')}>Reject</button>{item.human_decision==='shortlisted' && <><label className="text-[11px] text-neutral-500">RTR document (optional)<input aria-label={`RTR document for ${item.first_name || 'candidate'}`} className="ml-2 text-[11px]" type="file" accept=".pdf,.doc,.docx" onChange={event=>setConsentFiles(current=>({...current,[item.id]:event.target.files?.[0]||null}))}/></label><button disabled={busy===item.id} className="btn-standard btn-compact" onClick={()=>prepare(item)}>Record consent + draft</button></>}</div>
      </article>)}
    </div>}
  </div>;
}
