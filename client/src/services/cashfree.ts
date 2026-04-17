interface PaymentParams {
  name: string;
  email: string;
  phone: string;
  amount: number;
  segment: string;
  bump1: boolean;
  bump2: boolean;
  funnelSlug?: string;
}

export async function initiateCashfreePayment(params: PaymentParams): Promise<void> {
  // Read UTMs from sessionStorage (set by useUTM hook)
  const utmRaw = sessionStorage.getItem('ge_utm_params');
  const utm = utmRaw ? JSON.parse(utmRaw) : {};

  // Read Facebook click/browser IDs from cookies
  const getCookie = (name: string) =>
    document.cookie.split('; ').find(r => r.startsWith(name + '='))?.split('=')[1] || undefined;
  const fbp = getCookie('_fbp');
  const fbc = getCookie('_fbc');

  // 1. Create order on backend
  const res = await fetch('/api/cashfree/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      utm_source: utm.source || undefined,
      utm_medium: utm.medium || undefined,
      utm_campaign: utm.campaign || undefined,
      utm_content: utm.content || undefined,
      utm_term: utm.term || undefined,
      fbp,
      fbc,
    }),
  });

  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? 'Failed to create order');
  }

  const { payment_session_id, order_id } = (await res.json()) as {
    payment_session_id: string;
    order_id: string;
  };

  // 2. Load Cashfree JS SDK (npm package — same as SDK v3)
  const { load } = await import('@cashfreepayments/cashfree-js');
  const cashfree = await load({
    mode: (import.meta.env.VITE_CASHFREE_ENV as string) === 'production' ? 'production' : 'sandbox',
  });

  // 3. Build return URL — Cashfree will redirect here after payment
  // Must be same origin so sessionStorage (segment, bump flags) survives the redirect
  const returnUrl = `${window.location.origin}/thank-you`;

  // 4. Launch Cashfree hosted checkout — redirects on success
  try {
    cashfree.checkout({
      paymentSessionId: payment_session_id,
      returnUrl,
    });
  } catch (e) {
    console.error('[cashfree] checkout failed:', e);
    throw new Error('Payment gateway unavailable. Please refresh and try again.');
  }
}
