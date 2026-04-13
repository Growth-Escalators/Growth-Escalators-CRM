import logger from '../utils/logger';
import { db, events } from '../db/index';
import { and, gte, sql } from 'drizzle-orm';
import { sendSlackMessage, sendSlackDM } from './slackService';
import { fetchTasksForMember, type Task } from '../utils/clickupTasks';
import {
  SLACK_GENERAL_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_NIMISHA, SLACK_KESHAV,
  BLOCKER_THRESHOLD_DAYS as BT_DAYS, CRITICAL_THRESHOLD_DAYS as CT_DAYS,
  CLICKUP_JATIN, CLICKUP_SAKCHAM, CLICKUP_NIMISHA, CLICKUP_KESHAV,
} from '../config/constants';

const GENERAL_CHANNEL = SLACK_GENERAL_CHANNEL;
const BLOCKER_THRESHOLD_DAYS = BT_DAYS;
const CRITICAL_THRESHOLD_DAYS = CT_DAYS;
const JATIN_SLACK = SLACK_JATIN;

const TEAM = [
  { name: 'Jatin',   clickupId: String(CLICKUP_JATIN),   slackId: SLACK_JATIN },
  { name: 'Sakcham', clickupId: String(CLICKUP_SAKCHAM),  slackId: SLACK_SAKCHAM },
  { name: 'Nimisha', clickupId: String(CLICKUP_NIMISHA),  slackId: SLACK_NIMISHA },
  { name: 'Keshav',  clickupId: String(CLICKUP_KESHAV),   slackId: SLACK_KESHAV },
];

// In-memory daily dedup: taskId+date → true
const alertedToday = new Map<string, boolean>();
let lastResetDate = '';

function resetIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastResetDate) {
    alertedToday.clear();
    lastResetDate = today;
  }
}

let cachedTenantId: string | null = null;
async function getTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;
  try {
    const result = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    cachedTenantId = (result.rows[0] as { id: string } | undefined)?.id ?? null;
    return cachedTenantId;
  } catch { return null; }
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
    logger.error('[blockers] log error:', e);
  }
}

export async function checkAndAlertBlockers(): Promise<{ checked: number; alerted: number; skipped: number }> {
  console.log('[blockers] starting check…');
  resetIfNewDay();

  const allOverdue: Array<{ task: Task; member: typeof TEAM[0] }> = [];

  for (const member of TEAM) {
    try {
      const { overdue } = await fetchTasksForMember(member.clickupId);
      for (const t of overdue) {
        if (t.daysOverdue >= BLOCKER_THRESHOLD_DAYS) {
          allOverdue.push({ task: t, member });
        }
      }
    } catch (e) {
      logger.error(`[blockers] fetch failed for ${member.name}:`, e);
    }
  }

  console.log(`[blockers] found ${allOverdue.length} tasks overdue by ${BLOCKER_THRESHOLD_DAYS}+ days`);

  let alerted = 0;
  let skipped = 0;

  for (const { task, member } of allOverdue) {
    const dedupKey = `${task.id}_${lastResetDate}`;
    if (alertedToday.has(dedupKey)) { skipped++; continue; }

    let tagLine = `<@${JATIN_SLACK}>`;
    if (member.slackId !== JATIN_SLACK) {
      tagLine = `<@${member.slackId}> <@${JATIN_SLACK}>`;
    }

    const msg = `⚠️ *Blocker Alert* — ${tagLine}\n\n` +
      `Task overdue by *${task.daysOverdue} day${task.daysOverdue === 1 ? '' : 's'}:*\n` +
      `*"${task.name}"*\n` +
      `List: ${task.listName || 'Unknown'} · Due: ${task.dueDateFormatted}\n\n` +
      `Please update task status or flag if blocked.`;

    await sendSlackMessage(GENERAL_CHANNEL, msg);

    // Critical: 5+ days overdue → also DM Jatin directly
    if (task.daysOverdue >= CRITICAL_THRESHOLD_DAYS) {
      const dmMsg = `🚨 *Critical Blocker — Needs Your Attention*\n\n` +
        `<@${member.slackId}>'s task is overdue by *${task.daysOverdue} days:*\n` +
        `*"${task.name}"*\n` +
        `List: ${task.listName || 'Unknown'} · Due: ${task.dueDateFormatted}\n\n` +
        `This has been overdue for ${task.daysOverdue} days and needs immediate action.`;
      await sendSlackDM(JATIN_SLACK, dmMsg);
    }

    alertedToday.set(dedupKey, true);
    await logAlertSent(task.id, task.name, member.name, task.daysOverdue);
    alerted++;

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[blockers] done — checked: ${allOverdue.length}, alerted: ${alerted}, skipped: ${skipped}`);
  return { checked: allOverdue.length, alerted, skipped };
}
