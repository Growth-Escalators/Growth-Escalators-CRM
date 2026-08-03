import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// Distinct object identities per table so a mocked db.update(table) call can
// be asserted against exactly which table it targeted.
const TENANTS_TABLE = { id: 'id', settings: 'settings' };
const SUBSCRIPTIONS_TABLE = {
  id: 'id',
  tenantId: 'tenant_id',
  planId: 'plan_id',
  status: 'status',
  paymentProvider: 'payment_provider',
  providerSubscriptionId: 'provider_subscription_id',
  renewalDate: 'renewal_date',
};
const PLANS_TABLE = { id: 'id', featureEntitlements: 'feature_entitlements' };
const PROCESSED_EVENTS_TABLE = { eventId: 'event_id' };

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
  processedEvents: PROCESSED_EVENTS_TABLE,
  subscriptions: SUBSCRIPTIONS_TABLE,
  plans: PLANS_TABLE,
  tenants: TENANTS_TABLE,
}));

// applyPlanEntitlementsToTenant lives in tenantFeatures.ts, which imports
// `tenants` directly from '../db/schema' (not '../db/index') — that import
// must resolve to the SAME TENANTS_TABLE object identity used above, or the
// nth-call assertions below can't tell which table an update targeted.
vi.mock('../db/schema', () => ({
  tenants: TENANTS_TABLE,
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

function makeClaimChain(succeeds: boolean) {
  const chain: any = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoNothing = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(succeeds ? [{ id: 'claim-1', eventId: 'x' }] : []);
  return chain;
}

describe('processSubscriptionEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  describe('idempotency', () => {
    it('processing the exact same event twice only extends the renewal once', async () => {
      const subscriptionRow = {
        id: 'sub-row-1',
        tenantId: 'tenant-1',
        planId: 'plan-1',
        status: 'active',
        paymentProvider: 'cashfree',
        providerSubscriptionId: 'sub_123',
        renewalDate: null,
        currency: 'INR',
      };
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([subscriptionRow]) }),
        }),
      });
      const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbUpdate.mockReturnValue({ set: setFn });
      // First call claims successfully; the second call — same raw body, same
      // sha256-derived idempotency key — hits the unique constraint and gets []
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true)).mockReturnValueOnce(makeClaimChain(false));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({
        type: 'subscription.charged',
        providerSubscriptionId: 'sub_123',
        amount: 999,
        currency: 'INR',
      });
      const event = {
        type: 'subscription.charged' as const,
        providerSubscriptionId: 'sub_123',
        amount: 999,
        currency: 'INR',
        raw: JSON.parse(rawBody),
      };

      const first = await processSubscriptionEvent('cashfree', rawBody, event);
      const second = await processSubscriptionEvent('cashfree', rawBody, event);

      expect(first).toEqual(expect.objectContaining({ ok: true, status: 'processed' }));
      expect(second).toEqual({ ok: true, status: 'skipped', reason: 'already processed' });
      // The critical assertion: renewal-extending update only ran once, not twice.
      expect(setFn).toHaveBeenCalledTimes(1);
      expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ renewalDate: expect.any(Date), status: 'active' }));
    });

    it('a genuinely different event (different raw body) for the same subscription is NOT skipped', async () => {
      const subscriptionRow = {
        id: 'sub-row-1',
        tenantId: 'tenant-1',
        planId: 'plan-1',
        status: 'active',
        paymentProvider: 'cashfree',
        providerSubscriptionId: 'sub_123',
        renewalDate: null,
        currency: 'INR',
      };
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([subscriptionRow]) }),
        }),
      });
      const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbUpdate.mockReturnValue({ set: setFn });
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true)).mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody1 = JSON.stringify({ type: 'subscription.charged', providerSubscriptionId: 'sub_123', chargeId: 'ch_1' });
      const rawBody2 = JSON.stringify({ type: 'subscription.charged', providerSubscriptionId: 'sub_123', chargeId: 'ch_2' });
      const event = { type: 'subscription.charged' as const, providerSubscriptionId: 'sub_123', raw: {} };

      const first = await processSubscriptionEvent('cashfree', rawBody1, { ...event, raw: JSON.parse(rawBody1) });
      const second = await processSubscriptionEvent('cashfree', rawBody2, { ...event, raw: JSON.parse(rawBody2) });

      expect(first.status).toBe('processed');
      expect(second.status).toBe('processed');
      expect(setFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('entitlement enforcement', () => {
    it('activating a subscription applies the plan feature entitlements to the tenant, then marks the subscription active', async () => {
      const subscriptionRow = {
        id: 'sub-row-1',
        tenantId: 'tenant-1',
        planId: 'plan-1',
        status: 'created',
        paymentProvider: 'cashfree',
        providerSubscriptionId: 'sub_123',
        renewalDate: null,
        currency: 'INR',
      };
      const planRow = {
        id: 'plan-1',
        featureEntitlements: { wizmatch: true, seo: false, crmAutomation: true, gstBilling: false, d2c: false },
      };
      const tenantRow = { settings: {} };

      let selectCall = 0;
      mockDbSelect.mockImplementation(() => {
        selectCall++;
        if (selectCall === 1) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([subscriptionRow]) }) }) };
        }
        if (selectCall === 2) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([planRow]) }) }) };
        }
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([tenantRow]) }) }) };
      });

      const setFn = vi.fn();
      mockDbUpdate.mockImplementation((table: unknown) => ({
        set: (arg: unknown) => {
          setFn(table, arg);
          return { where: vi.fn().mockResolvedValue(undefined) };
        },
      }));
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({ type: 'subscription.activated', providerSubscriptionId: 'sub_123' });
      const event = {
        type: 'subscription.activated' as const,
        providerSubscriptionId: 'sub_123',
        raw: JSON.parse(rawBody),
      };

      const result = await processSubscriptionEvent('cashfree', rawBody, event);

      expect(result).toEqual(expect.objectContaining({ ok: true, status: 'processed', newStatus: 'active' }));
      // Update #1: tenants.settings.features merged from the plan's entitlements.
      expect(setFn).toHaveBeenNthCalledWith(
        1,
        TENANTS_TABLE,
        expect.objectContaining({
          settings: expect.objectContaining({
            features: expect.objectContaining({ wizmatch: true, crmAutomation: true, seo: false }),
          }),
        }),
      );
      // Update #2: the subscription itself flips to 'active'.
      expect(setFn).toHaveBeenNthCalledWith(2, SUBSCRIPTIONS_TABLE, expect.objectContaining({ status: 'active' }));
    });

    it('a missing plan row does not throw — entitlements are skipped but the subscription still activates', async () => {
      const subscriptionRow = {
        id: 'sub-row-1',
        tenantId: 'tenant-1',
        planId: 'plan-missing',
        status: 'created',
        paymentProvider: 'cashfree',
        providerSubscriptionId: 'sub_123',
        renewalDate: null,
        currency: 'INR',
      };
      let selectCall = 0;
      mockDbSelect.mockImplementation(() => {
        selectCall++;
        const rows = selectCall === 1 ? [subscriptionRow] : []; // plan lookup finds nothing
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }) }) };
      });
      const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbUpdate.mockReturnValue({ set: setFn });
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({ type: 'subscription.activated', providerSubscriptionId: 'sub_123' });
      const event = {
        type: 'subscription.activated' as const,
        providerSubscriptionId: 'sub_123',
        raw: JSON.parse(rawBody),
      };

      const result = await processSubscriptionEvent('cashfree', rawBody, event);

      expect(result).toEqual(expect.objectContaining({ status: 'processed', newStatus: 'active' }));
      expect(setFn).toHaveBeenCalledTimes(1); // only the subscription status update, no tenant settings write
    });
  });

  describe('cancellation and failure', () => {
    it('sets status to cancelled on subscription.cancelled', async () => {
      const subscriptionRow = {
        id: 'sub-row-1', tenantId: 'tenant-1', planId: 'plan-1', status: 'active',
        paymentProvider: 'razorpay', providerSubscriptionId: 'sub_999', renewalDate: null, currency: 'INR',
      };
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([subscriptionRow]) }) }),
      });
      const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbUpdate.mockReturnValue({ set: setFn });
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({ type: 'subscription.cancelled', providerSubscriptionId: 'sub_999' });
      const event = { type: 'subscription.cancelled' as const, providerSubscriptionId: 'sub_999', raw: JSON.parse(rawBody) };

      const result = await processSubscriptionEvent('razorpay', rawBody, event);

      expect(result).toEqual(expect.objectContaining({ newStatus: 'cancelled' }));
      expect(setFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });

    it('sets status to failed on subscription.failed without touching entitlements', async () => {
      const subscriptionRow = {
        id: 'sub-row-1', tenantId: 'tenant-1', planId: 'plan-1', status: 'active',
        paymentProvider: 'razorpay', providerSubscriptionId: 'sub_999', renewalDate: null, currency: 'INR',
      };
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([subscriptionRow]) }) }),
      });
      const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbUpdate.mockReturnValue({ set: setFn });
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({ type: 'subscription.failed', providerSubscriptionId: 'sub_999' });
      const event = { type: 'subscription.failed' as const, providerSubscriptionId: 'sub_999', raw: JSON.parse(rawBody) };

      const result = await processSubscriptionEvent('razorpay', rawBody, event);

      expect(result).toEqual(expect.objectContaining({ newStatus: 'failed' }));
      expect(setFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown subscription', () => {
    it('skips cleanly when no local subscription matches the provider + providerSubscriptionId', async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
      });
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({ type: 'subscription.activated', providerSubscriptionId: 'sub_unknown' });
      const event = { type: 'subscription.activated' as const, providerSubscriptionId: 'sub_unknown', raw: JSON.parse(rawBody) };

      const result = await processSubscriptionEvent('cashfree', rawBody, event);

      expect(result).toEqual({ ok: true, status: 'skipped', reason: 'unknown subscription' });
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  describe('claim release on processing failure', () => {
    it('releases the processed_events claim when the DB update throws, so the provider retry can reprocess', async () => {
      const subscriptionRow = {
        id: 'sub-row-1', tenantId: 'tenant-1', planId: 'plan-1', status: 'active',
        paymentProvider: 'cashfree', providerSubscriptionId: 'sub_123', renewalDate: null, currency: 'INR',
      };
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([subscriptionRow]) }) }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockRejectedValue(new Error('transient DB blip')) }),
      });
      mockDbInsert.mockReturnValueOnce(makeClaimChain(true));

      const { processSubscriptionEvent } = await import('../services/subscriptionEventProcessor');
      const rawBody = JSON.stringify({ type: 'subscription.charged', providerSubscriptionId: 'sub_123' });
      const event = { type: 'subscription.charged' as const, providerSubscriptionId: 'sub_123', raw: JSON.parse(rawBody) };

      await expect(processSubscriptionEvent('cashfree', rawBody, event)).rejects.toThrow('transient DB blip');
      expect(mockDbDelete).toHaveBeenCalledTimes(1);
    });
  });
});
