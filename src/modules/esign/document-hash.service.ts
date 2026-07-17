// SHA-256 hashing for contract document artifacts. Every stored artifact
// (source / generated / completed / audit certificate) gets a hash persisted in
// Postgres so the completed PDF can be independently verified against the DB
// record later. Pure module — no I/O — for easy unit testing.
import crypto from 'crypto';

/** Lowercase hex SHA-256 of a buffer. */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Constant-time comparison of a buffer's SHA-256 against an expected hex digest.
 * Returns false (never throws) on a malformed expected value.
 */
export function verifyHash(buf: Buffer, expectedHex: string): boolean {
  if (typeof expectedHex !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const actual = Buffer.from(sha256Hex(buf), 'hex');
  const expected = Buffer.from(expectedHex.toLowerCase(), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
