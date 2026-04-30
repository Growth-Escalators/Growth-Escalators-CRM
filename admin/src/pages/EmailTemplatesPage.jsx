import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

const TYPE_META = {
  sequence: { label: 'Sequence', color: '#16a34a', bg: '#dcfce7' },
  triggered: { label: 'Triggered', color: '#d97706', bg: '#fef3c7' },
  manual: { label: 'Manual', color: '#2563eb', bg: '#dbeafe' },
};

const COMMON_VARIABLES = [
  'firstName', 'email', 'bookingUrl', 'companyName', 'appointmentTime', 'meetingLink', 'followupNotes',
];

function detectVariables(text) {
  const matches = [...(text || '').matchAll(/\{\{(\w+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, color = '#2563eb' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── New Template Modal ───────────────────────────────────────────────────────
function NewTemplateModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '', displayName: '', type: 'sequence', subject: '',
    fromName: 'Jatin from Growth Escalators', bodyText: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    if (!form.name || !form.subject) { setError('Name and subject are required'); return; }
    setSaving(true);
    try {
      const result = await apiFetch('/api/email-templates', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onCreate(result);
    } catch (err) {
      setError(err.message || 'Failed to create template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">New Email Template</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Slug name *</label>
              <input value={form.name} onChange={set('name')} placeholder="welcome_d2c"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Display name</label>
              <input value={form.displayName} onChange={set('displayName')} placeholder="Welcome Email — D2C"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select value={form.type} onChange={set('type')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="sequence">Sequence step</option>
                <option value="triggered">Triggered</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">From name</label>
              <input value={form.fromName} onChange={set('fromName')}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Subject line *</label>
            <input value={form.subject} onChange={set('subject')} placeholder="Your D2C Funnel Breakdown Pack is here"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Body (plain text)</label>
            <textarea value={form.bodyText} onChange={set('bodyText')} rows={6}
              placeholder={'Hi {{firstName}},\n\nYour email body here...\n\nJatin\nGrowth Escalators'}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-white">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Send Test Modal ──────────────────────────────────────────────────────────
function SendTestModal({ template, onClose }) {
  const vars = detectVariables((template.bodyText || '') + ' ' + (template.subject || ''));
  const [toEmail, setToEmail] = useState('jatin@growthescalators.com');
  const [varValues, setVarValues] = useState(() => {
    const defaults = { firstName: 'Rahul', email: 'rahul@example.com', bookingUrl: 'https://api.growthescalators.com/book/d2c-strategy', appointmentTime: '10:00 AM IST, March 25', meetingLink: 'https://meet.google.com/example', companyName: 'Test Brand', followupNotes: 'We discussed Meta ads strategy' };
    const obj = {};
    vars.forEach((v) => { obj[v] = defaults[v] || `sample_${v}`; });
    return obj;
  });
  const [status, setStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [error, setError] = useState('');

  async function handleSend() {
    setStatus('sending');
    setError('');
    try {
      await apiFetch(`/api/email-templates/${template.id}/send-test`, {
        method: 'POST',
        body: JSON.stringify({ toEmail, variables: varValues }),
      });
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Send failed');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Send Test Email</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {status === 'sent' ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              </div>
              <p className="text-slate-900 font-semibold">Test sent!</p>
              <p className="text-slate-500 text-sm mt-1">Delivered to {toEmail}</p>
            </div>
          ) : (
            <>
              {status === 'error' && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Send to</label>
                <input value={toEmail} onChange={(e) => setToEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {vars.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Sample variable values</label>
                  <div className="space-y-2">
                    {vars.map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-500 w-32 shrink-0">{`{{${v}}}`}</span>
                        <input value={varValues[v] || ''} onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                          className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-white">
            {status === 'sent' ? 'Close' : 'Cancel'}
          </button>
          {status !== 'sent' && (
            <button onClick={handleSend} disabled={status === 'sending'}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
              {status === 'sending' ? 'Sending…' : 'Send test email'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showTest, setShowTest] = useState(false);

  // Editor state
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [preview, setPreview] = useState(false);

  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/email-templates');
      setTemplates(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function selectTemplate(t) {
    setSelected(t);
    setForm({
      name: t.name,
      displayName: t.displayName || '',
      type: t.type || 'sequence',
      subject: t.subject,
      fromName: t.fromName || 'Jatin from Growth Escalators',
      bodyHtml: t.bodyHtml || '',
      bodyText: t.bodyText || '',
    });
    setDirty(false);
    setSyncMsg(null);
  }

  function setField(k) {
    return (e) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setDirty(true);
    };
  }

  function insertVariable(varName) {
    const ta = bodyRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = form.bodyText || '';
    const newVal = val.slice(0, start) + `{{${varName}}}` + val.slice(end);
    setForm((f) => ({ ...f, bodyText: newVal }));
    setDirty(true);
    // Restore cursor after the inserted text
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + varName.length + 4;
      ta.focus();
    }, 0);
  }

  async function handleSaveSync() {
    if (!selected || !form) return;
    setSaving(true);
    setSyncing(true);
    setSyncMsg(null);
    try {
      await apiFetch(`/api/email-templates/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      const syncRes = await apiFetch(`/api/email-templates/${selected.id}/sync`, { method: 'POST' });
      if (syncRes.synced) {
        setSyncMsg({ ok: true, brevoId: syncRes.brevoTemplateId });
      } else {
        setSyncMsg({ ok: false, error: syncRes.error || 'Sync failed' });
      }
      setDirty(false);
      await load();
      // Reload selected
      const updated = await apiFetch(`/api/email-templates/${selected.id}`);
      setSelected(updated);
    } catch (err) {
      setSyncMsg({ ok: false, error: err.message });
    } finally {
      setSaving(false);
      setSyncing(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete template "${selected.name}"? This cannot be undone.`)) return;
    await apiFetch(`/api/email-templates/${selected.id}`, { method: 'DELETE' });
    setSelected(null);
    setForm(null);
    load();
  }

  // Stats
  const totalSynced = templates.filter((t) => t.brevoSynced).length;
  const totalSent = templates.reduce((s, t) => s + (t.sentCount || 0), 0);

  // Live preview
  const sampleVars = { firstName: 'Rahul', email: 'rahul@example.com', bookingUrl: 'https://cal.com/growth-escalators', appointmentTime: '10:00 AM IST, March 25', meetingLink: 'https://meet.google.com/abc-def', companyName: 'Test Brand', followupNotes: 'We discussed Meta ads strategy' };
  function renderPreview(text) {
    return (text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => sampleVars[k] ?? `{{${k}}}`);
  }

  const detectedVars = detectVariables((form?.bodyText || '') + ' ' + (form?.subject || ''));

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Stats bar */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Email Templates</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage and sync email templates with Brevo</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Templates" value={templates.length} color="#1e293b" />
          <StatCard label="Synced to Brevo" value={totalSynced} color="#16a34a" />
          <StatCard label="Total Sent" value={totalSent} color="#2563eb" />
          <StatCard label="Avg Open Rate" value="—" color="#d97706" />
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-700">Templates ({templates.length})</span>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
              New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {[1,2,3].map((i) => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}
              </div>
            ) : templates.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-slate-400 text-sm">No templates yet</p>
                <button onClick={() => setShowNew(true)} className="mt-3 text-xs text-blue-600 font-medium">+ Create your first template</button>
              </div>
            ) : (
              templates.map((t) => {
                const tm = TYPE_META[t.type] || TYPE_META.manual;
                const isActive = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${isActive ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-slate-900 truncate">{t.displayName || t.name}</span>
                      <span className="text-xs font-mono text-slate-400 ml-2 shrink-0">{t.brevoSynced ? '●' : '○'}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ color: tm.color, background: tm.bg }}>{tm.label}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${t.brevoSynced ? 'text-green-700 bg-green-50' : 'text-slate-500 bg-slate-100'}`}>
                        {t.brevoSynced ? `Brevo #${t.brevoTemplateId}` : 'Draft'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{t.sentCount || 0} sent{t.openRate ? ` · ${(t.openRate * 100).toFixed(0)}% open` : ''}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-slate-500 font-medium">Select a template to edit</p>
              <p className="text-slate-400 text-sm mt-1">or create a new one</p>
              <button onClick={() => setShowNew(true)}
                className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                + Create your first template
              </button>
            </div>
          ) : form && (
            <div className="p-6 space-y-5 max-w-3xl">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <input
                    value={form.displayName || form.name}
                    onChange={(e) => { setForm((f) => ({ ...f, displayName: e.target.value })); setDirty(true); }}
                    className="text-xl font-bold text-slate-900 bg-transparent border-0 border-b-2 border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none w-full pb-0.5"
                  />
                  <p className="text-sm text-slate-400 mt-1">
                    {selected.brevoTemplateId ? `Brevo ID: ${selected.brevoTemplateId}` : 'Not synced to Brevo'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShowTest(true)}
                    className="px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Send test
                  </button>
                  <button
                    onClick={handleSaveSync}
                    disabled={saving || syncing}
                    className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                    style={{ background: saving ? '#f59e0b88' : '#f59e0b' }}
                  >
                    {saving ? (
                      <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Saving…</>
                    ) : 'Save + sync to Brevo'}
                  </button>
                  <button onClick={handleDelete} className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>
              </div>

              {/* Sync status */}
              {syncMsg && (
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${syncMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  <span>{syncMsg.ok ? `✓ Synced to Brevo — Template ID ${syncMsg.brevoId}` : `✗ Sync failed: ${syncMsg.error}`}</span>
                </div>
              )}

              {/* Form */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Slug name</label>
                    <input value={form.name} onChange={setField('name')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                    <select value={form.type} onChange={setField('type')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="sequence">Sequence step</option>
                      <option value="triggered">Triggered</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">From name</label>
                    <input value={form.fromName} onChange={setField('fromName')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Subject line</label>
                  <input value={form.subject} onChange={setField('subject')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* Variable pills */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">Insert variable</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_VARIABLES.map((v) => (
                      <button key={v} onClick={() => insertVariable(v)}
                        className="text-xs font-mono text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-1 rounded-md">
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Detected variables */}
                {detectedVars.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Detected variables in body</label>
                    <div className="flex flex-wrap gap-1.5">
                      {detectedVars.map((v) => (
                        <span key={v} className="text-xs font-mono text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded-md">{`{{${v}}}`}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Body editor */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-700">Body (plain text)</label>
                    <button onClick={() => setPreview((p) => !p)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      {preview ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {preview ? (
                    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 text-sm text-slate-800 whitespace-pre-wrap font-sans min-h-[200px]">
                      {renderPreview(form.bodyText)}
                    </div>
                  ) : (
                    <textarea
                      ref={bodyRef}
                      value={form.bodyText}
                      onChange={setField('bodyText')}
                      rows={14}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              </div>

              {/* Sync status footer */}
              <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm ${
                selected.brevoSynced
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-amber-50 border-amber-200 text-amber-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${selected.brevoSynced ? 'bg-green-500' : 'bg-amber-500'}`} />
                {selected.brevoSynced
                  ? `Synced to Brevo · Template ID ${selected.brevoTemplateId} · Last synced ${timeAgo(selected.brevoSyncedAt)}`
                  : 'Not yet synced — click "Save + sync to Brevo" to push this template'}
              </div>

              {dirty && (
                <div className="text-xs text-amber-600 text-center">You have unsaved changes</div>
              )}
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewTemplateModal
          onClose={() => setShowNew(false)}
          onCreate={(t) => { setShowNew(false); load().then(() => selectTemplate(t)); }}
        />
      )}
      {showTest && selected && (
        <SendTestModal template={{ ...selected, ...form }} onClose={() => setShowTest(false)} />
      )}
    </div>
  );
}
