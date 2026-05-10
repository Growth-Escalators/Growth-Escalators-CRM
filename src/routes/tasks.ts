import logger from '../utils/logger';
import { Router } from 'express';
import { eq, and, inArray, desc, asc, isNull, sql } from 'drizzle-orm';
import { db, tasks, contacts, deals, taskChecklistItems, users, pool } from '../db/index';
import { sendSlackDM, MEMBER_MAP } from '../services/slackService';

const router = Router();

// Status values the Kanban board uses
const COLUMN_STATUSES = ['not_started', 'in_progress', 'review', 'done'] as const;
type ColumnStatus = (typeof COLUMN_STATUSES)[number];

function isColumnStatus(v: unknown): v is ColumnStatus {
  return typeof v === 'string' && (COLUMN_STATUSES as readonly string[]).includes(v);
}

const PRIORITIES = ['low', 'medium', 'high'] as const;
type Priority = (typeof PRIORITIES)[number];

function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}

const CRM_BASE_URL =
  process.env.CRM_BASE_URL || 'https://crm.growthescalators.com';

// Resolve a users.id (or email/clickupId stored in tasks.assignedTo) to a Slack ID.
// MEMBER_MAP is keyed by ClickUp user id; the users table stores email + name. We look up the user, then match
// by name (case-insensitive) against MEMBER_MAP entries — this is the cheapest mapping that works without a
// schema change.
async function resolveSlackIdForAssignee(assignedTo: string | null | undefined): Promise<string | null> {
  if (!assignedTo) return null;
  // Direct match: assignedTo might already be a ClickUp ID present in MEMBER_MAP.
  if (MEMBER_MAP[assignedTo]) return MEMBER_MAP[assignedTo].slackId;

  // Otherwise try looking up the user record (assignedTo could be a UUID).
  try {
    // Drizzle lookup by id; fall back to email match.
    let userRow:
      | { id: string; name: string | null; email: string | null }
      | undefined;

    // Heuristic: UUIDs have hyphens, emails have @
    if (assignedTo.includes('@')) {
      const r = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.email, assignedTo.trim().toLowerCase()))
        .limit(1);
      userRow = r[0];
    } else {
      // Try uuid id; if it fails (cast error) we silently move on.
      try {
        const r = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, assignedTo))
          .limit(1);
        userRow = r[0];
      } catch {
        userRow = undefined;
      }
    }

    if (!userRow?.name) return null;
    const lowerName = userRow.name.toLowerCase();
    for (const entry of Object.values(MEMBER_MAP)) {
      if (lowerName.includes(entry.name.toLowerCase())) return entry.slackId;
    }
    return null;
  } catch {
    return null;
  }
}

function formatDueDate(d: Date | null | undefined): string {
  if (!d) return 'no due date';
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return 'no due date';
  }
}

async function sendAssignmentDM(opts: {
  assignedTo: string | null | undefined;
  taskId: string;
  title: string;
  dueAt: Date | null;
}): Promise<void> {
  const slackId = await resolveSlackIdForAssignee(opts.assignedTo);
  if (!slackId) return;
  const text = `📝 You've been assigned: "${opts.title}" — due ${formatDueDate(opts.dueAt)}. Open: ${CRM_BASE_URL}/tasks?id=${opts.taskId}`;
  // Operational notification — respects kill switch (allowDuringPause: false).
  sendSlackDM(slackId, text, undefined, { allowDuringPause: false }).catch((e) => {
    logger.warn(`[tasks] Slack DM failed: ${e instanceof Error ? e.message : String(e)}`);
  });
}

// Legacy rows inserted before the Kanban feature may have status='open'; treat as not_started.
function normalizeStatus(raw: string | null | undefined): ColumnStatus {
  if (!raw) return 'not_started';
  if (isColumnStatus(raw)) return raw;
  return 'not_started';
}

// ---------------------------------------------------------------------------
// GET /api/tasks — list tasks for the tenant, optionally filtered
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { status, assignedTo, listId, limit = '500' } = req.query as Record<string, string>;

  const conditions = [eq(tasks.tenantId, tenantId)];
  if (status && isColumnStatus(status)) conditions.push(eq(tasks.status, status));
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo));
  if (listId === 'none') conditions.push(isNull(tasks.listId));
  else if (listId) conditions.push(eq(tasks.listId, listId));

  try {
    const rows = await db
      .select({
        task: tasks,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        dealTitle: deals.title,
      })
      .from(tasks)
      .leftJoin(contacts, eq(tasks.contactId, contacts.id))
      .leftJoin(deals, eq(tasks.dealId, deals.id))
      .where(and(...conditions))
      .orderBy(desc(tasks.updatedAt))
      .limit(Math.min(parseInt(limit, 10) || 500, 2000));

    const out = rows.map((r) => {
      const contactName = [r.contactFirstName, r.contactLastName]
        .filter(Boolean)
        .join(' ')
        .trim() || null;
      return {
        ...r.task,
        status: normalizeStatus(r.task.status),
        contactName,
        dealTitle: r.dealTitle ?? null,
      };
    });

    res.json({ tasks: out, total: out.length });
  } catch (err) {
    logger.error('[tasks] GET / error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks — create a task
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { title, description, assignedTo, dueAt, status, contactId, dealId, listId, priority } = req.body ?? {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const startStatus: ColumnStatus = isColumnStatus(status) ? status : 'not_started';
    const dueAtDate = dueAt ? new Date(dueAt) : null;
    if (dueAtDate && isNaN(dueAtDate.getTime())) {
      res.status(400).json({ error: 'dueAt must be a valid ISO timestamp' });
      return;
    }

    const startPriority: Priority = isPriority(priority) ? priority : 'medium';

    const insertResult = await pool.query(
      `INSERT INTO tasks
         (tenant_id, title, description, assigned_to, due_at, status, contact_id, deal_id, list_id, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        tenantId,
        title.trim(),
        description ?? null,
        assignedTo ?? null,
        dueAtDate,
        startStatus,
        contactId || null,
        dealId || null,
        listId || null,
        startPriority,
      ],
    );
    const inserted = insertResult.rows[0] as Record<string, unknown>;

    // Fire-and-forget Slack DM if assignedTo resolves to a Slack user.
    if (inserted && (inserted as { assigned_to?: string | null }).assigned_to) {
      void sendAssignmentDM({
        assignedTo: (inserted as { assigned_to?: string | null }).assigned_to,
        taskId: String((inserted as { id: string }).id),
        title: title.trim(),
        dueAt: dueAtDate,
      });
    }

    res.status(201).json({
      task: {
        ...inserted,
        status: normalizeStatus(inserted.status as string),
      },
    });
  } catch (err) {
    logger.error('[tasks] POST / error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — update a task (used by drag-drop + tick + edit modal)
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;
    const { title, description, assignedTo, dueAt, status, contactId, dealId, listId, priority } = req.body ?? {};

    // Load existing assignedTo first so we can detect reassignment.
    const [existing] = await db
      .select({ id: tasks.id, assignedTo: tasks.assignedTo, title: tasks.title, dueAt: tasks.dueAt })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        res.status(400).json({ error: 'title must be a non-empty string' });
        return;
      }
      patch.title = title.trim();
    }
    if (description !== undefined) patch.description = description;
    if (assignedTo !== undefined) patch.assignedTo = assignedTo;
    if (dueAt !== undefined) {
      if (dueAt === null || dueAt === '') {
        patch.dueAt = null;
      } else {
        const d = new Date(dueAt);
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: 'dueAt must be a valid ISO timestamp or null' });
          return;
        }
        patch.dueAt = d;
      }
    }
    if (status !== undefined) {
      if (!isColumnStatus(status)) {
        res.status(400).json({ error: `status must be one of ${COLUMN_STATUSES.join(', ')}` });
        return;
      }
      patch.status = status;
    }
    if (contactId !== undefined) patch.contactId = contactId || null;
    if (dealId !== undefined) patch.dealId = dealId || null;
    if (listId !== undefined) patch.listId = listId || null;

    // priority — sent via raw SQL to avoid schema regen.
    let priorityForSql: Priority | null = null;
    if (priority !== undefined) {
      if (!isPriority(priority)) {
        res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
        return;
      }
      priorityForSql = priority;
    }

    const [updated] = await db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    if (priorityForSql) {
      await pool.query(
        `UPDATE tasks SET priority = $1 WHERE id = $2 AND tenant_id = $3`,
        [priorityForSql, id, tenantId],
      );
    }

    // Read priority back so the response is honest.
    const finalRow = await pool.query(
      `SELECT priority FROM tasks WHERE id = $1`,
      [id],
    );
    const finalPriority = (finalRow.rows[0]?.priority as string | null) ?? null;

    // Slack DM on reassignment (assignedTo changed and is non-null).
    if (assignedTo !== undefined && assignedTo && assignedTo !== existing.assignedTo) {
      void sendAssignmentDM({
        assignedTo,
        taskId: id,
        title: (patch.title as string) || existing.title,
        dueAt: (patch.dueAt as Date | null) ?? existing.dueAt ?? null,
      });
    }

    res.json({
      task: { ...updated, priority: finalPriority, status: normalizeStatus(updated.status) },
    });
  } catch (err) {
    logger.error('[tasks] PATCH /:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;
    const [deleted] = await db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
      .returning({ id: tasks.id });

    if (!deleted) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    logger.error('[tasks] DELETE /:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/bulk-status — reorder/bulk update (used to reconcile after drag)
// ---------------------------------------------------------------------------
router.post('/bulk-status', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { ids, status } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0 || !isColumnStatus(status)) {
      res.status(400).json({ error: 'ids (non-empty array) and status (valid column) required' });
      return;
    }
    const result = await db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(inArray(tasks.id, ids), eq(tasks.tenantId, tenantId)))
      .returning({ id: tasks.id });

    res.json({ ok: true, updated: result.length });
  } catch (err) {
    logger.error('[tasks] POST /bulk-status error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Checklist sub-items (per-task subtasks shown in the To-Do sidebar)
// ---------------------------------------------------------------------------

// Helper: confirm the parent task belongs to the caller's tenant.
async function loadTaskForTenant(id: string, tenantId: string) {
  const [t] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
    .limit(1);
  return t ?? null;
}

router.get('/:id/checklist-items', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;
    const parent = await loadTaskForTenant(id, tenantId);
    if (!parent) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const items = await db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, id))
      .orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.createdAt));
    res.json({ items });
  } catch (err) {
    logger.error('[tasks] GET /:id/checklist-items error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.post('/:id/checklist-items', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;
    const { label } = req.body ?? {};
    if (typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const parent = await loadTaskForTenant(id, tenantId);
    if (!parent) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const [maxRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(${taskChecklistItems.position}), 0)` })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, id));
    const nextPos = (maxRow?.max ?? 0) + 1;

    const [inserted] = await db
      .insert(taskChecklistItems)
      .values({ taskId: id, label: label.trim(), position: nextPos })
      .returning();
    res.status(201).json({ item: inserted });
  } catch (err) {
    logger.error('[tasks] POST /:id/checklist-items error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.patch('/:id/checklist-items/:itemId', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id, itemId } = req.params;
    const parent = await loadTaskForTenant(id, tenantId);
    if (!parent) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const { label, isDone, position } = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (label !== undefined) {
      if (typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ error: 'label must be a non-empty string' });
        return;
      }
      patch.label = label.trim();
    }
    if (isDone !== undefined) patch.isDone = !!isDone;
    if (position !== undefined) {
      const n = Number(position);
      if (!Number.isFinite(n)) {
        res.status(400).json({ error: 'position must be a number' });
        return;
      }
      patch.position = n;
    }
    const [updated] = await db
      .update(taskChecklistItems)
      .set(patch)
      .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: 'item not found' });
      return;
    }
    res.json({ item: updated });
  } catch (err) {
    logger.error('[tasks] PATCH /:id/checklist-items/:itemId error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.delete('/:id/checklist-items/:itemId', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id, itemId } = req.params;
    const parent = await loadTaskForTenant(id, tenantId);
    if (!parent) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const [deleted] = await db
      .delete(taskChecklistItems)
      .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, id)))
      .returning({ id: taskChecklistItems.id });
    if (!deleted) {
      res.status(404).json({ error: 'item not found' });
      return;
    }
    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    logger.error('[tasks] DELETE /:id/checklist-items/:itemId error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/bulk-update — generalised bulk patch (status, priority, assignedTo)
// ---------------------------------------------------------------------------
router.post('/bulk-update', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { ids, patch } = (req.body ?? {}) as {
      ids?: unknown;
      patch?: { status?: unknown; priority?: unknown; assignedTo?: unknown };
    };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids (non-empty array) required' });
      return;
    }
    if (!patch || typeof patch !== 'object') {
      res.status(400).json({ error: 'patch object required' });
      return;
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (patch.status !== undefined) {
      if (!isColumnStatus(patch.status)) {
        res.status(400).json({ error: `status must be one of ${COLUMN_STATUSES.join(', ')}` });
        return;
      }
      sets.push(`status = $${paramIdx++}`);
      params.push(patch.status);
    }
    if (patch.priority !== undefined) {
      if (!isPriority(patch.priority)) {
        res.status(400).json({ error: `priority must be one of ${PRIORITIES.join(', ')}` });
        return;
      }
      sets.push(`priority = $${paramIdx++}`);
      params.push(patch.priority);
    }
    if (patch.assignedTo !== undefined) {
      sets.push(`assigned_to = $${paramIdx++}`);
      params.push(patch.assignedTo || null);
    }

    if (sets.length === 1) {
      res.status(400).json({ error: 'patch must include at least one of status/priority/assignedTo' });
      return;
    }

    const idsParam = paramIdx++;
    const tenantParam = paramIdx++;
    params.push(ids, tenantId);

    const result = await pool.query(
      `UPDATE tasks SET ${sets.join(', ')}
       WHERE id = ANY($${idsParam}::uuid[]) AND tenant_id = $${tenantParam}
       RETURNING id, assigned_to, title, due_at`,
      params,
    );

    // If reassigning to a single user, fire one DM per task.
    if (typeof patch.assignedTo === 'string' && patch.assignedTo) {
      for (const row of result.rows as Array<{ id: string; assigned_to: string | null; title: string; due_at: Date | null }>) {
        void sendAssignmentDM({
          assignedTo: row.assigned_to,
          taskId: row.id,
          title: row.title,
          dueAt: row.due_at ?? null,
        });
      }
    }

    res.json({ ok: true, updated: result.rowCount ?? result.rows.length });
  } catch (err) {
    logger.error('[tasks] POST /bulk-update error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/bulk-delete — delete many at once (hard delete; tasks has no deleted_at)
// ---------------------------------------------------------------------------
router.post('/bulk-delete', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids (non-empty array) required' });
      return;
    }

    // Detect soft-delete column at runtime to honour the spec.
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tasks' AND column_name = 'deleted_at'`,
    );
    const hasSoftDelete = colCheck.rows.length > 0;

    let result;
    if (hasSoftDelete) {
      result = await pool.query(
        `UPDATE tasks SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND tenant_id = $2
         RETURNING id`,
        [ids, tenantId],
      );
    } else {
      result = await pool.query(
        `DELETE FROM tasks
         WHERE id = ANY($1::uuid[]) AND tenant_id = $2
         RETURNING id`,
        [ids, tenantId],
      );
    }

    res.json({ ok: true, deleted: result.rowCount ?? result.rows.length });
  } catch (err) {
    logger.error('[tasks] POST /bulk-delete error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tasks/team-performance — admin-only per-member metrics
// ---------------------------------------------------------------------------
router.get('/team-performance', async (req, res) => {
  try {
    if ((req.user?.role || 'staff') !== 'admin') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const tenantId = req.user!.tenantId;
    const period = (req.query.period as string) || '7d';
    const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 7;

    // Members = users in this tenant. (assignedTo on tasks may store the users.id;
    // we group by users.id and also count tasks where assigned_to = users.email or
    // = users.name as a fallback so legacy rows still surface.)
    const memberRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.tenantId, tenantId));

    const out: Array<Record<string, unknown>> = [];

    for (const m of memberRows) {
      const matchClause =
        `(assigned_to = $1 OR assigned_to = $2 OR assigned_to = $3)`;
      const matchParams = [m.id, m.email ?? '', m.name ?? ''];

      // doneInPeriod: status='done' updated within the window
      const doneRes = await pool.query(
        `SELECT COUNT(*)::int AS c
           FROM tasks
          WHERE tenant_id = $4
            AND status = 'done'
            AND updated_at >= NOW() - ($5::int || ' days')::interval
            AND ${matchClause}`,
        [...matchParams, tenantId, periodDays],
      );
      const doneInPeriod = (doneRes.rows[0]?.c as number) ?? 0;

      // on-time: closed_at <= due_at::date + interval '1 day'
      // (closed_at = updated_at when status='done')
      // Denominator: closed-with-due-date in period
      const onTimeRes = await pool.query(
        `SELECT
            SUM(CASE WHEN updated_at <= (due_at::date + interval '1 day')
                     THEN 1 ELSE 0 END)::int AS on_time,
            COUNT(*)::int AS total
           FROM tasks
          WHERE tenant_id = $4
            AND status = 'done'
            AND due_at IS NOT NULL
            AND updated_at >= NOW() - ($5::int || ' days')::interval
            AND ${matchClause}`,
        [...matchParams, tenantId, periodDays],
      );
      const onTime = (onTimeRes.rows[0]?.on_time as number) ?? 0;
      const onTimeTotal = (onTimeRes.rows[0]?.total as number) ?? 0;
      const onTimePct = onTimeTotal > 0 ? Math.round((onTime / onTimeTotal) * 100) : 0;

      // activeLoad: current in_progress
      const activeRes = await pool.query(
        `SELECT COUNT(*)::int AS c
           FROM tasks
          WHERE tenant_id = $4
            AND status = 'in_progress'
            AND ${matchClause}`,
        [...matchParams, tenantId],
      );
      const activeLoad = (activeRes.rows[0]?.c as number) ?? 0;

      // overdueCount + aging buckets (only where status != 'done' and overdue)
      const overdueRes = await pool.query(
        `SELECT
            SUM(CASE WHEN now() - due_at < interval '1 day' THEN 1 ELSE 0 END)::int AS lt1d,
            SUM(CASE WHEN now() - due_at >= interval '1 day' AND now() - due_at < interval '3 days' THEN 1 ELSE 0 END)::int AS b1to3,
            SUM(CASE WHEN now() - due_at >= interval '3 days' AND now() - due_at < interval '7 days' THEN 1 ELSE 0 END)::int AS b3to7,
            SUM(CASE WHEN now() - due_at >= interval '7 days' THEN 1 ELSE 0 END)::int AS gt7,
            COUNT(*)::int AS total
           FROM tasks
          WHERE tenant_id = $4
            AND status <> 'done'
            AND due_at IS NOT NULL
            AND due_at < NOW()
            AND ${matchClause}`,
        [...matchParams, tenantId],
      );
      const o = overdueRes.rows[0] || {};
      const overdueCount = (o.total as number) ?? 0;
      const agingBuckets = {
        lt1d: (o.lt1d as number) ?? 0,
        '1to3d': (o.b1to3 as number) ?? 0,
        '3to7d': (o.b3to7 as number) ?? 0,
        gt7d: (o.gt7 as number) ?? 0,
      };

      // trend30d: 30 daily counts of completed (status='done') tasks
      const trendRes = await pool.query(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
                COALESCE(SUM(CASE WHEN status = 'done' AND ${matchClause}
                                   AND updated_at::date = d::date
                                   AND tenant_id = $4
                                  THEN 1 ELSE 0 END), 0)::int AS c
           FROM generate_series(NOW() - interval '29 days', NOW(), '1 day'::interval) d
           LEFT JOIN tasks ON tasks.tenant_id = $4
                          AND tasks.status = 'done'
                          AND tasks.updated_at::date = d::date
                          AND ${matchClause}
          GROUP BY d
          ORDER BY d ASC`,
        [...matchParams, tenantId],
      );
      const trend30d = (trendRes.rows as Array<{ c: number }>).map((r) => Number(r.c) || 0);

      out.push({
        userId: m.id,
        name: m.name,
        doneInPeriod,
        onTimePct,
        activeLoad,
        overdueCount,
        agingBuckets,
        trend30d,
      });
    }

    res.json({ period: `${periodDays}d`, members: out });
  } catch (err) {
    logger.error('[tasks] GET /team-performance error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// COMMENTS (mounted at /api/tasks/:id/comments)
// ---------------------------------------------------------------------------
async function loadCommentParent(taskId: string, tenantId: string) {
  const [t] = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
    .limit(1);
  return t ?? null;
}

router.get('/:id/comments', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { id } = req.params;
    const parent = await loadCommentParent(id, tenantId);
    if (!parent) { res.status(404).json({ error: 'task not found' }); return; }

    const r = await pool.query(
      `SELECT
         tc.id,
         tc.task_id      AS "taskId",
         tc.parent_comment_id AS "parentCommentId",
         tc.body,
         tc.author_user_id AS "authorUserId",
         tc.mentions,
         tc.created_at   AS "createdAt",
         tc.updated_at   AS "updatedAt",
         u.name          AS "authorName",
         u.email         AS "authorEmail"
       FROM task_comments tc
       LEFT JOIN users u ON u.id = tc.author_user_id
       WHERE tc.task_id = $1
       ORDER BY tc.created_at ASC`,
      [id],
    );
    res.json({ comments: r.rows });
  } catch (err) {
    logger.error('[tasks] GET /:id/comments error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.post('/:id/comments', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const { id } = req.params;
    const parent = await loadCommentParent(id, tenantId);
    if (!parent) { res.status(404).json({ error: 'task not found' }); return; }

    const { body, parentCommentId, mentionedUserIds } = (req.body ?? {}) as {
      body?: unknown;
      parentCommentId?: unknown;
      mentionedUserIds?: unknown;
    };
    if (typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ error: 'body required' });
      return;
    }

    // Resolve mentioned user ids: prefer explicit list, otherwise parse @-emails out of body.
    let mentions: string[] = [];
    if (Array.isArray(mentionedUserIds)) {
      mentions = mentionedUserIds.filter((x): x is string => typeof x === 'string');
    } else {
      const matches = body.match(/@[\w.-]+@[\w.-]+\.[\w]+/g) || [];
      const emails = matches.map((m) => m.slice(1).toLowerCase().trim()).filter(Boolean);
      if (emails.length > 0) {
        const found = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), inArray(users.email, emails)));
        mentions = found.map((u) => u.id);
      }
    }

    const insertSql = `
      INSERT INTO task_comments (task_id, parent_comment_id, body, author_user_id, mentions)
      VALUES ($1, $2, $3, $4, $5::uuid[])
      RETURNING id, task_id AS "taskId", parent_comment_id AS "parentCommentId",
                body, author_user_id AS "authorUserId", mentions,
                created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    const ins = await pool.query(insertSql, [
      id,
      typeof parentCommentId === 'string' && parentCommentId ? parentCommentId : null,
      body.trim(),
      userId,
      mentions,
    ]);
    const row = ins.rows[0];

    // Slack DM each mentioned user, if we can resolve a Slack id.
    if (mentions.length > 0) {
      try {
        const ms = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, mentions));
        for (const m of ms) {
          const slackId = await resolveSlackIdForAssignee(m.id);
          if (!slackId) continue;
          const text = `💬 You were mentioned on "${parent.title}": ${body.trim().slice(0, 200)} — ${CRM_BASE_URL}/tasks?id=${id}`;
          sendSlackDM(slackId, text, undefined, { allowDuringPause: false }).catch(() => {});
        }
      } catch (e) {
        logger.warn(`[tasks] mention DM failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    res.status(201).json({ comment: row });
  } catch (err) {
    logger.error('[tasks] POST /:id/comments error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.patch('/:id/comments/:commentId', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const { id, commentId } = req.params;
    const parent = await loadCommentParent(id, tenantId);
    if (!parent) { res.status(404).json({ error: 'task not found' }); return; }

    const { body } = (req.body ?? {}) as { body?: unknown };
    if (typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ error: 'body required' });
      return;
    }

    // Only the original author can edit.
    const ownerCheck = await pool.query(
      `SELECT author_user_id FROM task_comments WHERE id = $1 AND task_id = $2`,
      [commentId, id],
    );
    if (ownerCheck.rows.length === 0) { res.status(404).json({ error: 'comment not found' }); return; }
    if ((ownerCheck.rows[0] as { author_user_id: string }).author_user_id !== userId) {
      res.status(403).json({ error: 'only the author can edit a comment' });
      return;
    }

    const r = await pool.query(
      `UPDATE task_comments SET body = $1, updated_at = NOW()
       WHERE id = $2 AND task_id = $3
       RETURNING id, task_id AS "taskId", parent_comment_id AS "parentCommentId",
                 body, author_user_id AS "authorUserId", mentions,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [body.trim(), commentId, id],
    );
    res.json({ comment: r.rows[0] });
  } catch (err) {
    logger.error('[tasks] PATCH /:id/comments/:commentId error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const role = req.user!.role || 'staff';
    const { id, commentId } = req.params;
    const parent = await loadCommentParent(id, tenantId);
    if (!parent) { res.status(404).json({ error: 'task not found' }); return; }

    const ownerCheck = await pool.query(
      `SELECT author_user_id FROM task_comments WHERE id = $1 AND task_id = $2`,
      [commentId, id],
    );
    if (ownerCheck.rows.length === 0) { res.status(404).json({ error: 'comment not found' }); return; }
    const authorId = (ownerCheck.rows[0] as { author_user_id: string }).author_user_id;
    if (authorId !== userId && role !== 'admin') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    await pool.query(
      `DELETE FROM task_comments WHERE id = $1 AND task_id = $2`,
      [commentId, id],
    );
    res.json({ ok: true, id: commentId });
  } catch (err) {
    logger.error('[tasks] DELETE /:id/comments/:commentId error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
