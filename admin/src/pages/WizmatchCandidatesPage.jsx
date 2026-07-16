import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Search, Download, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { Modal, Button } from '../components/ui/index.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';
import MatchExplanation from '../components/wizmatch/MatchExplanation.jsx';

const VISA_BADGE = { H1B: 'badge-info', GC: 'badge-success', USC: 'badge-info', OPT: 'badge-warning' };
const AVAIL_BADGE = { available: 'badge-success', submitted: 'badge-info', interviewing: 'badge-warning', placed: 'badge-success', benched: 'badge-muted' };
const PIVOT_TABS = [
  { label: 'All', value: '' },
  { label: 'Available', value: 'available' },
  { label: 'Interviewing', value: 'interviewing' },
  { label: 'Placed', value: 'placed' },
  { label: 'Benched', value: 'benched' },
];
const PAGE_SIZE = 50;

export default function WizmatchCandidatesPage() {
  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ skill: '', visa_status: '', availability_status: '', source: '', location: '', min_experience: '' });
  const [page, setPage] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selected, setSelected] = useState(null);

  // Any filter change should jump back to page 1 — otherwise the user can be
  // left on a page past the end of the newly-filtered result set.
  const updateFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
      const data = await apiFetch(`/api/wizmatch/candidates?${params}`);
      setCandidates(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Candidate Pool</h1>
          <span className="text-[12.5px] font-semibold text-primary-700 bg-primary-500/10 border border-primary-500/20 px-2.5 py-0.5 rounded-full">
            {total} candidates
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="btn-standard">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={() => setShowAddForm(true)} className="btn-primary">
            <UserPlus className="w-4 h-4" /> Add Candidate
          </button>
        </div>
      </div>

      {/* Smart-list pivot */}
      <div className="flex items-center gap-5 mt-4 mb-4 border-b border-neutral-200">
        {PIVOT_TABS.map((tab) => {
          const active = filters.availability_status === tab.value;
          return (
            <button
              key={tab.label}
              onClick={() => updateFilter('availability_status', tab.value)}
              className={`flex items-center gap-1.5 pb-2.5 text-[13.5px] font-semibold border-b-[2.5px] -mb-px transition-colors
                ${active ? 'text-primary-700 border-primary-500' : 'text-neutral-500 border-transparent hover:text-neutral-700'}`}
            >
              {tab.label}
              {active && (
                <span className="text-[11px] font-semibold text-primary-700 bg-primary-500/10 px-1.5 py-px rounded-full">
                  {total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {showAddForm && (
        <AddCandidateForm onClose={() => setShowAddForm(false)} onDone={() => { setShowAddForm(false); load(); }} />
      )}

      <div className="mb-4 flex gap-3 flex-wrap">
        <div className="relative w-[200px]">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input placeholder="Search skill…" value={filters.skill} onChange={e => updateFilter('skill', e.target.value)} className="input pl-8 w-full" />
        </div>
        <input placeholder="Location…" value={filters.location} onChange={e => updateFilter('location', e.target.value)} className="input w-[160px]" />
        <select aria-label="Filter by visa status" value={filters.visa_status} onChange={e => updateFilter('visa_status', e.target.value)} className="input w-auto">
          <option value="">Any Visa</option>
          <option>H1B</option><option>GC</option><option>USC</option><option>OPT</option><option>unknown</option>
        </select>
        <select aria-label="Filter by availability" value={filters.availability_status} onChange={e => updateFilter('availability_status', e.target.value)} className="input w-auto">
          <option value="">Any Availability</option>
          <option>available</option><option>submitted</option><option>interviewing</option><option>placed</option><option>benched</option>
        </select>
        <select aria-label="Filter by source" value={filters.source} onChange={e => updateFilter('source', e.target.value)} className="input w-auto">
          <option value="">Any Source</option>
          <option>xray</option><option>github</option><option>naukri</option><option>manual</option><option>referral</option>
        </select>
        <input type="number" min="0" placeholder="Min experience (yrs)" value={filters.min_experience} onChange={e => updateFilter('min_experience', e.target.value)} className="input w-[170px]" />
      </div>

      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Name</th>
              <th>Skills</th>
              <th>Location</th>
              <th>Visa</th>
              <th>Experience</th>
              <th className="text-right">Rate</th>
              <th>Avail.</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="8" className="px-4 py-8 text-center text-neutral-500">Loading...</td></tr>
            : candidates.map(c => (
              <tr key={c.id} onClick={() => setSelected(c)} className="cursor-pointer hover:bg-neutral-50">
                <td className="font-medium text-neutral-900">{c.first_name} {c.last_name}</td>
                <td>
                  <div className="flex flex-wrap gap-1">{c.skills?.slice(0, 4).map((s, i) => <span key={i} className="badge-info text-[10px]">{s}</span>)}</div>
                </td>
                <td>{c.location || '—'}</td>
                <td><span className={VISA_BADGE[c.visa_status] || 'badge-muted'}>{c.visa_status || '—'}</span></td>
                <td>{c.experience_years ? `${c.experience_years} yrs` : '—'}</td>
                <td className="text-right font-mono text-neutral-900">{c.rate_hourly ? `${c.rate_currency === 'INR' ? '₹' : '$'}${c.rate_hourly}/hr` : '—'}</td>
                <td><span className={AVAIL_BADGE[c.availability_status] || 'badge-muted'}>{c.availability_status}</span></td>
                <td className="text-neutral-500 text-[12.5px]">{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200 bg-neutral-50">
          <p className="text-[12.5px] text-neutral-500">Showing {rangeStart}–{rangeEnd} of {total} candidates</p>
          <div className="flex gap-2">
            <button
              disabled={!hasPrev}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`text-[12.5px] font-semibold px-3.5 py-1.5 border border-neutral-200 rounded-md ${hasPrev ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-100 text-neutral-500 opacity-60'}`}
            >← Prev</button>
            <button
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className={`text-[12.5px] font-semibold px-3.5 py-1.5 border border-neutral-200 rounded-md ${hasNext ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-100 text-neutral-500 opacity-60'}`}
            >Next →</button>
          </div>
        </div>
      </div>

      {selected && (
        <CandidateDetailDrawer
          candidateId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function AddCandidateForm({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', email: '', skills: '', location: '', visa_status: 'unknown', experience_years: '', rate_hourly: '', source: 'manual' });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/wizmatch/candidates', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
          rate_hourly: form.rate_hourly ? Number(form.rate_hourly) : undefined,
          experience_years: form.experience_years ? Number(form.experience_years) : undefined,
        }),
      });
      onDone();
    } catch (e) { alert('Failed: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Candidate"
      footer={
        <>
          <Button variant="standard" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-candidate-form" disabled={saving}>
            {saving ? 'Saving…' : 'Add Candidate'}
          </Button>
        </>
      }
    >
      <form id="add-candidate-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <input required placeholder="Full Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input col-span-2" />
        <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input col-span-2" />
        <input required placeholder="Skills (comma-sep)" value={form.skills} onChange={e => setForm({...form, skills: e.target.value})} className="input col-span-2" />
        <input placeholder="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className="input" />
        <select value={form.visa_status} onChange={e => setForm({...form, visa_status: e.target.value})} className="input">
          <option>unknown</option><option>H1B</option><option>GC</option><option>USC</option><option>OPT</option>
        </select>
        <input type="number" placeholder="Rate/hr" value={form.rate_hourly} onChange={e => setForm({...form, rate_hourly: e.target.value})} className="input" />
        <input type="number" min="0" placeholder="Experience (yrs)" value={form.experience_years} onChange={e => setForm({...form, experience_years: e.target.value})} className="input" />
      </form>
    </Modal>
  );
}

const VISA_LABEL = { H1B: 'H1B', GC: 'Green Card', USC: 'US Citizen', OPT: 'OPT' };

function fmtRate(c) {
  if (!c?.rate_hourly) return '—';
  const sym = c.rate_currency === 'INR' ? '₹' : c.rate_currency === 'USD' ? '$' : `${c.rate_currency} `;
  const per = c.rate_period === 'monthly' ? '/mo' : c.rate_period === 'annual' ? '/yr' : '/hr';
  return `${sym}${Number(c.rate_hourly).toLocaleString()}${per}`;
}

// DELETE /candidates/:id is restricted to admin/team_lead and returns a bare
// error code (no message field) for that case — humanize it alongside the
// dependency-409 message, which the backend already writes as a full sentence.
function humanizeDeleteError(message) {
  if (message === 'delete_requires_lead') return 'Only a team lead or admin can delete candidates permanently.';
  return message;
}

// Candidate 360: combines the legacy pool record (GET /candidates/:id, always
// available) with the staffing-model view (GET /staffing/candidates/:id —
// canonical skill tags + explainable requirement matches), which 404s if
// Wizmatch staffing Gate B is disabled. Both are read defensively so the
// drawer still works with just the legacy record when Gate B is off.
function CandidateDetailDrawer({ candidateId, onClose, onChanged }) {
  const { showSuccess, showError } = useToast();
  const [detail, setDetail] = useState(null);
  const [staffing, setStaffing] = useState(null);
  const [staffingUnavailable, setStaffingUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [decidingMatchId, setDecidingMatchId] = useState(null);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [dependencyConfirmed, setDependencyConfirmed] = useState(false);

  const [showBenchDialog, setShowBenchDialog] = useState(false);
  const [benching, setBenching] = useState(false);
  const [benchError, setBenchError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const legacy = await apiFetch(`/api/wizmatch/candidates/${candidateId}`);
      setDetail(legacy);
      try {
        const staffing360 = await apiFetch(`/api/wizmatch/staffing/candidates/${candidateId}`);
        setStaffing(staffing360);
        setStaffingUnavailable(false);
      } catch {
        setStaffing(null);
        setStaffingUnavailable(true);
      }
    } catch (e) {
      setError(e.message || 'Failed to load candidate.');
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (matchId, decision) => {
    setDecidingMatchId(matchId);
    try {
      await apiFetch(`/api/wizmatch/staffing/matches/${matchId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      showSuccess(`Match marked ${decision}`);
      await load();
    } catch (e) {
      showError(e.message || 'Could not record the decision.');
    } finally {
      setDecidingMatchId(null);
    }
  };

  const deleteCandidate = async (reason) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/wizmatch/candidates/${candidateId}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      showSuccess('Candidate deleted');
      setShowDeleteDialog(false);
      onChanged();
      onClose();
    } catch (e) {
      const message = humanizeDeleteError(e.message) || 'Delete failed.';
      // The backend's dependency message always starts with "Cannot delete —"
      // (src/routes/wizmatch.ts) — detecting it lets the drawer switch to
      // offering "Mark unavailable" instead, without silently retrying here.
      if (/cannot delete/i.test(message)) setDependencyConfirmed(true);
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  };

  const benchCandidate = async () => {
    setBenching(true);
    setBenchError(null);
    try {
      await apiFetch(`/api/wizmatch/candidates/${candidateId}`, {
        method: 'PUT',
        body: JSON.stringify({ availability_status: 'benched' }),
      });
      showSuccess('Candidate marked unavailable');
      setShowBenchDialog(false);
      await load();
      onChanged();
    } catch (e) {
      setBenchError(e.message || 'Could not mark unavailable.');
    } finally {
      setBenching(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[600px] max-w-[95vw] h-full shadow-modal flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <p className="text-neutral-500">Loading candidate…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
        <div className="bg-white w-[600px] max-w-[95vw] h-full shadow-modal p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-end mb-4"><button onClick={onClose} className="text-neutral-500 hover:text-neutral-600"><X className="w-5 h-5" /></button></div>
          <ErrorRetry message={error} onRetry={load} retrying={loading} />
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const fullName = [detail.first_name, detail.last_name].filter(Boolean).join(' ') || 'Unnamed candidate';
  const matches = staffing?.matches || [];
  const canonicalSkills = staffing?.skills || [];
  const submissions = staffing?.submissions || [];
  const alreadyBenched = detail.availability_status === 'benched';
  const hasKnownDependencies = dependencyConfirmed || matches.length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[600px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900 truncate">{fullName}</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {detail.company_name || 'No current employer on file'} · {detail.source}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.availability_status} />
            {detail.visa_status && detail.visa_status !== 'unknown' && (
              <span className="badge-info text-[11px]">{VISA_LABEL[detail.visa_status] || detail.visa_status}</span>
            )}
            {detail.is_wizmatch_certified && <span className="badge-success text-[11px]">Wizmatch certified</span>}
          </div>

          <div className="text-[12.5px] text-neutral-600 space-y-1">
            <div><b className="text-neutral-900">Location:</b> {detail.location || '—'}</div>
            <div><b className="text-neutral-900">Experience:</b> {detail.experience_years != null ? `${detail.experience_years} yrs` : '—'}</div>
            <div><b className="text-neutral-900">Compensation:</b> {fmtRate(detail)}</div>
            <div><b className="text-neutral-900">Availability date:</b> {detail.availability_date ? new Date(detail.availability_date).toLocaleDateString() : '—'}</div>
            <div><b className="text-neutral-900">LinkedIn:</b> {detail.linkedin_url ? <a href={detail.linkedin_url} target="_blank" rel="noreferrer" className="text-primary-700 underline">{detail.linkedin_url}</a> : '—'}</div>
            <div><b className="text-neutral-900">GitHub:</b> {detail.github_url ? <a href={detail.github_url} target="_blank" rel="noreferrer" className="text-primary-700 underline">{detail.github_url}</a> : '—'}</div>
            <div><b className="text-neutral-900">Resume:</b> {detail.resume_url ? <a href={detail.resume_url} target="_blank" rel="noreferrer" className="text-primary-700 underline">View resume</a> : '—'}</div>
          </div>

          <section className="border-t border-neutral-100 pt-4">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Skills</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(detail.skills || []).length
                ? detail.skills.map((s, i) => <span key={i} className="badge-info text-[10px]">{s}</span>)
                : <span className="text-[11.5px] text-neutral-500">No free-text skills on file</span>}
            </div>
            {canonicalSkills.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Canonical skill tags &amp; evidence</p>
                {canonicalSkills.map(s => (
                  <div key={s.id} className="rounded-md border border-neutral-200 px-2.5 py-2 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-neutral-900">{s.canonical_label}</span>
                      <span className={s.verified ? 'badge-success text-[10px]' : 'badge-muted text-[10px]'}>{s.verified ? 'verified' : 'unverified'}</span>
                    </div>
                    <p className="text-neutral-500 mt-0.5">
                      {s.experience_years != null ? `${s.experience_years} yrs` : 'Experience unknown'}
                      {s.last_used_at ? ` · last used ${new Date(s.last_used_at).toLocaleDateString()}` : ' · no recency date on file'}
                    </p>
                    {s.evidence && <p className="text-neutral-600 mt-1 italic">"{s.evidence}"</p>}
                  </div>
                ))}
              </div>
            )}
            {staffingUnavailable && (
              <p className="text-[11.5px] text-neutral-500 mt-2">Canonical skill tagging isn't enabled in this environment (Wizmatch staffing Gate B is off).</p>
            )}
          </section>

          <section className="border-t border-neutral-100 pt-4">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Requirement matches</h3>
            {staffingUnavailable ? (
              <p className="text-[12px] text-neutral-500">Explainable matching isn't enabled in this environment (Wizmatch staffing Gate B is off).</p>
            ) : matches.length === 0 ? (
              <EmptyState
                title="No requirement matches yet"
                description="Matches appear here once the candidate is scored against a requirement from the requirement's detail view."
                variant="true-empty"
              />
            ) : (
              <div className="space-y-2">
                {matches.map(m => (
                  <MatchExplanation
                    key={m.id}
                    match={m}
                    busy={decidingMatchId === m.id}
                    onShortlist={() => decide(m.id, 'shortlisted')}
                    onWatch={() => decide(m.id, 'watch')}
                    onReject={() => decide(m.id, 'rejected')}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="border-t border-neutral-100 pt-4">
            <h3 className="text-[13px] font-bold text-neutral-900 mb-2">Submission history</h3>
            {staffingUnavailable ? (
              <p className="text-[12px] text-neutral-500">Submission history isn't available in this environment (Wizmatch staffing Gate B is off).</p>
            ) : submissions.length === 0 ? (
              <p className="text-[12px] text-neutral-500">This candidate has not been submitted to any requirement yet.</p>
            ) : (
              <div className="space-y-2">
                {submissions.map(sub => (
                  <div key={sub.id} className="rounded-lg border border-neutral-200 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-neutral-900 text-[13px] truncate">{sub.requirement_title}</p>
                      <p className="text-[11.5px] text-neutral-500 mt-0.5">
                        {sub.company_name || 'Unknown company'}
                        {sub.first_sent_at ? ` · sent ${new Date(sub.first_sent_at).toLocaleDateString()}` : ' · not yet sent'}
                        {sub.version > 1 ? ` · v${sub.version}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={sub.status} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border-t border-neutral-100 pt-4 flex items-center justify-between">
            {hasKnownDependencies ? (
              <button
                onClick={() => setShowBenchDialog(true)}
                disabled={alreadyBenched}
                className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-danger-600"
              >
                {alreadyBenched ? 'Already marked unavailable' : 'Mark unavailable'}
              </button>
            ) : (
              <button onClick={() => setShowDeleteDialog(true)} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700">
                Delete permanently
              </button>
            )}
          </section>
        </div>

        {/* Both dialogs must stay inside this stopPropagation() boundary — the
            outer backdrop's onClick={onClose} would otherwise catch bubbled
            clicks from inside ConfirmDialog (including Cancel) and close the
            whole drawer, not just the dialog. */}
        <ConfirmDialog
          open={showDeleteDialog}
          title="Delete this candidate?"
          impactSummary={`This permanently deletes "${fullName}" and cannot be undone. Only allowed if the candidate has zero requirement matches and zero submissions.`}
          confirmLabel="Delete permanently"
          danger
          requireTypedName={fullName}
          requireReason
          loading={deleting}
          error={deleteError}
          onConfirm={deleteCandidate}
          onCancel={() => { setShowDeleteDialog(false); setDeleteError(null); }}
        />
        <ConfirmDialog
          open={showBenchDialog}
          title="Mark this candidate unavailable?"
          impactSummary={`This sets "${fullName}"'s availability to benched. Their match and submission history is kept — nothing is deleted.`}
          confirmLabel="Mark unavailable"
          loading={benching}
          error={benchError}
          onConfirm={benchCandidate}
          onCancel={() => { setShowBenchDialog(false); setBenchError(null); }}
        />
      </div>
    </div>
  );
}
