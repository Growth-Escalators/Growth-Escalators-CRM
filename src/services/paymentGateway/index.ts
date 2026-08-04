export * from './types';
export { registerPaymentGatewayAdapter, getPaymentGatewayAdapter } from './registry';

// Side-effect imports: each adapter module registers itself with the
// registry above as soon as it's loaded. Registering a new/real provider
// adapter is: (1) write the module implementing PaymentGatewayAdapter with a
// self-registering call (see mockAdapter.ts), (2) add one import line here.
// getPaymentGatewayAdapter()'s lookup logic in registry.ts never changes.
//
// 'cashfree' is still mock-backed until its own adapter PR lands; 'razorpay'
// is now the real adapter (see registry.ts's overwrite note — importing
// mockAdapter first and razorpayAdapter second means the real one wins).
import './mockAdapter';
import './razorpayAdapter';
