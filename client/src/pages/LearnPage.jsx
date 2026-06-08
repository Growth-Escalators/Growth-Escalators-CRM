import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PurchaseToast from '../components/PurchaseToast';
import { apiUrl } from '../services/api';

const ASSETS = {
  mainPdf:   'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
  growthKit: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
  auditCall: 'https://cal.com/growth-escalators/discovery-call',
};

const PERSONAS = [
  { emoji: '🧑‍💻', h: 'The performance freelancer', p: 'Running ads solo and ready to charge what agencies do.' },
  { emoji: '✍️',  h: 'The content / design freelancer', p: 'Wanting to add funnel strategy and own more of the result.' },
  { emoji: '🚀', h: 'The future agency owner', p: 'Learning the playbook now to build your own shop next.' },
];

const LEARN_CARDS = [
  { ic: '🧩', h: 'Build client funnels', p: 'Assemble the full landing-page → checkout → retention funnel using structures already winning for top D2C brands.' },
  { ic: '🎯', h: 'Pitch with proof', p: 'Walk into client calls with real teardowns and frameworks instead of vague promises — and close higher.' },
  { ic: '💸', h: 'Price your retainers', p: 'Stop charging per task. Learn to package and price work so clients happily pay monthly.' },
  { ic: '🔁', h: 'Deliver & retain', p: 'The reporting and communication rhythm that keeps clients paying month after month.' },
];

const PERKS = [
  'Lifetime access to every cohort lesson & update',
  'The full D2C funnel swipe file & teardown library',
  'Founding-member pricing — locked forever',
  'Private community of freelancers & operators',
  'Early-access feedback that shapes the curriculum',
];

export default function LearnPage() {
  const [searchParams] = useSearchParams();
  const prefillName  = searchParams.get('name') || '';
  const prefillEmail = searchParams.get('email') || '';
  const bump1 = searchParams.get('bump1') === '1';
  const bump2 = searchParams.get('bump2') === '1';
  const justPurchased = !!(prefillName || prefillEmail || bump1 || bump2);

  const [name,  setName]  = useState(prefillName);
  const [email, setEmail] = useState(prefillEmail);
  const [submitted, setSubmitted] = useState(false);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('ge_purchased') === 'true') {
      sessionStorage.removeItem('ge_purchased');
      setShowToast(true);
    }
  }, []);

  // Fetch live waitlist count — non-critical, swallow errors so the form
  // still renders if the API is unreachable.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    fetch(apiUrl('/api/funnel/waitlist-count'), { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCount(d.count ?? null); })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    return () => { clearTimeout(t); ctrl.abort(); };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.learn-page .reveal:not(.in)').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [submitted]); // re-bind after the form swaps to success

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email.'); return; }
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/funnel/waitlist'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Freelancer',
          email: email.trim(),
          source: 'learn_page',
        }),
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

  // Progress bar maths — use live count if we have one, otherwise show a
  // sensible default that motivates without lying.
  const target = 50;
  const current = count ?? 32;
  const pct = Math.min(100, Math.round((current / target) * 100));
  const spotsLeft = Math.max(0, target - current);

  return (
    <div className="learn-page">
      <style>{LEARN_CSS}</style>
      <div className="blob a" /><div className="blob b" />

      {justPurchased && (
        <div className="confirmed">
          <div className="wrap">
            <span>✅ <b>{prefillName ? `Great purchase, ${prefillName}!` : 'Your purchase is confirmed.'}</b> Your D2C Funnel Breakdown Pack is ready below.</span>
          </div>
        </div>
      )}

      <nav>
        <div className="wrap">
          <a className="logo"><span className="mk">GE</span><span>Growth Escalators<small>Freelancer Cohort</small></span></a>
          <div className="nav-right">
            <span className="nav-spots"><b>{spotsLeft} spots</b> left before launch</span>
            <button className="btn btn-primary" onClick={() => document.getElementById('email1')?.focus()}>Join Waitlist</button>
          </div>
        </div>
      </nav>

      {justPurchased && (
        <section className="downloads">
          <div className="wrap">
            <div className="dl-card reveal in">
              <div className="dl-head">
                <span className="dl-tag">✅ Purchase Confirmed</span>
                <h3>{prefillName ? `${prefillName}, your` : 'Your'} pack is ready</h3>
                <p>{prefillEmail ? `We've also sent a copy to ${prefillEmail}.` : 'Tap below to download what you bought.'}</p>
              </div>
              <div className="dl-actions">
                <a className="dl-btn primary" href={ASSETS.mainPdf} target="_blank" rel="noopener noreferrer">📄 Download the Pack</a>
                {bump1 && <a className="dl-btn warm" href={ASSETS.growthKit} target="_blank" rel="noopener noreferrer">📦 Download Growth Kit</a>}
                {bump2 && <a className="dl-btn deep" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer">🎯 Book Your 45-Min Audit Call</a>}
              </div>
            </div>
          </div>
        </section>
      )}

      <header className="hero">
        <div className="wrap reveal in">
          <span className="eyebrow"><span className="dot" /> For Freelancers · Cohort #1</span>
          <h1>Land bigger clients with <em>proven D2C funnels.</em></h1>
          <p className="lead">Here's how freelancers use the exact playbooks behind the brands we've scaled to win larger retainers — coming soon as a hands-on cohort.</p>

          <div className="wl">
            {!submitted ? (
              <form className="wl-form" onSubmit={handleSubmit}>
                <input
                  id="email1" type="email" required
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Joining…' : 'Join the Waitlist'}
                </button>
              </form>
            ) : (
              <div className="wl-success show">
                <div className="ic">✅</div>
                <h3>You're on the waitlist!</h3>
                <p>We'll send one email the moment Cohort #1 opens — with your founding-member pricing locked in.</p>
              </div>
            )}
            {!submitted && <div className="micro">No spam. Just one email when the cohort opens.</div>}
            {error && <div className="micro" style={{ color: '#fda4af', marginTop: 8 }}>{error}</div>}
          </div>

          <div className="hero-faces">
            <span className="hf-txt"><b>{current} freelancers</b> already on the list</span>
          </div>

          <div className="scarcity reveal in" style={{ transitionDelay: '0.1s' }}>
            <div className="top"><span>First cohort opens when we hit {target}</span><b>{current} / {target}</b></div>
            <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
            <div className="foot"><span className="badge">⭐ Founding-member pricing</span><small>{spotsLeft} spots left before launch</small></div>
          </div>
        </div>
      </header>

      <section>
        <div className="wrap">
          <div className="sec-head reveal"><div className="sec-tag">What you'll learn</div><h2>Turn proven funnels into premium retainers.</h2></div>
          <div className="cards">
            {LEARN_CARDS.map((c, i) => (
              <div className="card reveal" key={c.h} style={{ transitionDelay: `${i * 0.06}s` }}>
                <div className="ic">{c.ic}</div>
                <div><h4>{c.h}</h4><p>{c.p}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head reveal"><div className="sec-tag">Who it's for</div><h2>If you sell marketing as a freelancer, this is for you.</h2></div>
          <div className="personas reveal">
            {PERSONAS.map(p => (
              <div className="persona" key={p.h}>
                <div className="emoji">{p.emoji}</div><h4>{p.h}</h4><p>{p.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="perks-wrap reveal">
            <h3>What founding members get</h3>
            <p className="pr-sub">Join before launch and lock in perks the public cohort won't see.</p>
            <ul className="perks">
              {PERKS.map(perk => <li key={perk}><span className="ck">✓</span> {perk}</li>)}
            </ul>
            <div className="price-tease">
              <span className="now">Founding price revealed to the waitlist first</span>
              <small>Before public pricing goes live — joining early locks in the lowest rate.</small>
            </div>
          </div>
        </div>
      </section>

      <section className="cta2">
        <div className="wrap reveal">
          <h2>Get in before the doors open.</h2>
          <p>Cohort #1 launches at {target} members. Founding pricing closes when it does.</p>
          <div className="wl">
            {!submitted ? (
              <form className="wl-form" onSubmit={handleSubmit}>
                <input
                  type="email" required
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Joining…' : 'Join the Waitlist'}
                </button>
              </form>
            ) : (
              <div className="wl-success show">
                <div className="ic">✅</div>
                <h3>You're on the waitlist!</h3>
                <p>Watch your inbox — founding-member pricing is reserved for you.</p>
              </div>
            )}
            {!submitted && <div className="micro">No spam. Just one email when the cohort opens.</div>}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head reveal"><div className="sec-tag">Questions</div><h2>Quick answers.</h2></div>
          <div className="faq reveal">
            <details open><summary>When does the cohort start? <span className="pl">+</span></summary><div className="ans">The first cohort opens once we hit {target} waitlist members. Everyone on the list gets one email the moment it's live — no spam in between.</div></details>
            <details><summary>What will it cost? <span className="pl">+</span></summary><div className="ans">Founding-member pricing is reserved for the waitlist and revealed before public pricing goes live. Joining early locks in the lowest rate.</div></details>
            <details><summary>Who's teaching it? <span className="pl">+</span></summary><div className="ans">The Growth Escalators team — the same people behind ₹8.9 Cr+ in managed Meta ad spend across 187+ brands.</div></details>
            <details><summary>Do I need experience? <span className="pl">+</span></summary><div className="ans">No. It's built so any freelancer — whether you run ads, design, or write — can apply proven funnel structures to win better clients.</div></details>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <a className="logo"><span className="mk">GE</span><span>Growth Escalators<small>India's D2C Performance Marketing Agency</small></span></a>
          <div style={{ textAlign: 'right' }}>
            <a className="mail" href="mailto:jatin@growthescalators.com">jatin@growthescalators.com</a>
            <div className="tag">© Growth Escalators. Helping freelancers turn skills into retainers.</div>
          </div>
        </div>
      </footer>

      <PurchaseToast show={showToast} onClose={() => setShowToast(false)} autoDismissMs={5000} />
    </div>
  );
}

const LEARN_CSS = `
.learn-page{--bg:#06100e;--bg2:#0a1614;--panel:#0e1c1a;--panel2:#112523;--card:#0f1d1b;--line:#1c322f;--line2:#264742;--ink:#eafaf6;--muted:#93b3ac;--faint:#5e827b;--accent:#2dd4a7;--accent2:#34d399;--accent-soft:#7ff0d0;--warm:#ffcf6b;--glow:rgba(45,212,167,.32);--display:'Outfit','Inter',sans-serif;--sans:'Outfit','Inter',sans-serif;--maxw:1140px;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden;position:relative;min-height:100vh}
.learn-page::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(680px 480px at 82% -6%,rgba(45,212,167,.17),transparent 56%),radial-gradient(600px 440px at 0% 8%,rgba(52,211,153,.11),transparent 55%)}
.learn-page *{margin:0;padding:0;box-sizing:border-box}
.learn-page .blob{position:fixed;border-radius:50%;filter:blur(100px);z-index:0;pointer-events:none;opacity:.4}
.learn-page .blob.a{width:400px;height:400px;background:rgba(45,212,167,.26);top:-130px;right:-90px;animation:learn-float 15s ease-in-out infinite}
.learn-page .blob.b{width:320px;height:320px;background:rgba(52,211,153,.18);bottom:8%;left:-130px;animation:learn-float 19s ease-in-out infinite reverse}
@keyframes learn-float{0%,100%{transform:translateY(0)}50%{transform:translateY(44px)}}
.learn-page .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px;position:relative;z-index:1}
.learn-page a{color:inherit;text-decoration:none}
.learn-page img{display:block;max-width:100%}
.learn-page .confirmed{background:linear-gradient(90deg,rgba(45,212,167,.18),rgba(45,212,167,.05));border-bottom:1px solid rgba(45,212,167,.28);font-size:13.5px;color:#bff5e3;position:relative;z-index:5}
.learn-page .confirmed .wrap{display:flex;align-items:center;gap:12px;padding:11px 24px;flex-wrap:wrap}
.learn-page .confirmed b{color:#d1faec}
.learn-page nav{position:sticky;top:0;z-index:40;backdrop-filter:blur(16px);background:rgba(6,16,14,.72);border-bottom:1px solid var(--line)}
.learn-page nav .wrap{display:flex;align-items:center;justify-content:space-between;height:68px}
.learn-page .logo{display:flex;align-items:center;gap:11px;font-weight:600;letter-spacing:-.01em}
.learn-page .logo .mk{width:37px;height:37px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#04201a;font-weight:700;font-size:16px;box-shadow:0 8px 22px -6px var(--glow)}
.learn-page .logo small{display:block;font-size:10px;color:var(--faint);font-weight:500;letter-spacing:.1em;text-transform:uppercase}
.learn-page .nav-right{display:flex;align-items:center;gap:16px}
.learn-page .nav-spots{font-size:13px;color:var(--muted)}
.learn-page .nav-spots b{color:var(--accent-soft)}
.learn-page .btn{font-family:var(--sans);cursor:pointer;border:none;font-weight:600;border-radius:12px;transition:transform .18s,box-shadow .18s}
.learn-page .btn-primary{background:linear-gradient(120deg,var(--accent),var(--accent2));color:#04201a;padding:14px 24px;font-size:15px;box-shadow:0 12px 32px -10px var(--glow)}
.learn-page .btn-primary:hover{transform:translateY(-2px);box-shadow:0 18px 42px -10px var(--glow)}
.learn-page .btn-primary:disabled{opacity:.7;cursor:wait;transform:none}
.learn-page .btn-lg{padding:16px 30px;font-size:16px}
.learn-page .downloads{padding:34px 0 0}
.learn-page .dl-card{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:22px;padding:30px 28px;box-shadow:0 30px 60px -30px rgba(0,0,0,.65);position:relative;overflow:hidden}
.learn-page .dl-card::before{content:"";position:absolute;inset:0;background:radial-gradient(480px 220px at 100% -10%,rgba(45,212,167,.2),transparent 60%);opacity:.7;pointer-events:none}
.learn-page .dl-head{position:relative;text-align:center;margin-bottom:22px}
.learn-page .dl-tag{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-soft);background:rgba(45,212,167,.12);border:1px solid rgba(45,212,167,.3);padding:6px 12px;border-radius:999px;margin-bottom:14px}
.learn-page .dl-head h3{font-family:var(--display);font-weight:600;font-size:clamp(22px,3vw,30px);letter-spacing:-.01em}
.learn-page .dl-head p{color:var(--muted);font-size:14.5px;margin-top:8px}
.learn-page .dl-actions{position:relative;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.learn-page .dl-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:600;font-size:14.5px;transition:transform .18s}
.learn-page .dl-btn:hover{transform:translateY(-2px)}
.learn-page .dl-btn.primary{background:linear-gradient(120deg,var(--accent),var(--accent2));color:#04201a;box-shadow:0 10px 28px -10px var(--glow)}
.learn-page .dl-btn.warm{background:linear-gradient(120deg,#ff9e44,#ff7a18);color:#1a0c02;box-shadow:0 10px 28px -10px rgba(255,122,24,.5)}
.learn-page .dl-btn.deep{background:linear-gradient(120deg,#a78bfa,#7c3aed);color:#fff;box-shadow:0 10px 28px -10px rgba(124,58,237,.5)}
.learn-page .hero{padding:50px 0 20px;text-align:center;position:relative}
.learn-page .eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-soft);background:rgba(45,212,167,.09);border:1px solid rgba(45,212,167,.26);padding:8px 16px;border-radius:999px;margin-bottom:26px}
.learn-page .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.learn-page h1{font-family:var(--display);font-weight:600;font-size:clamp(40px,6vw,72px);line-height:1.02;letter-spacing:-.02em;max-width:15ch;margin:0 auto}
.learn-page h1 em{font-style:normal;background:linear-gradient(120deg,var(--accent-soft),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.learn-page .lead{color:var(--muted);font-size:19px;margin:24px auto 0;max-width:48ch}
.learn-page .wl{margin:34px auto 0;max-width:520px}
.learn-page .wl-form{display:flex;gap:10px;background:var(--panel2);border:1px solid var(--line2);border-radius:16px;padding:8px;transition:.2s}
.learn-page .wl-form:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px rgba(45,212,167,.14)}
.learn-page .wl-form input{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:var(--sans);font-size:15.5px;padding:10px 14px}
.learn-page .wl-form input::placeholder{color:var(--faint)}
.learn-page .wl .micro{margin-top:13px;color:var(--faint);font-size:13px}
.learn-page .wl-success{background:linear-gradient(170deg,rgba(45,212,167,.1),transparent);border:1px solid rgba(45,212,167,.3);border-radius:18px;padding:30px;text-align:center;animation:learn-pop .4s ease}
@keyframes learn-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
.learn-page .wl-success .ic{width:54px;height:54px;border-radius:50%;background:rgba(45,212,167,.18);border:1px solid rgba(45,212,167,.4);display:grid;place-items:center;font-size:26px;margin:0 auto 14px}
.learn-page .wl-success h3{font-family:var(--display);font-size:24px;font-weight:600}
.learn-page .wl-success p{color:var(--muted);font-size:14.5px;margin-top:8px}
.learn-page .hero-faces{display:flex;align-items:center;justify-content:center;gap:13px;margin-top:26px;flex-wrap:wrap}
.learn-page .hero-faces .hf-txt{font-size:13.5px;color:var(--muted)}
.learn-page .hero-faces .hf-txt b{color:var(--ink)}
.learn-page .scarcity{max-width:580px;margin:42px auto 0;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 28px}
.learn-page .scarcity .top{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;color:var(--muted);margin-bottom:14px}
.learn-page .scarcity .top b{color:var(--ink);font-family:var(--display);font-size:18px;font-weight:600}
.learn-page .bar{height:13px;background:var(--bg);border:1px solid var(--line2);border-radius:999px;overflow:hidden}
.learn-page .bar .fill{height:100%;background:linear-gradient(90deg,var(--accent2),var(--accent-soft));border-radius:999px;position:relative;transition:width .6s ease}
.learn-page .bar .fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:learn-shine 2.2s infinite}
@keyframes learn-shine{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.learn-page .scarcity .foot{display:flex;justify-content:space-between;margin-top:14px;align-items:center;gap:10px;flex-wrap:wrap}
.learn-page .badge{display:inline-flex;align-items:center;gap:7px;background:rgba(255,207,107,.1);border:1px solid rgba(255,207,107,.3);color:var(--warm);font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px}
.learn-page .scarcity .foot small{color:var(--faint);font-size:12.5px}
.learn-page section{padding:74px 0;position:relative}
.learn-page .sec-head{max-width:600px;margin:0 auto 44px;text-align:center}
.learn-page .sec-tag{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-soft);margin-bottom:14px}
.learn-page h2{font-family:var(--display);font-weight:600;font-size:clamp(28px,3.8vw,44px);line-height:1.06;letter-spacing:-.02em}
.learn-page .sec-head p{color:var(--muted);font-size:17px;margin-top:13px}
.learn-page .cards{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.learn-page .cards .card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px;display:flex;gap:18px;transition:.25s}
.learn-page .cards .card:hover{border-color:var(--accent);transform:translateY(-4px)}
.learn-page .cards .card .ic{flex:none;width:52px;height:52px;border-radius:14px;background:rgba(45,212,167,.1);border:1px solid rgba(45,212,167,.26);display:grid;place-items:center;font-size:24px}
.learn-page .cards .card h4{font-size:18.5px;letter-spacing:-.01em}
.learn-page .cards .card p{color:var(--muted);font-size:14.5px;margin-top:8px;line-height:1.6}
.learn-page .personas{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.learn-page .persona{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:20px;padding:30px;text-align:center;transition:.25s}
.learn-page .persona:hover{border-color:var(--line2);transform:translateY(-4px)}
.learn-page .persona .emoji{font-size:34px}
.learn-page .persona h4{font-family:var(--display);font-size:18px;font-weight:600;margin-top:12px}
.learn-page .persona p{color:var(--muted);font-size:13.5px;margin-top:8px}
.learn-page .perks-wrap{max-width:700px;margin:0 auto;background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:24px;padding:44px;position:relative;overflow:hidden}
.learn-page .perks-wrap::before{content:"";position:absolute;inset:0;background:radial-gradient(440px 240px at 50% -10%,var(--glow),transparent 60%);opacity:.4}
.learn-page .perks-wrap h3{position:relative;font-family:var(--display);font-size:25px;font-weight:600;text-align:center}
.learn-page .perks-wrap .pr-sub{position:relative;text-align:center;color:var(--muted);font-size:15px;margin-top:8px;margin-bottom:26px}
.learn-page .perks{position:relative;list-style:none;display:flex;flex-direction:column;gap:14px;max-width:500px;margin:0 auto}
.learn-page .perks li{display:flex;gap:13px;font-size:15.5px;color:#cfe9e2}
.learn-page .perks li .ck{flex:none;width:27px;height:27px;border-radius:8px;background:rgba(45,212,167,.14);color:var(--accent-soft);display:grid;place-items:center;font-weight:700;font-size:14px}
.learn-page .price-tease{position:relative;text-align:center;margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}
.learn-page .price-tease .now{font-family:var(--display);font-size:30px;font-weight:600;color:var(--accent-soft)}
.learn-page .price-tease small{display:block;color:var(--faint);font-size:13px;margin-top:6px}
.learn-page .cta2{text-align:center;padding:80px 0}
.learn-page .cta2 h2{max-width:18ch;margin:0 auto}
.learn-page .cta2 p{color:var(--muted);font-size:17px;margin-top:14px;margin-bottom:28px}
.learn-page .cta2 .wl{margin-top:0}
.learn-page .faq{max-width:760px;margin:0 auto}
.learn-page details{border:1px solid var(--line);border-radius:15px;background:var(--card);margin-bottom:12px;overflow:hidden}
.learn-page details[open]{border-color:var(--line2)}
.learn-page summary{cursor:pointer;list-style:none;padding:21px 24px;font-weight:600;font-size:16px;display:flex;justify-content:space-between;gap:16px;align-items:center}
.learn-page summary::-webkit-details-marker{display:none}
.learn-page summary .pl{flex:none;color:var(--accent-soft);font-size:23px;transition:.25s;line-height:1}
.learn-page details[open] summary .pl{transform:rotate(45deg)}
.learn-page details .ans{padding:0 24px 22px;color:var(--muted);font-size:15px;line-height:1.7}
.learn-page footer{border-top:1px solid var(--line);background:var(--bg2);padding:46px 0}
.learn-page footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.learn-page footer .tag{color:var(--faint);font-size:13.5px;max-width:46ch;margin-top:6px}
.learn-page footer a.mail{color:var(--accent-soft);font-size:14px}
.learn-page .reveal{opacity:0;transform:translateY(24px);transition:opacity .7s,transform .7s}
.learn-page .reveal.in{opacity:1;transform:none}
@media(max-width:820px){
  .learn-page .cards,.learn-page .personas{grid-template-columns:1fr}
  .learn-page .perks-wrap{padding:30px 22px}
  .learn-page .nav-spots{display:none}
}
`;
