import logger from '../utils/logger';
import { Router, type Request, type Response } from 'express';
import { db, socialAccounts, socialPosts, userPermissions } from '../db/index';
import { eq, and, lte, gte, sql } from 'drizzle-orm';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { uploadToR2, deleteFromR2, listR2Objects } from '../utils/r2';

const router = Router();

const META_API_BASE = 'https://graph.facebook.com/v19.0';

// Multer config for file upload (memory storage, 50MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// AES-256-CBC encryption using SOCIAL_ENCRYPTION_KEY or JWT_SECRET
function getEncKey(): string {
  const key = process.env.SOCIAL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('SOCIAL_ENCRYPTION_KEY or JWT_SECRET must be set');
  return key;
}

function encrypt(text: string): string {
  const key = crypto.scryptSync(getEncKey(), 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(encoded: string): string {
  try {
    const [ivHex, encHex] = encoded.split(':');
    const key = crypto.scryptSync(getEncKey(), 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

async function getPerms(userId: string) {
  const [p] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  return p;
}

// Post to Facebook Page
async function postToFacebook(pageId: string, accessToken: string, content: string, mediaUrls: string[]): Promise<{ postId?: string; error?: string }> {
  const body: Record<string, unknown> = {
    message: content,
    access_token: accessToken,
  };

  let endpoint = `${META_API_BASE}/${pageId}/feed`;

  // If media, use photos endpoint for single image
  if (mediaUrls.length === 1) {
    endpoint = `${META_API_BASE}/${pageId}/photos`;
    body.url = mediaUrls[0];
    body.caption = content;
    delete body.message;
  }

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json() as Record<string, unknown>;
  if (data.error) return { error: ((data.error as Record<string,string>).message) };
  return { postId: String(data.id || data.post_id || '') };
}

// Post to Instagram (2-step container method)
async function postToInstagram(igAccountId: string, accessToken: string, content: string, mediaUrls: string[]): Promise<{ postId?: string; error?: string }> {
  const imageUrl = mediaUrls[0];
  if (!imageUrl) return { error: 'Instagram requires at least one image' };

  // Step 1: Create media container
  const containerRes = await fetch(`${META_API_BASE}/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: content,
      access_token: accessToken,
    }),
  });
  const containerData = await containerRes.json() as Record<string, unknown>;
  if (containerData.error) return { error: ((containerData.error as Record<string,string>).message) };
  const containerId = String(containerData.id || '');
  if (!containerId) return { error: 'Failed to create media container' };

  // Step 2: Publish the container
  const publishRes = await fetch(`${META_API_BASE}/${igAccountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });
  const publishData = await publishRes.json() as Record<string, unknown>;
  if (publishData.error) return { error: ((publishData.error as Record<string,string>).message) };
  return { postId: String(publishData.id || '') };
}

// Publish a social post
export async function publishSocialPost(postId: string): Promise<void> {
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1);
  if (!post) return;

  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, post.socialAccountId)).limit(1);
  if (!account) return;

  const accessToken = decrypt(account.accessToken);
  const mediaUrls = post.mediaUrls || [];
  const platform = account.platform;

  let result: { postId?: string; error?: string };
  if (platform === 'facebook') {
    result = await postToFacebook(account.accountId, accessToken, post.content, mediaUrls);
  } else if (platform === 'instagram') {
    result = await postToInstagram(account.accountId, accessToken, post.content, mediaUrls);
  } else {
    result = { error: `Unknown platform: ${platform}` };
  }

  if (result.error) {
    await db.update(socialPosts)
      .set({ status: 'failed', errorMessage: result.error })
      .where(eq(socialPosts.id, postId));
  } else {
    await db.update(socialPosts)
      .set({ status: 'published', publishedAt: new Date(), externalPostId: result.postId || null, errorMessage: null })
      .where(eq(socialPosts.id, postId));
  }
}

// ---------------------------------------------------------------------------
// GET /api/social/accounts
// ---------------------------------------------------------------------------
router.get('/accounts', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db.select().from(socialAccounts).where(eq(socialAccounts.tenantId, tenantId));
    // Don't expose access tokens
    const safe = rows.map(r => ({ ...r, accessToken: '[encrypted]' }));
    res.json({ accounts: safe });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/social/accounts/connect-facebook
// ---------------------------------------------------------------------------
router.post('/accounts/connect-facebook', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { pageId, pageName, accessToken } = req.body;
  if (!pageId || !pageName || !accessToken) {
    res.status(400).json({ error: 'pageId, pageName, accessToken required' });
    return;
  }

  try {
    const encToken = encrypt(accessToken);

    // Save Facebook page
    const [fbAccount] = await db.insert(socialAccounts).values({
      tenantId,
      platform: 'facebook',
      accountId: pageId,
      accountName: pageName,
      accessToken: encToken,
      isActive: true,
    }).returning();

    // Try to fetch linked Instagram Business Account
    const igRes = await fetch(
      `${META_API_BASE}/${pageId}?fields=instagram_business_account&access_token=${accessToken}`
    );
    const igData = await igRes.json() as Record<string, unknown>;
    const igAccountId = (igData.instagram_business_account as Record<string,string> | undefined)?.id;

    let igAccount = null;
    if (igAccountId) {
      // Fetch IG account name
      const igInfoRes = await fetch(`${META_API_BASE}/${igAccountId}?fields=username,profile_picture_url&access_token=${accessToken}`);
      const igInfo = await igInfoRes.json() as Record<string, string>;

      [igAccount] = await db.insert(socialAccounts).values({
        tenantId,
        platform: 'instagram',
        accountId: igAccountId,
        accountName: igInfo.username || `IG:${igAccountId}`,
        accessToken: encToken,
        thumbnailUrl: igInfo.profile_picture_url || null,
        isActive: true,
      }).returning();
    }

    res.json({
      accounts: [
        { ...fbAccount, accessToken: '[encrypted]' },
        igAccount ? { ...igAccount, accessToken: '[encrypted]' } : null,
      ].filter(Boolean),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/social/accounts/:id
// ---------------------------------------------------------------------------
router.delete('/accounts/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const accountId = req.params.id as string;
  try {
    await db.update(socialAccounts)
      .set({ isActive: false })
      .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.tenantId, tenantId)));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/social/posts
// ---------------------------------------------------------------------------
router.post('/posts', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { socialAccountIds, content, mediaUrls, scheduledAt } = req.body;

  if (!socialAccountIds?.length || !content) {
    res.status(400).json({ error: 'socialAccountIds and content required' });
    return;
  }

  try {
    const results = [];
    const now = new Date();
    const schedTime = scheduledAt ? new Date(scheduledAt) : null;
    const isImmediate = !schedTime || schedTime <= now;

    for (const accountId of socialAccountIds as string[]) {
      const [account] = await db.select().from(socialAccounts)
        .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.tenantId, tenantId)))
        .limit(1);
      if (!account) continue;

      const [post] = await db.insert(socialPosts).values({
        tenantId,
        socialAccountId: accountId,
        platform: account.platform,
        content,
        mediaUrls: mediaUrls || [],
        scheduledAt: schedTime,
        status: isImmediate ? 'publishing' : 'scheduled',
      }).returning();

      if (isImmediate) {
        // Publish immediately in background
        publishSocialPost(post.id).catch(e => logger.error('[social] publish error:', e));
      }

      results.push({ ...post });
    }

    res.json({ posts: results });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/social/posts?status=scheduled
// ---------------------------------------------------------------------------
router.get('/posts', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const status = req.query.status as string | undefined;

  try {
    const rows = await db.select().from(socialPosts)
      .where(
        status
          ? and(eq(socialPosts.tenantId, tenantId), eq(socialPosts.status, status))
          : eq(socialPosts.tenantId, tenantId)
      )
      .orderBy(sql`created_at DESC`)
      .limit(200);
    res.json({ posts: rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/social/posts/:id — cancel scheduled post
// ---------------------------------------------------------------------------
router.delete('/posts/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const postId = req.params.id as string;

  try {
    const [post] = await db.select().from(socialPosts)
      .where(and(eq(socialPosts.id, postId), eq(socialPosts.tenantId, tenantId)))
      .limit(1);
    if (!post) { res.status(404).json({ error: 'post not found' }); return; }
    if (post.status !== 'scheduled') { res.status(400).json({ error: 'can only cancel scheduled posts' }); return; }

    await db.update(socialPosts).set({ status: 'failed', errorMessage: 'Cancelled by user' }).where(eq(socialPosts.id, postId));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/social/upload — upload media to R2
// ---------------------------------------------------------------------------
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'file required (images or videos only)' }); return; }

  try {
    const url = await uploadToR2(file.buffer, file.originalname, file.mimetype);
    res.json({ url, filename: file.originalname, mimeType: file.mimetype, size: file.size });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('R2 not configured')) {
      res.status(503).json({ error: 'Media storage not configured. Set R2 env vars in Railway.' });
    } else {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/social/calendar?month=2026-03
// ---------------------------------------------------------------------------
router.get('/calendar', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);

  try {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 0, 23, 59, 59);

    const rows = await db.select().from(socialPosts)
      .where(
        and(
          eq(socialPosts.tenantId, tenantId),
          gte(socialPosts.createdAt, start),
          lte(socialPosts.createdAt, end)
        )
      )
      .orderBy(sql`created_at ASC`)
      .limit(500);

    res.json({ posts: rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/social/library — list all files in R2 bucket
// ---------------------------------------------------------------------------
router.get('/library', async (req: Request, res: Response) => {
  try {
    const typeFilter = (req.query.type as string) || 'all';
    const searchQuery = (req.query.search as string || '').toLowerCase();

    let files = await listR2Objects();

    if (typeFilter === 'images') {
      files = files.filter(f => f.mimeType.startsWith('image/'));
    } else if (typeFilter === 'videos') {
      files = files.filter(f => f.mimeType.startsWith('video/'));
    }

    if (searchQuery) {
      files = files.filter(f => f.key.toLowerCase().includes(searchQuery));
    }

    res.json({ files });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/social/library/:key — delete file from R2
// ---------------------------------------------------------------------------
router.delete('/library/:key', async (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key as string);
  try {
    await deleteFromR2(key);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Facebook OAuth routes
// ---------------------------------------------------------------------------

export default router;

// ---------------------------------------------------------------------------
// OAuth router — mounted WITHOUT requireAuth so browser redirects work
// Handles /api/social/oauth/facebook/start and /callback
// ---------------------------------------------------------------------------
export const oauthRouter = Router();

// GET /api/social/oauth/facebook/start
// Accepts JWT via ?token= query param (browser nav) or Authorization header (API)
oauthRouter.get('/facebook/start', async (req: Request, res: Response) => {
  const appId = process.env.META_APP_ID;
  if (!appId) { res.status(503).json({ error: 'META_APP_ID not configured' }); return; }

  // Accept token from Authorization header OR ?token= query param
  let rawToken = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (!rawToken && req.query.token) rawToken = req.query.token as string;

  let userId: string | undefined;
  if (rawToken) {
    try {
      const decoded = jwt.verify(rawToken, process.env.JWT_SECRET!) as Record<string, unknown>;
      userId = (decoded.id ?? decoded.userId ?? decoded.sub) as string | undefined;
    } catch {
      res.status(401).json({ error: 'invalid token' }); return;
    }
  } else {
    res.status(401).json({ error: 'unauthorised' }); return;
  }

  const redirectUri = 'https://web-production-311da.up.railway.app/api/social/oauth/facebook/callback';
  const scope = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management';
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64url');

  const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}&response_type=code`;
  res.redirect(oauthUrl);
});

// GET /api/social/oauth/facebook/callback
// No auth required — Facebook redirects here directly
oauthRouter.get('/facebook/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code) { res.redirect('/crm/social?error=no_code'); return; }

  try {
    // Decode state
    let userId: string | null = null;
    if (state) {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString()) as { userId?: string };
      userId = parsed.userId || null;
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) { res.redirect('/crm/social?error=config'); return; }

    const redirectUri = 'https://web-production-311da.up.railway.app/api/social/oauth/facebook/callback';

    // Exchange code for short-lived token
    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`);
    const tokenData = await tokenRes.json() as { access_token?: string; error?: Record<string, string> };
    if (!tokenData.access_token) { res.redirect('/crm/social?error=token_exchange'); return; }

    // Exchange for long-lived token
    const llRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
    const llData = await llRes.json() as { access_token?: string };
    const longLivedToken = llData.access_token || tokenData.access_token;

    type PageData = {
      id: string;
      name: string;
      access_token?: string;
      picture?: { data?: { url?: string } };
    };

    // SOURCE 1 — Pages the user personally administers
    const pagesRes = await fetch(`${META_API_BASE}/me/accounts?fields=id,name,access_token,picture&access_token=${longLivedToken}`);
    const pagesData = await pagesRes.json() as { data?: PageData[] };
    const personalPages: PageData[] = pagesData.data || [];
    logger.info(`[social oauth] personal pages: ${personalPages.length}`);

    // SOURCE 2 — Business Manager: owned + client pages
    const bmPages: PageData[] = [];
    try {
      const bizRes = await fetch(`${META_API_BASE}/me/businesses?fields=id,name&access_token=${longLivedToken}`);
      const bizData = await bizRes.json() as { data?: Array<{ id: string; name: string }> };
      const businesses = bizData.data || [];
      logger.info(`[social oauth] businesses: ${businesses.length}`);

      for (const biz of businesses) {
        try {
          const ownedRes = await fetch(`${META_API_BASE}/${biz.id}/owned_pages?fields=id,name,access_token,picture&access_token=${longLivedToken}`);
          const ownedData = await ownedRes.json() as { data?: PageData[] };
          bmPages.push(...(ownedData.data || []));
        } catch { /* owned_pages may fail if no permission */ }

        try {
          const clientRes = await fetch(`${META_API_BASE}/${biz.id}/client_pages?fields=id,name,access_token,picture&access_token=${longLivedToken}`);
          const clientData = await clientRes.json() as { data?: PageData[] };
          bmPages.push(...(clientData.data || []));
        } catch { /* client_pages may fail if no permission */ }
      }
    } catch (e) {
      logger.info(`[social oauth] BM fetch skipped: ${e}`);
    }
    logger.info(`[social oauth] BM pages: ${bmPages.length}`);

    // Deduplicate — personal pages take precedence (they always have a page token)
    const pageMap = new Map<string, PageData>();
    for (const p of [...personalPages, ...bmPages]) {
      if (!pageMap.has(p.id)) pageMap.set(p.id, p);
    }
    const allPages = Array.from(pageMap.values());
    logger.info(`[social oauth] total unique pages: ${allPages.length}`);

    // Get tenant ID
    let tenantId: string | null = null;
    if (userId) {
      const userResult = await db.execute(sql`SELECT tenant_id FROM users WHERE id = ${userId} LIMIT 1`);
      tenantId = (userResult.rows[0] as Record<string,string> | undefined)?.tenant_id || null;
    }
    if (!tenantId) {
      const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
      tenantId = (tenantResult.rows[0] as Record<string,string> | undefined)?.id || null;
    }
    if (!tenantId) { res.redirect('/crm/social?error=no_tenant'); return; }

    let fbCount = 0;
    let igCount = 0;

    for (const page of allPages) {
      // Use page's own token when available; fall back to user long-lived token for BM pages
      const pageToken = page.access_token || longLivedToken;
      const encToken = encrypt(pageToken);
      const thumbnail = page.picture?.data?.url || null;

      // Upsert Facebook page
      const existing = await db.select().from(socialAccounts)
        .where(and(eq(socialAccounts.accountId, page.id), eq(socialAccounts.platform, 'facebook')))
        .limit(1);

      if (existing.length > 0) {
        await db.update(socialAccounts)
          .set({ accessToken: encToken, accountName: page.name, isActive: true, thumbnailUrl: thumbnail })
          .where(eq(socialAccounts.id, existing[0].id));
      } else {
        await db.insert(socialAccounts).values({
          tenantId,
          platform: 'facebook',
          accountId: page.id,
          accountName: page.name,
          accessToken: encToken,
          thumbnailUrl: thumbnail,
          isActive: true,
        });
      }
      fbCount++;

      // Fetch linked Instagram Business Account via nested field expansion
      try {
        const igPageRes = await fetch(
          `${META_API_BASE}/${page.id}?fields=instagram_business_account%7Bid%2Cname%2Cusername%2Cprofile_picture_url%7D&access_token=${pageToken}`
        );
        const igPageData = await igPageRes.json() as {
          instagram_business_account?: { id: string; name?: string; username?: string; profile_picture_url?: string };
        };
        const ig = igPageData.instagram_business_account;

        if (ig?.id) {
          const igName = ig.name || ig.username || `IG:${ig.id}`;
          const igEncToken = encrypt(pageToken);

          const existingIg = await db.select().from(socialAccounts)
            .where(and(eq(socialAccounts.accountId, ig.id), eq(socialAccounts.platform, 'instagram')))
            .limit(1);

          if (existingIg.length > 0) {
            await db.update(socialAccounts)
              .set({ accessToken: igEncToken, accountName: igName, isActive: true, thumbnailUrl: ig.profile_picture_url || null })
              .where(eq(socialAccounts.id, existingIg[0].id));
          } else {
            await db.insert(socialAccounts).values({
              tenantId,
              platform: 'instagram',
              accountId: ig.id,
              accountName: igName,
              accessToken: igEncToken,
              thumbnailUrl: ig.profile_picture_url || null,
              isActive: true,
            });
          }
          igCount++;
        }
      } catch (e) {
        logger.info(`[social oauth] IG fetch failed for page ${page.name}: ${e}`);
      }
    }

    res.redirect(`/crm/social?connected=true&pages=${fbCount}&instagram=${igCount}`);
  } catch (e) {
    logger.error('[social oauth] callback error:', e);
    res.redirect('/crm/social?error=callback_failed');
  }
});
