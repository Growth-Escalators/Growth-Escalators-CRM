import { Router, type Request, type Response } from 'express';
import { db, pool, marketingAccounts, users } from '../db/index';
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

    // notify_slack column is added at runtime via ensureMarketingAccountsNotifySlackColumn
    // (Drizzle schema doesn't know about it). Pull it via raw SQL so the
    // Accounts tab can render the Pause/Activate toggle without a migration.
    const notifyRows = await pool.query<{ id: string; notify_slack: boolean }>(
      `SELECT id, COALESCE(notify_slack, true) AS notify_slack FROM marketing_accounts WHERE tenant_id = $1`,
      [tenantId],
    );
    const notifyMap = new Map(notifyRows.rows.map(r => [r.id, r.notify_slack]));

    // Enrich with requester name for pending removals
    const enriched = await Promise.all(rows.map(async (acct) => {
      let requestedByName: string | null = null;
      if (acct.removalRequestedBy) {
        const [u] = await db.select({ name: users.name }).from(users)
          .where(eq(users.id, acct.removalRequestedBy)).limit(1);
        requestedByName = u?.name || null;
      }
      return { ...acct, requestedByName, notifySlack: notifyMap.get(acct.id) ?? true };
    }));

    res.json({ accounts: enriched });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/marketing/accounts/:id/notify-slack — flip the Slack-daily-report
// inclusion flag. Active = sends daily report, Paused = skipped.
// ---------------------------------------------------------------------------
router.patch('/accounts/:id/notify-slack', requirePermission('MARKETING_MANAGE'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const accountId = req.params.id as string;
  const { notifySlack } = req.body as { notifySlack?: boolean };
  if (typeof notifySlack !== 'boolean') {
    res.status(400).json({ error: 'notifySlack (boolean) required' });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE marketing_accounts SET notify_slack = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, client_name, notify_slack`,
      [notifySlack, accountId, tenantId],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: 'account not found' }); return; }
    res.json({ ok: true, account: result.rows[0] });
  } catch (e) {
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
      `⚠️ *Ad account removal requested*\n\n*Account:* ${acct.accountName} (${acct.accountId})\n*Requested by:* ${userName}\n\nApprove at /marketing`);

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
// PATCH /api/marketing/accounts/:id — update client name / notes
// ---------------------------------------------------------------------------
router.patch('/accounts/:id', requirePermission('MARKETING_MANAGE'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const accountId = req.params.id as string;
  const { clientName, accountName, notes } = req.body as { clientName?: string; accountName?: string; notes?: string };

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (clientName !== undefined) updates.clientName = clientName;
    if (accountName !== undefined) updates.accountName = accountName;
    if (notes !== undefined) updates.notes = notes;

    const [updated] = await db.update(marketingAccounts)
      .set(updates as Partial<typeof marketingAccounts.$inferInsert>)
      .where(and(eq(marketingAccounts.id, accountId), eq(marketingAccounts.tenantId, tenantId)))
      .returning();

    if (!updated) { res.status(404).json({ error: 'account not found' }); return; }
    res.json({ account: updated });
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
