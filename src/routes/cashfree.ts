import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../db/index';
import { findOrCreateContact } from '../services/contactService';

const router = Router();

const CASHFREE_BASE =
  process.env.NODE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// ---------------------------------------------------------------------------
// POST /api/cashfree/create-order
// Body: { name, email, phone, amount, segment, bump1, bump2 }
// Returns: { payment_session_id, order_id }
// ---------------------------------------------------------------------------
router.post('/create-order', async (req: Request, res: Response) => {
  const { name, email, phone, amount, segment, bump1, bump2 } = req.body as {
    name: string;
    email: string;
    phone: string;
    amount: number;
    segment?: string;
    bump1?: boolean;
    bump2?: boolean;
  };

  if (!name || !email || !phone || !amount) {
    res.status(400).json({ error: 'name, email, phone, amount are required' });
    return;
  }

  const orderId = `GE_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  try {
    // 1. Create Cashfree order
    const cfRes = await fetch(`${CASHFREE_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID ?? '',
        'x-client-secret': process.env.CASHFREE_SECRET_KEY ?? '',
        'x-api-version': '2023-08-01',
      },
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
        order_meta: { segment: segment ?? null, bump1: bump1 ?? false, bump2: bump2 ?? false },
      }),
    });

    if (!cfRes.ok) {
      const errBody = await cfRes.json() as { message?: string };
      throw new Error(errBody.message ?? 'Cashfree order creation failed');
    }

    const cfData = await cfRes.json() as { payment_session_id: string };

    // 2. Fire-and-forget: create pending contact in DB so we have the lead
    //    even before payment completes
    db.select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, 'growth-escalators'))
      .limit(1)
      .then(([tenant]) => {
        if (!tenant) return;
        const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
        if (email) channels.push({ channelType: 'email', channelValue: email, isPrimary: true });
        if (phone) channels.push({ channelType: 'whatsapp', channelValue: `91${phone}` });

        const parts = name.trim().split(' ');
        const firstName = parts[0] ?? name;
        const lastName = parts.slice(1).join(' ') || undefined;

        return findOrCreateContact(tenant.id, {
          firstName,
          lastName,
          source: 'checkout',
          metadata: { segment, bump1, bump2, orderId, paymentStatus: 'pending' },
          channels,
        });
      })
      .catch((e: Error) => console.error('[cashfree] contact create failed:', e.message));

    res.json({ payment_session_id: cfData.payment_session_id, order_id: orderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cashfree] create-order error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
