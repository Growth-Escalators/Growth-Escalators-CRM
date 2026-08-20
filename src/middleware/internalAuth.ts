/**
 * Internal token middleware for Wizmatch cron/CI endpoints.
 *
 * Extracted from the checkInternalSecret pattern in imapReplies.ts /
 * outreachLeads.ts, but uses a dedicated WIZMATCH_INTERNAL_TOKEN env var
 * (falls back to OUTREACH_INTERNAL_SECRET for convenience if not set).
 */
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import logger from '../utils/logger';

/**
 * Constant-time comparison of a caller-supplied header value against a secret.
 *
 * QA 2026-07-30 (security-lane finding A2): this logic lived only inside
 * `requireInternalToken`, while `outreachLeads.ts` and `imapReplies.ts` — which
 * guard the SAME `OUTREACH_INTERNAL_SECRET` — used a plain `!==`. `!==` on
 * strings short-circuits at the first differing byte, leaking length and prefix
 * information through timing. One of those endpoints also gates a
 * Google-Places-cost-incurring path, so a recovered secret costs money as well
 * as access. Shared here so the three call sites cannot drift again.
 *
 * Returns false for a missing value, and for the `string[]` shape Express
 * produces on a repeated header (taking the first entry rather than trusting a
 * whole array to compare).
 */
export function timingSafeSecretMatch(provided: string | string[] | undefined, expected: string): boolean {
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  // Length-guard first: timingSafeEqual throws on unequal lengths. Length is
  // already observable from the header itself, so this leaks nothing new.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  // WizMatch's cron/CI ingestion lane is retired in production. Fail before
  // consulting any old secret so stale GitHub/Railway credentials cannot be
  // used to wake the product back up accidentally. Local/test behavior stays
  // available for historical verification until the dead code is removed.
  if (process.env.NODE_ENV === 'production') {
    res.status(410).json({ error: 'wizmatch_retired' });
    return;
  }

  const token = process.env.WIZMATCH_INTERNAL_TOKEN || process.env.OUTREACH_INTERNAL_SECRET;
  if (!token) {
    logger.error('[wizmatch] WIZMATCH_INTERNAL_TOKEN not set — blocking internal request');
    res.status(401).json({ error: 'internal token not configured' });
    return;
  }
  if (!timingSafeSecretMatch(req.headers['x-internal-secret'], token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
