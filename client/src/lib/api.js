/**
 * Frontend API client.
 * All calls go to /api/* which Vite proxies to the backend in dev,
 * and the Express server handles directly in production.
 */

/**
 * Create a new order.
 * @param {{ customer: {name, email, phone}, items: string[], utmParams: object }} payload
 * @returns {Promise<{ order_id: string, payment_session_id: string, order_total: number }>}
 */
export async function createOrder(payload) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    const message =
      data.errors?.map((e) => e.message).join(', ') ||
      data.error ||
      'Order creation failed';
    throw new Error(message);
  }

  return data;
}

/**
 * Fetch order status by order ID.
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export async function getOrder(orderId) {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) throw new Error('Order not found');
  return res.json();
}
