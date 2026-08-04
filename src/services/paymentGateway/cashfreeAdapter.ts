// CashfreeSubscriptionAdapter — implements the shared PaymentGatewayAdapter
// contract (./types.ts) against Cashfree's SUBSCRIPTIONS API (recurring
// billing / mandates: https://www.cashfree.com/docs/api-reference/payments/latest/subscription/*).
//
// This is a DIFFERENT API surface from the existing one-off Orders integration
// in src/routes/cashfree.ts / src/services/cashfreeEventProcessor.ts:
//   - different base paths (/pg/subscriptions/* vs /pg/orders/*)
//   - different request/response field names (subscription_id, plan_details,
//     subscription_session_id, ... vs order_id, order_amount, payment_session_id)
//   - different webhook event types (SUBSCRIPTION_* vs PAYMENT_SUCCESS_WEBHOOK)
// Do not assume the two share fixtures, env vars, or webhook secrets.
//
// NOTE(verify-live): no live Cashfree Subscriptions merchant credentials exist
// for this product yet — this is scaffolding. Endpoint paths, field names, and
// the pinned x-api-version below follow Cashfree's currently published
// Subscriptions API docs and webhook payload samples (researched for this PR).
// Re-verify every endpoint against the live dashboard + a real sandbox
// subscription the first time real credentials are provisioned — see the PR
// description for the full go-live checklist. Two specific things flagged
// in-line below are the least certain and most likely to need correction:
//   1. the exact cancel/manage endpoint path (`cancelSubscription`)
//   2. the customer-facing `authorizationUrl` (`createSubscription`) — Cashfree
//      Subscriptions checkout is JS-SDK-driven (`cashfree.subscriptionsCheckout
//      ({ subsSessionId })` in-browser), NOT a bare hosted redirect URL the way
//      Razorpay's subscription `short_url` is. There is no Cashfree-published
//      URL format to redirect a customer to directly.
import { createHmac, timingSafeEqual } from 'crypto';
import logger from '../../utils/logger';
import type { NormalizedSubscriptionEvent, PaymentGatewayAdapter, SubscriptionProvider } from './types';
import { registerPaymentGatewayAdapter } from './registry';

const PROVIDER: SubscriptionProvider = 'cashfree';
const TIMEOUT_MS = 15_000;

// Cashfree versions the Subscriptions API by date, independent of the Orders
// API's x-api-version ('2023-08-01', pinned in src/routes/cashfree.ts). This is
// the version documented in Cashfree's currently published subscription
// webhook payload samples at the time this adapter was written — override via
// env if Cashfree deprecates it before real credentials exist.
const DEFAULT_API_VERSION = '2026-01-01';

export class CashfreeAdapterError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'CashfreeAdapterError';
  }
}

// ---------------------------------------------------------------------------
// Cashfree Subscriptions raw response/webhook shapes we read from.
// Kept intentionally loose (fields we don't use are omitted) — see Cashfree's
// docs for the full schema.
// ---------------------------------------------------------------------------
interface CreateSubscriptionResponse {
  cf_subscription_id?: string;
  subscription_id?: string;
  subscription_status?: string;
  subscription_session_id?: string;
}

interface GetSubscriptionResponse {
  subscription_status?: string;
}

interface SubscriptionWebhookBody {
  // Cashfree's Orders webhook has historically sent either `type` or the older
  // `event_type` (see cashfreeEventProcessor.ts) — the Subscriptions webhook
  // samples we found only show `type`, but we accept both defensively for the
  // same reason: a silent miss here means a subscription activates/charges/
  // cancels in Cashfree with the CRM never finding out.
  type?: string;
  event_type?: string;
  event_time?: string;
  data?: {
    subscription_details?: {
      cf_subscription_id?: string;
      subscription_id?: string;
      subscription_status?: string;
    };
    payment_amount?: number;
    payment_currency?: string;
    payment_status?: string;
  };
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function mapSubscriptionStatus(raw: string | undefined): 'created' | 'active' | 'paused' | 'cancelled' | 'expired' {
  switch ((raw ?? '').toUpperCase()) {
    case 'INITIALIZED':
    case 'CREATED':
    case 'BANK_APPROVAL_PENDING':
      return 'created';
    case 'ACTIVE':
      return 'active';
    case 'ON_HOLD':
    case 'PAUSED':
      return 'paused';
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled';
    // COMPLETED = the subscription ran its full course (max cycles reached) —
    // our shared enum has no distinct "completed" bucket, so it lands in
    // 'expired' (closest available meaning: no further charges will occur).
    case 'COMPLETED':
    case 'EXPIRED':
      return 'expired';
    default:
      // Fail loud rather than guess. Silently defaulting an unrecognized
      // Cashfree status to e.g. 'active' or 'cancelled' would misreport real
      // billing state to whatever calls getSubscriptionStatus.
      throw new CashfreeAdapterError(`unrecognized Cashfree subscription_status: ${String(raw)}`);
  }
}

export class CashfreeSubscriptionAdapter implements PaymentGatewayAdapter {
  readonly provider: SubscriptionProvider = PROVIDER;

  private credentials(): { appId: string; secretKey: string; apiVersion: string; base: string } {
    // Subscriptions credentials are looked up under their own env vars first,
    // falling back to the shared Orders credentials (CASHFREE_APP_ID /
    // CASHFREE_SECRET_KEY) — Cashfree Subscriptions is a separate product a
    // merchant enables independently, and Jatin may provision it with its own
    // API key pair. See PR description for what to configure before go-live.
    const appId = process.env.CASHFREE_SUBSCRIPTIONS_APP_ID ?? process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SUBSCRIPTIONS_SECRET_KEY ?? process.env.CASHFREE_SECRET_KEY;
    if (!appId || !secretKey) {
      throw new CashfreeAdapterError(
        'Cashfree Subscriptions credentials not configured (CASHFREE_SUBSCRIPTIONS_APP_ID / CASHFREE_SUBSCRIPTIONS_SECRET_KEY, or the shared CASHFREE_APP_ID / CASHFREE_SECRET_KEY)',
        503,
      );
    }
    const apiVersion = process.env.CASHFREE_SUBSCRIPTIONS_API_VERSION ?? DEFAULT_API_VERSION;
    const base = process.env.NODE_ENV === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    return { appId, secretKey, apiVersion, base };
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const { appId, secretKey, apiVersion, base } = this.credentials();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': appId,
          'x-client-secret': secretKey,
          'x-api-version': apiVersion,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const message = typeof json.message === 'string' ? json.message : `Cashfree ${method} ${path} → ${res.status}`;
        throw new CashfreeAdapterError(message, res.status);
      }
      return json as T;
    } catch (err) {
      if (err instanceof CashfreeAdapterError) throw err;
      throw new CashfreeAdapterError(`Cashfree request ${method} ${path} failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async createSubscription(params: {
    tenantId: string;
    planId: string;
    customerEmail: string;
    customerPhone?: string;
    returnUrl: string;
  }): Promise<{ providerSubscriptionId: string; authorizationUrl: string }> {
    // Merchant-generated subscription_id, scoped by tenant so subscription ids
    // for different tenants reselling this CRM can never collide inside the
    // single shared Cashfree merchant account. This is the id used as the path
    // param for status/cancel calls below, and is what we return as
    // providerSubscriptionId — Cashfree's own cf_subscription_id is a separate
    // internal reference we don't need to track.
    const subscriptionId = `GE_SUB_${params.tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const resp = await this.request<CreateSubscriptionResponse>('/pg/subscriptions', 'POST', {
      subscription_id: subscriptionId,
      customer_details: {
        // The shared contract doesn't carry a customer name (only email/phone).
        // Cashfree accepts customer_name as optional — derive a placeholder
        // from the email local-part so the request isn't blank; wire through a
        // real name if the core-schema contract grows one later.
        customer_name: params.customerEmail.split('@')[0] || 'Customer',
        customer_email: params.customerEmail,
        customer_phone: params.customerPhone ?? '',
      },
      plan_details: {
        plan_id: params.planId,
      },
      subscription_meta: {
        return_url: params.returnUrl,
      },
    });

    const providerSubscriptionId = resp.subscription_id ?? subscriptionId;
    const sessionId = resp.subscription_session_id;
    if (!sessionId) {
      throw new CashfreeAdapterError('Cashfree did not return a subscription_session_id');
    }

    // See file-header NOTE(verify-live) #2: Cashfree Subscriptions checkout is
    // SDK-driven, not a bare redirect link. We hand back a bridge URL into our
    // own frontend (not yet built as of this PR) that must load Cashfree's JS
    // SDK and call subscriptionsCheckout({ subsSessionId }) with this session
    // id. CASHFREE_SUBSCRIPTIONS_CHECKOUT_URL lets that bridge page live
    // anywhere without redeploying this adapter.
    const bridgeBase =
      process.env.CASHFREE_SUBSCRIPTIONS_CHECKOUT_URL ??
      `${process.env.FRONTEND_URL || 'https://web-production-311da.up.railway.app'}/billing/cashfree/authorize`;
    const authorizationUrl = `${bridgeBase}?subscription_session_id=${encodeURIComponent(sessionId)}&subscription_id=${encodeURIComponent(providerSubscriptionId)}`;

    return { providerSubscriptionId, authorizationUrl };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    // NOTE(verify-live) #1: Cashfree's "Manage Subscription" endpoint is the
    // documented generic lifecycle-management call (cancel/pause/activate/
    // change-plan all go through it with a different `action`). Some Cashfree
    // doc surfaces also reference a narrower dedicated .../cancel shortcut —
    // confirm which one the live account actually accepts before go-live.
    await this.request(`/pg/subscriptions/${encodeURIComponent(providerSubscriptionId)}/manage`, 'POST', {
      subscription_id: providerSubscriptionId,
      action: 'CANCEL',
    });
  }

  async getSubscriptionStatus(providerSubscriptionId: string): Promise<'created' | 'active' | 'paused' | 'cancelled' | 'expired'> {
    const resp = await this.request<GetSubscriptionResponse>(
      `/pg/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      'GET',
    );
    return mapSubscriptionStatus(resp.subscription_status);
  }

  // ---------------------------------------------------------------------------
  // verifyWebhookSignature
  // Cashfree Subscriptions webhooks are signed the same way Cashfree signs its
  // v2023-08-01+ Orders webhooks (see src/middleware/validateWebhook.ts
  // validateCashfreeWebhook, which this mirrors):
  //   signature = base64(HMAC-SHA256(timestamp + rawBody, secretKey))
  // sent as `x-webhook-signature`, paired with `x-webhook-timestamp`.
  // The secret is intentionally a DIFFERENT env var from the Orders webhook
  // secret (CASHFREE_SECRET_KEY) — Cashfree lets a merchant configure a
  // separate webhook secret per registered endpoint in the dashboard, and
  // Subscriptions webhooks are registered at a different URL than the Orders
  // webhook, so assume a different secret until proven otherwise.
  // Fails CLOSED on any missing input (secret / headers / rawBody) — see
  // CLAUDE.md guardrails: a forged subscription webhook here would let an
  // attacker fabricate subscription.activated/charged events.
  // ---------------------------------------------------------------------------
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    const secret = process.env.CASHFREE_SUBSCRIPTIONS_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('[cashfreeSubscriptionAdapter] CASHFREE_SUBSCRIPTIONS_WEBHOOK_SECRET not set — rejecting webhook (fails closed)');
      return false;
    }

    const signature = getHeader(headers, 'x-webhook-signature');
    const timestamp = getHeader(headers, 'x-webhook-timestamp');
    if (!signature || !timestamp || !rawBody) return false;

    const expected = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');

    try {
      const sigBuffer = Buffer.from(signature, 'base64');
      const expBuffer = Buffer.from(expected, 'base64');
      return sigBuffer.length === expBuffer.length && timingSafeEqual(sigBuffer, expBuffer);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawBody: string, _headers: Record<string, string>): NormalizedSubscriptionEvent {
    let body: SubscriptionWebhookBody;
    try {
      body = JSON.parse(rawBody) as SubscriptionWebhookBody;
    } catch {
      throw new CashfreeAdapterError('webhook body is not valid JSON');
    }

    const eventType = body.type ?? body.event_type;
    const sub = body.data?.subscription_details;
    const providerSubscriptionId = sub?.subscription_id ?? sub?.cf_subscription_id;
    if (!providerSubscriptionId) {
      throw new CashfreeAdapterError(`webhook missing subscription id (type=${String(eventType)})`);
    }

    switch (eventType) {
      case 'SUBSCRIPTION_PAYMENT_SUCCESS':
        return {
          type: 'subscription.charged',
          providerSubscriptionId,
          amount: body.data?.payment_amount,
          currency: body.data?.payment_currency,
          raw: body,
        };

      case 'SUBSCRIPTION_PAYMENT_FAILED':
        return {
          type: 'subscription.failed',
          providerSubscriptionId,
          amount: body.data?.payment_amount,
          currency: body.data?.payment_currency,
          raw: body,
        };

      case 'SUBSCRIPTION_STATUS_CHANGED': {
        const status = (sub?.subscription_status ?? '').toUpperCase();
        if (status === 'ACTIVE') {
          return { type: 'subscription.activated', providerSubscriptionId, raw: body };
        }
        if (status === 'CANCELLED' || status === 'CANCELED') {
          return { type: 'subscription.cancelled', providerSubscriptionId, raw: body };
        }
        // Other statuses this event can carry (INITIALIZED, BANK_APPROVAL_PENDING,
        // ON_HOLD, PAUSED, EXPIRED, COMPLETED, ...) don't map cleanly onto our
        // 4-value NormalizedSubscriptionEvent.type — fail loud instead of
        // guessing which bucket they belong in.
        throw new CashfreeAdapterError(`unhandled SUBSCRIPTION_STATUS_CHANGED status: ${status}`);
      }

      default:
        throw new CashfreeAdapterError(`unrecognized Cashfree subscription webhook type: ${String(eventType)}`);
    }
  }
}

export default CashfreeSubscriptionAdapter;

// Self-registers at import time (see registry.ts's overwrite note), replacing
// the mock adapter mockAdapter.ts registered for 'cashfree'. Config is
// resolved lazily per-call, so constructing this eagerly here is safe even
// before Cashfree Subscriptions credentials are set — it only throws once an
// operation is actually invoked.
registerPaymentGatewayAdapter(new CashfreeSubscriptionAdapter());
