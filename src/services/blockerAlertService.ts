import { db, events } from '../db/index';
import { and, gte, sql } from 'drizzle-orm';
import { sendSlackMessage } from './slackService';
import { fetchTasksForMember, type Task } from '../utils/clickupTasks';

const GENERAL_CHANNEL = 'C07489V0RB2';
const BLOCKER_THRESHOLD_DAYS = 2;
const ALERT_COOLDOWN_HOURS = 24;
const JATIN_SLACK = 'U073Y677JBB';

const TEAM = [
  { name: 'Jatin',     clickupId: '88911769',  slackId: 'U073Y677JBB' },
  { name: 'Vishal',    clickupId: '100972806', slackId: 'U0ALC9Z09RA' },
  { name: 'Sanskriti', clickupId: '100860514', slackId: 'U09TXBW2XPX' },
  { name: 'Sakcham',   clickupId: '242618940', slackId: 'U09TY8RGN30' },
  { name: 'Nimisha',   clickupId: '100972807', slackId: 'U0ALMKD2XFB' },
  { name: 'Keshav',    clickupId: '4800274',   slackId: 'U073Y6S4K4H' },
];

let cachedTenantId: string | null = null;
async function getTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;
  try {
    const result = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    cachedTenantId = (result.rows[0] as { id: string } | undefined)?.id ?? null;
    return cachedTenantId;
  } catch { return null; }
}

async function wasRecentlyAlerted(taskId: string): Promise<boolean> {
  const cooldownTime = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000);
  try {
    const recent = await db.select().from(events)
      .where(and(
        sql`${events.eventType} = 'blocker_alert_sent'`,
        gte(events.createdAt, cooldownTime),
        sql`${events.payload}->>'taskId' = ${taskId}`,
      ))
      .limit(1);
    return recent.length > 0;
  } catch { return false; }
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
  console.log('[blockers] starting team-level check…');

  // Fetch overdue tasks for all members using team-level API
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
    const already = await wasRecentlyAlerted(task.id);
    if (already) { skipped++; continue; }

    let tagLine = `<@${JATIN_SLACK}>`;
    if (member.slackId !== JATIN_SLACK) {
      tagLine = `<@${member.slackId}> <@${JATIN_SLACK}>`;
    }

    const msg = `⚠️ *Blocker Alert* — ${tagLine}\n\n` +
      `Task overdue by *${task.daysOverdue} day${task.daysOverdue === 1 ? '' : 's'}*:\n` +
      `*"${task.name}"*\n` +
      `List: ${task.listName || 'Unknown'} · Due: ${task.dueDateFormatted}\n\n` +
      `Please update the task status or flag if you are blocked.`;

    await sendSlackMessage(GENERAL_CHANNEL, msg);
    await logAlertSent(task.id, task.name, member.name, task.daysOverdue);
    alerted++;

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[blockers] done — checked: ${allOverdue.length}, alerted: ${alerted}, skipped: ${skipped}`);
  return { checked: allOverdue.length, alerted, skipped };
}
