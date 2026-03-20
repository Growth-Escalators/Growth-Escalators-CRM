import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';

const SOURCE_COLORS = {
  facebook: 'bg-blue-100 text-blue-700',
  instagram: 'bg-pink-100 text-pink-700',
  whatsapp: 'bg-green-100 text-green-700',
  organic: 'bg-emerald-100 text-emerald-700',
  referral: 'bg-purple-100 text-purple-700',
  email: 'bg-yellow-100 text-yellow-700',
};

// Stages per pipeline type
const ECOM_STAGES = [
  { id: 'paid_9', label: '₹9' },
  { id: 'paid_208', label: '₹208' },
  { id: 'paid_508', label: '₹508' },
  { id: 'paid_707', label: '₹707' },
  { id: 'appointment_booked', label: 'Appt Booked' },
  { id: 'no_show', label: 'No Show' },
  { id: 'call_done', label: 'Call Done' },
  { id: 'final_followup', label: 'Final Follow-up' },
  { id: 'won', label: 'Client Won' },
];

const DIRECT_STAGES = [
  { id: 'appointment', label: 'Appointment' },
  { id: 'booked', label: 'Booked' },
  { id: 'no_show', label: 'No Show' },
  { id: 'follow_up', label: 'Follow-up' },
  { id: 'won', label: 'Client' },
];

function stagesForDeal(deal) {
  return deal?.serviceType === 'ecom' ? ECOM_STAGES : DIRECT_STAGES;
}

export default function ContactSlideIn({ contact, onClose, onUpdated }) {
  const [channels, setChannels] = useState([]);
  const [deals, setDeals] = useState([]);
  const [messages, setMessages] = useState([]);
  const [enrolments, setEnrolments] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Tags editing
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  // Send message modal
  const [sendModal, setSendModal] = useState(false);
  const [sendTab, setSendTab] = useState('whatsapp');
  const [waTemplate, setWaTemplate] = useState('');
  const [waVars, setWaVars] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  useEffect(() => {
    if (!contact) return;
    setNotes(contact.metadata?.notes ?? '');
    setTags(contact.tags ?? []);
    setSendResult(null);

    apiFetch(`/contacts/${contact.id}`).then((d) => setChannels(d?.channels ?? []));
    apiFetch(`/deals?contactId=${contact.id}`).then((d) => setDeals(d?.deals ?? []));
    apiFetch(`/messages?contactId=${contact.id}&limit=5`).then((d) => setMessages(d?.messages ?? []));
    apiFetch(`/sequences/enrolments?contactId=${contact.id}`).then((d) => setEnrolments(Array.isArray(d) ? d : []));
  }, [contact?.id]);

  if (!contact) return null;

  const phone = channels.find((c) => c.channelType === 'whatsapp' || c.channelType === 'phone');
  const email = channels.find((c) => c.channelType === 'email');
  const activeDeal = deals[0];
  const stages = stagesForDeal(activeDeal);

  async function saveNotes() {
    setSaving(true);
    await apiFetch(`/contacts/${contact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { ...contact.metadata, notes } }),
    });
    setSaving(false);
    onUpdated?.();
  }

  async function moveStage(stage) {
    if (!activeDeal) return;
    await apiFetch(`/deals/${activeDeal.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage }),
    });
    onUpdated?.();
  }

  async function markDNC() {
    await apiFetch(`/contacts/${contact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ doNotContact: !contact.doNotContact }),
    });
    onUpdated?.();
  }

  // Tag helpers
  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { setTagInput(''); return; }
    setTags([...tags, t]);
    setTagInput('');
  }

  function removeTag(tag) {
    setTags(tags.filter((t) => t !== tag));
  }

  async function saveTags() {
    setSavingTags(true);
    await apiFetch(`/contacts/${contact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags }),
    });
    setSavingTags(false);
    onUpdated?.();
  }

  async function cancelEnrolment(enrolmentId) {
    await apiFetch(`/sequences/enrolments/${enrolmentId}`, { method: 'DELETE' });
    setEnrolments(enrolments.filter((e) => e.id !== enrolmentId));
  }

  async function sendMessage() {
    setSending(true);
    setSendResult(null);
    let result;
    if (sendTab === 'whatsapp') {
      let variables = {};
      try { variables = waVars ? JSON.parse(waVars) : {}; } catch { variables = {}; }
      result = await apiFetch('/messages/send/whatsapp', {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id, templateName: waTemplate, variables }),
      });
    } else {
      result = await apiFetch('/email/manual', {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id, subject: emailSubject, body: emailBody }),
      });
    }
    setSending(false);
    setSendResult(result?.success ? 'sent' : (result?.error ?? 'error'));
    if (result?.success) {
      // Reload messages
      apiFetch(`/messages?contactId=${contact.id}&limit=5`).then((d) => setMessages(d?.messages ?? []));
    }
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[440px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {contact.firstName} {contact.lastName ?? ''}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {contact.source && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[contact.source] ?? 'bg-slate-100 text-slate-600'}`}>
                  {contact.source}
                </span>
              )}
              {contact.doNotContact && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">DNC</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Contact details */}
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Contact</h3>
            <div className="space-y-2">
              {phone && (
                <div className="flex items-center justify-between">
                  <a
                    href={`https://wa.me/${phone.channelValue.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-green-600 hover:underline"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    {phone.channelValue}
                  </a>
                  <button
                    onClick={() => { setSendModal(true); setSendTab('whatsapp'); setSendResult(null); }}
                    className="text-xs bg-green-50 hover:bg-green-100 text-green-700 px-2 py-1 rounded-lg transition-colors"
                  >
                    Send WA
                  </button>
                </div>
              )}
              {email && (
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm text-slate-600">
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {email.channelValue}
                  </p>
                  <button
                    onClick={() => { setSendModal(true); setSendTab('email'); setSendResult(null); }}
                    className="text-xs bg-sky-50 hover:bg-sky-100 text-sky-700 px-2 py-1 rounded-lg transition-colors"
                  >
                    Send Email
                  </button>
                </div>
              )}
              <p className="text-sm text-slate-500">Status: <span className="font-medium text-slate-700">{contact.status}</span></p>
              {contact.assignedTo && (
                <p className="text-sm text-slate-500">Assigned: <span className="font-medium text-slate-700">{contact.assignedTo}</span></p>
              )}
            </div>
          </section>

          {/* Tags (editable) */}
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Tags</h3>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-violet-900 leading-none">×</button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-xs text-slate-400">No tags</span>}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Add tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                onClick={addTag}
                className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                Add
              </button>
              <button
                onClick={saveTags}
                disabled={savingTags}
                className="text-sm bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
              >
                {savingTags ? 'Saving…' : 'Save'}
              </button>
            </div>
          </section>

          {/* Pipeline stage */}
          {activeDeal && (
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Pipeline — {activeDeal.serviceType === 'ecom' ? 'Ecom Buyers' : 'Direct / Booking'}
              </h3>
              <p className="text-sm text-slate-600 mb-2">
                Current stage: <span className="font-semibold text-slate-900">
                  {stages.find((s) => s.id === activeDeal.stage)?.label ?? activeDeal.stage}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {stages.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => moveStage(s.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                      activeDeal.stage === s.id
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Active Sequences */}
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Active Sequences</h3>
            {enrolments.length === 0 ? (
              <p className="text-xs text-slate-400">Not enrolled in any sequences</p>
            ) : (
              <div className="space-y-2">
                {enrolments.map((e) => (
                  <div key={e.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{e.sequenceName ?? e.sequenceId}</p>
                      <p className="text-xs text-slate-400">
                        Step {e.currentStep + 1} · Next:{' '}
                        {e.nextStepAt ? new Date(e.nextStepAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </p>
                    </div>
                    <button
                      onClick={() => cancelEnrolment(e.id)}
                      className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 px-2 py-1 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent messages */}
          {messages.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Recent Messages</h3>
              <div className="space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium ${m.direction === 'inbound' ? 'text-green-600' : 'text-sky-600'}`}>
                        {m.direction === 'inbound' ? '← Received' : '→ Sent'} · {m.channel}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(m.sentAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-slate-700 line-clamp-2">{m.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Notes */}
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Add notes about this contact..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
            <button
              onClick={saveNotes}
              disabled={saving}
              className="mt-2 text-sm bg-slate-800 hover:bg-slate-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          </section>

          {/* Actions */}
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Actions</h3>
            <button
              onClick={markDNC}
              className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                contact.doNotContact
                  ? 'border-green-300 text-green-700 hover:bg-green-50'
                  : 'border-red-200 text-red-600 hover:bg-red-50'
              }`}
            >
              {contact.doNotContact ? '✓ Remove DNC flag' : 'Mark Do-Not-Contact'}
            </button>
          </section>
        </div>
      </div>

      {/* Send Message Modal */}
      {sendModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSendModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-[480px] max-w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900">Send Message</h3>
              <button onClick={() => setSendModal(false)} className="text-slate-400 hover:text-slate-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex bg-slate-100 rounded-lg p-1 mb-4">
              {['whatsapp', 'email'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setSendTab(tab); setSendResult(null); }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${sendTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {tab === 'whatsapp' ? 'WhatsApp' : 'Email'}
                </button>
              ))}
            </div>

            {sendTab === 'whatsapp' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Template Name</label>
                  <input
                    type="text"
                    placeholder="e.g. welcome_d2c"
                    value={waTemplate}
                    onChange={(e) => setWaTemplate(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Variables (JSON, optional)</label>
                  <textarea
                    placeholder='{"1": "John", "2": "Growth Escalators"}'
                    value={waVars}
                    onChange={(e) => setWaVars(e.target.value)}
                    rows={3}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono resize-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Subject</label>
                  <input
                    type="text"
                    placeholder="Email subject"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Body</label>
                  <textarea
                    placeholder="Email body..."
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={5}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
                  />
                </div>
              </div>
            )}

            {sendResult && (
              <p className={`mt-3 text-sm font-medium ${sendResult === 'sent' ? 'text-green-600' : 'text-red-600'}`}>
                {sendResult === 'sent' ? '✓ Message sent successfully' : `Error: ${sendResult}`}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setSendModal(false)}
                className="text-sm px-4 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendMessage}
                disabled={sending || (sendTab === 'whatsapp' ? !waTemplate : !emailSubject || !emailBody)}
                className="text-sm px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
