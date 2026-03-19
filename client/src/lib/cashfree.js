import { load } from '@cashfreepayments/cashfree-js';

let cashfreeInstance = null;

/**
 * Lazily initialize and return the Cashfree JS SDK instance.
 */
async function getCashfree() {
  if (!cashfreeInstance) {
    cashfreeInstance = await load({
      mode: import.meta.env.VITE_CASHFREE_ENV || 'sandbox',
    });
  }
  return cashfreeInstance;
}

/**
 * Open the Cashfree payment UI for the given session.
 * Redirects to returnUrl on success (handled by Cashfree).
 * @param {string} paymentSessionId
 * @returns {Promise<void>}
 */
export async function initiatePayment(paymentSessionId) {
  const cashfree = await getCashfree();
  return cashfree.checkout({ paymentSessionId });
}
