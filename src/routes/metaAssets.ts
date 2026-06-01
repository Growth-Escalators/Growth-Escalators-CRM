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

// ---------------------------------------------------------------------------
// GET /api/meta/pages/:pageId/posts — last 10 posts for a Page (id, message,
// created_time). Uses the PAGE access token from /me/accounts because the
// user/system-user token alone does not authorize /<page>/posts reads.
// Plain fields only — insights.metric(...) was rejected during App Review
// warm-up (see scripts/meta-app-review/STATUS.md).
// Backs the Meta Assets admin page for the `pages_read_engagement` flow.
// ---------------------------------------------------------------------------
router.get('/pages/:pageId/posts', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) {
    res.status(503).json({ error: { message: 'META_ACCESS_TOKEN not configured' } });
    return;
  }

  const pageId = String(req.params.pageId || '').trim();
  if (!pageId) {
    res.status(400).json({ error: { message: 'pageId is required' } });
    return;
  }

  try {
    const accountsUrl = `${META_API_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`;
    const accountsResp = await fetchWithRetry(accountsUrl);
    const accountsBody = (await accountsResp.json().catch(() => ({}))) as Record<string, unknown>;

    if (!accountsResp.ok) {
      const msg = (accountsBody as { error?: { message?: string } })?.error?.message || 'Failed to enumerate Pages';
      const status = accountsResp.status >= 400 && accountsResp.status < 500 ? accountsResp.status : 502;
      res.status(status).json({ error: { message: msg } });
      return;
    }

    const pages = (Array.isArray((accountsBody as { data?: unknown }).data)
      ? (accountsBody as { data: Array<{ id: string; name?: string; access_token?: string }> }).data
      : []) as Array<{ id: string; name?: string; access_token?: string }>;
    const match = pages.find((p) => p.id === pageId);
    if (!match || !match.access_token) {
      res.status(404).json({ error: { message: 'Page not connected to system user' } });
      return;
    }

    const postsUrl = `${META_API_BASE}/${encodeURIComponent(pageId)}/posts?fields=id,message,created_time&limit=10&access_token=${encodeURIComponent(match.access_token)}`;
    const postsResp = await fetchWithRetry(postsUrl);
    const postsBody = (await postsResp.json().catch(() => ({}))) as Record<string, unknown>;

    if (!postsResp.ok) {
      const msg = (postsBody as { error?: { message?: string } })?.error?.message || 'Failed to fetch Page posts';
      const status = postsResp.status >= 400 && postsResp.status < 500 ? postsResp.status : 502;
      res.status(status).json({ error: { message: msg } });
      return;
    }

    res.json(postsBody);
  } catch (err: unknown) {
    res.status(502).json({ error: { message: err instanceof Error ? err.message : 'Upstream Graph API error' } });
  }
});

export const metaAssetsRouter = router;
