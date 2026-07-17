import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// validateMetaWebhook
// GET  — handles Meta's verification challenge
// POST — verifies X-Hub-Signature-256 HMAC-SHA256 signature
// ---------------------------------------------------------------------------
export function validateMetaWebhook(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET') {
    const verifyToken = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (verifyToken === process.env.META_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ error: 'invalid verify token' });
    }
    return;
  }

  // POST — verify HMAC signature. Fails CLOSED when the secret is unset —
  // silently accepting unverified inbound WhatsApp messages let anyone who
  // discovers the endpoint inject fabricated messages that create contacts
  // and emit socket events.
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[validateMetaWebhook] META_APP_SECRET not set — rejecting webhook');
    res.status(503).json({ error: 'webhook verification not configured' });
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    res.status(403).json({ error: 'missing X-Hub-Signature-256 header' });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(403).json({ error: 'raw body unavailable for signature verification' });
    return;
  }

  // Signed over the exact bytes Meta sent, not a re-serialization of the
  // parsed body — JSON.stringify(req.body) rarely reproduces the original
  // bytes (key order, whitespace, number formatting), so genuine Meta
  // signatures would fail against it while a same-shape forged payload with
  // no signature at all previously fell through to the fail-open branch above.
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');

  try {
    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
      res.status(403).json({ error: 'invalid signature' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'signature verification failed' });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// validateCashfreeWebhook
// Verifies Cashfree's Payment Gateway v2023-08-01 webhook signature:
//   signature = base64(HMAC-SHA256(timestamp + rawBody, secretKey))
// sent as the `x-webhook-signature` header, paired with `x-webhook-timestamp`.
// The webhook secret is the same client secret used for API auth
// (CASHFREE_SECRET_KEY) — Cashfree does not issue a separate webhook secret.
// Fails CLOSED: a missing secret means payments aren't functioning anyway
// (create-order would also fail), so there is no legitimate traffic to lose
// by rejecting unverifiable webhooks rather than accepting them.
// ---------------------------------------------------------------------------
export function validateCashfreeWebhook(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret) {
    console.error('[validateCashfreeWebhook] CASHFREE_SECRET_KEY not set — rejecting webhook');
    res.status(503).json({ error: 'payment webhook verification not configured' });
    return;
  }

  const signature = req.headers['x-webhook-signature'] as string | undefined;
  const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;
  if (!signature || !timestamp) {
    res.status(401).json({ error: 'missing webhook signature headers' });
    return;
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(401).json({ error: 'raw body unavailable for signature verification' });
    return;
  }

  const expected = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');

  try {
    const sigBuffer = Buffer.from(signature, 'base64');
    const expBuffer = Buffer.from(expected, 'base64');
    if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
      res.status(401).json({ error: 'invalid webhook signature' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'signature verification failed' });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// validateGenericWebhook
// Placeholder — add per-source validation logic here as needed
// ---------------------------------------------------------------------------
export function validateGenericWebhook(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
