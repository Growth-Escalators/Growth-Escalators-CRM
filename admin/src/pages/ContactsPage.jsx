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
// Resizable column widths (persisted in localStorage)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_COL_WIDTHS = {
  contact: 200,
  phone: 160,
  email: 220,
  business: 140,
  activity: 110,
  tags: 140,
};
const COL_WIDTH_KEY = 'ge_contacts_col_widths_v1';

function useColumnWidths() {
  const [widths, setWidths] = useState(() => {
    try {
      const saved = localStorage.getItem(COL_WIDTH_KEY);
      return saved ? { ...DEFAULT_COL_WIDTHS, ...JSON.parse(saved) } : DEFAULT_COL_WIDTHS;
    } catch {
      return DEFAULT_COL_WIDTHS;
    }
  });
  const setWidth = useCallback((col, w) => {
    setWidths((prev) => {
      const next = { ...prev, [col]: Math.max(80, Math.min(600, Math.round(w))) };
      try { localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(next)); } catch { /* quota full — ignore */ }
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setWidths(DEFAULT_COL_WIDTHS);
    try { localStorage.removeItem(COL_WIDTH_KEY); } catch { /* ignore */ }
  }, []);
  return { widths, setWidth, reset };
}

function ResizeHandle({ startWidth, onResize }) {
  function onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const w0 = startWidth;
    function move(ev) { onResize(w0 + (ev.clientX - startX)); }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    }
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 transition-colors"
      title="Drag to resize"
    />
  );
}

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
    const contact = await apiFetch('/api/contacts', {
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
        channelPs.push(apiFetch(`/api/contacts/${contact.id}/channels`, {
          method: 'POST',
          body: JSON.stringify({ channelType: 'whatsapp', channelValue: form.phone.trim(), isPrimary: true }),
        }));
      }
      if (form.email.trim()) {
        channelPs.push(apiFetch(`/api/contacts/${contact.id}/channels`, {
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
function BulkActionBar({ selectedIds, selectedContacts, total, onSelectAll, onClear, onDone, onOpenOpportunity, load }) {
  const count = selectedIds.size;
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagMode, setTagMode] = useState('add');
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [availableTags, setAvailableTags] = useState([]);
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
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
    setShowEmailPanel(false);
    setShowAssignPanel(false);
    setShowMoreMenu(false);
  }

  async function handleExport() {
    setBusy(true);
    const res = await fetch('/api/contacts/export', {
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
        const data = await apiFetch('/api/contacts/import', {
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
    // Combine checkbox-selected tags + any text input tags
    const textTags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    const allTags = [...new Set([...selectedTags, ...textTags])];
    if (!allTags.length) return;
    setBusy(true);
    await apiFetch('/api/contacts/bulk-tag', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds], tags: allTags, mode: tagMode }),
    });
    setBusy(false);
    setTagInput('');
    setSelectedTags(new Set());
    setShowTagPanel(false);
    setToast(`Tags ${tagMode === 'add' ? 'added to' : 'removed from'} ${count} contacts`);
    onDone?.();
  }

  async function handleBulkEmail() {
    if (!selectedTemplateId) return;
    setBusy(true);
    try {
      const result = await apiFetch('/api/contacts/bulk-email', {
        method: 'POST',
        body: JSON.stringify({ contactIds: [...selectedIds], templateId: selectedTemplateId }),
      });
      if (result?.sent !== undefined) {
        setToast(`Sent to ${result.sent} contacts${result.skipped ? ` (${result.skipped} without email)` : ''}${result.failed ? ` — ${result.failed} failed` : ''}`);
      } else {
        setToast(result?.error ?? 'Email send failed');
      }
    } catch (err) {
      setToast(`Email failed: ${err.message}`);
    }
    setBusy(false);
    setShowEmailPanel(false);
    setSelectedTemplateId('');
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${count} contact${count > 1 ? 's' : ''}? This will mark them as deleted.`)) return;
    setBusy(true);
    await apiFetch('/api/contacts/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ contactIds: [...selectedIds] }),
    });
    setBusy(false);
    setToast(`${count} contact${count > 1 ? 's' : ''} deleted`);
    onDone?.();
  }

  async function handleAssign() {
    setBusy(true);
    await apiFetch('/api/contacts/bulk-assign', {
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
        {/* Tag panel — checkbox picker + text input for new tags */}
        {showTagPanel && (
          <div className="bg-white border-b border-slate-200 shadow-md px-6 py-3 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                <button onClick={() => setTagMode('add')} className={`px-3 py-1.5 ${tagMode === 'add' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Add</button>
                <button onClick={() => setTagMode('remove')} className={`px-3 py-1.5 border-l border-slate-200 ${tagMode === 'remove' ? 'bg-red-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Remove</button>
              </div>
              <span className="text-sm text-slate-500">Select tags or type new ones below</span>
            </div>
            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto">
                {availableTags.map((tag) => (
                  <label key={tag} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${selectedTags.has(tag) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    <input
                      type="checkbox"
                      checked={selectedTags.has(tag)}
                      onChange={(e) => {
                        const next = new Set(selectedTags);
                        if (e.target.checked) next.add(tag); else next.delete(tag);
                        setSelectedTags(next);
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-300"
                    />
                    {tag}
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Or type new tags (comma-separated)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBulkTag()}
                className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={handleBulkTag} disabled={busy || (!tagInput.trim() && selectedTags.size === 0)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">
                Apply
              </button>
              <button onClick={() => { setShowTagPanel(false); setSelectedTags(new Set()); }} className="text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Email template panel */}
        {showEmailPanel && (
          <div className="bg-white border-b border-slate-200 shadow-md px-6 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-slate-700">Template:</span>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="flex-1 min-w-[240px] border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select an email template…</option>
              {emailTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.displayName || t.name} — {t.subject}</option>
              ))}
            </select>
            <button onClick={handleBulkEmail} disabled={busy || !selectedTemplateId}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">
              Send to {count} contact{count > 1 ? 's' : ''}
            </button>
            <button onClick={() => setShowEmailPanel(false)} className="text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
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
          <button onClick={() => {
            closeAllPanels();
            setShowEmailPanel(true);
            if (emailTemplates.length === 0) {
              apiFetch('/api/email-templates').then(d => { if (Array.isArray(d)) setEmailTemplates(d); }).catch(() => {});
            }
          }} className={`${btnBase} bg-blue-700 hover:bg-blue-600 text-white`}>
            Send email
          </button>
          <button onClick={() => {
            closeAllPanels(); setTagMode('add'); setShowTagPanel(true);
            if (availableTags.length === 0) {
              apiFetch('/api/contacts/tags').then(d => { if (Array.isArray(d)) setAvailableTags(d); }).catch(() => {});
            }
          }} className={`${btnBase} bg-violet-700 hover:bg-violet-600 text-white`}>
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
                  Add to pipeline
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
  const { widths: colWidths, setWidth: setColWidth, reset: resetColWidths } = useColumnWidths();

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
    // Exclude discovery/outreach from "All" tab — they have dedicated tabs
    if (activeList === 'all' && !filterSource) {
      params.set('excludeSources', 'discovery,outreach,cold_outreach');
    }

    try {
      const data = await apiFetch(`/api/contacts?${params}`);
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
    apiFetch('/api/contacts/counts')
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
            <button
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.csv';
                input.onchange = async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const csvText = await file.text();
                    const data = await apiFetch('/api/contacts/import', {
                      method: 'POST',
                      body: JSON.stringify({ csv: csvText }),
                    });
                    alert(`Imported ${data.imported} contact${data.imported !== 1 ? 's' : ''}${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`);
                    load();
                  } catch (err) {
                    alert(`Import failed: ${err.message}`);
                  }
                };
                input.click();
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              Import
            </button>
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
            {/* Smart list creation removed — preset tabs cover current needs */}
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

          <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(1); setActiveList('all'); }}
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
            <div className="flex items-center justify-end px-3 py-1.5 border-b border-slate-100 bg-slate-50/60">
              <button onClick={resetColWidths} className="text-[10px] text-slate-400 hover:text-slate-700 font-medium">
                Reset column widths
              </button>
            </div>
            <div className="overflow-x-auto">
            <table className="text-sm table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: colWidths.contact }} />
                <col style={{ width: colWidths.phone }} />
                <col style={{ width: colWidths.email }} />
                <col style={{ width: colWidths.business }} />
                <col style={{ width: colWidths.activity }} />
                <col style={{ width: colWidths.tags }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left select-none">
                  <th className="px-2 py-2">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  </th>
                  <th className="relative group px-3 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">
                    Contact
                    <ResizeHandle startWidth={colWidths.contact} onResize={(w) => setColWidth('contact', w)} />
                  </th>
                  <th className="relative group px-3 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">
                    Phone
                    <ResizeHandle startWidth={colWidths.phone} onResize={(w) => setColWidth('phone', w)} />
                  </th>
                  <th className="relative group px-3 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">
                    Email
                    <ResizeHandle startWidth={colWidths.email} onResize={(w) => setColWidth('email', w)} />
                  </th>
                  <th className="relative group px-3 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">
                    Business
                    <ResizeHandle startWidth={colWidths.business} onResize={(w) => setColWidth('business', w)} />
                  </th>
                  <th className="relative group px-3 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">
                    Activity
                    <ResizeHandle startWidth={colWidths.activity} onResize={(w) => setColWidth('activity', w)} />
                  </th>
                  <th className="relative group px-3 py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">
                    Tags
                  </th>
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
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(c.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      </td>

                      {/* Contact name + avatar */}
                      <td className="px-3 py-1.5 cursor-pointer overflow-hidden" onClick={() => setSelectedContact(c)}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                            style={{ background: avatarColor }}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-900 leading-tight truncate">
                              {c.firstName} {c.lastName ?? ''}
                            </p>
                            {(c.doNotContact || c.assignedTo) && (
                              <p className="text-[10px] text-slate-400 truncate leading-tight">
                                {c.doNotContact && <span className="text-red-500 font-medium">DNC </span>}
                                {c.assignedTo}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-3 py-1.5 text-slate-600 cursor-pointer overflow-hidden" onClick={() => setSelectedContact(c)}>
                        {c.phone ? (
                          <span className="text-xs truncate block">{formatPhone(c.phone)}</span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>

                      {/* Email */}
                      <td className="px-3 py-1.5 text-slate-600 cursor-pointer overflow-hidden" onClick={() => setSelectedContact(c)}>
                        {c.email ? (
                          <span className="text-xs truncate block" title={c.email}>{c.email}</span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>

                      {/* Business */}
                      <td className="px-3 py-1.5 text-slate-600 text-xs cursor-pointer overflow-hidden" onClick={() => setSelectedContact(c)}>
                        {c.companyName ? (
                          <span className="truncate block" title={c.companyName}>{c.companyName}</span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>

                      {/* Last activity */}
                      <td className="px-3 py-1.5 text-slate-500 text-xs cursor-pointer overflow-hidden" onClick={() => setSelectedContact(c)}>
                        <span className="truncate block">{relativeTime(lastActivity)}</span>
                      </td>

                      {/* Tags */}
                      <td className="px-3 py-1.5 cursor-pointer overflow-hidden" onClick={() => setSelectedContact(c)}>
                        <div className="flex flex-wrap gap-1">
                          {(c.tags ?? []).slice(0, 2).map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium truncate max-w-[80px]">
                              {tag}
                            </span>
                          ))}
                          {(c.tags?.length ?? 0) > 2 && (
                            <span className="text-[10px] text-slate-400">+{c.tags.length - 2}</span>
                          )}
                          {c.activeDeal && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-200 truncate max-w-[120px]">
                              {c.activeDeal.pipelineName} · {c.activeDeal.stage}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

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
          load={load}
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
          onDone={() => { setShowOpportunityModal(false); setSelectedIds(new Set()); setPage(1); load(); }}
        />
      )}
    </div>
  );
}
