import { createHmac } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock database module
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
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
const mockFindOrCreateContact = vi.fn().mockResolvedValue({
  contact: { id: 'contact-uuid-123', firstName: 'Test', lastName: 'User' },
  channels: [],
  created: true,
});
vi.mock('../services/contactService', () => ({
  findOrCreateContact: (...args: unknown[]) => mockFindOrCreateContact(...args),
  normalizeChannelValue: (_type: string, value: string) => value,
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

const mockLoggerError = vi.fn();
vi.mock('../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Signature helpers — mirror validateCashfreeWebhook's own algorithm so tests
// exercise the real verification path rather than bypassing it.
// ---------------------------------------------------------------------------
const TEST_SECRET = 'test-cashfree-secret';

function signBody(rawBody: string, timestamp: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
}

function createMockReqRes(body: Record<string, unknown> = {}, opts: { signed?: boolean; badSignature?: boolean; omitHeaders?: boolean } = {}) {
  const { signed = true, badSignature = false, omitHeaders = false } = opts;
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));

  const headers: Record<string, string> = { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'test-agent' };
  if (!omitHeaders) {
    headers['x-webhook-timestamp'] = timestamp;
    headers['x-webhook-signature'] = signed
      ? badSignature
        ? signBody(rawBody, timestamp, 'wrong-secret')
        : signBody(rawBody, timestamp)
      : '';
  }

  const req = {
    body,
    rawBody,
    headers,
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
// invokeRoute — walks the real Express middleware chain for a route (instead
// of reaching into stack[0] directly), so tests exercise validateCashfreeWebhook
// AND the handler in the same order Express would run them. A layer that sends
// a response without calling next() ends the chain, matching real dispatch.
// ---------------------------------------------------------------------------
async function invokeRoute(router: any, path: string, method: string, req: any, res: any, jsonFn: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    if (jsonFn.mock.calls.length > 0) break; // a prior layer already responded
    let nextCalled = false;
    let nextErr: unknown;
    await item.handle(req, res, (err?: unknown) => { nextCalled = true; nextErr = err; });
    if (nextErr) throw nextErr;
    if (!nextCalled) break;
  }
}

// ---------------------------------------------------------------------------
// Setup DB mock chains
// ---------------------------------------------------------------------------
function setupDbMocks(opts: { claimSucceeds?: boolean } = {}) {
  const { claimSucceeds = true } = opts;

  let selectCallCount = 0;
  mockDbSelect.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
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

  // Insert chain — a real Promise instance (so `.then()`/`.catch()` used by
  // the fire-and-forget CAPI-event insert work natively) with chainable
  // methods attached, so `.values().returning()` and
  // `.values().onConflictDoNothing().returning()` (the processed_events
  // claim) both resolve correctly regardless of call shape.
  const insertChain: any = Promise.resolve(claimSucceeds ? [{ id: 'claim-row', eventId: 'x' }] : []);
  insertChain.values = vi.fn().mockReturnValue(insertChain);
  insertChain.onConflictDoNothing = vi.fn().mockReturnValue(insertChain);
  insertChain.returning = vi.fn().mockResolvedValue(claimSucceeds ? [{ id: 'claim-row', eventId: 'x' }] : []);
  mockDbInsert.mockReturnValue(insertChain);

  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

  // Update chain
  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });

  // Delete chain (claim release on processing failure)
  mockDbDelete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Cashfree Webhook Handler', () => {
  const originalSecret = process.env.CASHFREE_SECRET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CASHFREE_SECRET_KEY = TEST_SECRET;
    setupDbMocks();
  });

  afterEach(() => {
    process.env.CASHFREE_SECRET_KEY = originalSecret;
  });

  describe('signature verification (validateCashfreeWebhook)', () => {
    it('rejects with 503 when CASHFREE_SECRET_KEY is unset', async () => {
      delete process.env.CASHFREE_SECRET_KEY;
      const { default: router } = await import('../routes/cashfree');
      const { req, res, statusFn, jsonFn } = createMockReqRes(makeSuccessWebhookBody());

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      expect(statusFn).toHaveBeenCalledWith(503);
      expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    });

    it('rejects with 401 when signature headers are missing', async () => {
      const { default: router } = await import('../routes/cashfree');
      const { req, res, statusFn, jsonFn } = createMockReqRes(makeSuccessWebhookBody(), { omitHeaders: true });

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      expect(statusFn).toHaveBeenCalledWith(401);
      expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the signature does not match (forged payload)', async () => {
      const { default: router } = await import('../routes/cashfree');
      const { req, res, statusFn, jsonFn } = createMockReqRes(makeSuccessWebhookBody(), { badSignature: true });

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      expect(statusFn).toHaveBeenCalledWith(401);
      expect(mockFindOrCreateContact).not.toHaveBeenCalled();
    });

    it('accepts a validly-signed payload and reaches the handler', async () => {
      const { default: router } = await import('../routes/cashfree');
      const { req, res, jsonFn } = createMockReqRes({
        event_type: 'PAYMENT_FAILED_WEBHOOK',
        data: { payment: { payment_status: 'FAILED' } },
      });

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      expect(jsonFn).toHaveBeenCalledWith({ ok: true });
    });
  });

  it('returns ok:true and skips processing for non-success events', async () => {
    const { default: router } = await import('../routes/cashfree');
    const { req, res, jsonFn } = createMockReqRes({
      event_type: 'PAYMENT_FAILED_WEBHOOK',
      data: { payment: { payment_status: 'FAILED' } },
    });

    await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

    expect(jsonFn).toHaveBeenCalledWith({ ok: true });
  });

  it('returns ok:true for unknown event types', async () => {
    const { default: router } = await import('../routes/cashfree');
    const { req, res, jsonFn } = createMockReqRes({
      event_type: 'ORDER_CREATED',
      data: { payment: { payment_status: 'PENDING' } },
    });

    await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

    expect(jsonFn).toHaveBeenCalledWith({ ok: true });
  });

  describe('successful PAYMENT_SUCCESS_WEBHOOK processing', () => {
    it('claims the event, creates the contact + deal, and responds ok:true', async () => {
      const { default: router } = await import('../routes/cashfree');
      const { req, res, jsonFn, statusFn } = createMockReqRes(makeSuccessWebhookBody());

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      expect(statusFn).not.toHaveBeenCalledWith(500);
      expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
      expect(jsonFn).toHaveBeenCalledWith({ ok: true });
    });

    it('skips reprocessing when the event is already claimed (idempotency)', async () => {
      setupDbMocks({ claimSucceeds: false });
      const { default: router } = await import('../routes/cashfree');
      const { req, res, jsonFn } = createMockReqRes(makeSuccessWebhookBody());

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      expect(mockFindOrCreateContact).not.toHaveBeenCalled();
      expect(jsonFn).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('idempotency claim release on mid-processing failure (C9)', () => {
    it('releases the processed_events claim when contact creation throws, so a retry can reprocess', async () => {
      mockFindOrCreateContact.mockRejectedValueOnce(new Error('transient DB blip'));
      const { default: router } = await import('../routes/cashfree');
      const { req, res, jsonFn, statusFn } = createMockReqRes(makeSuccessWebhookBody());

      await invokeRoute(router, '/webhook', 'post', req, res, jsonFn);

      // The claim must be released (deleted) so Cashfree's automatic retry
      // (triggered by the 500 response) can succeed instead of being told
      // "already processed" forever.
      expect(mockDbDelete).toHaveBeenCalledTimes(1);
      expect(statusFn).toHaveBeenCalledWith(500);
    });
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
