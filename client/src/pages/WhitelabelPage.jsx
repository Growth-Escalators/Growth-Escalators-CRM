import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import PurchaseToast from '../components/PurchaseToast';

const FEATURES = [
  {
    icon: '🏷️',
    title: 'White-Label Everything',
    desc: 'Our entire D2C performance marketing system — frameworks, templates, reporting — under your brand name.',
  },
  {
    icon: '📈',
    title: 'Proven Client Results',
    desc: 'The same system that manages ₹15Cr+ in Meta ad spend annually. Hand it to your clients with confidence.',
  },
  {
    icon: '🤝',
    title: 'Done-With-You Onboarding',
    desc: 'We walk your team through the entire system in 2 live sessions. You are client-ready in 7 days.',
  },
  {
    icon: '🔄',
    title: 'Monthly Updates',
    desc: 'Meta algorithm changes? We update the playbooks. Your clients always get what is working right now.',
  },
];

const STEPS = [
  { step: '1', title: 'Book a Discovery Call', desc: 'Tell us about your agency and the clients you serve. We will see if this is a fit.' },
  { step: '2', title: 'Onboarding Session', desc: 'Two 90-minute live sessions to set up the system for your agency.' },
  { step: '3', title: 'Go Live with Clients', desc: 'Deploy the system for your first client within 7 days of onboarding.' },
];

export default function WhitelabelPage() {
  const [searchParams] = useSearchParams();
  const name  = searchParams.get('name') || '';
  const email = searchParams.get('email') || '';
  const callRef = useRef(null);
  const [showToast, setShowToast] = useState(false);

  // Show post-purchase toast if user arrived via the purchase funnel
  useEffect(() => {
    const justPurchased = sessionStorage.getItem('ge_purchased') === 'true';
    if (justPurchased) {
      sessionStorage.removeItem('ge_purchased'); // Clear immediately — only shows once
      setShowToast(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      callRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 5000);
    return () => clearTimeout(t);
  }, []);

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
            For Agency Owners
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            {name ? `${name}, scale ` : 'Scale '}your agency with a white-label D2C performance marketing system
          </h1>
          <p className="text-lg text-gray-300 mb-8">
            Take the exact system that powers India's fastest-growing D2C brands and offer it to your clients — under your own brand.
          </p>

          {/* Order confirmation */}
          <div className="inline-block text-left bg-white/10 rounded-xl p-5 space-y-2 text-sm">
            <div className="text-white font-semibold mb-1">✅ Your purchase is confirmed</div>
            <div className="text-gray-300">📦 D2C Funnel Breakdown Pack delivered to your WhatsApp &amp; email</div>
          </div>
        </div>
      </div>

      {/* VSL Section */}
      <section style={{ background: '#0a0f1e', padding: '40px 20px', textAlign: 'center' }}>
        <p style={{
          color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginBottom: '8px',
          fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          Watch this before you scroll
        </p>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '11px', marginBottom: '20px' }}>
          Most agency owners who watch this book a call within 24 hours
        </p>
        <div style={{
          position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden',
          borderRadius: '12px', border: '2px solid #F47B20',
          maxWidth: '560px', margin: '0 auto', boxShadow: '0 0 40px rgba(244,123,32,0.15)',
        }}>
          <iframe
            src="https://www.youtube.com/embed/hTlmBJkjS_I?rel=0&modestbranding=1"
            title="Growth Escalators White Label Partnership"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%', border: 'none', borderRadius: '10px',
            }}
          />
        </div>
      </section>

      {/* FEATURES */}
      <div className="py-16 px-4" style={{ backgroundColor: '#f8f9ff' }}>
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10" style={{ color: '#1B2E5E' }}>
            What's inside the White-Label Partner Program
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="text-3xl mb-3">{f.icon}</div>
                <div className="font-bold text-base mb-1" style={{ color: '#1B2E5E' }}>{f.title}</div>
                <div className="text-gray-500 text-sm">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="py-16 px-4 bg-white">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-10" style={{ color: '#1B2E5E' }}>How it works</h2>
          <div className="space-y-6">
            {STEPS.map((s) => (
              <div key={s.step} className="flex items-start gap-5">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: '#1B2E5E' }}
                >
                  {s.step}
                </div>
                <div>
                  <div className="font-bold text-gray-900">{s.title}</div>
                  <div className="text-gray-500 text-sm mt-0.5">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div ref={callRef} style={{ backgroundColor: '#1B2E5E' }} className="py-16 px-4 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            Book a White-Label Discovery Call
          </h2>
          <p className="text-gray-300 mb-8">
            30 minutes. We'll understand your agency and see if the partner program is a fit.
          </p>
          <a
            href="https://cal.com/growthescalators/whitelabel-discovery"
            className="inline-block font-bold text-lg rounded-xl py-4 px-10 transition-all hover:opacity-90 text-white"
            style={{ backgroundColor: '#F97316' }}
          >
            Book My Discovery Call →
          </a>
          <p className="text-gray-400 text-sm mt-4">
            {email ? `We'll send the agenda to ${email}` : 'Limited to 3 new partners per month'}
          </p>
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
