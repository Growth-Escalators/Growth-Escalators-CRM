import { useState, useEffect, useRef } from 'react';
import PurchaseToast from '../components/PurchaseToast';
import { apiUrl } from '../services/api';

// Real photo of Jatin from the R2 bucket — replaces the stock Unsplash photo
// the design template shipped with. Stable URL the rest of the funnel uses too.
const JATIN_PHOTO_URL = 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/public/jatin-profile.png';

const ASSETS = {
  mainPdf:   'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
  growthKit: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
  auditCall: 'https://cal.com/growth-escalators/discovery-call',
};

const CLIENT_BRANDS = ['Paraiso', 'Odra', 'Dr. Dheeraj Dubay', 'Elixzor', 'SN Herbals', 'Gentle Panda', 'Atatica'];

// Real case-study outcomes from the portfolio, not invented quotes.
const RESULTS = [
  {
    brand: 'Paraiso Comfortwears',
    industry: 'D2C Fashion · India',
    headline: '₹33k → ₹3.4L monthly sales in 30 days',
    detail: 'Plus 5M+ views on one reel and 20M+ overall Instagram reach — organic + paid stacked together.',
    badge: '📈 10× monthly sales',
  },
  {
    brand: 'Elixzor Media',
    industry: 'YouTube Automation · USA',
    headline: '₹3.2 Cr revenue at 10× ROAS',
    detail: 'Lead generation + full funnel marketing for a US YouTube automation business.',
    badge: '💰 ₹3.2 Cr revenue',
  },
  {
    brand: 'Dr. Dheeraj Dubay',
    industry: 'Healthcare · India',
    headline: '35,000+ PR mentions & qualified leads',
    detail: 'Built the Next.js site for North India\'s top joint-replacement surgeon. Forbes World Record post-launch.',
    badge: '🏆 Forbes World Record',
  },
];

const VALUE_CARDS = [
  { ic: '🔍', h: 'Live account review', p: 'We open your Meta Ads Manager together and walk through exactly where your spend is going.' },
  { ic: '📋', h: '3 same-day fixes', p: 'You leave with three specific, prioritised changes you can implement before the day is over.' },
  { ic: '🗺️', h: 'Personalised roadmap', p: 'A clear next-90-days path mapped to your stage, budget and category — never a recycled framework.' },
];

const PAIN_POINTS = [
  "Spending lakhs on ads but can't tell which part of the funnel is leaking money.",
  'Bought courses that gave theory — but no execution map you could follow.',
  'ROAS plateaued and scaling has completely stalled.',
  'Watching competitors grow faster on the same platforms and budgets.',
];

const STEPS = [
  { h: 'Pick a slot', p: 'Grab a time that suits you. Instant calendar confirmation, no back-and-forth.' },
  { h: 'Hop on Zoom', p: 'Jatin reviews your account live — screen-shared, with your real numbers.' },
  { h: 'Leave with a plan', p: 'Three fixes plus a 90-day roadmap. Implement the same day.' },
];

const SEGMENT_HEADLINE = {
  d2c:        "your D2C funnel framework is on its way 🎉",
  agency:     "your D2C funnel breakdown is on its way 🎉",
  freelancer: "your D2C funnel breakdown is on its way 🎉",
};

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
  const justPurchased = !!(name || email || orderId || hasBump1 || hasBump2);

  const [upsellDone, setUpsellDone]     = useState(false);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [showToast, setShowToast]       = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

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
    document.querySelectorAll('.cs-page .reveal:not(.in)').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [upsellDone]); // re-bind after upsell card unmounts

  async function handleUpsell() {
    setUpsellLoading(true);
    try {
      const res = await fetch(apiUrl('/api/cashfree/upsell'), {
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

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  // Show the embedded VSL for D2C/direct visitors but not for agency/freelancer
  // segments (they get the white-label / cohort funnels respectively).
  const showVsl = segment !== 'agency' && segment !== 'freelancer';
  const showUpsell = justPurchased && !hasBump2 && !upsellDone;

  return (
    <div className="cs-page">
      <style>{CS_CSS}</style>
      <div className="grain" />

      {justPurchased && (
        <div className="confirmed">
          <div className="wrap">
            <span>✅ <b>{name ? `Great purchase, ${name}!` : 'Your purchase is confirmed.'}</b> {SEGMENT_HEADLINE[segment] ?? SEGMENT_HEADLINE.d2c}</span>
            <span className="dl"><a href={ASSETS.mainPdf} target="_blank" rel="noopener noreferrer">📄 Download Pack</a></span>
          </div>
        </div>
      )}

      <nav>
        <div className="wrap">
          <a className="logo"><span className="mk">GE</span><span>Growth Escalators<small>Consulting</small></span></a>
          <div className="nav-right">
            <div className="nav-rating"><span className="st">★★★★★</span> Trusted by 187+ brands</div>
            <button className="btn btn-primary" onClick={() => scrollTo('book')}>Book a Free Call</button>
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
                {hasBump1 && <a className="dl-btn warm" href={ASSETS.growthKit} target="_blank" rel="noopener noreferrer">📦 Download Growth Kit</a>}
                {hasBump2 && <a className="dl-btn deep" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer">🎯 Book Your 45-Min Audit Call</a>}
              </div>
            </div>
          </div>
        </section>
      )}

      {showVsl && (
        <section className="herovid">
          <div className="wrap">
            <div className="frame reveal in">
              {videoPlaying ? (
                <div className="yt-wrap">
                  <iframe
                    src="https://www.youtube.com/embed/lk8RYlChTnI?rel=0&modestbranding=1&autoplay=1"
                    title="Growth Escalators D2C Growth Strategy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              ) : (
                <button type="button" className="yt-poster" onClick={() => setVideoPlaying(true)} aria-label="Play video">
                  <img className="yt-poster-img" src="https://img.youtube.com/vi/lk8RYlChTnI/maxresdefault.jpg" alt="" />
                  <div className="vbadges">
                    <span className="vbadge"><span className="lvdot" /> LIVE WALKTHROUGH</span>
                    <span className="vbadge">▶ Watch before your next campaign</span>
                  </div>
                  <span className="play-btn" aria-hidden="true">▶</span>
                  <div className="voverlay">
                    <div>
                      <h2>See exactly how India's top D2C brands build their funnels.</h2>
                      <p className="vsub">A short look at what we cover on your free strategy call.</p>
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <header className="hero">
        <div className="wrap hero-grid">
          <div className="reveal in">
            <span className="eyebrow"><span className="dot" /> For D2C Founders</span>
            <h1>Book a free 30-min <em>strategy call</em> with Jatin.</h1>
            <p className="lead">No pitch. Just clarity on exactly what's holding your ROAS back — and the three things to fix first.</p>
            <div className="hero-cta">
              <a className="btn btn-primary btn-lg" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); scrollTo('book'); }}>Book My Free Strategy Call →</a>
            </div>
            <div className="social-proof">
              <div className="sp-txt"><span className="st">★★★★★</span><br /><b>187+ brands scaled</b> · ₹8.9 Cr+ in ad spend managed</div>
            </div>
          </div>
          <div className="coach reveal in" style={{ transitionDelay: '0.1s' }}>
            <div className="ctop"><img src={JATIN_PHOTO_URL} alt="Jatin Agrawal" /></div>
            <div className="cbody">
              <span className="cflag">★ Your strategist</span>
              <h3>Jatin Agrawal</h3>
              <div className="role">Founder, Growth Escalators</div>
              <div className="cstats">
                <div className="cstat"><b>₹8.9Cr+</b><span>ad spend managed</span></div>
                <div className="cstat"><b>187+</b><span>brands scaled</span></div>
                <div className="cstat"><b>98%</b><span>satisfaction</span></div>
              </div>
              <p className="quote">"I'll review your Meta account live and hand you 3 fixes you can ship the same day — tailored to your store, not theory."</p>
            </div>
          </div>
        </div>
      </header>

      <div className="logos">
        <div className="wrap">
          <div className="lbl">Brands Growth Escalators has scaled</div>
          <div className="logo-row">{CLIENT_BRANDS.map(b => <span className="brand" key={b}>{b}</span>)}</div>
        </div>
      </div>

      <section>
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="sec-tag">What you get on the call</div>
            <h2>30 focused minutes. A real plan you can act on today.</h2>
          </div>
          <div className="cards">
            {VALUE_CARDS.map((c, i) => (
              <div className="card reveal" key={c.h} style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className="ic">{c.ic}</div><h4>{c.h}</h4><p>{c.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="results reveal">
            <div className="rhead">
              <h2>The numbers behind the advice.</h2>
              <p>Real outcomes from brands that took the call and shipped the fixes.</p>
            </div>
            <div className="rgrid">
              <div className="rstat"><div className="big">₹8.9Cr+</div><div className="cap">Meta ad spend managed</div></div>
              <div className="rstat"><div className="big">120%</div><div className="cap">Avg. ROAS lift</div></div>
              <div className="rstat"><div className="big">187+</div><div className="cap">Brands scaled</div></div>
              <div className="rstat"><div className="big">98%</div><div className="cap">Client satisfaction</div></div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="pain reveal">
            <h2>Sound familiar?</h2>
            <p className="sub">If any of these are true, this call will save you weeks of guessing.</p>
            <div className="pain-grid">
              {PAIN_POINTS.map(p => (
                <div className="pain-item" key={p}><span className="x">✕</span><p>{p}</p></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">How it works</div>
            <h2>Three steps to clarity.</h2>
          </div>
          <div className="steps reveal">
            {STEPS.map((s, i) => (
              <div className="step" key={s.h}>
                <div className="n">{i + 1}</div><h4>{s.h}</h4><p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RESULTS — real case studies (not invented testimonials) */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">From the portfolio</div>
            <h2>Real brands. Real numbers.</h2>
          </div>
          <div className="tcards">
            {RESULTS.map((r, i) => (
              <div className="t reveal" key={r.brand} style={{ transitionDelay: `${i * 0.08}s` }}>
                <div className="t-brand">
                  <div className="t-initial">{r.brand.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                  <div>
                    <b>{r.brand}</b>
                    <small>{r.industry}</small>
                  </div>
                </div>
                <h4 className="t-headline">{r.headline}</h4>
                <p>{r.detail}</p>
                <div className="res">{r.badge}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* UPSELL — preserved from the original React funnel.
          Only renders post-purchase, when the audit-call bump wasn't already taken. */}
      {showUpsell && (
        <section style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="upsell-card reveal">
              <div className="upsell-head">
                <span className="upsell-tag">One more thing before you go…</span>
                <h3>Book a 1-on-1 Growth Audit Call with Jatin — ₹499</h3>
              </div>
              <ul className="upsell-list">
                <li><span className="arrow">→</span> 45 minutes with Jatin personally</li>
                <li><span className="arrow">→</span> Full audit of your current Meta Ads funnel</li>
                <li><span className="arrow">→</span> 90-day growth roadmap for your brand</li>
                <li><span className="arrow">→</span> Recording sent after the call</li>
              </ul>
              <button onClick={handleUpsell} disabled={upsellLoading} className="upsell-cta">
                {upsellLoading ? 'Processing…' : 'Add Growth Audit — ₹499'}
              </button>
            </div>
          </div>
        </section>
      )}
      {upsellDone && (
        <section style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="upsell-done reveal in">
              <span>✅</span> Growth Audit added. Check your email for booking details.
            </div>
          </div>
        </section>
      )}

      {/* BOOKING */}
      <section id="book" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="booking reveal">
            <h2>Pick a time that works for you.</h2>
            <p className="sub">Limited slots each week — Jatin takes these personally.</p>
            <div className="cal-frame">
              <div className="ci">📅</div>
              <div className="cn">Book instantly via Cal.com</div>
              <a className="btn btn-primary btn-lg" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer" style={{ marginTop: 22, display: 'inline-block' }}>
                Open Cal.com to Pick a Slot →
              </a>
            </div>
            <div className="trust-badges">
              <div className="tb"><span className="tbi">🛡️</span> <b>No pitch</b>&nbsp;promise</div>
              <div className="tb"><span className="tbi">🔒</span> No card required to book</div>
              <div className="tb"><span className="tbi">⚡</span> Instant confirmation</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head center reveal">
            <div className="sec-tag">Questions</div>
            <h2>Before you book.</h2>
          </div>
          <div className="faq reveal">
            <details open><summary>Is the call really free? <span className="pl">+</span></summary><div className="ans">Yes. The 30-minute strategy call is free and no-obligation. We offer it because the fastest way to show how we work is to actually help you.</div></details>
            <details><summary>What if I'm still pre-launch? <span className="pl">+</span></summary><div className="ans">Perfect timing. We'll map the funnel before you spend a rupee on ads, so you launch with a structure already proven across the brands we've scaled.</div></details>
            <details><summary>Will you just try to sell me something? <span className="pl">+</span></summary><div className="ans">No pitch. The call is built to give you clarity. If a deeper engagement makes sense for both sides, we'll mention it — but value comes first, every time.</div></details>
            <details><summary>How do I prepare? <span className="pl">+</span></summary><div className="ans">Just have access to your Meta Ads Manager. We'll review it live together — no decks or prep work needed.</div></details>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap reveal">
          <h2>Stop guessing. Start growing.</h2>
          <p>Join the 187+ brands Growth Escalators has scaled with clarity, not theory.</p>
          <a className="btn btn-primary btn-lg" href={ASSETS.auditCall} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 34 }}>Book My Free Strategy Call →</a>
          <div className="note"><span>✅ No pitch</span><span>🔒 No card required</span><span>⚡ Instant confirmation</span></div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <a className="logo"><span className="mk">GE</span><span>Growth Escalators<small>India's D2C Performance Marketing Agency</small></span></a>
          <div style={{ textAlign: 'right' }}>
            <a className="mail" href="mailto:jatin@growthescalators.com">jatin@growthescalators.com</a>
            <div className="tag">© Growth Escalators. Helping Indian D2C brands turn clicks into orders.</div>
          </div>
        </div>
      </footer>

      <PurchaseToast show={showToast} onClose={() => setShowToast(false)} autoDismissMs={5000} />
    </div>
  );
}

const CS_CSS = `
.cs-page{--bg:#07090f;--bg2:#0b0e16;--panel:#10131d;--panel2:#151926;--card:#12151f;--line:#1e2433;--line2:#2b3447;--ink:#f4f5f9;--muted:#9aa3b8;--faint:#69728a;--accent:#ff7a18;--accent2:#ff9e44;--accent-soft:#ffb066;--accent-glow:rgba(255,122,24,.35);--green:#34d399;--gold:#ffd479;--display:'Fraunces','Newsreader',serif;--sans:'Sora','Inter',sans-serif;--maxw:1200px;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden;position:relative;min-height:100vh}
.cs-page::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(720px 480px at 8% -6%,rgba(255,122,24,.16),transparent 60%),radial-gradient(820px 560px at 108% 4%,rgba(120,80,255,.10),transparent 55%),radial-gradient(600px 600px at 50% 120%,rgba(255,122,24,.06),transparent 60%)}
.cs-page *{margin:0;padding:0;box-sizing:border-box}
.cs-page .grain{position:fixed;inset:0;z-index:0;opacity:.04;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.cs-page .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px;position:relative;z-index:1}
.cs-page a{color:inherit;text-decoration:none}
.cs-page img{display:block;max-width:100%}
.cs-page .confirmed{background:linear-gradient(90deg,rgba(52,211,153,.16),rgba(52,211,153,.05));border-bottom:1px solid rgba(52,211,153,.28);font-size:13.5px;color:#a7f3d0;position:relative;z-index:5}
.cs-page .confirmed .wrap{display:flex;align-items:center;gap:12px;padding:11px 24px;flex-wrap:wrap}
.cs-page .confirmed b{color:#d1fae5}
.cs-page .confirmed .dl{margin-left:auto}
.cs-page .confirmed .dl a{border:1px solid rgba(52,211,153,.4);padding:5px 13px;border-radius:999px;font-size:12.5px;font-weight:600;color:#a7f3d0;transition:.2s}
.cs-page .confirmed .dl a:hover{background:rgba(52,211,153,.16)}
.cs-page nav{position:sticky;top:0;z-index:40;backdrop-filter:blur(16px);background:rgba(7,9,15,.7);border-bottom:1px solid var(--line)}
.cs-page nav .wrap{display:flex;align-items:center;justify-content:space-between;height:70px}
.cs-page .logo{display:flex;align-items:center;gap:11px;font-weight:700;letter-spacing:-.01em}
.cs-page .logo .mk{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#1a0c02;font-weight:800;font-size:17px;box-shadow:0 8px 22px -6px var(--accent-glow)}
.cs-page .logo small{display:block;font-size:10px;color:var(--faint);font-weight:500;letter-spacing:.1em;text-transform:uppercase}
.cs-page .nav-right{display:flex;align-items:center;gap:18px}
.cs-page .nav-rating{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.cs-page .nav-rating .st{color:var(--accent);letter-spacing:1px}
.cs-page .btn{font-family:var(--sans);cursor:pointer;border:none;font-weight:600;border-radius:12px;transition:transform .18s,box-shadow .18s}
.cs-page .btn-primary{background:linear-gradient(180deg,var(--accent2),var(--accent));color:#1a0c02;padding:15px 28px;font-size:15px;box-shadow:0 12px 32px -8px var(--accent-glow)}
.cs-page .btn-primary:hover{transform:translateY(-2px);box-shadow:0 18px 44px -8px var(--accent-glow)}
.cs-page .btn-lg{padding:17px 34px;font-size:16.5px}
.cs-page .downloads{padding:36px 0 0}
.cs-page .dl-card{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:22px;padding:32px 30px;box-shadow:0 30px 60px -30px rgba(0,0,0,.65);position:relative;overflow:hidden}
.cs-page .dl-card::before{content:"";position:absolute;inset:0;background:radial-gradient(500px 240px at 100% -10%,rgba(52,211,153,.18),transparent 60%);opacity:.7;pointer-events:none}
.cs-page .dl-head{position:relative;text-align:center;margin-bottom:22px}
.cs-page .dl-tag{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green);background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3);padding:6px 12px;border-radius:999px;margin-bottom:14px}
.cs-page .dl-head h3{font-family:var(--display);font-weight:600;font-size:clamp(22px,3vw,30px);letter-spacing:-.01em}
.cs-page .dl-head p{color:var(--muted);font-size:14.5px;margin-top:8px}
.cs-page .dl-actions{position:relative;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.cs-page .dl-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:600;font-size:14.5px;transition:transform .18s}
.cs-page .dl-btn:hover{transform:translateY(-2px)}
.cs-page .dl-btn.primary{background:linear-gradient(120deg,var(--green),#22c55e);color:#04201a;box-shadow:0 10px 28px -10px rgba(52,211,153,.5)}
.cs-page .dl-btn.warm{background:linear-gradient(120deg,var(--accent2),var(--accent));color:#1a0c02;box-shadow:0 10px 28px -10px var(--accent-glow)}
.cs-page .dl-btn.deep{background:linear-gradient(120deg,#a78bfa,#7c3aed);color:#fff;box-shadow:0 10px 28px -10px rgba(124,58,237,.5)}
.cs-page .herovid{padding:30px 0 0}
.cs-page .herovid .frame{position:relative;border-radius:26px;overflow:hidden;border:1px solid var(--line2);background:#000;box-shadow:0 50px 110px -50px rgba(0,0,0,.9)}
.cs-page .herovid .frame::before{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;border-radius:26px;box-shadow:inset 0 0 100px var(--accent-glow);opacity:.5}
.cs-page .yt-wrap{position:relative;width:100%;aspect-ratio:21/9;background:#000}
.cs-page .yt-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.cs-page .yt-poster{position:relative;display:block;width:100%;aspect-ratio:21/9;background:#000;border:0;padding:0;margin:0;cursor:pointer;overflow:hidden}
.cs-page .yt-poster-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.82}
.cs-page .play-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:5;width:72px;height:72px;border-radius:50%;background:var(--accent);color:#1a0c02;display:grid;place-items:center;font-size:22px;box-shadow:0 12px 32px -8px var(--accent-glow);transition:transform .2s}
.cs-page .yt-poster:hover .play-btn{transform:translate(-50%,-50%) scale(1.08)}
.cs-page .vbadges{position:absolute;left:22px;top:20px;z-index:4;display:flex;gap:9px;flex-wrap:wrap}
.cs-page .vbadge{display:inline-flex;align-items:center;gap:8px;background:rgba(0,0,0,.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);color:#fff;font-size:12px;font-weight:600;letter-spacing:.03em;padding:7px 13px;border-radius:999px}
.cs-page .lvdot{width:7px;height:7px;border-radius:50%;background:#ff4d4d;box-shadow:0 0 10px #ff4d4d;animation:cs-pulse 1.5s infinite}
@keyframes cs-pulse{0%,100%{opacity:1}50%{opacity:.25}}
.cs-page .voverlay{position:absolute;left:0;right:0;bottom:0;z-index:4;padding:38px 40px;pointer-events:none}
.cs-page .voverlay h2{font-family:var(--display);font-weight:600;font-size:clamp(22px,3.4vw,40px);color:#fff;letter-spacing:-.02em;line-height:1.08;max-width:18ch;text-shadow:0 4px 30px rgba(0,0,0,.6)}
.cs-page .voverlay .vsub{color:#d7dbe6;font-size:14.5px;margin-top:8px;max-width:42ch}
@media(max-width:760px){.cs-page .yt-wrap{aspect-ratio:16/10}.cs-page .yt-poster{aspect-ratio:4/5}.cs-page .vbadges{display:none}.cs-page .voverlay{padding:22px}}
.cs-page .hero{padding:54px 0 30px;position:relative}
.cs-page .hero-grid{display:grid;grid-template-columns:1.2fr .85fr;gap:54px;align-items:center}
.cs-page .eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--accent-soft);background:rgba(255,122,24,.09);border:1px solid rgba(255,122,24,.24);padding:7px 14px;border-radius:999px;margin-bottom:24px}
.cs-page .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.cs-page h1{font-family:var(--display);font-weight:600;font-size:clamp(40px,5.6vw,66px);line-height:1.02;letter-spacing:-.025em}
.cs-page h1 em{font-style:italic;color:var(--accent-soft)}
.cs-page .lead{color:var(--muted);font-size:19px;margin-top:22px;max-width:34ch}
.cs-page .hero-cta{margin-top:32px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.cs-page .social-proof{display:flex;align-items:center;gap:14px;margin-top:28px}
.cs-page .social-proof .sp-txt{font-size:13.5px;color:var(--muted)}
.cs-page .social-proof .sp-txt b{color:var(--ink)}
.cs-page .social-proof .st{color:var(--accent);letter-spacing:1px;font-size:13px}
.cs-page .coach{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:24px;overflow:hidden;position:relative;box-shadow:0 40px 90px -45px rgba(0,0,0,.85)}
.cs-page .coach .ctop{position:relative;height:230px;overflow:hidden;background:#1a0c02}
.cs-page .coach .ctop img{width:100%;height:100%;object-fit:cover;object-position:center top}
.cs-page .coach .ctop::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,var(--panel) 4%,transparent 60%)}
.cs-page .coach .cbody{padding:0 26px 26px;margin-top:-44px;position:relative;z-index:2}
.cs-page .coach .cflag{display:inline-flex;align-items:center;gap:7px;background:var(--accent);color:#1a0c02;font-size:11.5px;font-weight:700;letter-spacing:.04em;padding:6px 12px;border-radius:999px;text-transform:uppercase}
.cs-page .coach h3{font-size:23px;margin-top:14px;letter-spacing:-.01em}
.cs-page .coach .role{color:var(--faint);font-size:13.5px;margin-top:3px}
.cs-page .coach .cstats{display:flex;gap:10px;margin-top:18px}
.cs-page .coach .cstat{flex:1;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:13px;text-align:center}
.cs-page .coach .cstat b{display:block;font-family:var(--display);font-size:20px;color:var(--accent-soft)}
.cs-page .coach .cstat span{font-size:11px;color:var(--faint)}
.cs-page .coach .quote{margin-top:18px;color:var(--muted);font-size:14px;line-height:1.6;border-left:2px solid var(--accent);padding-left:14px}
.cs-page .logos{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--bg2);margin-top:34px}
.cs-page .logos .wrap{padding:30px 24px}
.cs-page .logos .lbl{text-align:center;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:20px}
.cs-page .logo-row{display:flex;justify-content:center;align-items:center;gap:14px;flex-wrap:wrap}
.cs-page .brand{font-family:var(--display);font-weight:600;font-size:20px;color:var(--muted);opacity:.78;letter-spacing:.02em;padding:6px 4px;transition:.25s;white-space:nowrap}
.cs-page .brand:hover{opacity:1;color:var(--ink)}
.cs-page section{padding:80px 0;position:relative}
.cs-page .sec-head{max-width:660px;margin-bottom:46px}
.cs-page .sec-head.center{margin:0 auto 46px;text-align:center}
.cs-page .sec-tag{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-soft);margin-bottom:14px}
.cs-page h2{font-family:var(--display);font-weight:600;font-size:clamp(29px,3.7vw,44px);line-height:1.08;letter-spacing:-.02em}
.cs-page .sec-head p{color:var(--muted);font-size:17px;margin-top:14px}
.cs-page .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.cs-page .cards .card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px;transition:.25s;position:relative;overflow:hidden}
.cs-page .cards .card::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),var(--accent2));opacity:0;transition:.25s}
.cs-page .cards .card:hover{border-color:var(--line2);transform:translateY(-5px)}
.cs-page .cards .card:hover::before{opacity:1}
.cs-page .cards .card .ic{width:54px;height:54px;border-radius:14px;background:rgba(255,122,24,.1);border:1px solid rgba(255,122,24,.24);display:grid;place-items:center;font-size:25px;margin-bottom:18px}
.cs-page .cards .card h4{font-size:18.5px;letter-spacing:-.01em}
.cs-page .cards .card p{color:var(--muted);font-size:14.5px;margin-top:9px;line-height:1.6}
.cs-page .results{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:26px;padding:48px;position:relative;overflow:hidden}
.cs-page .results::before{content:"";position:absolute;top:-40%;right:-10%;width:420px;height:420px;background:radial-gradient(circle,var(--accent-glow),transparent 65%);opacity:.35}
.cs-page .results .rhead{position:relative;text-align:center;margin-bottom:36px}
.cs-page .results .rhead h2{font-size:clamp(26px,3.2vw,38px)}
.cs-page .results .rhead p{color:var(--muted);margin-top:10px}
.cs-page .rgrid{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.cs-page .rstat{text-align:center;padding:22px 14px;border-radius:16px;background:rgba(255,255,255,.02);border:1px solid var(--line)}
.cs-page .rstat .big{font-family:var(--display);font-weight:700;font-size:clamp(34px,4vw,46px);line-height:1;background:linear-gradient(120deg,#fff,var(--accent-soft));-webkit-background-clip:text;background-clip:text;color:transparent}
.cs-page .rstat .cap{font-size:13px;color:var(--muted);margin-top:10px}
.cs-page .pain{background:linear-gradient(180deg,rgba(239,68,68,.045),transparent);border:1px solid rgba(239,68,68,.16);border-radius:24px;padding:46px}
.cs-page .pain h2{margin-bottom:8px}
.cs-page .pain .sub{color:var(--muted);margin-bottom:28px;font-size:16px}
.cs-page .pain-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cs-page .pain-item{display:flex;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.cs-page .pain-item .x{flex:none;width:27px;height:27px;border-radius:8px;background:rgba(239,68,68,.13);color:#f87171;display:grid;place-items:center;font-weight:700;font-size:14px}
.cs-page .pain-item p{font-size:14.5px;color:#cdd3e0}
.cs-page .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.cs-page .step{padding:30px 28px;border:1px solid var(--line);border-radius:20px;background:var(--card);position:relative;transition:.25s}
.cs-page .step:hover{border-color:var(--accent);transform:translateY(-4px)}
.cs-page .step .n{font-family:var(--display);font-size:50px;font-weight:700;color:var(--line2);line-height:1;transition:.25s}
.cs-page .step:hover .n{color:var(--accent-soft)}
.cs-page .step h4{font-size:18px;margin-top:8px}
.cs-page .step p{color:var(--muted);font-size:14px;margin-top:8px}
.cs-page .tcards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.cs-page .t{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;transition:.25s}
.cs-page .t:hover{border-color:var(--line2);transform:translateY(-4px)}
.cs-page .t-brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.cs-page .t-initial{width:46px;height:46px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1a0c02;display:grid;place-items:center;font-family:var(--display);font-size:16px;font-weight:700;flex-shrink:0}
.cs-page .t-brand b{font-size:15px;display:block}
.cs-page .t-brand small{display:block;color:var(--faint);font-size:12.5px;margin-top:2px}
.cs-page .t-headline{font-family:var(--display);font-size:18.5px;font-weight:600;color:var(--ink);letter-spacing:-.01em;line-height:1.3}
.cs-page .t p{color:#d7dce8;font-size:14px;line-height:1.6;margin-top:10px}
.cs-page .t .res{margin-top:16px;display:inline-flex;align-items:center;gap:8px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);color:var(--green);font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:9px}
.cs-page .upsell-card{background:linear-gradient(170deg,rgba(255,122,24,.13),rgba(255,158,68,.04));border:1.5px solid rgba(255,122,24,.35);border-radius:22px;padding:34px 30px;position:relative;overflow:hidden}
.cs-page .upsell-card::before{content:"";position:absolute;top:-40%;right:-10%;width:340px;height:340px;background:radial-gradient(circle,var(--accent-glow),transparent 60%);opacity:.4}
.cs-page .upsell-head{position:relative}
.cs-page .upsell-tag{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-soft);background:rgba(255,122,24,.12);border:1px solid rgba(255,122,24,.3);padding:5px 11px;border-radius:999px;margin-bottom:12px}
.cs-page .upsell-head h3{font-family:var(--display);font-weight:600;font-size:clamp(20px,2.6vw,26px);letter-spacing:-.01em}
.cs-page .upsell-list{position:relative;list-style:none;margin:18px 0 24px;display:flex;flex-direction:column;gap:11px}
.cs-page .upsell-list li{color:#d7dce8;font-size:14.5px;display:flex;gap:10px}
.cs-page .upsell-list .arrow{color:var(--green);font-weight:700}
.cs-page .upsell-cta{position:relative;width:100%;background:linear-gradient(180deg,var(--accent2),var(--accent));color:#1a0c02;font-family:var(--sans);font-size:15.5px;font-weight:700;border:none;border-radius:13px;padding:15px;cursor:pointer;transition:transform .18s,box-shadow .18s;box-shadow:0 12px 32px -8px var(--accent-glow)}
.cs-page .upsell-cta:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 18px 42px -8px var(--accent-glow)}
.cs-page .upsell-cta:disabled{opacity:.7;cursor:wait}
.cs-page .upsell-done{text-align:center;color:var(--green);background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.3);border-radius:14px;padding:18px;font-size:14.5px;font-weight:600}
.cs-page .upsell-done span{margin-right:6px}
.cs-page .booking{background:linear-gradient(170deg,var(--panel2),var(--panel));border:1px solid var(--line2);border-radius:28px;padding:56px;text-align:center;position:relative;overflow:hidden}
.cs-page .booking::before{content:"";position:absolute;inset:0;background:radial-gradient(560px 320px at 50% -20%,var(--accent-glow),transparent 60%);opacity:.4}
.cs-page .booking h2,.cs-page .booking .sub{position:relative}
.cs-page .booking .sub{color:var(--muted);margin-top:12px;font-size:17px}
.cs-page .cal-frame{position:relative;margin:34px auto 0;max-width:520px;background:var(--bg);border:1px solid var(--line2);border-radius:20px;padding:42px 30px;color:var(--faint)}
.cs-page .cal-frame .ci{font-size:42px}
.cs-page .cal-frame .cn{margin-top:12px;font-size:14.5px;color:var(--muted)}
.cs-page .trust-badges{position:relative;display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:30px}
.cs-page .tb{display:inline-flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 16px;font-size:13px;color:var(--muted);font-weight:500}
.cs-page .tb .tbi{font-size:16px}
.cs-page .tb b{color:var(--green);font-weight:600}
.cs-page .faq{max-width:800px;margin:0 auto}
.cs-page details{border:1px solid var(--line);border-radius:15px;background:var(--card);margin-bottom:12px;overflow:hidden;transition:.2s}
.cs-page details[open]{border-color:var(--line2)}
.cs-page summary{cursor:pointer;list-style:none;padding:21px 24px;font-weight:600;font-size:16px;display:flex;justify-content:space-between;gap:16px;align-items:center}
.cs-page summary::-webkit-details-marker{display:none}
.cs-page summary .pl{flex:none;color:var(--accent-soft);font-size:23px;transition:.25s;line-height:1}
.cs-page details[open] summary .pl{transform:rotate(45deg)}
.cs-page details .ans{padding:0 24px 22px;color:var(--muted);font-size:15px;line-height:1.7}
.cs-page .final{text-align:center;padding:90px 0}
.cs-page .final h2{font-size:clamp(32px,4.6vw,54px);max-width:18ch;margin:0 auto}
.cs-page .final p{color:var(--muted);font-size:18px;margin-top:16px}
.cs-page .final .note{color:var(--faint);font-size:13.5px;margin-top:18px;display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
.cs-page .final .note span{display:inline-flex;align-items:center;gap:7px}
.cs-page footer{border-top:1px solid var(--line);background:var(--bg2);padding:46px 0}
.cs-page footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.cs-page footer .tag{color:var(--faint);font-size:13.5px;max-width:46ch;margin-top:6px}
.cs-page footer a.mail{color:var(--accent-soft);font-size:14px}
.cs-page .reveal{opacity:1;transform:translateY(24px);transition:transform .5s ease}
.cs-page .reveal.in{transform:none}
@media(max-width:900px){
  .cs-page .hero-grid{grid-template-columns:1fr;gap:36px}
  .cs-page .cards,.cs-page .tcards,.cs-page .steps{grid-template-columns:1fr}
  .cs-page .rgrid{grid-template-columns:1fr 1fr}
  .cs-page .pain-grid{grid-template-columns:1fr}
  .cs-page .pain,.cs-page .booking,.cs-page .results{padding:32px 22px}
  .cs-page .voverlay{padding:24px}
  .cs-page .nav-rating{display:none}
}
`;
