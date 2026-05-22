// WORKER_D_PAGE_POSTS_ROUTE
// GET /pages/:pageId/posts — returns last 10 posts (id, message, created_time)
// for a Page that the connected system user manages. Uses the PAGE access token
// from /me/accounts because the user/system-user token alone does not authorize
// /<page>/posts reads.
//
// Plain fields only — insights.metric(...) was rejected during App Review
// warm-up (see scripts/meta-app-review/STATUS.md).
router.get('/pages/:pageId/posts', async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN || process.env.META_ADS_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: { message: 'META_ACCESS_TOKEN not configured' },
    });
  }

  const pageId = String(req.params.pageId || '').trim();
  if (!pageId) {
    return res.status(400).json({ error: { message: 'pageId is required' } });
  }

  try {
    // 1) Enumerate the Pages this token can manage.
    const accountsUrl = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`;
    const accountsResp = await globalThis.fetch(accountsUrl);
    const accountsBody: any = await accountsResp.json().catch(() => ({}));

    if (!accountsResp.ok) {
      const msg = accountsBody?.error?.message || 'Failed to enumerate Pages';
      return res.status(accountsResp.status >= 400 && accountsResp.status < 500 ? accountsResp.status : 502).json({
        error: { message: msg },
      });
    }

    const pages: Array<{ id: string; name?: string; access_token?: string }> =
      Array.isArray(accountsBody?.data) ? accountsBody.data : [];
    const match = pages.find((p) => p.id === pageId);
    if (!match || !match.access_token) {
      return res.status(404).json({
        error: { message: 'Page not connected to system user' },
      });
    }

    // 2) Fetch posts with the PAGE access token. Plain fields only.
    const postsUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/posts?fields=id,message,created_time&limit=10&access_token=${encodeURIComponent(match.access_token)}`;
    const postsResp = await globalThis.fetch(postsUrl);
    const postsBody: any = await postsResp.json().catch(() => ({}));

    if (!postsResp.ok) {
      const msg = postsBody?.error?.message || 'Failed to fetch Page posts';
      return res.status(postsResp.status >= 400 && postsResp.status < 500 ? postsResp.status : 502).json({
        error: { message: msg },
      });
    }

    return res.json(postsBody);
  } catch (err: any) {
    return res.status(502).json({
      error: { message: err?.message || 'Upstream Graph API error' },
    });
  }
});
