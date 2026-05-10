import logger from '../utils/logger';
import { db, events, pool } from '../db/index';
import { sql } from 'drizzle-orm';
import { sendSlackMessage, sendSlackDM } from './slackService';
import {
  SLACK_GENERAL_CHANNEL, SLACK_JATIN, SLACK_SAKCHAM, SLACK_KESHAV,
  BLOCKER_THRESHOLD_DAYS as BT_DAYS, CRITICAL_THRESHOLD_DAYS as CT_DAYS,
} from '../config/constants';

const GENERAL_CHANNEL = SLACK_GENERAL_CHANNEL;
const BLOCKER_THRESHOLD_DAYS = BT_DAYS;
const CRITICAL_THRESHOLD_DAYS = CT_DAYS;
const JATIN_SLACK = SLACK_JATIN;

// CRM-tasks-backed blocker check (replaces ClickUp). Each entry maps a
// users.id to a Slack ID for tagging.
interface TeamMember { name: string; userId: string | null; slackId: string }

async function getTeamMembers(): Promise<TeamMember[]> {
  // Resolve current team-member user IDs by email. Anyone not in the users
  // table is silently skipped — keeps this resilient as people are added/removed.
  const emails: Array<{ name: string; email: string; slackId: string }> = [
    { name: 'Jatin',   email: 'jatin@growthescalators.com',           slackId: SLACK_JATIN },
    { name: 'Sakcham', email: 'sakcham@growthescalators.com',         slackId: SLACK_SAKCHAM },
    { name: 'Keshav',  email: 'keshav.growthescalators@gmail.com',    slackId: SLACK_KESHAV },
  ];

  const result: TeamMember[] = [];
  for (const e of emails) {
    try {
      const r = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [e.email]);
      const userId = (r.rows[0] as { id: string } | undefined)?.id ?? null;
      result.push({ name: e.name, userId, slackId: e.slackId });
    } catch {
      result.push({ name: e.name, userId: null, slackId: e.slackId });
    }
  }
  return result;
}

interface OverdueTask {
  id: string;
  name: string;
  daysOverdue: number;
  dueDateFormatted: string;
  listName: string;
}

async function fetchOverdueTasksForUser(userId: string): Promise<OverdueTask[]> {
  if (!userId) return [];
  try {
    const r = await pool.query(
      `SELECT id, title, due_at,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - due_at)) / 86400)::int AS days_overdue
       FROM tasks
       WHERE assigned_to = $1
         AND status != 'done'
         AND due_at IS NOT NULL
         AND due_at < NOW()
       ORDER BY due_at ASC`,
      [userId],
    );
    return (r.rows as Array<{ id: string; title: string; due_at: Date; days_overdue: number }>).map(row => ({
      id: row.id,
      name: row.title || 'Untitled',
      daysOverdue: Number(row.days_overdue ?? 0),
      dueDateFormatted: new Date(row.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      listName: '',
    }));
  } catch (e) {
    logger.error(`[blockers] CRM tasks fetch failed for user ${userId}:`, e);
    return [];
  }
}

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

  const team = await getTeamMembers();
  const allOverdue: Array<{ task: OverdueTask; member: TeamMember }> = [];

  for (const member of team) {
    if (!member.userId) continue;
    try {
      const overdue = await fetchOverdueTasksForUser(member.userId);
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
      `Due: ${task.dueDateFormatted}\n\n` +
      `Please update task status or flag if blocked.`;

    await sendSlackMessage(GENERAL_CHANNEL, msg);

    // Critical: 5+ days overdue → also DM Jatin directly
    if (task.daysOverdue >= CRITICAL_THRESHOLD_DAYS) {
      const dmMsg = `🚨 *Critical Blocker — Needs Your Attention*\n\n` +
        `<@${member.slackId}>'s task is overdue by *${task.daysOverdue} days:*\n` +
        `*"${task.name}"*\n` +
        `Due: ${task.dueDateFormatted}\n\n` +
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
