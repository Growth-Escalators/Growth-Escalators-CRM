import { createHmac } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateMetaWebhook } from '../middleware/validateWebhook';
import { verifyWebhookSignature } from '../routes/webhooks';

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    send(body: unknown) { this.body = body; return this; },
  };
  return res as unknown as import('express').Response & { statusCode: number; body: unknown };
}

describe('validateMetaWebhook', () => {
  const originalSecret = process.env.META_APP_SECRET;

  beforeEach(() => {
    process.env.META_APP_SECRET = 'test-meta-secret';
  });

  afterEach(() => {
    process.env.META_APP_SECRET = originalSecret;
  });

  it('handles the GET verification challenge independent of the POST signature secret', () => {
    process.env.META_VERIFY_TOKEN = 'verify-me';
    const req = { method: 'GET', query: { 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' } } as unknown as import('express').Request;
    const res = makeRes();
    validateMetaWebhook(req, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('12345');
  });

  it('rejects with 503 when META_APP_SECRET is unset (fails closed, H3)', () => {
    delete process.env.META_APP_SECRET;
    const req = { method: 'POST', headers: {}, rawBody: '{}' } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    validateMetaWebhook(req, res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the signature header is missing', () => {
    const req = { method: 'POST', headers: {}, rawBody: '{}' } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    validateMetaWebhook(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when rawBody is unavailable', () => {
    const req = { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=deadbeef' } } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    validateMetaWebhook(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the signature does not match the raw body (forged payload)', () => {
    const rawBody = JSON.stringify({ object: 'whatsapp_business_account' });
    const req = {
      method: 'POST',
      headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) },
      rawBody,
    } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    validateMetaWebhook(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a signature computed over the exact raw body bytes (H4 — not a re-serialization)', () => {
    // Deliberately use a body whose re-serialized JSON.stringify(req.body)
    // would NOT match the original bytes (extra whitespace) — if the
    // implementation ever regresses to signing JSON.stringify(req.body)
    // instead of rawBody, this test starts failing.
    const rawBody = '{ "object": "whatsapp_business_account",  "entry": [] }';
    const signature = 'sha256=' + createHmac('sha256', 'test-meta-secret').update(rawBody).digest('hex');
    const req = {
      method: 'POST',
      headers: { 'x-hub-signature-256': signature },
      rawBody,
      body: JSON.parse(rawBody),
    } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    validateMetaWebhook(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('verifyWebhookSignature (Cal.com / Tally / Chatwoot)', () => {
  it('returns false (fails closed) when no secret is configured (H3)', () => {
    expect(verifyWebhookSignature(undefined, '{"a":1}', 'sha256=whatever')).toBe(false);
  });

  it('returns false when the signature header is missing', () => {
    expect(verifyWebhookSignature('secret', '{"a":1}', undefined)).toBe(false);
  });

  it('returns false for a mismatched signature', () => {
    expect(verifyWebhookSignature('secret', '{"a":1}', 'deadbeef')).toBe(false);
  });

  it('returns true for a valid signature computed over the exact raw body, with or without the sha256= prefix', () => {
    const rawBody = '{"a":1,"b":"two"}';
    const digest = createHmac('sha256', 'secret').update(rawBody).digest('hex');
    expect(verifyWebhookSignature('secret', rawBody, digest)).toBe(true);
    expect(verifyWebhookSignature('secret', rawBody, `sha256=${digest}`)).toBe(true);
  });
});
