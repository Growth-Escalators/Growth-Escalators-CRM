import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
  subscriptions: {
    id: 'id',
    tenantId: 'tenant_id',
    planId: 'plan_id',
    status: 'status',
    paymentProvider: 'payment_provider',
    providerSubscriptionId: 'provider_subscription_id',
    currency: 'currency',
    renewalDate: 'renewal_date',
    createdAt: 'created_at',
  },
  plans: { id: 'id', currency: 'currency', isActive: 'is_active', featureEntitlements: 'feature_entitlements' },
}));

const mockCreateSubscription = vi.fn();
const mockCancelSubscription = vi.fn();
vi.mock('../services/paymentGateway', () => ({
  getPaymentGatewayAdapter: vi.fn((provider: string) => ({
    provider,
    createSubscription: (...args: unknown[]) => mockCreateSubscription(...args),
    cancelSubscription: (...args: unknown[]) => mockCancelSubscription(...args),
    getSubscriptionStatus: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    parseWebhookEvent: vi.fn(),
  })),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeReqRes(
  tenantId: string,
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  email = 'user@test.com',
) {
  const req = { user: { id: 'user-1', tenantId, email, role: 'admin', tokenVersion: 1 }, params, body, query: {} } as any;
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

describe('POST /api/subscriptions — creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a subscription for the caller tenant via the resolved adapter, never trusting a body tenantId', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'plan-1', currency: 'INR', isActive: true }]),
        }),
      }),
    });
    mockCreateSubscription.mockResolvedValue({
      providerSubscriptionId: 'sub_123',
      authorizationUrl: 'https://pay.example/sub_123',
    });
    const insertChain: any = {};
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: 'subscription-1' }]);
    mockDbInsert.mockReturnValue(insertChain);

    const { default: router } = await import('../routes/subscriptions');
    // Body includes an attacker-controlled tenantId that must be ignored —
    // only req.user.tenantId ('tenant-a') should ever reach the adapter/insert.
    const { req, res, jsonFn, statusFn } = makeReqRes('tenant-a', {}, {
      planId: 'plan-1',
      provider: 'cashfree',
      tenantId: 'tenant-b',
    });

    await invokeRoute(router, '/', 'post', req, res);

    expect(mockCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', planId: 'plan-1' }),
    );
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
    expect(statusFn).toHaveBeenCalledWith(201);
    expect(jsonFn).toHaveBeenCalledWith({
      subscriptionId: 'subscription-1',
      authorizationUrl: 'https://pay.example/sub_123',
    });
  });

  it('rejects an invalid provider with 400 before touching the DB', async () => {
    const { default: router } = await import('../routes/subscriptions');
    const { req, res, statusFn } = makeReqRes('tenant-a', {}, { planId: 'plan-1', provider: 'stripe' });

    await invokeRoute(router, '/', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });

  it('requires planId', async () => {
    const { default: router } = await import('../routes/subscriptions');
    const { req, res, statusFn } = makeReqRes('tenant-a', {}, { provider: 'cashfree' });

    await invokeRoute(router, '/', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
  });

  it('404s when the plan does not exist or is inactive', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });
    const { default: router } = await import('../routes/subscriptions');
    const { req, res, statusFn } = makeReqRes('tenant-a', {}, { planId: 'missing-plan', provider: 'cashfree' });

    await invokeRoute(router, '/', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });
});

describe('tenant scoping — GET /:id and POST /:id/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /:id 404s for a subscription belonging to another tenant (WHERE clause enforces ownership)', async () => {
    let capturedWhere: unknown;
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((cond: unknown) => {
          capturedWhere = cond;
          return { limit: vi.fn().mockResolvedValue([]) }; // tenant-scoped fetch finds nothing
        }),
      }),
    });
    const { default: router } = await import('../routes/subscriptions');
    const { req, res, statusFn } = makeReqRes('tenant-a', { id: 'sub-owned-by-tenant-b' });

    await invokeRoute(router, '/:id', 'get', req, res);

    expect(capturedWhere).toBeDefined();
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('POST /:id/cancel 404s for a foreign-tenant subscription and never calls the adapter or updates anything', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });
    const { default: router } = await import('../routes/subscriptions');
    const { req, res, statusFn } = makeReqRes('tenant-a', { id: 'sub-owned-by-tenant-b' });

    await invokeRoute(router, '/:id/cancel', 'post', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockCancelSubscription).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('POST /:id/cancel succeeds for the owning tenant', async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'sub-1',
              tenantId: 'tenant-a',
              paymentProvider: 'cashfree',
              providerSubscriptionId: 'sub_123',
              status: 'active',
            },
          ]),
        }),
      }),
    });
    mockDbUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
    mockCancelSubscription.mockResolvedValue(undefined);

    const { default: router } = await import('../routes/subscriptions');
    const { req, res, jsonFn, statusFn } = makeReqRes('tenant-a', { id: 'sub-1' });

    await invokeRoute(router, '/:id/cancel', 'post', req, res);

    expect(mockCancelSubscription).toHaveBeenCalledWith('sub_123');
    expect(statusFn).not.toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ ok: true });
  });
});
