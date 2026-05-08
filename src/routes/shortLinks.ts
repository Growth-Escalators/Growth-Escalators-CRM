/**
 * Public /s/:slug redirect — replaces the external shlink Railway service.
 * Source of truth: src/config/shortLinks.ts
 *
 * Mounted at:
 *   - GET /s/:slug                    (always works, no DNS dependency)
 *   - GET /:slug  on the links.* host (drop-in for old shlink URLs once DNS
 *                                      is re-pointed to the web service)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { lookupShortLink } from '../config/shortLinks';
import logger from '../utils/logger';

const router = Router();

function redirect(req: Request, res: Response, slug: string): void {
  const hit = lookupShortLink(slug);
  if (!hit) {
    logger.info({ slug, ip: req.ip }, '[short-links] slug not found');
    res.status(404).type('text/plain').send(`Short link "${slug}" not found.`);
    return;
  }
  logger.info({ slug, dest: hit.destination, ip: req.ip }, '[short-links] redirect');
  // 302 = temporary; lets us rewrite destinations without browsers caching forever.
  res.redirect(302, hit.destination);
}

// Primary path — works on any host. Always available.
router.get('/s/:slug', (req: Request, res: Response) => {
  redirect(req, res, String(req.params.slug || ''));
});

// Drop-in compatibility for `links.growthescalators.com/<slug>` once DNS
// re-points to web. Hostname-gated so the bare-slug path can never collide
// with /api/* or admin routes on crm/api hosts.
//
// Mount this BEFORE the catch-all admin SPA handler in src/index.ts so
// requests on the links.* host short-circuit out before falling through.
export function linksHostMiddleware(req: Request, res: Response, next: NextFunction): void {
  const host = String(req.hostname || req.headers.host || '').toLowerCase().split(':')[0];
  if (host !== 'links.growthescalators.com') {
    next();
    return;
  }

  // GET / on the links host -> a small index page so it isn't a 404
  if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
    res.type('text/plain').send('Growth Escalators short links — use /<slug>');
    return;
  }

  // GET /<slug> -> redirect. Anything else (POST, /api/*, etc) falls through.
  if (req.method === 'GET' && req.path.startsWith('/') && !req.path.startsWith('/api/')) {
    const slug = req.path.slice(1).split('/')[0];
    if (slug) {
      redirect(req, res, slug);
      return;
    }
  }

  next();
}

export default router;
