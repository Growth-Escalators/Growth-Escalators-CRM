// Shared payment-gateway contract for tenant subscription billing.
//
// WHY THIS EXISTS. Growth Escalators is reselling this CRM to other agencies
// (subscription billing, not the existing one-off D2C Cashfree checkout in
// src/routes/cashfree.ts — that's a different money path and out of scope
// here). Different tenants/platforms need different payment providers
// (Cashfree for India-first agencies, Razorpay as an alternative), so the
// provider must be pluggable per-tenant rather than hardcoded — "like an
// app/plugin", not a single vendor integration.
//
// This file is the ONLY shared contract two parallel PRs (the real Cashfree
// adapter and the real Razorpay adapter) import from — the exact path
// `src/services/paymentGateway/types.ts` is load-bearing, keep it stable.
// This PR (subscription-billing-core) registers mock/stub adapters against
// this same interface so the factory, routes, schema, and entitlement wiring
// are all testable before either real adapter lands.

/** Which payment gateway a tenant's plan/subscription is billed through. */
export type SubscriptionProvider = 'cashfree' | 'razorpay';

/**
 * A webhook event from any provider, normalized to a single shape so the
 * webhook route and the event processor never branch on provider.
 *
 * `amount`/`currency` are optional because not every event type carries a
 * charge (e.g. `subscription.cancelled` typically doesn't).
 */
export type NormalizedSubscriptionEvent = {
  type:
    | 'subscription.activated'
    | 'subscription.charged'
    | 'subscription.cancelled'
    | 'subscription.failed';
  providerSubscriptionId: string;
  /** In the currency's base unit (e.g. rupees, not paise) — never assume a subunit here. */
  amount?: number;
  /** ISO 4217, e.g. 'INR'. */
  currency?: string;
  raw: unknown;
};

/**
 * Implemented once per provider (cashfree, razorpay, ...) and registered
 * with the factory in ./index.ts. Every method is provider-specific
 * underneath, but callers (routes, services) only ever see this shape.
 */
export interface PaymentGatewayAdapter {
  readonly provider: SubscriptionProvider;

  createSubscription(params: {
    tenantId: string;
    planId: string;
    customerEmail: string;
    customerPhone?: string;
    returnUrl: string;
  }): Promise<{ providerSubscriptionId: string; authorizationUrl: string }>;

  cancelSubscription(providerSubscriptionId: string): Promise<void>;

  getSubscriptionStatus(
    providerSubscriptionId: string,
  ): Promise<'created' | 'active' | 'paused' | 'cancelled' | 'expired'>;

  /** Must return false (not throw) on a bad/missing signature — callers reject with 401 on false. */
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean;

  /** Only called after verifyWebhookSignature has returned true. */
  parseWebhookEvent(rawBody: string, headers: Record<string, string>): NormalizedSubscriptionEvent;
}
