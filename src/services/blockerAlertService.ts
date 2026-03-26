import https from 'https';
import { db } from '../db/index';
import { events } from '../db/index';
import { and, gte, sql } from 'drizzle-orm';
import { sendSlackMessage } from './slackService';
import { SLACK_CHANNELS, getSlackIdFromClickup, SLACK_IDS, getNameFromClickup, delay } from '../utils/clickupSlack';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const BLOCKER_THRESHOLD_DAYS = 2;
const ALERT_COOLDOWN_HOURS = 24;

interface ClickUpTask {
  id: string;
  name: string;
  status: { status: string; type: string };
  assignees: Array<{ id: number; username: string; email: string }>;
  due_date: string | null;
  date_updated: string;
  priority: { id: string; priority: string } | null;
  tags: Array<{ name: string }>;
  url: string;
  list?: { name: string };
}

async function fetchOverdueTasks(): Promise<ClickUpTask[]> {
  if (!CLICKUP_TOKEN || !CLICKUP_LIST_ID || CLICKUP_LIST_ID === 'placeholder_will_update') {
    console.log('[blockers] ClickUp not configured — skipping');
    return [];
  }

  return new Promise((resolve) => {
    const cutoffDate = Date.now() - BLOCKER_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const path = `/api/v2/list/${CLICKUP_LIST_ID}/task?include_closed=false&due_date_lt=${cutoffDate}&subtasks=true`;

    https.get({
      hostname: 'api.clickup.com',
      path,
      headers: { Authorization: CLICKUP_TOKEN! },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { tasks?: ClickUpTask[] };
          const tasks = (parsed.tasks || []).filter((t) => {
            const statusType = t.status?.type?.toLowerCase();
            return statusType !== 'closed' && statusType !== 'done' && t.due_date;
          });
          resolve(tasks);
        } catch (e) {
          console.error('[blockers] ClickUp fetch error:', e);
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

let cachedTenantId: string | null = null;
async function getTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;
  try {
    const result = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    const id = (result.rows[0] as { id: string } | undefined)?.id ?? null;
    cachedTenantId = id;
    return id;
  } catch {
    return null;
  }
}

async function wasRecentlyAlerted(taskId: string): Promise<boolean> {
  const cooldownTime = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000);
  try {
    const recentAlerts = await db
      .select()
      .from(events)
      .where(
        and(
          sql`${events.eventType} = 'blocker_alert_sent'`,
          gte(events.createdAt, cooldownTime),
          sql`${events.payload}->>'taskId' = ${taskId}`,
        ),
      )
      .limit(1);
    return recentAlerts.length > 0;
  } catch {
    return false;
  }
}

async function logAlertSent(taskId: string, taskName: string, assigneeName: string, daysOverdue: number) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return;
    await db.insert(events).values({
      tenantId,
      eventType: 'blocker_alert_sent',
      payload: { taskId, taskName, assigneeName, daysOverdue, alertedAt: new Date().toISOString() },
    });
  } catch (e) {
    console.error('[blockers] Failed to log alert:', e);
  }
}

function formatDaysOverdue(dueDateMs: string): { days: number; label: string } {
  const due = new Date(parseInt(dueDateMs, 10));
  const days = Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24));
  return { days, label: days === 1 ? '1 day' : `${days} days` };
}

// Main blocker check — called by cron every 6 hours
// Posts to #general, tags both assignee AND Jatin, one message per task
export async function checkAndAlertBlockers(): Promise<{ checked: number; alerted: number; skipped: number }> {
  console.log('[blockers] check starting…');

  const overdueTasks = await fetchOverdueTasks();
  console.log(`[blockers] found ${overdueTasks.length} overdue tasks`);

  let alerted = 0;
  let skipped = 0;

  for (const task of overdueTasks) {
    if (!task.due_date) continue;

    const { days, label } = formatDaysOverdue(task.due_date);
    if (days < BLOCKER_THRESHOLD_DAYS) continue;

    const alreadyAlerted = await wasRecentlyAlerted(task.id);
    if (alreadyAlerted) {
      skipped++;
      continue;
    }

    const assignee = task.assignees[0];
    const assigneeName = assignee ? getNameFromClickup(assignee.id) : 'Unassigned';
    const assigneeSlackId = assignee ? getSlackIdFromClickup(String(assignee.id)) : null;
    const dueDate = new Date(parseInt(task.due_date, 10)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const listName = (task.list as Record<string,string> | undefined)?.name || 'Main';

    // Tag both assignee and Jatin
    let tagLine = `<@${SLACK_IDS.jatin}>`;
    if (assigneeSlackId && assigneeSlackId !== SLACK_IDS.jatin) {
      tagLine = `<@${assigneeSlackId}> <@${SLACK_IDS.jatin}>`;
    }

    const msg = `⚠️ *Blocker Alert* — ${tagLine}\n` +
      `Task overdue by *${label}*:\n` +
      `"${task.name}"\n` +
      `Due: ${dueDate} · Assigned: ${assigneeName}\n` +
      `List: ${listName}\n` +
      `Please update the task status or flag if you are blocked.\n` +
      `<${task.url}|View in ClickUp>`;

    // Post to #general channel
    await sendSlackMessage(SLACK_CHANNELS.general, msg);
    await logAlertSent(task.id, task.name, assigneeName, days);
    alerted++;

    await delay(500);
  }

  console.log(`[blockers] done — checked: ${overdueTasks.length}, alerted: ${alerted}, skipped (cooldown): ${skipped}`);
  return { checked: overdueTasks.length, alerted, skipped };
}
