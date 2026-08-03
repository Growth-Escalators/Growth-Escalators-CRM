import { randomUUID } from 'crypto';
import { registerPaymentGatewayAdapter } from './registry';
import type {
  PaymentGatewayAdapter,
  SubscriptionProvider,
  NormalizedSubscriptionEvent,
} from './types';

/**
 * Stub adapter used for BOTH 'cashfree' and 'razorpay' until their real
 * adapters land in two separate, parallel PRs. Exists so the factory,
 * routes, schema, and entitlement wiring built in this PR are fully
 * testable without depending on either provider's real API/SDK.
 *
 * Deliberately simple: deterministic fake ids, a fixed test-only "signature"
 * scheme (`x-mock-signature: valid:<provider>`), and a status that always
 * reports 'active' post-creation. NOT a security mechanism — this adapter
 * never touches real money or a real webhook endpoint.
 *
 * A real adapter module replaces this at the same provider key via
 * registerPaymentGatewayAdapter (see registry.ts's overwrite note) — that
 * reconciliation happens in the real-Cashfree / real-Razorpay PRs, not here.
 */
export function createMockAdapter(provider: SubscriptionProvider): PaymentGatewayAdapter {
  return {
    provider,

    async createSubscription(params) {
      const providerSubscriptionId = `mock_${provider}_sub_${randomUUID()}`;
      return {
        providerSubscriptionId,
        authorizationUrl: `https://mock-${provider}.example.test/authorize/${providerSubscriptionId}?returnUrl=${encodeURIComponent(params.returnUrl)}`,
      };
    },

    async cancelSubscription(_providerSubscriptionId: string) {
      // no-op — the mock keeps no external state to cancel.
    },

    async getSubscriptionStatus(_providerSubscriptionId: string) {
      return 'active' as const;
    },

    verifyWebhookSignature(_rawBody: string, headers: Record<string, string>): boolean {
      return headers['x-mock-signature'] === `valid:${provider}`;
    },

    parseWebhookEvent(rawBody: string, _headers: Record<string, string>): NormalizedSubscriptionEvent {
      const parsed = JSON.parse(rawBody) as {
        type: NormalizedSubscriptionEvent['type'];
        providerSubscriptionId: string;
        amount?: number;
        currency?: string;
      };
      return {
        type: parsed.type,
        providerSubscriptionId: parsed.providerSubscriptionId,
        amount: parsed.amount,
        currency: parsed.currency,
        raw: parsed,
      };
    },
  };
}

registerPaymentGatewayAdapter(createMockAdapter('cashfree'));
registerPaymentGatewayAdapter(createMockAdapter('razorpay'));
