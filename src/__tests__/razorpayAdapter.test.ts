import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RazorpayAdapterError,
  RazorpaySubscriptionAdapter,
  UnsupportedRazorpayWebhookEventError,
} from '../services/paymentGateway/razorpayAdapter';

const KEY_ID = 'rzp_test_key123';
const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function signBody(rawBody: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('RazorpaySubscriptionAdapter', () => {
  let adapter: RazorpaySubscriptionAdapter;
  let savedKeyId: string | undefined;
  let savedKeySecret: string | undefined;
  let savedWebhookSecret: string | undefined;

  beforeEach(() => {
    adapter = new RazorpaySubscriptionAdapter();
    savedKeyId = process.env.RAZORPAY_KEY_ID;
    savedKeySecret = process.env.RAZORPAY_KEY_SECRET;
    savedWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = savedKeyId;
    if (savedKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = savedKeySecret;
    if (savedWebhookSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = savedWebhookSecret;
  });

  it('exposes provider = razorpay', () => {
    expect(adapter.provider).toBe('razorpay');
  });

  // ---------------------------------------------------------------------
  // createSubscription
  // ---------------------------------------------------------------------
  describe('createSubscription', () => {
    it('POSTs /subscriptions with Basic auth and returns id + short_url', async () => {
      const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
      vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any = {}) => {
        calls.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : undefined });
        return new Response(JSON.stringify({
          id: 'sub_Abc123',
          entity: 'subscription',
          status: 'created',
          short_url: 'https://rzp.io/i/z3b1R61A9',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }));

      const result = await adapter.createSubscription({
        tenantId: 'tenant-1',
        planId: 'plan_00000000000001',
        customerEmail: 'Customer@Example.com',
        customerPhone: '9876543210',
        returnUrl: 'https://crm.growthescalators.com/billing/return',
      });

      expect(result).toEqual({ providerSubscriptionId: 'sub_Abc123', authorizationUrl: 'https://rzp.io/i/z3b1R61A9' });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.razorpay.com/v1/subscriptions');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
      expect(calls[0].body.plan_id).toBe('plan_00000000000001');
      expect(calls[0].body.customer_notify).toBe(1);
      expect(calls[0].body.notify_info.notify_email).toBe('customer@example.com');
      expect(calls[0].body.notify_info.notify_phone).toBe('919876543210');
      expect(calls[0].body.notes).toMatchObject({ tenant_id: 'tenant-1', return_url: 'https://crm.growthescalators.com/billing/return' });
      expect(typeof calls[0].body.total_count).toBe('number');
      expect(calls[0].body.total_count).toBeGreaterThan(0);
    });

    it('normalizes a 10-digit phone with a 91 prefix, and omits notify_phone when absent', async () => {
      let capturedBody: any;
      vi.stubGlobal('fetch', vi.fn(async (_url: any, opts: any = {}) => {
        capturedBody = JSON.parse(opts.body);
        return new Response(JSON.stringify({ id: 'sub_X', short_url: 'https://rzp.io/i/x' }), { status: 200 });
      }));
      await adapter.createSubscription({
        tenantId: 't', planId: 'plan_1', customerEmail: 'a@b.com',
        returnUrl: 'https://x.test/return',
      });
      expect(capturedBody.notify_info.notify_phone).toBeUndefined();
    });

    it('throws when Razorpay responds with an error status', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ error: { description: 'The plan id provided does not exist' } }),
        { status: 400 },
      )));
      await expect(adapter.createSubscription({
        tenantId: 't', planId: 'plan_bad', customerEmail: 'a@b.com', returnUrl: 'https://x.test',
      })).rejects.toBeInstanceOf(RazorpayAdapterError);
    });

    it('fails closed (503) when RAZORPAY_KEY_ID/SECRET are not configured', async () => {
      await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
        await expect(adapter.createSubscription({
          tenantId: 't', planId: 'plan_1', customerEmail: 'a@b.com', returnUrl: 'https://x.test',
        })).rejects.toMatchObject({ name: 'RazorpayAdapterError', statusCode: 503 });
      });
    });

    it('throws if Razorpay responds 200 but omits id or short_url', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'created' }), { status: 200 })));
      await expect(adapter.createSubscription({
        tenantId: 't', planId: 'plan_1', customerEmail: 'a@b.com', returnUrl: 'https://x.test',
      })).rejects.toBeInstanceOf(RazorpayAdapterError);
    });
  });

  // ---------------------------------------------------------------------
  // cancelSubscription
  // ---------------------------------------------------------------------
  describe('cancelSubscription', () => {
    it('POSTs /subscriptions/:id/cancel with immediate cancellation', async () => {
      const calls: Array<{ url: string; method: string; body: any }> = [];
      vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any = {}) => {
        calls.push({ url: String(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
        return new Response(JSON.stringify({ id: 'sub_Abc123', status: 'cancelled' }), { status: 200 });
      }));
      await adapter.cancelSubscription('sub_Abc123');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.razorpay.com/v1/subscriptions/sub_Abc123/cancel');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].body).toEqual({ cancel_at_cycle_end: 0 });
    });

    it('propagates a 404 as RazorpayAdapterError', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { description: 'not found' } }), { status: 404 })));
      await expect(adapter.cancelSubscription('sub_missing')).rejects.toMatchObject({ name: 'RazorpayAdapterError', statusCode: 404 });
    });
  });

  // ---------------------------------------------------------------------
  // getSubscriptionStatus
  // ---------------------------------------------------------------------
  describe('getSubscriptionStatus', () => {
    const cases: Array<[string, string]> = [
      ['created', 'created'],
      ['authenticated', 'created'],
      ['active', 'active'],
      ['pending', 'active'],
      ['halted', 'paused'],
      ['cancelled', 'cancelled'],
      ['completed', 'expired'],
      ['expired', 'expired'],
    ];

    for (const [razorpayStatus, expected] of cases) {
      it(`maps Razorpay status "${razorpayStatus}" → "${expected}"`, async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'sub_1', status: razorpayStatus }), { status: 200 })));
        await expect(adapter.getSubscriptionStatus('sub_1')).resolves.toBe(expected);
      });
    }

    it('throws on an unrecognized status rather than guessing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'sub_1', status: 'some_future_status' }), { status: 200 })));
      await expect(adapter.getSubscriptionStatus('sub_1')).rejects.toBeInstanceOf(RazorpayAdapterError);
    });

    it('GETs /subscriptions/:id', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any = {}) => {
        calls.push({ url: String(url), method: opts.method ?? 'GET' });
        return new Response(JSON.stringify({ id: 'sub_1', status: 'active' }), { status: 200 });
      }));
      await adapter.getSubscriptionStatus('sub_1');
      expect(calls[0]).toEqual({ url: 'https://api.razorpay.com/v1/subscriptions/sub_1', method: 'GET' });
    });
  });

  // ---------------------------------------------------------------------
  // verifyWebhookSignature — the security-critical path
  // ---------------------------------------------------------------------
  describe('verifyWebhookSignature', () => {
    it('accepts a genuinely signed payload', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      const signature = signBody(rawBody);
      expect(adapter.verifyWebhookSignature(rawBody, { 'x-razorpay-signature': signature })).toBe(true);
    });

    it('is case-insensitive about the header name', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      const signature = signBody(rawBody);
      expect(adapter.verifyWebhookSignature(rawBody, { 'X-Razorpay-Signature': signature })).toBe(true);
    });

    it('rejects a tampered payload signed for a different body', () => {
      const originalBody = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1' } } } });
      const signature = signBody(originalBody);
      // Attacker flips the subscription id after the signature was computed.
      const tamperedBody = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_ATTACKER' } } } });
      expect(adapter.verifyWebhookSignature(tamperedBody, { 'x-razorpay-signature': signature })).toBe(false);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      const signature = signBody(rawBody, 'wrong-secret');
      expect(adapter.verifyWebhookSignature(rawBody, { 'x-razorpay-signature': signature })).toBe(false);
    });

    it('rejects when the signature header is missing', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      expect(adapter.verifyWebhookSignature(rawBody, {})).toBe(false);
    });

    it('rejects when the signature is not valid hex / malformed', () => {
      const rawBody = JSON.stringify({ event: 'subscription.charged' });
      expect(adapter.verifyWebhookSignature(rawBody, { 'x-razorpay-signature': 'not-a-real-signature!!' })).toBe(false);
    });

    it('fails closed when RAZORPAY_WEBHOOK_SECRET is not configured', async () => {
      await withEnv({ RAZORPAY_WEBHOOK_SECRET: undefined }, () => {
        const rawBody = JSON.stringify({ event: 'subscription.charged' });
        const signature = signBody(rawBody);
        expect(adapter.verifyWebhookSignature(rawBody, { 'x-razorpay-signature': signature })).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------
  // parseWebhookEvent
  // ---------------------------------------------------------------------
  describe('parseWebhookEvent', () => {
    it('parses subscription.activated', () => {
      const raw = JSON.stringify({
        event: 'subscription.activated',
        payload: { subscription: { entity: { id: 'sub_1', status: 'active' } } },
      });
      const parsed = adapter.parseWebhookEvent(raw, {});
      expect(parsed.type).toBe('subscription.activated');
      expect(parsed.providerSubscriptionId).toBe('sub_1');
      expect(parsed.amount).toBeUndefined();
      expect(parsed.raw).toEqual(JSON.parse(raw));
    });

    it('parses subscription.charged with amount converted from paise to rupees', () => {
      const raw = JSON.stringify({
        event: 'subscription.charged',
        payload: {
          subscription: { entity: { id: 'sub_1', status: 'active', paid_count: 1 } },
          payment: { entity: { id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured' } },
        },
      });
      const parsed = adapter.parseWebhookEvent(raw, {});
      expect(parsed.type).toBe('subscription.charged');
      expect(parsed.providerSubscriptionId).toBe('sub_1');
      expect(parsed.amount).toBe(499);
      expect(parsed.currency).toBe('INR');
    });

    it('parses subscription.cancelled', () => {
      const raw = JSON.stringify({
        event: 'subscription.cancelled',
        payload: { subscription: { entity: { id: 'sub_1', status: 'cancelled' } } },
      });
      const parsed = adapter.parseWebhookEvent(raw, {});
      expect(parsed.type).toBe('subscription.cancelled');
      expect(parsed.providerSubscriptionId).toBe('sub_1');
    });

    it('maps subscription.halted to subscription.failed', () => {
      const raw = JSON.stringify({
        event: 'subscription.halted',
        payload: { subscription: { entity: { id: 'sub_1', status: 'halted' } } },
      });
      const parsed = adapter.parseWebhookEvent(raw, {});
      expect(parsed.type).toBe('subscription.failed');
      expect(parsed.providerSubscriptionId).toBe('sub_1');
    });

    it('maps a subscription-linked payment.failed to subscription.failed', () => {
      const raw = JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: { entity: { id: 'pay_1', amount: 49900, currency: 'INR', status: 'failed', subscription_id: 'sub_1' } },
        },
      });
      const parsed = adapter.parseWebhookEvent(raw, {});
      expect(parsed.type).toBe('subscription.failed');
      expect(parsed.providerSubscriptionId).toBe('sub_1');
      expect(parsed.amount).toBe(499);
    });

    it('throws UnsupportedRazorpayWebhookEventError for a non-subscription payment.failed', () => {
      const raw = JSON.stringify({
        event: 'payment.failed',
        payload: { payment: { entity: { id: 'pay_1', amount: 1000, currency: 'INR', status: 'failed' } } },
      });
      expect(() => adapter.parseWebhookEvent(raw, {})).toThrow(UnsupportedRazorpayWebhookEventError);
    });

    it.each(['subscription.authenticated', 'subscription.pending', 'subscription.paused', 'subscription.resumed', 'subscription.completed', 'subscription.updated'])(
      'throws UnsupportedRazorpayWebhookEventError for unmapped event "%s"',
      (event) => {
        const raw = JSON.stringify({ event, payload: { subscription: { entity: { id: 'sub_1' } } } });
        expect(() => adapter.parseWebhookEvent(raw, {})).toThrow(UnsupportedRazorpayWebhookEventError);
      },
    );

    it('throws for a completely unknown event name', () => {
      const raw = JSON.stringify({ event: 'refund.processed', payload: {} });
      expect(() => adapter.parseWebhookEvent(raw, {})).toThrow(UnsupportedRazorpayWebhookEventError);
    });

    it('throws RazorpayAdapterError if a mapped event is missing the subscription id', () => {
      const raw = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: {} } } });
      expect(() => adapter.parseWebhookEvent(raw, {})).toThrow(RazorpayAdapterError);
    });
  });
});
