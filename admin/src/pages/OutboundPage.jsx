import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import StatCard from '../components/StatCard.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Upload, RefreshCw, Filter, X, Target, AlertCircle, CheckCircle2,
  Mail, Link2, Building2, ShieldQuestion, Briefcase, TrendingUp, UserPlus,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Canonical lists — keep in sync with src/routes/outbound.ts. Hard-coded here
// rather than fetched at mount because (a) they almost never change, and
// (b) the dropdown should render synchronously on load.
// ---------------------------------------------------------------------------
const STATUSES = [
  'new', 'contacted', 'accepted', 'replied', 'meeting',
  'pilot', 'client', 'recycled', 'suppressed',
];
const ICP_SEGMENTS = ['dev_saas', 'dev_agency', 'marketing_d2c', 'marketing_agency'];

const STATUS_COLOURS = {
  new:        'bg-slate-100 text-slate-700',
  contacted:  'bg-sky-100 text-sky-700',
  accepted:   'bg-blue-100 text-blue-700',
  replied:    'bg-violet-100 text-violet-700',
  meeting:    'bg-amber-100 text-amber-700',
  pilot:      'bg-emerald-100 text-emerald-700',
  client:     'bg-green-100 text-green-700',
  recycled:   'bg-slate-100 text-slate-500',
  suppressed: 'bg-red-100 text-red-600',
};

const EMAIL_STATUS_COLOURS = {
  valid:      'bg-green-100 text-green-700',
  invalid:    'bg-red-100 text-red-600',
  risky:      'bg-amber-100 text-amber-700',
  disposable: 'bg-orange-100 text-orange-700',
  unknown:    'bg-slate-100 text-slate-500',
  unverified: 'bg-slate-100 text-slate-500',
};

function Badge({ children, kind }) {
  const map = kind === 'status' ? STATUS_COLOURS : EMAIL_STATUS_COLOURS;
  const cls = map[children] || 'bg-slate-100 text-slate-500';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{children || 'unknown'}</span>;
}

function fmt(date) {
  if (!date) return '—';
  try { return new Date(date).toLocaleString(); } catch { return String(date); }
}

// ---------------------------------------------------------------------------
// Detail drawer — sits on the right, shows prospect + signals + replies,
// lets the operator change status or log a reply.
// ---------------------------------------------------------------------------
function ProspectDrawer({ id, onClose, onMutated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyChannel, setReplyChannel] = useState('email');
  const [replySaving, setReplySaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setErr(null);
    try {
      const d = await apiFetch(`/api/outbound/prospects/${id}`);
      setData(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (next) => {
    setStatusSaving(true);
    try {
      await apiFetch(`/api/outbound/prospects/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, note: 'changed via admin UI' }),
      });
      await load();
      onMutated?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setStatusSaving(false);
    }
  };

  const logReply = async () => {
    if (!replyText.trim()) return;
    setReplySaving(true);
    try {
      await apiFetch(`/api/outbound/prospects/${id}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body: replyText.trim(), channel: replyChannel }),
      });
      setReplyText('');
      await load();
      onMutated?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setReplySaving(false);
    }
  };

  const revalidate = async () => {
    try {
      await apiFetch(`/api/outbound/prospects/${id}/validate-email`, { method: 'POST' });
      await load();
      onMutated?.();
    } catch (e) {
      setErr(e.message);
    }
  };

  const [converting, setConverting] = useState(false);
  const convertToCrm = async () => {
    if (!confirm('Create a CRM contact + deal from this prospect?')) return;
    setConverting(true);
    try {
      const r = await apiFetch(`/api/outbound/prospects/${id}/convert`, {
        method: 'POST',
        body: JSON.stringify({ note: 'manual convert via admin UI' }),
      });
      await load();
      onMutated?.();
      alert(`Created CRM contact ${r.crm_contact_id} + deal ${r.crm_deal_id}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setConverting(false);
    }
  };

  if (!id) return null;
  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white border-l border-slate-200 shadow-xl z-30 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-2">
        <p className="font-semibold text-slate-900 mr-auto">Prospect</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
      </div>

      {loading && <div className="p-6 text-sm text-slate-500">Loading…</div>}
      {err && (
        <div className="m-5 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{err}</span>
        </div>
      )}

      {!loading && data?.prospect && (
        <div className="p-5 space-y-5">
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {[data.prospect.first_name, data.prospect.last_name].filter(Boolean).join(' ') || '—'}
            </p>
            <p className="text-sm text-slate-500">{data.prospect.title || '—'} · {data.prospect.company || '—'}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge kind="status">{data.prospect.status}</Badge>
                <select
                  className="text-xs border border-slate-200 rounded px-1.5 py-0.5"
                  value=""
                  disabled={statusSaving}
                  onChange={(e) => e.target.value && updateStatus(e.target.value)}
                >
                  <option value="">change…</option>
                  {STATUSES.filter((s) => s !== data.prospect.status).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Email status</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge>{data.prospect.email_status}</Badge>
                <button onClick={revalidate} className="text-xs text-sky-600 hover:underline">re-check</button>
              </div>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
              <p className="font-mono text-xs text-slate-700 break-all">{data.prospect.email || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">LinkedIn</p>
              <p className="font-mono text-xs text-slate-700 break-all">{data.prospect.linkedin_url || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">ICP segment</p>
              <p className="text-slate-700">{data.prospect.icp_segment || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Company size</p>
              <p className="text-slate-700">{data.prospect.company_size || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">CRM link</p>
              {data.prospect.crm_contact_id ? (
                <div className="flex items-center gap-2 text-xs text-emerald-700 mt-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Linked</span>
                  <a href={`/contacts?focus=${data.prospect.crm_contact_id}`}
                     className="text-sky-600 hover:underline">contact</a>
                  {data.prospect.crm_deal_id && (
                    <>
                      <span className="text-slate-400">·</span>
                      <a href={`/pipeline?deal=${data.prospect.crm_deal_id}`}
                         className="text-sky-600 hover:underline">deal</a>
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={convertToCrm}
                  disabled={converting}
                  className="mt-1 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {converting ? 'Converting…' : 'Convert to CRM'}
                </button>
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Signals ({data.signals.length})</p>
            {data.signals.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No signals captured yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.signals.map((s) => (
                  <li key={s.id} className="text-xs">
                    <span className="font-medium text-slate-800">{s.signal_type}</span>
                    {s.signal_detail && <span className="text-slate-600"> — {s.signal_detail}</span>}
                    <span className="text-slate-400 ml-2">{fmt(s.signal_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t pt-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Replies ({data.replies.length})</p>
            {data.replies.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No replies logged.</p>
            ) : (
              <ul className="space-y-3">
                {data.replies.map((r) => (
                  <li key={r.id} className="text-sm border border-slate-100 rounded p-3 bg-slate-50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-slate-500">{r.channel || 'unknown'}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{fmt(r.received_at)}</span>
                      {r.classification && (
                        <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                          {r.classification}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Log a reply</p>
              <div className="flex gap-2">
                <select
                  value={replyChannel}
                  onChange={(e) => setReplyChannel(e.target.value)}
                  className="text-sm border border-slate-200 rounded px-2 py-1"
                >
                  <option value="email">email</option>
                  <option value="linkedin">linkedin</option>
                  <option value="phone">phone</option>
                </select>
                <button
                  onClick={logReply}
                  disabled={!replyText.trim() || replySaving}
                  className="ml-auto px-3 py-1 bg-sky-600 text-white text-sm rounded hover:bg-sky-700 disabled:opacity-50"
                >
                  {replySaving ? 'Classifying…' : 'Log + classify'}
                </button>
              </div>
              <textarea
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Paste the reply text here…"
                className="w-full border border-slate-200 rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function OutboundPage() {
  const [prospects, setProspects] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [icpFilter, setIcpFilter] = useState('');
  const [openId, setOpenId] = useState(null);
  const [stats, setStats] = useState(null);

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      if (icpFilter)    params.set('icp_segment', icpFilter);
      const [list, st] = await Promise.all([
        apiFetch(`/api/outbound/prospects?${params.toString()}`),
        apiFetch('/api/outbound/stats').catch(() => null),
      ]);
      setProspects(list.prospects || []);
      setTotal(list.total || 0);
      if (st) setStats(st);
    } catch (e) {
      setErr(e.message); setProspects([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, icpFilter]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file) => {
    if (!file) return;
    setImportBusy(true); setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // apiFetch JSON-defaults the Content-Type, so we use raw fetch here
      const token = localStorage.getItem('ge_crm_token');
      const r = await fetch('/api/outbound/prospects/import-csv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Import failed (${r.status})`);
      setImportResult(j);
      await load();
    } catch (e) {
      setImportResult({ error: e.message });
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-sky-600" />
            <div className="mr-auto">
              <h1 className="text-lg font-bold text-slate-900">Outbound</h1>
              <p className="text-xs text-slate-500">Outbound prospects, signals, and replies. <span className="text-slate-400">{total} total</span></p>
            </div>

            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <label className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-sm hover:bg-sky-700 cursor-pointer">
              <Upload className="w-4 h-4" />
              {importBusy ? 'Importing…' : 'Import CSV'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded px-2 py-1">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={icpFilter} onChange={(e) => setIcpFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded px-2 py-1">
              <option value="">All ICP segments</option>
              {ICP_SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {(statusFilter || icpFilter) && (
              <button onClick={() => { setStatusFilter(''); setIcpFilter(''); }}
                className="text-xs text-slate-500 hover:text-slate-700 underline">clear</button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4">
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="Total" value={stats.total} icon={Target} colour="sky" />
              <StatCard label="New" value={stats.by_status?.new ?? 0} icon={Filter} colour="slate" />
              <StatCard label="Contacted" value={stats.by_status?.contacted ?? 0} icon={Mail} colour="sky" />
              <StatCard label="Replied" value={stats.by_status?.replied ?? 0} icon={CheckCircle2} colour="violet" />
              <StatCard label="Converted → CRM" value={stats.converted_to_crm} icon={UserPlus} colour="emerald" />
            </div>
          )}
          {importResult && (
            <div className={`p-3 rounded-lg border text-sm ${importResult.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              {importResult.error ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{importResult.error}</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span><strong>{importResult.inserted}</strong> inserted</span>
                  <span><strong>{importResult.skipped_duplicate}</strong> duplicate</span>
                  <span><strong>{importResult.skipped_invalid}</strong> invalid</span>
                  <span><strong>{importResult.skipped_empty}</strong> empty</span>
                  <span className="text-slate-500">of {importResult.total_rows}</span>
                  <button onClick={() => setImportResult(null)} className="ml-auto text-xs text-slate-500 hover:underline">dismiss</button>
                </div>
              )}
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{err}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">Name</th>
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">Title @ Company</th>
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">ICP</th>
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">Email</th>
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">LinkedIn</th>
                    <th className="px-4 py-2 text-xs font-semibold text-slate-500">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">Loading prospects…</td></tr>
                  )}
                  {!loading && prospects.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                      No prospects match this filter. Upload a CSV to get started.
                    </td></tr>
                  )}
                  {prospects.map((p) => (
                    <tr key={p.id}
                      onClick={() => setOpenId(p.id)}
                      className="border-b border-slate-50 hover:bg-sky-50 cursor-pointer">
                      <td className="px-4 py-2.5 text-sm text-slate-900 font-medium">
                        {[p.first_name, p.last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Briefcase className="w-3 h-3 text-slate-400" />
                          {p.title || '—'}
                        </span>
                        <span className="text-slate-400 mx-1">@</span>
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {p.company || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{p.icp_segment || '—'}</td>
                      <td className="px-4 py-2.5"><Badge kind="status">{p.status}</Badge></td>
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Mail className="w-3 h-3 text-slate-400" />
                          {p.email ? p.email.split('@')[0] + '@…' : '—'}
                          <span className="ml-1"><Badge>{p.email_status}</Badge></span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {p.linkedin_url ? (
                          <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-sky-600 hover:underline">
                            <Link2 className="w-3 h-3" /> profile
                          </a>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{fmt(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-400 flex items-center gap-1">
            <ShieldQuestion className="w-3 h-3" />
            Row click opens the detail drawer. CSV columns recognised: first_name, last_name, title, company, company_size, linkedin_url, email, icp_segment, channel, source.
          </p>
        </div>
      </main>

      {openId && (
        <ProspectDrawer id={openId} onClose={() => setOpenId(null)} onMutated={load} />
      )}
    </div>
  );
}
