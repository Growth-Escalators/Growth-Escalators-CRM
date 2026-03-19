import { useState } from 'react';
import { initiateCashfreePayment } from '../services/cashfree';

const SEGMENT_OPTIONS = [
  {
    id: 'ecom_brand',
    label: 'I run a D2C Brand',
    subtitle: 'I sell products online and run Meta ads',
    icon: '🛍️',
    color: 'border-orange-500 bg-orange-500/10',
    labelColor: 'text-orange-400',
  },
  {
    id: 'agency_owner',
    label: 'I am an Agency Owner',
    subtitle: 'I manage Meta ads for clients',
    icon: '🏢',
    color: 'border-blue-500 bg-blue-500/10',
    labelColor: 'text-blue-400',
  },
  {
    id: 'freelancer',
    label: 'I am a Freelancer',
    subtitle: 'I do performance marketing independently',
    icon: '💻',
    color: 'border-purple-500 bg-purple-500/10',
    labelColor: 'text-purple-400',
  },
];

export default function CheckoutPage() {
  const [segment, setSegment] = useState(null);
  const [bump1, setBump1] = useState(false);
  const [bump2, setBump2] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-screen bg-[#030712] text-white">
      {/* ------------------------------------------------------------------ */}
      {/* HEADER */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-[#0f172a] border-b border-white/10 py-6 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-orange-400 text-sm font-semibold uppercase tracking-widest mb-2">
            📦 Top 5 D2C Brand Funnel Breakdown
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-white leading-tight">
            You are 60 seconds away from the D2C funnel framework that scales Indian brands past ₹10L/month on Meta
          </h1>
          <div className="flex items-center justify-center gap-6 mt-4 text-sm text-gray-400">
            <span className="flex items-center gap-1">🔒 Secure Payment</span>
            <span className="flex items-center gap-1">✅ 30-Day Guarantee</span>
            <span className="flex items-center gap-1">⚡ Instant Delivery</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* ---------------------------------------------------------------- */}
        {/* SEGMENT SELECTOR */}
        {/* ---------------------------------------------------------------- */}
        <div id="segment-selector">
          <h2 className="text-lg font-bold mb-1">First — who are you?</h2>
          <p className="text-gray-400 text-sm mb-4">Select the option that best describes you</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {SEGMENT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSegment(opt.id)}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  segment === opt.id
                    ? opt.color
                    : 'border-white/10 bg-white/5 hover:border-white/30'
                }`}
              >
                <div className="text-2xl mb-2">{opt.icon}</div>
                <div className={`font-semibold text-sm ${segment === opt.id ? opt.labelColor : 'text-white'}`}>
                  {opt.label}
                </div>
                <div className="text-gray-400 text-xs mt-1">{opt.subtitle}</div>
                {segment === opt.id && (
                  <div className={`text-xs font-bold mt-2 ${opt.labelColor}`}>✓ Selected</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* CUSTOMER DETAILS FORM */}
        {/* ---------------------------------------------------------------- */}
        <div>
          <h2 className="text-lg font-bold mb-4">Your details</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Full Name *</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleFormChange}
                placeholder="Rahul Sharma"
                className="w-full bg-[#0f172a] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email Address *</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleFormChange}
                placeholder="rahul@yourbrand.com"
                className="w-full bg-[#0f172a] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">WhatsApp Number *</label>
              <div className="flex">
                <span className="bg-[#1e293b] border border-r-0 border-white/20 rounded-l-lg px-4 py-3 text-gray-400 text-sm flex items-center">
                  🇮🇳 +91
                </span>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleFormChange}
                  placeholder="9876543210"
                  maxLength={10}
                  className="flex-1 bg-[#0f172a] border border-white/20 rounded-r-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">We send your pack via WhatsApp for instant access</p>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* ORDER BUMP 1 — ₹199 Growth Kit */}
            {/* -------------------------------------------------------------- */}
            <div
              className={`rounded-xl border-2 p-5 transition-all cursor-pointer ${
                bump1 ? 'border-orange-500 bg-orange-500/10' : 'border-orange-500/40 bg-orange-500/5'
              }`}
              onClick={() => setBump1((v) => !v)}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={bump1}
                  onChange={(e) => { e.stopPropagation(); setBump1((v) => !v); }}
                  className="mt-1 w-5 h-5 accent-orange-500 cursor-pointer flex-shrink-0"
                />
                <div>
                  <div className="text-orange-400 text-xs font-bold uppercase tracking-widest mb-1">
                    ⚡ Special One-Time Offer
                  </div>
                  <div className="font-bold text-base text-white">
                    YES — Add the Growth Kit for just ₹199 more
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm text-gray-300">
                    <li>📊 15+ proven Meta ad templates used by top Indian D2C brands</li>
                    <li>📄 Landing page swipe file — 8 high-converting page breakdowns</li>
                    <li>✅ Meta ads checklist — 47 checkpoints before you launch any campaign</li>
                    <li>💬 Bonus: WhatsApp follow-up sequence templates</li>
                  </ul>
                  <div className="mt-3 text-sm text-gray-400">
                    <span className="line-through">Sold separately this would be ₹999.</span>
                    <span className="text-orange-400 font-semibold"> Today only: ₹199 added to your order</span>
                  </div>
                </div>
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* ORDER BUMP 2 — ₹499 Growth Audit (two copy variants) */}
            {/* -------------------------------------------------------------- */}
            <div
              className={`rounded-xl border-2 p-5 transition-all cursor-pointer ${
                bump2 ? 'border-green-500 bg-green-500/10' : 'border-green-500/40 bg-green-500/5'
              }`}
              onClick={() => setBump2((v) => !v)}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={bump2}
                  onChange={(e) => { e.stopPropagation(); setBump2((v) => !v); }}
                  className="mt-1 w-5 h-5 accent-green-500 cursor-pointer flex-shrink-0"
                />
                <div>
                  <div className="text-green-400 text-xs font-bold uppercase tracking-widest mb-1">
                    🎯 Personalised Guidance
                  </div>
                  {bump1 ? (
                    <>
                      <div className="font-bold text-base text-white">
                        Complete your growth toolkit with a personal audit
                      </div>
                      <div className="text-sm text-orange-300 font-semibold mt-0.5">
                        Add a 15-minute 1-on-1 Audit Call with Jatin — ₹499
                      </div>
                      <p className="mt-2 text-sm text-gray-300">
                        You now have the framework and the templates. The fastest way to put them to work is
                        having Jatin review your specific account and tell you the 3 things to fix immediately.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="font-bold text-base text-white">
                        Get personalised guidance worth 10x your ad spend
                      </div>
                      <div className="text-sm text-green-300 font-semibold mt-0.5">
                        Book a Private 15-min Audit Call with Jatin — only ₹499
                      </div>
                      <p className="mt-2 text-sm text-gray-300">
                        Most agencies charge ₹5,000+ for an ads audit. Jatin will review your Meta ads account
                        live and give you 3 specific, actionable fixes you can implement today.
                      </p>
                    </>
                  )}
                  <ul className="mt-3 space-y-1.5 text-sm text-gray-300">
                    <li>🔍 Live review of your Meta ads account</li>
                    <li>📋 3 specific fixes you can implement the same day</li>
                    <li>🗺️ Personalised next-step roadmap for your situation</li>
                  </ul>
                  <div className="mt-2 text-xs text-yellow-400 font-semibold">
                    ⏰ Only available with this purchase
                  </div>
                </div>
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* ORDER SUMMARY + PAY BUTTON */}
            {/* -------------------------------------------------------------- */}
            <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5">
              <h3 className="font-bold text-base mb-3">Order Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-300">
                  <span>D2C Funnel Breakdown Pack</span>
                  <span>₹9</span>
                </div>
                {bump1 && (
                  <div className="flex justify-between text-orange-400">
                    <span>Advanced D2C Growth Kit</span>
                    <span>₹199</span>
                  </div>
                )}
                {bump2 && (
                  <div className="flex justify-between text-green-400">
                    <span>15-min Personalised Growth Audit</span>
                    <span>₹499</span>
                  </div>
                )}
                <div className="border-t border-white/10 pt-2 flex justify-between font-bold text-base text-white">
                  <span>Total</span>
                  <span>₹{total}</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/40 text-red-400 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold text-lg rounded-xl py-4 transition-all cta-pulse"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                `Complete My Order — ₹${total}`
              )}
            </button>

            <p className="text-center text-xs text-gray-500">
              🔒 Secured by Cashfree · Instant delivery after payment · 30-day money-back guarantee
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
