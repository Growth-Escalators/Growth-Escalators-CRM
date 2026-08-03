import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import {
  decryptCredentials,
  decryptCredentialsJSON,
  encryptCredentials,
  encryptCredentialsJSON,
} from '../services/credentialEncryption';

describe('credentialEncryption', () => {
  const originalEnv = { ...process.env };
  const VALID_KEY = crypto.randomBytes(32).toString('base64');

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('round trip', () => {
    it('encrypt -> decrypt returns the exact original plaintext', () => {
      const plaintext = 'super-secret-smtp-password-123!@#';
      const ciphertext = encryptCredentials(plaintext);
      expect(ciphertext).not.toContain(plaintext); // not plaintext, not base64-of-plaintext
      expect(decryptCredentials(ciphertext)).toBe(plaintext);
    });

    it('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
      const plaintext = 'same-secret';
      const a = encryptCredentials(plaintext);
      const b = encryptCredentials(plaintext);
      expect(a).not.toBe(b);
      expect(decryptCredentials(a)).toBe(plaintext);
      expect(decryptCredentials(b)).toBe(plaintext);
    });

    it('round-trips a JSON credentials object via encryptCredentialsJSON/decryptCredentialsJSON', () => {
      const creds = { host: 'smtp.example.test', port: 587, user: 'hello@example.test', pass: 'p@ssw0rd!' };
      const ciphertext = encryptCredentialsJSON(creds);
      expect(ciphertext).not.toContain('p@ssw0rd!');
      expect(ciphertext).not.toContain('smtp.example.test');
      expect(decryptCredentialsJSON(ciphertext)).toEqual(creds);
    });

    it('handles empty-string and unicode plaintext', () => {
      expect(decryptCredentials(encryptCredentials(''))).toBe('');
      const unicode = '密码 🔒 pässwörd';
      expect(decryptCredentials(encryptCredentials(unicode))).toBe(unicode);
    });
  });

  describe('tamper detection (proves this is authenticated encryption, not just encryption)', () => {
    it('rejects a flipped bit in the ciphertext', () => {
      const ciphertext = encryptCredentials('the-secret-value');
      const [version, iv, tag, data] = ciphertext.split(':');
      const bytes = Buffer.from(data, 'base64');
      bytes[0] = bytes[0] ^ 0xff; // flip a bit
      const tampered = [version, iv, tag, bytes.toString('base64')].join(':');
      expect(() => decryptCredentials(tampered)).toThrow();
    });

    it('rejects a flipped bit in the auth tag', () => {
      const ciphertext = encryptCredentials('the-secret-value');
      const [version, iv, tag, data] = ciphertext.split(':');
      const bytes = Buffer.from(tag, 'base64');
      bytes[0] = bytes[0] ^ 0xff;
      const tampered = [version, iv, bytes.toString('base64'), data].join(':');
      expect(() => decryptCredentials(tampered)).toThrow();
    });

    it('rejects a swapped IV (ciphertext from one message decrypted with another\'s IV)', () => {
      const a = encryptCredentials('message-a');
      const b = encryptCredentials('message-b');
      const [, ivA] = a.split(':');
      const [versionB, , tagB, dataB] = b.split(':');
      const mixed = [versionB, ivA, tagB, dataB].join(':');
      expect(() => decryptCredentials(mixed)).toThrow();
    });

    it('rejects a payload truncated mid-ciphertext', () => {
      const ciphertext = encryptCredentials('the-secret-value');
      expect(() => decryptCredentials(ciphertext.slice(0, -8))).toThrow();
    });

    it('rejects a malformed payload (wrong number of segments)', () => {
      expect(() => decryptCredentials('not-a-valid-payload')).toThrow(/malformed/);
      expect(() => decryptCredentials('v1:onlytwo')).toThrow(/malformed/);
    });

    it('rejects a payload claiming an unknown format version', () => {
      const ciphertext = encryptCredentials('the-secret-value');
      const parts = ciphertext.split(':');
      parts[0] = 'v2';
      expect(() => decryptCredentials(parts.join(':'))).toThrow(/malformed/);
    });

    it('decrypting with the wrong key fails (not silently wrong plaintext)', () => {
      const ciphertext = encryptCredentials('the-secret-value');
      process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
      expect(() => decryptCredentials(ciphertext)).toThrow();
    });
  });

  describe('key configuration', () => {
    it('throws a clear, actionable error when the env var is unset', () => {
      delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
      expect(() => encryptCredentials('x')).toThrow(/INTEGRATION_CREDENTIALS_ENCRYPTION_KEY/);
    });

    it('throws when the key does not decode to exactly 32 bytes', () => {
      process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
      expect(() => encryptCredentials('x')).toThrow(/32 bytes/);
    });

    it('never silently truncates/pads a wrong-length key — no output is produced', () => {
      process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(16).toString('base64');
      expect(() => encryptCredentials('x')).toThrow();
    });
  });
});
