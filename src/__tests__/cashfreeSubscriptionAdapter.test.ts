import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashfreeAdapterError, CashfreeSubscriptionAdapter } from '../services/paymentGateway/cashfreeAdapter';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('CashfreeSubscriptionAdapter', () => {
  const ENV_KEYS = [
    'CASHFREE_SUBSCRIPTIONS_APP_ID',
    'CASHFREE_SUBSCRIPTIONS_SECRET_KEY',
    'CASHFREE_SUBSCRIPTIONS_WEBHOOK_SECRET',
    'CASHFREE_APP_ID',
    'CASHFREE_SECRET_KEY',
    'NODE_ENV',
    'FRONTEND_URL',
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  let adapter: CashfreeSubscriptionAdapter;

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.CASHFREE_SUBSCRIPTIONS_APP_ID = 'test-app-id';
    process.env.CASHFREE_SUBSCRIPTIONS_SECRET_KEY = 'test-secret-key';
    process.env.CASHFREE_SUBSCRIPTIONS_WEBHOOK_SECRET = 'test-webhook-secret';
    delete process.env.NODE_ENV;
    adapter = new CashfreeSubscriptionAdapter();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('provider identity', () => {
    it('reports provider = cashfree', () => {
      expect(adapter.provider).toBe('cashfree');
    });
  });

  // ---------------------------------------------------------------------------
  // createSubscription
  // ---------------------------------------------------------------------------
  describe('createSubscription', () => {
    it('calls the Subscriptions create endpoint and returns the provider id + a customer-facing authorization link', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        jsonResponse({
          cf_subscription_id: '23639356',
          subscription_id: 'GE_SUB_TENANT1_123',
          subscription_status: 'INITIALIZED',
          subscription_session_id: 'session_abc123',
        }),
      );
      vi.stubGlobal('fetch', fetchSpy);

      const result = await adapter.createSubscription({
        tenantId: 'tenant-1',
        planId: 'plan_pro_monthly',
        customerEmail: 'buyer@example.com',
        customerPhone: '9900000000',
        returnUrl: 'https://crm.growthescalators.com/billing/return',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sandbox.cashfree.com/pg/subscriptions');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'x-client-id': 'test-app-id',
        'x-client-secret': 'test-secret-key',
      });
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody.plan_details.plan_id).toBe('plan_pro_monthly');
      expect(sentBody.customer_details.customer_email).toBe('buyer@example.com');
      expect(sentBody.customer_details.customer_phone).toBe('9900000000');
      expect(sentBody.subscription_meta.return_url).toBe('https://crm.growthescalators.com/billing/return');
      // subscription_id is merchant-generated and tenant-scoped
      expect(sentBody.subscription_id).toMatch(/^GE_SUB_tenant1_/i);

      expect(result.providerSubscriptionId).toBe('GE_SUB_TENANT1_123');
      expect(result.authorizationUrl).toContain('subscription_session_id=session_abc123');
      expect(result.authorizationUrl).toContain('subscription_id=GE_SUB_TENANT1_123');
    });

    it('uses the production Cashfree host when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      const fetchSpy = vi.fn().mockResolvedValue(
        jsonResponse({ subscription_id: 'sub_1', subscription_session_id: 'sess_1' }),
      );
      vi.stubGlobal('fetch', fetchSpy);

      await adapter.createSubscription({
        tenantId: 'tenant-1',
        planId: 'plan_1',
        customerEmail: 'a@b.com',
        returnUrl: 'https://x.test/return',
      });

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('https://api.cashfree.com/pg/subscriptions');
    });

    it('throws when Cashfree does not return a subscription_session_id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ subscription_id: 'sub_1' })));
      await expect(
        adapter.createSubscription({
          tenantId: 'tenant-1',
          planId: 'plan_1',
          customerEmail: 'a@b.com',
          returnUrl: 'https://x.test/return',
        }),
      ).rejects.toBeInstanceOf(CashfreeAdapterError);
    });

    it('surfaces a non-2xx Cashfree response as CashfreeAdapterError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ message: 'invalid plan_id' }, false, 400)),
      );
      await expect(
        adapter.createSubscription({
          tenantId: 'tenant-1',
          planId: 'bad_plan',
          customerEmail: 'a@b.com',
          returnUrl: 'https://x.test/return',
        }),
      ).rejects.toThrow(/invalid plan_id/);
    });

    it('throws when Subscriptions credentials are not configured', async () => {
      delete process.env.CASHFREE_SUBSCRIPTIONS_APP_ID;
      delete process.env.CASHFREE_SUBSCRIPTIONS_SECRET_KEY;
      delete process.env.CASHFREE_APP_ID;
      delete process.env.CASHFREE_SECRET_KEY;
      await expect(
        adapter.createSubscription({
          tenantId: 'tenant-1',
          planId: 'plan_1',
          customerEmail: 'a@b.com',
          returnUrl: 'https://x.test/return',
        }),
      ).rejects.toBeInstanceOf(CashfreeAdapterError);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelSubscription
  // ---------------------------------------------------------------------------
  describe('cancelSubscription', () => {
    it('POSTs a CANCEL action to the manage endpoint for the given subscription id', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ subscription_status: 'CANCELLED' }));
      vi.stubGlobal('fetch', fetchSpy);

      await adapter.cancelSubscription('GE_SUB_TENANT1_123');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sandbox.cashfree.com/pg/subscriptions/GE_SUB_TENANT1_123/manage');
      expect(init.method).toBe('POST');
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody).toEqual({ subscription_id: 'GE_SUB_TENANT1_123', action: 'CANCEL' });
    });

    it('propagates a Cashfree error response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'subscription not found' }, false, 404)));
      await expect(adapter.cancelSubscription('nonexistent')).rejects.toThrow(/subscription not found/);
    });
  });

  // ---------------------------------------------------------------------------
  // getSubscriptionStatus
  // ---------------------------------------------------------------------------
  describe('getSubscriptionStatus', () => {
    it.each([
      ['INITIALIZED', 'created'],
      ['BANK_APPROVAL_PENDING', 'created'],
      ['ACTIVE', 'active'],
      ['ON_HOLD', 'paused'],
      ['PAUSED', 'paused'],
      ['CANCELLED', 'cancelled'],
      ['COMPLETED', 'expired'],
      ['EXPIRED', 'expired'],
    ] as const)('maps Cashfree status %s to %s', async (cashfreeStatus, expected) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ subscription_status: cashfreeStatus })));
      const status = await adapter.getSubscriptionStatus('sub_1');
      expect(status).toBe(expected);
    });

    it('calls GET on the subscription resource path', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ subscription_status: 'ACTIVE' }));
      vi.stubGlobal('fetch', fetchSpy);
      await adapter.getSubscriptionStatus('sub_42');
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sandbox.cashfree.com/pg/subscriptions/sub_42');
      expect(init.method).toBe('GET');
    });

    it('throws (fails loud) on an unrecognized status rather than guessing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ subscription_status: 'SOME_NEW_STATUS' })));
      await expect(adapter.getSubscriptionStatus('sub_1')).rejects.toBeInstanceOf(CashfreeAdapterError);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyWebhookSignature — the security-critical path
  // ---------------------------------------------------------------------------
  describe('verifyWebhookSignature', () => {
    function sign(secret: string, timestamp: string, rawBody: string): string {
      return createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
    }

    it('accepts a signature computed correctly over timestamp + raw body', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const timestamp = '1735689600';
      const signature = sign('test-webhook-secret', timestamp, rawBody);

      const ok = adapter.verifyWebhookSignature(rawBody, {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      });
      expect(ok).toBe(true);
    });

    it('is case-insensitive about header names', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const timestamp = '1735689600';
      const signature = sign('test-webhook-secret', timestamp, rawBody);

      const ok = adapter.verifyWebhookSignature(rawBody, {
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp,
      });
      expect(ok).toBe(true);
    });

    it('rejects a tampered payload — signature was computed over a different body (forged webhook)', () => {
      const originalBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', data: { payment_amount: 999 } });
      const timestamp = '1735689600';
      const signature = sign('test-webhook-secret', timestamp, originalBody);

      // Attacker changes the amount after the signature was issued.
      const tamperedBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', data: { payment_amount: 1 } });

      const ok = adapter.verifyWebhookSignature(tamperedBody, {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      });
      expect(ok).toBe(false);
    });

    it('rejects a signature signed with the wrong secret', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const timestamp = '1735689600';
      const signature = sign('some-other-secret', timestamp, rawBody);

      const ok = adapter.verifyWebhookSignature(rawBody, {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      });
      expect(ok).toBe(false);
    });

    it('rejects when the signature header is missing', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const ok = adapter.verifyWebhookSignature(rawBody, { 'x-webhook-timestamp': '1735689600' });
      expect(ok).toBe(false);
    });

    it('rejects when the timestamp header is missing', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const signature = sign('test-webhook-secret', '1735689600', rawBody);
      const ok = adapter.verifyWebhookSignature(rawBody, { 'x-webhook-signature': signature });
      expect(ok).toBe(false);
    });

    it('fails closed when CASHFREE_SUBSCRIPTIONS_WEBHOOK_SECRET is not configured', () => {
      delete process.env.CASHFREE_SUBSCRIPTIONS_WEBHOOK_SECRET;
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const signature = sign('test-webhook-secret', '1735689600', rawBody);
      const ok = adapter.verifyWebhookSignature(rawBody, {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': '1735689600',
      });
      expect(ok).toBe(false);
    });

    it('does not throw on a malformed base64 signature — returns false', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      const ok = adapter.verifyWebhookSignature(rawBody, {
        'x-webhook-signature': '!!!not-base64!!!',
        'x-webhook-timestamp': '1735689600',
      });
      expect(ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // parseWebhookEvent
  // ---------------------------------------------------------------------------
  describe('parseWebhookEvent', () => {
    it('parses SUBSCRIPTION_PAYMENT_SUCCESS into subscription.charged', () => {
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        event_time: '2026-01-01T00:00:00+05:30',
        data: {
          subscription_details: { cf_subscription_id: '999', subscription_id: 'GE_SUB_1', subscription_status: 'ACTIVE' },
          payment_amount: 499,
          payment_currency: 'INR',
          payment_status: 'SUCCESS',
        },
      });

      const event = adapter.parseWebhookEvent(rawBody, {});
      expect(event.type).toBe('subscription.charged');
      expect(event.providerSubscriptionId).toBe('GE_SUB_1');
      expect(event.amount).toBe(499);
      expect(event.currency).toBe('INR');
      expect(event.raw).toEqual(JSON.parse(rawBody));
    });

    it('parses SUBSCRIPTION_PAYMENT_FAILED into subscription.failed', () => {
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
        data: {
          subscription_details: { subscription_id: 'GE_SUB_2', subscription_status: 'ACTIVE' },
          payment_amount: 399,
          payment_currency: 'INR',
          payment_status: 'FAILED',
        },
      });

      const event = adapter.parseWebhookEvent(rawBody, {});
      expect(event.type).toBe('subscription.failed');
      expect(event.providerSubscriptionId).toBe('GE_SUB_2');
      expect(event.amount).toBe(399);
      expect(event.currency).toBe('INR');
    });

    it('parses SUBSCRIPTION_STATUS_CHANGED (ACTIVE) into subscription.activated', () => {
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: { subscription_details: { subscription_id: 'GE_SUB_3', subscription_status: 'ACTIVE' } },
      });

      const event = adapter.parseWebhookEvent(rawBody, {});
      expect(event.type).toBe('subscription.activated');
      expect(event.providerSubscriptionId).toBe('GE_SUB_3');
    });

    it('parses SUBSCRIPTION_STATUS_CHANGED (CANCELLED) into subscription.cancelled', () => {
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: { subscription_details: { subscription_id: 'GE_SUB_4', subscription_status: 'CANCELLED' } },
      });

      const event = adapter.parseWebhookEvent(rawBody, {});
      expect(event.type).toBe('subscription.cancelled');
      expect(event.providerSubscriptionId).toBe('GE_SUB_4');
    });

    it('accepts the legacy `event_type` field the same way the Orders webhook does (H — version-compat gotcha)', () => {
      const rawBody = JSON.stringify({
        event_type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        data: {
          subscription_details: { subscription_id: 'GE_SUB_5' },
          payment_amount: 100,
          payment_currency: 'INR',
        },
      });

      const event = adapter.parseWebhookEvent(rawBody, {});
      expect(event.type).toBe('subscription.charged');
    });

    it('throws for an unrecognized top-level webhook type', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_CARD_EXPIRY_REMINDER', data: { subscription_details: { subscription_id: 'x' } } });
      expect(() => adapter.parseWebhookEvent(rawBody, {})).toThrow(CashfreeAdapterError);
    });

    it('throws for a SUBSCRIPTION_STATUS_CHANGED status that has no clean normalized bucket', () => {
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: { subscription_details: { subscription_id: 'GE_SUB_6', subscription_status: 'ON_HOLD' } },
      });
      expect(() => adapter.parseWebhookEvent(rawBody, {})).toThrow(CashfreeAdapterError);
    });

    it('throws when the body has no subscription id at all', () => {
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS', data: {} });
      expect(() => adapter.parseWebhookEvent(rawBody, {})).toThrow(CashfreeAdapterError);
    });

    it('throws on malformed JSON', () => {
      expect(() => adapter.parseWebhookEvent('{not json', {})).toThrow(CashfreeAdapterError);
    });
  });
});
