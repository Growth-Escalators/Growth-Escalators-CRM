import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors';
import { cashfreeBaseUrl, cashfreeHeaders } from '../_lib/cashfree';
import { enqueue } from '../_lib/queue';

interface CreateOrderBody {
  name?: string;
  email?: string;
  phone?: string;
  amount?: number;
  segment?: string;
  bump1?: boolean;
  bump2?: boolean;
  fbp?: string;
  fbc?: string;
  funnelSlug?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://ecom.growthescalators.com';
const WEBHOOK_URL = process.env.WEBHOOK_URL || `${SITE_ORIGIN}/api/cashfree/webhook`;
const RETURN_URL = `${SITE_ORIGIN}/thank-you`;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as CreateOrderBody;
  const { name, email, phone, amount } = body;
  if (!name || !email || !phone || !amount) {
    res.status(400).json({ error: 'name, email, phone, amount are required' });
    return;
  }

  const orderId = `GE_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  try {
    const cfRes = await fetch(`${cashfreeBaseUrl()}/orders`, {
      method: 'POST',
      headers: cashfreeHeaders(),
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: {
          customer_id: phone,
          customer_name: name,
          customer_email: email,
          customer_phone: phone,
        },
        order_meta: {
          notify_url: WEBHOOK_URL,
          return_url: RETURN_URL,
          segment: body.segment ?? null,
          bump1: body.bump1 ?? false,
          bump2: body.bump2 ?? false,
          fbp: body.fbp ?? null,
          fbc: body.fbc ?? null,
          funnelSlug: body.funnelSlug ?? 'ecom',
          utm_source: body.utm_source ?? null,
          utm_medium: body.utm_medium ?? null,
          utm_campaign: body.utm_campaign ?? null,
          utm_content: body.utm_content ?? null,
          utm_term: body.utm_term ?? null,
        },
      }),
    });

    if (!cfRes.ok) {
      const errBody = (await cfRes.json().catch(() => ({}))) as { message?: string };
      res.status(502).json({ error: errBody.message ?? 'Cashfree order creation failed' });
      return;
    }

    const cfData = (await cfRes.json()) as { payment_session_id: string };

    // Queue the pending-order signal for the CRM. Best-effort — if the queue
    // is misconfigured we still return the payment session so the buyer can
    // pay; a missed pending row only affects internal funnel analytics.
    enqueue('pending_order', {
      orderId,
      name,
      email,
      phone,
      segment: body.segment,
      bump1: body.bump1,
      bump2: body.bump2,
      funnelSlug: body.funnelSlug ?? 'ecom',
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
      utm_content: body.utm_content ?? null,
      utm_term: body.utm_term ?? null,
    }).catch((e) => console.warn('[edge create-order] queue failed:', (e as Error).message));

    res.status(200).json({
      payment_session_id: cfData.payment_session_id,
      order_id: orderId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[edge create-order] failed:', msg);
    res.status(500).json({ error: msg });
  }
}
