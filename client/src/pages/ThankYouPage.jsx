import { useEffect } from 'react';

const BOOKING_URL = 'https://web-production-311da.up.railway.app/book/d2c-strategy';

const SOCIAL_PROOF = {
  ecom_brand: 'Helped a Jaipur D2C brand scale from ₹3L to ₹18L/month in 4 months on Meta.',
  agency_owner: 'Helped an agency owner go from 3 clients to 11 clients in 6 months using our system.',
  freelancer: 'Helped a freelancer land their first ₹25,000/month retainer client within 3 months.',
};

const NEXT_STEPS = [
  {
    step: '1',
    title: 'Check your email',
    body: 'Your D2C Funnel Breakdown Pack is landing in your inbox right now. Check your promotions tab if you don\'t see it.',
    icon: '📧',
  },
  {
    step: '2',
    title: 'Implement the frameworks',
    body: 'Start with Section 2 — it is the most immediately actionable and will show results within your next campaign.',
    icon: '🚀',
  },
  {
    step: '3',
    title: 'Book your strategy call',
    body: 'This is where most brands see the biggest breakthrough. Use what you learn in the pack as context for the call.',
    icon: '📞',
  },
];

export default function ThankYouPage() {
  const params = new URLSearchParams(window.location.search);
  const segment = params.get('segment');
  const bump1 = params.get('bump1') === 'true';
  const bump2 = params.get('bump2') === 'true';
  const email = params.get('email') ?? '';

  const proof = SOCIAL_PROOF[segment] ?? SOCIAL_PROOF['ecom_brand'];

  // Fire GTM purchase event
  useEffect(() => {
    if (window.dataLayer) {
      window.dataLayer.push({ event: 'purchase', segment, bump1, bump2 });
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      {/* ------------------------------------------------------------------ */}
      {/* CONFIRMATION HEADER */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-green-900/20 border-b border-green-500/30 py-10 px-4 text-center">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
          Payment Confirmed! Your order is being processed.
        </h1>
        <p className="text-gray-300 text-base max-w-lg mx-auto">
          Your D2C Funnel Breakdown Pack will be delivered to{' '}
          {email ? <span className="text-green-400 font-semibold">{email}</span> : 'your email'}{' '}
          within the next 3 minutes.
        </p>

        {/* What they purchased */}
        <div className="inline-flex flex-col gap-1 mt-4 text-sm text-gray-400 text-left bg-white/5 rounded-xl px-5 py-3">
          <div className="text-white font-semibold mb-1">Your order includes:</div>
          <div>📦 D2C Funnel Breakdown Pack — ₹9</div>
          {bump1 && <div>🔥 Advanced D2C Growth Kit — ₹199</div>}
          {bump2 && <div>🎯 Personalised Growth Audit (15-min call) — ₹499</div>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-12">

        {/* ---------------------------------------------------------------- */}
        {/* WHAT HAPPENS NEXT */}
        {/* ---------------------------------------------------------------- */}
        <div>
          <h2 className="text-xl font-bold mb-6 text-center">What happens next</h2>
          <div className="space-y-4">
            {NEXT_STEPS.map((s) => (
              <div key={s.step} className="flex items-start gap-4 bg-[#0f172a] border border-white/10 rounded-xl p-5">
                <div className="w-10 h-10 flex-shrink-0 bg-orange-500/20 rounded-full flex items-center justify-center text-orange-400 font-bold">
                  {s.step}
                </div>
                <div>
                  <div className="font-semibold text-base text-white flex items-center gap-2">
                    <span>{s.icon}</span> {s.title}
                  </div>
                  <p className="text-gray-400 text-sm mt-1">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* STRATEGY CALL CTA */}
        {/* ---------------------------------------------------------------- */}
        <div className="bg-[#0f172a] border border-orange-500/30 rounded-2xl p-6 text-center">
          <div className="text-orange-400 text-xs font-bold uppercase tracking-widest mb-3">
            🎁 Exclusive Bonus — For Buyers Only
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-white mb-3">
            Because you invested in your growth today, you qualify for a complimentary Strategy Call
          </h2>
          <p className="text-gray-400 text-sm mb-4 max-w-lg mx-auto">
            Jatin will review your specific funnel situation and give you a personalised roadmap.
            This call is normally only available to agency clients paying ₹50,000+ per month.
          </p>

          {/* Segment-specific social proof */}
          <div className="bg-white/5 rounded-xl px-4 py-3 mb-6 text-sm text-green-400 font-medium">
            ✅ {proof}
          </div>

          <a
            href={BOOKING_URL}
            className="inline-block w-full md:w-auto bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg rounded-xl py-4 px-8 transition-all cta-pulse"
          >
            Book My Free Strategy Call →
          </a>

          <p className="text-gray-500 text-xs mt-3">
            Round-robin scheduled — you will be connected with Jatin or Vishal based on availability
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* URGENCY */}
        {/* ---------------------------------------------------------------- */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-5 py-4 text-center">
          <p className="text-yellow-400 text-sm font-semibold">
            ⏰ Strategy call slots are limited to 5 per week. Book now to secure your spot.
          </p>
        </div>
      </div>
    </div>
  );
}
