import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors.js';
import { cashfreeBaseUrl, cashfreeHeaders } from '../_lib/cashfree.js';

interface UpsellBody {
  orderId?: string;
  bumpId?: number;
  email?: string;
  phone?: string;
  name?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const { orderId, bumpId, email, phone, name } = (req.body ?? {}) as UpsellBody;
  if (!bumpId || !email || !phone) {
    res.status(400).json({ error: 'bumpId, email, phone required' });
    return;
  }
  const amount = bumpId === 1 ? 199 : bumpId === 2 ? 499 : 0;
  if (amount === 0) {
    res.status(400).json({ error: 'invalid bumpId' });
    return;
  }

  const upsellOrderId = `GE_UP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  try {
    const cfRes = await fetch(`${cashfreeBaseUrl()}/orders`, {
      method: 'POST',
      headers: cashfreeHeaders(),
      body: JSON.stringify({
        order_id: upsellOrderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: {
          customer_id: phone,
          customer_name: name || 'Customer',
          customer_email: email,
          customer_phone: phone,
        },
        order_meta: { upsell: true, bumpId, originalOrderId: orderId ?? null },
      }),
    });

    if (!cfRes.ok) {
      const errBody = (await cfRes.json().catch(() => ({}))) as { message?: string };
      res.status(502).json({ error: errBody.message ?? 'Upsell order creation failed' });
      return;
    }

    const cfData = (await cfRes.json()) as { payment_session_id: string };
    res.status(200).json({
      payment_session_id: cfData.payment_session_id,
      order_id: upsellOrderId,
      amount,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
