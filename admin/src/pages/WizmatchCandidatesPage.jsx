import { useState, useEffect, useCallback } from 'react';
import { UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const VISA_BADGE = { H1B: 'badge-info', GC: 'badge-success', USC: 'badge-info', OPT: 'badge-warning' };
const AVAIL_BADGE = { available: 'badge-success', submitted: 'badge-info', interviewing: 'badge-warning', placed: 'badge-success', benched: 'badge-muted' };

export default function WizmatchCandidatesPage() {
  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ skill: '', visa_status: '', availability_status: '', source: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
      const data = await apiFetch(`/api/wizmatch/candidates?${params}`);
      setCandidates(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Candidate Pool</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">{total} candidates</p>
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} className="btn-primary">
          <UserPlus className="w-4 h-4" /> Add Candidate
        </button>
      </div>

      {showAddForm && (
        <AddCandidateForm onDone={() => { setShowAddForm(false); load(); }} />
      )}

      <div className="mb-4 flex gap-3 flex-wrap">
        <input placeholder="Skill..." value={filters.skill} onChange={e => setFilters({...filters, skill: e.target.value})} className="input w-32" />
        <select value={filters.visa_status} onChange={e => setFilters({...filters, visa_status: e.target.value})} className="input w-auto">
          <option value="">Any Visa</option>
          <option>H1B</option><option>GC</option><option>USC</option><option>OPT</option><option>unknown</option>
        </select>
        <select value={filters.availability_status} onChange={e => setFilters({...filters, availability_status: e.target.value})} className="input w-auto">
          <option value="">Any Availability</option>
          <option>available</option><option>submitted</option><option>placed</option><option>benched</option>
        </select>
        <select value={filters.source} onChange={e => setFilters({...filters, source: e.target.value})} className="input w-auto">
          <option value="">Any Source</option>
          <option>xray</option><option>github</option><option>naukri</option><option>manual</option><option>referral</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Name</th>
              <th>Skills</th>
              <th>Location</th>
              <th>Visa</th>
              <th>Rate</th>
              <th>Avail.</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="7" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            : candidates.map(c => (
              <tr key={c.id}>
                <td className="font-medium text-neutral-900">{c.first_name} {c.last_name}</td>
                <td>
                  <div className="flex flex-wrap gap-1">{c.skills?.slice(0, 4).map((s, i) => <span key={i} className="badge-info text-[10px]">{s}</span>)}</div>
                </td>
                <td>{c.location || '—'}</td>
                <td><span className={VISA_BADGE[c.visa_status] || 'badge-muted'}>{c.visa_status || '—'}</span></td>
                <td>{c.rate_hourly ? `$${c.rate_hourly}/${c.rate_currency}` : '—'}</td>
                <td><span className={AVAIL_BADGE[c.availability_status] || 'badge-muted'}>{c.availability_status}</span></td>
                <td className="text-neutral-500">{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddCandidateForm({ onDone }) {
  const [form, setForm] = useState({ name: '', email: '', skills: '', location: '', visa_status: 'unknown', rate_hourly: '', source: 'manual' });
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
        }),
      });
      onDone();
    } catch (e) { alert('Failed: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="mb-4 card p-4 grid grid-cols-3 gap-3">
      <input required placeholder="Full Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input" />
      <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input" />
      <input required placeholder="Skills (comma-sep)" value={form.skills} onChange={e => setForm({...form, skills: e.target.value})} className="input" />
      <input placeholder="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className="input" />
      <select value={form.visa_status} onChange={e => setForm({...form, visa_status: e.target.value})} className="input">
        <option>unknown</option><option>H1B</option><option>GC</option><option>USC</option><option>OPT</option>
      </select>
      <input type="number" placeholder="Rate/hr" value={form.rate_hourly} onChange={e => setForm({...form, rate_hourly: e.target.value})} className="input" />
      <button disabled={saving} className="col-span-3 btn-primary">{saving ? 'Saving...' : 'Add Candidate'}</button>
    </form>
  );
}