import { useState, useEffect } from 'react';

/**
 * Hook to fetch and cache funnel configuration.
 * Determines funnel slug from:
 *   1. window.__FUNNEL_SLUG__ (injected by Express via hostname)
 *   2. URL search param ?funnel=xxx
 *   3. Hostname detection (doctors.growthescalators.com → 'doctors')
 *   4. Fallback to 'ecom'
 */
export function useFunnelConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const slug = detectFunnelSlug();

    // Check sessionStorage cache first
    const cached = sessionStorage.getItem(`funnel_config_${slug}`);
    if (cached) {
      try {
        setConfig(JSON.parse(cached));
        setLoading(false);
        return;
      } catch { /* cache corrupt, refetch */ }
    }

    fetch(`/api/funnel-configs/public/${slug}`)
      .then(r => {
        if (!r.ok) throw new Error(`Funnel "${slug}" not found`);
        return r.json();
      })
      .then(data => {
        if (data.config) {
          setConfig(data.config);
          sessionStorage.setItem(`funnel_config_${slug}`, JSON.stringify(data.config));
          sessionStorage.setItem('ge_funnel_slug', slug);
        } else {
          throw new Error('No config returned');
        }
      })
      .catch(err => {
        console.warn('[useFunnelConfig] Failed to load config:', err.message);
        setError(err.message);
        // Use hardcoded ecom fallback so the page doesn't break
        setConfig(getEcomFallback());
      })
      .finally(() => setLoading(false));
  }, []);

  return { config, loading, error, slug: config?.slug || 'ecom' };
}

function detectFunnelSlug() {
  // 1. Injected by Express
  if (typeof window !== 'undefined' && window.__FUNNEL_SLUG__) return window.__FUNNEL_SLUG__;

  // 2. URL param
  const params = new URLSearchParams(window.location.search);
  if (params.get('funnel')) return params.get('funnel');

  // 3. Hostname detection
  const hostname = window.location.hostname;
  if (hostname.startsWith('doctors')) return 'doctors';
  if (hostname.startsWith('realestate') || hostname.startsWith('real-estate')) return 'real-estate';
  if (hostname.startsWith('ecom')) return 'ecom';

  // 4. SessionStorage from previous load
  const stored = sessionStorage.getItem('ge_funnel_slug');
  if (stored) return stored;

  return 'ecom';
}

function getEcomFallback() {
  return {
    slug: 'ecom',
    name: 'Ecom Funnel',
    base_price: 9,
    bump1_price: 199,
    bump2_price: 499,
    bump1_label: 'Advanced D2C Growth Kit',
    bump2_label: '45-min Meta Ads Audit Call',
    product_name: 'D2C Funnel Breakdown Pack',
    main_pdf_url: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
    bump1_pdf_url: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
    bump2_booking_url: 'https://cal.com/growth-escalators/discovery-call',
    hero_headline: 'See Exactly How India\'s Top 5 D2C Brands Build Their Funnels',
    hero_subheadline: 'Get the exact funnel breakdown that helps Indian brands scale past ₹10L/month on Meta',
    cta_text: 'Get Instant Access for ₹9',
    accent_color: '#F97316',
    segment_options: [
      { id: 'd2c', label: 'I run a D2C Brand', icon: '🛍️' },
      { id: 'agency', label: 'I run an Agency', icon: '🏢' },
      { id: 'freelancer', label: 'I am a Freelancer', icon: '💻' },
    ],
    brand_names: ['boAt', 'GIVA', 'Minimalist', 'Libas', 'SUGAR'],
    post_purchase_route: '/consulting',
    main_product_description: 'PDF breaking down exactly what 5 winning D2C brands are doing on Meta right now',
    bump1_description: 'Ad templates, landing page swipe file, Meta ads checklist, WA sequences',
    bump2_description: 'Live Meta account review with Jatin — 3 specific fixes for your campaigns',
  };
}
