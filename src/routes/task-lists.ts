import { Router, type Request, type Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, taskLists, tasks } from '../db/index';
import logger from '../utils/logger';
import { requirePerm } from '../middleware/requirePerm';

const router = Router();

// Runtime safety net: ensure tables exist even if drizzle migrations haven't run
// (e.g. dev DBs that pre-date migration 0016). Idempotent.
db.execute(sql`
  CREATE TABLE IF NOT EXISTS "task_lists" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"  uuid NOT NULL,
    "owner_id"   uuid NOT NULL,
    "name"       text NOT NULL,
    "position"   integer DEFAULT 0,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
  )
`).catch(() => {});
db.execute(sql`CREATE INDEX IF NOT EXISTS "task_lists_tenant_owner_idx" ON "task_lists" ("tenant_id", "owner_id")`).catch(() => {});
db.execute(sql`
  CREATE TABLE IF NOT EXISTS "task_checklist_items" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "task_id"    uuid NOT NULL,
    "label"      text NOT NULL,
    "is_done"    boolean DEFAULT false,
    "position"   integer DEFAULT 0,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
  )
`).catch(() => {});
db.execute(sql`CREATE INDEX IF NOT EXISTS "task_checklist_items_task_idx" ON "task_checklist_items" ("task_id")`).catch(() => {});
db.execute(sql`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "list_id" uuid`).catch(() => {});

// ---------------------------------------------------------------------------
// GET /api/task-lists — caller's own lists, with task count
//
// The registry only has one key for this whole file — 'tasks.lists.manage'
// (no separate 'tasks.lists.view') — so every route here, including reads,
// is gated on it.
// ---------------------------------------------------------------------------
router.get('/', requirePerm('tasks.lists.manage'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const ownerId = req.user!.id;
  try {
    const rows = await db.execute(sql`
      SELECT l.id, l.name, l.position, l.created_at, l.updated_at,
             COUNT(t.id)::int AS task_count,
             COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS open_count
      FROM task_lists l
      LEFT JOIN tasks t ON t.list_id = l.id AND t.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${tenantId} AND l.owner_id = ${ownerId}
      GROUP BY l.id
      ORDER BY l.position ASC, l.created_at ASC
    `);
    res.json({ lists: rows.rows });
  } catch (e) {
    logger.error('[task-lists] GET / error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/task-lists — create
// ---------------------------------------------------------------------------
router.post('/', requirePerm('tasks.lists.manage'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const ownerId = req.user!.id;
  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  try {
    const [maxRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(${taskLists.position}), 0)` })
      .from(taskLists)
      .where(and(eq(taskLists.tenantId, tenantId), eq(taskLists.ownerId, ownerId)));
    const nextPos = (maxRow?.max ?? 0) + 1;

    const [inserted] = await db
      .insert(taskLists)
      .values({ tenantId, ownerId, name: name.trim(), position: nextPos })
      .returning();
    res.status(201).json({ list: { ...inserted, task_count: 0, open_count: 0 } });
  } catch (e) {
    logger.error('[task-lists] POST / error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/task-lists/:id
// ---------------------------------------------------------------------------
router.patch('/:id', requirePerm('tasks.lists.manage'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const ownerId = req.user!.id;
  const id = req.params.id as string;
  const { name, position } = req.body ?? {};

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' });
      return;
    }
    patch.name = name.trim();
  }
  if (position !== undefined) {
    const n = Number(position);
    if (!Number.isFinite(n)) {
      res.status(400).json({ error: 'position must be a number' });
      return;
    }
    patch.position = n;
  }

  try {
    const [updated] = await db
      .update(taskLists)
      .set(patch)
      .where(
        and(
          eq(taskLists.id, id),
          eq(taskLists.tenantId, tenantId),
          eq(taskLists.ownerId, ownerId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: 'list not found' });
      return;
    }
    res.json({ list: updated });
  } catch (e) {
    logger.error('[task-lists] PATCH /:id error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/task-lists/:id — also detaches tasks (sets list_id NULL)
// ---------------------------------------------------------------------------
router.delete('/:id', requirePerm('tasks.lists.manage'), async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const ownerId = req.user!.id;
  const id = req.params.id as string;
  try {
    // Detach any tasks pointing at this list (so they aren't orphaned visually)
    await db
      .update(tasks)
      .set({ listId: null, updatedAt: new Date() })
      .where(and(eq(tasks.listId, id), eq(tasks.tenantId, tenantId)));

    const [deleted] = await db
      .delete(taskLists)
      .where(
        and(
          eq(taskLists.id, id),
          eq(taskLists.tenantId, tenantId),
          eq(taskLists.ownerId, ownerId),
        ),
      )
      .returning({ id: taskLists.id });
    if (!deleted) {
      res.status(404).json({ error: 'list not found' });
      return;
    }
    res.json({ ok: true, id: deleted.id });
  } catch (e) {
    logger.error('[task-lists] DELETE /:id error:', e);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
