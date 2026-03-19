import { useState, useEffect } from 'react';

const SESSION_KEY = 'ge_utm_params';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/**
 * Reads UTM params from the URL on mount and persists them in sessionStorage.
 * Subsequent page loads (e.g. returning from Cashfree) restore from sessionStorage.
 *
 * @returns {{ source, medium, campaign, content, term }}
 */
export function useUTM() {
  const [utmParams, setUtmParams] = useState(() => {
    // Try restoring from sessionStorage first
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return { source: '', medium: '', campaign: '', content: '', term: '' };
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const captured = {
      source: params.get('utm_source') || '',
      medium: params.get('utm_medium') || '',
      campaign: params.get('utm_campaign') || '',
      content: params.get('utm_content') || '',
      term: params.get('utm_term') || '',
    };

    // Only overwrite if any UTM param is present in the URL
    const hasUTM = Object.values(captured).some(Boolean);
    if (hasUTM) {
      setUtmParams(captured);
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(captured));
      } catch {
        // ignore storage errors
      }
    }
  }, []);

  return utmParams;
}
