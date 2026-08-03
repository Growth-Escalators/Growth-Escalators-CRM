// ---------------------------------------------------------------------------
// AES-256-GCM encryption for `tenant_integrations.encrypted_credentials`.
//
// Deliberately NOT a copy of `src/routes/social.ts`'s inline encrypt/decrypt
// (AES-256-CBC, no auth tag, and a hardcoded static scrypt salt — the salt
// means every value encrypted with the same key derives the same AES key,
// so a leaked key + ciphertext pair is slightly easier to attack at scale,
// and CBC has no built-in tamper detection). This module:
//   - uses GCM, which is authenticated: any bit-flip in the ciphertext or a
//     wrong key fails `decipher.final()` loudly instead of returning garbage.
//   - derives a fresh random salt per encryption call, so two calls with the
//     same plaintext and the same key never produce the same derived AES key.
//
// Key material comes ONLY from an env var — see `requiredSecret` below. There
// is no hardcoded fallback (unlike most of src/config/constants.ts): this
// value is a real encryption key, not a channel id, and must never ship with
// a default.
// ---------------------------------------------------------------------------
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // NIST-recommended IV length for GCM
const KEY_LENGTH = 32; // AES-256
const AUTH_TAG_LENGTH = 16;

/** Default env var read when no explicit one is passed. Callers that manage
 * more than one credential class (e.g. a future non-Meta provider) may pass a
 * different env var name so they can rotate keys independently. */
export const DEFAULT_INTEGRATION_ENCRYPTION_ENV_VAR = 'TENANT_INTEGRATION_ENCRYPTION_KEY';

function requiredSecret(envVar: string): string {
  const secret = process.env[envVar];
  if (!secret) {
    throw new Error(
      `${envVar} must be set to encrypt/decrypt tenant_integrations credentials — ` +
      'never falls back to a hardcoded key.',
    );
  }
  return secret;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt `plaintext` (typically a JSON-stringified token bundle) into a
 * single colon-delimited hex string: `salt:iv:authTag:ciphertext`. Every
 * component except the key itself travels with the ciphertext, so decryption
 * needs only the same env var value.
 */
export function encryptSecret(
  plaintext: string,
  envVar: string = DEFAULT_INTEGRATION_ENCRYPTION_ENV_VAR,
): string {
  const secret = requiredSecret(envVar);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(secret, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

/**
 * Reverse of `encryptSecret`. Throws (does not silently return '') on any
 * failure — a corrupted/tampered ciphertext or wrong key must fail loudly,
 * not hand back an empty string that a caller might mistake for "no token".
 */
export function decryptSecret(
  payload: string,
  envVar: string = DEFAULT_INTEGRATION_ENCRYPTION_ENV_VAR,
): string {
  const secret = requiredSecret(envVar);
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new Error('malformed encrypted payload — expected salt:iv:authTag:ciphertext');
  }
  const [saltHex, ivHex, tagHex, dataHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('malformed encrypted payload — invalid auth tag length');
  }

  const key = deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
