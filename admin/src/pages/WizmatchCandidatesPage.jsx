import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Search, Download } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { Modal, Button } from '../components/ui/index.js';

const VISA_BADGE = { H1B: 'badge-info', GC: 'badge-success', USC: 'badge-info', OPT: 'badge-warning' };
const AVAIL_BADGE = { available: 'badge-success', submitted: 'badge-info', interviewing: 'badge-warning', placed: 'badge-success', benched: 'badge-muted' };
const PIVOT_TABS = [
  { label: 'All', value: '' },
  { label: 'Available', value: 'available' },
  { label: 'Interviewing', value: 'interviewing' },
  { label: 'Placed', value: 'placed' },
  { label: 'Benched', value: 'benched' },
];

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
              onClick={() => setFilters((f) => ({ ...f, availability_status: tab.value }))}
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
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input placeholder="Search skill…" value={filters.skill} onChange={e => setFilters({...filters, skill: e.target.value})} className="input pl-8 w-full" />
        </div>
        <select value={filters.visa_status} onChange={e => setFilters({...filters, visa_status: e.target.value})} className="input w-auto">
          <option value="">Any Visa</option>
          <option>H1B</option><option>GC</option><option>USC</option><option>OPT</option><option>unknown</option>
        </select>
        <select value={filters.availability_status} onChange={e => setFilters({...filters, availability_status: e.target.value})} className="input w-auto">
          <option value="">Any Availability</option>
          <option>available</option><option>submitted</option><option>interviewing</option><option>placed</option><option>benched</option>
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
              <th className="text-right">Rate</th>
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
                <td className="text-right font-mono text-neutral-900">{c.rate_hourly ? `${c.rate_currency === 'INR' ? '₹' : '$'}${c.rate_hourly}/hr` : '—'}</td>
                <td><span className={AVAIL_BADGE[c.availability_status] || 'badge-muted'}>{c.availability_status}</span></td>
                <td className="text-neutral-500 text-[12.5px]">{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200 bg-neutral-50">
          <p className="text-[12.5px] text-neutral-500">Showing 1–{candidates.length} of {total} candidates</p>
          <div className="flex gap-2">
            <button disabled className="text-[12.5px] font-semibold px-3.5 py-1.5 border border-neutral-200 rounded-md bg-neutral-100 text-neutral-400 opacity-60">← Prev</button>
            <button className="text-[12.5px] font-semibold px-3.5 py-1.5 border border-neutral-200 rounded-md bg-neutral-100 text-neutral-700">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddCandidateForm({ onClose, onDone }) {
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
        <input type="number" placeholder="Rate/hr" value={form.rate_hourly} onChange={e => setForm({...form, rate_hourly: e.target.value})} className="input col-span-2" />
      </form>
    </Modal>
  );
}
