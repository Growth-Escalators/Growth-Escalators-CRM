import React, { useEffect, useState } from 'react';
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

export default function WhatsAppTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');

  useEffect(() => {
    apiFetch('/api/whatsapp/templates')
      .then(d => setTemplates(d?.templates || []))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, []);

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
    </div>
  );
}
