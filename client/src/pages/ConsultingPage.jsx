export default function ConsultingPage() {
  return (
    <div className="min-h-screen bg-[#030712] text-white">
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="text-orange-400 text-sm font-bold uppercase tracking-widest mb-4">For D2C Brand Owners</div>
        <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
          Let's Scale Your D2C Brand on Meta Ads
        </h1>
        <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
          Book a free strategy call and we'll show you exactly what's working for brands like yours
        </p>

        <div className="bg-[#0f172a] border border-white/10 rounded-2xl overflow-hidden">
          <iframe
            src="https://cal.com/growthescalators/book/d2c-strategy"
            className="w-full border-0"
            style={{ height: '700px' }}
            title="Book a Strategy Call"
          />
        </div>

        <div className="mt-10 grid grid-cols-3 gap-6 text-center">
          {[
            { stat: '1,000+', label: 'D2C Brands Helped' },
            { stat: '₹50L+', label: 'Monthly Ad Spend Managed' },
            { stat: '3.5x', label: 'Average ROAS' },
          ].map(s => (
            <div key={s.label} className="bg-[#0f172a] border border-white/10 rounded-xl p-4">
              <div className="text-2xl font-bold text-orange-400">{s.stat}</div>
              <div className="text-sm text-gray-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
