import { db, events } from '../db/index';
import { and, gte, sql } from 'drizzle-orm';
import { sendSlackMessage, sendSlackDM } from './slackService';
import { fetchTasksForMember, type Task } from '../utils/clickupTasks';

const GENERAL_CHANNEL = 'C07489V0RB2';
const BLOCKER_THRESHOLD_DAYS = 2;
const CRITICAL_THRESHOLD_DAYS = 5;
const JATIN_SLACK = 'U073Y677JBB';

const TEAM = [
  { name: 'Jatin',   clickupId: '88911769',  slackId: 'U073Y677JBB' },
  { name: 'Sakcham', clickupId: '242618940', slackId: 'U09TY8RGN30' },
  { name: 'Vishal',  clickupId: '100972806', slackId: 'U0ALC9Z09RA' },
  { name: 'Nimisha', clickupId: '100972807', slackId: 'U0ALMKD2XFB' },
  { name: 'Keshav',  clickupId: '4800274',   slackId: 'U073Y6S4K4H' },
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
    console.error('[blockers] log error:', e);
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
      console.error(`[blockers] fetch failed for ${member.name}:`, e);
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
