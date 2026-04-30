import logger from '../utils/logger';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, pool, tenants, deals, contacts, processedEvents, events } from '../db/index';
import { findOrCreateContact } from '../services/contactService';
import { getFunnelConfig, stageForAmount, labelForStage } from '../services/funnelConfigService';
import { processCashfreeEvent, type CashfreeWebhookBody } from '../services/cashfreeEventProcessor';

const router = Router();

const CASHFREE_BASE =
  process.env.NODE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// ---------------------------------------------------------------------------
// POST /api/cashfree/create-order
// ---------------------------------------------------------------------------
router.post('/create-order', async (req: Request, res: Response) => {
  const { name, email, phone, amount, segment, bump1, bump2, fbp, fbc, funnelSlug, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body as {
    name: string; email: string; phone: string; amount: number;
    segment?: string; bump1?: boolean; bump2?: boolean;
    fbp?: string; fbc?: string; funnelSlug?: string;
    utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string;
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
        order_meta: {
          notify_url: `${process.env.BACKEND_URL || 'https://web-production-311da.up.railway.app'}/api/cashfree/webhook`,
          return_url: `${process.env.FRONTEND_URL || 'https://web-production-311da.up.railway.app'}/thank-you`,
          segment: segment ?? null, bump1: bump1 ?? false, bump2: bump2 ?? false, fbp: fbp ?? null, fbc: fbc ?? null, funnelSlug: funnelSlug ?? 'ecom', utm_source: utm_source ?? null, utm_medium: utm_medium ?? null, utm_campaign: utm_campaign ?? null, utm_content: utm_content ?? null, utm_term: utm_term ?? null,
        },
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
//
// Two callers in production:
//   1. Cashfree directly (legacy / fallback)
//   2. The Vercel edge function relay at ecom.growthescalators.com/api/cashfree/webhook,
//      which already verified Cashfree's signature and pushed to Upstash. The
//      drainer also calls processCashfreeEvent(), so this endpoint is now a
//      thin shell around the shared service for the legacy path.
// ---------------------------------------------------------------------------
router.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body as CashfreeWebhookBody;

  console.log('[cashfree webhook] RECEIVED:', JSON.stringify({
    event_type: body.event_type,
    payment_status: body.data?.payment?.payment_status,
    order_id: body.data?.order?.order_id,
    cf_payment_id: body.data?.payment?.cf_payment_id,
    customer_email: body.data?.customer_details?.customer_email,
    timestamp: new Date().toISOString(),
  }));

  const ipAddress = String((req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.headers['x-real-ip'] || req.socket.remoteAddress || '') || undefined;
  const userAgent = req.headers['user-agent'] || undefined;

  try {
    await processCashfreeEvent(body, { ipAddress, userAgent });
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

// ---------------------------------------------------------------------------
// POST /api/cashfree/simulate-webhook — Admin-only: simulate a webhook for testing
// Requires auth (mounted with requireAuth in index.ts via cashfreeAdminRouter)
// ---------------------------------------------------------------------------
const adminRouter = Router();

adminRouter.post('/simulate-webhook', async (req: Request, res: Response) => {
  const { name, email, phone, amount, segment, funnelSlug } = req.body as {
    name?: string; email?: string; phone?: string; amount?: number; segment?: string; funnelSlug?: string;
  };

  if (!name || !email || !phone) {
    res.status(400).json({ error: 'name, email, phone are required' });
    return;
  }

  const orderAmount = amount || 9;
  const simSegment = segment || 'd2c';
  const simFunnelSlug = funnelSlug || 'ecom';
  const cfPaymentId = `SIM_${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const orderId = `GE_SIM_${Date.now()}`;

  console.log(`[cashfree simulate] Starting simulation: name=${name} email=${email} phone=${phone} amount=₹${orderAmount}`);

  try {
    // Tenant lookup
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1);
    if (!tenant) {
      res.status(500).json({ error: 'Tenant growth-escalators not found' });
      return;
    }

    // Load funnel config
    const funnelConfig = await getFunnelConfig(simFunnelSlug, tenant.id);

    // Determine stage + products
    const roundedAmount = Math.round(orderAmount);
    let stage: string;
    let productLabel: string;
    if (funnelConfig) {
      stage = stageForAmount(funnelConfig, roundedAmount);
      productLabel = labelForStage(funnelConfig, stage);
    } else {
      if (Math.abs(roundedAmount - 9) <= 5) stage = 'paid_9';
      else if (Math.abs(roundedAmount - 208) <= 5) stage = 'paid_208';
      else if (Math.abs(roundedAmount - 508) <= 5) stage = 'paid_508';
      else if (Math.abs(roundedAmount - 707) <= 5) stage = 'paid_707';
      else stage = 'paid_9';
      productLabel = 'D2C Funnel Breakdown Pack';
    }

    const products: string[] = ['core_product'];
    const bump1 = false;
    const bump2 = false;

    // Create contact
    const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
    const normalizedPhone = phone.startsWith('91') ? phone : `91${phone.replace(/\D/g, '')}`;
    channels.push({ channelType: 'whatsapp', channelValue: normalizedPhone });
    channels.push({ channelType: 'email', channelValue: email, isPrimary: true });
    const parts = name.trim().split(' ');
    const firstName = parts[0] ?? name;
    const lastName = parts.slice(1).join(' ') || undefined;

    const { contact, created } = await findOrCreateContact(tenant.id, {
      firstName, lastName, source: 'checkout', channels,
    });

    // Tag contact
    const existingContact = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    const existingMeta = (existingContact[0]?.metadata ?? {}) as Record<string, unknown>;
    const existingTags = (existingContact[0]?.tags ?? []) as string[];
    const newTags = [...new Set([...existingTags, 'slo_buyer', `funnel:${simFunnelSlug}`, simSegment, ...products])];

    await db.update(contacts).set({
      status: 'prospect',
      tags: newTags,
      metadata: { ...existingMeta, paymentStatus: 'paid', paidAmount: orderAmount, segment: simSegment, bump1, bump2, products, funnelSlug: simFunnelSlug, simulated: true },
      updatedAt: new Date(),
    }).where(eq(contacts.id, contact.id));

    // Create deal
    const serviceType = funnelConfig?.service_type || 'ecom';
    await db.insert(deals).values({
      tenantId: tenant.id, contactId: contact.id,
      title: `${funnelConfig?.name || 'SLO'} Purchase — ${name} (SIM)`, stage, serviceType, value: String(orderAmount),
    });

    // Log slo_purchase event
    try {
      await db.insert(events).values({
        tenantId: tenant.id, contactId: contact.id, eventType: 'slo_purchase',
        payload: { amount: orderAmount, segment: simSegment, products, cfPaymentId, funnelSlug: simFunnelSlug, simulated: true },
      });
    } catch {
      await pool.query(
        `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'slo_purchase', $3::jsonb, NOW())`,
        [tenant.id, contact.id, JSON.stringify({ amount: orderAmount, segment: simSegment, products, cfPaymentId, funnelSlug: simFunnelSlug, simulated: true })],
      );
    }

    // Mark as processed
    await db.insert(processedEvents).values({ eventId: cfPaymentId, source: 'simulation' });

    console.log(`[cashfree simulate] Complete: contact=${contact.id} deal stage=${stage} event logged`);

    res.json({
      ok: true,
      simulated: true,
      contactId: contact.id,
      contactCreated: created,
      stage,
      productLabel,
      cfPaymentId,
      note: 'Pipeline placement will happen via worker within 5 minutes. Email/WhatsApp NOT sent in simulation mode.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[cashfree simulate] error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/cashfree/debug-orders — Admin-only: compare Cashfree orders vs local DB
// ---------------------------------------------------------------------------
adminRouter.get('/debug-orders', async (_req: Request, res: Response) => {
  try {
    // 1. Recent contacts created via checkout
    const recentContacts = await pool.query(`
      SELECT c.id, c.first_name, c.last_name, c.source, c.status,
             c.metadata->>'paymentStatus' AS payment_status,
             c.metadata->>'paidAmount' AS paid_amount,
             c.created_at
      FROM contacts c
      WHERE c.source = 'checkout'
      ORDER BY c.created_at DESC
      LIMIT 10
    `);

    // 2. Recent slo_purchase events
    const recentEvents = await pool.query(`
      SELECT e.id, e.contact_id, e.event_type,
             e.payload->>'amount' AS amount,
             e.payload->>'cfPaymentId' AS cf_payment_id,
             e.payload->>'funnelSlug' AS funnel_slug,
             e.created_at
      FROM events e
      WHERE e.event_type = 'slo_purchase'
      ORDER BY e.created_at DESC
      LIMIT 10
    `);

    // 3. Recent processed events (idempotency records)
    const recentProcessed = await pool.query(`
      SELECT event_id, source, created_at
      FROM processed_events
      WHERE source IN ('cashfree', 'simulation')
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // 4. Recent deals
    const recentDeals = await pool.query(`
      SELECT d.id, d.title, d.stage, d.value, d.pipeline_id, d.created_at
      FROM deals d
      ORDER BY d.created_at DESC
      LIMIT 10
    `);

    // 5. Pipeline contacts
    const pipelineContacts = await pool.query(`
      SELECT pc.contact_id, pc.pipeline_name, pc.stage_name, pc.placed_at
      FROM pipeline_contacts pc
      ORDER BY pc.placed_at DESC
      LIMIT 10
    `);

    // 6. Cashfree environment check
    const envCheck = {
      cashfree_env: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
      cashfree_base_url: CASHFREE_BASE,
      has_app_id: !!process.env.CASHFREE_APP_ID,
      has_secret_key: !!process.env.CASHFREE_SECRET_KEY,
      has_meta_pixel: !!process.env.META_PIXEL_ID,
      has_meta_access_token: !!process.env.META_ACCESS_TOKEN,
      has_meta_phone_number_id: !!process.env.META_PHONE_NUMBER_ID,
      has_brevo_key: !!process.env.BREVO_API_KEY,
      backend_url: process.env.BACKEND_URL || 'https://web-production-311da.up.railway.app',
      webhook_url: `${process.env.BACKEND_URL || 'https://web-production-311da.up.railway.app'}/api/cashfree/webhook`,
    };

    res.json({
      environment: envCheck,
      recent_checkout_contacts: recentContacts.rows,
      recent_slo_purchase_events: recentEvents.rows,
      recent_processed_events: recentProcessed.rows,
      recent_deals: recentDeals.rows,
      recent_pipeline_contacts: pipelineContacts.rows,
      counts: {
        checkout_contacts: recentContacts.rows.length,
        slo_purchase_events: recentEvents.rows.length,
        processed_events: recentProcessed.rows.length,
        pipeline_contacts: pipelineContacts.rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export { adminRouter as cashfreeAdminRouter };
export default router;
