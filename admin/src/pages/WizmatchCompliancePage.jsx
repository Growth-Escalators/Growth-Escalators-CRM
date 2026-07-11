import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const REASON_OPTIONS = ['unsubscribe', 'hard_bounce', 'complaint', 'do_not_contact', 'manual'];
const BLANK_FORM = { email: '', reason: 'manual', source_channel: 'email', notes: '' };

function AddSuppressionForm({ onAdded }) {
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/wizmatch/suppression', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          reason: form.reason,
          source_channel: form.source_channel,
          notes: form.notes || undefined,
        }),
      });
      setForm(BLANK_FORM);
      onAdded();
    } catch (err) {
      setError(err.message || 'Failed to add suppression entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 mb-4 space-y-3">
      <h2 className="text-[13px] font-semibold text-neutral-800 flex items-center gap-1.5">
        <Plus className="h-3.5 w-3.5 text-primary-600" />
        Add suppression entry
      </h2>
      {error && <p className="badge-danger">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <input
          type="email"
          required
          placeholder="Email address *"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          className="input sm:col-span-2"
        />
        <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="input">
          {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <input
          type="text"
          placeholder="Source channel"
          value={form.source_channel}
          onChange={e => setForm({ ...form, source_channel: e.target.value })}
          className="input"
        />
      </div>
      <input
        type="text"
        placeholder="Notes (optional)"
        value={form.notes}
        onChange={e => setForm({ ...form, notes: e.target.value })}
        className="input"
      />
      <button type="submit" disabled={saving} className="btn-primary btn-compact disabled:opacity-50">
        {saving ? 'Adding...' : 'Add to suppression list'}
      </button>
    </form>
  );
}

export default function WizmatchCompliancePage() {
  const [suppressions, setSuppressions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (filters.reason) params.set('reason', filters.reason);
      const data = await apiFetch(`/api/wizmatch/suppression?${params}`);
      setSuppressions(data.items || []);
      setTotal(data.total || 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-6">Compliance Log</h1>
      <AddSuppressionForm onAdded={load} />
      <div className="mb-4 flex gap-3 items-center">
        <select value={filters.reason} onChange={e => setFilters({ reason: e.target.value })} className="input w-auto">
          <option value="">All Reasons</option>
          <option value="unsubscribe">Unsubscribe</option>
          <option value="hard_bounce">Hard Bounce</option>
          <option value="complaint">Complaint</option>
          <option value="do_not_contact">Do Not Contact</option>
          <option value="manual">Manual</option>
        </select>
        <span className="text-[12.5px] text-neutral-500">{total} suppressed emails</span>
      </div>
      <div className="card overflow-hidden">
        <table className="table-fluent">
          <thead>
            <tr>
              <th>Email</th>
              <th>Reason</th>
              <th>Channel</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan="4" className="px-4 py-8 text-center text-neutral-400">Loading...</td></tr>
            : suppressions.map(s => (
              <tr key={s.id}>
                <td className="font-medium text-neutral-900">{s.email}</td>
                <td><span className="badge-danger">{s.reason}</span></td>
                <td className="text-neutral-500">{s.source_channel}</td>
                <td className="text-neutral-500">{s.suppressed_at ? new Date(s.suppressed_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
