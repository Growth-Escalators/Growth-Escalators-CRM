/**
 * links.ts — Short link management via Shlink
 *
 * Routes (all require JWT auth):
 *   POST  /api/links/create           — create a short link
 *   POST  /api/links/outreach         — create an outreach-attributed link
 *   GET   /api/links/:shortCode/stats — fetch click stats for a short code
 *   GET   /api/links                  — list all short links (optional ?tag=)
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createShortLink,
  createOutreachLink,
  getLinkStats,
  listLinks,
} from '../services/shlinkService';
import logger from '../utils/logger';

const router = Router();

// All routes are protected
router.use(requireAuth);

// ── POST /api/links/create ────────────────────────────────────────────────────
router.post('/create', async (req: Request, res: Response): Promise<void> => {
  const { longUrl, customSlug, tags, title, validUntil, maxVisits } = req.body as {
    longUrl?: string;
    customSlug?: string;
    tags?: string[];
    title?: string;
    validUntil?: string;
    maxVisits?: number;
  };

  if (!longUrl) {
    res.status(400).json({ error: 'longUrl is required' });
    return;
  }

  try {
    const link = await createShortLink({ longUrl, customSlug, tags, title, validUntil, maxVisits });
    res.json({ ok: true, link });
  } catch (err) {
    logger.error({ err }, '[links] createShortLink failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Shlink error' });
  }
});

// ── POST /api/links/outreach ──────────────────────────────────────────────────
router.post('/outreach', async (req: Request, res: Response): Promise<void> => {
  const { destinationUrl, campaign, leadId, channel } = req.body as {
    destinationUrl?: string;
    campaign?: string;
    leadId?: string;
    channel?: 'email' | 'whatsapp' | 'linkedin';
  };

  if (!destinationUrl || !campaign || !leadId) {
    res.status(400).json({ error: 'destinationUrl, campaign, and leadId are required' });
    return;
  }

  try {
    const link = await createOutreachLink(destinationUrl, campaign, leadId, channel ?? 'email');
    res.json({ ok: true, link });
  } catch (err) {
    logger.error({ err }, '[links] createOutreachLink failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Shlink error' });
  }
});

// ── GET /api/links/:shortCode/stats ──────────────────────────────────────────
router.get('/:shortCode/stats', async (req: Request, res: Response): Promise<void> => {
  const shortCode = String(req.params.shortCode);

  try {
    const stats = await getLinkStats(shortCode);
    res.json({ ok: true, stats });
  } catch (err) {
    logger.error({ err, shortCode }, '[links] getLinkStats failed');
    res.status(404).json({ error: err instanceof Error ? err.message : 'Not found' });
  }
});

// ── GET /api/links ────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;

  try {
    const links = await listLinks(tag);
    res.json({ ok: true, count: links.length, links });
  } catch (err) {
    logger.error({ err }, '[links] listLinks failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Shlink error' });
  }
});

export default router;
