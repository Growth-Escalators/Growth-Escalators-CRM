import https from 'https';
import { db } from '../db/index';
import { events, tenants } from '../db/index';
import { eq, and, gte, sql } from 'drizzle-orm';
import { sendSlackDM, CHANNELS, MEMBER_MAP, SLACK_MEMBERS } from './slackService';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;
const BLOCKER_THRESHOLD_DAYS = 2;   // tasks overdue by more than this many days trigger an alert
const ALERT_COOLDOWN_HOURS = 24;    // do not re-alert for the same task within this many hours

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
}

// Fetch all overdue tasks from ClickUp list
async function fetchOverdueTasks(): Promise<ClickUpTask[]> {
  if (!CLICKUP_TOKEN || !CLICKUP_LIST_ID || CLICKUP_LIST_ID === 'placeholder_will_update') {
    console.log('[blockers] ClickUp not configured — skipping');
    return [];
  }

  return new Promise((resolve) => {
    const cutoffDate = Date.now() - BLOCKER_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const path = `/api/v2/list/${CLICKUP_LIST_ID}/task?include_closed=false&due_date_lt=${cutoffDate}&subtasks=true`;

    const options = {
      hostname: 'api.clickup.com',
      path,
      headers: { Authorization: CLICKUP_TOKEN },
    };

    https.get(options, (res) => {
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

// Get the growth-escalators tenant ID (cached after first call)
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

// Check if we already alerted for this task recently
async function wasRecentlyAlerted(taskId: string): Promise<boolean> {
  const cooldownTime = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000);

  try {
    const recentAlerts = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.eventType, 'blocker_alert_sent'),
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

// Log that we sent an alert for this task
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

// Try to find linked deal value from CRM
async function findLinkedDealValue(
  taskName: string,
): Promise<{ contactName: string; dealValue: number; stage: string } | null> {
  try {
    const nameMatch = taskName.match(/(?:—|–|-)\s*(.+?)(?:\s*—|\s*–|\s*\(|$)/i);
    if (!nameMatch) return null;

    const searchName = nameMatch[1].trim();

    const result = await db.execute(sql`
      SELECT c.first_name, c.last_name, d.deal_value, d.stage
      FROM contacts c
      JOIN deals d ON d.contact_id = c.id
      WHERE CONCAT(c.first_name, ' ', c.last_name) ILIKE ${'%' + searchName + '%'}
        AND d.closed_at IS NULL
      ORDER BY d.created_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as { first_name: string; last_name: string; deal_value: number; stage: string };
    return {
      contactName: `${row.first_name} ${row.last_name}`,
      dealValue: row.deal_value || 0,
      stage: row.stage || 'Unknown',
    };
  } catch {
    return null;
  }
}

function formatDaysOverdue(dueDateMs: string): { days: number; label: string } {
  const due = new Date(parseInt(dueDateMs, 10));
  const days = Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24));
  return { days, label: days === 1 ? '1 day' : `${days} days` };
}

function getSlackId(clickupUserId: number): string | null {
  return MEMBER_MAP[clickupUserId.toString()]?.slackId ?? null;
}

function formatBlockerAlert(
  task: ClickUpTask,
  daysOverdueLabel: string,
  assigneeName: string,
  dealInfo: { contactName: string; dealValue: number; stage: string } | null,
): string {
  let msg = `⚠️ *Blocker detected — action needed*\n\n`;
  msg += `*${assigneeName}* has not completed:\n`;
  msg += `"${task.name}"\n`;
  msg += `This task is *${daysOverdueLabel} overdue*.\n\n`;

  if (dealInfo && dealInfo.dealValue > 0) {
    const formatted = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(dealInfo.dealValue);
    msg += `💰 *Deal at risk:* ${formatted}/month in *${dealInfo.stage}* stage\n`;
    msg += `👤 *Contact:* ${dealInfo.contactName}\n\n`;
  }

  msg += `*What to do:*\n`;
  msg += `→ Message ${assigneeName} directly\n`;
  msg += `→ Reassign this task\n`;
  msg += `→ <${task.url}|View task in ClickUp>`;

  return msg;
}

// Main blocker check — called by cron every 6 hours
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
    const assigneeName = assignee?.username || 'Unknown';
    const assigneeSlackId = assignee ? getSlackId(assignee.id) : null;

    const dealInfo = await findLinkedDealValue(task.name);
    const alertText = formatBlockerAlert(task, label, assigneeName, dealInfo);

    // Always DM Jatin
    await sendSlackDM(SLACK_MEMBERS.jatin, alertText);

    // Also DM the assignee if they're different from Jatin
    if (assigneeSlackId && assigneeSlackId !== SLACK_MEMBERS.jatin) {
      const assigneeMsg =
        `⚠️ *Heads up* — your task is overdue:\n"${task.name}"\n*${label} overdue*\n\n<${task.url}|View and update in ClickUp>`;
      await sendSlackDM(assigneeSlackId, assigneeMsg);
    }

    await logAlertSent(task.id, task.name, assigneeName, days);
    alerted++;

    // Small delay to avoid Slack rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[blockers] done — checked: ${overdueTasks.length}, alerted: ${alerted}, skipped (cooldown): ${skipped}`);
  return { checked: overdueTasks.length, alerted, skipped };
}
