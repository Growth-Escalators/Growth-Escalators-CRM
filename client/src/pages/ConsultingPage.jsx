import { useState, useEffect, useRef } from 'react';
import PurchaseToast from '../components/PurchaseToast';

const JATIN_PHOTO_URL = 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/public/jatin-profile.png';

const SEGMENT_HEADLINE = {
  d2c:        "You're all set! Your D2C funnel framework is on its way 🎉",
  agency:     "You're all set! Your D2C funnel breakdown is on its way 🎉",
  freelancer: "You're all set! Your D2C funnel breakdown is on its way 🎉",
};

const SEGMENT_DESC = {
  d2c:        "Your D2C Funnel Breakdown Pack is on its way to your WhatsApp and email",
  agency:     "Study these funnels to understand what top D2C brands are running — and replicate it for your clients",
  freelancer: "Study these funnels to build your expertise and pitch performance marketing services with confidence",
};

const TESTIMONIALS = [
  {
    name: 'Rohit M.',
    tag: 'D2C Brand Owner',
    text: "Went from ₹4 ROAS to ₹9 ROAS in 6 weeks. The funnel framework is the clearest breakdown I've seen.",
  },
  {
    name: 'Priya S.',
    tag: 'Performance Marketing Agency',
    text: "We white-labelled the entire system. Our clients saw results in the first month. Worth every rupee.",
  },
  {
    name: 'Aarav K.',
    tag: 'Freelance Media Buyer',
    text: "The Meta Ads section alone is worth 10x the price. Landed my first ₹50k/month retainer after applying it.",
  },
];

export default function ConsultingPage() {
  const params  = new URLSearchParams(window.location.search);
  const name    = params.get('name') || '';
  const email   = params.get('email') || '';
  const segment = params.get('segment') || 'd2c';
  const orderId = params.get('order_id') || '';
  const bumpsStr = params.get('bumps') || '';
  const bumps    = bumpsStr.split(',').filter(Boolean);
  const hasBump1 = bumps.includes('1') || params.get('bump1') === '1';
  const hasBump2 = bumps.includes('2') || params.get('bump2') === '1';

  const [upsellDone, setUpsellDone]     = useState(false);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const callRef = useRef(null);
  const [showToast, setShowToast]       = useState(false);

  // Show post-purchase toast if user arrived via the purchase funnel
  useEffect(() => {
    const justPurchased = sessionStorage.getItem('ge_purchased') === 'true';
    if (justPurchased) {
      sessionStorage.removeItem('ge_purchased'); // Clear immediately — only shows once
      setShowToast(true);
    }
  }, []);

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

  // Show VSL for all segments EXCEPT agency and freelancer — D2C, no-segment,
  // direct URL visitors, and any unknown segment all see the video
  const showVsl = segment !== 'agency' && segment !== 'freelancer';

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ── SECTION 1 — Hero / Thank-you ── */}
      <div style={{ backgroundColor: '#1B2E5E' }} className="text-white px-4 py-10">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl md:text-3xl font-bold mb-3">
            {name ? (
              <><span style={{ color: '#F97316' }}>Great purchase, {name}!</span>{' '}
              {SEGMENT_HEADLINE[segment] ?? SEGMENT_HEADLINE['d2c']}</>
            ) : (
              SEGMENT_HEADLINE[segment] ?? SEGMENT_HEADLINE['d2c']
            )}
          </h1>
          <p className="text-base text-gray-300 mb-6">
            {SEGMENT_DESC[segment] ?? SEGMENT_DESC['d2c']}
          </p>
          <div className="inline-block text-left bg-white/10 rounded-xl px-6 py-4 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-green-400 text-lg">✅</span>
              <span className="text-sm">D2C Funnel Breakdown Pack</span>
            </div>
            {hasBump1 && (
              <div className="flex items-center gap-3">
                <span className="text-green-400 text-lg">✅</span>
                <span className="text-sm">Growth Kit (₹199)</span>
              </div>
            )}
            {hasBump2 && (
              <div className="flex items-center gap-3">
                <span className="text-green-400 text-lg">✅</span>
                <span className="text-sm">Growth Audit Call (₹499)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── VSL — D2C + direct/no-segment visitors ── */}
      {showVsl && (
        <section style={{ background: '#0a0f1e', padding: '28px 20px 36px', textAlign: 'center' }}>
          <p style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: '6px',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            Watch this before your next Meta Ads campaign
          </p>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px', marginBottom: '16px' }}>↓</p>
          <div style={{
            position: 'relative',
            paddingBottom: '56.25%',
            height: 0,
            overflow: 'hidden',
            borderRadius: '12px',
            border: '2px solid #F47B20',
            maxWidth: '560px',
            margin: '0 auto',
          }}>
            <iframe
              src="https://www.youtube.com/embed/lk8RYlChTnI?rel=0&modestbranding=1"
              title="Growth Escalators D2C Growth Strategy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                border: 'none',
                borderRadius: '10px',
              }}
            />
          </div>
        </section>
      )}

      {/* ── SECTION 2 — What Happens Next ── */}
      <div className="px-4 py-10 bg-white">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 text-center mb-8">What Happens Next</h2>
          <div className="space-y-5">
            {[
              { icon: '📱', title: 'Check WhatsApp', desc: 'Your pack arrives in the next 2 minutes' },
              { icon: '📖', title: 'Read Page 12 First', desc: "That's where most brands have their first aha moment" },
              { icon: '📞', title: 'Book Your Call', desc: 'Get a personalised ROAS roadmap for your brand' },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
                  style={{ backgroundColor: '#FFF3E8' }}
                >
                  {s.icon}
                </div>
                <div>
                  <p className="font-bold text-gray-900">{s.title}</p>
                  <p className="text-gray-500 text-sm">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── SECTION 3 — Upsell (only if bump 2 not purchased) ── */}
      {!hasBump2 && !upsellDone && (
        <div className="px-4 py-8 bg-gray-50">
          <div className="max-w-2xl mx-auto">
            <div className="rounded-2xl p-6" style={{ border: '2px solid #F47B20' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#F47B20' }}>
                One more thing before you go…
              </p>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Book a 1-on-1 Growth Audit Call with Jatin — ₹499
              </h3>
              <ul className="space-y-2 mt-3 text-gray-700 text-sm">
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> 45 minutes with Jatin personally</li>
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> Full audit of your current Meta Ads funnel</li>
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> 90-day growth roadmap for your brand</li>
                <li className="flex items-center gap-2"><span className="text-green-500">→</span> Recording sent after the call</li>
              </ul>
              <button
                onClick={handleUpsell}
                disabled={upsellLoading}
                className="mt-5 w-full text-white font-bold text-base rounded-xl py-3 transition-all disabled:opacity-50"
                style={{ backgroundColor: '#F47B20' }}
              >
                {upsellLoading ? 'Processing…' : 'Add Growth Audit — ₹499'}
              </button>
            </div>
          </div>
        </div>
      )}
      {upsellDone && (
        <div className="py-6 px-4 bg-green-50 text-center">
          <p className="text-green-700 font-bold">Growth Audit added! ✅ Check your email for booking details.</p>
        </div>
      )}

      {/* ── SECTION 4 — About Jatin (credibility) ── */}
      <div className="px-4 py-10 bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <img
            src={JATIN_PHOTO_URL}
            alt="Jatin Agrawal — Founder, Growth Escalators"
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              objectFit: 'cover',
              objectPosition: 'center top',
              border: '3px solid #F47B20',
              display: 'block',
              margin: '0 auto 16px',
            }}
          />
          <h3 className="text-lg font-bold text-gray-900 mb-1">Jatin Agrawal</h3>
          <p className="text-sm font-semibold mb-3" style={{ color: '#F47B20' }}>
            Founder, Growth Escalators
          </p>
          <p className="text-sm text-gray-600 max-w-sm mx-auto leading-relaxed">
            8+ years running performance marketing for D2C brands.
            Managed <strong>₹15Cr+</strong> in Meta ad spend. Personally reviews every
            strategy session.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-5">
            {['₹15Cr+ Ad Spend', '200+ D2C Brands', '8+ Years Experience'].map(badge => (
              <span
                key={badge}
                className="text-xs font-bold px-3 py-1 rounded-full"
                style={{ background: '#FFF3E8', color: '#F47B20' }}
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── SECTION 5 — Client Feedback ── */}
      <div className="px-4 py-10" style={{ backgroundColor: '#f8f9fb' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-gray-900 text-center mb-8">
            What Founders Say After Their Strategy Session
          </h2>
          <div className="space-y-4">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
                <p className="text-gray-700 text-sm leading-relaxed mb-4">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: '#1B2E5E' }}
                  >
                    {t.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.tag}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── SECTION 6 — Book Call CTA ── */}
      <div ref={callRef} style={{ backgroundColor: '#1B2E5E' }} className="px-4 py-10 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl md:text-2xl font-bold mb-2">Book Your Free 30-Min Strategy Call</h2>
          <p className="text-gray-300 text-sm mb-6">No pitch. Just clarity on what's holding your ROAS back.</p>
          <a
            href="https://cal.com/growthescalators/book/d2c-strategy"
            className="inline-block text-white font-bold text-base rounded-xl py-3 px-8 transition-all hover:opacity-90"
            style={{ backgroundColor: '#F47B20' }}
          >
            Book My Free Strategy Call →
          </a>
          <p className="text-gray-400 text-xs mt-5">Join 1,000+ D2C founders who've scaled with Growth Escalators</p>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="py-6 px-4 bg-gray-100 text-center">
        <p className="text-gray-600 text-sm font-medium">Growth Escalators — India's D2C Performance Marketing Agency</p>
        <p className="text-gray-400 text-xs mt-1">jatin@growthescalators.com</p>
      </div>

      <PurchaseToast
        show={showToast}
        onClose={() => setShowToast(false)}
        autoDismissMs={5000}
      />
    </div>
  );
}
