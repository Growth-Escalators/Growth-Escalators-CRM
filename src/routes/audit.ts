import { Router, type Request, type Response } from 'express';
import { db, auditEvents, users } from '../db/index';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { requirePermission } from '../middleware/rbac';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/audit/events?page=1&limit=50&action=LOGIN&userId=xxx&from=2026-03-01&to=2026-03-31
// ---------------------------------------------------------------------------
router.get('/events', requirePermission('AUDIT_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const action = req.query.action as string | undefined;
  const userId = req.query.userId as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  try {
    // Build WHERE conditions
    const conditions: string[] = [`ae.tenant_id = '${tenantId}'`];
    const params: unknown[] = [];

    let query = sql`
      SELECT ae.*, u.name as user_name, u.email as user_email
      FROM audit_events ae
      LEFT JOIN users u ON u.id = ae.user_id
      WHERE ae.tenant_id = ${tenantId}
    `;

    if (action) query = sql`${query} AND ae.action = ${action}`;
    if (userId) query = sql`${query} AND ae.user_id = ${userId}`;
    if (from) query = sql`${query} AND ae.created_at >= ${new Date(from)}`;
    if (to) query = sql`${query} AND ae.created_at <= ${new Date(to + 'T23:59:59')}`;

    query = sql`${query} ORDER BY ae.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const result = await db.execute(query);

    // Get total count
    let countQuery = sql`SELECT COUNT(*) as count FROM audit_events ae WHERE ae.tenant_id = ${tenantId}`;
    if (action) countQuery = sql`${countQuery} AND ae.action = ${action}`;
    if (userId) countQuery = sql`${countQuery} AND ae.user_id = ${userId}`;
    if (from) countQuery = sql`${countQuery} AND ae.created_at >= ${new Date(from)}`;
    if (to) countQuery = sql`${countQuery} AND ae.created_at <= ${new Date(to + 'T23:59:59')}`;

    const countResult = await db.execute(countQuery);
    const total = Number((countResult.rows[0] as Record<string, unknown>)?.count || 0);

    res.json({
      events: result.rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/audit/users — list users for filter dropdown
// ---------------------------------------------------------------------------
router.get('/users', requirePermission('AUDIT_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users).where(eq(users.tenantId, tenantId));
    res.json({ users: rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/audit/export?format=csv&action=LOGIN&from=...&to=...
// ---------------------------------------------------------------------------
router.get('/export', requirePermission('AUDIT_VIEW'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const role = req.user!.role;
  if (role !== 'admin') { res.status(403).json({ error: 'admin only' }); return; }

  const action = req.query.action as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  try {
    let query = sql`
      SELECT ae.action, ae.resource_type, ae.resource_id, ae.ip_address,
             ae.created_at, u.name as user_name, u.email as user_email
      FROM audit_events ae
      LEFT JOIN users u ON u.id = ae.user_id
      WHERE ae.tenant_id = ${tenantId}
    `;
    if (action) query = sql`${query} AND ae.action = ${action}`;
    if (from) query = sql`${query} AND ae.created_at >= ${new Date(from)}`;
    if (to) query = sql`${query} AND ae.created_at <= ${new Date(to + 'T23:59:59')}`;
    query = sql`${query} ORDER BY ae.created_at DESC LIMIT 5000`;

    const result = await db.execute(query);
    const rows = result.rows as Array<Record<string, unknown>>;

    const csv = [
      ['Date', 'User', 'Email', 'Action', 'Resource Type', 'Resource ID', 'IP Address'].join(','),
      ...rows.map(r =>
        [
          new Date(r.created_at as string).toISOString(),
          r.user_name || '',
          r.user_email || '',
          r.action,
          r.resource_type || '',
          r.resource_id || '',
          r.ip_address || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_log.csv"');
    res.send(csv);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
