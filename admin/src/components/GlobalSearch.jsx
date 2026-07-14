import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { productPath } from '../lib/auth.js';
import { Search, Users, TrendingUp, X, Building2, FileText, Briefcase } from 'lucide-react';

// Central place mapping a search result `type` to its icon, section label,
// and navigation target — extend here when a new searchable entity is added
// server-side (src/routes/search.ts).
const RESULT_TYPES = {
  contact: { label: 'Contacts', icon: Users, iconBg: 'bg-primary-100', iconColor: 'text-primary-600', to: (r) => `/contacts?id=${r.id}` },
  deal: { label: 'Deals', icon: TrendingUp, iconBg: 'bg-success-500/10', iconColor: 'text-success-600', to: (r) => `/pipeline?deal=${r.id}` },
  wizmatch_company: { label: 'Companies', icon: Building2, iconBg: 'bg-warning-500/10', iconColor: 'text-warning-700', to: (r) => `/wizmatch/companies?id=${r.id}` },
  wizmatch_requirement: { label: 'Requirements', icon: FileText, iconBg: 'bg-primary-100', iconColor: 'text-primary-600', to: (r) => `/wizmatch/requirements?id=${r.id}` },
  wizmatch_submission: { label: 'Submissions', icon: Briefcase, iconBg: 'bg-accent-500/10', iconColor: 'text-accent-600', to: (r) => `/wizmatch/submissions?id=${r.id}` },
};

export default function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback((q) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(data?.results || []);
        setSelectedIdx(0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) {
      const r = results[selectedIdx];
      const config = RESULT_TYPES[r.type];
      if (config) navigate(productPath(config.to(r)));
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]" />
      <div
        className="relative bg-white rounded-xl shadow-modal w-full max-w-lg overflow-hidden animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100">
          <Search className="w-5 h-5 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); search(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Search contacts, deals, companies, requirements, submissions…"
            className="flex-1 text-base text-neutral-900 placeholder-neutral-400 outline-none bg-transparent"
          />
          <kbd className="hidden sm:inline-flex px-2 py-0.5 text-xs text-neutral-400 bg-neutral-100 rounded border border-neutral-200 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-5 py-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-10 bg-neutral-50 rounded-lg animate-pulse" />)}
            </div>
          )}

          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-neutral-400">
              No results for "{query}"
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-2">
              {Object.entries(RESULT_TYPES).map(([type, config]) => {
                const group = results.filter(r => r.type === type);
                if (group.length === 0) return null;
                const Icon = config.icon;
                return (
                  <React.Fragment key={type}>
                    <p className="px-5 py-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-wider mt-1 first:mt-0">{config.label}</p>
                    {group.map((r) => {
                      const idx = results.indexOf(r);
                      return (
                        <button
                          key={r.id}
                          onClick={() => { navigate(productPath(config.to(r))); onClose(); }}
                          className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                            idx === selectedIdx ? 'bg-primary-50' : 'hover:bg-neutral-50'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full ${config.iconBg} flex items-center justify-center shrink-0`}>
                            <Icon className={`w-4 h-4 ${config.iconColor}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-900 truncate">{r.name}</p>
                            <p className="text-xs text-neutral-400 truncate">{r.subtitle}</p>
                          </div>
                        </button>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {!loading && query.length < 2 && (
            <div className="px-5 py-6 text-center text-sm text-neutral-400">
              Type at least 2 characters to search
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
