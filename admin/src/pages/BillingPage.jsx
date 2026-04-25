import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

function safeISOString(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '1970-01-01T00:00:00.000Z';
  return date.toISOString();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(paise) {
  if (!paise && paise !== 0) return '—';
  return '₹' + (paise / 100).toLocaleString('en-IN');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysOverdue(dueDate) {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  return days > 0 ? days : 0;
}

const STATUS_BADGE = {
  draft:           'bg-slate-100 text-slate-600',
  sent:            'bg-blue-100 text-blue-700',
  paid:            'bg-green-100 text-green-700',
  partially_paid:  'bg-amber-100 text-amber-700',
  overdue:         'bg-red-100 text-red-700',
  cancelled:       'bg-slate-100 text-slate-400 line-through',
};

const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman & Diu' }, { code: '26', name: 'Dadra & Nagar Haveli' },
  { code: '27', name: 'Maharashtra' }, { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' }, { code: '35', name: 'Andaman & Nicobar' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

// ── Services multi-select ─────────────────────────────────────────────────────
const SERVICE_PRESETS = [
  'SEO', 'Meta Ads', 'Google Ads', 'Social Media', 'Performance Marketing',
  'Website', 'Content', 'Branding', 'Email Marketing', 'WhatsApp', 'CRM', 'Consulting',
];

function ServicesPicker({ value = [], onChange }) {
  const [custom, setCustom] = useState('');
  const selected = Array.isArray(value) ? value : [];

  function toggle(svc) {
    const next = selected.includes(svc) ? selected.filter(s => s !== svc) : [...selected, svc];
    onChange(next);
  }

  function addCustom() {
    const v = custom.trim();
    if (!v) return;
    if (!selected.includes(v)) onChange([...selected, v]);
    setCustom('');
  }

  const customSelected = selected.filter(s => !SERVICE_PRESETS.includes(s));

  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">Services</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {SERVICE_PRESETS.map(svc => {
          const active = selected.includes(svc);
          return (
            <button
              key={svc}
              type="button"
              onClick={() => toggle(svc)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                active
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-sky-400'
              }`}
            >{svc}</button>
          );
        })}
        {customSelected.map(svc => (
          <button
            key={svc}
            type="button"
            onClick={() => toggle(svc)}
            className="text-xs px-2 py-1 rounded-full bg-purple-600 text-white border border-purple-600"
            title="Custom service — click to remove"
          >{svc} ✕</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add custom service (press Enter)"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
        />
        <button
          type="button"
          onClick={addCustom}
          className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
        >Add</button>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">Shown as chips on the Clients list. Used for retainer analytics and invoice line-item prefill.</p>
    </div>
  );
}

// ── Client Modal ──────────────────────────────────────────────────────────────
function ClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState(client ? {
    name: client.name || '',
    contactPerson: client.contactPerson || '',
    email: client.email || '',
    phone: client.phone || '',
    addressLine1: client.addressLine1 || '',
    city: client.city || '',
    state: client.state || '',
    stateCode: client.stateCode || '',
    pincode: client.pincode || '',
    isGst: client.isGst ?? false,
    gstin: client.gstin || '',
    taxType: client.taxType || '',
    retainerAmount: client.retainerAmount ? client.retainerAmount / 100 : '',
    serviceDescription: client.serviceDescription || '',
    // Seed from structured `services` array if present; else parse legacy comma-separated `serviceDescription`.
    services: Array.isArray(client.services) && client.services.length > 0
      ? client.services
      : String(client.serviceDescription || '').split(',').map(s => s.trim()).filter(Boolean),
    sacCode: client.sacCode || '9983',
    invoiceDayOfMonth: client.invoiceDayOfMonth || 1,
    notes: client.notes || '',
  } : {
    name: '', contactPerson: '', email: '', phone: '',
    addressLine1: '', city: '', state: '', stateCode: '', pincode: '',
    isGst: false, gstin: '', taxType: '',
    retainerAmount: '', serviceDescription: '', services: [], sacCode: '9983',
    invoiceDayOfMonth: 1, notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleStateChange(name) {
    const s = INDIAN_STATES.find(st => st.name === name);
    const autoTax = s?.code === '08' ? 'cgst_sgst' : 'igst';
    setForm(f => ({ ...f, state: name, stateCode: s?.code || '', taxType: f.isGst ? autoTax : '' }));
  }

  async function handleSave() {
    if (!form.name) { setError('Client name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name: form.name,
        contactPerson: form.contactPerson || null,
        email: form.email || null,
        phone: form.phone || null,
        addressLine1: form.addressLine1 || null,
        city: form.city || null,
        state: form.state || null,
        stateCode: form.stateCode || null,
        pincode: form.pincode || null,
        isGst: form.isGst,
        gstin: form.isGst ? form.gstin || null : null,
        taxType: form.isGst ? form.taxType || null : null,
        retainerAmount: form.retainerAmount ? Math.round(parseFloat(String(form.retainerAmount)) * 100) : null,
        serviceDescription: (form.services?.length ? form.services.join(', ') : form.serviceDescription) || null,
        services: Array.isArray(form.services) ? form.services : [],
        sacCode: form.sacCode || '9983',
        invoiceDayOfMonth: parseInt(String(form.invoiceDayOfMonth)) || 1,
        notes: form.notes || null,
      };
      if (client) {
        await apiFetch(`/api/billing/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/billing/clients', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold text-slate-900">{client ? 'Edit Client' : 'Add Billing Client'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Client / Company Name *</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Contact Person</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 mb-2"
              placeholder="Address line 1" value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} />
            <div className="grid grid-cols-3 gap-2">
              <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="City" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.state} onChange={e => handleStateChange(e.target.value)}>
                <option value="">State</option>
                {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
              </select>
              <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Pincode" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} />
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 text-sky-600 rounded"
                  checked={form.isGst} onChange={e => setForm(f => ({ ...f, isGst: e.target.checked }))} />
                <span className="text-sm font-medium text-slate-700">GST Registered</span>
              </label>
            </div>
            {form.isGst && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
                  <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 uppercase"
                    value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tax Type</label>
                  <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    value={form.taxType} onChange={e => setForm(f => ({ ...f, taxType: e.target.value }))}>
                    <option value="">Select tax type</option>
                    <option value="igst">IGST 18% (other state)</option>
                    <option value="cgst_sgst">CGST 9% + SGST 9% (Rajasthan)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Monthly Retainer (₹)</label>
              <input type="number" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.retainerAmount} onChange={e => setForm(f => ({ ...f, retainerAmount: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Invoice Day</label>
              <input type="number" min="1" max="28" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.invoiceDayOfMonth} onChange={e => setForm(f => ({ ...f, invoiceDayOfMonth: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">SAC Code</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.sacCode} onChange={e => setForm(f => ({ ...f, sacCode: e.target.value }))} />
            </div>
          </div>

          <ServicesPicker
            value={form.services}
            onChange={next => setForm(f => ({ ...f, services: next, serviceDescription: next.join(', ') }))}
          />

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Saving…' : (client ? 'Update Client' : 'Add Client')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice Edit Modal ────────────────────────────────────────────────────────
function toDateString(val) {
  if (!val) return '';
  try {
    if (val instanceof Date) return isNaN(val.getTime()) ? '' : safeISOString(val).slice(0, 10);
    if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) return val.slice(0, 10);
    const d = new Date(val);
    return isNaN(d.getTime()) ? '' : safeISOString(d).slice(0, 10);
  } catch { return ''; }
}

function InvoiceModal({ invoice, clients, onClose, onSaved }) {
  const isEdit = !!invoice;
  const today = safeISOString(new Date()).split('T')[0];
  const due = new Date(); due.setDate(due.getDate() + 15);
  const dueStr = safeISOString(due).split('T')[0];

  const [form, setForm] = useState(isEdit ? {
    clientId: invoice.client_id || '',
    invoiceDate: toDateString(invoice.invoice_date) || today,
    dueDate: toDateString(invoice.due_date) || dueStr,
    invoiceType: invoice.invoice_type || 'gst',
    taxType: invoice.tax_type || '',
    serviceDescription: invoice.service_description || '',
    notes: invoice.notes || '',
    paymentNote: invoice.payment_note || '',
    discountType: invoice.discount_type || '',
    // For 'percent', value is the % (e.g. 10). For 'fixed', value is rupees (paise ÷ 100).
    discountValue: invoice.discount_type === 'percent'
      ? (invoice.discount_percent || 0)
      : invoice.discount_type === 'fixed'
        ? ((invoice.discount_amount || 0) / 100)
        : '',
    discountLabel: invoice.discount_label || '',
  } : {
    clientId: '',
    invoiceDate: today,
    dueDate: dueStr,
    invoiceType: 'gst',
    taxType: '',
    serviceDescription: '',
    notes: '',
    paymentNote: '',
    discountType: '',
    discountValue: '',
    discountLabel: '',
  });

  const [lineItems, setLineItems] = useState(
    invoice?.lineItems?.length > 0 ? invoice.lineItems.map(li => ({
      description: li.description,
      sacCode: li.sac_code || '9983',
      quantity: li.quantity || 1,
      unit: li.unit || 'Month',
      rate: li.rate / 100,
      amount: li.amount / 100,
    })) : [{ description: '', sacCode: '9983', quantity: 1, unit: 'Month', rate: '', amount: 0 }]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedClient = clients.find(c => c.id === form.clientId);

  useEffect(() => {
    if (selectedClient && !isEdit) {
      const taxType = selectedClient.taxType || (selectedClient.isGst ? 'igst' : '');
      const invoiceType = selectedClient.isGst ? 'gst' : 'non_gst';
      setForm(f => ({
        ...f,
        taxType,
        invoiceType,
        // Prefill invoice-level description from the client's services text
        serviceDescription: f.serviceDescription || selectedClient.serviceDescription || '',
      }));
      if (selectedClient.retainerAmount) {
        setLineItems([{
          description: selectedClient.serviceDescription || 'Professional Services',
          sacCode: selectedClient.sacCode || '9983',
          quantity: 1,
          unit: 'Month',
          rate: selectedClient.retainerAmount / 100,
          amount: selectedClient.retainerAmount / 100,
        }]);
      }
    }
  }, [form.clientId]);

  function updateLineItem(idx, field, value) {
    setLineItems(items => {
      const updated = [...items];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === 'rate' || field === 'quantity') {
        const rate = parseFloat(String(field === 'rate' ? value : updated[idx].rate)) || 0;
        const qty = parseFloat(String(field === 'quantity' ? value : updated[idx].quantity)) || 0;
        updated[idx].amount = Math.round(rate * qty * 100) / 100;
      }
      return updated;
    });
  }

  const subtotal = lineItems.reduce((s, li) => s + (parseFloat(String(li.amount)) || 0), 0);
  const rawDiscountValue = parseFloat(String(form.discountValue)) || 0;
  let discount = 0;
  if (form.discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, rawDiscountValue));
    discount = Math.round(subtotal * pct) / 100;
  } else if (form.discountType === 'fixed') {
    discount = Math.min(subtotal, Math.max(0, rawDiscountValue));
  }
  const taxable = Math.max(0, subtotal - discount);
  let taxAmount = 0;
  let taxLabel = '';
  if (form.taxType === 'igst') { taxAmount = Math.round(taxable * 0.18 * 100) / 100; taxLabel = 'IGST 18%'; }
  else if (form.taxType === 'cgst_sgst') { taxAmount = Math.round(taxable * 0.18 * 100) / 100; taxLabel = 'CGST 9% + SGST 9%'; }
  const total = taxable + taxAmount;

  async function handleSave() {
    if (!form.clientId) { setError('Select a client'); return; }
    if (lineItems.length === 0) { setError('Add at least one line item'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        lineItemsData: lineItems.map(li => ({
          description: li.description,
          sacCode: li.sacCode,
          quantity: parseFloat(String(li.quantity)) || 1,
          unit: li.unit,
          rate: Math.round(parseFloat(String(li.rate)) * 100),
          amount: Math.round(parseFloat(String(li.amount)) * 100),
        })),
      };
      if (isEdit) {
        await apiFetch(`/api/billing/invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/billing/invoices', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold text-slate-900">{isEdit ? 'Edit Invoice' : 'New Invoice'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-5">
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Client *</label>
              <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}>
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Invoice Date</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={String(form.invoiceDate || '')} onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Due Date</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={String(form.dueDate || '')} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Invoice Type</label>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                {['gst', 'non_gst'].map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, invoiceType: t, taxType: t === 'non_gst' ? '' : f.taxType }))}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${form.invoiceType === t ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {t === 'gst' ? 'GST' : 'Non-GST'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {form.invoiceType === 'gst' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tax Type</label>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                {[['igst', 'IGST 18% (other state)'], ['cgst_sgst', 'CGST 9% + SGST 9% (Rajasthan)']].map(([v, l]) => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, taxType: v }))}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${form.taxType === v ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Line Items */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Invoice Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. Retainer — Performance Marketing · April 2026"
              value={form.serviceDescription}
              onChange={e => setForm(f => ({ ...f, serviceDescription: e.target.value }))} />
            <p className="text-[10px] text-slate-400 mt-1">Short summary shown above line items on the invoice PDF and on the invoices list.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Line Items</label>
              <button onClick={() => setLineItems(l => [...l, { description: '', sacCode: '9983', quantity: 1, unit: 'Month', rate: '', amount: 0 }])}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium">+ Add item</button>
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-600 w-[35%]">Description</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-600 w-[10%]">SAC</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-600 w-[8%]">Qty</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-600 w-[10%]">Unit</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-600 w-[15%]">Rate (₹)</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-600 w-[15%]">Amount (₹)</th>
                    <th className="w-[7%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-2 py-1">
                        <input className="w-full border-0 px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400 rounded"
                          value={item.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <input className="w-full border-0 px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400 rounded"
                          value={item.sacCode} onChange={e => updateLineItem(idx, 'sacCode', e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" className="w-full border-0 px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400 rounded"
                          value={item.quantity} onChange={e => updateLineItem(idx, 'quantity', e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <input className="w-full border-0 px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400 rounded"
                          value={item.unit} onChange={e => updateLineItem(idx, 'unit', e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" className="w-full border-0 px-1 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-sky-400 rounded"
                          value={item.rate} onChange={e => updateLineItem(idx, 'rate', e.target.value)} />
                      </td>
                      <td className="px-2 py-1 text-slate-600 text-right pr-3">
                        {(parseFloat(String(item.amount)) || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button onClick={() => setLineItems(l => l.filter((_, i) => i !== idx))}
                          className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Discount */}
          <div className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Discount <span className="text-slate-400 font-normal">(optional)</span></label>
              {form.discountType && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, discountType: '', discountValue: '', discountLabel: '' }))}
                  className="text-[11px] text-slate-400 hover:text-red-500"
                >Remove discount</button>
              )}
            </div>
            <div className="grid grid-cols-[140px_1fr_1.5fr] gap-2 items-center">
              <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
                {[
                  { k: '', label: 'None' },
                  { k: 'fixed', label: '₹' },
                  { k: 'percent', label: '%' },
                ].map(({ k, label }) => (
                  <button
                    key={k || 'none'}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, discountType: k, discountValue: k ? f.discountValue : '' }))}
                    className={`flex-1 py-1.5 font-medium transition-colors ${
                      form.discountType === k ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >{label}</button>
                ))}
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={!form.discountType}
                placeholder={form.discountType === 'percent' ? '10' : '500'}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                value={form.discountValue}
                onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))}
              />
              <input
                type="text"
                disabled={!form.discountType}
                placeholder="Label (e.g. Loyalty discount)"
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50 disabled:text-slate-400"
                value={form.discountLabel}
                onChange={e => setForm(f => ({ ...f, discountLabel: e.target.value }))}
              />
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>₹{subtotal.toLocaleString('en-IN')}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>
                    {form.discountLabel
                      ? form.discountLabel
                      : form.discountType === 'percent'
                        ? `Discount (${rawDiscountValue}%)`
                        : 'Discount'}
                  </span>
                  <span>− ₹{discount.toLocaleString('en-IN')}</span>
                </div>
              )}
              {taxAmount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>{taxLabel}</span>
                  <span>₹{taxAmount.toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 text-base">
                <span>Total</span>
                <span>₹{total.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {form.invoiceType === 'non_gst' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Note</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Payment details for non-GST invoice"
                value={form.paymentNote} onChange={e => setForm(f => ({ ...f, paymentNote: e.target.value }))} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Saving…' : (isEdit ? 'Update Invoice' : 'Create Invoice')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({ invoice, onClose, onSaved }) {
  const today = safeISOString(new Date()).split('T')[0];
  const [form, setForm] = useState({
    amount: (invoice.amount_due / 100).toString(),
    paymentDate: today,
    paymentMode: 'bank_transfer',
    reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Enter a valid amount'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch(`/api/billing/invoices/${invoice.id}/payment`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Record Payment</h2>
            <p className="text-sm text-slate-500 mt-0.5">{invoice.invoice_number} · Due: {fmt(invoice.amount_due)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹) *</label>
            <input type="number" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date</label>
              <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mode</label>
              <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={form.paymentMode} onChange={e => setForm(f => ({ ...f, paymentMode: e.target.value }))}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">UTR / Reference Number</label>
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Recording…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status Update Modal ──────────────────────────────────────────────────────
function StatusUpdateModal({ invoice, onClose, onSaved }) {
  const [form, setForm] = useState({
    status: invoice.status || 'draft',
    amountPaid: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const payload = { status: form.status, notes: form.notes || undefined };
      if (form.amountPaid) payload.amountPaid = Math.round(parseFloat(form.amountPaid) * 100);
      await apiFetch(`/api/billing/invoices/${invoice.id}/payment-status`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Update Status</h2>
            <p className="text-sm text-slate-500 mt-0.5">{invoice.invoice_number} &middot; {invoice.client_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">&#10005;</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Current Status</label>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[invoice.status] || 'bg-slate-100 text-slate-600'}`}>
              {invoice.status?.replace('_', ' ')}
            </span>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">New Status *</label>
            <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {['draft', 'sent', 'paid', 'partially_paid', 'overdue'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Amount Paid (&#8377;) <span className="text-slate-400 font-normal">optional</span></label>
            <input type="number" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="0" value={form.amountPaid} onChange={e => setForm(f => ({ ...f, amountPaid: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">optional</span></label>
            <textarea rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Updating...' : 'Update Status'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Collection Tab ──────────────────────────────────────────────────────────
function CollectionTab() {
  const [tracker, setTracker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/billing/monthly-tracker?months=3')
      .then(d => setTracker(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-slate-400">Loading collection tracker...</div>;
  if (error) return <div className="text-center py-12 text-red-500">Error: {error}</div>;
  if (!tracker || !tracker.months || tracker.months.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="mb-2">No collection data available</p>
        <p className="text-xs">Generate invoices first to see the collection tracker</p>
      </div>
    );
  }

  const months = tracker.months || [];
  const clients = tracker.clients || [];

  function monthLabel(m) {
    const d = new Date(m.year, m.month - 1);
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  function renderCell(cell) {
    if (!cell || !cell.status || cell.status === 'none') {
      return <span className="text-slate-300 text-lg">&mdash;</span>;
    }
    if (cell.status === 'paid') {
      return <span className="text-green-600 text-lg" title="Paid">&#9989;</span>;
    }
    if (cell.status === 'partially_paid') {
      const paid = cell.amount_paid || 0;
      const total = cell.total_amount || 0;
      return (
        <div className="text-center">
          <span className="text-amber-500 text-lg" title="Partially Paid">&#128993;</span>
          <div className="text-xs text-amber-600 mt-0.5">{fmt(paid)}/{fmt(total)}</div>
        </div>
      );
    }
    // overdue, sent, draft — unpaid
    return <span className="text-red-500 text-lg" title={cell.status}>&#10060;</span>;
  }

  // Compute totals per month
  const monthTotals = months.map((m, mi) => {
    let expected = 0, collected = 0, due = 0;
    clients.forEach(c => {
      const cell = c.months?.[mi];
      if (!cell || cell.status === 'none') return;
      expected += cell.total_amount || 0;
      collected += cell.amount_paid || 0;
      due += (cell.total_amount || 0) - (cell.amount_paid || 0);
    });
    return { expected, collected, due };
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[200px]">Client</th>
            {months.map((m, i) => (
              <th key={i} className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{monthLabel(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {clients.length === 0 && (
            <tr><td colSpan={months.length + 1} className="text-center py-12 text-slate-400">No clients with invoices</td></tr>
          )}
          {clients.map((c, ci) => (
            <tr key={ci} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-medium text-slate-800">{c.client_name}</div>
                {c.retainer_amount ? (
                  <div className="text-xs text-slate-400">{fmt(c.retainer_amount)}/mo</div>
                ) : null}
              </td>
              {months.map((m, mi) => (
                <td key={mi} className="px-4 py-3 text-center">
                  {renderCell(c.months?.[mi])}
                </td>
              ))}
            </tr>
          ))}
          {/* Totals row */}
          <tr className="bg-slate-50 border-t-2 border-slate-300 font-semibold">
            <td className="px-4 py-3 text-sm text-slate-700">Totals</td>
            {monthTotals.map((t, i) => (
              <td key={i} className="px-4 py-3 text-center">
                <div className="text-xs text-slate-500">Expected: {fmt(t.expected)}</div>
                <div className="text-xs text-green-600">Collected: {fmt(t.collected)}</div>
                <div className="text-xs text-red-500">Due: {fmt(t.due)}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Retainers Tab ────────────────────────────────────────────────────────────
function RetainersTab() {
  const [retainers, setRetainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiFetch('/api/billing/retainers')
      .then(d => setRetainers(d?.retainers || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerate(id, name) {
    if (!confirm(`Generate invoice for ${name}?`)) return;
    try {
      const r = await apiFetch(`/api/billing/retainers/${id}/generate-invoice`, { method: 'POST' });
      setMsg(`Invoice generated for ${name} (ID: ${r.invoiceId})`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
  }

  if (loading) return <div className="text-center py-12 text-slate-400">Loading retainers...</div>;

  return (
    <div>
      {msg && <div className="mb-4 bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-700">{msg}</div>}
      {retainers.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="mb-2">No retainers yet</p>
          <p className="text-xs">Create a retainer to auto-generate monthly invoices</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {retainers.map(r => {
            const items = r.line_items || [];
            const total = items.reduce((s, i) => s + (i.amount || 0), 0);
            return (
              <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-800">{r.client_name}</h3>
                    <p className="text-xs text-slate-400 font-mono">{r.retainer_number}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    r.status === 'active' ? 'bg-green-100 text-green-700' :
                    r.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-100 text-slate-400'
                  }`}>{r.status}</span>
                </div>
                <div className="text-sm text-slate-600 space-y-1 mb-3">
                  <div className="flex justify-between"><span>Monthly value</span><span className="font-semibold">{fmt(total)}</span></div>
                  <div className="flex justify-between"><span>Billing day</span><span>{r.billing_day || 1}st of month</span></div>
                  <div className="flex justify-between"><span>Tax type</span><span>{r.tax_type === 'igst' ? 'IGST 18%' : r.tax_type === 'cgst_sgst' ? 'CGST+SGST' : 'No Tax'}</span></div>
                </div>
                {r.status === 'active' && (
                  <button onClick={() => handleGenerate(r.id, r.client_name)}
                    className="w-full text-center text-xs font-medium px-3 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700">
                    Generate Invoice
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const [tab, setTab] = useState('invoices');
  const [invoicesList, setInvoicesList] = useState([]);
  const [clients, setClients] = useState([]);
  const [paymentsList, setPaymentsList] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editInvoice, setEditInvoice] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [statusInvoice, setStatusInvoice] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [invData, clientData, statsData, payData] = await Promise.all([
        apiFetch('/api/billing/invoices'),
        apiFetch('/api/billing/clients'),
        apiFetch('/api/billing/stats'),
        apiFetch('/api/billing/payments'),
      ]);
      setInvoicesList(invData?.invoices || []);
      setClients(clientData?.clients || []);
      setStats(statsData);
      setPaymentsList(payData?.payments || []);
    } catch { /* handled */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleGenerate() {
    setGenerating(true); setMsg('');
    try {
      const result = await apiFetch('/api/billing/generate-monthly', { method: 'POST' });
      setMsg(`✅ Generated ${result.generated} draft invoice(s)${result.errors.length ? ` (${result.errors.length} errors)` : ''}`);
      fetchData();
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleMarkSent(id) {
    try {
      await apiFetch(`/api/billing/invoices/${id}/send`, { method: 'POST' });
      fetchData();
    } catch (e) { alert(e.message); }
  }

  async function handleCancel(id) {
    if (!confirm('Cancel this invoice?')) return;
    try {
      await apiFetch(`/api/billing/invoices/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (e) { alert(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Permanently delete this cancelled invoice? Any recorded payments against it will also be removed and cannot be recovered.')) return;
    try {
      await apiFetch(`/api/billing/invoices/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (e) { alert('Could not delete invoice: ' + e.message); }
  }

  async function handleDeleteClient(id) {
    if (!confirm('Deactivate this client?')) return;
    try {
      await apiFetch(`/api/billing/clients/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (e) { alert(e.message); }
  }

  function handleDownloadPDF(id, invoiceNumber) {
    const token = localStorage.getItem('ge_crm_token');
    const a = document.createElement('a');
    a.href = `/api/billing/invoices/${id}/pdf`;
    a.download = `${(invoiceNumber || 'invoice').replace(/\//g, '-')}.pdf`;
    // Use fetch with auth
    fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(e => alert('PDF error: ' + e.message));
  }

  // Filtered invoices
  const filtered = invoicesList.filter(inv => {
    if (filterStatus && inv.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!inv.client_name?.toLowerCase().includes(q) && !inv.invoice_number?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Billing & Retainers</h1>
            <p className="text-slate-500 mt-1 text-sm">Monthly recurring revenue and invoice management</p>
          </div>
          <div className="flex items-center gap-3">
            {msg && <span className="text-sm text-slate-600">{msg}</span>}
            <button onClick={handleGenerate} disabled={generating}
              className="px-4 py-2 text-sm border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 disabled:opacity-50 flex items-center gap-2">
              {generating ? '⏳' : '🔄'} Generate Drafts
            </button>
            <button onClick={() => { setEditInvoice(null); setShowInvoiceModal(true); }}
              className="px-4 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 flex items-center gap-1.5">
              + New Invoice
            </button>
            <button onClick={() => { setEditClient(null); setShowClientModal(true); }}
              className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 flex items-center gap-1.5">
              + Add Client
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Monthly MRR', value: fmt(stats.totalMrr), color: 'text-sky-600', sub: 'active retainers' },
              { label: 'Collected this month', value: fmt(stats.collectedThisMonth), color: 'text-green-600', sub: 'payments received' },
              { label: 'Outstanding', value: fmt(stats.outstanding), color: stats.outstanding > 0 ? 'text-amber-600' : 'text-slate-600', sub: `${stats.overdueCount} overdue` },
              { label: 'Annual Run Rate', value: fmt(stats.annualRunRate), color: 'text-purple-600', sub: 'MRR × 12' },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-xs text-slate-500 font-medium">{card.label}</p>
                <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
                <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-slate-200">
          {[['invoices', 'Invoices'], ['retainers', 'Retainers'], ['clients', 'Clients'], ['payments', 'Payments'], ['collection', 'Collection']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === id ? 'border-sky-600 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading…</div>
        ) : (
          <>
            {/* ── INVOICES TAB ── */}
            {tab === 'invoices' && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="relative flex-1 max-w-xs">
                    <input placeholder="Search client or invoice #" value={search} onChange={e => setSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    <svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  {['', 'draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled'].map(s => (
                    <button key={s} onClick={() => setFilterStatus(s)}
                      className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${
                        filterStatus === s ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}>
                      {s === '' ? 'All' : s.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {['Invoice #', 'Client', 'Date', 'Due', 'Amount', 'Tax', 'Status', 'Actions'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.length === 0 && (
                        <tr><td colSpan={8} className="text-center py-12 text-slate-400">No invoices found</td></tr>
                      )}
                      {filtered.map(inv => (
                        <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="text-sm font-mono text-slate-700 font-medium">{inv.invoice_number}</div>
                            {inv.service_description && (
                              <div className="text-[11px] text-slate-500 mt-0.5 max-w-[260px] truncate" title={inv.service_description}>
                                {inv.service_description}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm font-medium text-slate-800">{inv.client_name}</div>
                            {inv.client_contact_person && <div className="text-xs text-slate-400">{inv.client_contact_person}</div>}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(inv.invoice_date)}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {fmtDate(inv.due_date)}
                            {inv.status === 'overdue' && (
                              <div className="text-xs text-red-500 font-medium">{daysOverdue(inv.due_date)}d overdue</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm font-semibold text-slate-800">{fmt(inv.total_amount)}</div>
                            {inv.status === 'partially_paid' && (
                              <div className="text-xs text-amber-600">Due: {fmt(inv.amount_due)}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${inv.tax_type === 'igst' ? 'bg-purple-100 text-purple-700' : inv.tax_type === 'cgst_sgst' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                              {inv.tax_type === 'igst' ? 'IGST' : inv.tax_type === 'cgst_sgst' ? 'CGST+SGST' : 'No Tax'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[inv.status] || 'bg-slate-100 text-slate-600'}`}>
                              {inv.status === 'paid' ? `✓ Paid ${fmtDate(inv.paid_at)}` :
                               inv.status === 'partially_paid' ? 'Partial' :
                               inv.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={async () => {
                                try {
                                  const detail = await apiFetch(`/api/billing/invoices/${inv.id}`);
                                  setEditInvoice({ ...inv, lineItems: detail?.lineItems || [] });
                                } catch { setEditInvoice({ ...inv }); }
                                setShowInvoiceModal(true);
                              }}
                                className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded" title="Edit">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button onClick={() => handleDownloadPDF(inv.id, inv.invoice_number)}
                                className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded" title="Download PDF">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </button>
                              {['draft', 'overdue'].includes(inv.status) && (
                                <button onClick={() => handleMarkSent(inv.id)}
                                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Mark Sent">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                  </svg>
                                </button>
                              )}
                              {['sent', 'partially_paid', 'overdue'].includes(inv.status) && (
                                <button onClick={() => setPaymentInvoice(inv)}
                                  className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded" title="Record Payment">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                </button>
                              )}
                              {inv.status !== 'cancelled' && (
                                <button onClick={() => setStatusInvoice(inv)}
                                  className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded" title="Update Status">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                              )}
                              {inv.status === 'cancelled' ? (
                                <button onClick={() => handleDelete(inv.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="Delete permanently">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              ) : inv.status !== 'paid' ? (
                                <button onClick={() => handleCancel(inv.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="Cancel">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── CLIENTS TAB ── */}
            {tab === 'clients' && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Client', 'Contact', 'Services', 'Retainer/mo', 'Tax Type', 'Invoice Day', 'Status', 'Actions'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clients.length === 0 && (
                      <tr><td colSpan={8} className="text-center py-12 text-slate-400">No clients yet</td></tr>
                    )}
                    {clients.map(c => {
                      const serviceChips = Array.isArray(c.services) && c.services.length > 0
                        ? c.services
                        : String(c.serviceDescription || '')
                            .split(',')
                            .map(s => s.trim())
                            .filter(Boolean);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="text-sm font-medium text-slate-800">{c.name}</div>
                            {c.gstin && <div className="text-xs text-slate-400 font-mono">{c.gstin}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-slate-600">{c.contactPerson || '—'}</div>
                            {c.email && <div className="text-xs text-slate-400">{c.email}</div>}
                          </td>
                          <td className="px-4 py-3">
                            {serviceChips.length === 0 ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-[220px]">
                                {serviceChips.map((s, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-medium whitespace-nowrap">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-800">{fmt(c.retainerAmount)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isGst ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                              {c.isGst ? (c.taxType === 'igst' ? 'IGST' : 'CGST+SGST') : 'Non-GST'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{c.invoiceDayOfMonth || 1}st</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                              {c.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setEditClient(c); setShowClientModal(true); }}
                                className="text-xs text-sky-600 hover:underline">Edit</button>
                              {c.isActive && (
                                <button onClick={() => handleDeleteClient(c.id)}
                                  className="text-xs text-red-400 hover:text-red-600 hover:underline">Deactivate</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── RETAINERS TAB ── */}
            {tab === 'retainers' && <RetainersTab />}

            {/* ── PAYMENTS TAB ── */}
            {tab === 'payments' && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {['Date', 'Client', 'Invoice', 'Amount', 'Mode', 'Reference'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentsList.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-12 text-slate-400">No payments recorded</td></tr>
                    )}
                    {paymentsList.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm text-slate-600">{fmtDate(p.payment_date)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-800">{p.client_name}</td>
                        <td className="px-4 py-3 text-sm font-mono text-slate-600">{p.invoice_number}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-green-600">{fmt(p.amount)}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 capitalize">{(p.payment_mode || '').replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-sm text-slate-500 font-mono">{p.reference || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── COLLECTION TAB ── */}
            {tab === 'collection' && <CollectionTab />}
          </>
        )}
      </main>

      {/* Modals */}
      {showInvoiceModal && (
        <InvoiceModal
          invoice={editInvoice ? { ...editInvoice } : null}
          clients={clients}
          onClose={() => { setShowInvoiceModal(false); setEditInvoice(null); }}
          onSaved={() => { setShowInvoiceModal(false); setEditInvoice(null); fetchData(); }}
        />
      )}
      {showClientModal && (
        <ClientModal
          client={editClient}
          onClose={() => { setShowClientModal(false); setEditClient(null); }}
          onSaved={() => { setShowClientModal(false); setEditClient(null); fetchData(); }}
        />
      )}
      {paymentInvoice && (
        <PaymentModal
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onSaved={() => { setPaymentInvoice(null); fetchData(); }}
        />
      )}
      {statusInvoice && (
        <StatusUpdateModal
          invoice={statusInvoice}
          onClose={() => setStatusInvoice(null)}
          onSaved={() => { setStatusInvoice(null); fetchData(); }}
        />
      )}
    </div>
  );
}
