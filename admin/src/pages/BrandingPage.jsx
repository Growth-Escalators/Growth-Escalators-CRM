import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch, getPermissions } from '../lib/api.js';
import { refreshTenantBranding } from '../lib/branding.js';
import { SkeletonCard } from '../components/SkeletonLoader.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';

// Mirrors src/routes/tenantBranding.ts's HEX_COLOR_RE exactly — client-side
// validation is just an early, friendlier error; the server is still the
// source of truth and re-validates on PUT.
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FULL_HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidHexOrEmpty(value) {
  return value === '' || HEX_COLOR_RE.test(value.trim());
}

// <input type="color"> only accepts a full 6-digit hex, so a 3-digit shorthand
// (or an empty/invalid value) falls back to a neutral swatch rather than
// crashing the picker.
function colorInputValue(value) {
  return FULL_HEX_RE.test(value) ? value : '#000000';
}

function ColorField({ label, value, valid, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={colorInputValue(value)}
          onChange={e => onChange(e.target.value)}
          className="h-9 w-9 rounded border border-slate-200 cursor-pointer p-0.5 bg-white"
          aria-label={`${label} picker`}
        />
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#1A3A5C"
          className={`flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 font-mono ${
            valid ? 'border-slate-200 focus:ring-sky-500' : 'border-red-300 focus:ring-red-400'
          }`}
        />
      </div>
      {!valid && <p className="text-xs text-red-600 mt-1">Enter a hex color like #1A3A5C, or leave blank.</p>}
    </div>
  );
}

export default function BrandingPage() {
  const { showSuccess, showError } = useToast();
  // Defense-in-depth: the nav already hides this page from non-owners
  // (navEntries.js `visible: f => f.isOwner`) and the PUT route 403s any
  // non-owner (src/routes/tenantBranding.ts), but a non-owner can still land
  // here via direct URL. Show a clean message instead of a raw fetch error.
  const isOwner = getPermissions()?.isOwner === true;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    displayName: '',
    logoUrl: '',
    faviconUrl: '',
    primaryColor: '',
    accentColor: '',
  });

  useEffect(() => {
    if (!isOwner) { setLoading(false); return; }
    apiFetch('/api/tenant-branding')
      .then(data => {
        const b = data?.branding || {};
        setForm({
          displayName: b.displayName || '',
          logoUrl: b.logoUrl || '',
          faviconUrl: b.faviconUrl || '',
          primaryColor: b.primaryColor || '',
          accentColor: b.accentColor || '',
        });
      })
      .catch(e => setError(e.message || 'Failed to load branding'))
      .finally(() => setLoading(false));
  }, [isOwner]);

  function update(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const primaryColorValid = isValidHexOrEmpty(form.primaryColor);
  const accentColorValid = isValidHexOrEmpty(form.accentColor);
  const canSave = form.displayName.trim().length > 0 && primaryColorValid && accentColorValid && !saving;

  async function handleSave(e) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        displayName: form.displayName.trim(),
        logoUrl: form.logoUrl.trim(),
        faviconUrl: form.faviconUrl.trim(),
        primaryColor: form.primaryColor.trim(),
        accentColor: form.accentColor.trim(),
      };
      await apiFetch('/api/tenant-branding', { method: 'PUT', body: JSON.stringify(body) });
      // Re-applies CSS vars/title/favicon immediately so the owner sees their
      // change live, without a reload — same call App.jsx makes on boot.
      await refreshTenantBranding();
      showSuccess('Branding updated');
    } catch (err) {
      setError(err.message || 'Failed to save branding');
      showError(err.message || 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="flex h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-lg mx-auto mt-16">
            <p className="text-slate-700 font-medium">Owner access required</p>
            <p className="text-slate-500 text-sm mt-1">Only the tenant owner can view or edit branding settings.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Branding</h1>
          <p className="text-slate-500 mt-1 text-sm">Customize how your CRM looks — name, logo, favicon, and colors.</p>
        </div>

        {loading ? (
          <div className="max-w-2xl space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <form onSubmit={handleSave} className="max-w-2xl bg-white rounded-xl border border-slate-200 p-6 space-y-6">
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Display name *</label>
              <input
                value={form.displayName}
                onChange={e => update('displayName', e.target.value)}
                required
                maxLength={200}
                placeholder="Acme Recruiting"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <p className="text-xs text-slate-400 mt-1">Shown in the browser tab title ("{form.displayName || 'Your name'} CRM").</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Logo URL</label>
                <input
                  value={form.logoUrl}
                  onChange={e => update('logoUrl', e.target.value)}
                  placeholder="https://…/logo.png"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {form.logoUrl && (
                  <div className="mt-2 h-12 flex items-center">
                    <img
                      src={form.logoUrl}
                      alt="Logo preview"
                      className="max-h-12 max-w-[160px] object-contain"
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                      onLoad={e => { e.currentTarget.style.display = ''; }}
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Favicon URL</label>
                <input
                  value={form.faviconUrl}
                  onChange={e => update('faviconUrl', e.target.value)}
                  placeholder="https://…/favicon.ico"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {form.faviconUrl && (
                  <div className="mt-2 h-6 flex items-center">
                    <img
                      src={form.faviconUrl}
                      alt="Favicon preview"
                      className="h-6 w-6 object-contain"
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                      onLoad={e => { e.currentTarget.style.display = ''; }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorField label="Primary color" value={form.primaryColor} valid={primaryColorValid} onChange={v => update('primaryColor', v)} />
              <ColorField label="Accent color" value={form.accentColor} valid={accentColorValid} onChange={v => update('accentColor', v)} />
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={!canSave}
                className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Branding'}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
