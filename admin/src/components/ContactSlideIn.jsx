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

const STAGE_LABELS = {
  appointment: 'Appointment',
  booked: 'Booked',
  no_show: 'No Show',
  follow_up: 'Follow-up',
  won: 'Client',
  lost: 'Lost',
  lead: 'Lead',
};

const STAGES = ['appointment', 'booked', 'no_show', 'follow_up', 'won'];

export default function ContactSlideIn({ contact, onClose, onUpdated }) {
  const [channels, setChannels] = useState([]);
  const [deals, setDeals] = useState([]);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!contact) return;
    setNotes(contact.metadata?.notes ?? '');

    apiFetch(`/contacts/${contact.id}`).then((d) => setChannels(d?.channels ?? []));
    apiFetch(`/deals?contactId=${contact.id}`).then((d) => setDeals(d?.deals ?? []));
    apiFetch(`/messages?contactId=${contact.id}&limit=5`).then((d) => setMessages(d?.messages ?? []));
  }, [contact?.id]);

  if (!contact) return null;

  const phone = channels.find((c) => c.channelType === 'whatsapp' || c.channelType === 'phone');
  const email = channels.find((c) => c.channelType === 'email');
  const activeDeal = deals[0];

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

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
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
              {contact.tags?.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                  {tag}
                </span>
              ))}
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
              )}
              {email && (
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {email.channelValue}
                </p>
              )}
              <p className="text-sm text-slate-500">Status: <span className="font-medium text-slate-700">{contact.status}</span></p>
              {contact.assignedTo && (
                <p className="text-sm text-slate-500">Assigned: <span className="font-medium text-slate-700">{contact.assignedTo}</span></p>
              )}
            </div>
          </section>

          {/* Pipeline stage */}
          {activeDeal && (
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pipeline</h3>
              <p className="text-sm text-slate-600 mb-2">
                Current stage: <span className="font-semibold text-slate-900">{STAGE_LABELS[activeDeal.stage] ?? activeDeal.stage}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    onClick={() => moveStage(s)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                      activeDeal.stage === s
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {STAGE_LABELS[s]}
                  </button>
                ))}
              </div>
            </section>
          )}

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
    </>
  );
}
