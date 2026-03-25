import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { checkAndAlertBlockers } from '../services/blockerAlertService';
import { db } from '../db/index';
import { events } from '../db/index';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import https from 'https';

const router = Router();

interface ClickUpRawTask {
  id: string;
  name: string;
  url: string;
  due_date: string | null;
  status?: { status?: string; type?: string };
  priority?: { priority?: string };
  assignees?: Array<{ id: number; username: string }>;
  tags?: Array<{ name: string }>;
}

async function fetchOverdueFromClickUp(): Promise<ClickUpRawTask[]> {
  const token = process.env.CLICKUP_API_TOKEN;
  const listId = process.env.CLICKUP_LIST_ID;

  if (!token || !listId || listId === 'placeholder_will_update') return [];

  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;

  return new Promise((resolve) => {
    https.get({
      hostname: 'api.clickup.com',
      path: `/api/v2/list/${listId}/task?include_closed=false&due_date_lt=${cutoff}&subtasks=true`,
      headers: { Authorization: token },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { tasks?: ClickUpRawTask[] };
          const tasks = (parsed.tasks || []).filter((t) => {
            const st = t.status?.type?.toLowerCase();
            return st !== 'closed' && st !== 'done' && t.due_date;
          });
          resolve(tasks);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

// ---------------------------------------------------------------------------
// GET /api/blockers — fetch current overdue tasks for CRM display
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  try {
    const tasks = await fetchOverdueFromClickUp();

    const blockers = tasks.map((task) => {
      const dueDate = new Date(parseInt(task.due_date!, 10));
      const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const assignee = task.assignees?.[0];

      return {
        taskId:       task.id,
        taskName:     task.name,
        taskUrl:      task.url,
        assigneeName: assignee?.username || 'Unassigned',
        assigneeId:   assignee?.id,
        dueDate:      dueDate.toISOString(),
        daysOverdue,
        priority:     task.priority?.priority || 'normal',
        status:       task.status?.status || 'unknown',
        tags:         task.tags?.map((t) => t.name) || [],
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
