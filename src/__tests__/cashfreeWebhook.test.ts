import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock database module
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
  tenants: { id: 'id', slug: 'slug' },
  deals: {},
  contacts: { id: 'id' },
  processedEvents: { eventId: 'event_id' },
  events: {},
}));

// Mock services
vi.mock('../services/contactService', () => ({
  findOrCreateContact: vi.fn().mockResolvedValue({
    contact: { id: 'contact-uuid-123', firstName: 'Test', lastName: 'User' },
    channels: [],
    created: true,
  }),
}));

vi.mock('../services/metaCapi', () => ({
  sendPurchaseEvent: vi.fn().mockResolvedValue({ success: true, eventId: 'evt-123' }),
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/funnelConfigService', () => ({
  getFunnelConfig: vi.fn().mockResolvedValue(null),
  stageForAmount: vi.fn().mockReturnValue('paid_9'),
  labelForStage: vi.fn().mockReturnValue('D2C Funnel Breakdown Pack'),
  renderTemplate: vi.fn((tpl: string) => tpl),
}));

vi.mock('../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helper to create mock req/res
// ---------------------------------------------------------------------------
function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'test-agent' },
    socket: { remoteAddress: '127.0.0.1' },
  } as any;

  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;

  return { req, res, jsonFn, statusFn };
}

function makeSuccessWebhookBody(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: {
        order_id: 'GE_TEST_123',
        order_amount: 9,
        order_meta: { segment: 'd2c', bump1: false, bump2: false, funnelSlug: 'ecom', ...overrides },
      },
      payment: {
        payment_status: 'SUCCESS',
        cf_payment_id: `CF_${Date.now()}_TEST`,
      },
      customer_details: {
        customer_id: '9876543210',
        customer_name: 'Test User',
        customer_email: 'test@example.com',
        customer_phone: '9876543210',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Setup DB mock chains
// ---------------------------------------------------------------------------
function setupDbMocks() {
  // processedEvents select (idempotency check) → no existing record
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  mockDbSelect.mockReturnValue(selectChain);

  // Override for tenant lookup (second select call)
  let selectCallCount = 0;
  mockDbSelect.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // Idempotency check → no existing
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    }
    if (selectCallCount === 2) {
      // Tenant lookup → found
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'tenant-uuid', slug: 'growth-escalators' }]),
          }),
        }),
      };
    }
    // Contact metadata lookup
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'contact-uuid-123', metadata: {}, tags: [] }]),
        }),
      }),
    };
  });

  // Insert chain
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'new-uuid' }]),
    }),
  });

  // Update chain
  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Cashfree Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true and skips processing for non-success events', async () => {
    // Dynamically import the router to get the webhook handler
    const { default: router } = await import('../routes/cashfree');

    const { req, res, jsonFn } = createMockReqRes({
      event_type: 'PAYMENT_FAILED_WEBHOOK',
      data: { payment: { payment_status: 'FAILED' } },
    });

    // Find the webhook route handler
    const webhookLayer = router.stack.find(
      (l: any) => l.route?.path === '/webhook' && l.route?.methods?.post
    );
    expect(webhookLayer).toBeDefined();

    await webhookLayer!.route!.stack[0].handle(req, res, vi.fn());

    expect(jsonFn).toHaveBeenCalledWith({ ok: true });
  });

  it('returns ok:true for unknown event types', async () => {
    const { default: router } = await import('../routes/cashfree');

    const { req, res, jsonFn } = createMockReqRes({
      event_type: 'ORDER_CREATED',
      data: { payment: { payment_status: 'PENDING' } },
    });

    const webhookLayer = router.stack.find(
      (l: any) => l.route?.path === '/webhook' && l.route?.methods?.post
    );

    await webhookLayer!.route!.stack[0].handle(req, res, vi.fn());

    expect(jsonFn).toHaveBeenCalledWith({ ok: true });
  });

  it('webhook-test endpoint returns expected shape', async () => {
    const { default: router } = await import('../routes/cashfree');

    const webhookTestLayer = router.stack.find(
      (l: any) => l.route?.path === '/webhook-test' && l.route?.methods?.get
    );
    expect(webhookTestLayer).toBeDefined();

    const { req, res, jsonFn } = createMockReqRes();
    await webhookTestLayer!.route!.stack[0].handle(req, res, vi.fn());

    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        handler: 'POST /api/cashfree/webhook',
        events_handled: ['PAYMENT_SUCCESS_WEBHOOK'],
      })
    );
  });

  it('create-order validates required fields', async () => {
    const { default: router } = await import('../routes/cashfree');

    const createOrderLayer = router.stack.find(
      (l: any) => l.route?.path === '/create-order' && l.route?.methods?.post
    );
    expect(createOrderLayer).toBeDefined();

    const { req, res, jsonFn, statusFn } = createMockReqRes({
      name: 'Test',
      // Missing email, phone, amount
    });

    await createOrderLayer!.route!.stack[0].handle(req, res, vi.fn());

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'name, email, phone, amount are required' });
  });
});
