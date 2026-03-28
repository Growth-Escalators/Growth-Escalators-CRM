import { useState, useEffect, useRef } from 'react';

export default function ConsultingPage() {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name') || '';
  const email = params.get('email') || '';
  const orderId = params.get('order_id') || '';
  const bumpsStr = params.get('bumps') || '';
  const bumps = bumpsStr.split(',').filter(Boolean);
  const hasBump1 = bumps.includes('1');
  const hasBump2 = bumps.includes('2');

  const [upsellDone, setUpsellDone] = useState(false);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const callRef = useRef(null);

  // Auto-scroll to booking section after 5 seconds
  useEffect(() => {
    const t = setTimeout(() => {
      callRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  async function handleUpsell() {
    setUpsellLoading(true);
    try {
      const res = await fetch('/api/cashfree/upsell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, bumpId: 2, email, phone: '', name }),
      });
      const data = await res.json();
      if (data.payment_session_id) {
        // Load Cashfree and open payment
        const { load } = await import('@cashfreepayments/cashfree-js');
        const cashfree = await load({ mode: import.meta.env.VITE_CASHFREE_ENV === 'production' ? 'production' : 'sandbox' });
        const result = await cashfree.checkout({ paymentSessionId: data.payment_session_id });
        if (result?.paymentDetails?.paymentMessage === 'payment done') {
          setUpsellDone(true);
        }
      }
    } catch (e) {
      console.error('Upsell error:', e);
    } finally {
      setUpsellLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* SECTION 1 — Hero */}
      <div style={{ backgroundColor: '#1B2E5E' }} className="text-white py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            You're all set{name ? `, ${name}` : ''}! 🎉
          </h1>
          <p className="text-lg text-gray-300 mb-8">
            Your D2C Funnel Breakdown Pack is on its way to your WhatsApp and email
          </p>
          <div className="inline-block text-left bg-white/10 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-green-400 text-xl">✅</span>
              <span>D2C Funnel Breakdown Pack</span>
            </div>
            {hasBump1 && (
              <div className="flex items-center gap-3">
                <span className="text-green-400 text-xl">✅</span>
                <span>Growth Kit (₹199)</span>
              </div>
            )}
            {hasBump2 && (
              <div className="flex items-center gap-3">
                <span className="text-green-400 text-xl">✅</span>
                <span>Growth Audit Call (₹499)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2 — What Happens Next */}
      <div className="py-16 px-4 bg-white">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-10">What Happens Next</h2>
          <div className="space-y-6">
            {[
              { step: '1', icon: '📱', title: 'Check WhatsApp', desc: 'Your pack arrives in the next 2 minutes' },
              { step: '2', icon: '📖', title: 'Read Page 12 First', desc: "That's where most brands have their first aha moment" },
              { step: '3', icon: '📞', title: 'Book Your Call', desc: 'Get a personalised ROAS roadmap for your brand' },
            ].map(s => (
              <div key={s.step} className="flex items-start gap-5">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: '#FFF3E8' }}>
                  {s.icon}
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-lg">{s.title}</p>
                  <p className="text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 3 — Upsell (only if bump 2 not purchased) */}
      {!hasBump2 && !upsellDone && (
        <div className="py-12 px-4 bg-gray-50">
          <div className="max-w-2xl mx-auto">
            <div className="rounded-2xl p-8" style={{ border: '2px solid #F47B20' }}>
              <p className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: '#F47B20' }}>One more thing before you go...</p>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Book a 1-on-1 Growth Audit Call with Jatin — ₹499</h3>
              <ul className="space-y-2 mt-4 text-gray-700">
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> 45 minutes with Jatin personally</li>
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> Full audit of your current Meta Ads funnel</li>
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> 90-day growth roadmap for your brand</li>
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> Recording sent after the call</li>
              </ul>
              <button
                onClick={handleUpsell}
                disabled={upsellLoading}
                className="mt-6 w-full text-white font-bold text-lg rounded-xl py-4 transition-all disabled:opacity-50"
                style={{ backgroundColor: '#F47B20' }}
              >
                {upsellLoading ? 'Processing...' : 'Add Growth Audit — ₹499'}
              </button>
            </div>
          </div>
        </div>
      )}
      {upsellDone && (
        <div className="py-8 px-4 bg-green-50 text-center">
          <p className="text-green-700 font-bold text-lg">Growth Audit added! ✅ Check your email for booking details.</p>
        </div>
      )}

      {/* SECTION 4 — Book Call */}
      <div ref={callRef} style={{ backgroundColor: '#1B2E5E' }} className="py-16 px-4 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">Book Your Free 30-Min Strategy Call</h2>
          <p className="text-gray-300 mb-8">No pitch. Just clarity on what's holding your ROAS back.</p>
          <a
            href="https://cal.com/growthescalators/book/d2c-strategy"
            className="inline-block text-white font-bold text-lg rounded-xl py-4 px-10 transition-all hover:opacity-90"
            style={{ backgroundColor: '#F47B20' }}
          >
            Book My Free Strategy Call →
          </a>
          <p className="text-gray-400 text-sm mt-6">Join 1,000+ D2C founders who've scaled with Growth Escalators</p>
        </div>
      </div>

      {/* SECTION 5 — Footer */}
      <div className="py-8 px-4 bg-gray-100 text-center">
        <p className="text-gray-600 font-medium">Growth Escalators — India's D2C Performance Marketing Agency</p>
        <p className="text-gray-400 text-sm mt-1">jatin@growthescalators.com</p>
      </div>
    </div>
  );
}
