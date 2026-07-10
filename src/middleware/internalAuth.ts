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

export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.WIZMATCH_INTERNAL_TOKEN || process.env.OUTREACH_INTERNAL_SECRET;
  if (!token) {
    logger.error('[wizmatch] WIZMATCH_INTERNAL_TOKEN not set — blocking internal request');
    res.status(401).json({ error: 'internal token not configured' });
    return;
  }
  const rawProvided = req.headers['x-internal-secret'];
  const provided = Array.isArray(rawProvided) ? rawProvided[0] : rawProvided;
  if (!provided) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Constant-time compare (never `!==`, which short-circuits and leaks length/prefix
  // via timing). Length-guard first because timingSafeEqual throws on unequal lengths.
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}