import { Router, type Request, type Response } from 'express';
import { fetchWithRetry } from '../utils/fetchWithRetry';

const router = Router();

const META_API_BASE = 'https://graph.facebook.com/v21.0';

function getToken(): string | null {
  return process.env.META_ACCESS_TOKEN || process.env.META_ADS_TOKEN || null;
}

// ---------------------------------------------------------------------------
// GET /api/meta/pages — lists Facebook Pages the user manages.
// Backs the Meta Assets admin page for the App Review `pages_show_list` flow.
// ---------------------------------------------------------------------------
router.get('/pages', async (_req: Request, res: Response) => {
  const token = getToken();
  if (!token) {
    res.json({ data: [], error: 'token_missing' });
    return;
  }

  try {
    const url = `${META_API_BASE}/me/accounts?access_token=${encodeURIComponent(token)}`;
    const r = await fetchWithRetry(url);
    const data = await r.json() as Record<string, unknown>;
    if ((data as Record<string, unknown>).error) {
      res.status(400).json({
        data: [],
        error: ((data as Record<string, Record<string, string>>).error).message,
      });
      return;
    }
    res.json({ data: (data as { data: unknown[] }).data || [] });
  } catch (e: unknown) {
    res.status(500).json({ data: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/meta/businesses — lists Business Manager assets for the user.
// Backs the Meta Assets admin page for the App Review `business_management` flow.
// ---------------------------------------------------------------------------
router.get('/businesses', async (_req: Request, res: Response) => {
  const token = getToken();
  if (!token) {
    res.json({ data: [], error: 'token_missing' });
    return;
  }

  try {
    const url = `${META_API_BASE}/me/businesses?fields=id,name,verification_status&access_token=${encodeURIComponent(token)}`;
    const r = await fetchWithRetry(url);
    const data = await r.json() as Record<string, unknown>;
    if ((data as Record<string, unknown>).error) {
      res.status(400).json({
        data: [],
        error: ((data as Record<string, Record<string, string>>).error).message,
      });
      return;
    }
    res.json({ data: (data as { data: unknown[] }).data || [] });
  } catch (e: unknown) {
    res.status(500).json({ data: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// WORKER_D_PAGE_POSTS_ROUTE
export const metaAssetsRouter = router;
