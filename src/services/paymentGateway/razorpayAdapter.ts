// Razorpay Subscriptions adapter — implements the shared PaymentGatewayAdapter
// contract (./types.ts) using Razorpay's Subscriptions REST API directly
// (no `razorpay` npm SDK), matching this repo's existing convention for
// payment-gateway integrations: the Cashfree integration
// (src/routes/cashfree.ts, src/services/cashfreeEventProcessor.ts) also
// calls its API with plain `fetch` rather than a vendor SDK.
//
// NOTE(verify-live): no Razorpay account/credentials exist for this product
// yet (this PR is scaffolding — see PR description). Endpoint paths, request
// shapes, and webhook payload shapes below follow Razorpay's documented
// Subscriptions API as of Aug 2026. Nothing here has been exercised against
// a live Razorpay account; re-verify against a real sandbox subscription
// before going live (docs/decisions or a TEST_PLAN entry should record that
// verification once it happens).
import { createHmac, timingSafeEqual } from 'crypto';
import type { NormalizedSubscriptionEvent, PaymentGatewayAdapter, SubscriptionProvider } from './types';
import { registerPaymentGatewayAdapter } from './registry';

const NAME: SubscriptionProvider = 'razorpay';
const API_BASE = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 15_000;

// Razorpay subscriptions always require a finite `total_count` (number of
// billing cycles) — there is no native "bill until cancelled" option. Until
// the core plan model (feat/subscription-billing-core) exposes a billing
// interval/period we can compute an exact cycle count from, default to a
// large-but-finite number of cycles so a subscription renews for years
// before naturally completing; cancellation before then is expected to be
// the normal path (via cancelSubscription), not running out total_count.
// Revisit once plans carry interval/period.
const DEFAULT_TOTAL_COUNT = 120;

export class RazorpayAdapterError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(`[razorpay] ${message}`);
    this.name = 'RazorpayAdapterError';
    this.statusCode = statusCode;
  }
}

// Thrown by parseWebhookEvent for Razorpay events that have no corresponding
// NormalizedSubscriptionEvent type: subscription-lifecycle events the shared
// contract doesn't model (authenticated, pending, paused, resumed, completed,
// updated), and payment.failed events not tied to a subscription. Callers
// should catch this specifically, log it, and 200-ack the webhook (Razorpay
// retries non-2xx responses) rather than surface it as a processing failure.
export class UnsupportedRazorpayWebhookEventError extends Error {
  readonly event: string;
  constructor(event: string) {
    super(`[razorpay] unsupported/unmapped webhook event: ${event}`);
    this.name = 'UnsupportedRazorpayWebhookEventError';
    this.event = event;
  }
}

// Mirrors the phone-normalization invariant in AGENTS.md (strip non-digits,
// prefix `91` if missing) without importing contactService — this module has
// no business depending on CRM contact tables, it just needs a sane value for
// Razorpay's notify_info.notify_phone.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('91') ? digits : `91${digits}`;
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

// Razorpay's actual subscription status values (created, authenticated,
// active, pending, halted, cancelled, completed, expired) don't map 1:1 onto
// the shared contract's narrower set — collapse them deliberately rather than
// silently. Fails CLOSED on a genuinely unrecognized value: guessing wrong in
// either direction (treating a cancelled sub as active, or vice versa) is a
// billing-correctness bug, so surface it instead of masking it.
function mapStatus(raw: string): 'created' | 'active' | 'paused' | 'cancelled' | 'expired' {
  switch (raw) {
    case 'created':
    case 'authenticated': // customer authorized the mandate; first charge not yet made
      return 'created';
    case 'active':
    case 'pending': // an auto-charge failed and is being retried; mandate is still live
      return 'active';
    case 'halted': // retries exhausted; billing paused until the customer fixes payment method
      return 'paused';
    case 'cancelled':
      return 'cancelled';
    case 'completed': // all total_count cycles billed — no further charges will occur
    case 'expired': // authorization link expired before the customer completed checkout
      return 'expired';
    default:
      throw new RazorpayAdapterError(`unrecognized subscription status from Razorpay: "${raw}"`);
  }
}

export class RazorpaySubscriptionAdapter implements PaymentGatewayAdapter {
  readonly provider: SubscriptionProvider = NAME;

  private config(): { keyId: string; keySecret: string } {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      throw new RazorpayAdapterError('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured', 503);
    }
    return { keyId, keySecret };
  }

  private async request<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const { keyId, keySecret } = this.config();
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const detail = json?.error?.description ?? text.slice(0, 200);
        throw new RazorpayAdapterError(`${opts.method ?? 'GET'} ${path} → ${res.status} ${detail}`, res.status >= 500 ? 502 : res.status);
      }
      return json as T;
    } catch (err) {
      if (err instanceof RazorpayAdapterError) throw err;
      throw new RazorpayAdapterError(`request ${path} failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // POST /subscriptions — https://api.razorpay.com/v1/subscriptions. Requires
  // a pre-existing Razorpay Plan (plan_id); this adapter does not create
  // plans, it only links to one that must already exist in the Razorpay
  // dashboard/API per our internal billing plan. customer_notify=1 +
  // notify_info tells Razorpay to email/SMS the customer the checkout link
  // itself as a fallback; we still return short_url so the caller can send
  // the customer there directly (e.g. via returnUrl-aware redirect).
  async createSubscription(params: {
    tenantId: string;
    planId: string;
    customerEmail: string;
    customerPhone?: string;
    returnUrl: string;
  }): Promise<{ providerSubscriptionId: string; authorizationUrl: string }> {
    const notifyPhone = params.customerPhone ? normalizePhone(params.customerPhone) : '';
    const resp: any = await this.request('/subscriptions', {
      method: 'POST',
      body: {
        plan_id: params.planId,
        total_count: DEFAULT_TOTAL_COUNT,
        quantity: 1,
        customer_notify: 1,
        notify_info: {
          notify_email: params.customerEmail.trim().toLowerCase(),
          ...(notifyPhone ? { notify_phone: notifyPhone } : {}),
        },
        // Razorpay has no first-class "return URL" field on subscriptions
        // (unlike Cashfree orders) — short_url is a Razorpay-hosted page, not
        // a redirect target we control. Stash returnUrl in notes so whichever
        // caller handles the post-authorization webhook/redirect can look it
        // back up against providerSubscriptionId.
        notes: { tenant_id: params.tenantId, return_url: params.returnUrl },
      },
    });
    const providerSubscriptionId = String(resp?.id ?? '');
    const authorizationUrl = String(resp?.short_url ?? '');
    if (!providerSubscriptionId || !authorizationUrl) {
      throw new RazorpayAdapterError('createSubscription returned no id/short_url');
    }
    return { providerSubscriptionId, authorizationUrl };
  }

  // POST /subscriptions/:id/cancel. cancel_at_cycle_end:0 forces immediate
  // cancellation — the interface gives callers no way to request "cancel at
  // period end", so immediate is the only faithful behavior for a bare
  // cancelSubscription(id) call.
  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`, {
      method: 'POST',
      body: { cancel_at_cycle_end: 0 },
    });
  }

  // GET /subscriptions/:id
  async getSubscriptionStatus(providerSubscriptionId: string): Promise<'created' | 'active' | 'paused' | 'cancelled' | 'expired'> {
    const resp: any = await this.request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
    return mapStatus(String(resp?.status ?? ''));
  }

  // Razorpay signs the exact raw request body — HMAC-SHA256, hex digest,
  // keyed with the webhook secret configured against this specific webhook
  // endpoint in the Razorpay dashboard (a DIFFERENT secret from the API key
  // pair used for createSubscription/etc — Razorpay does not reuse
  // RAZORPAY_KEY_SECRET for webhooks). Sent as `X-Razorpay-Signature`.
  // Fails CLOSED when the secret is unset or the header is missing/malformed:
  // there is no legitimate traffic to lose by rejecting an unverifiable
  // webhook on a billing-critical endpoint.
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret) {
      console.error('[razorpayAdapter] RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook');
      return false;
    }

    const signature = getHeader(headers, 'x-razorpay-signature');
    if (!signature) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      const sigBuffer = Buffer.from(signature, 'hex');
      const expBuffer = Buffer.from(expected, 'hex');
      return sigBuffer.length === expBuffer.length && timingSafeEqual(sigBuffer, expBuffer);
    } catch {
      return false;
    }
  }

  // Maps Razorpay's subscription/payment webhook events onto the shared
  // NormalizedSubscriptionEvent union. The payload for every subscription
  // event carries `payload.subscription.entity`; some (notably
  // subscription.charged) also carry `payload.payment.entity` for the
  // specific charge attempt — amount there is in paise, converted to rupees
  // per the contract's base-unit convention.
  //
  // Razorpay emits more subscription-lifecycle events than the shared
  // contract has slots for (authenticated, pending, paused, resumed,
  // completed, updated) — those throw UnsupportedRazorpayWebhookEventError
  // rather than being force-fit into the wrong bucket. subscription.halted
  // and a subscription-linked payment.failed both map to
  // 'subscription.failed' per the shared contract's four event types.
  parseWebhookEvent(rawBody: string, _headers: Record<string, string>): NormalizedSubscriptionEvent {
    const body = JSON.parse(rawBody);
    const event: string = body?.event ?? '';
    const subscriptionEntity = body?.payload?.subscription?.entity;
    const paymentEntity = body?.payload?.payment?.entity;

    const amount = typeof paymentEntity?.amount === 'number' ? paymentEntity.amount / 100 : undefined;
    const currency = paymentEntity?.currency ? String(paymentEntity.currency).toUpperCase() : undefined;

    const subscriptionEventType = (): 'subscription.activated' | 'subscription.charged' | 'subscription.cancelled' | 'subscription.failed' | undefined => {
      switch (event) {
        case 'subscription.activated': return 'subscription.activated';
        case 'subscription.charged': return 'subscription.charged';
        case 'subscription.cancelled': return 'subscription.cancelled';
        case 'subscription.halted': return 'subscription.failed';
        default: return undefined;
      }
    };

    const mappedType = subscriptionEventType();
    if (mappedType) {
      const id = String(subscriptionEntity?.id ?? '');
      if (!id) throw new RazorpayAdapterError(`${event} webhook missing payload.subscription.entity.id`);
      return { type: mappedType, providerSubscriptionId: id, amount, currency, raw: body };
    }

    if (event === 'payment.failed') {
      // Only relevant to subscription billing if this failed payment was an
      // auto-charge attempt against a subscription; a failed one-off payment
      // has no subscription to report against.
      const id = paymentEntity?.subscription_id ? String(paymentEntity.subscription_id) : '';
      if (!id) throw new UnsupportedRazorpayWebhookEventError(`${event} (no subscription_id — not a subscription charge)`);
      return { type: 'subscription.failed', providerSubscriptionId: id, amount, currency, raw: body };
    }

    throw new UnsupportedRazorpayWebhookEventError(event || '(missing event field)');
  }
}

// Self-registers at import time (see registry.ts's overwrite note), replacing
// the mock adapter mockAdapter.ts registered for 'razorpay'. Config is
// resolved lazily per-call (see config() above), so constructing this
// eagerly here is safe even before RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are
// set — it only throws once an operation is actually invoked.
registerPaymentGatewayAdapter(new RazorpaySubscriptionAdapter());
