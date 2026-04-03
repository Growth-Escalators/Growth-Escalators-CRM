import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

const STATUS_BADGE = {
  approved: 'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
};

const CATEGORY_BADGE = {
  utility:   'bg-sky-100 text-sky-700',
  marketing: 'bg-purple-100 text-purple-700',
};

function highlightVars(text) {
  if (!text) return null;
  const parts = text.split(/(\{\{\w+\}\})/g);
  return parts.map((part, i) =>
    /^\{\{\w+\}\}$/.test(part)
      ? <span key={i} className="bg-amber-100 text-amber-800 px-1 rounded font-mono text-xs">{part}</span>
      : part
  );
}

function detectVars(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/\{\{(\w+)\}\}/g)];
  return [...new Set(matches.map(m => m[1]))];
}

// ── Create Template Modal ────────────────────────────────────────────────────
function CreateTemplateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ templateName: '', category: 'utility', body: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const vars = detectVars(form.body);

  async function handleSave() {
    if (!form.templateName.trim()) { setError('Template name is required'); return; }
    if (!form.body.trim()) { setError('Message body is required'); return; }
    if (!/^[a-z0-9_]+$/.test(form.templateName)) {
      setError('Name must be lowercase letters, numbers, and underscores only');
      return;
    }
    setSaving(true); setError('');
    try {
      await apiFetch('/api/whatsapp/templates', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold text-slate-900">Create Template</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Template Name *</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. welcome_new_client"
              value={form.templateName}
              onChange={e => setForm(f => ({ ...f, templateName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} />
            <p className="text-xs text-slate-400 mt-1">Lowercase, numbers, underscores only</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
            <div className="flex rounded-lg border border-slate-300 overflow-hidden">
              {['utility', 'marketing'].map(c => (
                <button key={c} onClick={() => setForm(f => ({ ...f, category: c }))}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    form.category === c ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">Message Body *</label>
              <span className={`text-xs ${form.body.length > 1024 ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                {form.body.length} / 1024
              </span>
            </div>
            <textarea rows={6}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
              placeholder="Hi {{firstName}}, welcome to..."
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            <p className="text-xs text-slate-400 mt-1">
              Use {'{{variableName}}'} for dynamic content
            </p>
          </div>

          {vars.length > 0 && (
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
              <p className="text-xs font-medium text-amber-800 mb-1">
                {vars.length} variable{vars.length !== 1 ? 's' : ''} detected:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {vars.map(v => (
                  <span key={v} className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs font-mono">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {form.body.trim() && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Preview</label>
              <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap border border-slate-100 leading-relaxed">
                {highlightVars(form.body)}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || form.body.length > 1024}
            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function WhatsAppTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiFetch('/api/whatsapp/templates')
      .then(d => setTemplates(d?.templates || []))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleCopy(body, id) {
    navigator.clipboard.writeText(body).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const filtered = templates.filter(t =>
    !filterCategory || t.category === filterCategory
  );

  const approvedCount = templates.filter(t => t.status === 'approved').length;
  const pendingCount = templates.filter(t => t.status === 'pending').length;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">WhatsApp Templates</h1>
            <p className="text-slate-500 mt-1 text-sm">Pre-approved message templates for WhatsApp Business API</p>
          </div>
          <button onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 flex items-center gap-1.5">
            + Create Template
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{templates.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Approved</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{approvedCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-bold text-yellow-600 mt-1">{pendingCount}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-5">
          {['', 'utility', 'marketing'].map(c => (
            <button key={c} onClick={() => setFilterCategory(c)}
              className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${
                filterCategory === c ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {c === '' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">No templates found</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map(t => {
              const vars = detectVars(t.body);
              return (
                <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800 font-mono">{t.template_name || t.templateName}</h3>
                      {t.description && <p className="text-xs text-slate-400 mt-0.5">{t.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_BADGE[t.category] || 'bg-slate-100 text-slate-600'}`}>
                        {t.category}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[t.status] || 'bg-slate-100 text-slate-600'}`}>
                        {t.status}
                      </span>
                    </div>
                  </div>

                  {/* Body */}
                  {t.body ? (
                    <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap flex-1 border border-slate-100 leading-relaxed">
                      {highlightVars(t.body)}
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-400 italic flex-1 border border-slate-100">
                      No message body available
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      {vars.length > 0 && (
                        <span className="text-xs text-slate-400">
                          {vars.length} variable{vars.length !== 1 ? 's' : ''}: {vars.map(v => (
                            <span key={v} className="font-mono text-amber-600">{v}</span>
                          )).reduce((a, b, i) => i === 0 ? [b] : [...a, ', ', b], [])}
                        </span>
                      )}
                    </div>
                    {t.body && (
                      <button onClick={() => handleCopy(t.body, t.id)}
                        className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors ${
                          copied === t.id
                            ? 'bg-green-100 text-green-700'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}>
                        {copied === t.id ? 'Copied!' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateTemplateModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchData(); }}
        />
      )}
    </div>
  );
}
