// The Cashfree purchase-confirmation WhatsApp message (processCashfreeEvent
// in cashfreeEventProcessor.ts) sends over GE's shared
// META_PHONE_NUMBER_ID/META_ACCESS_TOKEN — the same shared identity guarded
// in routes/inbox.ts (canSendWhatsApp, request-based) and, for cron/webhook
// contexts with no req.user, in growthOSSetup.ts (canSendGrowthOSWhatsApp,
// record-based). brandHealthService.ts / competitorService.ts /
// opportunityService.ts / copilotService.ts already reuse
// canSendGrowthOSWhatsApp() for their own sends; cashfreeEventProcessor.ts
// now applies the same guard, resolved from the order's own tenant record
// (the webhook has no req.user to key off of).
//
// NOTE ON REACHABILITY: the tenant lookup in cashfreeEventProcessor.ts is
// hardcoded to `WHERE slug = 'growth-escalators'` (D2C purchases aren't
// wired up per-tenant anywhere else yet) — the exact same lookup
// canSendGrowthOSWhatsApp treats as "GE's own tenant". So in production
// today this guard can never actually change behavior: every processed
// order resolves to GE's own tenant id, every time. The "non-GE tenant"
// test below deliberately forces the two lookups to disagree (something
// that cannot happen with today's hardcoded query) purely to prove the
// guard mechanism itself blocks correctly — defensive coverage for the day
// D2C purchases become available to reseller tenants.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const GE_TENANT_ID = 'tenant-ge-00000000-0000-0000-0000-000000000000';
const OTHER_TENANT_ID = 'tenant-acme-1111111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// Mock database module — shared by cashfreeEventProcessor.ts (db.*) and
// growthOSSetup.ts (pool.query), since canSendGrowthOSWhatsApp resolves GE's
// tenant id via pool.query.
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

const mockFindOrCreateContact = vi.fn();
vi.mock('../services/contactService', () => ({
  findOrCreateContact: (...args: unknown[]) => mockFindOrCreateContact(...args),
  normalizeChannelValue: (_type: string, value: string) => value,
}));

vi.mock('../services/metaCapi', () => ({
  sendPurchaseEvent: vi.fn().mockResolvedValue({ success: true, eventId: 'evt-123' }),
}));

const mockSendSlackMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/slackService', () => ({
  sendSlackMessage: (...args: unknown[]) => mockSendSlackMessage(...args),
}));

vi.mock('../services/funnelConfigService', () => ({
  getFunnelConfig: vi.fn().mockResolvedValue(null),
  stageForAmount: vi.fn().mockReturnValue('paid_9'),
  labelForStage: vi.fn().mockReturnValue('D2C Funnel Breakdown Pack'),
  renderTemplate: vi.fn((tpl: string) => tpl),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// db.select is called twice per successful run: (1) the order's tenant
// lookup — `db.select().from(tenants).where(eq(tenants.slug,
// 'growth-escalators')).limit(1)` — then (2) the existing-contact metadata
// read. Mirrors cashfreeWebhook.test.ts's setupDbMocks.
function setupDbMocks(orderTenantId: string) {
  let selectCallCount = 0;
  mockDbSelect.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: orderTenantId, slug: 'growth-escalators' }]),
          }),
        }),
      };
    }
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'contact-uuid-123', metadata: {}, tags: [] }]),
        }),
      }),
    };
  });

  const insertChain: any = Promise.resolve([{ id: 'claim-row', eventId: 'x' }]);
  insertChain.values = vi.fn().mockReturnValue(insertChain);
  insertChain.onConflictDoNothing = vi.fn().mockReturnValue(insertChain);
  insertChain.returning = vi.fn().mockResolvedValue([{ id: 'claim-row', eventId: 'x' }]);
  mockDbInsert.mockReturnValue(insertChain);

  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });

  mockDbDelete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
}

// pool.query is called by growthOSSetup.ts's resolveGeTenantId
// (`SELECT id FROM tenants WHERE slug = $1`) and, separately, by the
// sequence-enrolment insert further down processCashfreeEvent. Route on SQL
// text the same way growthOSResellerWhatsAppBlock.test.ts does.
function mockPoolQueryResolvingGeTenantTo(geTenantId: string) {
  mockPoolQuery.mockImplementation(async (sqlText: string) => {
    if (String(sqlText).includes('FROM tenants WHERE slug')) {
      return { rows: [{ id: geTenantId }] };
    }
    return { rows: [], rowCount: 0 }; // sequence_enrolments insert — no-op success
  });
}

function makeSuccessWebhookBody() {
  return {
    event_type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: {
        order_id: `GE_TEST_${Date.now()}_${Math.random()}`,
        order_amount: 9,
        order_meta: { segment: 'd2c', bump1: false, bump2: false, funnelSlug: 'ecom' },
      },
      payment: { payment_status: 'SUCCESS', cf_payment_id: `CF_${Date.now()}_${Math.random()}` },
      customer_details: {
        customer_id: '9876543210',
        customer_name: 'Test User',
        customer_email: 'test@example.com',
        customer_phone: '9876543210',
      },
    },
  };
}

// The tenant-guard fetch happens inside a .then() chain that
// processCashfreeEvent deliberately does NOT await (kept fire-and-forget so
// it doesn't delay the Slack/email/sequence-enrolment side-effects below
// it). A single macrotask tick (setTimeout) is enough to flush every
// pending microtask ahead of it (resolveGeTenantId's pool.query -> .then ->
// .catch -> await, then canSendGrowthOSWhatsApp's own await), regardless of
// how many microtask hops deep that chain is.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function whatsappSendCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('cashfreeEventProcessor.ts — WhatsApp purchase-confirmation tenant guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules(); // forces growthOSSetup's memoized _geTenantIdPromise to reset too
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbDelete.mockReset();
    mockPoolQuery.mockReset();
    mockSendSlackMessage.mockClear();
    mockFindOrCreateContact.mockReset().mockResolvedValue({
      contact: { id: 'contact-uuid-123', firstName: 'Test', lastName: 'User' },
      channels: [],
      created: true,
    });

    process.env.META_PHONE_NUMBER_ID = 'ge-shared-phone-id';
    process.env.META_ACCESS_TOKEN = 'ge-shared-token';
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
  });

  it("still sends the purchase-confirmation WhatsApp for GE's own tenant, exactly as before", async () => {
    setupDbMocks(GE_TENANT_ID);
    mockPoolQueryResolvingGeTenantTo(GE_TENANT_ID); // order's tenant === GE's own tenant

    const { processCashfreeEvent } = await import('../services/cashfreeEventProcessor');
    const result = await processCashfreeEvent(makeSuccessWebhookBody());

    expect(result.ok).toBe(true);
    expect(result.status).toBe('processed');
    // Payment/order data recorded as always.
    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalled();

    await flushMicrotasks();

    const waCalls = whatsappSendCalls(fetchMock);
    expect(waCalls.length).toBe(1);
    expect(waCalls[0][0]).toContain('ge-shared-phone-id');
  });

  it("blocks the WhatsApp send when the resolved tenant is not GE's own, while payment/order data is still recorded identically", async () => {
    setupDbMocks(OTHER_TENANT_ID);
    mockPoolQueryResolvingGeTenantTo(GE_TENANT_ID); // GE's own tenant id differs from the order's tenant id

    const { processCashfreeEvent } = await import('../services/cashfreeEventProcessor');
    const result = await processCashfreeEvent(makeSuccessWebhookBody());

    expect(result.ok).toBe(true);
    expect(result.status).toBe('processed');
    // Everything except the WhatsApp send still happens identically: contact
    // upsert, deal + event writes, and the Slack alert.
    expect(mockFindOrCreateContact).toHaveBeenCalledTimes(1);
    expect(mockDbInsert).toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockSendSlackMessage).toHaveBeenCalledTimes(1);

    await flushMicrotasks();

    expect(whatsappSendCalls(fetchMock).length).toBe(0);
  });
});
