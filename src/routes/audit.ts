import { Router, type Request, type Response, type NextFunction } from 'express';
import { db, users, userPermissions } from '../db/index';
import { eq, sql, type SQL } from 'drizzle-orm';
import { hasPermission } from '../middleware/rbac';

const router = Router();

// ---------------------------------------------------------------------------
// Permission helper — same getPerms()-style pattern as billing.ts/reports.ts/
// permissions.ts/social.ts (all baselined against the same tenant-scoping
// lint finding below, for the same reason).
// ---------------------------------------------------------------------------
async function getPerms(userId: string) {
  // tenant-scoping-lint-ignore-next-line — filters by userPermissions.userId,
  // a foreign key to a single specific user row. userId is already globally
  // unique (not reused across tenants), so an additional tenant_id predicate
  // couldn't narrow this further — same reasoning as rbac.ts's
  // requirePlatformSuperadmin lookup, and the identical pattern already
  // baselined in billing.ts/permissions.ts/reports.ts/social.ts.
  const [p] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  return p ?? null;
}

// rbac.ts's PERMISSION_MAP.AUDIT_VIEW resolves to role === 'admin' literally.
// This codebase explicitly separates `role` from `userPermissions.isOwner` —
// they are not the same concept — so a tenant owner whose role happens not
// to be 'admin' was previously 403'd from their own audit log. Per
// AGENTS.md's guardrail on src/middleware/rbac.ts, PERMISSION_MAP itself is
// not touched here; instead this layers the same isOwner escape hatch
// billing.ts/reports.ts already use (`!p?.X && !p?.isOwner`) on top of the
// existing role check — reusing rbac.ts's exported hasPermission() (which
// reads PERMISSION_MAP) rather than duplicating/hardcoding 'admin'.
//
// This replaces `requirePermission('AUDIT_VIEW')` as route middleware
// (Express middleware chains are AND, not OR — a rejecting middleware never
// calls next(), so a plain inline check added after it could never run for
// the isOwner case) but preserves its exact role-check semantics via
// hasPermission(), then ORs in the isOwner lookup before deciding to 403.
async function requireAuditView(req: Request, res: Response, next: NextFunction): Promise<void> {
  const role = req.user?.role || 'staff';
  if (hasPermission(role, 'AUDIT_VIEW')) {
    next();
    return;
  }
  const userId = req.user?.id;
  if (userId) {
    const p = await getPerms(userId);
    if (p?.isOwner) {
      next();
      return;
    }
  }
  res.status(403).json({ error: 'forbidden', message: "You don't have permission to access this resource" });
}

// ---------------------------------------------------------------------------
// Merged audit view — audit_events + audit_logs
// ---------------------------------------------------------------------------
// There are two separate, independently-written audit tables in this
// codebase: `audit_events` (logAuditEvent(), src/utils/audit.ts — LOGIN,
// ad-account changes) and `audit_logs` (auditLog(), src/services/
// auditLogger.ts — invoice_sent, and outreach/wizmatch mutations). The
// routes below used to read only audit_events, silently hiding everything
// written to audit_logs (which was otherwise write-only/unreadable — no
// route anywhere SELECTs from it). Every row from either table is tagged
// with a `source` column so a consumer can always tell which table (and
// therefore which write-side contract) it came from.
//
// audit_logs.tenant_id is nullable — some writers (outreachGate.ts's mode-
// flip observations) are deliberately system-wide, not tied to any tenant.
// Filtering on `al.tenant_id = tenantId` correctly excludes those NULL rows
// from a specific tenant's audit view (a system-wide event isn't this
// tenant's data), same as it would exclude another tenant's rows.
interface AuditFilterOpts {
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
}

function buildEventsFragment(tenantId: string, opts: AuditFilterOpts): SQL {
  let q = sql`
    SELECT
      ae.id::text AS id,
      'audit_events' AS source,
      ae.action AS action,
      ae.resource_type AS resource_type,
      ae.resource_id AS resource_id,
      ae.metadata AS metadata,
      ae.ip_address AS ip_address,
      ae.user_id AS user_id,
      u.name AS user_name,
      u.email AS user_email,
      ae.created_at AS created_at
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.user_id
    WHERE ae.tenant_id = ${tenantId}
  `;
  if (opts.action) q = sql`${q} AND ae.action = ${opts.action}`;
  if (opts.userId) q = sql`${q} AND ae.user_id = ${opts.userId}`;
  if (opts.from) q = sql`${q} AND ae.created_at >= ${new Date(opts.from)}`;
  if (opts.to) q = sql`${q} AND ae.created_at <= ${new Date(opts.to + 'T23:59:59')}`;
  return q;
}

function buildLogsFragment(tenantId: string, opts: AuditFilterOpts): SQL {
  // old_values/new_values/entity_name don't map onto audit_events' generic
  // `metadata` column 1:1, so they're folded into a metadata-shaped jsonb
  // object here — the frontend already renders `metadata` as opaque JSON.
  let q = sql`
    SELECT
      al.id::text AS id,
      'audit_logs' AS source,
      al.action AS action,
      al.entity_type AS resource_type,
      al.entity_id AS resource_id,
      jsonb_build_object('entityName', al.entity_name, 'oldValues', al.old_values, 'newValues', al.new_values) AS metadata,
      al.ip_address AS ip_address,
      al.user_id AS user_id,
      u.name AS user_name,
      COALESCE(u.email, al.user_email) AS user_email,
      al.created_at AS created_at
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.tenant_id = ${tenantId}
  `;
  if (opts.action) q = sql`${q} AND al.action = ${opts.action}`;
  if (opts.userId) q = sql`${q} AND al.user_id = ${opts.userId}`;
  if (opts.from) q = sql`${q} AND al.created_at >= ${new Date(opts.from)}`;
  if (opts.to) q = sql`${q} AND al.created_at <= ${new Date(opts.to + 'T23:59:59')}`;
  return q;
}

function buildMergedFragment(tenantId: string, opts: AuditFilterOpts): SQL {
  return sql`(${buildEventsFragment(tenantId, opts)}) UNION ALL (${buildLogsFragment(tenantId, opts)})`;
}

// ---------------------------------------------------------------------------
// GET /api/audit/events?page=1&limit=50&action=LOGIN&userId=xxx&from=2026-03-01&to=2026-03-31
// ---------------------------------------------------------------------------
router.get('/events', requireAuditView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const action = req.query.action as string | undefined;
  const userId = req.query.userId as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const opts: AuditFilterOpts = { action, userId, from, to };

  try {
    const dataQuery = sql`
      SELECT * FROM (${buildMergedFragment(tenantId, opts)}) combined
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const result = await db.execute(dataQuery);

    const countQuery = sql`
      SELECT COUNT(*) as count FROM (${buildMergedFragment(tenantId, opts)}) combined
    `;
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
router.get('/users', requireAuditView, async (req: Request, res: Response) => {
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
router.get('/export', requireAuditView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  // NOTE: the old inline `role !== 'admin'` check here has been removed —
  // it duplicated (and pre-empted) requireAuditView's role check while
  // ignoring the isOwner escape hatch, which would have re-introduced the
  // exact bug this fix closes (a non-'admin' owner passing requireAuditView
  // only to be 403'd again immediately below).

  const action = req.query.action as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const opts: AuditFilterOpts = { action, from, to };

  try {
    const query = sql`
      SELECT * FROM (${buildMergedFragment(tenantId, opts)}) combined
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    const result = await db.execute(query);
    const rows = result.rows as Array<Record<string, unknown>>;

    const csv = [
      ['Date', 'User', 'Email', 'Action', 'Resource Type', 'Resource ID', 'IP Address', 'Source'].join(','),
      ...rows.map(r =>
        [
          new Date(r.created_at as string).toISOString(),
          r.user_name || '',
          r.user_email || '',
          r.action,
          r.resource_type || '',
          r.resource_id || '',
          r.ip_address || '',
          r.source || '',
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
