import { Router, type Request, type Response } from 'express';
import { db, socialAccounts, socialPosts, userPermissions } from '../db/index';
import { eq, and, lte, gte, sql } from 'drizzle-orm';
import crypto from 'crypto';
import multer from 'multer';
import { uploadToR2 } from '../utils/r2';

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
  return process.env.SOCIAL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'fallback';
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
        status: isImmediate ? 'scheduled' : 'scheduled',
      }).returning();

      if (isImmediate) {
        // Publish immediately in background
        publishSocialPost(post.id).catch(e => console.error('[social] publish error:', e));
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

export default router;
