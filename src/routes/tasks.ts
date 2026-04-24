import logger from '../utils/logger';
import { Router } from 'express';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { db, tasks, contacts, deals } from '../db/index';

const router = Router();

// Status values the Kanban board uses
const COLUMN_STATUSES = ['not_started', 'in_progress', 'review', 'done'] as const;
type ColumnStatus = (typeof COLUMN_STATUSES)[number];

function isColumnStatus(v: unknown): v is ColumnStatus {
  return typeof v === 'string' && (COLUMN_STATUSES as readonly string[]).includes(v);
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
  const { status, assignedTo, limit = '500' } = req.query as Record<string, string>;

  const conditions = [eq(tasks.tenantId, tenantId)];
  if (status && isColumnStatus(status)) conditions.push(eq(tasks.status, status));
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo));

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
    const { title, description, assignedTo, dueAt, status, contactId, dealId } = req.body ?? {};

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

    const [inserted] = await db
      .insert(tasks)
      .values({
        tenantId,
        title: title.trim(),
        description: description ?? null,
        assignedTo: assignedTo ?? null,
        dueAt: dueAtDate,
        status: startStatus,
        contactId: contactId || null,
        dealId: dealId || null,
      })
      .returning();

    res.status(201).json({ task: { ...inserted, status: normalizeStatus(inserted.status) } });
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
    const { title, description, assignedTo, dueAt, status, contactId, dealId } = req.body ?? {};

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

    const [updated] = await db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    res.json({ task: { ...updated, status: normalizeStatus(updated.status) } });
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

export default router;
