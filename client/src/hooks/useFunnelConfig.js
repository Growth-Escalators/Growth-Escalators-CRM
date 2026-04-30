import { useState, useEffect } from 'react';
import ecomConfig from '../data/funnelConfigs/ecom.json';
import doctorsConfig from '../data/funnelConfigs/doctors.json';
import realEstateConfig from '../data/funnelConfigs/real-estate.json';
import { apiUrl } from '../services/api';

// Bundled configs ship with the build so the page can render immediately,
// even if the API is unreachable. The hook upgrades to the live API config
// in the background when available — but never blocks first paint on it.
const BUNDLED_CONFIGS = {
  ecom: ecomConfig,
  doctors: doctorsConfig,
  'real-estate': realEstateConfig,
};

/**
 * Hook to fetch and cache funnel configuration.
 * Determines funnel slug from:
 *   1. window.__FUNNEL_SLUG__ (injected by host platform if any)
 *   2. URL search param ?funnel=xxx
 *   3. Hostname detection (doctors.growthescalators.com → 'doctors')
 *   4. SessionStorage from previous load
 *   5. Fallback to 'ecom'
 */
export function useFunnelConfig() {
  const slug = detectFunnelSlug();
  const bundled = BUNDLED_CONFIGS[slug] || BUNDLED_CONFIGS.ecom;

  // Initial state: bundled config + already-cached live config (if any).
  const [config, setConfig] = useState(() => {
    try {
      const cached = sessionStorage.getItem(`funnel_config_${slug}`);
      const cacheTime = sessionStorage.getItem(`funnel_config_${slug}_ts`);
      const CACHE_TTL = 30 * 60 * 1000;
      if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < CACHE_TTL) {
        return JSON.parse(cached);
      }
    } catch { /* ignore */ }
    return bundled;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Background refresh — non-blocking. If it fails (API down, CORS,
    // network), we silently keep using the bundled / cached config.
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);

    fetch(apiUrl(`/api/funnel-configs/public/${slug}`), { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return;
        if (data && data.config) {
          setConfig(data.config);
          try {
            sessionStorage.setItem(`funnel_config_${slug}`, JSON.stringify(data.config));
            sessionStorage.setItem(`funnel_config_${slug}_ts`, String(Date.now()));
            sessionStorage.setItem('ge_funnel_slug', slug);
          } catch { /* quota / private mode */ }
        }
      })
      .catch(err => {
        // Silent — bundled config keeps the page functional. Surface in dev only.
        if (import.meta.env?.DEV) console.warn('[useFunnelConfig] live refresh failed:', err.message);
        if (!cancelled) setError(err.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { config, loading, error, slug: config?.slug || slug };
}

function detectFunnelSlug() {
  if (typeof window !== 'undefined' && window.__FUNNEL_SLUG__) return window.__FUNNEL_SLUG__;

  const params = new URLSearchParams(window.location.search);
  if (params.get('funnel')) return params.get('funnel');

  const hostname = window.location.hostname;
  if (hostname.startsWith('doctors')) return 'doctors';
  if (hostname.startsWith('realestate') || hostname.startsWith('real-estate')) return 'real-estate';
  if (hostname.startsWith('ecom')) return 'ecom';

  const stored = sessionStorage.getItem('ge_funnel_slug');
  if (stored) return stored;

  return 'ecom';
}
