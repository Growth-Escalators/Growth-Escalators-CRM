import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import StatCard from '../components/StatCard.jsx';
import { apiFetch } from '../lib/api.js';
import {
  Zap, Plus, Trash2, RefreshCw, Edit2, X, Save, Eye, EyeOff,
  FileText, Link, GitBranch, Bell, Package, DollarSign,
  Layout, ChevronLeft, Gift, BarChart3, Users, ShoppingCart, TrendingUp, IndianRupee,
} from 'lucide-react';

const BLANK_CONFIG = {
  name: '',
  slug: '',
  is_active: true,
  basePrice: '',
  bump1Price: '',
  bump2Price: '',
  bump1Label: '',
  bump2Label: '',
  productName: '',
  mainProductDescription: '',
  bump1Description: '',
  bump2Description: '',
  mainPdfUrl: '',
  bump1PdfUrl: '',
  bump2BookingUrl: '',
  heroHeadline: '',
  heroSubheadline: '',
  ctaText: '',
  accentColor: '#0ea5e9',
  pipelineName: '',
  pipelineStages: '',
  sequenceName: '',
  slackEmoji: '',
  slackLabel: '',
  bonusProducts: [],
};

// Backend returns snake_case (raw pg rows). The form holds camelCase. Map
// both directions so the existing UI keeps working without a sweeping rename.
function mapConfigToForm(config) {
  // Defensive: legacy responses sometimes have camelCase too, hence ??.
  const get = (snake, camel) => config[snake] ?? config[camel];
  let stages = get('pipeline_stages', 'pipelineStages');
  if (Array.isArray(stages)) stages = JSON.stringify(stages);
  else if (typeof stages === 'string' && !stages.trim().startsWith('[')) stages = stages;
  return {
    name: get('name') || '',
    slug: get('slug') || '',
    is_active: get('is_active', 'isActive') !== false,
    basePrice: get('base_price', 'basePrice') != null ? String(get('base_price', 'basePrice')) : '',
    bump1Price: get('bump1_price', 'bump1Price') != null ? String(get('bump1_price', 'bump1Price')) : '',
    bump2Price: get('bump2_price', 'bump2Price') != null ? String(get('bump2_price', 'bump2Price')) : '',
    bump1Label: get('bump1_label', 'bump1Label') || '',
    bump2Label: get('bump2_label', 'bump2Label') || '',
    productName: get('product_name', 'productName') || '',
    mainProductDescription: get('main_product_description', 'mainProductDescription') || '',
    bump1Description: get('bump1_description', 'bump1Description') || '',
    bump2Description: get('bump2_description', 'bump2Description') || '',
    mainPdfUrl: get('main_pdf_url', 'mainPdfUrl') || '',
    bump1PdfUrl: get('bump1_pdf_url', 'bump1PdfUrl') || '',
    bump2BookingUrl: get('bump2_booking_url', 'bump2BookingUrl') || '',
    heroHeadline: get('hero_headline', 'heroHeadline') || '',
    heroSubheadline: get('hero_subheadline', 'heroSubheadline') || '',
    ctaText: get('cta_text', 'ctaText') || '',
    accentColor: get('accent_color', 'accentColor') || '#0ea5e9',
    pipelineName: get('pipeline_name', 'pipelineName') || '',
    pipelineStages: stages || '',
    sequenceName: get('sequence_name', 'sequenceName') || '',
    slackEmoji: get('slack_emoji', 'slackEmoji') || '',
    slackLabel: get('slack_label', 'slackLabel') || '',
    bonusProducts: Array.isArray(get('bonus_products', 'bonusProducts'))
      ? get('bonus_products', 'bonusProducts')
      : [],
  };
}

// ---------------------------------------------------------------------------
// BonusProductsEditor — repeating rows of { label, description, image_url,
// pdf_url }. Stored on the parent form as the `bonusProducts` array, written
// back as snake_case via the f() body reader on the backend.
// ---------------------------------------------------------------------------
function BonusProductsEditor({ items, onChange, inputClass }) {
  const list = Array.isArray(items) ? items : [];

  function update(i, key, val) {
    const next = list.map((row, idx) => (idx === i ? { ...row, [key]: val } : row));
    onChange(next);
  }
  function add() {
    onChange([...list, { label: '', description: '', image_url: '', pdf_url: '' }]);
  }
  function remove(i) {
    onChange(list.filter((_, idx) => idx !== i));
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <div className="text-xs text-slate-400 italic bg-slate-50 rounded-lg px-4 py-3 border border-dashed border-slate-200">
          No bonus products yet. Click below to add one.
        </div>
      )}
      {list.map((row, i) => (
        <div key={i} className="border border-slate-200 rounded-lg p-3 bg-white relative">
          <div className="absolute top-2 right-2 flex items-center gap-1">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
              className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move up">↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1}
              className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move down">↓</button>
            <button type="button" onClick={() => remove(i)}
              className="text-slate-400 hover:text-red-600 p-1" title="Remove">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-slate-500 font-medium">Label</label>
              <input type="text" value={row.label || ''}
                onChange={e => update(i, 'label', e.target.value)}
                placeholder="e.g. Bonus: 50 Winning Ad Headlines"
                className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-slate-500 font-medium">Description</label>
              <textarea rows={2} value={row.description || ''}
                onChange={e => update(i, 'description', e.target.value)}
                placeholder="One-line description shown on the landing page."
                className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Image URL</label>
              <input type="text" value={row.image_url || ''}
                onChange={e => update(i, 'image_url', e.target.value)}
                placeholder="https://… (optional)"
                className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">PDF / Asset URL</label>
              <input type="text" value={row.pdf_url || ''}
                onChange={e => update(i, 'pdf_url', e.target.value)}
                placeholder="https://… (delivered post-purchase)"
                className={inputClass} />
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={add}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-dashed border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50">
        <Plus className="w-3.5 h-3.5" /> Add bonus product
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FunnelPerformanceTab — shows the per-funnel metrics. Only visible when
// editing an existing funnel.
// ---------------------------------------------------------------------------
function FunnelPerformanceTab({ slug }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true); setError('');
    try {
      const res = await apiFetch(`/api/funnel-configs/${encodeURIComponent(slug)}/performance`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load performance');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  function rupees(paise) {
    if (paise == null) return '—';
    return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }
  function pct(rate) {
    if (rate == null) return '—';
    return `${(rate * 100).toFixed(1)}%`;
  }

  if (!slug) {
    return <div className="text-sm text-slate-500">Save the funnel first to view performance.</div>;
  }
  if (loading) {
    return <div className="text-sm text-slate-400">Loading metrics…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="text-xs text-slate-500">
        Window: <span className="font-mono">{data.window?.since}</span> → <span className="font-mono">{data.window?.until}</span>
        <button onClick={load} className="ml-3 text-sky-600 hover:underline">refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Visitors" value={data.visitors ?? '—'} icon={Users} colour="slate"
          subtext="needs pixel" />
        <StatCard label="Admitted" value={data.admitted} icon={Users} colour="sky" />
        <StatCard label="Paid" value={data.paid_count} icon={ShoppingCart} colour="emerald"
          subtext={rupees(data.paid_revenue_paise)} />
        <StatCard label="Conv. rate" value={pct(data.conversion_rate)} icon={TrendingUp} colour="violet" />
        <StatCard label="AOV" value={rupees(data.aov_paise)} icon={IndianRupee} colour="amber" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Bump 1 attach" value={pct(data.bump1_attach_rate)} icon={Gift} colour="rose" />
        <StatCard label="Bump 2 attach" value={pct(data.bump2_attach_rate)} icon={Gift} colour="rose" />
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">Last 7 days — paid count</p>
        {(!data.trend_7d || data.trend_7d.length === 0) ? (
          <p className="text-xs text-slate-400 italic">No paid events in the last 7 days.</p>
        ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-xs text-slate-500">
                  <th className="px-3 py-1.5 text-left">Date</th>
                  <th className="px-3 py-1.5 text-right">Paid</th>
                  <th className="px-3 py-1.5 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.trend_7d.map(r => (
                  <tr key={r.date} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{r.date}</td>
                    <td className="px-3 py-1.5 text-right">{r.paid}</td>
                    <td className="px-3 py-1.5 text-right">{rupees(r.revenue_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, color = 'text-sky-500' }) {
  return (
    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 pt-4 pb-2 border-b border-slate-100 mb-3">
      <Icon className={`w-4 h-4 ${color}`} /> {title}
    </h3>
  );
}

function FunnelForm({ config, onSaved, onCancel }) {
  const [form, setForm] = useState(BLANK_CONFIG);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (config) {
      setForm(mapConfigToForm(config));
    } else {
      setForm(BLANK_CONFIG);
    }
    setError('');
  }, [config]);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.slug) {
      setError('Name and Slug are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        basePrice: form.basePrice ? Number(form.basePrice) : null,
        bump1Price: form.bump1Price ? Number(form.bump1Price) : null,
        bump2Price: form.bump2Price ? Number(form.bump2Price) : null,
      };
      let res;
      if (config?.id) {
        res = await apiFetch(`/api/funnel-configs/${config.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        res = await apiFetch('/api/funnel-configs', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      if (res?.error) throw new Error(res.error);
      onSaved(config?.id ? 'Funnel updated' : 'Funnel created');
    } catch (err) {
      setError(err.message || 'Failed to save funnel');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-1">
      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">{error}</p>}

      {/* Basics */}
      <SectionHeader icon={FileText} title="Basics" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Name *</label>
          <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. Growth Playbook" className={inputClass} required />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Slug *</label>
          <input type="text" value={form.slug} onChange={e => set('slug', e.target.value)}
            placeholder="e.g. growth-playbook" className={inputClass} required />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Status</label>
          <div className="flex items-center gap-3 mt-1.5">
            <button type="button" onClick={() => set('is_active', !form.is_active)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                form.is_active
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}>
              {form.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              {form.is_active ? 'Active' : 'Draft'}
            </button>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <SectionHeader icon={DollarSign} title="Pricing" color="text-emerald-500" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Base Price (INR)</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 text-sm">INR</span>
            <input type="number" value={form.basePrice} onChange={e => set('basePrice', e.target.value)}
              placeholder="999" className={`${inputClass} pl-12`} />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 1 Price (optional)</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 text-sm">INR</span>
            <input type="number" value={form.bump1Price} onChange={e => set('bump1Price', e.target.value)}
              placeholder="499" className={`${inputClass} pl-12`} />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 2 Price (optional)</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 text-sm">INR</span>
            <input type="number" value={form.bump2Price} onChange={e => set('bump2Price', e.target.value)}
              placeholder="299" className={`${inputClass} pl-12`} />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 1 Label</label>
          <input type="text" value={form.bump1Label} onChange={e => set('bump1Label', e.target.value)}
            placeholder="e.g. Bonus Templates Pack" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 2 Label</label>
          <input type="text" value={form.bump2Label} onChange={e => set('bump2Label', e.target.value)}
            placeholder="e.g. 1-on-1 Strategy Call" className={inputClass} />
        </div>
      </div>

      {/* Products */}
      <SectionHeader icon={Package} title="Products" color="text-violet-500" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Product Name</label>
          <input type="text" value={form.productName} onChange={e => set('productName', e.target.value)}
            placeholder="e.g. Growth Playbook 2026" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Main Product Description</label>
          <input type="text" value={form.mainProductDescription} onChange={e => set('mainProductDescription', e.target.value)}
            placeholder="Short description of the main product" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 1 Description</label>
          <input type="text" value={form.bump1Description} onChange={e => set('bump1Description', e.target.value)}
            placeholder="What the first bump includes" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 2 Description</label>
          <input type="text" value={form.bump2Description} onChange={e => set('bump2Description', e.target.value)}
            placeholder="What the second bump includes" className={inputClass} />
        </div>
      </div>

      {/* Assets */}
      <SectionHeader icon={Link} title="Assets" color="text-blue-500" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Main PDF URL</label>
          <input type="url" value={form.mainPdfUrl} onChange={e => set('mainPdfUrl', e.target.value)}
            placeholder="https://..." className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 1 PDF URL</label>
          <input type="url" value={form.bump1PdfUrl} onChange={e => set('bump1PdfUrl', e.target.value)}
            placeholder="https://..." className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Bump 2 Booking URL</label>
          <input type="url" value={form.bump2BookingUrl} onChange={e => set('bump2BookingUrl', e.target.value)}
            placeholder="https://..." className={inputClass} />
        </div>
      </div>

      {/* Landing Page */}
      <SectionHeader icon={Layout} title="Landing Page" color="text-pink-500" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Hero Headline</label>
          <input type="text" value={form.heroHeadline} onChange={e => set('heroHeadline', e.target.value)}
            placeholder="Main headline for the landing page" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Hero Subheadline</label>
          <input type="text" value={form.heroSubheadline} onChange={e => set('heroSubheadline', e.target.value)}
            placeholder="Supporting text below the headline" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">CTA Text</label>
          <input type="text" value={form.ctaText} onChange={e => set('ctaText', e.target.value)}
            placeholder="e.g. Buy Now" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Accent Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={form.accentColor} onChange={e => set('accentColor', e.target.value)}
              className="w-10 h-[38px] border border-slate-200 rounded-lg cursor-pointer" />
            <input type="text" value={form.accentColor} onChange={e => set('accentColor', e.target.value)}
              className={`flex-1 ${inputClass}`} />
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <SectionHeader icon={GitBranch} title="Pipeline" color="text-amber-500" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Pipeline Name</label>
          <input type="text" value={form.pipelineName} onChange={e => set('pipelineName', e.target.value)}
            placeholder="e.g. Growth Playbook Pipeline" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Pipeline Stages (comma-separated or JSON)</label>
          <input type="text" value={form.pipelineStages} onChange={e => set('pipelineStages', e.target.value)}
            placeholder='e.g. Lead, Qualified, Purchased, Delivered' className={inputClass} />
        </div>
      </div>

      {/* Sequence */}
      <SectionHeader icon={Zap} title="Sequence" color="text-orange-500" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Sequence Name</label>
          <input type="text" value={form.sequenceName} onChange={e => set('sequenceName', e.target.value)}
            placeholder="e.g. growth-playbook-post-purchase" className={inputClass} />
        </div>
      </div>

      {/* Notifications */}
      <SectionHeader icon={Bell} title="Notifications" color="text-red-500" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 font-medium">Slack Emoji</label>
          <input type="text" value={form.slackEmoji} onChange={e => set('slackEmoji', e.target.value)}
            placeholder="e.g. :rocket:" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-slate-500 font-medium">Slack Label</label>
          <input type="text" value={form.slackLabel} onChange={e => set('slackLabel', e.target.value)}
            placeholder="e.g. New Growth Playbook Sale" className={inputClass} />
        </div>
      </div>

      {/* Bonus Products */}
      <SectionHeader icon={Gift} title="Bonus Products" color="text-rose-500" />
      <p className="text-xs text-slate-500 -mt-2 mb-3">
        Extras shipped alongside the main purchase. They show as a separate section on the landing page below the bump offers.
      </p>
      <BonusProductsEditor
        items={form.bonusProducts}
        onChange={(next) => set('bonusProducts', next)}
        inputClass={inputClass}
      />

      {/* Delivery Status */}
      {config?.id && (
        <>
          <SectionHeader icon={Package} title="Delivery Status" color="text-teal-500" />
          <div className="bg-slate-50 rounded-lg px-4 py-3 text-sm text-slate-500 border border-slate-100">
            Delivery tracking available after first purchase
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-5 border-t border-slate-100 mt-4">
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : config?.id ? 'Update Funnel' : 'Create Funnel'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>
    </form>
  );
}

export default function FunnelManagementPage() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [editingConfig, setEditingConfig] = useState(null);
  const [formTab, setFormTab] = useState('edit'); // 'edit' | 'performance'
  const [toast, setToast] = useState('');

  const loadConfigs = useCallback(async (toastMsg) => {
    setLoading(true);
    if (toastMsg) setToast(toastMsg);
    try {
      const res = await apiFetch('/api/funnel-configs');
      setConfigs(res?.configs ?? []);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  function handleCreate() {
    setEditingConfig(null);
    setFormTab('edit');
    setView('form');
  }

  async function handleEdit(config) {
    try {
      const res = await apiFetch(`/api/funnel-configs/${config.slug}`);
      setEditingConfig(res?.config ?? config);
    } catch {
      setEditingConfig(config);
    }
    setFormTab('edit');
    setView('form');
  }

  async function handleDelete(config) {
    if (!window.confirm(`Delete funnel "${config.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/funnel-configs/${config.id}`, { method: 'DELETE' });
      loadConfigs('Funnel deleted');
    } catch (err) {
      setToast(err.message || 'Failed to delete funnel');
    }
  }

  function handleSaved(msg) {
    setView('list');
    setEditingConfig(null);
    loadConfigs(msg);
  }

  function handleCancel() {
    setView('list');
    setEditingConfig(null);
  }

  function fmtPrice(v) {
    if (v == null || v === '' || v === 0) return '--';
    return `INR ${Number(v).toLocaleString('en-IN')}`;
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center shadow-md">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Funnels</h1>
                <p className="text-xs text-slate-500">Manage funnel configurations</p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {view === 'form' && (
                <button onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  <ChevronLeft className="w-4 h-4" /> Back to List
                </button>
              )}
              {view === 'list' && (
                <button onClick={handleCreate}
                  className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700">
                  <Plus className="w-4 h-4" /> Create New Funnel
                </button>
              )}
              <button onClick={() => loadConfigs()} disabled={loading}
                className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50">
                <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* List View */}
          {view === 'list' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Slug</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Base Price</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Bump 1</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Bump 2</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && configs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Loading funnels...</td>
                    </tr>
                  )}
                  {!loading && configs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                        No funnels configured yet. Click "Create New Funnel" to get started.
                      </td>
                    </tr>
                  )}
                  {configs.map(c => {
                    const basePrice  = c.base_price  ?? c.basePrice;
                    const bump1Price = c.bump1_price ?? c.bump1Price;
                    const bump2Price = c.bump2_price ?? c.bump2Price;
                    const isActive   = c.is_active   ?? c.isActive ?? c.status === 'active';
                    return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                      onClick={() => handleEdit(c)}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{c.slug}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmtPrice(basePrice)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{fmtPrice(bump1Price)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{fmtPrice(bump2Price)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isActive ? 'Active' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => handleEdit(c)}
                            className="text-slate-400 hover:text-amber-600 p-1" title="Edit">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(c)}
                            className="text-slate-400 hover:text-red-600 p-1" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}

          {/* Form View */}
          {view === 'form' && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  {editingConfig ? <Edit2 className="w-4 h-4 text-amber-500" /> : <Plus className="w-4 h-4 text-sky-500" />}
                  {editingConfig ? `Edit Funnel: ${editingConfig.name}` : 'Create New Funnel'}
                </h3>
              </div>
              {editingConfig && (
                <div className="flex items-center gap-1 border-b border-slate-100 mb-4 -mt-2">
                  <button onClick={() => setFormTab('edit')}
                    className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${
                      formTab === 'edit'
                        ? 'border-sky-600 text-sky-700'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}>
                    <Edit2 className="w-3.5 h-3.5 inline mr-1" /> Edit Config
                  </button>
                  <button onClick={() => setFormTab('performance')}
                    className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${
                      formTab === 'performance'
                        ? 'border-sky-600 text-sky-700'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}>
                    <BarChart3 className="w-3.5 h-3.5 inline mr-1" /> Performance
                  </button>
                </div>
              )}
              {(!editingConfig || formTab === 'edit') && (
                <FunnelForm config={editingConfig} onSaved={handleSaved} onCancel={handleCancel} />
              )}
              {editingConfig && formTab === 'performance' && (
                <FunnelPerformanceTab slug={editingConfig.slug} />
              )}
            </div>
          )}
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}
