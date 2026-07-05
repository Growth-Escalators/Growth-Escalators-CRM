import { useState, useEffect, useCallback } from 'react';
import { FileText, Upload, Sparkles, X, Download } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const STATUS_BADGE = {
  draft: 'badge-muted',
  sheet_ready: 'badge-info',
  shared: 'badge-success',
  closed: 'badge-muted',
};
const REGION_BADGE = { india: 'badge-warning', us: 'badge-info' };

function fmtBudget(r) {
  if (r.budget_min == null && r.budget_max == null) return '—';
  const sym = r.budget_currency === 'INR' ? '₹' : r.budget_currency === 'USD' ? '$' : `${r.budget_currency} `;
  const per = r.budget_period === 'hourly' ? '/hr' : r.budget_period === 'annual' ? '/yr' : '/mo';
  const range = r.budget_min != null && r.budget_max != null
    ? `${sym}${Number(r.budget_min).toLocaleString()}–${sym}${Number(r.budget_max).toLocaleString()}`
    : `${sym}${Number(r.budget_max ?? r.budget_min).toLocaleString()}`;
  return `${range}${per}`;
}

// Multipart parse — apiFetch forces JSON content-type, so use a raw fetch here.
async function parseRequirementApi({ text, file }) {
  const fd = new FormData();
  if (text) fd.append('text', text);
  if (file) fd.append('file', file);
  const res = await fetch('/api/wizmatch/requirements/parse', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('ge_crm_token')}` },
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Parse failed (${res.status})`);
  return data;
}

export default function WizmatchRequirementsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/wizmatch/requirements?limit=100');
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generateSheet = async (id) => {
    try {
      const { sheet_url } = await apiFetch(`/api/wizmatch/requirements/${id}/sheet`, { method: 'POST' });
      if (sheet_url) window.open(sheet_url, '_blank');
      load();
    } catch (e) { alert('Sheet generation failed: ' + e.message); }
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

      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Location</th>
              <th className="text-center">Positions</th>
              <th className="text-right">Budget</th>
              <th>Region</th>
              <th>Status</th>
              <th className="text-right">Sheet</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="7" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            : items.length === 0 ? <tr><td colSpan="7" className="px-4 py-8 text-center text-neutral-400">No requirements yet — create one from a client JD.</td></tr>
            : items.map(r => (
              <tr key={r.id}>
                <td>
                  <div className="font-medium text-neutral-900">{r.title}</div>
                  {r.required_skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">{r.required_skills.slice(0, 4).map((s, i) => <span key={i} className="badge-info text-[10px]">{s}</span>)}</div>
                  )}
                </td>
                <td>{r.location || '—'}{r.work_mode ? ` · ${r.work_mode}` : ''}</td>
                <td className="text-center">{r.positions || 1}</td>
                <td className="text-right font-mono text-neutral-900">{fmtBudget(r)}</td>
                <td><span className={REGION_BADGE[r.region] || 'badge-muted'}>{r.region || '—'}</span></td>
                <td><span className={STATUS_BADGE[r.status] || 'badge-muted'}>{r.status?.replace(/_/g, ' ')}</span></td>
                <td className="text-right">
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
    </div>
  );
}

const EMPTY = {
  title: '', region: 'india', location: '', work_mode: 'onsite', employment_type: 'contract',
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
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const runParse = async () => {
    if (mode === 'paste' && !jdText.trim()) { alert('Paste the JD text first'); return; }
    if (mode === 'upload' && !file) { alert('Choose a file first'); return; }
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
    } catch (e) { alert('Parse failed: ' + e.message); } finally { setParsing(false); }
  };

  const save = async () => {
    if (!form.title.trim()) { alert('Title is required'); return; }
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
    } catch (e) { alert('Save failed: ' + e.message); } finally { setSaving(false); }
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
              <button onClick={() => setMode('paste')} className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md border ${mode === 'paste' ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}>Paste JD</button>
              <button onClick={() => setMode('upload')} className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md border ${mode === 'upload' ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-neutral-200 text-neutral-500'}`}>Upload file</button>
            </div>
            {mode === 'paste' ? (
              <textarea value={jdText} onChange={e => setJdText(e.target.value)} rows={5} placeholder="Paste the client's job requirement here…" className="input w-full resize-y" />
            ) : (
              <label className="flex items-center gap-2 border border-dashed border-neutral-300 rounded-md px-3 py-4 cursor-pointer hover:bg-neutral-50">
                <Upload className="w-4 h-4 text-neutral-400" />
                <span className="text-[12.5px] text-neutral-600">{file ? file.name : 'Choose a PDF or image of the JD'}</span>
                <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
            )}
            <button onClick={runParse} disabled={parsing} className="btn-standard btn-compact mt-2">
              <Sparkles className="w-3.5 h-3.5" /> {parsing ? 'Parsing…' : 'Parse with AI'}
            </button>
          </div>

          <div className="border-t border-neutral-100 pt-4 space-y-3">
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

        <div className="sticky bottom-0 bg-white border-t border-neutral-100 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-standard">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save & Generate Sheet'}
          </button>
        </div>
      </div>
    </div>
  );
}
