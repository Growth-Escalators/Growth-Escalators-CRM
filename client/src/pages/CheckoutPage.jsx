import { useState, useEffect } from 'react';
import { initiateCashfreePayment } from '../services/cashfree';
import { useFunnelConfig } from '../hooks/useFunnelConfig';

// ---------------------------------------------------------------------------
// Fallback constants (used if config loading fails)
// ---------------------------------------------------------------------------
const FALLBACK_SEGMENTS = [
  { id: 'd2c', label: 'I run a D2C Brand', subtitle: 'I sell products online and run Meta/Google ads', icon: '🛍️' },
  { id: 'agency', label: 'I run an Agency', subtitle: 'I manage performance marketing for clients', icon: '🏢' },
  { id: 'freelancer', label: 'I am a Freelancer', subtitle: 'I do performance marketing independently', icon: '💻' },
];

const TICKER_NAMES = [
  'Rahul from Mumbai', 'Priya from Bengaluru', 'Aman from Delhi', 'Sneha from Pune',
  'Karan from Hyderabad', 'Divya from Chennai', 'Rohit from Jaipur', 'Ananya from Kolkata',
  'Vikas from Surat', 'Neha from Ahmedabad',
];

const STEPS = ['Who are you?', 'Your details', 'Upgrade', 'Pay'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CheckoutPage() {
  const { config: funnelConfig, loading: configLoading, slug: funnelSlug } = useFunnelConfig();

  const [segment, setSegment] = useState(null);
  const [bump1, setBump1] = useState(true);
  const [bump2, setBump2] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Config-driven values (with fallbacks)
  const basePrice = funnelConfig?.base_price ?? 9;
  const bump1Price = funnelConfig?.bump1_price ?? null;
  const bump2Price = funnelConfig?.bump2_price ?? null;
  const hasBump1 = bump1Price != null && bump1Price > 0;
  const hasBump2 = bump2Price != null && bump2Price > 0;
  const SEGMENT_OPTIONS = (funnelConfig?.segment_options && Array.isArray(funnelConfig.segment_options))
    ? funnelConfig.segment_options
    : (typeof funnelConfig?.segment_options === 'string' ? JSON.parse(funnelConfig.segment_options) : FALLBACK_SEGMENTS);
  const productName = funnelConfig?.product_name ?? 'D2C Funnel Breakdown Pack';
  const accentColor = funnelConfig?.accent_color ?? '#F97316';
  const heroHeadline = funnelConfig?.hero_headline ?? 'Top 5 D2C Brand Funnel Breakdown';
  const ctaText = funnelConfig?.cta_text ?? `Get Instant Access for ₹${basePrice}`;

  // FIX 3: floating popup state
  const [tickerVisible, setTickerVisible] = useState(false);
  const [tickerData, setTickerData] = useState(null);
  const [tickerIdx, setTickerIdx] = useState(0);

  // FIX 3: Floating popup ticker
  useEffect(() => {
    const fetchTicker = async () => {
      try {
        const res = await fetch('/api/funnel/recent-purchase');
        const data = await res.json();
        if (data.name && data.city && data.minutes_ago) {
          setTickerData({ name: data.name, city: data.city, minutesAgo: Math.max(1, Math.round(data.minutes_ago)) });
        }
      } catch { /* keep current */ }
    };

    fetchTicker();
    const fetchId = setInterval(fetchTicker, 30000);

    // Show popup after 3s, stay 4s, hide, repeat every 30s
    const showFirst = setTimeout(() => setTickerVisible(true), 3000);
    const hideFirst = setTimeout(() => setTickerVisible(false), 7000);
    const repeatId = setInterval(() => {
      setTickerIdx(i => (i + 1) % TICKER_NAMES.length);
      setTickerVisible(true);
      setTimeout(() => setTickerVisible(false), 4000);
    }, 30000);

    return () => { clearInterval(fetchId); clearTimeout(showFirst); clearTimeout(hideFirst); clearInterval(repeatId); };
  }, []);

  const progressStep = segment ? 1 : 0;
  const total = basePrice + (bump1 && hasBump1 ? bump1Price : 0) + (bump2 && hasBump2 ? bump2Price : 0);

  function handleFormChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!segment) { setError('Please select who you are.'); document.getElementById('segment-selector')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (form.name.trim().length < 2) { setError('Please enter your full name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError('Please enter a valid email.'); return; }
    if (!/^[6-9]\d{9}$/.test(form.phone.trim())) { setError('Please enter a valid 10-digit WhatsApp number.'); return; }

    sessionStorage.setItem('ge_segment', segment);
    sessionStorage.setItem('ge_bump1', bump1 && hasBump1 ? '1' : '0');
    sessionStorage.setItem('ge_bump2', bump2 && hasBump2 ? '1' : '0');
    sessionStorage.setItem('ge_name', form.name.trim());
    sessionStorage.setItem('ge_email', form.email.trim());
    sessionStorage.setItem('ge_purchased', 'true');
    sessionStorage.setItem('ge_funnel_slug', funnelSlug);
    if (funnelConfig?.post_purchase_route) sessionStorage.setItem('ge_post_purchase_route', funnelConfig.post_purchase_route);
    if (funnelConfig?.main_pdf_url) sessionStorage.setItem('ge_main_pdf_url', funnelConfig.main_pdf_url);
    if (funnelConfig?.bump1_pdf_url) sessionStorage.setItem('ge_bump1_pdf_url', funnelConfig.bump1_pdf_url);
    if (funnelConfig?.bump2_booking_url) sessionStorage.setItem('ge_bump2_booking_url', funnelConfig.bump2_booking_url);
    if (funnelConfig?.product_name) sessionStorage.setItem('ge_product_name', funnelConfig.product_name);

    setLoading(true);
    try {
      await initiateCashfreePayment({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), amount: total, segment, bump1: bump1 && hasBump1, bump2: bump2 && hasBump2, funnelSlug });
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
      setLoading(false);
    }
  }

  const tickerName = tickerData ? `${tickerData.name} from ${tickerData.city}` : TICKER_NAMES[tickerIdx];
  const tickerTime = tickerData ? ` · ${tickerData.minutesAgo} min ago` : '';

  return (
    <div style={{ backgroundColor: '#eef1f8', fontFamily: 'Inter, sans-serif' }}>

      {/* NAV */}
      <nav style={{ backgroundColor: '#1B2E5E' }} className="py-2.5 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="text-white font-bold text-base tracking-tight">
            Growth<span style={{ color: '#F97316' }}>Escalators</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/70">
            <span>🔒 Secure</span>
            <span>✅ Instant</span>
          </div>
        </div>
      </nav>

      {/* FIX 2: Compact hero */}
      <div style={{ backgroundColor: '#1B2E5E' }} className="px-4 pb-4 pt-3">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-block text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-2"
            style={{ backgroundColor: accentColor, color: 'white' }}>
            📦 {heroHeadline}
          </div>
          <h1 className="text-lg md:text-xl font-bold text-white leading-snug">
            You are <span style={{ color: '#F97316' }}>60 seconds away</span> from the funnel framework that helps Indian brands scale past <span style={{ color: '#F97316' }}>₹10L/month on Meta</span>
          </h1>
          <div className="flex items-center justify-center gap-3 mt-2 text-[11px] text-white/60">
            <span>🔒 Cashfree Secured</span>
            <span>⚡ Instant WhatsApp</span>
            <span>💯 30-Day Money-Back</span>
          </div>
        </div>
      </div>

      {/* FIX 7: Compact progress bar */}
      <div className="max-w-2xl mx-auto px-4 py-3">
        <div className="flex items-center gap-0">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ backgroundColor: idx < progressStep ? '#22c55e' : idx === progressStep ? '#F97316' : '#d1d5db', color: idx <= progressStep ? 'white' : '#6b7280' }}>
                  {idx < progressStep ? '✓' : idx + 1}
                </div>
                <div className="text-[10px] mt-0.5 text-center leading-tight"
                  style={{ color: idx < progressStep ? '#22c55e' : idx === progressStep ? '#F97316' : '#9ca3af', fontWeight: idx === progressStep ? 600 : 400 }}>
                  {step}
                </div>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="h-0.5 flex-1 mb-4" style={{ backgroundColor: idx < progressStep ? '#22c55e' : '#d1d5db' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT — FIX 7: compact spacing */}
      <div className="max-w-2xl mx-auto px-4 pb-10 space-y-3">

        {/* SEGMENT SELECTOR — FIX 4: horizontal layout */}
        <div id="segment-selector" className="bg-white rounded-2xl shadow-sm p-4">
          <h2 className="font-bold text-sm mb-2" style={{ color: '#1B2E5E' }}>Step 1 — Who are you?</h2>
          <div className="space-y-2">
            {SEGMENT_OPTIONS.map(opt => (
              <button key={opt.id} type="button" onClick={() => setSegment(opt.id)}
                className="w-full rounded-xl border-2 px-3 py-2.5 text-left transition-all flex items-center gap-3"
                style={{ borderColor: segment === opt.id ? '#1B2E5E' : '#e5e7eb', backgroundColor: segment === opt.id ? '#eef2ff' : 'white' }}>
                <div className="text-2xl flex-shrink-0">{opt.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm" style={{ color: segment === opt.id ? '#1B2E5E' : '#374151' }}>{opt.label}</div>
                  <div className="text-gray-400 text-xs truncate">{opt.subtitle}</div>
                </div>
                {segment === opt.id && <div className="text-xs font-bold flex-shrink-0" style={{ color: '#1B2E5E' }}>✓</div>}
              </button>
            ))}
          </div>
        </div>

        {/* DETAILS FORM — FIX 7: compact */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <h2 className="font-bold text-sm mb-3" style={{ color: '#1B2E5E' }}>Step 2 — Your details</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
              <input type="text" name="name" value={form.name} onChange={handleFormChange} placeholder="Rahul Sharma"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#1B2E5E]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email Address *</label>
              <input type="email" name="email" value={form.email} onChange={handleFormChange} placeholder="rahul@yourbrand.com"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#1B2E5E]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp Number *</label>
              <div className="flex">
                <span className="flex items-center px-3 py-2.5 rounded-l-xl border border-r-0 border-gray-200 text-gray-500 text-xs bg-gray-50">🇮🇳 +91</span>
                <input type="tel" name="phone" value={form.phone} onChange={handleFormChange} placeholder="9876543210" maxLength={10}
                  className="flex-1 border border-gray-200 rounded-r-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#1B2E5E]" />
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">We send your pack via WhatsApp for instant access</p>
            </div>

            {/* BUMP 1 — FIX 5: checkbox UI, pre-selected */}
            <div className="rounded-xl border-2 p-3.5 transition-all cursor-pointer"
              style={{ borderColor: bump1 ? '#F97316' : '#fed7aa', backgroundColor: bump1 ? '#fff7ed' : '#fffbf7' }}
              onClick={() => setBump1(v => !v)}>
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all"
                  style={{ borderColor: bump1 ? '#F97316' : '#d1d5db', backgroundColor: bump1 ? '#F97316' : 'white' }}>
                  {bump1 && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#F97316' }}>⚡ One-Time Upgrade — Only ₹199</div>
                  <div className="font-bold text-sm" style={{ color: '#1B2E5E' }}>Add the Advanced D2C Growth Kit</div>
                  <div className="flex gap-1.5 my-2 overflow-x-auto">
                    {['📄 Ad Templates', '📊 Landing Page', '✅ Checklist', '💬 WA Sequences'].map(doc => (
                      <div key={doc} className="flex-shrink-0 rounded px-2 py-1 text-[10px] font-medium"
                        style={{ backgroundColor: '#fff', border: '1px solid #fed7aa', color: '#92400e' }}>{doc}</div>
                    ))}
                  </div>
                  <ul className="space-y-1 text-xs text-gray-600">
                    <li>📊 15+ proven Meta ad templates used by top Indian D2C brands</li>
                    <li>📄 Landing page swipe file — 8 high-converting breakdowns</li>
                    <li>✅ 47-point checklist before you launch any campaign</li>
                    <li>💬 WhatsApp follow-up sequence templates</li>
                  </ul>
                  <div className="mt-2 text-xs text-gray-500">
                    <span className="line-through">₹999 separately.</span>
                    <span style={{ color: '#F97316' }} className="font-semibold"> Today only: ₹199</span>
                  </div>
                </div>
              </div>
            </div>

            {/* BUMP 2 — FIX 5: checkbox UI, pre-selected */}
            <div className="rounded-xl border-2 p-3.5 transition-all cursor-pointer"
              style={{ borderColor: bump2 ? '#1B2E5E' : '#c7d2fe', backgroundColor: bump2 ? '#eef2ff' : '#f8f9ff' }}
              onClick={() => setBump2(v => !v)}>
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all"
                  style={{ borderColor: bump2 ? '#1B2E5E' : '#d1d5db', backgroundColor: bump2 ? '#1B2E5E' : 'white' }}>
                  {bump2 && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#1B2E5E' }}>🎯 Expert Guidance — Only ₹499</div>
                  <div className="font-bold text-sm" style={{ color: '#1B2E5E' }}>Book a Private 45-min Audit Call with Jatin</div>
                  <div className="flex items-center gap-2.5 mt-2 mb-2 p-2 rounded-lg" style={{ backgroundColor: 'white', border: '1px solid #e0e7ff' }}>
                    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: '#1B2E5E' }}>J</div>
                    <div>
                      <div className="font-semibold text-xs" style={{ color: '#1B2E5E' }}>Jatin Agrawal</div>
                      <div className="text-[10px] text-gray-500">₹15Cr+ in Meta ad spend · Founder, GE</div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">
                    Jatin reviews your Meta account live and gives you 3 specific fixes you can implement the same day.
                  </p>
                  <ul className="space-y-1 text-xs text-gray-600">
                    <li>🔍 Live review of your Meta ads account</li>
                    <li>📋 3 specific fixes you can implement same day</li>
                    <li>🗺️ Personalised roadmap for your situation</li>
                  </ul>
                  <div className="mt-1.5 text-[10px] font-semibold" style={{ color: '#F97316' }}>⏰ Only with this purchase — not sold separately</div>
                </div>
              </div>
            </div>

            {/* GUARANTEE — FIX 7: compact */}
            <div className="rounded-xl p-3 flex items-center gap-2.5" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div className="text-xl">🛡️</div>
              <div>
                <div className="font-bold text-xs" style={{ color: '#166534' }}>30-Day Money-Back Guarantee</div>
                <div className="text-[10px] text-green-700 mt-0.5">Don't find value? Email us and we'll refund every rupee. No questions.</div>
              </div>
            </div>

            {/* ORDER SUMMARY */}
            <div className="rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2" style={{ backgroundColor: '#1B2E5E' }}>
                <h3 className="font-bold text-white text-xs">Order Summary</h3>
              </div>
              <div className="bg-white px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>D2C Funnel Breakdown Pack</span>
                  <span className="font-medium text-gray-800">₹9</span>
                </div>
                {bump1 && (
                  <div className="flex justify-between" style={{ color: '#F97316' }}>
                    <span>Advanced D2C Growth Kit</span>
                    <span className="font-medium">₹199</span>
                  </div>
                )}
                {bump2 && (
                  <div className="flex justify-between" style={{ color: '#1B2E5E' }}>
                    <span>45-min Audit Call with Jatin</span>
                    <span className="font-medium">₹499</span>
                  </div>
                )}
                <div className="border-t border-gray-100 pt-1.5 flex justify-between font-bold text-base" style={{ color: '#1B2E5E' }}>
                  <span>Total</span>
                  <span>₹{total}</span>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
            )}

            {/* PAY BUTTON */}
            <button type="submit" disabled={loading}
              className="w-full font-bold text-lg rounded-2xl py-4 transition-all shadow-lg"
              style={{ backgroundColor: loading ? '#fdba74' : '#F97316', color: 'white', opacity: loading ? 0.8 : 1 }}>
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Processing…
                </span>
              ) : `Complete My Order — ₹${total} →`}
            </button>

            <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-gray-400 pt-0.5">
              <span>🔒 Cashfree Secured</span>
              <span>⚡ Instant WhatsApp Delivery</span>
              <span>💯 30-Day Guarantee</span>
              <span>🇮🇳 Made for Indian Founders</span>
            </div>
          </form>
        </div>
      </div>

      {/* FIX 3: Floating social proof popup — bottom-left */}
      <div
        className="fixed z-50 transition-all duration-500"
        style={{
          bottom: tickerVisible ? '20px' : '-100px',
          left: '20px',
          maxWidth: '280px',
          opacity: tickerVisible ? 1 : 0,
          pointerEvents: 'none',
        }}
      >
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-4 py-3 text-sm">
          <span>🎉 {tickerName} just grabbed this pack{tickerTime}</span>
        </div>
      </div>
    </div>
  );
}
