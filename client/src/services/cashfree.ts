interface PaymentParams {
  name: string;
  email: string;
  phone: string;
  amount: number;
  segment: string;
  bump1: boolean;
  bump2: boolean;
}

export async function initiateCashfreePayment(params: PaymentParams): Promise<void> {
  // 1. Create order on backend
  const res = await fetch('/api/cashfree/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
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
  const returnUrl = 'https://consulting.growthescalators.com';

  // 4. Launch Cashfree hosted checkout — redirects on success
  cashfree.checkout({
    paymentSessionId: payment_session_id,
    returnUrl,
  });
}
