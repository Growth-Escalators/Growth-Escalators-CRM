/**
 * Admin short-link CRUD API. Backed by the short_links table in main Postgres
 * via shortLinksDb.ts. Replaces the shlink-backed implementation that was
 * decommissioned in May 2026.
 *
 * Routes (all require JWT auth):
 *   GET    /api/links               — list every short link with click counts
 *   GET    /api/links/:slug         — fetch one entry
 *   GET    /api/links/:slug/stats   — total clicks + last_clicked_at
 *   POST   /api/links/create        — create a new short link
 *   PATCH  /api/links/:slug         — update destination / description / tags
 *   DELETE /api/links/:slug         — delete a short link
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  lookupShortLinkDb,
  listShortLinksDb,
  createShortLinkDb,
  updateShortLinkDb,
  deleteShortLinkDb,
  type ShortLinkRow,
} from '../services/shortLinksDb';
import logger from '../utils/logger';

const router = Router();
router.use(requireAuth);

// Shape the admin SPA expects — keep stable with the previous shlink-shaped
// response so the existing UI works without changes.
function toApi(row: ShortLinkRow) {
  return {
    shortCode: row.slug,
    longUrl: row.destination,
    title: row.description ?? '',
    tags: row.tags,
    domain: 'links.growthescalators.com',
    dateCreated: row.createdAt,
    dateUpdated: row.updatedAt,
    visitsSummary: { total: row.clickCount, nonBots: row.clickCount, bots: 0 },
    lastClickedAt: row.lastClickedAt,
  };
}

// ── GET /api/links ────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await listShortLinksDb();
    res.json({ ok: true, count: rows.length, links: rows.map(toApi) });
  } catch (e) {
    logger.error({ err: e }, '[links] list failed');
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/links/:slug ──────────────────────────────────────────────────
router.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.params.slug || '');
  // Stats endpoint shares the same path pattern; route below handles /:slug/stats explicitly.
  try {
    const hit = await lookupShortLinkDb(slug);
    if (!hit) { res.status(404).json({ error: `Short link "${slug}" not found` }); return; }
    res.json({ ok: true, link: toApi(hit) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/links/:slug/stats ────────────────────────────────────────────
router.get('/:slug/stats', async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.params.slug || '');
  try {
    const hit = await lookupShortLinkDb(slug);
    if (!hit) { res.status(404).json({ error: `Short link "${slug}" not found` }); return; }
    res.json({
      ok: true,
      stats: {
        shortCode: hit.slug,
        shortUrl: `links.growthescalators.com/${hit.slug}`,
        longUrl: hit.destination,
        visitsSummary: { total: hit.clickCount, nonBots: hit.clickCount, bots: 0 },
        tags: hit.tags,
        title: hit.description ?? '',
        createdAt: hit.createdAt,
        lastClickedAt: hit.lastClickedAt,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/links/create ────────────────────────────────────────────────
router.post('/create', async (req: Request, res: Response): Promise<void> => {
  const { destinationUrl, longUrl, customSlug, slug, description, title, tags } = req.body as {
    destinationUrl?: string; longUrl?: string;
    customSlug?: string; slug?: string;
    description?: string; title?: string;
    tags?: string[];
  };

  // Accept the shape the existing admin UI sends.
  const dest = destinationUrl || longUrl;
  let inputSlug = (customSlug || slug || '').trim();
  if (!dest) { res.status(400).json({ error: 'destinationUrl (or longUrl) is required' }); return; }
  // If no slug provided, generate a random 6-char one (matches shlink default behaviour).
  if (!inputSlug) {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1 to avoid confusion
    inputSlug = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  try {
    const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
    const row = await createShortLinkDb({
      slug: inputSlug,
      destination: dest,
      description: description ?? title,
      tags: tags ?? [],
      createdByUserId: userId,
    });
    res.json({ ok: true, link: toApi(row) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate key') || msg.includes('short_links_pkey')) {
      res.status(409).json({ error: `Slug "${inputSlug}" is already taken` });
      return;
    }
    logger.error({ err: e }, '[links] create failed');
    res.status(400).json({ error: msg });
  }
});

// ── PATCH /api/links/:slug ────────────────────────────────────────────────
router.patch('/:slug', async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.params.slug || '');
  const { destination, longUrl, description, title, tags } = req.body as {
    destination?: string; longUrl?: string;
    description?: string; title?: string;
    tags?: string[];
  };
  try {
    const updated = await updateShortLinkDb(slug, {
      destination: destination ?? longUrl,
      description: description ?? title,
      tags,
    });
    if (!updated) { res.status(404).json({ error: `Short link "${slug}" not found` }); return; }
    res.json({ ok: true, link: toApi(updated) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── DELETE /api/links/:slug ───────────────────────────────────────────────
router.delete('/:slug', async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.params.slug || '');
  try {
    const deleted = await deleteShortLinkDb(slug);
    if (!deleted) { res.status(404).json({ error: `Short link "${slug}" not found` }); return; }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
