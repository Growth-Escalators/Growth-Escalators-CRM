import logger from '../utils/logger';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, tenants, deals, contacts, processedEvents, events } from '../db/index';
import { findOrCreateContact } from '../services/contactService';
import { sendPurchaseEvent } from '../services/metaCapi';
import { sendSlackMessage } from '../services/slackService';

const router = Router();

const CASHFREE_BASE =
  process.env.NODE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// ---------------------------------------------------------------------------
// POST /api/cashfree/create-order
// ---------------------------------------------------------------------------
router.post('/create-order', async (req: Request, res: Response) => {
  const { name, email, phone, amount, segment, bump1, bump2 } = req.body as {
    name: string; email: string; phone: string; amount: number;
    segment?: string; bump1?: boolean; bump2?: boolean;
  };

  if (!name || !email || !phone || !amount) {
    res.status(400).json({ error: 'name, email, phone, amount are required' });
    return;
  }

  const orderId = `GE_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  try {
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

    // Fire-and-forget: create pending contact
    db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1)
      .then(([tenant]) => {
        if (!tenant) return;
        const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
        if (email) channels.push({ channelType: 'email', channelValue: email, isPrimary: true });
        if (phone) channels.push({ channelType: 'whatsapp', channelValue: `91${phone}` });
        const parts = name.trim().split(' ');
        return findOrCreateContact(tenant.id, {
          firstName: parts[0] ?? name,
          lastName: parts.slice(1).join(' ') || undefined,
          source: 'checkout',
          metadata: { segment, bump1, bump2, orderId, paymentStatus: 'pending' },
          channels,
        });
      })
      .catch((e: Error) => logger.error('[cashfree] contact create failed:', e.message));

    res.json({ payment_session_id: cfData.payment_session_id, order_id: orderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[cashfree] create-order error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/cashfree/webhook
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body as {
    data?: {
      order?: { order_id?: string; order_amount?: number; order_meta?: Record<string, unknown> };
      payment?: { payment_status?: string; cf_payment_id?: string };
      customer_details?: { customer_id?: string; customer_name?: string; customer_email?: string; customer_phone?: string };
    };
    event_type?: string;
  };

  if (body.event_type !== 'PAYMENT_SUCCESS_WEBHOOK' || body.data?.payment?.payment_status !== 'SUCCESS') {
    res.json({ ok: true });
    return;
  }

  const cfPaymentId = body.data?.payment?.cf_payment_id ?? '';
  const orderAmount = body.data?.order?.order_amount ?? 0;
  const orderMeta = (body.data?.order?.order_meta ?? {}) as Record<string, unknown>;
  const customerDetails = body.data?.customer_details ?? {};
  const phone = customerDetails.customer_id ?? '';
  const email = customerDetails.customer_email ?? '';
  const name = customerDetails.customer_name ?? '';
  const segment = (orderMeta.segment as string) || 'unknown';
  const bump1 = Boolean(orderMeta.bump1);
  const bump2 = Boolean(orderMeta.bump2);

  try {
    // Idempotency check
    const existing = await db.select().from(processedEvents).where(eq(processedEvents.eventId, cfPaymentId)).limit(1);
    if (existing.length > 0) { res.json({ ok: true }); return; }

    // Determine stage + products
    const amount = Math.round(orderAmount);
    let stage: string;
    if (Math.abs(amount - 9) <= 5) stage = 'paid_9';
    else if (Math.abs(amount - 208) <= 5) stage = 'paid_208';
    else if (Math.abs(amount - 508) <= 5) stage = 'paid_508';
    else if (Math.abs(amount - 707) <= 5) stage = 'paid_707';
    else stage = 'paid_9';

    const products: string[] = ['core_product'];
    if (bump1) products.push('growth_kit');
    if (bump2) products.push('audit_call');

    const CONTENT_NAMES: Record<string, string> = {
      paid_9: 'D2C Funnel Breakdown Pack',
      paid_208: 'D2C Funnel Pack + Growth Kit',
      paid_508: 'D2C Funnel Pack + Growth Audit',
      paid_707: 'D2C Complete Bundle',
    };
    const productLabel = CONTENT_NAMES[stage] ?? 'D2C Product';

    // Segment tag mapping
    const SEGMENT_TAGS: Record<string, string> = {
      ecom_brand: 'ecom_brand',
      agency_owner: 'agency_owner',
      freelancer: 'freelancer',
    };

    // Tenant lookup
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1);
    if (!tenant) { res.json({ ok: true }); return; }

    // Find or create contact — normalize phone with 91 prefix (matching create-order)
    const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
    const normalizedPhone = phone ? (phone.startsWith('91') ? phone : `91${phone.replace(/\D/g, '')}`) : '';
    if (normalizedPhone) channels.push({ channelType: 'whatsapp', channelValue: normalizedPhone });
    if (email) channels.push({ channelType: 'email', channelValue: email, isPrimary: true });
    const parts = name.trim().split(' ');
    const firstName = parts[0] ?? name;
    const lastName = parts.slice(1).join(' ') || undefined;

    const { contact } = await findOrCreateContact(tenant.id, {
      firstName, lastName, source: 'checkout', channels,
    });

    // Tag contact with segment + products
    const existingContact = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    const existingMeta = (existingContact[0]?.metadata ?? {}) as Record<string, unknown>;
    const existingTags = (existingContact[0]?.tags ?? []) as string[];
    const newTags = [...new Set([...existingTags, 'slo_buyer', SEGMENT_TAGS[segment] || segment, ...products])];

    await db.update(contacts).set({
      status: 'prospect',
      tags: newTags,
      metadata: { ...existingMeta, paymentStatus: 'paid', paidAmount: orderAmount, segment, bump1, bump2, products },
      updatedAt: new Date(),
    }).where(eq(contacts.id, contact.id));

    // Create deal
    await db.insert(deals).values({
      tenantId: tenant.id, contactId: contact.id,
      title: `SLO Purchase — ${name}`, stage, serviceType: 'ecom', value: String(orderAmount),
    });

    // Fire CAPI Purchase event
    const ipAddress = String((req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.headers['x-real-ip'] || req.socket.remoteAddress || '') || undefined;
    const userAgent = req.headers['user-agent'] || undefined;
    sendPurchaseEvent({
      contact: { id: contact.id, firstName, lastName, email: email || undefined },
      value: orderAmount, orderId: cfPaymentId,
      productName: productLabel, ipAddress, userAgent,
    }).then(result => {
      if (result.success) {
        db.insert(events).values({
          tenantId: tenant.id, contactId: contact.id, eventType: 'capi_purchase_sent',
          payload: { eventId: result.eventId, orderId: cfPaymentId, value: orderAmount, stage },
        }).catch(() => {});
      }
    }).catch((e: Error) => logger.error('[cashfree] CAPI purchase error:', e.message));

    // Send WhatsApp welcome template (fire-and-forget)
    if (phone && process.env.META_PHONE_NUMBER_ID && process.env.META_ACCESS_TOKEN) {
      const cleanPhone = phone.replace(/\D/g, '');
      fetch(`https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: cleanPhone, type: 'template',
          template: { name: 'ge_welcome_d2c', language: { code: 'en' } },
        }),
      }).catch(e => logger.error('[cashfree] WhatsApp template error:', e));
    }

    // Immediate Slack alert so team knows instantly
    sendSlackMessage(process.env.SLACK_SOD_EOD_CHANNEL || 'C08EMRX2HHN',
      `💰 *New SLO Purchase!*\n` +
      `• Name: ${name}\n` +
      `• Amount: ₹${orderAmount}\n` +
      `• Segment: ${segment}\n` +
      `• Products: ${products.join(', ')}\n` +
      `• Phone: ${phone || 'N/A'} | Email: ${email || 'N/A'}`,
    ).catch(() => {});

    // Immediate purchase confirmation email (don't rely solely on worker)
    if (email) {
      // Worker will also deliver assets, but immediate email below is the failsafe

      // Direct Brevo email as failsafe
      const brevoKey = process.env.BREVO_API_KEY;
      if (brevoKey) {
        let emailBody = `Hi ${firstName},\n\nYour purchase is confirmed! Here is your D2C Funnel Breakdown Pack:\n\n`;
        emailBody += `📄 Download your PDF: https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf\n\n`;
        if (bump1) emailBody += `📦 Your Growth Kit: https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf\n\n`;
        if (bump2) emailBody += `🎯 Book your Audit Call: https://cal.com/growth-escalators/discovery-call\n\n`;
        emailBody += `Go through Section 2 first — that is where most brands find their biggest insight.\n\n— Jatin from Growth Escalators`;

        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            sender: { name: 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
            to: [{ email, name: firstName }],
            subject: `Your D2C Funnel Breakdown Pack is ready, ${firstName} 🎯`,
            htmlContent: emailBody.replace(/\n/g, '<br>'),
            textContent: emailBody,
          }),
        }).then(r => {
          if (r.ok) logger.info(`[cashfree] Purchase email sent to ${email}`);
          else logger.error(`[cashfree] Brevo failed: ${r.status}`);
        }).catch(e => logger.error('[cashfree] Purchase email error:', e));
      }
    }

    // Log event
    await db.insert(events).values({
      tenantId: tenant.id, contactId: contact.id, eventType: 'slo_purchase',
      payload: { amount: orderAmount, segment, products, cfPaymentId },
    });

    // Mark as processed
    await db.insert(processedEvents).values({ eventId: cfPaymentId, source: 'cashfree' });

    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[cashfree webhook] error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/cashfree/webhook-test
// ---------------------------------------------------------------------------
router.get('/webhook-test', (_req: Request, res: Response) => {
  res.json({
    status: 'active',
    handler: 'POST /api/cashfree/webhook',
    events_handled: ['PAYMENT_SUCCESS_WEBHOOK'],
    actions: ['create_contact', 'tag_segment', 'create_deal', 'fire_capi_purchase', 'send_whatsapp_template', 'log_event'],
    cashfree_env: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
    has_cashfree_creds: !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY),
  });
});

// ---------------------------------------------------------------------------
// GET /api/cashfree/order/:orderId — order details for thank you page
// ---------------------------------------------------------------------------
router.get('/order/:orderId', async (req: Request, res: Response) => {
  const orderId = req.params.orderId as string;
  if (!orderId) { res.status(400).json({ error: 'orderId required' }); return; }

  try {
    const cfRes = await fetch(`${CASHFREE_BASE}/orders/${orderId}`, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID ?? '',
        'x-client-secret': process.env.CASHFREE_SECRET_KEY ?? '',
        'x-api-version': '2023-08-01',
      },
    });
    const data = await cfRes.json() as Record<string, unknown>;
    res.json({
      orderId: data.order_id,
      amount: data.order_amount,
      status: data.order_status,
      meta: data.order_meta,
      customer: data.customer_details,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/cashfree/upsell — create upsell order for a bump
// ---------------------------------------------------------------------------
router.post('/upsell', async (req: Request, res: Response) => {
  const { orderId, bumpId, email, phone, name } = req.body as {
    orderId?: string; bumpId?: number; email?: string; phone?: string; name?: string;
  };

  if (!bumpId || !email || !phone) {
    res.status(400).json({ error: 'bumpId, email, phone required' });
    return;
  }

  const amount = bumpId === 1 ? 199 : bumpId === 2 ? 499 : 0;
  if (amount === 0) { res.status(400).json({ error: 'invalid bumpId' }); return; }

  const upsellOrderId = `GE_UP_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  try {
    const cfRes = await fetch(`${CASHFREE_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID ?? '',
        'x-client-secret': process.env.CASHFREE_SECRET_KEY ?? '',
        'x-api-version': '2023-08-01',
      },
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
        order_meta: { upsell: true, bumpId, originalOrderId: orderId },
      }),
    });

    if (!cfRes.ok) {
      const errBody = await cfRes.json() as { message?: string };
      throw new Error(errBody.message ?? 'Upsell order creation failed');
    }

    const cfData = await cfRes.json() as { payment_session_id: string };
    res.json({ payment_session_id: cfData.payment_session_id, order_id: upsellOrderId, amount });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
