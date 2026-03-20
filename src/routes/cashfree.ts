import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, tenants, deals, contacts, processedEvents } from '../db/index';
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

// ---------------------------------------------------------------------------
// POST /api/cashfree/webhook
// Handles Cashfree PAYMENT_SUCCESS_WEBHOOK events
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body as {
    data?: {
      order?: { order_id?: string; order_amount?: number };
      payment?: { payment_status?: string; cf_payment_id?: string };
      customer_details?: {
        customer_id?: string;
        customer_name?: string;
        customer_email?: string;
        customer_phone?: string;
      };
    };
    event_type?: string;
  };

  // 1. Ignore non-payment-success events
  if (
    body.event_type !== 'PAYMENT_SUCCESS_WEBHOOK' ||
    body.data?.payment?.payment_status !== 'SUCCESS'
  ) {
    res.json({ ok: true });
    return;
  }

  const cfPaymentId = body.data?.payment?.cf_payment_id ?? '';
  const orderAmount = body.data?.order?.order_amount ?? 0;
  const customerDetails = body.data?.customer_details ?? {};
  const phone = customerDetails.customer_id ?? '';
  const email = customerDetails.customer_email ?? '';
  const name = customerDetails.customer_name ?? '';

  try {
    // 2. Idempotency check
    const existing = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, cfPaymentId))
      .limit(1);

    if (existing.length > 0) {
      res.json({ ok: true });
      return;
    }

    // 3 & 4. Determine stage from amount
    const amount = Math.round(orderAmount);
    let stage: string;
    if (Math.abs(amount - 9) <= 5) {
      stage = 'paid_9';
    } else if (Math.abs(amount - 208) <= 5) {
      stage = 'paid_208';
    } else if (Math.abs(amount - 508) <= 5) {
      stage = 'paid_508';
    } else if (Math.abs(amount - 707) <= 5) {
      stage = 'paid_707';
    } else {
      stage = 'paid_9';
    }

    // 5. Look up tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, 'growth-escalators'))
      .limit(1);

    if (!tenant) {
      console.error('[cashfree webhook] tenant not found');
      res.json({ ok: true });
      return;
    }

    // 5. Find or create contact
    const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
    if (phone) channels.push({ channelType: 'whatsapp', channelValue: phone });
    if (email) channels.push({ channelType: 'email', channelValue: email, isPrimary: true });

    const parts = name.trim().split(' ');
    const firstName = parts[0] ?? name;
    const lastName = parts.slice(1).join(' ') || undefined;

    const { contact } = await findOrCreateContact(tenant.id, {
      firstName,
      lastName,
      source: 'checkout',
      channels,
    });

    // 6. Create deal
    await db.insert(deals).values({
      tenantId: tenant.id,
      contactId: contact.id,
      title: 'Ecom Purchase',
      stage,
      serviceType: 'ecom',
      value: String(orderAmount),
    });

    // 7. Update contact status and metadata
    const existingContact = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contact.id))
      .limit(1);

    const existingMeta = (existingContact[0]?.metadata ?? {}) as Record<string, unknown>;
    await db
      .update(contacts)
      .set({
        status: 'prospect',
        metadata: { ...existingMeta, paymentStatus: 'paid', paidAmount: orderAmount },
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contact.id));

    // 8. Mark event as processed
    await db.insert(processedEvents).values({
      eventId: cfPaymentId,
      source: 'cashfree',
    });

    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cashfree webhook] error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
