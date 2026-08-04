export * from './types';
export { registerPaymentGatewayAdapter, getPaymentGatewayAdapter } from './registry';

// Side-effect imports: each adapter module registers itself with the
// registry above as soon as it's loaded. Registering a new/real provider
// adapter is: (1) write the module implementing PaymentGatewayAdapter with a
// self-registering call (see mockAdapter.ts), (2) add one import line here.
// getPaymentGatewayAdapter()'s lookup logic in registry.ts never changes.
//
// Both 'cashfree' and 'razorpay' are mock-backed for now — the real
// adapters land via two separate, parallel PRs and will re-register the
// same provider keys, replacing these entries (see registry.ts's overwrite
// note). That's an expected small reconciliation at merge time, not a bug.
import './mockAdapter';
