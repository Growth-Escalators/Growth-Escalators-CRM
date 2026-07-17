// Per-recipient signed signing links for external signers who have NO CRM
// account. Stateless HMAC over {contractId, recipientId} (mirrors the wizmatch
// unsubscribe pattern) — fails closed if CONTRACTS_SIGNING_SECRET is unset.
// The token's SHA-256 is also stored on the recipient row so re-issuing (a new
// version / re-send) invalidates older links.
import crypto from 'crypto';

export interface SigningTokenPayload {
  contractId: string;
  recipientId: string;
  /** issued-at (ms) — informational; expiry is enforced via the contract row. */
  iat: number;
}

function secret(): string {
  const s = process.env.CONTRACTS_SIGNING_SECRET?.trim();
  if (!s) throw new Error('CONTRACTS_SIGNING_SECRET is not configured — signing links are disabled');
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadB64: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

/** Mint a signing token for a recipient. */
export function mintSigningToken(contractId: string, recipientId: string): string {
  const payload: SigningTokenPayload = { contractId, recipientId, iat: Date.now() };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** SHA-256 of a token — persisted on the recipient row for match/revocation. */
export function hashSigningToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify a signing token's HMAC (constant-time) and return its payload, or null
 * if malformed/invalid. Does NOT check the DB — the caller must additionally
 * confirm the token's hash matches the recipient's stored signingTokenHash and
 * that the contract is in a signable state.
 */
export function verifySigningToken(token: string): SigningTokenPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.', 2);
  if (!payloadB64 || !sig) return null;
  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch {
    return null; // secret unset → fail closed
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SigningTokenPayload;
    if (!payload?.contractId || !payload?.recipientId) return null;
    return payload;
  } catch {
    return null;
  }
}
