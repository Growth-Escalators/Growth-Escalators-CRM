import type { PaymentGatewayAdapter, SubscriptionProvider } from './types';
import logger from '../../utils/logger';

const registry = new Map<SubscriptionProvider, PaymentGatewayAdapter>();

/**
 * Called by an adapter module at import time (a side-effecting top-level
 * call in that module) to register itself. Adding a new/real provider
 * adapter is: (1) write a module that builds a PaymentGatewayAdapter and
 * calls this at load time, (2) add one side-effect import line in
 * ./index.ts. No other file changes — this lookup logic is never touched by
 * a new provider landing.
 *
 * Re-registering an already-registered provider is allowed (last wins) and
 * logged rather than thrown — this is how a real Cashfree/Razorpay adapter
 * (landing in a separate, parallel PR) replaces the mock adapter registered
 * for the same provider key today, without either module needing to know
 * about the other.
 */
export function registerPaymentGatewayAdapter(adapter: PaymentGatewayAdapter): void {
  if (registry.has(adapter.provider)) {
    logger.info(`[paymentGateway] replacing adapter registration for '${adapter.provider}'`);
  }
  registry.set(adapter.provider, adapter);
}

export function getPaymentGatewayAdapter(provider: SubscriptionProvider): PaymentGatewayAdapter {
  const adapter = registry.get(provider);
  if (!adapter) {
    throw new Error(`[paymentGateway] no adapter registered for provider '${provider}'`);
  }
  return adapter;
}

/** Test-only: clears all registrations so each test file controls exactly which fakes are registered. */
export function __resetPaymentGatewayRegistryForTests(): void {
  registry.clear();
}
