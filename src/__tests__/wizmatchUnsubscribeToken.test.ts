// PRD-005 §12/§18.1, D-36 (owner-ratified 2026-07-26) — tenant-bound,
// versioned unsubscribe tokens. U-8 regression coverage: a v2 token signs
// tenant_id directly, so verification never needs to guess a tenant; a v1
// (legacy) token's signature can still be checked, but tenant resolution is
// the caller's job (routes/wizmatch.ts), not this module's.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

let secret = 'test-secret';
vi.mock('../config/constants', () => ({
  get WIZMATCH_UNSUBSCRIBE_HMAC_SECRET() { return secret; },
}));

import { mintUnsubscribeToken, verifyUnsubscribeTokenV2, verifyLegacyUnsubscribeSignature } from '../modules/outreach/unsubscribeToken';

beforeEach(() => {
  secret = 'test-secret';
});

describe('mintUnsubscribeToken / verifyUnsubscribeTokenV2', () => {
  it('mints a token that verifies for the same tenant/email', () => {
    const token = mintUnsubscribeToken('tenant-1', 'Jane@Acme.com');
    expect(token).not.toBeNull();
    const verified = verifyUnsubscribeTokenV2({ tenantId: token!.tenantId, email: token!.email, exp: String(token!.exp), sig: token!.sig });
    expect(verified).toEqual({ ok: true, tenantId: 'tenant-1', email: 'jane@acme.com' });
  });

  it('returns null (fails closed) when no secret is configured', () => {
    secret = '';
    expect(mintUnsubscribeToken('tenant-1', 'jane@acme.com')).toBeNull();
  });

  it('rejects a token minted for a DIFFERENT tenant — the whole point of D-36', () => {
    const token = mintUnsubscribeToken('tenant-1', 'jane@acme.com')!;
    // An attacker (or a bug) supplying a different tenantId must not verify,
    // even with the correct email/exp/sig for tenant-1 — this is the
    // U-8-fixing property: the tenant is IN the signed payload.
    const verified = verifyUnsubscribeTokenV2({ tenantId: 'tenant-2', email: token.email, exp: String(token.exp), sig: token.sig });
    expect(verified).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered email', () => {
    const token = mintUnsubscribeToken('tenant-1', 'jane@acme.com')!;
    const verified = verifyUnsubscribeTokenV2({ tenantId: token.tenantId, email: 'someoneelse@acme.com', exp: String(token.exp), sig: token.sig });
    expect(verified.ok).toBe(false);
  });

  it('rejects a tampered exp value (it is part of the signed payload, not free-form)', () => {
    const token = mintUnsubscribeToken('tenant-1', 'jane@acme.com')!;
    const verified = verifyUnsubscribeTokenV2({ tenantId: token.tenantId, email: token.email, exp: String(Date.now() - 1000), sig: token.sig });
    // Signature is over the ORIGINAL exp value; supplying an earlier exp
    // changes the signed payload, so this fails as bad_signature — proving
    // exp cannot be shortened by an attacker either.
    expect(verified).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a genuinely expired token minted in the past', () => {
    const secretNow = secret;
    const pastExp = Date.now() - 1000;
    const sig = crypto.createHmac('sha256', secretNow).update(`2:tenant-1:jane@acme.com:${pastExp}`).digest('base64url');
    const verified = verifyUnsubscribeTokenV2({ tenantId: 'tenant-1', email: 'jane@acme.com', exp: String(pastExp), sig });
    expect(verified).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed/missing params', () => {
    expect(verifyUnsubscribeTokenV2({ tenantId: 'tenant-1', email: 'jane@acme.com' })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('fails closed with missing_secret when unset', () => {
    secret = '';
    expect(verifyUnsubscribeTokenV2({ tenantId: 't', email: 'e@x.com', exp: '1', sig: 's' })).toEqual({ ok: false, reason: 'missing_secret' });
  });
});

describe('verifyLegacyUnsubscribeSignature', () => {
  it('accepts a v1-style signature (email only)', () => {
    const sig = crypto.createHmac('sha256', secret).update('jane@acme.com').digest('base64url');
    expect(verifyLegacyUnsubscribeSignature('Jane@Acme.com', sig)).toBe(true);
  });

  it('rejects a bad legacy signature', () => {
    expect(verifyLegacyUnsubscribeSignature('jane@acme.com', 'not-a-real-sig')).toBe(false);
  });

  it('fails closed with no secret', () => {
    secret = '';
    expect(verifyLegacyUnsubscribeSignature('jane@acme.com', 'anything')).toBe(false);
  });
});
