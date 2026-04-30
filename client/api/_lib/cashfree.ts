import crypto from 'node:crypto';

const CASHFREE_BASE =
  (process.env.CASHFREE_ENV || process.env.NODE_ENV) === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

export function cashfreeBaseUrl(): string {
  return CASHFREE_BASE;
}

export function cashfreeHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-client-id': process.env.CASHFREE_APP_ID ?? '',
    'x-client-secret': process.env.CASHFREE_SECRET_KEY ?? '',
    'x-api-version': '2023-08-01',
  };
}

/**
 * Cashfree webhook signature verification.
 * Cashfree sends `x-webhook-timestamp` and `x-webhook-signature` headers.
 * The signature is base64(HMAC-SHA256(secret, timestamp + rawBody)).
 *
 * Returns false on missing headers / mismatch / missing secret. The edge
 * function decides whether to reject (production) or accept (no secret set).
 */
export function verifyCashfreeWebhook(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret = process.env.CASHFREE_WEBHOOK_SECRET,
): boolean {
  if (!secret) return false;
  if (!timestamp || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
