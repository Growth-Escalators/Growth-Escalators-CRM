import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mintSigningToken,
  verifySigningToken,
  hashSigningToken,
} from '../modules/esign/contract-signing-link';

let saved: string | undefined;
beforeAll(() => {
  saved = process.env.CONTRACTS_SIGNING_SECRET;
  process.env.CONTRACTS_SIGNING_SECRET = 'test-signing-secret-please-change';
});
afterAll(() => {
  if (saved === undefined) delete process.env.CONTRACTS_SIGNING_SECRET;
  else process.env.CONTRACTS_SIGNING_SECRET = saved;
});

describe('contract signing link (HMAC)', () => {
  it('mints and verifies a token round-trip', () => {
    const token = mintSigningToken('contract-1', 'recipient-1');
    const payload = verifySigningToken(token);
    expect(payload?.contractId).toBe('contract-1');
    expect(payload?.recipientId).toBe('recipient-1');
    expect(typeof payload?.iat).toBe('number');
  });

  it('rejects a tampered signature or payload', () => {
    const token = mintSigningToken('c', 'r');
    const [payloadB64, sig] = token.split('.');
    expect(verifySigningToken(`${payloadB64}.${sig.slice(0, -2)}XY`)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ contractId: 'c', recipientId: 'EVIL', iat: 1 })).toString('base64url');
    expect(verifySigningToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifySigningToken('')).toBeNull();
    expect(verifySigningToken('no-dot')).toBeNull();
    expect(verifySigningToken('a.b.c')).toBeNull();
  });

  it('does not verify a token signed with a different secret', () => {
    const token = mintSigningToken('c', 'r');
    process.env.CONTRACTS_SIGNING_SECRET = 'a-different-secret';
    expect(verifySigningToken(token)).toBeNull();
    process.env.CONTRACTS_SIGNING_SECRET = 'test-signing-secret-please-change';
  });

  it('hashSigningToken is deterministic hex', () => {
    const token = mintSigningToken('c', 'r');
    expect(hashSigningToken(token)).toBe(hashSigningToken(token));
    expect(hashSigningToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed when the secret is unset', () => {
    delete process.env.CONTRACTS_SIGNING_SECRET;
    expect(() => mintSigningToken('c', 'r')).toThrow(/not configured/);
    expect(verifySigningToken('anything.here')).toBeNull();
    process.env.CONTRACTS_SIGNING_SECRET = 'test-signing-secret-please-change';
  });
});
