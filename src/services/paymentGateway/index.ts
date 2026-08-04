export * from './types';
export { registerPaymentGatewayAdapter, getPaymentGatewayAdapter } from './registry';

// Side-effect imports: each adapter module registers itself with the
// registry above as soon as it's loaded. Registering a new/real provider
// adapter is: (1) write the module implementing PaymentGatewayAdapter with a
// self-registering call (see mockAdapter.ts), (2) add one import line here.
// getPaymentGatewayAdapter()'s lookup logic in registry.ts never changes.
//
// Both providers are now backed by their real adapters (see registry.ts's
// overwrite note — importing mockAdapter first and the real adapters second
// means the real ones win).
import './mockAdapter';
import './razorpayAdapter';
import './cashfreeAdapter';
