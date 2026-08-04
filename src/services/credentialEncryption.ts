/**
 * Authenticated encryption for tenant integration credentials
 * (`tenant_integrations.encrypted_credentials`).
 *
 * Uses AES-256-GCM — an AEAD cipher, not plain AES-CBC or base64. GCM gives
 * two guarantees a non-authenticated cipher (or base64 "obfuscation") does
 * not:
 *   1. Confidentiality — the plaintext secret is unrecoverable without the key.
 *   2. Integrity/authenticity — any bit-flip in the ciphertext, IV, or auth
 *      tag (e.g. a corrupted column, a bug that half-writes a row, a
 *      malicious edit) makes `decrypt()` throw instead of silently returning
 *      garbage or the wrong tenant's shape of data. See
 *      `credentialEncryption.test.ts` "tamper detection" cases.
 *
 * The key comes from `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY` — a NEW,
 * dedicated env var (never a hardcoded constant, never reused from
 * JWT_SECRET/SOCIAL_ENCRYPTION_KEY the way `src/routes/social.ts` does today).
 * It must be a base64-encoded 32-byte key, e.g. generated with:
 *
 *   openssl rand -base64 32
 *
 * The key is read fresh on every call (never cached at import time) so a
 * rotated env var takes effect without a process restart — same posture as
 * the `AUTOMATED_EMAILS_ENABLED` / `WIZMATCH_MAILER_EMERGENCY_OVERRIDE` reads
 * in `multiDomainMailer.ts`.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // NIST-recommended IV length for GCM
const FORMAT_VERSION = 'v1';

/**
 * Reads and validates the encryption key from the environment. Throws a
 * clear, actionable error rather than silently deriving a weaker key from
 * something the wrong length, or falling back to another secret.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'INTEGRATION_CREDENTIALS_ENCRYPTION_KEY is not set — required to encrypt/decrypt tenant integration credentials. ' +
      'Generate one with: openssl rand -base64 32',
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('INTEGRATION_CREDENTIALS_ENCRYPTION_KEY is not valid base64');
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes ` +
      `(a base64-encoded AES-256 key); got ${key.length} bytes. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string (e.g. a JSON-stringified credentials object)
 * into a versioned, self-describing ciphertext string safe to store in
 * `tenant_integrations.encrypted_credentials`.
 *
 * Format: `v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>`
 */
export function encryptCredentials(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [FORMAT_VERSION, iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * Decrypts a ciphertext string produced by `encryptCredentials`. Throws if:
 *   - the payload is malformed (wrong shape/version)
 *   - the ciphertext, IV, or auth tag were tampered with or corrupted — GCM's
 *     auth tag check fails closed, it never returns wrong/garbage plaintext.
 */
export function decryptCredentials(payload: string): string {
  const key = getEncryptionKey();
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error('malformed encrypted credentials payload (unexpected format/version)');
  }
  const [, ivB64, authTagB64, dataB64] = parts;

  let iv: Buffer;
  let authTag: Buffer;
  let encrypted: Buffer;
  try {
    iv = Buffer.from(ivB64, 'base64');
    authTag = Buffer.from(authTagB64, 'base64');
    encrypted = Buffer.from(dataB64, 'base64');
  } catch {
    throw new Error('malformed encrypted credentials payload (invalid base64)');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Throws here (via cipher.final()) if the auth tag doesn't match the
  // ciphertext — this is the tamper-detection guarantee.
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Convenience wrapper: encrypt a JSON-serialisable credentials object. */
export function encryptCredentialsJSON(value: unknown): string {
  return encryptCredentials(JSON.stringify(value));
}

/** Convenience wrapper: decrypt + JSON.parse. Throws on tamper or bad JSON. */
export function decryptCredentialsJSON<T = unknown>(payload: string): T {
  return JSON.parse(decryptCredentials(payload)) as T;
}
