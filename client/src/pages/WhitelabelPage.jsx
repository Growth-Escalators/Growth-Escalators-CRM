import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PurchaseToast from '../components/PurchaseToast';

// Asset URLs are the same R2 bucket the existing checkout funnel writes to —
// when a buyer completes Cashfree, they land on /whitelabel?...bump1=1 and
// these URLs deliver what they paid for. NEVER drop these references.
const ASSETS = {
  mainPdf:   'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
  growthKit: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
  auditCall: 'https://cal.com/growth-escalators/discovery-call',
};

const PARTNERS = ['Paraiso', 'Odra', 'Dr. Dheeraj Dubay', 'Elixzor', 'SN Herbals', 'Gentle Panda', 'Atatica'];

const FEATURES = [
  { ic: '🎯', h: 'Full campaign management', p: 'Strategy, build, launch and daily optimisation of every Meta campaign, end to end.' },
  { ic: '🎨', h: 'Creative direction', p: 'Ad concepts, hooks and iteration guidance proven across brands we have scaled.' },
  { ic: '📊', h: 'Reporting in your brand', p: 'White-labelled dashboards and monthly reports your clients receive as yours.' },
  { ic: '👤', h: 'Dedicated strategist', p: 'A single point of contact who knows every account you bring into the program.' },
  { ic: '🔄', h: 'Monthly optimisation', p: 'Continuous testing and scaling — Meta changes, we adapt before it costs you.' },
  { ic: '⏱️', h: 'Clear SLAs', p: 'Defined turnaround on launches and changes, so you can promise clients with confidence.' },
];

const FLOW = [
  { h: 'Discovery call', p: 'We learn your agency, clients and goals — and confirm the fit.' },
  { h: 'Onboard a client', p: 'You sign the client. We onboard the account behind your brand.' },
  { h: 'We execute', p: 'Our team runs the ads. You stay the face; we stay invisible.' },
  { h: 'You report & profit', p: 'White-labelled reports go out as yours. You keep the margin.' },
];

export default function WhitelabelPage() {
  const [searchParams] = useSearchParams();
  const name  = searchParams.get('name') || '';
  const email = searchParams.get('email') || '';
  const bump1 = searchParams.get('bump1') === '1';
  const bump2 = searchParams.get('bump2') === '1';
  const justPurchased = !!(name || email || bump1 || bump2);

  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('ge_purchased') === 'true') {
      sessionStorage.removeItem('ge_purchased');
      setShowToast(true);
    }
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.wl-page .reveal:not(.in)').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="wl-page">
      <style>{WL_CSS}</style>
      <div className="grid-bg" />

      {justPurchased && (
        <div className="confirmed">
          <div className="wrap">
            <span>✅ <b>{name ? `Great purchase, ${name}!` : 'Your purchase is confirmed.'}</b> Your D2C Funnel Breakdown Pack is ready below.</span>
          </div>
        </div>
      )}

      <nav>
        <div className="wrap">
          <a className="logo"><span className="mk">GE</span><span>Growth Escalators<small>White-Label Partners</small></span></a>
          <div className="nav-right">
            <span className="nav-note">Trusted by <b>Indian D2C brands</b></span>
            <button className="btn btn-primary" onClick={() => scrollTo('apply')}>Book Discovery Call</button>
          </div>
        </div>
      </nav>

      {justPurchased && (
        <section className="downloads">
          <div className="wrap">
            <div className="dl-card reveal in">
              <div className="dl-head">
                <span className="dl-tag">✅ Purchase Confirmed</span>
                <h3>{name ? `${name}, your` : 'Your'} pack is ready</h3>
                <p>{email ? `We've also sent a copy to ${email}.` : 'Tap below to download what you bought.'}</p>
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

      <section className="herovid">
        <div className="wrap">
          <div className="frame reveal in">
            <div className="vbadges">
              <span className="vbadge"><span className="lvdot" /> PARTNER PROGRAM</span>
              <span className="vbadge">▶ Watch how it works</span>
            </div>
            <div className="yt-wrap">
              <iframe
                src="https://www.youtube.com/embed/hTlmBJkjS_I?rel=0&modestbranding=1"
                title="Growth Escalators White-Label Partner Program"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <div className="voverlay">
              <div>
                <h2>Your brand on the front. Our team on the back.</h2>
                <p className="vsub">See how agencies deliver agency-grade Meta Ads — without hiring a single person.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <header className="hero">
        <div className="wrap reveal in">
          <span className="eyebrow"><span className="dot" /> White-Label Partner Program</span>
          <h1>Run Meta Ads for your clients — under <em>your</em> brand.</h1>
          <p className="lead">Your brand on the front. Our team on the back. You keep the margin, we do the work.</p>
          <div className="hero-cta">
            <button className="btn btn-primary btn-lg" onClick={() => scrollTo('apply')}>See If This Fits Your Agency →</button>
            <button className="btn btn-ghost btn-lg" onClick={() => scrollTo('program')}>What's inside</button>
          </div>
          <div className="hero-proof">Powering fulfilment for <b>D2C brands &amp; growing agencies</b> across India</div>
        </div>
      </header>

      <div className="econ">
        <div className="wrap reveal in">
          <div className="econ-card">
            <div className="econ-row">
              <div className="econ-col you"><div className="k">You charge your client</div><div className="v">₹2–3L<span style={{ fontSize: '0.5em' }}>/mo</span></div><div className="sub">Your pricing, your relationship</div></div>
              <div className="econ-op">−</div>
              <div className="econ-col we"><div className="k">We charge you</div><div className="v">$900<span style={{ fontSize: '0.5em' }}>/mo</span></div><div className="sub">Full fulfilment, done-for-you</div></div>
              <div className="econ-op">=</div>
              <div className="econ-col keep"><div className="k">You keep</div><div className="v">The margin</div><div className="sub">Every single month</div></div>
            </div>
            <div className="econ-foot">Deliver agency-grade Meta Ads at <b>60–70% lower fulfilment cost</b> — your brand, our execution.</div>
          </div>
        </div>
      </div>

      <div className="logos">
        <div className="wrap">
          <div className="lbl">Brands run through our fulfilment engine</div>
          <div className="logo-row">{PARTNERS.map(n => <span className="brand" key={n}>{n}</span>)}</div>
        </div>
      </div>

      <section id="program">
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">The program</div>
            <h2>What's inside the White-Label Partner Program</h2>
            <p>Everything your clients see as "your team" — delivered quietly by ours.</p>
          </div>
          <div className="features">
            {FEATURES.map((f, i) => (
              <div className="feat reveal" key={f.h} style={{ transitionDelay: `${i * 0.06}s` }}>
                <div className="ic">{f.ic}</div><h4>{f.h}</h4><p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">How the partnership works</div>
            <h2>From handshake to handed-off in four steps.</h2>
          </div>
          <div className="flow reveal">
            {FLOW.map((f, i) => (
              <div className="flow-step" key={f.h}>
                <div className="n">{i + 1}</div><h4>{f.h}</h4><p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">Is this for you?</div>
            <h2>Built for agencies ready to scale without hiring.</h2>
          </div>
          <div className="split reveal">
            <div className="col-box col-yes">
              <h3>✓ This fits if you…</h3>
              <ul>
                <li><span className="m">✓</span> Already sell to D2C / e-commerce clients</li>
                <li><span className="m">✓</span> Want to add Meta Ads without building a team</li>
                <li><span className="m">✓</span> Care about retention and clean reporting</li>
                <li><span className="m">✓</span> Are comfortable owning the client relationship</li>
              </ul>
            </div>
            <div className="col-box col-no">
              <h3>✕ Not a fit if you…</h3>
              <ul>
                <li><span className="m">✕</span> Want the cheapest freelancer, not a partner</li>
                <li><span className="m">✕</span> Expect to resell with zero involvement</li>
                <li><span className="m">✕</span> Don't have clients to onboard yet</li>
                <li><span className="m">✕</span> Aren't ready to charge premium retainers</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="proofbar reveal">
            <div className="inner">
              <div><div className="num">$900</div><div className="lbl">flat fulfilment / client / mo</div></div>
              <div><div className="num">60–70%</div><div className="lbl">lower than in-house cost</div></div>
              <div><div className="num">187+</div><div className="lbl">brands scaled</div></div>
              <div><div className="num">₹8.9Cr+</div><div className="lbl">ad spend managed</div></div>
            </div>
          </div>
        </div>
      </section>

      <section id="apply" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">Apply</div>
            <h2>Book a White-Label Discovery Call</h2>
            <p>30 minutes. We'll understand your agency and see if the partner program is a fit.</p>
          </div>
          <div className="apply reveal">
            <div className="book-card">
              <h3>Grab a slot now</h3>
              <p>Pick a time that suits you — we'll send the agenda over before the call.</p>
              <a className="btn btn-primary btn-lg" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer" style={{ marginTop: 18, display: 'inline-block', textAlign: 'center' }}>Book on Cal.com →</a>
              <div className="minical">⚡ Instant confirmation · agenda sent to your inbox</div>
            </div>
            <div className="book-card">
              <h3>Prefer to reach out directly?</h3>
              <p>Drop us a line and we'll get back within one working day.</p>
              <a className="mail-link" href="mailto:jatin@growthescalators.com">jatin@growthescalators.com</a>
              <div className="contact-meta">
                <div>📍 Jaipur, Rajasthan, India</div>
                <div>📞 +91 77338 88883</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal"><div className="sec-tag">Questions</div><h2>Partner FAQ.</h2></div>
          <div className="faq reveal">
            <details open><summary>Will my clients ever know it's you? <span className="pl">+</span></summary><div className="ans">No. Everything client-facing — reports, dashboards, communication standards — is white-labelled under your brand. We stay entirely behind the scenes.</div></details>
            <details><summary>How does pricing actually work? <span className="pl">+</span></summary><div className="ans">You charge your client whatever your market supports (typically ₹2–3L/month). We charge you a flat $900/month per client for full fulfilment. The difference is your margin.</div></details>
            <details><summary>Is there a minimum commitment? <span className="pl">+</span></summary><div className="ans">We work month-to-month per client, with clear SLAs. We'll walk through the exact terms on the discovery call.</div></details>
            <details><summary>What if a client needs more than Meta Ads? <span className="pl">+</span></summary><div className="ans">Meta is our core. We'll tell you honestly on the call what's in scope and what isn't, so you never over-promise to a client.</div></details>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap reveal">
          <h2>Add a profit centre without adding headcount.</h2>
          <p>See if the White-Label Partner Program fits your agency.</p>
          <a className="btn btn-primary btn-lg" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 34 }}>Book a Discovery Call →</a>
          <div className="note"><span>🤝 30-min, no obligation</span><span>🕵️ Fully white-labelled</span><span>✅ We vet every application</span></div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <a className="logo"><span className="mk">GE</span><span>Growth Escalators<small>India's D2C Performance Marketing Agency</small></span></a>
          <div style={{ textAlign: 'right' }}>
            <a className="mail" href="mailto:jatin@growthescalators.com">jatin@growthescalators.com</a>
            <div className="tag">© Growth Escalators. White-label performance marketing for agencies.</div>
          </div>
        </div>
      </footer>

      <PurchaseToast show={showToast} onClose={() => setShowToast(false)} autoDismissMs={5000} />
    </div>
  );
}

// CSS scoped under .wl-page so the dark theme doesn't bleed onto other routes.
// Variables on .wl-page cascade to all descendants via CSS custom-property
// inheritance, and the `<style>` element unmounts with the component, so when
// users navigate away the style sheet detaches automatically.
const WL_CSS = `
.wl-page{--bg:#080c17;--bg2:#0c1222;--panel:#111a30;--panel2:#152038;--card:#101830;--line:#202f4d;--line2:#2d3f64;--ink:#eef2fb;--muted:#9fb0d0;--faint:#6e80a0;--accent:#5b8cff;--accent2:#8b6cff;--accent-soft:#a6c0ff;--gold:#e8c07d;--green:#4fd99a;--glow:rgba(91,140,255,.35);--display:'Newsreader',serif;--sans:'Space Grotesk','Inter',sans-serif;--maxw:1200px;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden;position:relative;min-height:100vh}
.wl-page::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(760px 520px at 86% -8%,rgba(139,108,255,.18),transparent 58%),radial-gradient(680px 480px at 4% 4%,rgba(91,140,255,.14),transparent 55%)}
.wl-page *{margin:0;padding:0;box-sizing:border-box}
.wl-page .grid-bg{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;background-image:linear-gradient(rgba(91,140,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(91,140,255,.05) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(circle at 50% 0%,#000,transparent 72%);mask-image:radial-gradient(circle at 50% 0%,#000,transparent 72%)}
.wl-page .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px;position:relative;z-index:1}
.wl-page a{color:inherit;text-decoration:none}
.wl-page img{display:block;max-width:100%}
.wl-page .confirmed{background:linear-gradient(90deg,rgba(79,217,154,.16),rgba(79,217,154,.05));border-bottom:1px solid rgba(79,217,154,.28);font-size:13.5px;color:#bff5dd;position:relative;z-index:5}
.wl-page .confirmed .wrap{display:flex;align-items:center;gap:12px;padding:11px 24px;flex-wrap:wrap}
.wl-page .confirmed b{color:#d1fae5}
.wl-page nav{position:sticky;top:0;z-index:40;backdrop-filter:blur(16px);background:rgba(8,12,23,.72);border-bottom:1px solid var(--line)}
.wl-page nav .wrap{display:flex;align-items:center;justify-content:space-between;height:70px}
.wl-page .logo{display:flex;align-items:center;gap:11px;font-weight:600;letter-spacing:-.01em}
.wl-page .logo .mk{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#fff;font-weight:700;font-size:17px;box-shadow:0 8px 22px -6px var(--glow)}
.wl-page .logo small{display:block;font-size:10px;color:var(--faint);font-weight:500;letter-spacing:.1em;text-transform:uppercase}
.wl-page .nav-right{display:flex;align-items:center;gap:18px}
.wl-page .nav-note{font-size:13px;color:var(--muted)}
.wl-page .nav-note b{color:var(--accent-soft)}
.wl-page .btn{font-family:var(--sans);cursor:pointer;border:none;font-weight:600;border-radius:12px;transition:transform .18s,box-shadow .18s}
.wl-page .btn-ghost{background:transparent;border:1px solid var(--line2);color:var(--ink);padding:12px 20px;font-size:14px}
.wl-page .btn-ghost:hover{border-color:var(--accent);color:var(--accent-soft)}
.wl-page .btn-primary{background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;padding:15px 28px;font-size:15px;box-shadow:0 12px 34px -10px var(--glow)}
.wl-page .btn-primary:hover{transform:translateY(-2px);box-shadow:0 18px 44px -10px var(--glow)}
.wl-page .btn-lg{padding:18px 36px;font-size:16.5px}
.wl-page .downloads{padding:36px 0 0}
.wl-page .dl-card{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:22px;padding:32px 30px;box-shadow:0 30px 60px -30px rgba(0,0,0,.65);position:relative;overflow:hidden}
.wl-page .dl-card::before{content:"";position:absolute;inset:0;background:radial-gradient(500px 240px at 100% -10%,rgba(79,217,154,.18),transparent 60%);opacity:.7;pointer-events:none}
.wl-page .dl-head{position:relative;text-align:center;margin-bottom:22px}
.wl-page .dl-tag{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green);background:rgba(79,217,154,.12);border:1px solid rgba(79,217,154,.3);padding:6px 12px;border-radius:999px;margin-bottom:14px}
.wl-page .dl-head h3{font-family:var(--display);font-weight:600;font-size:clamp(22px,3vw,30px);letter-spacing:-.01em}
.wl-page .dl-head p{color:var(--muted);font-size:14.5px;margin-top:8px}
.wl-page .dl-actions{position:relative;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.wl-page .dl-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:600;font-size:14.5px;transition:transform .18s,box-shadow .18s}
.wl-page .dl-btn:hover{transform:translateY(-2px)}
.wl-page .dl-btn.primary{background:linear-gradient(120deg,var(--green),#34d399);color:#04201a;box-shadow:0 10px 28px -10px rgba(79,217,154,.5)}
.wl-page .dl-btn.warm{background:linear-gradient(120deg,#ff9e44,#ff7a18);color:#1a0c02;box-shadow:0 10px 28px -10px rgba(255,122,24,.5)}
.wl-page .dl-btn.deep{background:linear-gradient(120deg,#a78bfa,#7c3aed);color:#fff;box-shadow:0 10px 28px -10px rgba(124,58,237,.5)}
.wl-page .herovid{padding:30px 0 0}
.wl-page .herovid .frame{position:relative;border-radius:26px;overflow:hidden;border:1px solid var(--line2);background:#000;box-shadow:0 50px 110px -50px rgba(0,0,0,.9)}
.wl-page .herovid .frame::before{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;border-radius:26px;box-shadow:inset 0 0 100px var(--glow);opacity:.5}
.wl-page .yt-wrap{position:relative;width:100%;aspect-ratio:21/9;background:#000}
.wl-page .yt-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
@media(max-width:760px){.wl-page .yt-wrap{aspect-ratio:16/10}}
.wl-page .vbadges{position:absolute;left:22px;top:20px;z-index:4;display:flex;gap:9px;flex-wrap:wrap}
.wl-page .vbadge{display:inline-flex;align-items:center;gap:8px;background:rgba(0,0,0,.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);color:#fff;font-size:12px;font-weight:600;letter-spacing:.03em;padding:7px 13px;border-radius:999px}
.wl-page .lvdot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent);animation:wl-pulse 1.5s infinite}
@keyframes wl-pulse{0%,100%{opacity:1}50%{opacity:.25}}
.wl-page .voverlay{position:absolute;left:0;right:0;bottom:0;z-index:4;padding:38px 40px;pointer-events:none}
.wl-page .voverlay h2{font-family:var(--display);font-weight:500;font-style:italic;font-size:clamp(22px,3.4vw,40px);color:#fff;letter-spacing:-.02em;line-height:1.12;max-width:20ch;text-shadow:0 4px 30px rgba(0,0,0,.6)}
.wl-page .voverlay .vsub{color:#cdd6ea;font-size:14.5px;margin-top:8px;max-width:44ch;font-family:var(--sans)}
.wl-page .hero{padding:54px 0 26px;text-align:center;position:relative}
.wl-page .eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-soft);background:rgba(91,140,255,.09);border:1px solid rgba(91,140,255,.26);padding:8px 16px;border-radius:999px;margin-bottom:26px}
.wl-page .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.wl-page h1{font-family:var(--display);font-weight:500;font-size:clamp(42px,6vw,74px);line-height:1.0;letter-spacing:-.025em;max-width:16ch;margin:0 auto}
.wl-page h1 em{font-style:italic;background:linear-gradient(120deg,var(--accent-soft),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.wl-page .lead{color:var(--muted);font-size:20px;margin:24px auto 0;max-width:52ch}
.wl-page .hero-cta{margin-top:34px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
.wl-page .hero-proof{margin-top:30px;color:var(--faint);font-size:13.5px}
.wl-page .hero-proof b{color:var(--ink)}
.wl-page .econ{position:relative;padding:48px 0 70px}
.wl-page .econ-card{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:28px;padding:14px;box-shadow:0 50px 100px -50px rgba(0,0,0,.85);position:relative;overflow:hidden}
.wl-page .econ-card::before{content:"";position:absolute;inset:0;background:radial-gradient(620px 300px at 50% -10%,var(--glow),transparent 60%);opacity:.4}
.wl-page .econ-row{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:stretch;position:relative}
.wl-page .econ-col{padding:42px 34px;text-align:center}
.wl-page .econ-col .k{font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:14px}
.wl-page .econ-col .v{font-family:var(--display);font-size:clamp(30px,3.6vw,46px);font-weight:600;line-height:1;letter-spacing:-.02em}
.wl-page .econ-col .sub{color:var(--muted);font-size:13.5px;margin-top:10px}
.wl-page .econ-col.you .v{color:var(--green)}
.wl-page .econ-col.we .v{color:var(--accent-soft)}
.wl-page .econ-col.keep .v{background:linear-gradient(120deg,var(--gold),#f0d9a8);-webkit-background-clip:text;background-clip:text;color:transparent}
.wl-page .econ-op{display:grid;place-items:center;font-family:var(--display);font-size:34px;color:var(--line2);font-weight:600}
.wl-page .econ-foot{position:relative;text-align:center;padding:22px;border-top:1px solid var(--line);color:var(--muted);font-size:15px}
.wl-page .econ-foot b{color:var(--accent-soft)}
.wl-page section{padding:82px 0;position:relative}
.wl-page .sec-head{max-width:660px;margin-bottom:48px}
.wl-page .sec-head.center{margin:0 auto 48px;text-align:center}
.wl-page .sec-tag{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-soft);margin-bottom:16px}
.wl-page h2{font-family:var(--display);font-weight:500;font-size:clamp(30px,4vw,46px);line-height:1.06;letter-spacing:-.02em}
.wl-page .sec-head p{color:var(--muted);font-size:17px;margin-top:14px}
.wl-page .logos{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--bg2)}
.wl-page .logos .wrap{padding:30px 24px}
.wl-page .logos .lbl{text-align:center;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:20px}
.wl-page .logo-row{display:flex;justify-content:center;align-items:center;gap:14px;flex-wrap:wrap}
.wl-page .brand{font-family:var(--display);font-weight:600;font-size:20px;color:var(--muted);opacity:.78;letter-spacing:.02em;transition:.25s;white-space:nowrap}
.wl-page .brand:hover{opacity:1;color:var(--ink)}
.wl-page .features{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.wl-page .feat{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px;transition:.25s;position:relative;overflow:hidden}
.wl-page .feat:hover{border-color:var(--accent);transform:translateY(-5px)}
.wl-page .feat::after{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),var(--accent2));opacity:0;transition:.25s}
.wl-page .feat:hover::after{opacity:1}
.wl-page .feat .ic{width:52px;height:52px;border-radius:14px;background:rgba(91,140,255,.1);border:1px solid rgba(91,140,255,.26);display:grid;place-items:center;font-size:24px;margin-bottom:18px}
.wl-page .feat h4{font-size:18.5px;letter-spacing:-.01em}
.wl-page .feat p{color:var(--muted);font-size:14.5px;margin-top:9px;line-height:1.6}
.wl-page .flow{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.wl-page .flow-step{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;position:relative;transition:.25s}
.wl-page .flow-step:hover{border-color:var(--line2);transform:translateY(-4px)}
.wl-page .flow-step .n{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:700;display:grid;place-items:center;font-size:15px;margin-bottom:16px}
.wl-page .flow-step h4{font-size:16.5px}
.wl-page .flow-step p{color:var(--muted);font-size:13.5px;margin-top:8px}
.wl-page .split{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.wl-page .col-box{border-radius:22px;padding:36px}
.wl-page .col-yes{background:linear-gradient(170deg,rgba(79,217,154,.08),transparent);border:1px solid rgba(79,217,154,.24)}
.wl-page .col-no{background:linear-gradient(170deg,rgba(239,68,68,.06),transparent);border:1px solid rgba(239,68,68,.2)}
.wl-page .col-box h3{font-family:var(--display);font-size:24px;font-weight:600;margin-bottom:22px}
.wl-page .col-box ul{list-style:none;display:flex;flex-direction:column;gap:14px}
.wl-page .col-box li{display:flex;gap:12px;font-size:15px;color:#d3dcef}
.wl-page .col-box li .m{flex:none;font-weight:700}
.wl-page .col-yes li .m{color:var(--green)}
.wl-page .col-no li .m{color:#f87171}
.wl-page .proofbar{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:26px;position:relative;overflow:hidden}
.wl-page .proofbar::before{content:"";position:absolute;top:-40%;left:-5%;width:400px;height:400px;background:radial-gradient(circle,var(--glow),transparent 65%);opacity:.3}
.wl-page .proofbar .inner{position:relative;display:flex;justify-content:space-around;gap:20px;padding:42px 24px;flex-wrap:wrap;text-align:center}
.wl-page .proofbar .num{font-family:var(--display);font-size:clamp(32px,4vw,46px);font-weight:600;line-height:1;background:linear-gradient(120deg,#fff,var(--accent-soft));-webkit-background-clip:text;background-clip:text;color:transparent}
.wl-page .proofbar .lbl{font-size:13px;color:var(--muted);margin-top:10px}
.wl-page .apply{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:stretch}
.wl-page .book-card{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:24px;padding:40px;display:flex;flex-direction:column}
.wl-page .book-card h3{font-family:var(--display);font-size:25px;font-weight:600;letter-spacing:-.01em}
.wl-page .book-card p{color:var(--muted);font-size:14.5px;margin-top:8px;margin-bottom:24px}
.wl-page .minical{margin-top:20px;color:var(--green);font-size:13.5px;font-weight:600}
.wl-page .mail-link{color:var(--accent-soft);font-size:17px;font-weight:600;margin-bottom:24px;display:inline-block;border-bottom:1px solid var(--accent-soft);padding-bottom:2px;align-self:flex-start}
.wl-page .contact-meta{color:var(--muted);font-size:14px;display:flex;flex-direction:column;gap:10px;margin-top:auto}
.wl-page .faq{max-width:800px;margin:0 auto}
.wl-page details{border:1px solid var(--line);border-radius:15px;background:var(--card);margin-bottom:12px;overflow:hidden}
.wl-page details[open]{border-color:var(--line2)}
.wl-page summary{cursor:pointer;list-style:none;padding:21px 24px;font-weight:600;font-size:16px;display:flex;justify-content:space-between;gap:16px;align-items:center}
.wl-page summary::-webkit-details-marker{display:none}
.wl-page summary .pl{flex:none;color:var(--accent-soft);font-size:23px;transition:.25s;line-height:1}
.wl-page details[open] summary .pl{transform:rotate(45deg)}
.wl-page details .ans{padding:0 24px 22px;color:var(--muted);font-size:15px;line-height:1.7}
.wl-page .final{text-align:center;padding:92px 0}
.wl-page .final h2{max-width:18ch;margin:0 auto;font-size:clamp(32px,4.6vw,54px)}
.wl-page .final p{color:var(--muted);font-size:18px;margin-top:16px}
.wl-page .final .note{color:var(--faint);font-size:13.5px;margin-top:18px;display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
.wl-page .final .note span{display:inline-flex;align-items:center;gap:7px}
.wl-page footer{border-top:1px solid var(--line);background:var(--bg2);padding:46px 0}
.wl-page footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.wl-page footer .tag{color:var(--faint);font-size:13.5px;max-width:46ch;margin-top:6px}
.wl-page footer a.mail{color:var(--accent-soft);font-size:14px}
.wl-page .reveal{opacity:0;transform:translateY(24px);transition:opacity .7s,transform .7s}
.wl-page .reveal.in{opacity:1;transform:none}
@media(max-width:900px){
  .wl-page .econ-row{grid-template-columns:1fr}.wl-page .econ-op{padding:6px 0;font-size:26px}
  .wl-page .features,.wl-page .flow{grid-template-columns:1fr}
  .wl-page .split,.wl-page .apply{grid-template-columns:1fr}
  .wl-page .voverlay{padding:24px}.wl-page .nav-note{display:none}
  .wl-page .proofbar .inner{padding:30px 22px}
}
`;
