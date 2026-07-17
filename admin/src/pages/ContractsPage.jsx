import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

const STATUS_BADGE = {
  DRAFT: 'bg-neutral-100 text-neutral-700',
  GENERATED: 'bg-blue-100 text-blue-700',
  READY_TO_SEND: 'bg-indigo-100 text-indigo-700',
  SENT: 'bg-amber-100 text-amber-700',
  VIEWED: 'bg-amber-100 text-amber-800',
  PARTIALLY_SIGNED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-neutral-200 text-neutral-600',
  VOIDED: 'bg-neutral-200 text-neutral-600',
  FAILED: 'bg-red-100 text-red-700',
};

const FILTERS = ['ALL', 'DRAFT', 'GENERATED', 'READY_TO_SEND', 'SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'VOIDED'];

function Badge({ status }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status] || 'bg-neutral-100 text-neutral-700'}`}>
      {status?.replace(/_/g, ' ')}
    </span>
  );
}

const emptyForm = () => ({
  title: '',
  terms: '',
  clientName: '',
  clientEmail: '',
  withCountersigner: false,
  counterName: '',
  counterEmail: '',
});

export default function ContractsPage() {
  const [contracts, setContracts] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [detail, setDetail] = useState(null); // { contract, recipients, events }
  const [links, setLinks] = useState({}); // recipientId -> signing url
  const fileInputRef = useRef(null);
  const [uploadTargetId, setUploadTargetId] = useState(''); // contract awaiting an uploaded PDF

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = filter === 'ALL' ? '' : `?status=${filter}`;
      const res = await apiFetch(`/api/contracts${q}`);
      setContracts(res.contracts || []);
    } catch (e) {
      setError(e.message || 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function createContract(e) {
    e.preventDefault();
    setBusyId('new');
    setError('');
    try {
      const recipients = [
        { name: form.clientName, email: form.clientEmail, signingRole: 'client_signer', signingOrder: 1 },
      ];
      if (form.withCountersigner && form.counterEmail) {
        recipients.push({ name: form.counterName, email: form.counterEmail, signingRole: 'internal_countersigner', signingOrder: 2 });
      }
      await apiFetch('/api/contracts', {
        method: 'POST',
        body: JSON.stringify({ title: form.title, terms: form.terms, recipients }),
      });
      setShowNew(false);
      setForm(emptyForm());
      await load();
    } catch (e2) {
      setError(e2.message || 'Failed to create contract');
    } finally {
      setBusyId('');
    }
  }

  async function act(id, verb) {
    let body;
    if (verb === 'void') {
      const reason = window.prompt('Reason for voiding this contract?');
      if (!reason) return;
      body = JSON.stringify({ reason });
    }
    setBusyId(id);
    setError('');
    try {
      await apiFetch(`/api/contracts/${id}/${verb}`, { method: 'POST', body });
      await load();
      if (detail?.contract?.id === id) await openDetail(id);
    } catch (e) {
      setError(e.message || `Failed to ${verb}`);
    } finally {
      setBusyId('');
    }
  }

  async function openDetail(id) {
    try {
      const res = await apiFetch(`/api/contracts/${id}`);
      setDetail(res);
    } catch (e) {
      setError(e.message || 'Failed to load contract');
    }
  }

  async function copyLink(recipientId) {
    try {
      const res = await apiFetch(`/api/contracts/${detail.contract.id}/recipients/${recipientId}/signing-link`, { method: 'POST' });
      setLinks((prev) => ({ ...prev, [recipientId]: res.url }));
    } catch (e) {
      setError(e.message || 'Could not create link');
    }
  }

  async function download(id, artifact) {
    try {
      const res = await apiFetch(`/api/contracts/${id}/download?artifact=${artifact}`);
      if (res.url) window.open(res.url, '_blank', 'noopener');
    } catch (e) {
      setError(e.message || 'Download unavailable');
    }
  }

  // Bring-your-own-PDF: open the file picker for a specific DRAFT contract.
  function pickPdf(id) {
    setUploadTargetId(id);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function onFileChosen(e) {
    const file = e.target.files?.[0];
    const id = uploadTargetId;
    if (!file || !id) return;
    if (file.type && file.type !== 'application/pdf') {
      setError('Please choose a PDF file.');
      setUploadTargetId('');
      return;
    }
    setBusyId(id);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      // apiFetch omits Content-Type for FormData so the browser sets the multipart boundary.
      await apiFetch(`/api/contracts/${id}/upload`, { method: 'POST', body: fd });
      await load();
      if (detail?.contract?.id === id) await openDetail(id);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setBusyId('');
      setUploadTargetId('');
    }
  }

  function rowActions(c) {
    const busy = busyId === c.id;
    const btn = 'rounded px-2 py-1 text-xs font-medium disabled:opacity-50';
    const out = [];
    if (c.status === 'DRAFT') out.push(<button key="g" disabled={busy} className={`${btn} bg-blue-600 text-white`} onClick={() => act(c.id, 'generate')}>Generate</button>);
    if (c.status === 'DRAFT') out.push(<button key="u" disabled={busy} className={`${btn} bg-slate-600 text-white`} onClick={() => pickPdf(c.id)} title="Sign a PDF you already have instead of generating one">Upload PDF</button>);
    if (c.status === 'GENERATED') out.push(<button key="a" disabled={busy} className={`${btn} bg-indigo-600 text-white`} onClick={() => act(c.id, 'approve')}>Approve</button>);
    if (c.status === 'READY_TO_SEND') out.push(<button key="s" disabled={busy} className={`${btn} bg-amber-600 text-white`} onClick={() => act(c.id, 'send')}>Send</button>);
    if (c.status === 'COMPLETED') out.push(<button key="d" className={`${btn} bg-green-600 text-white`} onClick={() => download(c.id, 'completed')}>Download</button>);
    if (!['COMPLETED', 'VOIDED', 'EXPIRED', 'REJECTED'].includes(c.status)) out.push(<button key="v" disabled={busy} className={`${btn} bg-neutral-200 text-neutral-700`} onClick={() => act(c.id, 'void')}>Void</button>);
    return out;
  }

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />
      {/* Hidden picker for the "Upload PDF" action (bring-your-own-PDF). */}
      <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChosen} />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Contracts</h1>
            <p className="text-sm text-neutral-500">Create, send, and track e-signature contracts.</p>
          </div>
          <button className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white" onClick={() => setShowNew(true)}>New contract</button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 border border-neutral-200'}`}>
              {f.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">Loading…</td></tr>}
              {!loading && contracts.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No contracts yet.</td></tr>}
              {contracts.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                  <td className="px-4 py-2 font-mono text-xs text-neutral-600 cursor-pointer" onClick={() => openDetail(c.id)}>{c.referenceNumber}</td>
                  <td className="px-4 py-2 cursor-pointer" onClick={() => openDetail(c.id)}>{c.title}</td>
                  <td className="px-4 py-2"><Badge status={c.status} /></td>
                  <td className="px-4 py-2 text-neutral-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2"><div className="flex justify-end gap-2">{rowActions(c)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {showNew && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowNew(false)}>
          <form className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} onSubmit={createContract}>
            <h2 className="mb-4 text-lg font-semibold">New contract</h2>
            <label className="mb-2 block text-sm">Title
              <input required className="mt-1 w-full rounded border border-neutral-300 px-3 py-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="block text-sm">Client name
                <input required className="mt-1 w-full rounded border border-neutral-300 px-3 py-2" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
              </label>
              <label className="block text-sm">Client email
                <input required type="email" className="mt-1 w-full rounded border border-neutral-300 px-3 py-2" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
              </label>
            </div>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.withCountersigner} onChange={(e) => setForm({ ...form, withCountersigner: e.target.checked })} />
              Require internal countersignature
            </label>
            {form.withCountersigner && (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <input placeholder="Countersigner name" className="rounded border border-neutral-300 px-3 py-2" value={form.counterName} onChange={(e) => setForm({ ...form, counterName: e.target.value })} />
                <input placeholder="Countersigner email" type="email" className="rounded border border-neutral-300 px-3 py-2" value={form.counterEmail} onChange={(e) => setForm({ ...form, counterEmail: e.target.value })} />
              </div>
            )}
            <label className="mb-4 block text-sm">Terms
              <textarea rows={4} className="mt-1 w-full rounded border border-neutral-300 px-3 py-2" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded px-4 py-2 text-sm" onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" disabled={busyId === 'new'} className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">Create draft</button>
            </div>
          </form>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setDetail(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{detail.contract.title}</h2>
                <p className="font-mono text-xs text-neutral-500">{detail.contract.referenceNumber}</p>
              </div>
              <Badge status={detail.contract.status} />
            </div>

            <h3 className="mb-2 text-sm font-semibold text-neutral-700">Recipients</h3>
            <ul className="mb-4 space-y-2 text-sm">
              {detail.recipients.map((r) => {
                const canLink = ['SENT', 'VIEWED', 'PARTIALLY_SIGNED'].includes(detail.contract.status) && r.status !== 'signed';
                return (
                  <li key={r.id} className="rounded border border-neutral-100 px-2 py-1">
                    <div className="flex items-center justify-between">
                      <span>{r.name} <span className="text-neutral-400">({r.signingRole?.replace(/_/g, ' ')})</span></span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-neutral-500">{r.status}</span>
                        {canLink && (
                          <button data-testid={`copy-link-${r.id}`} className="rounded bg-neutral-200 px-2 py-0.5 text-xs" onClick={() => copyLink(r.id)}>Copy link</button>
                        )}
                      </span>
                    </div>
                    {links[r.id] && (
                      <input data-testid={`signing-link-${r.id}`} readOnly value={links[r.id]} onFocus={(e) => e.target.select()} className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600" />
                    )}
                  </li>
                );
              })}
            </ul>

            {detail.contract.status === 'COMPLETED' && (
              <div className="mb-4 flex gap-2">
                <button className="rounded bg-green-600 px-3 py-1 text-xs text-white" onClick={() => download(detail.contract.id, 'completed')}>Signed PDF</button>
                <button className="rounded bg-neutral-200 px-3 py-1 text-xs" onClick={() => download(detail.contract.id, 'audit-certificate')}>Audit certificate</button>
              </div>
            )}

            <h3 className="mb-2 text-sm font-semibold text-neutral-700">Audit timeline</h3>
            <ul className="space-y-1 text-xs text-neutral-600">
              {detail.events.map((ev) => (
                <li key={ev.id} className="flex justify-between border-b border-neutral-100 py-1">
                  <span>{ev.eventType}</span>
                  <span className="text-neutral-400">{ev.occurredAt ? new Date(ev.occurredAt).toLocaleString() : ''}</span>
                </li>
              ))}
            </ul>

            <button className="mt-6 w-full rounded border border-neutral-300 py-2 text-sm" onClick={() => setDetail(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
