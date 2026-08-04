import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPaymentGatewayAdapter = vi.fn();
vi.mock('../services/paymentGateway', () => ({
  getPaymentGatewayAdapter: (...args: unknown[]) => mockGetPaymentGatewayAdapter(...args),
}));

const mockProcessSubscriptionEvent = vi.fn();
vi.mock('../services/subscriptionEventProcessor', () => ({
  processSubscriptionEvent: (...args: unknown[]) => mockProcessSubscriptionEvent(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeReqRes(provider: string, rawBody: string | undefined, headers: Record<string, string> = {}) {
  const req = { params: { provider }, rawBody, headers } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    let nextErr: unknown;
    await item.handle(req, res, (err?: unknown) => {
      nextCalled = true;
      nextErr = err;
    });
    if (nextErr) throw nextErr;
    if (!nextCalled) break;
  }
}

describe('POST /api/webhooks/subscriptions/:provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400s for an unknown provider without ever resolving an adapter', async () => {
    const { default: router } = await import('../routes/subscriptionWebhooks');
    const { req, res, statusFn } = makeReqRes(
      'stripe',
      JSON.stringify({ type: 'subscription.activated', providerSubscriptionId: 'x' }),
    );

    await invokeRoute(router, '/:provider', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockGetPaymentGatewayAdapter).not.toHaveBeenCalled();
    expect(mockProcessSubscriptionEvent).not.toHaveBeenCalled();
  });

  it('401s when the raw body is unavailable for signature verification', async () => {
    const { default: router } = await import('../routes/subscriptionWebhooks');
    const { req, res, statusFn } = makeReqRes('cashfree', undefined);

    await invokeRoute(router, '/:provider', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(mockGetPaymentGatewayAdapter).not.toHaveBeenCalled();
  });

  it('rejects with 401 when verifyWebhookSignature returns false — never parses or processes the event', async () => {
    const verifyWebhookSignature = vi.fn().mockReturnValue(false);
    const parseWebhookEvent = vi.fn();
    mockGetPaymentGatewayAdapter.mockReturnValue({ provider: 'cashfree', verifyWebhookSignature, parseWebhookEvent });

    const { default: router } = await import('../routes/subscriptionWebhooks');
    const rawBody = JSON.stringify({ type: 'subscription.activated', providerSubscriptionId: 'sub_1' });
    const { req, res, statusFn } = makeReqRes('cashfree', rawBody, { 'x-mock-signature': 'wrong' });

    await invokeRoute(router, '/:provider', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(parseWebhookEvent).not.toHaveBeenCalled();
    expect(mockProcessSubscriptionEvent).not.toHaveBeenCalled();
  });

  it('accepts a validly-signed payload, parses it, and hands the normalized event to processSubscriptionEvent', async () => {
    const rawBody = JSON.stringify({ type: 'subscription.activated', providerSubscriptionId: 'sub_1' });
    const normalizedEvent = {
      type: 'subscription.activated',
      providerSubscriptionId: 'sub_1',
      raw: JSON.parse(rawBody),
    };
    const verifyWebhookSignature = vi.fn().mockReturnValue(true);
    const parseWebhookEvent = vi.fn().mockReturnValue(normalizedEvent);
    mockGetPaymentGatewayAdapter.mockReturnValue({ provider: 'cashfree', verifyWebhookSignature, parseWebhookEvent });
    mockProcessSubscriptionEvent.mockResolvedValue({
      ok: true,
      status: 'processed',
      subscriptionId: 'sub-row-1',
      newStatus: 'active',
    });

    const { default: router } = await import('../routes/subscriptionWebhooks');
    const { req, res, jsonFn, statusFn } = makeReqRes('cashfree', rawBody, { 'x-mock-signature': 'valid:cashfree' });

    await invokeRoute(router, '/:provider', 'post', req, res);

    expect(verifyWebhookSignature).toHaveBeenCalledWith(rawBody, expect.objectContaining({ 'x-mock-signature': 'valid:cashfree' }));
    expect(parseWebhookEvent).toHaveBeenCalledWith(rawBody, expect.objectContaining({ 'x-mock-signature': 'valid:cashfree' }));
    expect(mockProcessSubscriptionEvent).toHaveBeenCalledWith('cashfree', rawBody, normalizedEvent);
    expect(statusFn).not.toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith({
      ok: true,
      status: 'processed',
      subscriptionId: 'sub-row-1',
      newStatus: 'active',
    });
  });

  it('500s and reports the error when processSubscriptionEvent throws (so the provider retries)', async () => {
    const rawBody = JSON.stringify({ type: 'subscription.charged', providerSubscriptionId: 'sub_1' });
    mockGetPaymentGatewayAdapter.mockReturnValue({
      provider: 'razorpay',
      verifyWebhookSignature: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        type: 'subscription.charged',
        providerSubscriptionId: 'sub_1',
        raw: JSON.parse(rawBody),
      }),
    });
    mockProcessSubscriptionEvent.mockRejectedValue(new Error('db blip'));

    const { default: router } = await import('../routes/subscriptionWebhooks');
    const { req, res, statusFn } = makeReqRes('razorpay', rawBody, { 'x-mock-signature': 'valid:razorpay' });

    await invokeRoute(router, '/:provider', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(500);
  });
});
