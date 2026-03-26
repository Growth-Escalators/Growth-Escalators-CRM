import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { Search, Users, TrendingUp, X } from 'lucide-react';

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
      if (r.type === 'contact') navigate(`/contacts?id=${r.id}`);
      else if (r.type === 'deal') navigate(`/pipeline?deal=${r.id}`);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <Search className="w-5 h-5 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); search(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Search contacts, deals…"
            className="flex-1 text-base text-slate-900 placeholder-slate-400 outline-none bg-transparent"
          />
          <kbd className="hidden sm:inline-flex px-2 py-0.5 text-xs text-slate-400 bg-slate-100 rounded border border-slate-200 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-5 py-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-10 bg-slate-50 rounded-lg animate-pulse" />)}
            </div>
          )}

          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-slate-400">
              No results for "{query}"
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-2">
              {/* Contacts */}
              {results.filter(r => r.type === 'contact').length > 0 && (
                <>
                  <p className="px-5 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Contacts</p>
                  {results.filter(r => r.type === 'contact').map((r, i) => {
                    const idx = results.indexOf(r);
                    return (
                      <button
                        key={r.id}
                        onClick={() => { navigate(`/contacts?id=${r.id}`); onClose(); }}
                        className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                          idx === selectedIdx ? 'bg-sky-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center">
                          <Users className="w-4 h-4 text-sky-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                          <p className="text-xs text-slate-400 truncate">{r.subtitle}</p>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {/* Deals */}
              {results.filter(r => r.type === 'deal').length > 0 && (
                <>
                  <p className="px-5 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-1">Deals</p>
                  {results.filter(r => r.type === 'deal').map((r) => {
                    const idx = results.indexOf(r);
                    return (
                      <button
                        key={r.id}
                        onClick={() => { navigate(`/pipeline?deal=${r.id}`); onClose(); }}
                        className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                          idx === selectedIdx ? 'bg-sky-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-green-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                          <p className="text-xs text-slate-400 truncate">{r.subtitle}</p>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {!loading && query.length < 2 && (
            <div className="px-5 py-6 text-center text-sm text-slate-400">
              Type at least 2 characters to search
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
