import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ContactSlideIn from '../components/ContactSlideIn.jsx';
import AddUpdateOpportunityModal from '../components/AddUpdateOpportunityModal.jsx';
import { apiFetch } from '../lib/api.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function stringToColor(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#6366F1','#14B8A6'];
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(firstName = '', lastName = '') {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase() || '?';
}

function relativeTime(dateStr) {
  if (!dateStr) return '—';
  const ms = Date.now() - new Date(dateStr);
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);
  if (minutes < 2) return 'just now';
  if (hours < 1) return `${minutes}m ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatPhone(phone) {
  if (!phone) return '—';
  const p = String(phone).replace(/\D/g, '');
  if (p.startsWith('91') && p.length === 12) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  return phone;
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Smart list presets
const SMART_LISTS = [
  { id: 'all', label: 'All', filters: {} },
  { id: 'hot', label: 'Hot Leads', filters: { status: 'qualified' } },
  { id: 'uncontacted', label: 'Uncontacted', filters: { status: 'lead' } },
  { id: 'ecom', label: 'Ecom Buyers', filters: { source: 'checkout' } },
  { id: 'consulting', label: 'Consulting Leads', filters: { source: 'calcom' } },
  { id: 'discover', label: 'Discovery', filters: { source: 'discovery' } },
  { id: 'outreach', label: 'Cold Outreach', filters: { source: 'outreach' } },
];

const LIMIT_OPTIONS = [20, 50, 100];

// ─────────────────────────────────────────────────────────────────────────────
// Add Contact Modal
// ─────────────────────────────────────────────────────────────────────────────
function AddContactModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    companyName: '', source: '', assignedTo: '', tags: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.firstName.trim()) { setError('First name is required'); return; }
    setSaving(true);
    setError('');

    const tagArr = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const contact = await apiFetch('/contacts', {
      method: 'POST',
      body: JSON.stringify({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        source: form.source || undefined,
        assignedTo: form.assignedTo || undefined,
        tags: tagArr.length ? tagArr : undefined,
      }),
    });

    if (contact?.id) {
      // Add channels
      const channelPs = [];
      if (form.phone.trim()) {
        channelPs.push(apiFetch(`/contacts/${contact.id}/channels`, {
          method: 'POST',
          body: JSON.stringify({ channelType: 'whatsapp', channelValue: form.phone.trim(), isPrimary: true }),
        }));
      }
      if (form.email.trim()) {
        channelPs.push(apiFetch(`/contacts/${contact.id}/channels`, {
          method: 'POST',
          body: JSON.stringify({ channelType: 'email', channelValue: form.email.trim(), isPrimary: true }),
        }));
      }
      await Promise.all(channelPs);
      onCreated?.();
    } else {
      setError('Failed to create contact. Try again.');
    }
    setSaving(false);
  }

  const field = (key, label, type = 'text', required = false) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        required={required}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add Contact</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {field('firstName', 'First Name', 'text', true)}
            {field('lastName', 'Last Name')}
          </div>
          {field('phone', 'Phone / WhatsApp')}
          {field('email', 'Email', 'email')}
          {field('companyName', 'Company Name')}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select…</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="organic">Organic</option>
                <option value="referral">Referral</option>
                <option value="calcom">Cal.com</option>
                <option value="checkout">Checkout</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Assigned To</label>
              <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Unassigned</option>
                <option value="jatin">Jatin</option>
                <option value="saksham">Saksham</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tags <span className="text-slate-400 font-normal">(comma-separated)</span></label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="hot-lead, d2c, …"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Adding…' : 'Add Contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Action Bar
// ─────────────────────────────────────────────────────────────────────────────
function BulkActionBar({ selectedIds, selectedContacts, total, onSelectAll, onClear, onDone, onOpenOpportunity }) {
  const count = selectedIds.size;
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagMode, setTagMode] = useState('add');
  const [showSeqPanel, setShowSeqPanel] = useState(false);
  const [seqName, setSeqName] = useState('');
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignTo, setAssignTo] = useState('jatin');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Close more menu on outside click
  useEffect(() => {
    function handler(e) { if (moreRef.current && !moreRef.current.contains(e.target)) setShowMoreMenu(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function closeAllPanels() {
    setShowTagPanel(false);
    setShowSeqPanel(false);
    setShowAssignPanel(false);
    setShowMoreMenu(false);
  }

  async function handleExport() {
    setBusy(true);
    const res = await fetch('/contacts/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('ge_crm_token')}`,
      },
      body: JSON.stringify({ contactIds: [...selectedIds] }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contacts.csv';
      a.click();
      URL.revokeObjectURL(url);
      setToast(`Exported ${count} contacts`);
    }
    setBusy(false);
  }

  function handleImportCSV() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const csvText = await file.text();
        const data = await apiFetch('/contacts/import', {
          method: 'POST',
          body: JSON.stringify({ csv: csvText }),
        });
        setToast(`Imported ${data.imported} contact${data.imported !== 1 ? 's' : ''}${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`);
        load();
      } catch (err) {
        setToast(`Import failed: ${err.message}`);
      }
      setBusy(false);
    };
    input.click();
  }

  async function handleBulkTag() {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    if (!tags.length) return;
    setBusy(true);
    await apiFetch('/contacts/bulk-tag', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds], tags, mode: tagMode }),
    });
    setBusy(false);
    setTagInput('');
    setShowTagPanel(false);
    setToast(`Tags ${tagMode === 'add' ? 'added' : 'removed'} for ${count} contacts`);
    onDone?.();
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${count} contact${count > 1 ? 's' : ''}? This will mark them as deleted.`)) return;
    setBusy(true);
    await apiFetch('/contacts/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds] }),
    });
    setBusy(false);
    setToast(`${count} contact${count > 1 ? 's' : ''} deleted`);
    onDone?.();
  }

  async function handleBulkSequence() {
    if (!seqName.trim()) return;
    setBusy(true);
    const result = await apiFetch('/contacts/bulk-sequence', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds], sequenceName: seqName }),
    });
    setBusy(false);
    if (result?.enrolled !== undefined) {
      setToast(`Enrolled ${result.enrolled} contacts (${result.skipped} skipped)`);
    } else {
      setToast(result?.error ?? 'Sequence error');
    }
    setSeqName('');
    setShowSeqPanel(false);
    onDone?.();
  }

  async function handleAssign() {
    setBusy(true);
    await apiFetch('/contacts/bulk-assign', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds], assignedTo: assignTo }),
    });
    setBusy(false);
    setShowAssignPanel(false);
    closeAllPanels();
    setToast(`Assigned ${count} contacts to ${assignTo}`);
    onDone?.();
  }

  const btnBase = 'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap';

  return (
    <div className="fixed top-0 left-0 right-0 z-40 flex flex-col items-stretch pointer-events-none">
      {/* Sub panels */}
      <div className="pointer-events-auto">
        {/* Tag panel */}
        {showTagPanel && (
          <div className="bg-white border-b border-slate-200 shadow-md px-6 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              <button onClick={() => setTagMode('add')} className={`px-3 py-1.5 ${tagMode === 'add' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Add</button>
              <button onClick={() => setTagMode('remove')} className={`px-3 py-1.5 border-l border-slate-200 ${tagMode === 'remove' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Remove</button>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="Tags (comma-separated)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBulkTag()}
              className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={handleBulkTag} disabled={busy || !tagInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">
              Apply
            </button>
            <button onClick={() => setShowTagPanel(false)} className="text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
          </div>
        )}

        {/* Sequence panel */}
        {showSeqPanel && (
          <div className="bg-white border-b border-slate-200 shadow-md px-6 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-slate-700">Sequence name:</span>
            <input
              autoFocus
              type="text"
              placeholder="e.g. D2C Nurture Sequence"
              value={seqName}
              onChange={(e) => setSeqName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBulkSequence()}
              className="flex-1 min-w-[240px] border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={handleBulkSequence} disabled={busy || !seqName.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">
              Enrol
            </button>
            <button onClick={() => setShowSeqPanel(false)} className="text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
          </div>
        )}

        {/* Assign panel */}
        {showAssignPanel && (
          <div className="bg-white border-b border-slate-200 shadow-md px-6 py-3 flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">Assign to:</span>
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="jatin">Jatin</option>
              <option value="saksham">Saksham</option>
            </select>
            <button onClick={handleAssign} disabled={busy}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">
              Assign
            </button>
            <button onClick={() => setShowAssignPanel(false)} className="text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
          </div>
        )}
      </div>

      {/* Main bar */}
      <div className="bg-slate-900 text-white shadow-xl pointer-events-auto">
        <div className="max-w-full px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-slate-200 whitespace-nowrap">
            {count} Contact{count > 1 ? 's' : ''} Selected
          </span>
          {count < total && (
            <button onClick={onSelectAll} className="text-xs text-blue-400 hover:text-blue-300 underline whitespace-nowrap">
              Select all {total.toLocaleString()}
            </button>
          )}
          <div className="w-px h-4 bg-slate-600 hidden sm:block" />

          {/* Action buttons */}
          <button onClick={handleImportCSV} disabled={busy} className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4 4m0 0l4-4m-4 4V4"/></svg>
              Import
            </span>
          </button>
          <button onClick={handleExport} disabled={busy} className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Export
            </span>
          </button>
          <button onClick={() => { closeAllPanels(); setShowSeqPanel(true); }} className={`${btnBase} bg-emerald-700 hover:bg-emerald-600 text-white`}>
            Trigger automation
          </button>
          <button
            onClick={() => setToast('Email blast coming soon — use Brevo for bulk sends')}
            className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}
          >
            Send email
          </button>
          <button onClick={() => { closeAllPanels(); setTagMode('add'); setShowTagPanel(true); }} className={`${btnBase} bg-violet-700 hover:bg-violet-600 text-white`}>
            Add tags
          </button>
          <button onClick={handleBulkDelete} disabled={busy} className={`${btnBase} bg-red-700 hover:bg-red-600 text-white`}>
            Delete
          </button>

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button onClick={() => { closeAllPanels(); setShowMoreMenu(!showMoreMenu); }}
              className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-1`}>
              More
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </button>
            {showMoreMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl py-1 min-w-[200px] z-50">
                <button onClick={() => { setToast('WhatsApp blast via Meta API — use Automations for bulk sends'); setShowMoreMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.5 2C6.262 2 2 6.262 2 11.5c0 1.827.497 3.538 1.362 5.005L2 22l5.638-1.356A9.46 9.46 0 0011.5 21C16.738 21 21 16.738 21 11.5S16.738 2 11.5 2z"/></svg>
                  Send WhatsApp
                </button>
                <button onClick={() => { closeAllPanels(); setTagMode('remove'); setShowTagPanel(true); setShowMoreMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  Remove tags
                </button>
                <button onClick={() => { closeAllPanels(); setShowAssignPanel(true); setShowMoreMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  Assign to…
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button onClick={() => { setShowMoreMenu(false); onOpenOpportunity?.(); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-blue-700 hover:bg-blue-50 font-medium">
                  Move to pipeline
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-slate-600 ml-auto hidden sm:block" />
          <button onClick={onClear} className="text-sm text-slate-400 hover:text-white transition-colors ml-auto sm:ml-0">
            Clear selection
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-auto fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Contacts Page
// ─────────────────────────────────────────────────────────────────────────────
export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Filters
  const [activeList, setActiveList] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [filterSource, setFilterSource] = useState('');
  const [filterAssignedTo, setFilterAssignedTo] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Modals
  const [showAddContact, setShowAddContact] = useState(false);
  const [showOpportunityModal, setShowOpportunityModal] = useState(false);

  // Active filter chips
  const activeFilters = [
    filterSource && { key: 'source', label: `Source: ${filterSource}`, clear: () => setFilterSource('') },
    filterAssignedTo && { key: 'assignedTo', label: `Assigned: ${filterAssignedTo}`, clear: () => setFilterAssignedTo('') },
    filterDateFrom && { key: 'dateFrom', label: `From: ${filterDateFrom}`, clear: () => setFilterDateFrom('') },
  ].filter(Boolean);

  const smartList = SMART_LISTS.find((l) => l.id === activeList) ?? SMART_LISTS[0];

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String((page - 1) * limit),
    });
    if (search) params.set('search', search);
    if (filterSource) params.set('source', filterSource);
    if (filterAssignedTo) params.set('assignedTo', filterAssignedTo);
    if (filterDateFrom) params.set('dateFrom', filterDateFrom);
    // Apply smart list filters
    Object.entries(smartList.filters).forEach(([k, v]) => params.set(k, v));

    try {
      const data = await apiFetch(`/contacts?${params}`);
      if (data) {
        setContacts(data.contacts ?? []);
        setTotal(data.total ?? 0);
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [search, filterSource, filterAssignedTo, filterDateFrom, page, limit, activeList]);

  useEffect(() => { setPage(1); }, [search, filterSource, filterAssignedTo, filterDateFrom, activeList]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);

  // Smart list counts — single query instead of 4 separate calls
  const [listCounts, setListCounts] = useState({});
  useEffect(() => {
    apiFetch('/contacts/counts')
      .then((d) => {
        if (d) setListCounts({ hot: +d.hot, uncontacted: +d.uncontacted, ecom: +d.ecom, consulting: +d.consulting, discover: +d.discover, outreach: +d.outreach });
      })
      .catch(() => {});
  }, []);

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleAll(e) {
    if (e.target.checked) setSelectedIds(new Set(contacts.map((c) => c.id)));
    else setSelectedIds(new Set());
  }

  function selectAll() {
    // For select-all-across-pages we just mark all on current + note total
    // Full select-all would require fetching all IDs; we do page-level here
    setSelectedIds(new Set(contacts.map((c) => c.id)));
  }

  const selectedContactsData = contacts.filter((c) => selectedIds.has(c.id));
  const allOnPageSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />

      <main className={`flex-1 flex flex-col min-w-0 ${selectedIds.size > 0 ? 'pt-[88px]' : ''}`}>
        {/* Header */}
        <div className="bg-white border-b px-8 py-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">Contacts</h1>
            <span className="bg-slate-100 text-slate-600 text-sm font-semibold px-2.5 py-0.5 rounded-full">
              {total.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer">
              <span className="sr-only">Import CSV</span>
              <div className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                Import
              </div>
              <input type="file" accept=".csv" className="hidden" onChange={() => alert('CSV import coming soon')} />
            </label>
            <button
              onClick={() => setShowAddContact(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
              Add Contact
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors" title="Settings">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>

        {/* Smart List tabs */}
        <div className="bg-white border-b px-8">
          <div className="flex items-center gap-0 overflow-x-auto">
            {SMART_LISTS.map((list) => (
              <button
                key={list.id}
                onClick={() => { setActiveList(list.id); setSelectedIds(new Set()); }}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeList === list.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {list.label}
                {list.id !== 'all' && listCounts[list.id] > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeList === list.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {listCounts[list.id]}
                  </span>
                )}
                {list.id === 'all' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeList === list.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {total.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => alert('Smart lists coming soon')}
              className="flex items-center gap-1 px-4 py-3 text-sm text-slate-400 hover:text-slate-600 whitespace-nowrap border-b-2 border-transparent"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
              Add smart list
            </button>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="bg-white border-b px-8 py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="Search name, phone, company…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Source</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="organic">Organic</option>
            <option value="calcom">Cal.com</option>
            <option value="checkout">Checkout / SLO</option>
            <option value="referral">Referral</option>
            <option value="discovery">Discovery</option>
            <option value="outreach">Cold Outreach</option>
          </select>

          <select value={filterAssignedTo} onChange={(e) => { setFilterAssignedTo(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Assigned To</option>
            <option value="jatin">Jatin</option>
            <option value="saksham">Saksham</option>
          </select>

          <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-600"
            title="Added from date"
          />

          {activeFilters.length > 0 && (
            <button onClick={() => { setFilterSource(''); setFilterAssignedTo(''); setFilterDateFrom(''); setPage(1); }}
              className="text-sm text-red-500 hover:text-red-700 font-medium">
              Clear all filters
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="bg-white border-b px-8 py-2 flex gap-2 flex-wrap">
            {activeFilters.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full border border-blue-200">
                {f.label}
                <button onClick={f.clear} className="text-blue-400 hover:text-blue-700 leading-none">×</button>
              </span>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 px-8 py-5">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Contact</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide hidden sm:table-cell">Phone</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide hidden md:table-cell">Email</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide hidden lg:table-cell">Business</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Last Activity</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide hidden xl:table-cell">Tags</th>
                </tr>
              </thead>
              <tbody>
                {loadError ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center">
                    <p className="text-red-600 text-sm mb-2">Could not load contacts.</p>
                    <button onClick={load} className="text-sm text-sky-600 hover:underline">Retry</button>
                  </td></tr>
                ) : loading ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center">
                    <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-400 text-sm mt-2">Loading contacts…</p>
                  </td></tr>
                ) : contacts.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">No contacts found</td></tr>
                ) : contacts.map((c) => {
                  const isSelected = selectedIds.has(c.id);
                  const initials = getInitials(c.firstName, c.lastName ?? '');
                  const avatarColor = stringToColor(c.id);
                  const lastActivity = c.lastActivityAt || c.lastContactedAt || c.createdAt;

                  return (
                    <tr key={c.id}
                      className={`border-b border-slate-100 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(c.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      </td>

                      {/* Contact name + avatar */}
                      <td className="px-4 py-3 cursor-pointer" onClick={() => setSelectedContact(c)}>
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{ background: avatarColor }}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 leading-tight truncate">
                              {c.firstName} {c.lastName ?? ''}
                            </p>
                            {c.doNotContact && (
                              <p className="text-xs text-red-500 font-medium">DNC</p>
                            )}
                            {c.assignedTo && (
                              <p className="text-xs text-slate-400">{c.assignedTo}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3 text-slate-600 cursor-pointer hidden sm:table-cell" onClick={() => setSelectedContact(c)}>
                        <div className="flex items-center gap-1.5">
                          {c.phone ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                              <span className="text-xs">{formatPhone(c.phone)}</span>
                            </>
                          ) : <span className="text-slate-300">—</span>}
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3 text-slate-600 cursor-pointer hidden md:table-cell" onClick={() => setSelectedContact(c)}>
                        <div className="flex items-center gap-1.5">
                          {c.email ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                              <span className="text-xs truncate max-w-[160px]">{c.email}</span>
                            </>
                          ) : <span className="text-slate-300">—</span>}
                        </div>
                      </td>

                      {/* Business */}
                      <td className="px-4 py-3 text-slate-600 text-xs cursor-pointer hidden lg:table-cell" onClick={() => setSelectedContact(c)}>
                        {c.companyName || <span className="text-slate-300">—</span>}
                      </td>

                      {/* Last activity */}
                      <td className="px-4 py-3 text-slate-500 text-xs cursor-pointer" onClick={() => setSelectedContact(c)}>
                        {relativeTime(lastActivity)}
                      </td>

                      {/* Tags */}
                      <td className="px-4 py-3 cursor-pointer hidden xl:table-cell" onClick={() => setSelectedContact(c)}>
                        <div className="flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 2).map((tag) => (
                            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                              {tag}
                            </span>
                          ))}
                          {(c.tags?.length ?? 0) > 2 && (
                            <span className="text-xs text-slate-400">+{c.tags.length - 2}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center gap-3">
                <p className="text-xs text-slate-500">
                  {total === 0 ? '0 results' : `Page ${page} of ${totalPages} — ${total.toLocaleString()} total`}
                </p>
                <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none">
                  {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-white bg-white transition-colors shadow-sm">
                  ← Prev
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-white bg-white transition-colors shadow-sm">
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          selectedContacts={selectedContactsData}
          total={total}
          onSelectAll={selectAll}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => { load(); setSelectedIds(new Set()); }}
          onOpenOpportunity={() => setShowOpportunityModal(true)}
        />
      )}

      {/* Contact slide-in */}
      {selectedContact && (
        <ContactSlideIn
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdated={() => { load(); setSelectedContact(null); }}
        />
      )}

      {/* Add Contact modal */}
      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onCreated={() => { setShowAddContact(false); load(); }}
        />
      )}

      {/* Add/Update Opportunity modal */}
      {showOpportunityModal && (
        <AddUpdateOpportunityModal
          contactIds={[...selectedIds]}
          contacts={selectedContactsData}
          onClose={() => setShowOpportunityModal(false)}
          onDone={() => { setShowOpportunityModal(false); setSelectedIds(new Set()); load(); }}
        />
      )}
    </div>
  );
}
