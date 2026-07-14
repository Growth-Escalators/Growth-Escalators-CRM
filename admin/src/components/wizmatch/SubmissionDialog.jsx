import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import DialogShell from './DialogShell.jsx';

/**
 * Captures named submission recipients before recording a submission (or
 * resend) as sent — replaces the two-prompt() flow that only captured a
 * single recipient. Backend: POST .../submissions/:id/record-sent, which is
 * a manual delivery record only — no email is sent from here.
 */
export default function SubmissionDialog({ open, resend = false, companyContacts = [], loading = false, error = null, onCancel, onSubmit }) {
  const empty = () => ({ name: '', email: '', role: 'recipient', companyContactId: '' });
  const [recipients, setRecipients] = useState([empty()]);
  const [nextAction, setNextAction] = useState('Follow up for submission feedback');
  const [nextActionDueAt, setNextActionDueAt] = useState('');

  const reset = () => {
    setRecipients([empty()]);
    setNextAction('Follow up for submission feedback');
    setNextActionDueAt('');
  };

  const setRecipient = (i, patch) => setRecipients((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRecipient = () => setRecipients((rs) => [...rs, empty()]);
  const removeRecipient = (i) => setRecipients((rs) => rs.filter((_, idx) => idx !== i));

  const validRecipients = recipients.filter((r) => r.name.trim());
  const canSubmit = !loading && validRecipients.length > 0 && nextActionDueAt;

  const submit = () => {
    onSubmit({
      recipients: validRecipients.map((r) => ({
        name: r.name.trim(),
        email: r.email.trim() || undefined,
        role: r.role,
        companyContactId: r.companyContactId || undefined,
      })),
      nextAction: nextAction.trim() || undefined,
      nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : undefined,
    });
  };

  return (
    <DialogShell
      open={open}
      title={resend ? 'Resend this submission' : 'Record submission as sent'}
      error={error}
      loading={loading}
      onCancel={() => { reset(); onCancel(); }}
      footer={
        <>
          <button type="button" onClick={() => { reset(); onCancel(); }} disabled={loading} className="btn-standard">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : resend ? 'Record resend' : 'Record sent'}
          </button>
        </>
      }
    >
      {({ firstFieldRef }) => (
        <>
          <p className="text-[12.5px] text-neutral-600">
            This is a manual delivery record — no email is sent automatically. Name every recipient the submission actually went to.
          </p>
          <div className="space-y-2">
            {recipients.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <input
                  ref={i === 0 ? firstFieldRef : undefined}
                  placeholder="Recipient name *"
                  value={r.name}
                  onChange={(e) => setRecipient(i, { name: e.target.value })}
                  className="input"
                />
                <input
                  placeholder="Email (optional)"
                  value={r.email}
                  onChange={(e) => setRecipient(i, { email: e.target.value })}
                  className="input"
                />
                <button type="button" onClick={() => removeRecipient(i)} disabled={recipients.length === 1} className="text-danger-600 disabled:opacity-30 justify-self-end">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {companyContacts.length > 0 && (
                  <select value={r.companyContactId} onChange={(e) => setRecipient(i, { companyContactId: e.target.value })} className="input col-span-2">
                    <option value="">Link to hiring contact (optional)…</option>
                    {companyContacts.map((c) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</option>)}
                  </select>
                )}
              </div>
            ))}
            <button type="button" onClick={addRecipient} className="text-[12.5px] font-semibold text-primary-700 inline-flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add recipient
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-neutral-100">
            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Next action</label>
              <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="input w-full mt-1" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Next action due *</label>
              <input type="datetime-local" value={nextActionDueAt} onChange={(e) => setNextActionDueAt(e.target.value)} className="input w-full mt-1" />
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}
