/**
 * Shared-secret middleware for internal/service-to-service endpoints
 * (`x-internal-secret` header), applied at the route level.
 *
 * Extracted from the checkInternalSecret pattern in imapReplies.ts /
 * outreachLeads.ts. Originally a dedicated WIZMATCH_INTERNAL_TOKEN env var
 * (falling back to OUTREACH_INTERNAL_SECRET for convenience). Now accepts
 * any one of a small allow-list of independently-configured tokens, so each
 * caller (Wizmatch scraper, outreach n8n flow, website lead-capture form,
 * ...) can hold its own secret without sharing one across systems. Every
 * candidate is still checked in constant time and the gate stays
 * fail-closed: if none of the tokens are configured, every request 401s.
 */
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import logger from '../utils/logger';

export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const tokens = [
    process.env.WIZMATCH_INTERNAL_TOKEN,
    process.env.OUTREACH_INTERNAL_SECRET,
    process.env.LEAD_INTAKE_TOKEN,
  ].filter((t): t is string => !!t);

  if (tokens.length === 0) {
    logger.error('[internalAuth] no internal token configured — blocking internal request');
    res.status(401).json({ error: 'internal token not configured' });
    return;
  }
  const rawProvided = req.headers['x-internal-secret'];
  const provided = Array.isArray(rawProvided) ? rawProvided[0] : rawProvided;
  if (!provided) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Constant-time compare against every configured token (never `!==`, which
  // short-circuits and leaks length/prefix via timing). Length-guard first
  // because timingSafeEqual throws on unequal lengths.
  const a = Buffer.from(provided);
  const matched = tokens.some((token) => {
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!matched) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}