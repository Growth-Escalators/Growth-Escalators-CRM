import { describe, it, expect, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from '../utils/integrationCrypto';

describe('integrationCrypto (AES-256-GCM for tenant_integrations.encrypted_credentials)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('round-trips a plaintext payload through encrypt/decrypt', () => {
    process.env.TEST_ENCRYPTION_KEY = 'a-test-key-that-is-long-enough';
    const plaintext = JSON.stringify({ accessToken: 'EAABsbCS1', tokenType: 'bearer', expiresAt: '2026-10-01T00:00:00.000Z' });
    const encrypted = encryptSecret(plaintext, 'TEST_ENCRYPTION_KEY');
    expect(encrypted).not.toContain('EAABsbCS1'); // never stores plaintext
    expect(decryptSecret(encrypted, 'TEST_ENCRYPTION_KEY')).toBe(plaintext);
  });

  it('produces a different ciphertext for the same plaintext on each call (random salt+iv)', () => {
    process.env.TEST_ENCRYPTION_KEY = 'a-test-key-that-is-long-enough';
    const plaintext = 'same-plaintext';
    const a = encryptSecret(plaintext, 'TEST_ENCRYPTION_KEY');
    const b = encryptSecret(plaintext, 'TEST_ENCRYPTION_KEY');
    expect(a).not.toBe(b);
    expect(decryptSecret(a, 'TEST_ENCRYPTION_KEY')).toBe(plaintext);
    expect(decryptSecret(b, 'TEST_ENCRYPTION_KEY')).toBe(plaintext);
  });

  it('throws (fails closed) when the env var is not set', () => {
    delete process.env.TEST_ENCRYPTION_KEY;
    expect(() => encryptSecret('x', 'TEST_ENCRYPTION_KEY')).toThrow(/TEST_ENCRYPTION_KEY must be set/);
  });

  it('throws (does not silently return garbage) when decrypting with the wrong key', () => {
    process.env.TEST_ENCRYPTION_KEY = 'key-one-is-long-enough-too';
    const encrypted = encryptSecret('secret-value', 'TEST_ENCRYPTION_KEY');
    process.env.TEST_ENCRYPTION_KEY = 'a-totally-different-key-value';
    expect(() => decryptSecret(encrypted, 'TEST_ENCRYPTION_KEY')).toThrow();
  });

  it('throws on a tampered ciphertext (GCM auth tag catches it)', () => {
    process.env.TEST_ENCRYPTION_KEY = 'a-test-key-that-is-long-enough';
    const encrypted = encryptSecret('secret-value', 'TEST_ENCRYPTION_KEY');
    const parts = encrypted.split(':');
    // Flip a hex character in the ciphertext segment.
    const tamperedData = parts[3].slice(0, -1) + (parts[3].slice(-1) === '0' ? '1' : '0');
    const tampered = [parts[0], parts[1], parts[2], tamperedData].join(':');
    expect(() => decryptSecret(tampered, 'TEST_ENCRYPTION_KEY')).toThrow();
  });

  it('throws on a malformed payload shape', () => {
    process.env.TEST_ENCRYPTION_KEY = 'a-test-key-that-is-long-enough';
    expect(() => decryptSecret('not-the-right-format', 'TEST_ENCRYPTION_KEY')).toThrow(/malformed/);
  });
});
