import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from '../_lib/cors.js';
import { verifyCashfreeWebhook } from '../_lib/cashfree.js';
import { enqueue, tryClaimWebhook, deadLetter } from '../_lib/queue.js';

// We need the raw body to verify Cashfree's signature. Vercel parses JSON by
// default; opting out lets us read the original bytes.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  let raw = '';
  try {
    raw = await readRawBody(req);
  } catch (e) {
    console.error('[edge webhook] body read failed:', e);
    res.status(400).json({ error: 'bad body' });
    return;
  }

  const ts = (req.headers['x-webhook-timestamp'] as string | undefined) ?? null;
  const sig = (req.headers['x-webhook-signature'] as string | undefined) ?? null;
  const secret = process.env.CASHFREE_WEBHOOK_SECRET;

  // If a secret is configured, signatures must check out. If unset (early
  // boot, sandbox testing), accept without verification but log loudly.
  if (secret) {
    if (!verifyCashfreeWebhook(raw, ts, sig, secret)) {
      console.warn('[edge webhook] signature mismatch — rejecting');
      res.status(401).json({ error: 'invalid signature' });
      return;
    }
  } else {
    console.warn('[edge webhook] CASHFREE_WEBHOOK_SECRET not set — accepting without verification');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: 'invalid json' });
    return;
  }

  const data = body.data as { payment?: { cf_payment_id?: string; payment_status?: string }; order?: { order_id?: string } } | undefined;
  const cfPaymentId = data?.payment?.cf_payment_id;
  const orderId = data?.order?.order_id;
  // Cashfree API v2023-08-01 sends `type`; older payloads / our tests use `event_type`.
  // Accept either; normalize on `type` for the queued payload so the drainer stays happy.
  const eventType = (body.type as string | undefined) ?? (body.event_type as string | undefined);
  const paymentStatus = data?.payment?.payment_status;
  if (eventType && !body.event_type) {
    (body as Record<string, unknown>).event_type = eventType;
  }

  console.log('[edge webhook] received', { eventType, paymentStatus, orderId, cfPaymentId });

  // Acknowledge non-success events immediately. Cashfree fires multiple event
  // types; only PAYMENT_SUCCESS_WEBHOOK needs CRM processing.
  if (eventType !== 'PAYMENT_SUCCESS_WEBHOOK' || paymentStatus !== 'SUCCESS') {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  if (!cfPaymentId) {
    res.status(200).json({ ok: true, ignored: true, reason: 'missing cf_payment_id' });
    return;
  }

  // Idempotency: claim the event in Redis before queuing. If it's already
  // claimed, ack 200 so Cashfree stops retrying.
  let claimed = false;
  try {
    claimed = await tryClaimWebhook(cfPaymentId);
  } catch (e) {
    console.error('[edge webhook] redis claim failed:', e);
    // Fall through — we'd rather double-deliver than lose the event. The CRM
    // drainer also dedupes via processed_events, so duplicates are harmless.
    claimed = true;
  }

  if (!claimed) {
    res.status(200).json({ ok: true, dedup: true });
    return;
  }

  try {
    await enqueue('cashfree_event', body, {
      receivedAt: new Date().toISOString(),
      ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim(),
      userAgent: req.headers['user-agent'],
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[edge webhook] enqueue failed:', msg);
    await deadLetter(`enqueue_failed: ${msg}`, body);
    // Still ack 200 — the DLQ has the event for replay; if we 5xx Cashfree
    // will retry which doesn't help us if Upstash is genuinely down.
    res.status(200).json({ ok: true, queued: false });
  }
}
