import { useState } from 'react';

export default function AgencyPage() {
  const [form, setForm] = useState({ name: '', agencyName: '', email: '', phone: '', adSpend: '' });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.name || !form.email || !form.phone) { setError('Please fill all required fields'); return; }
    try {
      const res = await fetch('/api/leads/agency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen bg-[#030712] text-white">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <div className="text-blue-400 text-sm font-bold uppercase tracking-widest mb-4">For Agency Owners</div>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
            White-Label Meta Ads Fulfillment for Agencies
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            We run Meta Ads for your clients at 60-70% lower fulfillment cost. Your brand, our execution.
          </p>
        </div>

        {submitted ? (
          <div className="bg-green-900/20 border border-green-500/30 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-4">✅</div>
            <h2 className="text-xl font-bold mb-2">Got it! We'll reach out within 24 hours.</h2>
            <p className="text-gray-400">Our team will contact you on WhatsApp to discuss partnership.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 bg-[#0f172a] border border-white/10 rounded-2xl p-6">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Your Name *</label>
              <input name="name" value={form.name} onChange={handleChange} placeholder="Rahul Sharma"
                className="w-full bg-[#030712] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Agency Name</label>
              <input name="agencyName" value={form.agencyName} onChange={handleChange} placeholder="Your Agency"
                className="w-full bg-[#030712] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email *</label>
              <input name="email" value={form.email} onChange={handleChange} placeholder="you@agency.com" type="email"
                className="w-full bg-[#030712] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">WhatsApp Number *</label>
              <input name="phone" value={form.phone} onChange={handleChange} placeholder="9876543210" maxLength={10}
                className="w-full bg-[#030712] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Monthly Ad Spend Managed</label>
              <input name="adSpend" value={form.adSpend} onChange={handleChange} placeholder="e.g. ₹5L/month"
                className="w-full bg-[#030712] border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl py-4 transition-all">
              Get Started →
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
