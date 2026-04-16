import logger from '../utils/logger';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, pool, tenants, deals, contacts, processedEvents, events } from '../db/index';
import { findOrCreateContact } from '../services/contactService';
import { sendPurchaseEvent } from '../services/metaCapi';
import { sendSlackMessage } from '../services/slackService';
import { getFunnelConfig, stageForAmount, labelForStage, renderTemplate, type FunnelConfig } from '../services/funnelConfigService';

const router = Router();

const CASHFREE_BASE =
  process.env.NODE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// ---------------------------------------------------------------------------
// POST /api/cashfree/create-order
// ---------------------------------------------------------------------------
router.post('/create-order', async (req: Request, res: Response) => {
  const { name, email, phone, amount, segment, bump1, bump2, fbp, fbc, funnelSlug } = req.body as {
    name: string; email: string; phone: string; amount: number;
    segment?: string; bump1?: boolean; bump2?: boolean;
    fbp?: string; fbc?: string; funnelSlug?: string;
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
        order_meta: { segment: segment ?? null, bump1: bump1 ?? false, bump2: bump2 ?? false, fbp: fbp ?? null, fbc: fbc ?? null, funnelSlug: funnelSlug ?? 'ecom' },
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
  const fbpCookie = (orderMeta.fbp as string) || undefined;
  const fbcCookie = (orderMeta.fbc as string) || undefined;
  const funnelSlug = (orderMeta.funnelSlug as string) || 'ecom';

  try {
    // Idempotency check
    const existing = await db.select().from(processedEvents).where(eq(processedEvents.eventId, cfPaymentId)).limit(1);
    if (existing.length > 0) { res.json({ ok: true }); return; }

    // Tenant lookup
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1);
    if (!tenant) { res.json({ ok: true }); return; }

    // Load funnel config (config-driven — no more hardcoded values)
    const funnelConfig = await getFunnelConfig(funnelSlug, tenant.id);

    // Determine stage + products using config (fallback to legacy if no config found)
    const amount = Math.round(orderAmount);
    let stage: string;
    let productLabel: string;

    if (funnelConfig) {
      stage = stageForAmount(funnelConfig, amount);
      productLabel = labelForStage(funnelConfig, stage);
    } else {
      // Legacy fallback for backward compatibility
      if (Math.abs(amount - 9) <= 5) stage = 'paid_9';
      else if (Math.abs(amount - 208) <= 5) stage = 'paid_208';
      else if (Math.abs(amount - 508) <= 5) stage = 'paid_508';
      else if (Math.abs(amount - 707) <= 5) stage = 'paid_707';
      else stage = 'paid_9';
      productLabel = 'D2C Funnel Breakdown Pack';
    }

    const products: string[] = ['core_product'];
    if (bump1 && (funnelConfig?.bump1_price || !funnelConfig)) products.push('growth_kit');
    if (bump2 && (funnelConfig?.bump2_price || !funnelConfig)) products.push('audit_call');

    // Find or create contact — normalize phone with 91 prefix
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

    // Tag contact with segment + products + funnel
    const existingContact = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    const existingMeta = (existingContact[0]?.metadata ?? {}) as Record<string, unknown>;
    const existingTags = (existingContact[0]?.tags ?? []) as string[];
    const newTags = [...new Set([...existingTags, 'slo_buyer', `funnel:${funnelSlug}`, segment, ...products])];

    await db.update(contacts).set({
      status: 'prospect',
      tags: newTags,
      metadata: { ...existingMeta, paymentStatus: 'paid', paidAmount: orderAmount, segment, bump1, bump2, products, funnelSlug },
      updatedAt: new Date(),
    }).where(eq(contacts.id, contact.id));

    // Create deal (config-driven service type)
    const serviceType = funnelConfig?.service_type || 'ecom';
    await db.insert(deals).values({
      tenantId: tenant.id, contactId: contact.id,
      title: `${funnelConfig?.name || 'SLO'} Purchase — ${name}`, stage, serviceType, value: String(orderAmount),
    });

    // Fire CAPI Purchase event
    const ipAddress = String((req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.headers['x-real-ip'] || req.socket.remoteAddress || '') || undefined;
    const userAgent = req.headers['user-agent'] || undefined;
    sendPurchaseEvent({
      contact: { id: contact.id, firstName, lastName, email: email || undefined },
      value: orderAmount, orderId: cfPaymentId,
      productName: productLabel, ipAddress, userAgent,
      fbc: fbcCookie, fbp: fbpCookie,
    }).then(result => {
      if (result.success) {
        db.insert(events).values({
          tenantId: tenant.id, contactId: contact.id, eventType: 'capi_purchase_sent',
          payload: { eventId: result.eventId, orderId: cfPaymentId, value: orderAmount, stage, funnelSlug },
        }).catch(() => {});
      }
    }).catch((e: Error) => logger.error('[cashfree] CAPI purchase error:', e.message));

    // Send WhatsApp welcome template (config-driven template name)
    const waTemplateName = funnelConfig?.wa_template_name || 'ge_welcome_d2c';
    if (phone && process.env.META_PHONE_NUMBER_ID && process.env.META_ACCESS_TOKEN) {
      const cleanPhone = phone.replace(/\D/g, '');
      fetch(`https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: cleanPhone, type: 'template',
          template: { name: waTemplateName, language: { code: 'en' } },
        }),
      }).catch(e => logger.error('[cashfree] WhatsApp template error:', e));
    }

    // Immediate Slack alert (config-driven emoji + label)
    const slackEmoji = funnelConfig?.slack_emoji || '💰';
    const slackLabel = funnelConfig?.slack_label || 'New Purchase';
    const slackChannel = funnelConfig?.slack_channel || process.env.SLACK_SOD_EOD_CHANNEL || 'C08EMRX2HHN';
    sendSlackMessage(slackChannel,
      `${slackEmoji} *${slackLabel}!*\n` +
      `• Funnel: ${funnelConfig?.name || funnelSlug}\n` +
      `• Name: ${name}\n` +
      `• Amount: ₹${orderAmount}\n` +
      `• Segment: ${segment}\n` +
      `• Products: ${products.join(', ')}\n` +
      `• Phone: ${phone || 'N/A'} | Email: ${email || 'N/A'}`,
    ).catch(() => {});

    // Immediate purchase confirmation email (config-driven subject + body)
    if (email) {
      const brevoKey = process.env.BREVO_API_KEY;
      if (brevoKey && funnelConfig) {
        const templateVars: Record<string, string> = {
          firstName, productName: funnelConfig.product_name,
          mainPdfUrl: funnelConfig.main_pdf_url || '[PDF will be delivered shortly]',
          bump1Section: bump1 && funnelConfig.bump1_pdf_url ? `📦 ${funnelConfig.bump1_label || 'Add-on'}:\n${funnelConfig.bump1_pdf_url}\n\n` : '',
          bump2Section: bump2 && funnelConfig.bump2_booking_url ? `🎯 ${funnelConfig.bump2_label || 'Call'}:\n${funnelConfig.bump2_booking_url}\n\n` : '',
        };
        const subject = renderTemplate(funnelConfig.email_subject || 'Your purchase is confirmed, {firstName}!', templateVars);
        const body = renderTemplate(funnelConfig.email_body || 'Hi {firstName}, your purchase is confirmed.', templateVars);

        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            sender: { name: 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
            to: [{ email, name: firstName }],
            subject,
            htmlContent: body.replace(/\n/g, '<br>'),
            textContent: body,
          }),
        }).then(r => {
          if (r.ok) logger.info(`[cashfree] Purchase email sent to ${email} (${funnelSlug})`);
          else logger.error(`[cashfree] Brevo failed: ${r.status}`);
        }).catch(e => logger.error('[cashfree] Purchase email error:', e));
      } else if (brevoKey) {
        // Legacy fallback when no funnel config exists
        let legacyBody = `Hi ${firstName},\n\nYour purchase is confirmed!\n\n— Jatin from Growth Escalators`;
        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            sender: { name: 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
            to: [{ email, name: firstName }],
            subject: `Your purchase is confirmed, ${firstName}!`,
            htmlContent: legacyBody.replace(/\n/g, '<br>'),
            textContent: legacyBody,
          }),
        }).catch(e => logger.error('[cashfree] Legacy email error:', e));
      }
    }

    // Log event (include funnelSlug in payload for worker to read)
    await db.insert(events).values({
      tenantId: tenant.id, contactId: contact.id, eventType: 'slo_purchase',
      payload: { amount: orderAmount, segment, products, cfPaymentId, funnelSlug },
    });

    // Auto-enroll in sequence (config-driven sequence name)
    const seqName = funnelConfig?.sequence_name || 'D2C Lead Nurture';
    pool.query(
      `INSERT INTO sequence_enrolments (id, tenant_id, contact_id, sequence_id, current_step, status, next_step_at, enrolled_at)
       SELECT gen_random_uuid(), $1, $2, s.id, 1, 'active', NOW() + COALESCE((s.steps->1->>'delayDays')::int, 3) * INTERVAL '1 day', NOW()
       FROM sequences s
       WHERE s.name = $3 AND s.tenant_id = $1 AND s.is_active = TRUE
         AND NOT EXISTS (SELECT 1 FROM sequence_enrolments se WHERE se.contact_id = $2 AND se.sequence_id = s.id AND se.status = 'active')
       LIMIT 1`,
      [tenant.id, contact.id, seqName],
    ).then(r => {
      if (r.rowCount && r.rowCount > 0) logger.info(`[cashfree] Enrolled ${name} in ${seqName} sequence`);
    }).catch(e => logger.error('[cashfree] Sequence enrollment error:', e));

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
