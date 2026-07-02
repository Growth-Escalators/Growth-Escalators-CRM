import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Star, ArrowRight, ShieldCheck, TrendingUp, Zap, BookOpen, Users, Lock, ChevronDown, ChevronUp, Eye, Target, Lightbulb } from 'lucide-react';
import StickyFooter from '../components/common/StickyFooter';
import { apiUrl } from '../services/api';

// Simple hook: calls callback once when ref enters viewport
function useInView(ref, threshold = 0.2) {
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) setInView(true); },
            { threshold }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, threshold]);
    return inView;
}

const BRANDS = ['boAt', 'GIVA', 'Minimalist', 'Libas', 'SUGAR'];

const FOMO_MESSAGES = [
    "47 founders claimed this in the last 24 hours",
    "Last claimed 6 minutes ago by a founder in Bengaluru",
    "2,147 copies downloaded this week",
];

const AD_SPEND_AMOUNTS = ['₹30K', '₹50K', '₹1L', '₹2L'];

const LandingPage = () => {
    const navigate = useNavigate();
    const [showSticky, setShowSticky] = useState(false);

    // ── Silent page-view beacon. Vercel edge handles this via Upstash queue
    // so it stays available even if Railway is offline. ──
    useEffect(() => {
        fetch(apiUrl('/webhooks/tally'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: 'landing_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                data: {
                    responseId: 'landing' + Date.now(),
                    fields: [
                        { label: 'Source', value: 'ecom_landing_page' },
                        { label: 'UTM', value: window.location.search },
                    ],
                },
            }),
        }).catch(() => {});
    }, []);
    const [openFaq, setOpenFaq] = useState(0); // auto-open first FAQ
    const [activeReview, setActiveReview] = useState(0);
    const [isPaused, setIsPaused] = useState(false);

    // ── Brand rotation ──
    const [brandIdx, setBrandIdx] = useState(0);
    const [brandVisible, setBrandVisible] = useState(true);

    // ── FOMO notification ──
    const [fomoIdx, setFomoIdx] = useState(0);
    const [fomoVisible, setFomoVisible] = useState(true);

    // ── Live download counter ──
    const [downloadCount, setDownloadCount] = useState(2147);

    // ── Random ad spend for pain #1 ──
    const [adSpend] = useState(() =>
        AD_SPEND_AMOUNTS[Math.floor(Math.random() * AD_SPEND_AMOUNTS.length)]
    );

    // ── Scroll-triggered animation refs ──
    const painRef = useRef(null);
    const pillsRef = useRef(null);
    const starsRef = useRef(null);

    const painInView = useInView(painRef, 0.15);
    const pillsInView = useInView(pillsRef, 0.25);
    const starsInView = useInView(starsRef, 0.4);

    const reviews = [
        { initial: "P", name: "Priya S.", role: "D2C Founder", text: "Saved me 3 months of guesswork. I directly modeled boAt's checkout structure for my store and saw a 2x improvement in add-to-cart rate within a week." },
        { initial: "R", name: "Rahul M.", role: "eCommerce Store Owner", text: "The CRO breakdown for Minimalist alone was worth 100x the price. I never realized how much money I was leaving on the table with my current funnel structure." },
        { initial: "A", name: "Ankit T.", role: "Shopify Store Owner", text: "After applying the offer structures from the GIVA breakdown, my ROAS went from 1.8 to 3.4 in two weeks. This pack paid for itself within the first day." },
        { initial: "S", name: "Sneha K.", role: "Agency Owner", text: "Used the Minimalist breakdown in a client pitch deck — landed a ₹3L retainer. This pack effectively paid for itself 33,000x over in a single call." }
    ];

    // Scroll listener for sticky footer
    useEffect(() => {
        const handleScroll = () => setShowSticky(window.scrollY > 300);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Auto-slide reviews
    useEffect(() => {
        if (isPaused) return;
        const interval = setInterval(() => {
            setActiveReview(prev => (prev + 1) % reviews.length);
        }, 2500);
        return () => clearInterval(interval);
    }, [isPaused, reviews.length]);

    // Brand name rotation
    useEffect(() => {
        const rotate = setInterval(() => {
            setBrandVisible(false);
            setTimeout(() => {
                setBrandIdx(prev => (prev + 1) % BRANDS.length);
                setBrandVisible(true);
            }, 380);
        }, 2800);
        return () => clearInterval(rotate);
    }, []);

    // FOMO message rotation
    useEffect(() => {
        const rotate = setInterval(() => {
            setFomoVisible(false);
            setTimeout(() => {
                setFomoIdx(prev => (prev + 1) % FOMO_MESSAGES.length);
                setFomoVisible(true);
            }, 380);
        }, 3500);
        return () => clearInterval(rotate);
    }, []);

    // Live download counter — ticks up slowly while user is on page
    useEffect(() => {
        const interval = setInterval(() => setDownloadCount(n => n + 1), 42000);
        return () => clearInterval(interval);
    }, []);

    const toggleFaq = useCallback((index) => {
        setOpenFaq(prev => prev === index ? null : index);
    }, []);

    const goToCheckout = useCallback(() => navigate('/checkout'), [navigate]);

    const faqs = [
        { q: "Is this really just ₹9?", a: "Yes. We offer this at ₹9 because we want you to experience the quality of our research firsthand. 2,147+ founders have already claimed it at this price." },
        { q: "How is this different from free breakdowns on YouTube?", a: "YouTube breakdowns are surface-level commentary. This pack shows annotated screenshots of actual funnel steps, the specific CRO decisions behind each element, and what you can and cannot copy at your scale — not opinions, but documented real-world execution from brands doing ₹100Cr+ ARR." },
        { q: "What results can I expect?", a: "Founders use this to fix broken funnel elements they didn't even know were leaking conversions. One store owner improved ROAS from 1.8 to 3.4 by adapting a single offer structure from the GIVA breakdown. Results depend on your execution, but the frameworks are battle-tested." },
        { q: "Is this suitable for beginners?", a: "Absolutely. The breakdowns are structured so anyone can follow them, whether you're launching your first store or optimizing an existing one." },
        { q: "What format is the product in?", a: "A high-quality PDF you can download instantly after checkout. Read it on any device, keep it forever." },
        { q: "Is there any catch?", a: "No catch. We offer this at ₹9 because we want you to experience real value first. Yes, we have more advanced products for those who want to go deeper — but this pack stands completely on its own. 2,000+ founders agree." },
        { q: "What if I'm not satisfied?", a: "We offer a 100% refund, no questions asked. Just email us and we'll sort it immediately. Zero risk at ₹9." },
        { q: "How long do I have access?", a: "Lifetime access to the version you download today." }
    ];

    return (
        <div className="min-h-screen pb-24 bg-[#030712] text-white overflow-x-hidden font-sans">

            {/* ── HERO ── */}
            <div className="relative overflow-hidden pt-12 pb-12 md:pt-20 md:pb-16 px-4">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] md:w-[600px] h-[300px] md:h-[600px] bg-blue-900/20 rounded-full blur-[80px] md:blur-[100px] -z-10"></div>

                <div className="max-w-4xl mx-auto text-center">
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 bg-yellow-500/10 text-yellow-400 px-3 py-1 md:px-4 md:py-1.5 rounded-full text-xs md:text-sm font-semibold mb-6 md:mb-8 border border-yellow-500/20">
                        <Zap className="w-3 h-3 md:w-4 md:h-4 fill-current" />
                        Used by 2000+ D2C Founders Across India
                    </div>

                    {/* Rotating headline — brand on its own line so variable width causes no gap */}
                    <h1 className="text-3xl md:text-6xl font-bold tracking-tight mb-2 leading-tight">
                        See the Exact Funnel Behind
                        <br />
                        <span
                            className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500 inline-block"
                            style={{
                                transition: 'opacity 0.35s ease, transform 0.35s ease',
                                opacity: brandVisible ? 1 : 0,
                                transform: brandVisible ? 'translateY(0)' : 'translateY(-10px)',
                            }}
                        >
                            {BRANDS[brandIdx]}
                        </span>
                        's ₹100Cr+ Revenue
                    </h1>

                    <p className="text-sm text-gray-500 mb-5 md:mb-6">
                        + GIVA, Minimalist, Libas & SUGAR — all 5 brands, all for ₹9
                    </p>

                    {/* Product Mockup with entrance animation */}
                    <div className="mx-auto mb-6 md:mb-8 max-w-sm w-full mockup-animate">
                        <div className="relative bg-[#0f172a] border border-gray-700 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(249,115,22,0.15)]">
                            <div className="h-1.5 w-full bg-gradient-to-r from-orange-500 to-red-500"></div>
                            <div className="p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-xs font-bold tracking-widest text-orange-500 uppercase">Funnel Breakdown Pack</span>
                                    <span className="bg-orange-500/20 text-orange-400 text-xs font-bold px-2 py-0.5 rounded-full border border-orange-500/30">PDF</span>
                                </div>
                                <p className="text-white font-bold text-base mb-3 leading-snug">India's Top D2C Funnel Playbook</p>
                                {/* Brand pills — pulse sequentially */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {BRANDS.map((b, i) => (
                                        <span
                                            key={b}
                                            className="text-xs bg-gray-800 px-2 py-1 rounded-md font-medium"
                                            style={{
                                                color: brandIdx === i ? '#f97316' : '#9ca3af',
                                                borderWidth: 1,
                                                borderStyle: 'solid',
                                                borderColor: brandIdx === i ? 'rgba(249,115,22,0.4)' : 'transparent',
                                                transition: 'color 0.3s, border-color 0.3s',
                                            }}
                                        >
                                            {b}
                                        </span>
                                    ))}
                                </div>
                                <div className="space-y-1.5">
                                    {['Annotated funnel screenshots', 'CRO decisions explained', 'What to copy & what not to'].map((line, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"></div>
                                            {line}
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 pt-4 border-t border-gray-800 flex items-center justify-between">
                                    <span className="text-gray-500 text-xs">Growth Escalators</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500 text-xs line-through">₹999</span>
                                        <span className="text-orange-500 font-bold text-sm">₹9 only</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="flex flex-col items-center gap-3">
                        <button
                            onClick={goToCheckout}
                            className="cta-pulse w-full sm:w-auto bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-3 md:py-4 px-8 md:px-10 rounded-2xl transition-all duration-300 transform hover:scale-105 active:scale-95 text-lg md:text-xl"
                        >
                            Unlock All 5 Funnel Breakdowns — ₹9 Only
                        </button>
                        <p className="text-gray-500 text-xs">
                            <span className="line-through text-gray-600">₹999</span> → ₹9 today &nbsp;·&nbsp; Limited time offer
                        </p>

                        {/* FOMO notification */}
                        <div
                            className="flex items-center gap-2 text-xs text-gray-400 bg-gray-900/80 border border-gray-800 rounded-full px-4 py-2"
                            style={{ transition: 'opacity 0.35s ease', opacity: fomoVisible ? 1 : 0 }}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 animate-pulse"></span>
                            {FOMO_MESSAGES[fomoIdx]}
                        </div>

                        <div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 text-xs md:text-sm text-gray-400">
                            <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-400" /> Instant PDF delivery</span>
                            <span className="hidden md:inline w-1 h-1 bg-gray-600 rounded-full"></span>
                            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3 text-green-400" /> Secure Checkout</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── BRAND BAR TICKER ── */}
            <div className="border-y border-gray-800 bg-gray-900/30 py-5 mb-16 md:mb-20 overflow-hidden">
                <p className="text-gray-500 text-xs uppercase tracking-wider text-center mb-4">Breakdowns from brands doing ₹100Cr+ ARR</p>
                <div className="ticker-track">
                    {/* Duplicate the list so the loop is seamless */}
                    {[...Array(2)].map((_, rep) => (
                        <div key={rep} className="flex items-center gap-12 md:gap-20 pr-12 md:pr-20">
                            {['boAt', 'GIVA', 'Minimalist', 'LIBAS', 'SUGAR'].map(b => (
                                <span key={b} className="text-xl md:text-2xl font-bold text-gray-400 hover:text-white transition-colors duration-300 whitespace-nowrap">
                                    {b}
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* ── TARGET AUDIENCE ── */}
            <div className="max-w-6xl mx-auto px-4 mb-16 md:mb-20">
                <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 md:mb-12">Perfect For You If...</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
                    {[
                        { icon: Star, title: "D2C Founder", desc: "Stop rebuilding your funnel from scratch. See exactly what's working for brands doing ₹100Cr+ and adapt it to your store this week." },
                        { icon: TrendingUp, title: "Agency Owner", desc: "Walk into your next client meeting with funnel strategies backed by India's biggest D2C wins. Close more deals, deliver better results." },
                        { icon: Users, title: "Freelancer", desc: "Deliver better results for your clients with proven, real-world funnel frameworks — not guesswork or recycled advice." },
                        { icon: BookOpen, title: "Future Founder", desc: "Learn how real ₹100Cr+ funnels work before you launch — so your first store doesn't have to be your most expensive experiment." }
                    ].map((item, i) => (
                        <div key={i} className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 backdrop-blur-sm p-6 rounded-2xl hover:border-orange-500/50 transition-colors">
                            <item.icon className="w-8 h-8 md:w-10 md:h-10 text-orange-500 mb-4" />
                            <h3 className="text-lg md:text-xl font-bold mb-2">{item.title}</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── PAIN SECTION ── */}
            <div className="max-w-4xl mx-auto px-4 mb-16 md:mb-20">
                <div className="bg-red-500/5 border border-red-500/20 rounded-3xl p-6 md:p-12">
                    <h2 className="text-2xl md:text-3xl font-bold mb-6 md:mb-8 text-center">Does This Sound Familiar?</h2>
                    <div ref={painRef} className="space-y-3 md:space-y-4">
                        {[
                            `Spending ${adSpend}+ monthly on ads but can't tell which part of your funnel is leaking money.`,
                            "ROAS looks okay on paper, but you're not sure if it's masking deeper losses in your funnel.",
                            "Invested in courses that gave you theory — but no real execution map you could actually follow.",
                            "Hired help that gave you generic strategies instead of brand-specific, proven frameworks.",
                            "Watching competitors grow faster on the same platforms and budgets while you're stuck troubleshooting."
                        ].map((item, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-4 p-4 bg-red-500/10 rounded-xl"
                                style={{
                                    transition: `transform 0.5s ease ${i * 0.1}s`,
                                    transform: painInView ? 'translateX(0)' : 'translateX(-20px)',
                                }}
                            >
                                <div className="min-w-6 min-h-6 rounded-full bg-red-500/20 flex items-center justify-center mt-0.5">
                                    <span className="text-red-500 font-bold text-sm">✕</span>
                                </div>
                                <p className="text-gray-200 text-sm md:text-base">{item}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── SOCIAL PROOF — after pain, before bridge ── */}
            <section className="py-12 px-4 max-w-4xl mx-auto mb-4">
                <div className="inline-flex items-center gap-2 bg-[#1e293b] text-gray-300 px-4 py-1.5 rounded-full text-sm font-medium border border-gray-800 mb-8 mx-auto table">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                    Trusted by Indian D2C Founders
                </div>

                <h2 className="text-3xl md:text-5xl font-bold text-center mb-10 leading-tight">
                    Join <span className="text-orange-500">{downloadCount.toLocaleString('en-IN')}+ Founders</span> Already Growing
                </h2>

                <div ref={starsRef} className="grid grid-cols-2 gap-4 md:gap-8 mb-12">
                    <div className="bg-[#0f172a] border border-gray-800 p-6 rounded-2xl flex flex-col items-center shadow-lg">
                        <Users className="w-8 h-8 text-orange-500 mb-3" />
                        <div className="text-2xl md:text-4xl font-bold text-white mb-1">{downloadCount.toLocaleString('en-IN')}+</div>
                        <div className="text-gray-400 text-xs md:text-sm text-center">Founders using this</div>
                    </div>
                    <div className="bg-[#0f172a] border border-gray-800 p-6 rounded-2xl flex flex-col items-center shadow-lg">
                        {/* Animated star fill */}
                        <div className="flex gap-0.5 mb-3">
                            {[0, 1, 2, 3, 4].map(i => (
                                <Star
                                    key={i}
                                    className="w-6 h-6 text-yellow-500 fill-current"
                                    style={{
                                        transition: `transform 0.3s ease ${i * 0.12}s`,
                                        transform: starsInView ? 'scale(1)' : 'scale(0.3)',
                                    }}
                                />
                            ))}
                        </div>
                        <div className="text-2xl md:text-4xl font-bold text-white mb-1">4.9/5</div>
                        <div className="text-gray-400 text-xs md:text-sm text-center">Average rating</div>
                    </div>
                </div>

                {/* Sliding Reviews */}
                <div
                    className="relative h-[220px] md:h-[170px]"
                    onMouseEnter={() => setIsPaused(true)}
                    onMouseLeave={() => setIsPaused(false)}
                >
                    {reviews.map((review, index) => (
                        <div
                            key={index}
                            className={`absolute inset-0 transition-all duration-700 transform ${index === activeReview ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'}`}
                        >
                            <div className="bg-[#0f172a] border border-gray-800 p-6 rounded-2xl flex items-start gap-4 shadow-xl">
                                <div className="shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center font-bold text-white text-lg">
                                    {review.initial}
                                </div>
                                <div>
                                    <div className="flex text-yellow-500 mb-1">
                                        {[1, 2, 3, 4, 5].map(s => <Star key={s} className="w-3 h-3 fill-current" />)}
                                    </div>
                                    <p className="text-gray-200 font-medium text-sm md:text-base mb-1">"{review.text}"</p>
                                    <p className="text-xs text-gray-500 font-bold">{review.name} <span className="font-normal">• {review.role}</span></p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Dots — outside the absolute container so they always render correctly */}
                <div className="flex justify-center gap-1 mt-5 mb-8">
                    {reviews.map((_, i) => (
                        <button
                            key={i}
                            className="p-2 rounded-full transition-all"
                            onClick={() => setActiveReview(i)}
                            aria-label={`Review ${i + 1}`}
                        >
                            <span className={`block rounded-full transition-all duration-300 ${i === activeReview ? 'bg-orange-500 w-5 h-3' : 'bg-gray-700 w-3 h-3'}`}></span>
                        </button>
                    ))}
                </div>
            </section>

            {/* ── BRIDGE SECTION ── */}
            <div className="max-w-4xl mx-auto px-4 mb-16 md:mb-20 text-center">
                <h2 className="text-3xl md:text-5xl font-bold mb-6">
                    What If You Didn't Have<br className="hidden md:block" /> to <span className="text-orange-500">Guess Anymore?</span>
                </h2>
                <p className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto mb-10">
                    Instead of relying on opinions, theories, or second-hand advice —
                    what if you could see how <span className="text-white">India's top D2C brands</span> actually structure their funnels?
                </p>

                {/* Sequential pill reveal */}
                <div ref={pillsRef} className="flex flex-col items-center gap-4 mb-10">
                    {[
                        'The exact headlines that stopped the scroll.',
                        'The CTA placements that doubled checkout rates.',
                        'The offer structures that turned browsers into repeat buyers.'
                    ].map((text, i) => (
                        <div
                            key={i}
                            className={`${i === 1 ? 'bg-orange-600' : 'bg-orange-500'} text-white font-bold py-3 px-6 rounded-full shadow-[0_0_15px_rgba(249,115,22,0.4)] text-base md:text-lg select-none max-w-md`}
                            style={{
                                transition: `transform 0.55s ease ${i * 0.45}s`,
                                transform: pillsInView ? 'translateY(0)' : 'translateY(16px)',
                            }}
                        >
                            {text}
                        </div>
                    ))}
                </div>

                <p className="text-gray-400 text-sm md:text-base">
                    So you can model what's already proven — and skip the ₹10L in testing these brands already did for you.
                </p>
            </div>

            {/* ── WHAT YOU'LL SEE INSIDE ── */}
            <div className="max-w-5xl mx-auto px-4 mb-6 md:mb-8">
                <h2 className="text-3xl font-bold text-center mb-4">What You'll See Inside</h2>
                <p className="text-gray-400 text-center mb-3">Depth that free YouTube breakdowns can't give you — annotated, specific, and actionable.</p>
                {/* Page count indicator */}
                <div className="flex justify-center mb-10">
                    <div className="inline-flex items-center gap-2 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-full px-4 py-2">
                        <span className="text-orange-500 font-bold">47 pages</span>
                        <span>·</span>
                        <span>23 annotated screenshots</span>
                        <span>·</span>
                        <span>12 plug-and-play tactics</span>
                        <span>·</span>
                        <span>5 brands</span>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    {[
                        { icon: Eye, title: "Real Funnel Breakdowns", desc: "See exactly how boAt structures their ad → landing page → checkout flow — including the upsell mechanics most visitors never notice." },
                        { icon: Target, title: "CRO Decisions Explained", desc: "Why Minimalist uses a specific headline length and layout on product pages — and the conversion logic behind every single choice." },
                        { icon: Lightbulb, title: "What to Copy (And What Not To)", desc: "We'll tell you which GIVA tactics only work at their scale — and which ones you can deploy on any budget, starting tomorrow." },
                        { icon: Check, title: "Plug-and-Play Takeaways", desc: "A ready checklist of steal-worthy tactics to implement on your store within 48 hours — no agency, no guesswork, no fluff." }
                    ].map((item, i) => (
                        <div key={i} className="bg-[#0f172a] border border-gray-800 p-8 rounded-2xl hover:bg-[#1e293b] transition-colors relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-32 bg-orange-500/5 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-orange-500/10"></div>
                            <div className="w-12 h-12 bg-orange-900/30 text-orange-500 rounded-xl flex items-center justify-center mb-6 border border-orange-500/20">
                                <item.icon className="w-6 h-6" />
                            </div>
                            <h3 className="text-xl font-bold mb-3 text-white">{item.title}</h3>
                            <p className="text-gray-400 leading-relaxed text-sm">{item.desc}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── MID-PAGE CTA ── */}
            <div className="max-w-2xl mx-auto px-4 mb-16 md:mb-20 text-center">
                <p className="text-gray-400 text-sm mb-4">5 complete breakdowns. Real screenshots. Proven tactics.</p>
                <button
                    onClick={goToCheckout}
                    className="cta-pulse w-full sm:w-auto bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-3 px-8 rounded-2xl shadow-[0_0_20px_rgba(249,115,22,0.4)] transition-all transform hover:scale-105 active:scale-95 text-base flex items-center justify-center gap-2 mx-auto"
                >
                    Get All 5 Breakdowns — ₹9 Only
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>

            {/* ── WHAT YOU GET + VALUE STACK ── */}
            <div className="max-w-4xl mx-auto px-4 mb-8 md:mb-12">
                <div className="bg-[#0f172a] border border-yellow-500/30 rounded-3xl p-6 md:p-10 shadow-[0_0_30px_rgba(234,179,8,0.05)]">
                    <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">What You Get With the Funnel Breakdown</h2>
                    <p className="text-gray-400 text-center text-sm mb-8">Everything you'd pay ₹25,000+ for if you hired someone to do this research.</p>

                    {/* Individual line-item values */}
                    <ul className="space-y-3 mb-10">
                        {[
                            { label: "5 complete funnel breakdowns (boAt, GIVA, Minimalist, Libas, SUGAR)", value: "₹10,000" },
                            { label: "Annotated screenshots of every funnel step with CRO notes", value: "₹7,500" },
                            { label: "The 'What to Copy' cheat sheet — top steal-worthy tactics curated", value: "₹5,000" },
                            { label: "Plug-and-play PDF format — any device, instant download, forever access", value: "₹2,500" },
                        ].map((item, i) => (
                            <li key={i} className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                    <div className="min-w-6 min-h-6 rounded-full bg-green-500/20 flex items-center justify-center mt-0.5 shrink-0">
                                        <Check className="w-3.5 h-3.5 text-green-500" />
                                    </div>
                                    <span className="text-gray-300 text-sm leading-relaxed">{item.label}</span>
                                </div>
                                <span className="text-gray-500 text-sm font-mono shrink-0 pt-0.5">{item.value}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="border-t border-gray-800 pt-4 mb-8">
                        <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
                            <span>Total value</span>
                            <span className="font-mono line-through text-gray-600">₹25,000+</span>
                        </div>
                    </div>

                    {/* Value Stack Pricing */}
                    <div className="bg-[#1e293b]/50 rounded-2xl p-6 md:p-8 border border-gray-700 text-center">
                        <div className="flex items-center justify-center gap-3 mb-2">
                            <span className="text-gray-600 line-through text-xl">₹999</span>
                            <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full">SAVE 99%</span>
                        </div>
                        <div className="text-6xl font-bold text-orange-500 mb-1">₹9</div>
                        <p className="text-gray-500 text-sm">Limited Time Offer · 100% Money-Back Guarantee</p>
                    </div>
                </div>
            </div>

            {/* ── COMPARISON TABLE — right after offer box ── */}
            <div className="max-w-4xl mx-auto px-4 mb-6 md:mb-8">
                <h2 className="text-2xl font-bold text-center mb-8">Why This Pack Over Everything Else?</h2>

                {/* Mobile: stacked cards */}
                <div className="md:hidden space-y-4">
                    {[
                        { feature: "Cost", ours: "₹9", other1: "₹5,000+", other2: "₹50,000+" },
                        { feature: "Time to Value", ours: "Instant", other1: "Hours of Video", other2: "Weeks" },
                        { feature: "Actionability", ours: "Plug & Play", other1: "Theory", other2: "Done-for-you" },
                        { feature: "Source", ours: "Real ₹100Cr+ funnels", other1: "Instructor opinions", other2: "Their past clients" },
                        { feature: "Risk", ours: "Zero", other1: "High", other2: "Very High" },
                    ].map((row, i) => (
                        <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">{row.feature}</p>
                            <div className="space-y-2">
                                {/* Funnel Pack row — stronger highlight with left accent */}
                                <div
                                    className="flex items-center justify-between rounded-xl px-4 py-2.5"
                                    style={{
                                        background: 'rgba(249,115,22,0.08)',
                                        borderWidth: 1,
                                        borderStyle: 'solid',
                                        borderColor: 'rgba(249,115,22,0.25)',
                                        borderLeftWidth: 4,
                                        borderLeftColor: '#f97316',
                                    }}
                                >
                                    <span className="text-orange-400 text-sm font-bold">Funnel Pack</span>
                                    <span className="text-white font-bold text-sm">{row.ours}</span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-2 opacity-50">
                                    <span className="text-gray-500 text-sm">Courses</span>
                                    <span className="text-gray-500 text-sm">{row.other1}</span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-2 opacity-50">
                                    <span className="text-gray-500 text-sm">Agencies</span>
                                    <span className="text-gray-500 text-sm">{row.other2}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto bg-gray-900 rounded-3xl border border-gray-800 p-8">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-800">
                                <th className="pb-4 pl-2 font-normal text-gray-400 w-1/4">Comparison</th>
                                <th className="pb-4 font-bold text-orange-500 text-lg w-1/4">Funnel Pack</th>
                                <th className="pb-4 font-normal text-gray-400 w-1/4 opacity-60">Courses</th>
                                <th className="pb-4 font-normal text-gray-400 w-1/4 opacity-60">Agencies</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {[
                                { feature: "Cost", ours: "₹9", other1: "₹5,000+", other2: "₹50,000+" },
                                { feature: "Time to Value", ours: "Instant", other1: "Hours of Video", other2: "Weeks" },
                                { feature: "Actionability", ours: "Plug & Play", other1: "Theory", other2: "Done-for-you" },
                                { feature: "Source", ours: "Real ₹100Cr+ funnels", other1: "Instructor opinions", other2: "Their past clients" },
                                { feature: "Risk", ours: "Zero", other1: "High", other2: "Very High" },
                            ].map((row, i) => (
                                <tr key={i}>
                                    <td className="py-4 pl-2 font-medium text-gray-300">{row.feature}</td>
                                    <td className="py-4 font-bold text-white">{row.ours}</td>
                                    <td className="py-4 text-gray-500 opacity-60">{row.other1}</td>
                                    <td className="py-4 text-gray-500 opacity-60">{row.other2}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Guarantee bridge below table */}
                <p className="text-center text-gray-500 text-sm mt-6">
                    Still not sure? You're covered by our{' '}
                    <span className="text-green-400 font-semibold">100% money-back guarantee</span>.{' '}
                    Zero risk at ₹9 — the only thing you're risking is missing out.
                </p>
            </div>

            {/* ── MONEY-BACK GUARANTEE ── */}
            <div className="max-w-3xl mx-auto px-4 mb-10">
                <div
                    className="rounded-2xl p-6 md:p-8"
                    style={{
                        background: 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(16,185,129,0.04) 100%)',
                        border: '1px solid rgba(34,197,94,0.3)',
                        boxShadow: '0 0 30px rgba(34,197,94,0.07)',
                    }}
                >
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                        <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center shrink-0">
                            <ShieldCheck className="w-7 h-7 text-green-400" />
                        </div>
                        <div className="text-center sm:text-left">
                            <p className="text-white font-bold text-lg mb-1">100% Money-Back Guarantee</p>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                If you don't find value in the breakdowns, we'll refund every rupee — instantly, no questions asked.
                                At ₹9, you have everything to gain and literally nothing to lose.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── FROM THE FIELD — CASE STUDY ── */}
            <div className="max-w-3xl mx-auto px-4 mb-10">
                <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 bg-[#1e293b] text-gray-300 px-4 py-1.5 rounded-full text-sm font-medium border border-gray-800 mb-4">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                        From the Field
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold">Real Results From a Real D2C Brand</h2>
                </div>

                {/* Case study card */}
                <div
                    className="rounded-2xl p-6 mb-5"
                    style={{
                        background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(5,150,105,0.03) 100%)',
                        border: '1px solid rgba(16,185,129,0.2)',
                        borderLeftWidth: 4,
                        borderLeftColor: '#10b981',
                    }}
                >
                    <div className="flex items-start gap-4 mb-4">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center font-bold text-white shrink-0">
                            OO
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <span className="font-bold text-white">Odra Organics</span>
                                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20">Organic / Wellness D2C</span>
                            </div>
                            <span className="text-gray-500 text-sm">Aniket, Founder</span>
                        </div>
                    </div>
                    <div className="flex text-yellow-500 mb-3">
                        {[1, 2, 3, 4, 5].map(s => <Star key={s} className="w-4 h-4 fill-current" />)}
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed mb-3">
                        "We were running ads but our funnel had gaps we couldn't see. After going through the breakdown pack, we restructured our landing page flow and offer placement based on what was working for the featured brands. The results showed within weeks — our cost per acquisition dropped and conversions improved noticeably."
                    </p>
                    <p className="text-gray-500 text-xs font-bold">— Aniket, Founder, Odra Organics</p>
                </div>

                {/* Before / After metric cards */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                        { label: 'Funnel Clarity', before: 'Guessing', after: 'Data-backed' },
                        { label: 'Implementation', before: 'Weeks of testing', after: '48 hours' },
                        { label: 'Confidence', before: 'Is this working?', after: 'We know why' },
                    ].map((card) => (
                        <div key={card.label} className="bg-[#0a0f1e] border border-gray-800 rounded-xl p-3 text-center">
                            <p className="text-gray-500 text-xs mb-2">{card.label}</p>
                            <p className="text-red-400/70 text-xs line-through">{card.before}</p>
                            <p className="text-green-400 text-sm font-bold mt-1">{card.after}</p>
                        </div>
                    ))}
                </div>

                <p className="text-gray-600 text-xs text-center">
                    Results may vary. Odra Organics is a real D2C brand that used the Funnel Breakdown Pack.
                </p>
            </div>

            {/* ── CREATOR CREDIBILITY ── */}
            <div className="max-w-3xl mx-auto px-4 mb-16">
                <div
                    className="rounded-2xl p-6 md:p-8"
                    style={{
                        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b10 100%)',
                        border: '1px solid rgba(249,115,22,0.2)',
                        boxShadow: '0 0 30px rgba(249,115,22,0.04)',
                    }}
                >
                    <div className="flex flex-col md:flex-row items-start gap-5">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center font-bold text-white text-xl shrink-0 shadow-[0_0_20px_rgba(249,115,22,0.4)]">
                            GE
                        </div>
                        <div className="flex-1">
                            <p className="text-white font-bold text-base mb-1">Built by Growth Escalators</p>
                            <p className="text-gray-400 text-sm leading-relaxed mb-5">
                                We've analyzed ₹10Cr+ in D2C ad spend across 50+ brands to build this breakdown.
                                Not theory, not YouTube — documented execution from brands that are actually winning.
                            </p>
                            <div className="grid grid-cols-3 gap-3">
                                {[['50+', 'Brands analyzed'], ['₹10Cr+', 'Ad spend studied'], ['3+ yrs', 'D2C growth work']].map(([val, label]) => (
                                    <div key={label} className="bg-[#0a0f1e] border border-gray-800 rounded-xl p-3 text-center">
                                        <div className="text-orange-400 font-bold text-base">{val}</div>
                                        <div className="text-gray-500 text-xs mt-0.5">{label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── FAQ ── */}
            <div className="max-w-3xl mx-auto px-4 mb-24">
                <h2 className="text-3xl font-bold text-center mb-2">Frequently Asked Questions</h2>
                <p className="text-gray-400 text-center mb-10">Got questions? We've got answers.</p>
                <div className="space-y-4">
                    {faqs.map((faq, i) => (
                        <div key={i} className="bg-[#0f172a] border border-gray-800 rounded-2xl overflow-hidden">
                            <button
                                onClick={() => toggleFaq(i)}
                                className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-800/50 transition-colors"
                            >
                                <span className="font-semibold text-white pr-4">{faq.q}</span>
                                {openFaq === i
                                    ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
                                    : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
                            </button>
                            {openFaq === i && (
                                <div className="p-5 pt-0 text-gray-400 border-t border-gray-800/50 text-sm md:text-base leading-relaxed">
                                    {faq.a}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* CTA at bottom of FAQ */}
                <div className="mt-10 text-center">
                    <p className="text-gray-500 text-sm mb-4">Still on the fence? The answer is in the pack — and the risk is zero.</p>
                    <button
                        onClick={goToCheckout}
                        className="cta-pulse w-full sm:w-auto bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-3 px-8 rounded-2xl shadow-lg transition-all transform hover:scale-105 text-base flex items-center justify-center gap-2 mx-auto"
                    >
                        Get Your Pack — ₹9 Only
                        <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* ── FINAL CTA ── */}
            <div className="text-center px-4 mb-12">
                <p className="text-gray-500 text-sm mb-3">5 funnel breakdowns · Annotated screenshots · Plug-and-play tactics · Less than a cup of chai</p>
                <h2 className="text-3xl md:text-5xl font-bold mb-8 leading-tight">Stop Guessing. <br className="md:hidden" /> Start Growing.</h2>
                <button
                    onClick={goToCheckout}
                    className="cta-pulse bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold py-4 px-10 rounded-2xl transition-all transform hover:scale-105 text-xl w-full md:w-auto"
                >
                    Get Your Pack Now — ₹9 Only
                </button>
                <p className="mt-3 text-xs text-gray-600">
                    <span className="line-through">₹999</span> → ₹9 today &nbsp;·&nbsp; 100% refund if you're not satisfied
                </p>
                <p className="mt-3 text-xs md:text-sm text-gray-500 flex items-center justify-center gap-2">
                    <Lock className="w-3 h-3" /> 100% Secure Checkout
                </p>
            </div>

            <footer className="py-10 text-center border-t border-gray-900">
                <p className="text-gray-600 text-xs">© 2026 Growth Escalators. All rights reserved.</p>
            </footer>

            {showSticky && <StickyFooter scrollToForm={goToCheckout} />}
        </div>
    );
};

export default LandingPage;
