import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, RefreshCw, Search, ShieldCheck, Upload, UserCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { Button, Drawer, Modal } from '../components/ui/index.js';
import {
  EntityTabs,
  StatePanel,
  WorkspaceHeader,
  candidateName,
  formatDate,
} from './wizmatch-ui/TalentDeliveryPrimitives.jsx';
import { classifyCandidate } from './wizmatch-ui/talentDeliveryWorkflow.js';

const VIEWS = [
  { value: 'leads', label: 'New sourcing leads' },
  { value: 'evidence', label: 'Evidence review' },
  { value: 'verified', label: 'Verified & match-ready' },
  { value: 'matching', label: 'Match decisions' },
  { value: 'archived', label: 'Unavailable / archived' },
];

function statusCopy(view) {
  if (view === 'leads') return 'Public sourcing results awaiting human validation. A lead is not yet a verified candidate.';
  if (view === 'evidence') return 'Review skills, recency, availability and evidence before this candidate can enter canonical matching.';
  if (view === 'verified') return 'Candidates with reviewed evidence who can be considered for requirement-specific matching.';
  if (view === 'matching') return 'Explainable, requirement-specific matches. A shortlist never creates consent or a submission.';
  return 'Unavailable, placed or archived records retained as history.';
}

export default function WizmatchCandidatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view = VIEWS.some((item) => item.value === requestedView) ? requestedView : 'leads';
  const selectedId = searchParams.get('candidateId');
  const [candidates, setCandidates] = useState([]);
  const [matches, setMatches] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showIntake, setShowIntake] = useState(false);
  const [showSkillEditor, setShowSkillEditor] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setActionMessage('');
    try {
      if (view === 'matching') {
        const result = await apiFetch('/api/wizmatch/staffing/recruiter-work');
        setMatches(result.items || []);
        setCandidates([]);
        setTotal((result.items || []).length);
      } else {
        const pool = await apiFetch('/api/wizmatch/candidates?limit=200&offset=0');
        setCandidates(pool.items || []);
        setMatches([]);
        setTotal(Number(pool.total || 0));
      }
    } catch (err) {
      setCandidates([]);
      setMatches([]);
      setTotal(0);
      setError(err.message || 'Candidates could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  const verifiedIds = useMemo(
    () => new Set(candidates.filter((item) => item.has_verified_skill === true).map((item) => String(item.id))),
    [candidates],
  );

  const counts = useMemo(() => {
    const result = { leads: 0, evidence: 0, verified: 0, archived: 0, matching: matches.length };
    candidates.forEach((candidate) => { result[classifyCandidate(candidate, verifiedIds)] += 1; });
    return result;
  }, [candidates, matches.length, verifiedIds]);

  const visibleCandidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (classifyCandidate(candidate, verifiedIds) !== view) return false;
      if (!term) return true;
      return [candidateName(candidate), candidate.location, candidate.source, ...(candidate.skills || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [candidates, search, verifiedIds, view]);

  const visibleMatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return matches;
    return matches.filter((item) => [candidateName(item), item.requirement_title]
      .filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [matches, search]);

  const changeView = (nextView) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', nextView);
      next.delete('candidateId');
      return next;
    });
    setDetail(null);
    setDetailError('');
  };

  const selectCandidate = (candidateId) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('candidateId', candidateId);
      return next;
    });
  };

  const loadCandidate = useCallback(async (candidateId) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await apiFetch(`/api/wizmatch/staffing/candidates/${candidateId}`));
    } catch (err) {
      setDetail(null);
      setDetailError(err.message || 'Candidate details could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadCandidate(selectedId);
  }, [loadCandidate, selectedId]);

  const closeCandidate = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('candidateId');
      return next;
    });
    setDetail(null);
    setDetailError('');
  };

  const decide = async (match, decision) => {
    setBusy(match.id);
    setError('');
    setActionMessage('');
    try {
      await apiFetch(`/api/wizmatch/staffing/matches/${match.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await load();
      setActionMessage(`${candidateName(match)} was marked ${decision}. No consent or submission was created.`);
    } catch (err) {
      setError(err.message || 'The match decision could not be saved.');
    } finally {
      setBusy('');
    }
  };

  const tabs = VIEWS.map((item) => ({ ...item, count: counts[item.value] }));
  const displayedCount = view === 'matching' ? visibleMatches.length : visibleCandidates.length;

  return (
    <div className="min-h-full bg-neutral-50">
      <WorkspaceHeader
        eyebrow="Talent"
        title="Candidates"
        description="One workspace for sourcing leads, evidence review, verified talent and requirement-specific match decisions."
        actions={(
          <>
            <button type="button" className="btn-standard" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
            <button type="button" className="btn-standard" onClick={() => setShowIntake(true)}><Upload className="h-3.5 w-3.5" /> Import vetted CSV</button>
            <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add candidate</button>
          </>
        )}
      />

      <EntityTabs items={tabs} value={view} onChange={changeView} label="Candidate work views" />

      <main className="space-y-4 p-4 sm:p-6">
        {view === 'leads' && (
          <div className="flex flex-col gap-3 rounded-xl border border-info-200 bg-info-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-[12.5px] font-semibold text-info-900">Candidate sourcing starts from a real requirement</p><p className="mt-0.5 text-[11.5px] text-info-800">Open an accepted, skill-reviewed role and run X-Ray there. Results return here as unverified leads.</p></div>
            <Link className="btn-standard shrink-0" to="/wizmatch/roles">Open Roles / Requirements <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        )}
        <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-neutral-900">{VIEWS.find((item) => item.value === view)?.label}</p>
            <p className="mt-0.5 text-[12.5px] text-neutral-500">{statusCopy(view)}</p>
          </div>
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search candidates</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input className="input w-full pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, skill or location" />
          </label>
        </div>

        {total > 200 && view !== 'matching' && (
          <p className="text-[11.5px] text-neutral-500">Showing the first 200 of {total} records. Use search and evidence states to narrow the working set.</p>
        )}
        {actionMessage && <div role="status" className="rounded-lg border border-success-200 bg-success-50 p-3 text-[12.5px] text-success-800">{actionMessage}</div>}
        {error && <StatePanel state="error" title="Candidate workspace unavailable" description={error} onRetry={load} compact />}
        {!error && loading && <StatePanel state="loading" title="Loading candidates" description="Fetching the latest evidence and match decisions." />}
        {!error && !loading && displayedCount === 0 && (
          <StatePanel
            title={search ? 'No candidates match this search' : `No candidates in ${VIEWS.find((item) => item.value === view)?.label.toLowerCase()}`}
            description={search ? 'Clear the search or choose another view.' : statusCopy(view)}
          />
        )}

        {!error && !loading && view !== 'matching' && visibleCandidates.length > 0 && (
          <div className="grid gap-3 xl:grid-cols-2">
            {visibleCandidates.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                onClick={() => selectCandidate(candidate.id)}
                className="card card-hover p-4 text-left focus:outline-none focus:ring-2 focus:ring-primary-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{candidateName(candidate)}</p>
                    <p className="mt-0.5 truncate text-[12px] text-neutral-500">{candidate.location || 'Location not reviewed'} · {candidate.source || 'unknown source'}</p>
                  </div>
                  <span className="badge-info shrink-0">{String(candidate.availability_status || 'unknown').replaceAll('_', ' ')}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(candidate.skills || []).slice(0, 5).map((skill) => <span key={skill} className="badge-muted">{skill}</span>)}
                  {!(candidate.skills || []).length && <span className="badge-warning">Evidence not reviewed</span>}
                </div>
                <div className="mt-4 flex items-center justify-between text-[11.5px] text-neutral-500">
                  <span>{candidate.experience_years ? `${candidate.experience_years} years` : 'Experience not reviewed'}</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-primary-700">Open 360 <ArrowRight className="h-3.5 w-3.5" /></span>
                </div>
              </button>
            ))}
          </div>
        )}

        {!error && !loading && view === 'matching' && visibleMatches.length > 0 && (
          <div className="grid gap-3 xl:grid-cols-2">
            {visibleMatches.map((match) => (
              <article key={match.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button type="button" onClick={() => selectCandidate(match.candidate_id)} className="text-left text-sm font-semibold text-neutral-900 hover:text-primary-700">{candidateName(match)}</button>
                    <p className="mt-0.5 text-[12px] text-neutral-500">{match.requirement_title}</p>
                  </div>
                  <div className="text-right"><p className="text-xl font-bold text-primary-700">{match.score}</p><p className="text-[10px] text-neutral-600">{match.score_version}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(match.blockers || []).map((blocker) => <span key={blocker} className="badge-danger">{String(blocker).replaceAll('_', ' ')}</span>)}
                  {!(match.blockers || []).length && <span className="badge-success">No hard blockers</span>}
                  <span className="badge-muted">Current: {String(match.human_decision || 'unreviewed').replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-3 text-[11.5px] text-neutral-500">Missing evidence: {(match.missing_evidence || []).join(', ') || 'none recorded'}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button disabled={busy === match.id} type="button" className="btn-primary btn-compact" onClick={() => decide(match, 'shortlisted')}><UserCheck className="h-3.5 w-3.5" /> Shortlist</button>
                  <button disabled={busy === match.id} type="button" className="btn-standard btn-compact" onClick={() => decide(match, 'watch')}>Watch</button>
                  <button disabled={busy === match.id} type="button" className="btn-standard btn-compact text-danger-700" onClick={() => decide(match, 'rejected')}>Reject</button>
                  {match.human_decision === 'shortlisted' && <Link className="btn-standard btn-compact" to={`/wizmatch/submissions?matchId=${encodeURIComponent(match.id)}&action=consent`}>Continue in Submissions</Link>}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {(selectedId || detailLoading || detailError) && (
        <Drawer open onClose={closeCandidate} title={candidateName(detail?.candidate)} subtitle="Candidate 360" wide>
            <div className="space-y-5">
              {detailLoading && <StatePanel state="loading" title="Loading candidate 360" />}
              {detailError && <StatePanel state="error" title="Candidate details unavailable" description={detailError} onRetry={() => loadCandidate(selectedId)} />}
              {detail && !detailLoading && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Detail label="Availability" value={detail.candidate?.availability_status} />
                    <Detail label="Location" value={detail.candidate?.location} />
                    <Detail label="Experience" value={detail.candidate?.experience_years ? `${detail.candidate.experience_years} years` : null} />
                  </div>
                  <section className="card p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-neutral-900">Reviewed skill evidence</h3><button type="button" className="btn-standard btn-compact" onClick={() => setShowSkillEditor(true)}><Plus className="h-3.5 w-3.5" /> Add evidence</button></div><div className="mt-3 space-y-2">{!(detail.skills || []).length ? <p className="text-[12.5px] text-neutral-500">No canonical skill evidence has been reviewed yet.</p> : detail.skills.map((skill) => <div key={skill.id || skill.skill_id} className="flex flex-col gap-1 rounded-lg border border-neutral-100 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[12.5px] font-semibold text-neutral-800">{skill.canonical_label}</p><p className="text-[11px] text-neutral-500">{skill.family} · {skill.specialization}{skill.evidence ? ` · ${skill.evidence}` : ''}</p></div><div className="flex gap-1"><span className={skill.verified ? 'badge-success' : 'badge-warning'}>{skill.verified ? 'Verified' : 'Needs review'}</span><span className="badge-muted">{skill.experience_years || 0} yrs</span></div></div>)}</div></section>
                  <section className="card p-4"><h3 className="text-sm font-semibold text-neutral-900">Requirement matches</h3><div className="mt-3 space-y-2">{!(detail.matches || []).length ? <p className="text-[12.5px] text-neutral-500">No requirement-specific matches yet.</p> : detail.matches.map((match) => <div key={match.id} className="rounded-lg border border-neutral-100 p-3"><div className="flex items-center justify-between gap-3"><p className="text-[12.5px] font-semibold text-neutral-800">{match.requirement_title}</p><span className="font-bold text-primary-700">{match.score}</span></div><p className="mt-1 text-[11px] text-neutral-500">{String(match.human_decision || 'unreviewed').replaceAll('_', ' ')} · recalculated {formatDate(match.recalculated_at, true)}</p></div>)}</div></section>
                  <div className="rounded-lg border border-info-200 bg-info-50 p-3 text-[12.5px] text-info-800"><ShieldCheck className="mr-2 inline h-4 w-4" />Evidence review and a shortlist do not contact or submit this candidate.</div>
                </>
              )}
            </div>
        </Drawer>
      )}

      {showAdd && <AddCandidateModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load(); }} />}
      {showIntake && <CandidateIntakeModal onClose={() => setShowIntake(false)} onImported={async () => { setShowIntake(false); await load(); setActionMessage('Vetted candidate intake completed. Imported records still require canonical evidence review.'); }} />}
      {showSkillEditor && selectedId && <SkillEvidenceModal candidateId={selectedId} onClose={() => setShowSkillEditor(false)} onDone={async () => { setShowSkillEditor(false); await Promise.all([loadCandidate(selectedId), load()]); setActionMessage('Canonical candidate evidence saved. Matching will use only reviewed evidence.'); }} />}
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="rounded-lg bg-neutral-50 p-3"><p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p><p className="mt-1 text-[12.5px] font-semibold text-neutral-800">{value || 'Not reviewed'}</p></div>;
}

function AddCandidateModal({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', email: '', skills: '', location: '', visa_status: 'unknown', experience_years: '', source: 'manual' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.name.trim() || !form.email.trim()) { setError('Name and email are required.'); return; }
    setSaving(true);
    try {
      await apiFetch('/api/wizmatch/candidates', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          email: form.email.trim(),
          skills: form.skills.split(',').map((skill) => skill.trim()).filter(Boolean),
          experience_years: form.experience_years ? Number(form.experience_years) : undefined,
        }),
      });
      onDone();
    } catch (err) {
      setError(err.message || 'Candidate could not be added.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add candidate lead"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-candidate-form" disabled={saving}>{saving ? 'Saving…' : 'Save lead'}</Button></>}
    >
      <form id="add-candidate-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        {error && <div role="alert" className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 sm:col-span-2">{error}</div>}
        <label className="sm:col-span-2"><span className="input-label">Full name</span><input className="input w-full" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="sm:col-span-2"><span className="input-label">Email</span><input className="input w-full" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="sm:col-span-2"><span className="input-label">Skills supplied by source</span><input className="input w-full" placeholder="Java, Spring, AWS" value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} /><span className="input-help">These remain unreviewed until a recruiter validates evidence.</span></label>
        <label><span className="input-label">Location</span><input className="input w-full" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
        <label><span className="input-label">Experience (years)</span><input className="input w-full" min="0" step="0.5" type="number" value={form.experience_years} onChange={(event) => setForm({ ...form, experience_years: event.target.value })} /></label>
      </form>
    </Modal>
  );
}

function CandidateIntakeModal({ onClose, onImported }) {
  const [rawText, setRawText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');

  const run = async (dryRun) => {
    if (!rawText.trim()) { setResult({ error: 'Paste CSV text with a header row first.' }); return; }
    setBusy(dryRun ? 'preview' : 'import');
    setResult(null);
    try {
      const response = await apiFetch('/api/wizmatch/candidate-intelligence/intake', {
        method: 'POST',
        body: JSON.stringify({ rawText, dryRun, confirmImport: !dryRun }),
      });
      setResult(response);
      if (!dryRun) await onImported();
    } catch (err) {
      setResult({ error: err.message || 'Candidate intake failed.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Import vetted candidate profiles"
      width={760}
      footer={<><Button onClick={onClose}>Cancel</Button><Button onClick={() => run(true)} disabled={Boolean(busy)}>{busy === 'preview' ? 'Previewing…' : 'Preview only'}</Button><Button variant="primary" onClick={() => run(false)} disabled={Boolean(busy) || !result?.dryRun}>{busy === 'import' ? 'Importing…' : 'Import reviewed rows'}</Button></>}
    >
      <div className="space-y-4">
        <p className="text-[12.5px] text-neutral-600">Paste up to 50 vetted profiles. Preview is mandatory and writes nothing. Import creates candidate records only—no outreach, shortlist or submission.</p>
        <label className="block"><span className="input-label">Candidate CSV</span><textarea className="input min-h-52 w-full font-mono text-[11px]" value={rawText} onChange={(event) => { setRawText(event.target.value); setResult(null); }} placeholder={'name,email,skills,location,experience_years,availability_status,source\nAarav Kumar,aarav@example.com,"Java; Spring",Hyderabad,6,available,manual_intake'} /></label>
        {result?.error && <div role="alert" className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700">{result.error}</div>}
        {result && !result.error && <div role="status" className="rounded-lg border border-info-200 bg-info-50 p-3 text-[12px] text-info-800"><strong>{result.dryRun ? 'Preview ready' : 'Import complete'}:</strong> {result.accepted || 0} accepted · {result.skipped || 0} skipped · {result.inserted || 0} inserted · {result.duplicates || 0} duplicates · {result.errors || 0} errors</div>}
        {result?.dryRun && (result.preview || []).length > 0 && <div className="max-h-48 overflow-auto rounded-lg border border-neutral-200"><table className="table-fluent"><thead><tr><th>Name</th><th>Skills</th><th>Score</th></tr></thead><tbody>{result.preview.slice(0, 10).map((row) => <tr key={row.row}><td className="font-medium">{row.profile?.name}</td><td>{(row.profile?.skills || []).join(', ') || '—'}</td><td>{row.score?.score ?? '—'}</td></tr>)}</tbody></table></div>}
      </div>
    </Modal>
  );
}

function SkillEvidenceModal({ candidateId, onClose, onDone }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ skillId: '', experienceYears: '', lastUsedAt: '', evidence: '', confidence: '0.9', verified: false });

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/wizmatch/staffing/skills')
      .then((result) => { if (!cancelled) setSkills(result.items || []); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Canonical skills could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.skillId) { setError('Choose a canonical skill.'); return; }
    if (!form.evidence.trim()) { setError('Record the evidence used for this skill.'); return; }
    if (!form.verified) { setError('Confirm that the evidence has been reviewed.'); return; }
    setSaving(true);
    try {
      await apiFetch(`/api/wizmatch/staffing/candidates/${candidateId}/skills`, {
        method: 'PUT',
        body: JSON.stringify({ skills: [{
          skillId: form.skillId,
          experienceYears: form.experienceYears === '' ? null : Number(form.experienceYears),
          lastUsedAt: form.lastUsedAt || null,
          evidence: form.evidence.trim(),
          confidence: Number(form.confidence),
          verified: true,
        }] }),
      });
      await onDone();
    } catch (err) {
      setError(err.message || 'Skill evidence could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add reviewed skill evidence" width={600} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="candidate-skill-form" disabled={saving || loading}>{saving ? 'Saving…' : 'Save evidence'}</Button></>}>
      <form id="candidate-skill-form" className="space-y-4" onSubmit={submit}>
        {error && <div role="alert" className="rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700">{error}</div>}
        <label className="block"><span className="input-label">Canonical skill</span><select className="input w-full" disabled={loading} value={form.skillId} onChange={(event) => setForm({ ...form, skillId: event.target.value })}><option value="">{loading ? 'Loading skills…' : 'Choose skill'}</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.canonical_label} — {skill.family} / {skill.specialization}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-2"><label><span className="input-label">Experience (years)</span><input className="input w-full" min="0" step="0.5" type="number" value={form.experienceYears} onChange={(event) => setForm({ ...form, experienceYears: event.target.value })} /></label><label><span className="input-label">Last used</span><input className="input w-full" type="date" value={form.lastUsedAt} onChange={(event) => setForm({ ...form, lastUsedAt: event.target.value })} /></label></div>
        <label className="block"><span className="input-label">Evidence</span><textarea className="input min-h-24 w-full" placeholder="Resume project, interview validation, certificate…" value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} /></label>
        <label className="block"><span className="input-label">Confidence</span><select className="input w-full" value={form.confidence} onChange={(event) => setForm({ ...form, confidence: event.target.value })}><option value="0.9">High — directly verified</option><option value="0.7">Medium — strong documented evidence</option><option value="0.5">Low — candidate-stated only</option></select></label>
        <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3"><input className="mt-1" type="checkbox" checked={form.verified} onChange={(event) => setForm({ ...form, verified: event.target.checked })} /><span><strong className="block text-[12.5px] text-neutral-800">I reviewed this evidence</strong><span className="text-[11.5px] text-neutral-500">Only reviewed evidence should contribute to canonical matching.</span></span></label>
      </form>
    </Modal>
  );
}
