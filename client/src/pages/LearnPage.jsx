import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PurchaseToast from '../components/PurchaseToast';

const CURRICULUM = [
  { week: 'Week 1', title: 'D2C Funnel Fundamentals', desc: 'TOF/MOF/BOF architecture, ad-to-landing synergy, and offer framing' },
  { week: 'Week 2', title: 'Meta Ads Mastery', desc: 'Campaign structure, creative testing frameworks, and ROAS optimisation' },
  { week: 'Week 3', title: 'Client Acquisition', desc: 'How to land your first D2C retainer client — positioning, pitch deck, pricing' },
  { week: 'Week 4', title: 'Delivery & Retention', desc: 'Reporting, communication cadence, and turning clients into long-term retainers' },
];

export default function LearnPage() {
  const [searchParams] = useSearchParams();
  const prefillName  = searchParams.get('name') || '';
  const prefillEmail = searchParams.get('email') || '';

  const [name, setName]       = useState(prefillName);
  const [email, setEmail]     = useState(prefillEmail);
  const [submitted, setSubmitted] = useState(false);
  const [count, setCount]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [showToast, setShowToast] = useState(false);

  // Show post-purchase toast if user arrived via the purchase funnel
  useEffect(() => {
    const justPurchased = sessionStorage.getItem('ge_purchased') === 'true';
    if (justPurchased) {
      sessionStorage.removeItem('ge_purchased'); // Clear immediately — only shows once
      setShowToast(true);
    }
  }, []);

  // Fetch current waitlist count on mount
  useEffect(() => {
    fetch('/api/funnel/waitlist-count')
      .then((r) => r.json())
      .then((d) => setCount(d.count ?? null))
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) { setError('Please enter your name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/funnel/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), source: 'learn_page' }),
      });
      if (!res.ok) throw new Error('Failed to join');
      const data = await res.json();
      setCount(data.count ?? count);
      setSubmitted(true);
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* NAV */}
      <nav style={{ backgroundColor: '#1B2E5E' }} className="py-3 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-white font-bold text-lg tracking-tight">
            Growth<span style={{ color: '#F97316' }}>Escalators</span>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <div style={{ backgroundColor: '#1B2E5E' }} className="text-white py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div
            className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4"
            style={{ backgroundColor: '#F97316', color: 'white' }}
          >
            For Freelancers
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            {prefillName ? `${prefillName}, land ` : 'Land '}your first ₹25,000/month D2C performance marketing client
          </h1>
          <p className="text-lg text-gray-300 mb-6">
            A 4-week intensive that takes you from freelancer to in-demand D2C ads specialist — with your first retainer before you finish.
          </p>

          {count !== null && (
            <div
              className="inline-block text-sm font-semibold px-4 py-2 rounded-full mb-4"
              style={{ backgroundColor: 'rgba(249,115,22,0.2)', color: '#fb923c' }}
            >
              🔥 {count} freelancers already on the waitlist
            </div>
          )}

          {/* Order confirmation */}
          <div className="inline-block text-left bg-white/10 rounded-xl p-5 space-y-2 text-sm mt-2">
            <div className="text-white font-semibold mb-1">✅ Your purchase is confirmed</div>
            <div className="text-gray-300">📦 D2C Funnel Breakdown Pack delivered to your WhatsApp &amp; email</div>
          </div>
        </div>
      </div>

      {/* CURRICULUM */}
      <div className="py-16 px-4" style={{ backgroundColor: '#f8f9ff' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10" style={{ color: '#1B2E5E' }}>
            What you'll learn
          </h2>
          <div className="space-y-4">
            {CURRICULUM.map((c) => (
              <div key={c.week} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex gap-4">
                <div
                  className="flex-shrink-0 text-xs font-bold px-3 py-1 rounded-full h-fit"
                  style={{ backgroundColor: '#eef2ff', color: '#1B2E5E' }}
                >
                  {c.week}
                </div>
                <div>
                  <div className="font-bold text-gray-900">{c.title}</div>
                  <div className="text-gray-500 text-sm mt-0.5">{c.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* WAITLIST FORM */}
      <div className="py-16 px-4 bg-white">
        <div className="max-w-lg mx-auto">
          {submitted ? (
            <div className="text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold mb-2" style={{ color: '#1B2E5E' }}>You're on the waitlist!</h2>
              <p className="text-gray-500 mb-4">
                We'll email you at <span className="font-semibold text-gray-700">{email}</span> when the cohort opens.
              </p>
              {count !== null && (
                <p className="text-sm font-medium" style={{ color: '#F97316' }}>
                  You're among {count} freelancers waiting.
                </p>
              )}
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-center mb-2" style={{ color: '#1B2E5E' }}>
                Join the waitlist
              </h2>
              <p className="text-gray-500 text-center text-sm mb-8">
                First cohort opens when we hit 50 people. Get early access and founding-member pricing.
              </p>

              {count !== null && (
                <div className="mb-6">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{count} / 50 spots</span>
                    <span>{Math.round((count / 50) * 100)}% full</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min((count / 50) * 100, 100)}%`, backgroundColor: '#F97316' }}
                    />
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Your Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Priya Sharma"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none"
                    onFocus={(e) => { e.target.style.borderColor = '#1B2E5E'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="priya@gmail.com"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-800 placeholder-gray-400 focus:outline-none"
                    onFocus={(e) => { e.target.style.borderColor = '#1B2E5E'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#e5e7eb'; }}
                  />
                </div>

                {error && (
                  <div className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 border border-red-100">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full font-bold text-lg rounded-2xl py-4 text-white transition-all"
                  style={{ backgroundColor: loading ? '#fdba74' : '#F97316' }}
                >
                  {loading ? 'Joining…' : 'Join the Waitlist →'}
                </button>

                <p className="text-center text-xs text-gray-400">
                  No spam. Just one email when the cohort opens.
                </p>
              </form>
            </>
          )}
        </div>
      </div>

      {/* FOOTER */}
      <div className="py-8 px-4 bg-gray-100 text-center">
        <p className="text-gray-600 font-medium">Growth Escalators — India's D2C Performance Marketing Agency</p>
        <p className="text-gray-400 text-sm mt-1">jatin@growthescalators.com</p>
      </div>

      <PurchaseToast
        show={showToast}
        onClose={() => setShowToast(false)}
        autoDismissMs={5000}
      />
    </div>
  );
}
