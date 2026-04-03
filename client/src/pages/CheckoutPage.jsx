import { useState, useEffect } from 'react';
import { initiateCashfreePayment } from '../services/cashfree';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SEGMENT_OPTIONS = [
  {
    id: 'd2c',
    label: 'I run a D2C Brand',
    subtitle: 'I sell products online and run Meta/Google ads',
    icon: '🛍️',
  },
  {
    id: 'agency',
    label: 'I run an Agency',
    subtitle: 'I manage performance marketing for clients',
    icon: '🏢',
  },
  {
    id: 'freelancer',
    label: 'I am a Freelancer',
    subtitle: 'I do performance marketing independently',
    icon: '💻',
  },
];

const TICKER_NAMES = [
  'Rahul from Mumbai',
  'Priya from Bengaluru',
  'Aman from Delhi',
  'Sneha from Pune',
  'Karan from Hyderabad',
  'Divya from Chennai',
  'Rohit from Jaipur',
  'Ananya from Kolkata',
  'Vikas from Surat',
  'Neha from Ahmedabad',
];

// ---------------------------------------------------------------------------
// Progress steps
// ---------------------------------------------------------------------------
const STEPS = ['Who are you?', 'Your details', 'Upgrade', 'Pay'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CheckoutPage() {
  const [segment, setSegment] = useState(null);
  const [bump1, setBump1] = useState(false);
  const [bump2, setBump2] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tickerIdx, setTickerIdx] = useState(0);
  const [tickerData, setTickerData] = useState(null); // { name, city, minutesAgo }

  // Ticker — fetch from API every 30s, rotate display every 4s
  useEffect(() => {
    const fetchTicker = async () => {
      try {
        const res = await fetch('/api/funnel/recent-purchase');
        const data = await res.json();
        if (data.name && data.city && data.minutes_ago) {
          setTickerData({
            name: data.name,
            city: data.city,
            minutesAgo: Math.max(1, Math.round(data.minutes_ago)),
          });
        }
      } catch {
        // Keep current display on error
      }
    };

    fetchTicker(); // Fetch immediately on mount
    const fetchId = setInterval(fetchTicker, 30000); // Re-fetch every 30s
    const rotateId = setInterval(() => {
      setTickerIdx((i) => (i + 1) % TICKER_NAMES.length);
    }, 4000);

    return () => {
      clearInterval(fetchId);
      clearInterval(rotateId);
    };
  }, []);

  // Progress step: 0-based
  // step 0 = select segment, step 1 = fill details, step 2 = upgrades, step 3 = pay
  // For display: step 1 complete once segment chosen, step 2 active while filling form
  const progressStep = segment ? 1 : 0;

  const total = 9 + (bump1 ? 199 : 0) + (bump2 ? 499 : 0);

  function handleFormChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!segment) {
      setError('Please select who you are before continuing.');
      document.getElementById('segment-selector')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (form.name.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(form.phone.trim())) {
      setError('Please enter a valid 10-digit WhatsApp number.');
      return;
    }

    // Persist to sessionStorage so ThankYouPage can redirect correctly
    sessionStorage.setItem('ge_segment', segment);
    sessionStorage.setItem('ge_bump1', bump1 ? '1' : '0');
    sessionStorage.setItem('ge_bump2', bump2 ? '1' : '0');
    sessionStorage.setItem('ge_name', form.name.trim());
    sessionStorage.setItem('ge_email', form.email.trim());
    sessionStorage.setItem('ge_purchased', 'true');

    setLoading(true);
    try {
      await initiateCashfreePayment({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        amount: total,
        segment,
        bump1,
        bump2,
      });
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef1f8', fontFamily: 'Inter, sans-serif' }}>

      {/* -------------------------------------------------------------------- */}
      {/* NAV BAR */}
      {/* -------------------------------------------------------------------- */}
      <nav style={{ backgroundColor: '#1B2E5E' }} className="py-3 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="text-white font-bold text-lg tracking-tight">
            Growth<span style={{ color: '#F97316' }}>Escalators</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-white/80">
              <span>🔒</span> Secure
            </span>
            <span className="flex items-center gap-1 text-white/80">
              <span>✅</span> Instant Delivery
            </span>
          </div>
        </div>
      </nav>

      {/* -------------------------------------------------------------------- */}
      {/* HERO STRIP */}
      {/* -------------------------------------------------------------------- */}
      <div style={{ backgroundColor: '#1B2E5E' }} className="px-4 pb-6 pt-4">
        <div className="max-w-2xl mx-auto text-center">
          <div
            className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3"
            style={{ backgroundColor: '#F97316', color: 'white' }}
          >
            📦 Top 5 D2C Brand Funnel Breakdown
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-white leading-snug">
            You are{' '}
            <span style={{ color: '#F97316' }}>60 seconds away</span>{' '}
            from the funnel framework that helps Indian brands scale past{' '}
            <span style={{ color: '#F97316' }}>₹10L/month on Meta</span>
          </h1>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-4 text-sm text-white/70">
            <span>🔒 Secured by Cashfree</span>
            <span>⚡ Instant WhatsApp Delivery</span>
            <span>💯 30-Day Money-Back</span>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* SOCIAL PROOF TICKER */}
      {/* -------------------------------------------------------------------- */}
      <div style={{ backgroundColor: '#F97316' }} className="py-2 px-4 text-center text-white text-sm font-medium">
        🎉{' '}
        <span key={tickerData ? `api-${tickerData.name}` : tickerIdx} className="inline-block transition-opacity duration-500">
          {tickerData
            ? `${tickerData.name} from ${tickerData.city}`
            : TICKER_NAMES[tickerIdx]}
        </span>{' '}
        just grabbed this pack
        {tickerData && (
          <span className="opacity-75"> · {tickerData.minutesAgo} min ago</span>
        )}
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* PROGRESS BAR */}
      {/* -------------------------------------------------------------------- */}
      <div className="max-w-2xl mx-auto px-4 py-5">
        <div className="flex items-center gap-0">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{
                    backgroundColor:
                      idx < progressStep
                        ? '#22c55e'
                        : idx === progressStep
                        ? '#F97316'
                        : '#d1d5db',
                    color: idx <= progressStep ? 'white' : '#6b7280',
                  }}
                >
                  {idx < progressStep ? '✓' : idx + 1}
                </div>
                <div
                  className="text-xs mt-1 text-center leading-tight"
                  style={{
                    color:
                      idx < progressStep
                        ? '#22c55e'
                        : idx === progressStep
                        ? '#F97316'
                        : '#9ca3af',
                    fontWeight: idx === progressStep ? 600 : 400,
                  }}
                >
                  {step}
                </div>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className="h-0.5 flex-1 mb-5 transition-all"
                  style={{ backgroundColor: idx < progressStep ? '#22c55e' : '#d1d5db' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* MAIN CONTENT */}
      {/* -------------------------------------------------------------------- */}
      <div className="max-w-2xl mx-auto px-4 pb-12 space-y-5">

        {/* ------------------------------------------------------------------ */}
        {/* CARD A — SEGMENT SELECTOR */}
        {/* ------------------------------------------------------------------ */}
        <div id="segment-selector" className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-bold text-base mb-1" style={{ color: '#1B2E5E' }}>
            Step 1 — Who are you?
          </h2>
          <p className="text-gray-500 text-sm mb-4">Select the option that best describes you</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SEGMENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSegment(opt.id)}
                className="rounded-xl border-2 p-4 text-left transition-all"
                style={{
                  borderColor: segment === opt.id ? '#1B2E5E' : '#e5e7eb',
                  backgroundColor: segment === opt.id ? '#eef2ff' : 'white',
                }}
              >
                <div className="text-2xl mb-2">{opt.icon}</div>
                <div
                  className="font-semibold text-sm"
                  style={{ color: segment === opt.id ? '#1B2E5E' : '#374151' }}
                >
                  {opt.label}
                </div>
                <div className="text-gray-400 text-xs mt-1">{opt.subtitle}</div>
                {segment === opt.id && (
                  <div className="text-xs font-bold mt-2" style={{ color: '#1B2E5E' }}>
                    ✓ Selected
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* CARD B — DETAILS FORM */}
        {/* ------------------------------------------------------------------ */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-bold text-base mb-4" style={{ color: '#1B2E5E' }}>
            Step 2 — Your details
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Full Name *</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleFormChange}
                placeholder="Rahul Sharma"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none transition-all"
                style={{ fontSize: '15px' }}
                onFocus={(e) => { e.target.style.borderColor = '#1B2E5E'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email Address *</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleFormChange}
                placeholder="rahul@yourbrand.com"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none transition-all"
                style={{ fontSize: '15px' }}
                onFocus={(e) => { e.target.style.borderColor = '#1B2E5E'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
              />
            </div>

            {/* WhatsApp */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">WhatsApp Number *</label>
              <div className="flex">
                <span
                  className="flex items-center px-4 py-3 rounded-l-xl border border-r-0 border-gray-200 text-gray-500 text-sm bg-gray-50"
                >
                  🇮🇳 +91
                </span>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleFormChange}
                  placeholder="9876543210"
                  maxLength={10}
                  className="flex-1 border border-gray-200 rounded-r-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none transition-all"
                  style={{ fontSize: '15px' }}
                  onFocus={(e) => { e.target.style.borderColor = '#1B2E5E'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">We send your pack via WhatsApp for instant access</p>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* BUMP 1 — Growth Kit ₹199 */}
            {/* ---------------------------------------------------------------- */}
            <div
              className="rounded-2xl border-2 p-5 transition-all cursor-pointer"
              style={{
                borderColor: bump1 ? '#F97316' : '#fed7aa',
                backgroundColor: bump1 ? '#fff7ed' : '#fffbf7',
              }}
              onClick={() => setBump1((v) => !v)}
            >
              {/* Header row */}
              <div className="flex items-start gap-3">
                {/* Toggle */}
                <div
                  className="mt-0.5 w-11 h-6 rounded-full flex-shrink-0 flex items-center transition-all"
                  style={{
                    backgroundColor: bump1 ? '#F97316' : '#d1d5db',
                    padding: '2px',
                  }}
                  onClick={(e) => { e.stopPropagation(); setBump1((v) => !v); }}
                >
                  <div
                    className="w-5 h-5 bg-white rounded-full shadow transition-all"
                    style={{ transform: bump1 ? 'translateX(20px)' : 'translateX(0)' }}
                  />
                </div>

                <div className="flex-1">
                  <div
                    className="text-xs font-bold uppercase tracking-widest mb-1"
                    style={{ color: '#F97316' }}
                  >
                    ⚡ One-Time Upgrade — Only ₹199
                  </div>
                  <div className="font-bold text-base" style={{ color: '#1B2E5E' }}>
                    Add the Advanced D2C Growth Kit
                  </div>

                  {/* Document thumbnail strip */}
                  <div className="flex gap-2 my-3 overflow-x-auto pb-1">
                    {['📄 Ad Templates', '📊 Landing Page', '✅ Launch Checklist', '💬 WA Sequences'].map((doc) => (
                      <div
                        key={doc}
                        className="flex-shrink-0 rounded-lg px-3 py-2 text-xs font-medium"
                        style={{ backgroundColor: '#fff', border: '1px solid #fed7aa', color: '#92400e' }}
                      >
                        {doc}
                      </div>
                    ))}
                  </div>

                  <ul className="space-y-1.5 text-sm text-gray-600">
                    <li>📊 15+ proven Meta ad templates used by top Indian D2C brands</li>
                    <li>📄 Landing page swipe file — 8 high-converting breakdowns</li>
                    <li>✅ 47-point checklist before you launch any campaign</li>
                    <li>💬 WhatsApp follow-up sequence templates</li>
                  </ul>
                  <div className="mt-3 text-sm text-gray-500">
                    <span className="line-through">₹999 separately.</span>
                    <span style={{ color: '#F97316' }} className="font-semibold"> Today only: ₹199</span>
                  </div>
                </div>
              </div>

              {!bump1 && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    className="text-xs text-gray-400 underline"
                    onClick={(e) => { e.stopPropagation(); }}
                  >
                    No thanks, I don't need templates or checklists
                  </button>
                </div>
              )}
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* BUMP 2 — Audit Call ₹499 */}
            {/* ---------------------------------------------------------------- */}
            <div
              className="rounded-2xl border-2 p-5 transition-all cursor-pointer"
              style={{
                borderColor: bump2 ? '#1B2E5E' : '#c7d2fe',
                backgroundColor: bump2 ? '#eef2ff' : '#f8f9ff',
              }}
              onClick={() => setBump2((v) => !v)}
            >
              <div className="flex items-start gap-3">
                {/* Toggle */}
                <div
                  className="mt-0.5 w-11 h-6 rounded-full flex-shrink-0 flex items-center transition-all"
                  style={{
                    backgroundColor: bump2 ? '#1B2E5E' : '#d1d5db',
                    padding: '2px',
                  }}
                  onClick={(e) => { e.stopPropagation(); setBump2((v) => !v); }}
                >
                  <div
                    className="w-5 h-5 bg-white rounded-full shadow transition-all"
                    style={{ transform: bump2 ? 'translateX(20px)' : 'translateX(0)' }}
                  />
                </div>

                <div className="flex-1">
                  <div
                    className="text-xs font-bold uppercase tracking-widest mb-1"
                    style={{ color: '#1B2E5E' }}
                  >
                    🎯 Expert Guidance — Only ₹499
                  </div>
                  <div className="font-bold text-base" style={{ color: '#1B2E5E' }}>
                    Book a Private 15-min Audit Call with Jatin
                  </div>

                  {/* Jatin social proof block */}
                  <div
                    className="flex items-center gap-3 mt-3 mb-3 p-3 rounded-xl"
                    style={{ backgroundColor: 'white', border: '1px solid #e0e7ff' }}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: '#1B2E5E' }}
                    >
                      J
                    </div>
                    <div>
                      <div className="font-semibold text-sm" style={{ color: '#1B2E5E' }}>Jatin Agrawal</div>
                      <div className="text-xs text-gray-500">₹15Cr+ in Meta ad spend managed · Founder, Growth Escalators</div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 mb-3">
                    Most agencies charge ₹5,000+ for an ads audit. Jatin reviews your Meta account live and
                    gives you 3 specific fixes you can implement the same day.
                  </p>
                  <ul className="space-y-1.5 text-sm text-gray-600">
                    <li>🔍 Live review of your Meta ads account</li>
                    <li>📋 3 specific fixes you can implement same day</li>
                    <li>🗺️ Personalised next-step roadmap for your situation</li>
                  </ul>
                  <div className="mt-2 text-xs font-semibold" style={{ color: '#F97316' }}>
                    ⏰ Only available with this purchase — not sold separately
                  </div>
                </div>
              </div>

              {!bump2 && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    className="text-xs text-gray-400 underline"
                    onClick={(e) => { e.stopPropagation(); }}
                  >
                    No thanks, I prefer to figure it out alone
                  </button>
                </div>
              )}
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* MONEY-BACK GUARANTEE */}
            {/* ---------------------------------------------------------------- */}
            <div
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}
            >
              <div className="text-2xl">🛡️</div>
              <div>
                <div className="font-bold text-sm" style={{ color: '#166534' }}>
                  30-Day Money-Back Guarantee
                </div>
                <div className="text-xs text-green-700 mt-0.5">
                  If you don't find value in the first 30 days, email us and we'll refund every rupee. No questions asked.
                </div>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* ORDER SUMMARY */}
            {/* ---------------------------------------------------------------- */}
            <div className="rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3" style={{ backgroundColor: '#1B2E5E' }}>
                <h3 className="font-bold text-white text-sm">Order Summary</h3>
              </div>
              <div className="bg-white px-5 py-4 space-y-2 text-sm">
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
                    <span>15-min Audit Call with Jatin</span>
                    <span className="font-medium">₹499</span>
                  </div>
                )}
                <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-base" style={{ color: '#1B2E5E' }}>
                  <span>Total</span>
                  <span>₹{total}</span>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* PAY BUTTON */}
            {/* ---------------------------------------------------------------- */}
            <button
              type="submit"
              disabled={loading}
              className="w-full font-bold text-lg rounded-2xl py-4 transition-all shadow-lg"
              style={{
                backgroundColor: loading ? '#fdba74' : '#F97316',
                color: 'white',
                opacity: loading ? 0.8 : 1,
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Processing…
                </span>
              ) : (
                `Complete My Order — ₹${total} →`
              )}
            </button>

            {/* Trust footer */}
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400 pt-1">
              <span>🔒 Cashfree Secured</span>
              <span>⚡ Instant WhatsApp Delivery</span>
              <span>💯 30-Day Guarantee</span>
              <span>🇮🇳 Made for Indian Founders</span>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}
