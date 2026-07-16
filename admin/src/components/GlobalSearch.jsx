import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BriefcaseBusiness,
  Building2,
  FileText,
  Search,
  SendHorizontal,
  TrendingUp,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { getTenantSlug, productPath } from '../lib/auth.js';
import { buildWizmatchEntityHref } from '../lib/wizmatchRouteRegistry.js';
import { DIALOG_FOCUSABLE_SELECTOR, trappedDialogFocusTarget } from '../lib/focusManagement.js';
import { invalidateGlobalSearchRequest } from '../lib/globalSearchRequest.js';

const RESULT_META = {
  company: { label: 'Companies', icon: Building2, tone: 'bg-primary-50 text-primary-700' },
  contact: { label: 'Hiring contacts', icon: UserRound, tone: 'bg-violet-50 text-violet-700' },
  requirement: { label: 'Roles / Requirements', icon: FileText, tone: 'bg-warning-50 text-warning-700' },
  candidate: { label: 'Candidates', icon: BriefcaseBusiness, tone: 'bg-success-500/10 text-success-700' },
  submission: { label: 'Submissions', icon: SendHorizontal, tone: 'bg-sky-50 text-sky-700' },
  deal: { label: 'Deals', icon: TrendingUp, tone: 'bg-success-500/10 text-success-700' },
  crm_contact: { label: 'Contacts', icon: Users, tone: 'bg-primary-50 text-primary-700' },
};

const TYPE_ORDER = ['company', 'contact', 'requirement', 'candidate', 'submission', 'crm_contact', 'deal'];

function containsQuery(query, ...values) {
  const haystack = values.flat().filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function result(type, id, name, subtitle, href) {
  return { type, id: String(id), name: name || 'Untitled record', subtitle: subtitle || '', href };
}

function normalizeWizmatchResults(query, responses) {
  const [companies, contacts, requirements, candidates, delivery] = responses.map((response) => (
    response.status === 'fulfilled' ? response.value : null
  ));
  return [
    ...(companies?.items || []).slice(0, 5).map((item) => result(
      'company', item.id, item.name, [item.domain, `${item.open_requirement_count || 0} open roles`].filter(Boolean).join(' · '),
      buildWizmatchEntityHref('company', item.id),
    )),
    ...(contacts?.items || []).filter((item) => containsQuery(query, item.first_name, item.last_name, item.company_name, item.email, item.phone)).slice(0, 5).map((item) => result(
      'contact', item.id, [item.first_name, item.last_name].filter(Boolean).join(' '), item.email || item.company_name || item.phone,
      buildWizmatchEntityHref('contact', item.id),
    )),
    ...(requirements?.items || []).filter((item) => containsQuery(query, item.title, item.company_name, item.primary_source_name, item.required_skills)).slice(0, 5).map((item) => result(
      'requirement', item.id, item.title, [item.company_name, item.primary_source_name, item.stage].filter(Boolean).join(' · '),
      buildWizmatchEntityHref('requirement', item.id),
    )),
    ...(candidates?.items || []).filter((item) => containsQuery(query, item.first_name, item.last_name, item.company_name, item.location, item.skills)).slice(0, 5).map((item) => result(
      'candidate', item.id, [item.first_name, item.last_name].filter(Boolean).join(' '), [item.location, ...(item.skills || []).slice(0, 3)].filter(Boolean).join(' · '),
      buildWizmatchEntityHref('candidate', item.id),
    )),
    ...(delivery?.items || []).filter((item) => containsQuery(query, item.first_name, item.last_name, item.requirement_title, item.company_name, item.status)).slice(0, 5).map((item) => result(
      'submission', item.id, [item.first_name, item.last_name].filter(Boolean).join(' '), [item.requirement_title, item.company_name, item.status].filter(Boolean).join(' · '),
      buildWizmatchEntityHref('submission', item.id),
    )),
  ];
}

export default function GlobalSearch({ open = true, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const timerRef = useRef(null);
  const requestRef = useRef(0);
  const navigate = useNavigate();
  const isWizmatch = String(getTenantSlug()).toLowerCase() === 'wizmatch';

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement;
      setQuery('');
      setResults([]);
      setError('');
      setWarning('');
      setSelectedIdx(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => {
        clearTimeout(timer);
        const previous = previouslyFocusedRef.current;
        if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
      };
    }
    return undefined;
  }, [open]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    invalidateGlobalSearchRequest(requestRef);
  }, []);

  const runSearch = useCallback(async (rawQuery) => {
    const q = rawQuery.trim();
    if (q.length < 2) {
      invalidateGlobalSearchRequest(requestRef);
      setResults([]);
      setError('');
      setWarning('');
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    setWarning('');
    try {
      if (isWizmatch) {
        const responses = await Promise.allSettled([
          apiFetch(`/api/wizmatch/staffing/companies?search=${encodeURIComponent(q)}`),
          apiFetch(`/api/wizmatch/staffing/hiring-contacts?search=${encodeURIComponent(q)}`),
          apiFetch('/api/wizmatch/requirements?limit=200'),
          apiFetch('/api/wizmatch/candidates?limit=200'),
          apiFetch('/api/wizmatch/staffing/delivery-board'),
        ]);
        if (requestId !== requestRef.current) return;
        const failures = responses.filter((response) => response.status === 'rejected');
        if (failures.length === responses.length) throw failures[0].reason;
        setResults(normalizeWizmatchResults(q, responses));
        if (failures.length) setWarning('Some record types could not be searched. The results below are partial.');
      } else {
        const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (requestId !== requestRef.current) return;
        setResults((data?.results || []).map((item) => item.type === 'contact'
          ? result('crm_contact', item.id, item.name, item.subtitle, productPath(`/contacts?id=${item.id}`))
          : result('deal', item.id, item.name, item.subtitle, productPath(`/pipeline?deal=${item.id}`))));
      }
      setSelectedIdx(0);
    } catch (searchError) {
      if (requestId !== requestRef.current) return;
      setResults([]);
      setError(searchError?.message || 'Search is unavailable. No results were substituted.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [isWizmatch]);

  const scheduleSearch = useCallback((value) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < 2) {
      runSearch(value);
      return;
    }
    timerRef.current = setTimeout(() => runSearch(value), 300);
  }, [runSearch]);

  function go(item) {
    if (!item) return;
    navigate(item.href);
    onClose?.();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') { onClose?.(); return; }
    if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR) || [];
      const target = trappedDialogFocusTarget(focusable, document.activeElement, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      }
      return;
    }
    if (event.target !== inputRef.current) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIdx((index) => Math.min(index + 1, Math.max(results.length - 1, 0))); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIdx((index) => Math.max(index - 1, 0)); }
    if (event.key === 'Enter' && results[selectedIdx]) { event.preventDefault(); go(results[selectedIdx]); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label="Global search">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]" />
      <div ref={dialogRef} className="relative w-[620px] max-w-[94vw] overflow-hidden rounded-xl bg-white shadow-modal animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]" onClick={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 border-b border-neutral-100 px-5 py-4">
          <Search className="h-5 w-5 text-neutral-600" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); scheduleSearch(event.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={isWizmatch ? 'Search companies, hiring contacts, roles, candidates…' : 'Search contacts and deals…'}
            aria-label={isWizmatch ? 'Search Wizmatch records' : 'Search CRM records'}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={!loading && !error && results.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={!loading && !error && results[selectedIdx] ? `global-search-option-${selectedIdx}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-base text-neutral-900 outline-none placeholder:text-neutral-600"
          />
          <kbd className="hidden rounded border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-600 sm:inline-flex">ESC</kbd>
          <button type="button" onClick={onClose} aria-label="Close search" className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-300"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[440px] overflow-y-auto">
          {loading && <div className="space-y-3 px-5 py-6">{[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-neutral-50" />)}</div>}

          {!loading && error && (
            <div role="alert" className="px-5 py-8 text-center">
              <p className="text-sm font-semibold text-danger-700">Search could not be completed</p>
              <p className="mt-1 text-xs text-neutral-500">{error}</p>
              <button type="button" onClick={() => runSearch(query)} className="mt-3 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700">Retry</button>
            </div>
          )}

          {!loading && !error && warning && <div role="status" className="border-b border-warning-100 bg-warning-50 px-5 py-2 text-xs text-warning-800">{warning}</div>}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-neutral-600">No records found for “{query}”</div>
          )}

          {!loading && !error && results.length > 0 && (
            <div id="global-search-results" className="py-2" role="listbox" aria-label="Search results">
              {TYPE_ORDER.map((type) => {
                const items = results.filter((item) => item.type === type);
                if (!items.length) return null;
                const meta = RESULT_META[type];
                const Icon = meta.icon;
                return (
                  <div key={type}>
                    <p className="px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-600">{meta.label}</p>
                    {items.map((item) => {
                      const index = results.indexOf(item);
                      return (
                        <button
                          key={`${item.type}:${item.id}`}
                          id={`global-search-option-${index}`}
                          type="button"
                          role="option"
                          aria-selected={index === selectedIdx}
                          onMouseEnter={() => setSelectedIdx(index)}
                          onClick={() => go(item)}
                          className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${index === selectedIdx ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}
                        >
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}`}><Icon className="h-4 w-4" /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-neutral-900">{item.name}</span>
                            <span className="block truncate text-xs text-neutral-600">{item.subtitle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && query.trim().length < 2 && (
            <div className="px-5 py-8 text-center text-sm text-neutral-600">
              Type at least 2 characters. Use <span className="font-semibold text-neutral-600">⌘K</span> to jump to a page.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
