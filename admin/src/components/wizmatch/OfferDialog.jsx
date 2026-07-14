import React, { useState } from 'react';
import DialogShell from './DialogShell.jsx';

const PERIODS = ['annual', 'monthly', 'hourly'];
const CURRENCIES = ['INR', 'USD'];

/**
 * Creates a new offer revision (POST .../submissions/:id/offers). Every call
 * is a new revision row server-side — there is no separate "edit" endpoint —
 * so this same dialog is used for both the first offer and later revisions;
 * the caller passes `revision` purely for the dialog title.
 */
export default function OfferDialog({ open, revision, loading = false, error = null, onCancel, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [period, setPeriod] = useState('annual');
  const [startDate, setStartDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [markAccepted, setMarkAccepted] = useState(false);

  const canSubmit = !loading && Number(amount) > 0;

  const submit = () => {
    onSubmit({
      amount: Number(amount),
      currency,
      period,
      startDate: startDate || undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      status: markAccepted ? 'accepted' : 'draft',
    });
  };

  return (
    <DialogShell
      open={open}
      title={revision ? `Revise offer (revision ${revision})` : 'Create offer'}
      error={error}
      loading={loading}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={loading} className="btn-standard">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : revision ? 'Save revision' : 'Create offer'}
          </button>
        </>
      }
    >
      {({ firstFieldRef }) => (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input w-full mt-1">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Amount *</label>
              <input ref={firstFieldRef} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="input w-full mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Per</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input w-full mt-1">
                {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input w-full mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Expires</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input w-full mt-1" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
            <input type="checkbox" checked={markAccepted} onChange={(e) => setMarkAccepted(e.target.checked)} />
            Candidate has already accepted this offer
          </label>
        </>
      )}
    </DialogShell>
  );
}
