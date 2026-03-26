export default function CommunityPage() {
  const params = new URLSearchParams(window.location.search);
  const bump1 = params.get('bump1') === 'true';
  const bump2 = params.get('bump2') === 'true';

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="text-purple-400 text-sm font-bold uppercase tracking-widest mb-4">Welcome to the Community</div>
        <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
          You're Part of the D2C Growth Community
        </h1>
        <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
          Connect with 1,000+ D2C founders and marketers sharing what's working right now
        </p>

        <a
          href="https://chat.whatsapp.com/placeholder"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 bg-green-600 hover:bg-green-700 text-white font-bold text-lg rounded-xl py-4 px-8 transition-all mb-10"
        >
          <span className="text-2xl">💬</span>
          Join WhatsApp Community
        </a>

        {/* Resources section */}
        <div className="text-left space-y-3 mt-10">
          <h3 className="text-lg font-bold mb-4 text-center">Your Resources</h3>
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-4 flex items-center gap-4">
            <span className="text-2xl">📦</span>
            <div>
              <p className="font-semibold">D2C Funnel Breakdown Pack</p>
              <p className="text-sm text-gray-400">Check your email for the download link</p>
            </div>
            <span className="ml-auto text-green-400">✓</span>
          </div>
          {bump1 && (
            <div className="bg-[#0f172a] border border-white/10 rounded-xl p-4 flex items-center gap-4">
              <span className="text-2xl">🔥</span>
              <div>
                <p className="font-semibold">Advanced Growth Kit</p>
                <p className="text-sm text-gray-400">23 ad creatives + 5 landing page templates</p>
              </div>
              <span className="ml-auto text-green-400">✓</span>
            </div>
          )}
          {bump2 && (
            <div className="bg-[#0f172a] border border-white/10 rounded-xl p-4 flex items-center gap-4">
              <span className="text-2xl">🎯</span>
              <div>
                <p className="font-semibold">Growth Audit Call</p>
                <p className="text-sm text-gray-400">Check your email for the booking link</p>
              </div>
              <span className="ml-auto text-green-400">✓</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
