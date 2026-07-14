import { useState, useEffect, useCallback } from 'react';
import { FileText, Upload, Sparkles, X, Download, Users } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const STATUS_BADGE = {
  draft: 'badge-muted',
  sheet_ready: 'badge-info',
  shared: 'badge-success',
  closed: 'badge-muted',
};
const REGION_BADGE = { india: 'badge-warning', us: 'badge-info' };
const TIER_BADGE = { A: 'badge-success', B: 'badge-warning', C: 'badge-muted', Reject: 'badge-danger' };
const MATCH_PRIORITY_BADGE = { hot: 'badge-success', warm: 'badge-info', watch: 'badge-warning', blocked: 'badge-danger' };

const EMPTY_FILTERS = {
  company: '', skill: '', min_experience: '', location: '',
  work_mode: '', region: '', employment_type: '', priority: '', status: '',
};

function fmtBudget(r) {
  if (r.budget_min == null && r.budget_max == null) return '—';
  const sym = r.budget_currency === 'INR' ? '₹' : r.budget_currency === 'USD' ? '$' : `${r.budget_currency} `;
  const per = r.budget_period === 'hourly' ? '/hr' : r.budget_period === 'annual' ? '/yr' : '/mo';
  const range = r.budget_min != null && r.budget_max != null
    ? `${sym}${Number(r.budget_min).toLocaleString()}–${sym}${Number(r.budget_max).toLocaleString()}`
    : `${sym}${Number(r.budget_max ?? r.budget_min).toLocaleString()}`;
  return `${range}${per}`;
}

async function parseRequirementApi({ text, file }) {
  const fd = new FormData();
  if (text) fd.append('text', text);
  if (file) fd.append('file', file);
  return apiFetch('/api/wizmatch/requirements/parse', {
    method: 'POST',
    body: fd,
  });
}

export default function WizmatchRequirementsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [selected, setSelected] = useState(null);
  const [matchesFor, setMatchesFor] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [actionError, setActionError] = useState('');
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, v); });
      const data = await apiFetch(`/api/wizmatch/requirements?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const generateSheet = async (id) => {
    setActionError('');
    try {
      const { sheet_url } = await apiFetch(`/api/wizmatch/requirements/${id}/sheet`, { method: 'POST' });
      if (sheet_url) window.open(sheet_url, '_blank');
      load();
    } catch (e) { setActionError('Sheet generation failed: ' + (e.message || '')); }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">Requirements</h1>
          <span className="text-[12.5px] font-semibold text-primary-700 bg-primary-500/10 border border-primary-500/20 px-2.5 py-0.5 rounded-full">
            {total} requirements
          </span>
        </div>
        <button onClick={() => setShowDrawer(true)} className="btn-primary">
          <FileText className="w-4 h-4" /> New Requirement
        </button>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-5">
        Turn a client JD (paste or upload) into a branded requirement sheet to share with sub-vendors.
      </p>

      {actionError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[12.5px] text-danger-600">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="font-semibold underline">Dismiss</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2.5">
        <input placeholder="Company…" value={filters.company} onChange={e => setFilter('company', e.target.value)} className="input w-[150px]" />
        <input placeholder="Skill…" value={filters.skill} onChange={e => setFilter('skill', e.target.value)} className="input w-[130px]" />
        <input type="number" placeholder="Min exp (yrs)" value={filters.min_experience} onChange={e => setFilter('min_experience', e.target.value)} className="input w-[130px]" />
        <input placeholder="Location…" value={filters.location} onChange={e => setFilter('location', e.target.value)} className="input w-[130px]" />
        <select value={filters.work_mode} onChange={e => setFilter('work_mode', e.target.value)} className="input w-auto">
          <option value="">Any Work Mode</option>
          <option value="onsite">Onsite</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option>
        </select>
        <select value={filters.region} onChange={e => setFilter('region', e.target.value)} className="input w-auto">
          <option value="">Any Region</option>
          <option value="india">India</option><option value="us">US</option>
        </select>
        <select value={filters.employment_type} onChange={e => setFilter('employment_type', e.target.value)} className="input w-auto">
          <option value="">Any Employment</option>
          <option value="contract">Contract</option><option value="contract_c2c">Contract — C2C</option>
          <option value="contract_w2">Contract — W2</option><option value="permanent">Permanent</option>
        </select>
        <select value={filters.priority} onChange={e => setFilter('priority', e.target.value)} className="input w-auto">
          <option value="">Any Priority</option>
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <select value={filters.status} onChange={e => setFilter('status', e.target.value)} className="input w-auto">
          <option value="">Any Status</option>
          <option value="draft">Draft</option><option value="sheet_ready">Sheet Ready</option>
          <option value="shared">Shared</option><option value="closed">Closed</option>
        </select>
        {Object.values(filters).some(Boolean) && (
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-[12.5px] text-neutral-400 hover:text-neutral-600">Clear filters</button>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Client</th>
              <th>Source person</th>
              <th>Assigned team</th>
              <th>Location</th>
              <th className="text-center">Positions</th>
              <th className="text-right">Budget</th>
              <th>Region</th>
              <th>Status</th>
              <th className="text-right">Sheet</th>
              <th className="text-right">Candidates</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="11" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            : items.length === 0 ? <tr><td colSpan="11" className="px-4 py-8 text-center text-neutral-400">No requirements match these filters.</td></tr>
            : items.map(r => (
              <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer hover:bg-neutral-50">
                <td>
                  <div className="font-medium text-neutral-900">{r.title}</div>
                  {r.required_skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">{r.required_skills.slice(0, 4).map((s, i) => <span key={i} className="badge-info text-[10px]">{s}</span>)}</div>
                  )}
                </td>
                <td>
                  <div className="font-medium text-neutral-900">{r.company_name || '—'}</div>
                  <span className={`${TIER_BADGE[r.company_tier] || 'badge-muted'} text-[10px] mt-1 inline-flex`}>
                    {r.company_tier ? `Tier ${r.company_tier}` : '—'}
                  </span>
                </td>
                <td><div className="font-medium">{r.primary_source_name || <span className="text-warning-700">Needs attribution</span>}</div><div className="text-[11px] text-neutral-500">{r.primary_source_email || ''}</div></td>
                <td>{(r.assignments || []).length ? (r.assignments || []).map(a => <div key={a.id} className="text-[11.5px]"><span className="font-medium">{a.name}</span> · {a.role.replace(/_/g, ' ')}</div>) : <span className="text-warning-700">Unassigned</span>}</td>
                <td>{r.location || '—'}{r.work_mode ? ` · ${r.work_mode}` : ''}</td>
                <td className="text-center">{r.positions || 1}</td>
                <td className="text-right font-mono text-neutral-900">{fmtBudget(r)}</td>
                <td><span className={REGION_BADGE[r.region] || 'badge-muted'}>{r.region || '—'}</span></td>
                <td><span className="badge-info">{(r.stage || 'draft').replace(/_/g, ' ')}</span><div className="mt-1"><span className={STATUS_BADGE[r.status] || 'badge-muted'}>{r.status?.replace(/_/g, ' ')}</span></div></td>
                <td className="text-right" onClick={e => e.stopPropagation()}>
                  {r.sheet_url ? (
                    <div className="flex gap-2 justify-end">
                      <a href={r.sheet_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-semibold text-primary-700 inline-flex items-center gap-1">
                        <Download className="w-3.5 h-3.5" /> PDF
                      </a>
                      <button onClick={() => generateSheet(r.id)} className="text-[12.5px] text-neutral-400 hover:text-neutral-600">Regenerate</button>
                    </div>
                  ) : (
                    <button onClick={() => generateSheet(r.id)} className="btn-standard btn-compact">Generate</button>
                  )}
                </td>
                <td className="text-right" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setMatchesFor(r)} className="btn-standard btn-compact">
                    <Users className="w-3.5 h-3.5" /> Find
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showDrawer && (
        <RequirementDrawer
          onClose={() => setShowDrawer(false)}
          onSaved={(created) => { setShowDrawer(false); load(); if (created?.id) generateSheet(created.id); }}
        />
      )}

      {selected && (
        <RequirementDetailDrawer
          requirement={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load(); }}
          onFindCandidates={() => setMatchesFor(selected)}
        />
      )}

      {matchesFor && (
        <CandidateMatchesModal requirement={matchesFor} onClose={() => setMatchesFor(null)} />
      )}
    </div>
  );
}

const EMPTY = {
  company_id: '', title: '', region: 'india', location: '', work_mode: 'onsite', employment_type: 'contract',
  min_experience: '', max_experience: '', budget_min: '', budget_max: '', budget_currency: 'INR',
  budget_period: 'monthly', positions: 1, priority: 'normal', mask_client: true,
  required_skills: '', nice_to_have_skills: '', vendor_notes: '', raw_jd: '', source_file_url: null,
};

function RequirementDrawer({ onClose, onSaved }) {
  const [mode, setMode] = useState('paste'); // paste | upload
  const [jdText, setJdText] = useState('');
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parseFeedback, setParseFeedback] = useState(null);
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [companies, setCompanies] = useState([]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    apiFetch('/api/wizmatch/staffing/companies').then(data => {
      const options = data.items || [];
      setCompanies(options);
      setForm(f => ({ ...f, company_id: f.company_id || options[0]?.id || '' }));
    }).catch(() => setCompanies([]));
  }, []);

  const runParse = async () => {
    setParseFeedback(null);
    if (mode === 'paste' && !jdText.trim()) {
      setParseFeedback({ kind: 'validation', message: 'Paste the JD text first.' });
      return;
    }
    if (mode === 'upload' && !file) {
      setParseFeedback({ kind: 'validation', message: 'Choose a file first.' });
      return;
    }
    setParsing(true);
    try {
      const { parsed, source_file_url } = await parseRequirementApi({
        text: mode === 'paste' ? jdText : undefined,
        file: mode === 'upload' ? file : undefined,
      });
      setForm(f => ({
        ...f,
        title: parsed.title || f.title,
        region: parsed.region || f.region,
        location: parsed.location || f.location,
        work_mode: parsed.work_mode || f.work_mode,
        employment_type: parsed.employment_type || f.employment_type,
        min_experience: parsed.min_experience ?? f.min_experience,
        max_experience: parsed.max_experience ?? f.max_experience,
        budget_min: parsed.budget_min ?? f.budget_min,
        budget_max: parsed.budget_max ?? f.budget_max,
        budget_currency: parsed.budget_currency || f.budget_currency,
        budget_period: parsed.budget_period || f.budget_period,
        positions: parsed.positions ?? f.positions,
        required_skills: (parsed.required_skills || []).join(', ') || f.required_skills,
        nice_to_have_skills: (parsed.nice_to_have_skills || []).join(', ') || f.nice_to_have_skills,
        raw_jd: mode === 'paste' ? jdText : f.raw_jd,
        source_file_url: source_file_url || f.source_file_url,
      }));
    } catch (e) {
      setParseFeedback({ kind: 'error', message: e.message || 'The requirement could not be parsed.' });
    } finally { setParsing(false); }
  };

  const save = async () => {
    setSaveFeedback(null);
    if (!form.title.trim()) { setSaveFeedback('Title is required.'); return; }
    if (!form.company_id) { setSaveFeedback('Company is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        required_skills: form.required_skills.split(',').map(s => s.trim()).filter(Boolean),
        nice_to_have_skills: form.nice_to_have_skills.split(',').map(s => s.trim()).filter(Boolean),
        min_experience: form.min_experience === '' ? null : Number(form.min_experience),
        max_experience: form.max_experience === '' ? null : Number(form.max_experience),
        budget_min: form.budget_min === '' ? null : Number(form.budget_min),
        budget_max: form.budget_max === '' ? null : Number(form.budget_max),
        positions: Number(form.positions) || 1,
      };
      const created = await apiFetch('/api/wizmatch/requirements', { method: 'POST', body: JSON.stringify(payload) });
      onSaved(created);
    } catch (e) { setSaveFeedback(e.message || 'Save failed.'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[560px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="text-[18px] font-bold text-neutral-900">New Requirement</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Intake */}
          <div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => { setMode('paste'); setParseFeedback(null); }} className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md border ${mode === 'paste' ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}>Paste JD</button>
              <button onClick={() => { setMode('upload'); setParseFeedback(null); }} className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md border ${mode === 'upload' ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}>Upload file</button>
            </div>
            {mode === 'paste' ? (
              <textarea value={jdText} onChange={e => { setJdText(e.target.value); setParseFeedback(null); }} rows={5} placeholder="Paste the client's job requirement here…" className="input w-full resize-y" />
            ) : (
              <label className="flex items-center gap-2 border border-dashed border-neutral-300 rounded-md px-3 py-4 cursor-pointer hover:bg-neutral-50">
                <Upload className="w-4 h-4 text-neutral-400" />
                <span className="text-[12.5px] text-neutral-600">{file ? file.name : 'Choose a PDF or image of the JD'}</span>
                <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => { setFile(e.target.files?.[0] || null); setParseFeedback(null); }} />
              </label>
            )}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button onClick={runParse} disabled={parsing} className="btn-standard btn-compact">
                <Sparkles className="w-3.5 h-3.5" /> {parsing ? 'Parsing…' : 'Parse with AI'}
              </button>
              {parseFeedback && (
                <div
                  role={parseFeedback.kind === 'error' ? 'alert' : 'status'}
                  className={`text-[12.5px] rounded-md px-2.5 py-1 flex items-center gap-2 border ${
                    parseFeedback.kind === 'error'
                      ? 'text-danger-600 bg-danger-500/10 border-danger-500/30'
                      : 'text-warning-700 bg-warning-500/10 border-warning-500/30'
                  }`}
                >
                  <span>{parseFeedback.kind === 'error' ? 'Parse failed: ' : ''}{parseFeedback.message}</span>
                  {parseFeedback.kind === 'error' && (
                    <button
                      type="button"
                      onClick={runParse}
                      disabled={parsing}
                      className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-500 underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-neutral-100 pt-4 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Company *</label>
              <select value={form.company_id} onChange={e => set('company_id', e.target.value)} className="input w-full mt-1">
                <option value="">Select the company that supplied this role</option>
                {companies.map(company => <option value={company.id} key={company.id}>{company.name}</option>)}
              </select>
              {!companies.length && <p className="text-[11.5px] text-warning-700 mt-1">No company is available. Add or qualify the company before creating its requirement.</p>}
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} className="input w-full mt-1" placeholder="e.g. Senior Java Developer" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Region</label>
                <select value={form.region} onChange={e => set('region', e.target.value)} className="input w-full mt-1">
                  <option value="india">India</option><option value="us">US</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Location</label>
                <input value={form.location} onChange={e => set('location', e.target.value)} className="input w-full mt-1" placeholder="Bangalore" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Work Mode</label>
                <select value={form.work_mode} onChange={e => set('work_mode', e.target.value)} className="input w-full mt-1">
                  <option value="onsite">Onsite</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Employment</label>
                <select value={form.employment_type} onChange={e => set('employment_type', e.target.value)} className="input w-full mt-1">
                  <option value="contract">Contract</option><option value="contract_c2c">Contract — C2C</option>
                  <option value="contract_w2">Contract — W2</option><option value="permanent">Permanent</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Min Exp (yrs)</label>
                <input type="number" value={form.min_experience} onChange={e => set('min_experience', e.target.value)} className="input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Max Exp (yrs)</label>
                <input type="number" value={form.max_experience} onChange={e => set('max_experience', e.target.value)} className="input w-full mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-1">
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Currency</label>
                <select value={form.budget_currency} onChange={e => set('budget_currency', e.target.value)} className="input w-full mt-1">
                  <option value="INR">INR</option><option value="USD">USD</option>
                </select>
              </div>
              <div><label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Budget Min</label><input type="number" value={form.budget_min} onChange={e => set('budget_min', e.target.value)} className="input w-full mt-1" /></div>
              <div><label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Budget Max</label><input type="number" value={form.budget_max} onChange={e => set('budget_max', e.target.value)} className="input w-full mt-1" /></div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Per</label>
                <select value={form.budget_period} onChange={e => set('budget_period', e.target.value)} className="input w-full mt-1">
                  <option value="monthly">Month</option><option value="hourly">Hour</option><option value="annual">Year</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Positions</label><input type="number" value={form.positions} onChange={e => set('positions', e.target.value)} className="input w-full mt-1" /></div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Priority</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)} className="input w-full mt-1">
                  <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Must-have Skills (comma-sep)</label>
              <input value={form.required_skills} onChange={e => set('required_skills', e.target.value)} className="input w-full mt-1" placeholder="Java, Spring Boot, AWS" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Nice-to-have Skills (comma-sep)</label>
              <input value={form.nice_to_have_skills} onChange={e => set('nice_to_have_skills', e.target.value)} className="input w-full mt-1" placeholder="Kafka, Kubernetes" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Notes for Vendors</label>
              <textarea value={form.vendor_notes} onChange={e => set('vendor_notes', e.target.value)} rows={2} className="input w-full mt-1 resize-y" />
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
              <input type="checkbox" checked={form.mask_client} onChange={e => set('mask_client', e.target.checked)} />
              Mask end-client name on the vendor sheet
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neutral-100 px-6 py-3">
          {saveFeedback && (
            <div role="alert" className="mb-2 text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {saveFeedback}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-standard">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & Generate Sheet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_OPTIONS = ['draft', 'sheet_ready', 'shared', 'closed'];

function toDetailFormState(r) {
  return {
    title: r.title || '',
    region: r.region || 'india',
    location: r.location || '',
    work_mode: r.work_mode || 'onsite',
    employment_type: r.employment_type || 'contract',
    min_experience: r.min_experience ?? '',
    max_experience: r.max_experience ?? '',
    budget_min: r.budget_min ?? '',
    budget_max: r.budget_max ?? '',
    budget_currency: r.budget_currency || 'INR',
    budget_period: r.budget_period || 'monthly',
    positions: r.positions ?? 1,
    priority: r.priority || 'normal',
    mask_client: r.mask_client !== false,
    required_skills: (r.required_skills || []).join(', '),
    nice_to_have_skills: (r.nice_to_have_skills || []).join(', '),
    vendor_notes: r.vendor_notes || '',
    raw_jd: r.raw_jd || '',
    status: r.status || 'draft',
  };
}

// Detail/edit drawer for an existing requirement — modeled on RequirementDrawer above,
// but preloaded from the row and saved via PUT /requirements/:id (existing allowlisted route).
function RequirementDetailDrawer({ requirement, onClose, onSaved, onFindCandidates }) {
  const [form, setForm] = useState(() => toDetailFormState(requirement));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const buildPayload = (overrides = {}) => ({
    ...form,
    ...overrides,
    required_skills: form.required_skills.split(',').map(s => s.trim()).filter(Boolean),
    nice_to_have_skills: form.nice_to_have_skills.split(',').map(s => s.trim()).filter(Boolean),
    min_experience: form.min_experience === '' ? null : Number(form.min_experience),
    max_experience: form.max_experience === '' ? null : Number(form.max_experience),
    budget_min: form.budget_min === '' ? null : Number(form.budget_min),
    budget_max: form.budget_max === '' ? null : Number(form.budget_max),
    positions: Number(form.positions) || 1,
  });

  const save = async () => {
    setFeedback(null);
    if (!form.title.trim()) { setFeedback({ kind: 'error', message: 'Title is required.' }); return; }
    setSaving(true);
    try {
      await apiFetch(`/api/wizmatch/requirements/${requirement.id}`, { method: 'PUT', body: JSON.stringify(buildPayload()) });
      onSaved();
    } catch (e) { setFeedback({ kind: 'error', message: e.message || 'Save failed.' }); } finally { setSaving(false); }
  };

  const closeRequirement = async () => {
    setFeedback(null);
    setSaving(true);
    try {
      await apiFetch(`/api/wizmatch/requirements/${requirement.id}`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) });
      onSaved();
    } catch (e) { setFeedback({ kind: 'error', message: e.message || 'Failed to close.' }); } finally { setSaving(false); setConfirmingClose(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-[560px] max-w-[95vw] h-full overflow-y-auto shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900 truncate">{requirement.title}</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {requirement.company_name || 'No client on file'}
              {requirement.company_tier ? ` · Tier ${requirement.company_tier}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          <RequirementOperations requirement={requirement} />
          {feedback && (
            <div role={feedback.kind === 'error' ? 'alert' : 'status'} className="text-[12.5px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">
              {feedback.message}
            </div>
          )}
          <div className="flex justify-between items-center">
            <button onClick={onFindCandidates} className="btn-standard btn-compact">
              <Users className="w-3.5 h-3.5" /> Find candidates
            </button>
            {form.status !== 'closed' && (
              confirmingClose ? (
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="text-neutral-500">Stop showing this in open pipelines?</span>
                  <button onClick={closeRequirement} disabled={saving} className="font-semibold text-danger-600 hover:text-danger-700">
                    {saving ? 'Closing…' : 'Confirm close'}
                  </button>
                  <button onClick={() => setConfirmingClose(false)} disabled={saving} className="font-semibold text-neutral-500 hover:text-neutral-700">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmingClose(true)} disabled={saving} className="text-[12.5px] font-semibold text-danger-600 hover:text-danger-700">
                  Close requirement
                </button>
              )
            )}
          </div>

          <div className="border-t border-neutral-100 pt-4 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} className="input w-full mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="input w-full mt-1">
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Region</label>
                <select value={form.region} onChange={e => set('region', e.target.value)} className="input w-full mt-1">
                  <option value="india">India</option><option value="us">US</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Location</label>
                <input value={form.location} onChange={e => set('location', e.target.value)} className="input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Work Mode</label>
                <select value={form.work_mode} onChange={e => set('work_mode', e.target.value)} className="input w-full mt-1">
                  <option value="onsite">Onsite</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Employment</label>
                <select value={form.employment_type} onChange={e => set('employment_type', e.target.value)} className="input w-full mt-1">
                  <option value="contract">Contract</option><option value="contract_c2c">Contract — C2C</option>
                  <option value="contract_w2">Contract — W2</option><option value="permanent">Permanent</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Priority</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)} className="input w-full mt-1">
                  <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Min Exp (yrs)</label>
                <input type="number" value={form.min_experience} onChange={e => set('min_experience', e.target.value)} className="input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Max Exp (yrs)</label>
                <input type="number" value={form.max_experience} onChange={e => set('max_experience', e.target.value)} className="input w-full mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-1">
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Currency</label>
                <select value={form.budget_currency} onChange={e => set('budget_currency', e.target.value)} className="input w-full mt-1">
                  <option value="INR">INR</option><option value="USD">USD</option>
                </select>
              </div>
              <div><label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Budget Min</label><input type="number" value={form.budget_min} onChange={e => set('budget_min', e.target.value)} className="input w-full mt-1" /></div>
              <div><label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Budget Max</label><input type="number" value={form.budget_max} onChange={e => set('budget_max', e.target.value)} className="input w-full mt-1" /></div>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Per</label>
                <select value={form.budget_period} onChange={e => set('budget_period', e.target.value)} className="input w-full mt-1">
                  <option value="monthly">Month</option><option value="hourly">Hour</option><option value="annual">Year</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Positions</label><input type="number" value={form.positions} onChange={e => set('positions', e.target.value)} className="input w-full mt-1" /></div>
              <label className="flex items-center gap-2 text-[12.5px] text-neutral-600 self-end pb-2.5">
                <input type="checkbox" checked={form.mask_client} onChange={e => set('mask_client', e.target.checked)} />
                Mask end-client name
              </label>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Must-have Skills (comma-sep)</label>
              <input value={form.required_skills} onChange={e => set('required_skills', e.target.value)} className="input w-full mt-1" placeholder="Java, Spring Boot, AWS" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Nice-to-have Skills (comma-sep)</label>
              <input value={form.nice_to_have_skills} onChange={e => set('nice_to_have_skills', e.target.value)} className="input w-full mt-1" placeholder="Kafka, Kubernetes" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Notes for Vendors</label>
              <textarea value={form.vendor_notes} onChange={e => set('vendor_notes', e.target.value)} rows={2} className="input w-full mt-1 resize-y" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Raw JD</label>
              <textarea value={form.raw_jd} onChange={e => set('raw_jd', e.target.value)} rows={8} className="input w-full mt-1 resize-y font-mono text-[12px]" />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-neutral-100 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-standard">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const OPERATING_STAGES = ['draft','qualifying','accepted','sourcing','covered','submitted','interviewing','offer','filled','on_hold','closed_lost','cancelled'];

function RequirementOperations({ requirement }) {
  const [data,setData]=useState(null); const [companyContacts,setCompanyContacts]=useState([]); const [users,setUsers]=useState([]);
  const [sourceId,setSourceId]=useState(''); const [assignmentRole,setAssignmentRole]=useState('recruiter'); const [userId,setUserId]=useState('');
  const [nextAction,setNextAction]=useState(''); const [dueAt,setDueAt]=useState(''); const [slaAt,setSlaAt]=useState(''); const [targetStage,setTargetStage]=useState(requirement.stage || 'draft');
  const [busy,setBusy]=useState(false); const [feedback,setFeedback]=useState(''); const [closureReason,setClosureReason]=useState('');
  const load=useCallback(async()=>{try{const [detail,contacts,team]=await Promise.all([apiFetch(`/api/wizmatch/staffing/requirements/${requirement.id}`),apiFetch(`/api/wizmatch/companies/${requirement.company_id}/contacts`),apiFetch('/api/wizmatch/staffing/users')]);setData(detail);setCompanyContacts(contacts.items||[]);setUsers(team.items||[]);setSourceId(v=>v||contacts.items?.[0]?.id||'');setUserId(v=>v||team.items?.[0]?.id||'');setTargetStage(detail.requirement.stage||'draft');}catch(e){setFeedback(e.message);}},[requirement.id,requirement.company_id]);
  useEffect(()=>{load();},[load]);
  const run=async(action,success)=>{setBusy(true);setFeedback('');try{await action();setFeedback(success);await load();}catch(e){setFeedback(e.message);}finally{setBusy(false);}};
  if(!data) return <div className="card p-4 text-[12px] text-neutral-500">Loading staffing ownership… {feedback}</div>;
  return <section className="card p-4 border-primary-200 bg-primary-50/30 space-y-4">
    <div><h3 className="font-bold text-neutral-900">Requirement 360</h3><p className="text-[11.5px] text-neutral-500">Source person, owners, SLA, next action and stage are audited independently from the legacy sheet status.</p></div>
    {feedback&&<div role="status" className="text-[12px] bg-white border rounded p-2">{feedback}</div>}
    <div><div className="text-[11px] uppercase font-semibold text-neutral-500 mb-1">Source contact</div>{data.contacts.filter(c=>c.active).map(c=><div key={c.id} className="text-[12px] mb-1"><span className="font-semibold">{[c.first_name,c.last_name].filter(Boolean).join(' ')}</span> · {c.role}{c.is_primary_source?' · primary source':''}</div>)}
      <div className="flex gap-2 mt-2"><select className="input flex-1" value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Select linked hiring contact</option>{companyContacts.filter(c=>c.relationship_stage==='active').map(c=><option key={c.id} value={c.id}>{[c.first_name,c.last_name].filter(Boolean).join(' ')} · {(c.roles||[]).join(', ')}</option>)}</select><button className="btn-standard btn-compact" disabled={busy||!sourceId} onClick={()=>run(()=>apiFetch(`/api/wizmatch/requirements/${requirement.id}/contacts`,{method:'POST',body:JSON.stringify({companyContactId:sourceId,role:'source',isPrimarySource:true,receivedChannel:'manual'})}),'Source person attributed')}>Set primary</button></div>
      {!companyContacts.length&&<div className="text-warning-700 text-[11.5px] mt-1">Link a hiring contact to this company from Companies & Contacts first.</div>}
    </div>
    <div><div className="text-[11px] uppercase font-semibold text-neutral-500 mb-1">Assigned team</div>{data.assignments.filter(a=>a.active).map(a=><div key={a.id} className="text-[12px] mb-1 flex justify-between"><span><b>{a.name}</b> · {a.role.replaceAll('_',' ')}</span><button className="text-danger-600" disabled={busy} onClick={()=>run(()=>apiFetch(`/api/wizmatch/requirements/${requirement.id}/assignments/${a.id}`,{method:'DELETE'}),'Assignment removed')}>Remove</button></div>)}<div className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-2"><select className="input" value={userId} onChange={e=>setUserId(e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select><select className="input" value={assignmentRole} onChange={e=>setAssignmentRole(e.target.value)}><option value="account_owner">Account owner</option><option value="delivery_owner">Delivery owner</option><option value="recruiter">Recruiter</option></select><button className="btn-standard btn-compact" disabled={busy||!userId} onClick={()=>run(()=>apiFetch(`/api/wizmatch/requirements/${requirement.id}/assignments`,{method:'POST',body:JSON.stringify({userId,role:assignmentRole})}),'Team member assigned')}>Assign</button></div></div>
    <div><div className="text-[11px] uppercase font-semibold text-neutral-500 mb-1">Dated next action and SLA</div><input className="input w-full mb-2" placeholder="Example: Call Priya for Java shortlist feedback" value={nextAction} onChange={e=>setNextAction(e.target.value)}/><div className="grid grid-cols-2 gap-2"><label className="text-[11px]">Next action due<input type="datetime-local" className="input w-full mt-1" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label><label className="text-[11px]">Requirement SLA due<input type="datetime-local" className="input w-full mt-1" value={slaAt} onChange={e=>setSlaAt(e.target.value)}/></label></div><button className="btn-standard btn-compact mt-2" disabled={busy||!nextAction.trim()||!dueAt} onClick={()=>run(()=>apiFetch(`/api/wizmatch/requirements/${requirement.id}/next-action`,{method:'POST',body:JSON.stringify({nextAction,nextActionDueAt:new Date(dueAt).toISOString(),slaDueAt:slaAt?new Date(slaAt).toISOString():undefined})}),'Next action and linked task created')}>Save next action</button></div>
    <div><div className="text-[11px] uppercase font-semibold text-neutral-500 mb-1">Operating stage</div><div className="flex gap-2"><select className="input flex-1" value={targetStage} onChange={e=>{setTargetStage(e.target.value);setClosureReason('');}}>{OPERATING_STAGES.map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select><button className="btn-primary btn-compact" disabled={busy||targetStage===data.requirement.stage||(['closed_lost','cancelled'].includes(targetStage)&&!closureReason.trim())} onClick={()=>run(()=>apiFetch(`/api/wizmatch/requirements/${requirement.id}/transition`,{method:'POST',body:JSON.stringify({stage:targetStage,closureReason:['closed_lost','cancelled'].includes(targetStage)?closureReason.trim():undefined})}),'Stage updated')}>Move stage</button></div>{['closed_lost','cancelled'].includes(targetStage)&&<input className="input w-full mt-2" placeholder="Closure reason (required)" value={closureReason} onChange={e=>setClosureReason(e.target.value)}/>}<p className="text-[11px] text-neutral-500 mt-1">Acceptance is blocked until primary source, account owner, recruiter, SLA and dated next action are all present.</p></div>
    <div><div className="text-[11px] uppercase font-semibold text-neutral-500 mb-1">Requirement-first candidate sourcing</div><button className="btn-standard btn-compact" disabled={busy||!['accepted','sourcing','covered'].includes(data.requirement.stage)} onClick={()=>run(()=>apiFetch(`/api/wizmatch/requirements/${requirement.id}/source-candidates-xray`,{method:'POST'}),'X-Ray candidate leads created for evidence review')}>Source public candidate leads</button><p className="text-[11px] text-neutral-500 mt-1">One capped search per requirement every seven days. Results remain unverified until recruiter evidence review.</p></div>
    <div><div className="text-[11px] uppercase font-semibold text-neutral-500 mb-1">Recent timeline</div>{data.events.slice(0,5).map(e=><div key={e.id} className="text-[11.5px] border-l-2 border-primary-200 pl-2 py-1"><b>{e.event_type.replaceAll('_',' ')}</b> · {new Date(e.occurred_at).toLocaleString()}</div>)}</div>
  </section>;
}

// The candidate-intelligence matches endpoint returns CandidateIntelligenceResult rows
// (id, name, score, priority, topRequirementMatches[]) rather than a flat
// { candidateId, matchedSkills, missingSkills } shape — read both defensively so this
// keeps working if the endpoint's shape is ever flattened.
function extractMatchDetails(m, requirementId) {
  const requirementMatches = m.topRequirementMatches || [];
  const scoped = requirementMatches.find(x => x.requirementId === requirementId) || requirementMatches[0] || {};
  const reasons = (m.reasons && m.reasons.length ? m.reasons : scoped.reasons) || [];
  return {
    candidateId: m.candidateId || m.id,
    name: m.name || 'Unknown candidate',
    score: m.score ?? 0,
    priority: m.priority || 'watch',
    matchedSkills: m.matchedSkills || scoped.matchedSkills || [],
    missingSkills: m.missingSkills || scoped.missingSkills || [],
    reasons: reasons.slice(0, 3),
  };
}

// Read-only ranked candidate list for one requirement. No submission or outreach action here.
function CandidateMatchesModal({ requirement, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiFetch(`/api/wizmatch/candidate-intelligence/requirements/${requirement.id}/matches`);
        if (!cancelled) setMatches((data.matches || []).map(m => extractMatchDetails(m, requirement.id)));
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load candidate matches');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requirement.id]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-[640px] max-w-[95vw] max-h-[85vh] overflow-y-auto rounded-xl shadow-modal" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-6 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-neutral-900">Candidate matches</h2>
            <p className="text-[12px] text-neutral-500 mt-0.5 truncate">{requirement.title} · read-only ranking, no outreach or submission</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-3">
          {loading ? (
            <p className="text-center text-neutral-400 py-8">Loading candidate matches...</p>
          ) : error ? (
            <p className="text-center text-danger-600 py-8">{error}</p>
          ) : matches.length === 0 ? (
            <p className="text-center text-neutral-400 py-8">No candidate matches found yet.</p>
          ) : matches.map(m => (
            <div key={m.candidateId} className="rounded-lg border border-neutral-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-neutral-900 text-sm">{m.name}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={MATCH_PRIORITY_BADGE[m.priority] || 'badge-muted'}>{m.priority}</span>
                  <span className="inline-flex items-center justify-center min-w-9 h-8 rounded-md bg-neutral-900 text-white text-[13px] font-bold">{m.score}</span>
                </div>
              </div>
              {(m.matchedSkills.length > 0 || m.missingSkills.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.matchedSkills.slice(0, 6).map(s => <span key={`match-${s}`} className="badge-success text-[10px]">{s}</span>)}
                  {m.missingSkills.slice(0, 5).map(s => <span key={`miss-${s}`} className="badge-muted text-[10px]">missing {s}</span>)}
                </div>
              )}
              {m.reasons.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.reasons.map((reason, i) => (
                    <p key={i} className="text-[12px] text-neutral-500">{reason}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
