import { Router, type Request, type Response } from 'express';
import { db, marketingAccounts, users } from '../db/index';
import { eq, and, sql } from 'drizzle-orm';
import { requirePermission } from '../middleware/rbac';
import { logAuditEvent } from '../utils/audit';
import { sendSlackDM, SLACK_MEMBERS } from '../services/slackService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/marketing/accounts
// ---------------------------------------------------------------------------
router.get('/accounts', requirePermission('MARKETING_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db.select().from(marketingAccounts)
      .where(eq(marketingAccounts.tenantId, tenantId))
      .orderBy(sql`created_at DESC`);

    // Enrich with requester name for pending removals
    const enriched = await Promise.all(rows.map(async (acct) => {
      let requestedByName: string | null = null;
      if (acct.removalRequestedBy) {
        const [u] = await db.select({ name: users.name }).from(users)
          .where(eq(users.id, acct.removalRequestedBy)).limit(1);
        requestedByName = u?.name || null;
      }
      return { ...acct, requestedByName };
    }));

    res.json({ accounts: enriched });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketing/accounts
// ---------------------------------------------------------------------------
router.post('/accounts', requirePermission('MARKETING_MANAGE'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const { accountId, accountName, clientName, notes } = req.body;

  if (!accountId || !accountName) {
    res.status(400).json({ error: 'accountId and accountName required' });
    return;
  }
  if (!accountId.startsWith('act_')) {
    res.status(400).json({ error: 'accountId must start with act_' });
    return;
  }

  try {
    const [acct] = await db.insert(marketingAccounts).values({
      tenantId,
      accountId,
      accountName,
      clientName: clientName || null,
      notes: notes || null,
      isActive: true,
    }).returning();

    await logAuditEvent(userId, tenantId, 'ADD_AD_ACCOUNT', 'ad_account', acct.id, { accountId, accountName }, req);
    res.json({ account: acct });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketing/accounts/:id/request-removal
// ---------------------------------------------------------------------------
router.post('/accounts/:id/request-removal', requirePermission('MARKETING_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const accountId = req.params.id as string;

  try {
    const [acct] = await db.select().from(marketingAccounts)
      .where(and(eq(marketingAccounts.id, accountId), eq(marketingAccounts.tenantId, tenantId)))
      .limit(1);
    if (!acct) { res.status(404).json({ error: 'account not found' }); return; }
    if (!acct.isActive) { res.status(400).json({ error: 'account already inactive' }); return; }

    await db.update(marketingAccounts)
      .set({ removalRequestedAt: new Date(), removalRequestedBy: userId, updatedAt: new Date() })
      .where(eq(marketingAccounts.id, accountId));

    // Get requester name
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    const userName = user?.name || 'Unknown';

    // Slack DM to Jatin
    await sendSlackDM(SLACK_MEMBERS.jatin,
      `⚠️ *Ad account removal requested*\n\n*Account:* ${acct.accountName} (${acct.accountId})\n*Requested by:* ${userName}\n\nApprove at /crm/marketing`);

    await logAuditEvent(userId, tenantId, 'REQUEST_REMOVAL', 'ad_account', accountId, { accountName: acct.accountName }, req);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketing/accounts/:id/approve-removal — admin only
// ---------------------------------------------------------------------------
router.post('/accounts/:id/approve-removal', requirePermission('ADS_MANAGE'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const role = req.user!.role;
  const accountId = req.params.id as string;

  if (role !== 'admin') { res.status(403).json({ error: 'admin only' }); return; }

  try {
    const [acct] = await db.select().from(marketingAccounts)
      .where(and(eq(marketingAccounts.id, accountId), eq(marketingAccounts.tenantId, tenantId)))
      .limit(1);
    if (!acct) { res.status(404).json({ error: 'account not found' }); return; }

    await db.update(marketingAccounts)
      .set({ isActive: false, removalApprovedAt: new Date(), updatedAt: new Date() })
      .where(eq(marketingAccounts.id, accountId));

    await logAuditEvent(userId, tenantId, 'APPROVE_REMOVAL', 'ad_account', accountId, { accountName: acct.accountName }, req);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/marketing/accounts/:id/reactivate — admin only
// ---------------------------------------------------------------------------
router.post('/accounts/:id/reactivate', requirePermission('ADS_MANAGE'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const role = req.user!.role;
  const accountId = req.params.id as string;

  if (role !== 'admin') { res.status(403).json({ error: 'admin only' }); return; }

  try {
    await db.update(marketingAccounts)
      .set({ isActive: true, removalRequestedAt: null, removalRequestedBy: null, removalApprovedAt: null, updatedAt: new Date() })
      .where(and(eq(marketingAccounts.id, accountId), eq(marketingAccounts.tenantId, tenantId)));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/marketing/accounts/:id/history
// ---------------------------------------------------------------------------
router.get('/accounts/:id/history', requirePermission('MARKETING_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const accountId = req.params.id as string;

  try {
    const [acct] = await db.select().from(marketingAccounts)
      .where(and(eq(marketingAccounts.id, accountId), eq(marketingAccounts.tenantId, tenantId)))
      .limit(1);
    if (!acct) { res.status(404).json({ error: 'account not found' }); return; }
    res.json({ account: acct, message: 'Historical insights are preserved in ads_insights_cache' });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
