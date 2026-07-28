// PRD-005 §12 / §18.1, D-36 (owner-ratified 2026-07-26) — tenant-bound,
// versioned unsubscribe tokens.
//
// U-8 (PR 3 review) fixed only "hardcoded env tenant" -> "most recent
// sender wins", which is still wrong whenever a second tenant mailed the
// same address more recently: the HMAC signed only the email, so the token
// itself carried no tenant and could not disambiguate. D-36 fixes this at
// the root: the token now signs `tenant_id + normalised email + expiry`
// directly, so verification never needs to guess a tenant at all.
//
// Legacy (v1) tokens — already-sent emails whose links are signed the old
// way (email only, no tenant/expiry) — are still accepted, but ONLY when
// exactly one tenant resolves deterministically from send history. An
// ambiguous multi-tenant legacy token is rejected, not guessed, and every
// legacy verification (accepted or rejected) is audited so the operator can
// see how much legacy traffic remains.

import crypto from 'node:crypto';
import { WIZMATCH_UNSUBSCRIBE_HMAC_SECRET } from '../../config/constants';

const TOKEN_VERSION = '2';
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days — an unsubscribe link may sit unread in an inbox for a long time.

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function canonicalPayload(tenantId: string, email: string, exp: number): string {
  return `${TOKEN_VERSION}:${tenantId}:${email}:${exp}`;
}

export interface MintedUnsubscribeToken {
  tenantId: string;
  email: string;
  exp: number;
  sig: string;
}

/** Mint side. Returns `null` when no secret is configured — callers must fail closed, never mint an unsigned/forgeable link. */
export function mintUnsubscribeToken(tenantId: string, email: string): MintedUnsubscribeToken | null {
  const secret = WIZMATCH_UNSUBSCRIBE_HMAC_SECRET;
  if (!secret || !tenantId) return null;
  const normalisedEmail = email.trim().toLowerCase();
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', secret).update(canonicalPayload(tenantId, normalisedEmail, exp)).digest('base64url');
  return { tenantId, email: normalisedEmail, exp, sig };
}

export type UnsubscribeVerification =
  | { ok: true; tenantId: string; email: string }
  | { ok: false; reason: 'missing_secret' | 'malformed' | 'bad_signature' | 'expired' };

/** Verify side for a v2 (tenant-bound) token — no tenant lookup needed; the token carries it. */
export function verifyUnsubscribeTokenV2(params: {
  tenantId?: string | null;
  email?: string | null;
  exp?: string | null;
  sig?: string | null;
}): UnsubscribeVerification {
  const secret = WIZMATCH_UNSUBSCRIBE_HMAC_SECRET;
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!params.tenantId || !params.email || !params.exp || !params.sig) return { ok: false, reason: 'malformed' };
  const exp = Number(params.exp);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed' };
  const normalisedEmail = params.email.trim().toLowerCase();
  const expectedSig = crypto.createHmac('sha256', secret).update(canonicalPayload(params.tenantId, normalisedEmail, exp)).digest('base64url');
  if (!timingSafeEqualStrings(params.sig, expectedSig)) return { ok: false, reason: 'bad_signature' };
  if (Date.now() > exp) return { ok: false, reason: 'expired' };
  return { ok: true, tenantId: params.tenantId, email: normalisedEmail };
}

/** Verify side for a legacy (v1, email-only) token. Returns whether the signature itself is valid — tenant resolution is the caller's job, per D-36's "exactly one tenant resolves deterministically" rule. */
export function verifyLegacyUnsubscribeSignature(email: string, sig: string | undefined | null): boolean {
  const secret = WIZMATCH_UNSUBSCRIBE_HMAC_SECRET;
  if (!secret || !sig) return false;
  const normalisedEmail = email.trim().toLowerCase();
  const expectedSig = crypto.createHmac('sha256', secret).update(normalisedEmail).digest('base64url');
  return timingSafeEqualStrings(sig, expectedSig);
}
