import { Router, type Request, type Response } from 'express';
import { getPaymentGatewayAdapter } from '../services/paymentGateway';
import type { SubscriptionProvider } from '../services/paymentGateway/types';
import { processSubscriptionEvent } from '../services/subscriptionEventProcessor';
import logger from '../utils/logger';

const router = Router();

const VALID_PROVIDERS: SubscriptionProvider[] = ['cashfree', 'razorpay'];
function isValidProvider(value: unknown): value is SubscriptionProvider {
  return typeof value === 'string' && (VALID_PROVIDERS as string[]).includes(value);
}

function normalizeHeaders(headers: Request['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value[0] ?? '';
  }
  return out;
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/subscriptions/:provider
//
// Provider-agnostic: loads the right PaymentGatewayAdapter by the :provider
// URL param, verifies the signature BEFORE parsing or processing anything —
// an unverified body is never trusted, same posture as
// middleware/validateWebhook.ts's validateCashfreeWebhook — then hands the
// normalized event to processSubscriptionEvent for idempotent handling.
//
// Relies on req.rawBody, populated globally by the express.json() `verify`
// callback already wired in index.ts (the same mechanism
// validateCashfreeWebhook depends on) — no express.raw() needed on this
// route specifically.
// ---------------------------------------------------------------------------
router.post('/:provider', async (req: Request, res: Response) => {
  const providerParam = req.params.provider;
  if (!isValidProvider(providerParam)) {
    res.status(400).json({ error: `unknown provider '${providerParam}'` });
    return;
  }
  const provider = providerParam;

  const rawBody = req.rawBody;
  if (!rawBody) {
    res.status(401).json({ error: 'raw body unavailable for signature verification' });
    return;
  }

  let adapter;
  try {
    adapter = getPaymentGatewayAdapter(provider);
  } catch (err) {
    logger.error(`[subscription-webhook] no adapter registered for ${provider}:`, err);
    res.status(503).json({ error: 'provider not configured' });
    return;
  }

  const headers = normalizeHeaders(req.headers);

  // Reject BEFORE parsing/processing — an unverified body must never reach
  // parseWebhookEvent or processSubscriptionEvent.
  if (!adapter.verifyWebhookSignature(rawBody, headers)) {
    res.status(401).json({ error: 'invalid webhook signature' });
    return;
  }

  try {
    const event = adapter.parseWebhookEvent(rawBody, headers);
    const result = await processSubscriptionEvent(provider, rawBody, event);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[subscription-webhook] ${provider} processing error:`, msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
