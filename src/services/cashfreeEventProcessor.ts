import { eq } from 'drizzle-orm';
import { db, pool, tenants, deals, contacts, processedEvents, events } from '../db/index';
import { findOrCreateContact } from './contactService';
import { sendPurchaseEvent } from './metaCapi';
import { sendSlackMessage } from './slackService';
import { getFunnelConfig, stageForAmount, labelForStage, renderTemplate } from './funnelConfigService';
import logger from '../utils/logger';

// Shape of the Cashfree webhook body we care about.
// Cashfree API v2023-08-01 uses `type`; older payloads use `event_type`. Accept both.
export interface CashfreeWebhookBody {
  event_type?: string;
  type?: string;
  data?: {
    order?: {
      order_id?: string;
      order_amount?: number;
      order_meta?: Record<string, unknown>;
    };
    payment?: {
      payment_status?: string;
      cf_payment_id?: string;
    };
    customer_details?: {
      customer_id?: string;
      customer_name?: string;
      customer_email?: string;
      customer_phone?: string;
    };
  };
}

export interface ProcessOptions {
  ipAddress?: string;
  userAgent?: string;
  // When true, side-effects like Slack/Brevo/CAPI/WhatsApp/sequence enrol still
  // fire; pass false from a backfill / replay to keep them quiet.
  fireSideEffects?: boolean;
}

export type ProcessResult =
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: true; status: 'processed'; contactId: string; stage: string };

/**
 * Idempotent processing of a Cashfree PAYMENT_SUCCESS_WEBHOOK event.
 * Safe to call from:
 *   - the public webhook route handler (api/cashfree/webhook)
 *   - the edge-queue drainer when the Vercel edge function relays a webhook
 *   - one-off scripts replaying historical events
 *
 * Idempotency is enforced via the `processed_events` table keyed on cf_payment_id.
 */
export async function processCashfreeEvent(
  body: CashfreeWebhookBody,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const fireSideEffects = opts.fireSideEffects ?? true;

  const eventType = body.type ?? body.event_type;
  if (eventType !== 'PAYMENT_SUCCESS_WEBHOOK' || body.data?.payment?.payment_status !== 'SUCCESS') {
    return { ok: true, status: 'skipped', reason: 'not a success event' };
  }

  const cfPaymentId = body.data?.payment?.cf_payment_id ?? '';
  if (!cfPaymentId) return { ok: true, status: 'skipped', reason: 'missing cf_payment_id' };

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

  const utmData = {
    utm_source: (orderMeta.utm_source as string) || null,
    utm_medium: (orderMeta.utm_medium as string) || null,
    utm_campaign: (orderMeta.utm_campaign as string) || null,
    utm_content: (orderMeta.utm_content as string) || null,
    utm_term: (orderMeta.utm_term as string) || null,
  };

  // Idempotency check (before any writes). Wrap in try/catch so a transient DB
  // error doesn't permanently lose the message — caller should retry.
  const existing = await db.select().from(processedEvents).where(eq(processedEvents.eventId, cfPaymentId)).limit(1);
  if (existing.length > 0) {
    logger.info(`[cashfree] Already processed ${cfPaymentId} — skipping`);
    return { ok: true, status: 'skipped', reason: 'already processed' };
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1);
  if (!tenant) {
    logger.error('[cashfree] Tenant growth-escalators NOT FOUND — aborting');
    return { ok: true, status: 'skipped', reason: 'tenant not found' };
  }
  logger.info(`[cashfree] Processing: order=${body.data?.order?.order_id} amount=₹${orderAmount} name=${name} email=${email}`);

  const funnelConfig = await getFunnelConfig(funnelSlug, tenant.id);

  const amount = Math.round(orderAmount);
  let stage: string;
  let productLabel: string;
  if (funnelConfig) {
    stage = stageForAmount(funnelConfig, amount);
    productLabel = labelForStage(funnelConfig, stage);
  } else {
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

  const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
  const normalizedPhone = phone ? (phone.startsWith('91') ? phone : `91${phone.replace(/\D/g, '')}`) : '';
  if (normalizedPhone) channels.push({ channelType: 'whatsapp', channelValue: normalizedPhone });
  if (email) channels.push({ channelType: 'email', channelValue: email, isPrimary: true });
  const parts = name.trim().split(' ');
  const firstName = parts[0] ?? name;
  const lastName = parts.slice(1).join(' ') || undefined;

  const { contact, created } = await findOrCreateContact(tenant.id, {
    firstName, lastName, source: 'checkout', channels,
  });
  logger.info(`[cashfree] Contact ${created ? 'CREATED' : 'FOUND'}: ${contact.id} (${firstName} ${lastName || ''})`);

  const existingContact = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
  const existingMeta = (existingContact[0]?.metadata ?? {}) as Record<string, unknown>;
  const existingTags = (existingContact[0]?.tags ?? []) as string[];
  const newTags = [...new Set([...existingTags, 'slo_buyer', `funnel:${funnelSlug}`, segment, ...products])];

  // Bump lastActivityAt so repeat buyers surface at the top of the CRM contact
  // list (sorted by lastActivityAt DESC). Without this, an existing contact
  // making a fresh purchase wouldn't visually move — the buy would still
  // create a new deal + event row, but the contact list ordering would lie.
  const now = new Date();
  await db.update(contacts).set({
    status: 'prospect',
    tags: newTags,
    metadata: { ...existingMeta, paymentStatus: 'paid', paidAmount: orderAmount, segment, bump1, bump2, products, funnelSlug, ...utmData },
    updatedAt: now,
    lastActivityAt: now,
  }).where(eq(contacts.id, contact.id));

  const serviceType = funnelConfig?.service_type || 'ecom';
  await db.insert(deals).values({
    tenantId: tenant.id, contactId: contact.id,
    title: `${funnelConfig?.name || 'SLO'} Purchase — ${name}`, stage, serviceType, value: String(orderAmount),
  });
  logger.info(`[cashfree] Deal created: stage=${stage} value=₹${orderAmount} funnel=${funnelSlug}`);

  try {
    await db.insert(events).values({
      tenantId: tenant.id, contactId: contact.id, eventType: 'slo_purchase',
      payload: { amount: orderAmount, segment, products, cfPaymentId, funnelSlug },
    });
  } catch (eventErr) {
    logger.error('[cashfree] event insert via Drizzle failed, trying raw SQL:', eventErr);
    await pool.query(
      `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'slo_purchase', $3::jsonb, NOW())`,
      [tenant.id, contact.id, JSON.stringify({ amount: orderAmount, segment, products, cfPaymentId, funnelSlug })],
    );
  }

  await db.insert(processedEvents).values({ eventId: cfPaymentId, source: 'cashfree' });
  logger.info(`[cashfree] Marked ${cfPaymentId} as processed`);

  if (!fireSideEffects) {
    return { ok: true, status: 'processed', contactId: contact.id, stage };
  }

  // === Fire-and-forget side-effects ===

  sendPurchaseEvent({
    contact: { id: contact.id, firstName, lastName, email: email || undefined },
    value: orderAmount, orderId: cfPaymentId,
    productName: productLabel,
    ipAddress: opts.ipAddress, userAgent: opts.userAgent,
    fbc: fbcCookie, fbp: fbpCookie,
    utmSource: utmData.utm_source || undefined,
    utmCampaign: utmData.utm_campaign || undefined,
  }).then(result => {
    if (result.success) {
      db.insert(events).values({
        tenantId: tenant.id, contactId: contact.id, eventType: 'capi_purchase_sent',
        payload: { eventId: result.eventId, orderId: cfPaymentId, value: orderAmount, stage, funnelSlug },
      }).catch(() => {});
    }
  }).catch((e: Error) => logger.error('[cashfree] CAPI purchase error:', e.message));

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
      const emailBody = renderTemplate(funnelConfig.email_body || 'Hi {firstName}, your purchase is confirmed.', templateVars);

      fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          sender: { name: 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
          to: [{ email, name: firstName }],
          subject,
          htmlContent: emailBody.replace(/\n/g, '<br>'),
          textContent: emailBody,
        }),
      }).then(r => {
        if (r.ok) logger.info(`[cashfree] Purchase email sent to ${email} (${funnelSlug})`);
        else logger.error(`[cashfree] Brevo failed: ${r.status}`);
      }).catch(e => logger.error('[cashfree] Purchase email error:', e));
    } else if (brevoKey) {
      const legacyBody = `Hi ${firstName},\n\nYour purchase is confirmed!\n\n— Jatin from Growth Escalators`;
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

  return { ok: true, status: 'processed', contactId: contact.id, stage };
}

/**
 * Pre-payment "pending" contact creation. Mirrors the fire-and-forget block
 * inside the original /create-order route. Used by the edge-queue drainer when
 * Vercel reports a checkout was kicked off.
 */
export async function recordPendingOrder(input: {
  name: string;
  email?: string;
  phone?: string;
  segment?: string;
  bump1?: boolean;
  bump2?: boolean;
  orderId: string;
  funnelSlug?: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}): Promise<void> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1);
  if (!tenant) return;

  const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
  if (input.email) channels.push({ channelType: 'email', channelValue: input.email, isPrimary: true });
  if (input.phone) channels.push({ channelType: 'whatsapp', channelValue: input.phone.startsWith('91') ? input.phone : `91${input.phone.replace(/\D/g, '')}` });

  const parts = input.name.trim().split(' ');
  await findOrCreateContact(tenant.id, {
    firstName: parts[0] ?? input.name,
    lastName: parts.slice(1).join(' ') || undefined,
    source: 'checkout',
    metadata: {
      segment: input.segment, bump1: input.bump1, bump2: input.bump2,
      orderId: input.orderId, paymentStatus: 'pending',
      funnelSlug: input.funnelSlug,
      utm_source: input.utm_source ?? null,
      utm_medium: input.utm_medium ?? null,
      utm_campaign: input.utm_campaign ?? null,
      utm_content: input.utm_content ?? null,
      utm_term: input.utm_term ?? null,
    },
    channels,
  });
}
