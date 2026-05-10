import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { checkAndAlertBlockers } from '../services/blockerAlertService';
import { db, pool } from '../db/index';
import { events } from '../db/index';
import { eq, and, desc, gte, sql } from 'drizzle-orm';

const router = Router();

interface OverdueRow {
  id: string;
  title: string;
  due_at: Date;
  status: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
}

async function fetchOverdueFromCrm(): Promise<OverdueRow[]> {
  try {
    const r = await pool.query(
      `SELECT t.id, t.title, t.due_at, t.status, t.assigned_to,
              u.name AS assignee_name, u.email AS assignee_email
       FROM tasks t
       LEFT JOIN users u ON u.id::text = t.assigned_to
       WHERE t.status != 'done'
         AND t.due_at IS NOT NULL
         AND t.due_at < NOW() - INTERVAL '2 days'
       ORDER BY t.due_at ASC`,
    );
    return r.rows as OverdueRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /api/blockers — fetch current overdue tasks for CRM display
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  try {
    const tasks = await fetchOverdueFromCrm();

    const blockers = tasks.map((task) => {
      const dueDate = new Date(task.due_at);
      const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        taskId:       task.id,
        taskName:     task.title,
        taskUrl:      '',
        assigneeName: task.assignee_name || 'Unassigned',
        assigneeId:   task.assigned_to,
        dueDate:      dueDate.toISOString(),
        daysOverdue,
        priority:     'normal',
        status:       task.status || 'open',
        tags:         [] as string[],
      };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Recent alert history (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const alertHistory = await db
      .select()
      .from(events)
      .where(and(
        eq(events.eventType, 'blocker_alert_sent'),
        gte(events.createdAt, sevenDaysAgo),
      ))
      .orderBy(desc(events.createdAt))
      .limit(50);

    res.json({
      blockers,
      totalCount:    blockers.length,
      criticalCount: blockers.filter((b) => b.daysOverdue >= 5).length,
      alertHistory:  alertHistory.map((a) => ({
        taskName:     (a.payload as Record<string, unknown>)?.taskName,
        assigneeName: (a.payload as Record<string, unknown>)?.assigneeName,
        daysOverdue:  (a.payload as Record<string, unknown>)?.daysOverdue,
        alertedAt:    (a.payload as Record<string, unknown>)?.alertedAt,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/blockers/check — manually trigger blocker check
// ---------------------------------------------------------------------------
router.post('/check', requireAuth, async (req, res) => {
  try {
    const result = await checkAndAlertBlockers();
    res.json({ success: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/blockers/dismiss/:taskId — dismiss alert for 24 hours
// ---------------------------------------------------------------------------
router.post('/dismiss/:taskId', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;

    if (!tenantId) {
      res.status(500).json({ error: 'tenant not found' });
      return;
    }

    await db.insert(events).values({
      tenantId,
      eventType: 'blocker_alert_sent',
      payload: { taskId, dismissedAt: new Date().toISOString(), dismissedBy: req.user!.email },
    });

    res.json({ success: true, message: 'Alert dismissed for 24 hours' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
