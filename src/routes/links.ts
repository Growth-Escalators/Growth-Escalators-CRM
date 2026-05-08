/**
 * Internal short-link admin API. Backed by src/config/shortLinks.ts (static
 * config) — no external service. Replaces the shlink-backed implementation
 * that was decommissioned in May 2026.
 *
 * Routes (all require JWT auth):
 *   GET  /api/links               — list all configured slugs
 *   GET  /api/links/:slug         — fetch one entry (kept for backwards-compat;
 *                                   click stats are NOT collected — the static
 *                                   config has no DB)
 *
 * Creating new short links: edit src/config/shortLinks.ts, commit, redeploy.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { lookupShortLink, listShortLinks } from '../config/shortLinks';

const router = Router();

router.use(requireAuth);

// ── GET /api/links ────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const links = listShortLinks().map(l => ({
    shortCode: l.slug,
    longUrl: l.destination,
    title: l.description ?? '',
    tags: l.tags ?? [],
    domain: 'links.growthescalators.com',
    dateCreated: l.addedOn ?? null,
    visitsSummary: null, // static config has no click stats
  }));
  res.json({ ok: true, count: links.length, links });
});

// ── GET /api/links/:slug ──────────────────────────────────────────────────
router.get('/:slug', (req: Request, res: Response): void => {
  const slug = String(req.params.slug || '');
  const hit = lookupShortLink(slug);
  if (!hit) {
    res.status(404).json({ error: `Short link "${slug}" not found` });
    return;
  }
  res.json({
    ok: true,
    link: {
      shortCode: slug,
      longUrl: hit.destination,
      title: hit.description ?? '',
      tags: hit.tags ?? [],
      domain: 'links.growthescalators.com',
      dateCreated: hit.addedOn ?? null,
      visitsSummary: null,
    },
  });
});

export default router;
