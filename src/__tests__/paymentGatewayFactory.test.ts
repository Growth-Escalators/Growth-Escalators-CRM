import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PaymentGatewayAdapter } from '../services/paymentGateway/types';

function stubAdapter(provider: 'cashfree' | 'razorpay', marker?: string): PaymentGatewayAdapter {
  return {
    provider,
    createSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    parseWebhookEvent: vi.fn(),
    // extra marker property (not part of the interface) purely so tests can
    // distinguish "which registration won" via toBe/toMatchObject.
    ...(marker ? { marker } : {}),
  } as PaymentGatewayAdapter & { marker?: string };
}

describe('paymentGateway factory + registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('self-registers a mock adapter for both cashfree and razorpay on import (mockAdapter.ts side effect)', async () => {
    const { getPaymentGatewayAdapter } = await import('../services/paymentGateway');
    expect(getPaymentGatewayAdapter('cashfree').provider).toBe('cashfree');
    expect(getPaymentGatewayAdapter('razorpay').provider).toBe('razorpay');
  });

  it('throws a clear error for a provider nothing has registered', async () => {
    const { getPaymentGatewayAdapter, __resetPaymentGatewayRegistryForTests } = await import(
      '../services/paymentGateway/registry'
    );
    __resetPaymentGatewayRegistryForTests();
    expect(() => getPaymentGatewayAdapter('cashfree')).toThrow(/no adapter registered for provider 'cashfree'/);
  });

  it('registering the same provider twice replaces the prior registration (last wins) — this is how a real adapter PR replaces the mock', async () => {
    const { registerPaymentGatewayAdapter, getPaymentGatewayAdapter, __resetPaymentGatewayRegistryForTests } =
      await import('../services/paymentGateway/registry');
    __resetPaymentGatewayRegistryForTests();

    const mockOne = stubAdapter('cashfree', 'mock');
    const realOne = stubAdapter('cashfree', 'real');
    registerPaymentGatewayAdapter(mockOne);
    registerPaymentGatewayAdapter(realOne);

    expect(getPaymentGatewayAdapter('cashfree')).toBe(realOne);
    expect(getPaymentGatewayAdapter('cashfree')).not.toBe(mockOne);
  });

  it('registrations for different providers do not clobber each other', async () => {
    const { registerPaymentGatewayAdapter, getPaymentGatewayAdapter, __resetPaymentGatewayRegistryForTests } =
      await import('../services/paymentGateway/registry');
    __resetPaymentGatewayRegistryForTests();

    const cashfreeAdapter = stubAdapter('cashfree');
    const razorpayAdapter = stubAdapter('razorpay');
    registerPaymentGatewayAdapter(cashfreeAdapter);
    registerPaymentGatewayAdapter(razorpayAdapter);

    expect(getPaymentGatewayAdapter('cashfree')).toBe(cashfreeAdapter);
    expect(getPaymentGatewayAdapter('razorpay')).toBe(razorpayAdapter);
  });
});

describe('mock adapter (createMockAdapter) contract shape', () => {
  it('createSubscription returns a providerSubscriptionId + authorizationUrl', async () => {
    const { createMockAdapter } = await import('../services/paymentGateway/mockAdapter');
    const adapter = createMockAdapter('cashfree');
    const result = await adapter.createSubscription({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      customerEmail: 'a@b.com',
      returnUrl: 'https://example.test/thank-you',
    });
    expect(result.providerSubscriptionId).toMatch(/^mock_cashfree_sub_/);
    expect(result.authorizationUrl).toContain(result.providerSubscriptionId);
  });

  it('verifyWebhookSignature only accepts the fixed test scheme for its own provider', async () => {
    const { createMockAdapter } = await import('../services/paymentGateway/mockAdapter');
    const adapter = createMockAdapter('cashfree');
    expect(adapter.verifyWebhookSignature('{}', { 'x-mock-signature': 'valid:cashfree' })).toBe(true);
    expect(adapter.verifyWebhookSignature('{}', { 'x-mock-signature': 'valid:razorpay' })).toBe(false);
    expect(adapter.verifyWebhookSignature('{}', {})).toBe(false);
  });

  it('parseWebhookEvent normalizes the raw JSON body', async () => {
    const { createMockAdapter } = await import('../services/paymentGateway/mockAdapter');
    const adapter = createMockAdapter('razorpay');
    const rawBody = JSON.stringify({
      type: 'subscription.charged',
      providerSubscriptionId: 'sub_abc',
      amount: 499,
      currency: 'INR',
    });
    const event = adapter.parseWebhookEvent(rawBody, {});
    expect(event).toEqual({
      type: 'subscription.charged',
      providerSubscriptionId: 'sub_abc',
      amount: 499,
      currency: 'INR',
      raw: JSON.parse(rawBody),
    });
  });
});
