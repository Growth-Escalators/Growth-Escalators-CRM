import logger from '../utils/logger';
import { fetchTasksForMember, fetchCompletedTodayForMember, type Task } from '../utils/clickupTasks';
import { sendSlackMessage, sendSlackDM } from './slackService';
import { pool } from '../db/index';
import {
  SLACK_SOD_EOD_CHANNEL,
  SLACK_JATIN, SLACK_SAKCHAM, SLACK_VISHAL, SLACK_NIMISHA, SLACK_KESHAV,
  CLICKUP_JATIN, CLICKUP_SAKCHAM, CLICKUP_VISHAL, CLICKUP_NIMISHA, CLICKUP_KESHAV,
} from '../config/constants';

const SOD_EOD_CHANNEL = SLACK_SOD_EOD_CHANNEL;

const TEAM = [
  { name: 'Jatin',   clickupId: String(CLICKUP_JATIN),   slackId: SLACK_JATIN,   showTeamOverview: true  },
  { name: 'Sakcham', clickupId: String(CLICKUP_SAKCHAM),  slackId: SLACK_SAKCHAM,  showTeamOverview: true  },
  { name: 'Vishal',  clickupId: String(CLICKUP_VISHAL),   slackId: SLACK_VISHAL,   showTeamOverview: false },
  { name: 'Nimisha', clickupId: String(CLICKUP_NIMISHA),  slackId: SLACK_NIMISHA,  showTeamOverview: false },
  { name: 'Keshav',  clickupId: String(CLICKUP_KESHAV),   slackId: SLACK_KESHAV,   showTeamOverview: false },
];

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function fmtOverdue(tasks: Task[]): string {
  return tasks.map(t => {
    const ago = t.daysOverdue === 1 ? '1 day ago' : `${t.daysOverdue} days ago`;
    return `  • ${t.name}${t.listName ? ` — ${t.listName}` : ''} _(due ${ago})_`;
  }).join('\n');
}
function fmtToday(tasks: Task[]): string {
  return tasks.map(t => `  • ${t.name}${t.listName ? ` — ${t.listName}` : ''}`).join('\n');
}
function fmtUpcoming(tasks: Task[]): string {
  return tasks.map(t => `  • ${t.name}${t.listName ? ` — ${t.listName}` : ''} _(due ${t.dueDateFormatted})_`).join('\n');
}
function fmtCompleted(tasks: Task[]): string {
  return tasks.map(t => `✓ ${t.name}`).join('\n');
}
function fmtOpen(tasks: Task[]): string {
  return tasks.map(t => {
    if (t.daysOverdue > 0) return `• ${t.name} — _${t.daysOverdue} day${t.daysOverdue === 1 ? '' : 's'} overdue_ ⚠️`;
    return `• ${t.name}`;
  }).join('\n');
}

type MemberResult = {
  member: typeof TEAM[0];
  overdue: Task[];
  dueToday: Task[];
  upcoming: Task[];
  all: Task[];
};

// -----------------------------------------------------------------------
// SOD Digest
// -----------------------------------------------------------------------
export async function sendSODDigest(): Promise<{ sent: number; errors: string[] }> {
  console.log('[SOD] starting digest…');
  const errors: string[] = [];
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const results: MemberResult[] = await Promise.all(
    TEAM.map(async (m) => {
      try {
        const data = await fetchTasksForMember(m.clickupId);
        return { member: m, ...data };
      } catch (e) {
        logger.error(`[SOD] fetch failed for ${m.name}:`, e);
        errors.push(`fetch: ${m.name}`);
        return { member: m, overdue: [], dueToday: [], upcoming: [], all: [] };
      }
    })
  );

  let sent = 0;

  // Send in order: Jatin, Sakcham, Vishal, Nimisha, Keshav
  for (const mr of results) {
    try {
      let msg = '';

      // Team overview for Jatin and Sakcham
      if (mr.member.showTeamOverview) {
        const totalOverdue = results.reduce((s, r) => s + r.overdue.length, 0);
        const othersForOverview = results.filter(r => r.member.clickupId !== mr.member.clickupId);

        msg += `📊 *Team Overview — ${dateStr}*\n\nOverdue across team: *${totalOverdue}*\n`;
        for (const o of othersForOverview) {
          msg += `- <@${o.member.slackId}> (${o.member.name}): ${o.overdue.length} overdue\n`;
        }
        msg += `\n━━━━━━━━━━━━━━━━━━\n📋 *Your tasks, ${mr.member.name}:*\n`;
        msg += buildTaskSection(mr);
      } else {
        // Regular members — no overview
        const total = mr.overdue.length + mr.dueToday.length + mr.upcoming.length;
        if (total === 0 && mr.all.length === 0) {
          msg = `📋 Good morning <@${mr.member.slackId}>! 🎉\nYour task list is clear today. Add tasks in ClickUp if needed.`;
        } else {
          msg = `📋 Good morning <@${mr.member.slackId}> — here's your day:\n\n`;
          msg += buildTaskSection(mr);
        }
      }

      const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg);
      if (ok) { sent++; console.log(`[SOD] sent for ${mr.member.name}`); }
      else { errors.push(`post: ${mr.member.name}`); }
    } catch (e) { errors.push(`${mr.member.name}: ${e}`); }
    await delay(2000);
  }

  console.log(`[SOD] complete — sent: ${sent}/${TEAM.length}, errors: ${errors.length}`);
  return { sent, errors };
}

function buildTaskSection(r: MemberResult): string {
  const total = r.overdue.length + r.dueToday.length + r.upcoming.length;
  let msg = '';
  if (r.overdue.length > 0) msg += `🔴 *Overdue (${r.overdue.length}):*\n${fmtOverdue(r.overdue)}\n\n`;
  if (r.dueToday.length > 0) msg += `🟡 *Due Today (${r.dueToday.length}):*\n${fmtToday(r.dueToday)}\n\n`;
  if (r.upcoming.length > 0) msg += `🟢 *Upcoming (${r.upcoming.length}):*\n${fmtUpcoming(r.upcoming)}\n\n`;
  if (total > 0) msg += `_${total} tasks total · Have a great day! 💪_`;
  else if (r.all.length > 0) msg += `_${r.all.length} tasks with no due date._`;
  return msg;
}

// -----------------------------------------------------------------------
// EOD Summary
// -----------------------------------------------------------------------
export async function sendEODSummary(): Promise<{ sent: number; errors: string[] }> {
  console.log('[EOD] starting summary…');
  const errors: string[] = [];
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  type EODResult = { member: typeof TEAM[0]; completed: Task[]; openTasks: Task[]; overdue: Task[] };
  const results: EODResult[] = await Promise.all(
    TEAM.map(async (m) => {
      try {
        const [completed, taskData] = await Promise.all([
          fetchCompletedTodayForMember(m.clickupId),
          fetchTasksForMember(m.clickupId),
        ]);
        return { member: m, completed, openTasks: taskData.all, overdue: taskData.overdue };
      } catch (e) {
        logger.error(`[EOD] fetch failed for ${m.name}:`, e);
        errors.push(`fetch: ${m.name}`);
        return { member: m, completed: [] as Task[], openTasks: [] as Task[], overdue: [] as Task[] };
      }
    })
  );

  let sent = 0;

  for (const mr of results) {
    try {
      let msg = '';

      if (mr.member.showTeamOverview) {
        const totalCompleted = results.reduce((s, r) => s + r.completed.length, 0);
        const othersForOverview = results.filter(r => r.member.clickupId !== mr.member.clickupId);

        msg += `📊 *Team EOD — ${dateStr}*\n\nCompleted today across team: *${totalCompleted}*\n`;
        for (const o of othersForOverview) {
          msg += `• <@${o.member.slackId}>: ${o.completed.length} done, ${o.openTasks.length} open\n`;
        }
        msg += `\n━━━━━━━━━━━━━━━━━━\n`;
      }

      msg += buildEODSection(mr);

      const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg);
      if (ok) { sent++; console.log(`[EOD] sent for ${mr.member.name}`); }
      else { errors.push(`post: ${mr.member.name}`); }
    } catch (e) { errors.push(`${mr.member.name}: ${e}`); }
    await delay(2000);
  }

  console.log(`[EOD] complete — sent: ${sent}/${TEAM.length}, errors: ${errors.length}`);
  return { sent, errors };
}

function buildEODSection(r: { member: typeof TEAM[0]; completed: Task[]; openTasks: Task[] }): string {
  if (r.completed.length === 0) {
    return `📝 *EOD — <@${r.member.slackId}>*\nNo tasks completed today.\nOpen: ${r.openTasks.length} tasks\n_Remember to update ClickUp as you finish work!_`;
  }
  let msg = `✅ *EOD Summary — <@${r.member.slackId}>*\n\n`;
  msg += `*Completed today (${r.completed.length}):*\n${fmtCompleted(r.completed)}\n\n`;
  if (r.openTasks.length > 0) msg += `*Still open (${r.openTasks.length}):*\n${fmtOpen(r.openTasks)}\n\n`;
  msg += `_${r.completed.length} done · ${r.openTasks.length} carry forward_`;
  return msg;
}

// -----------------------------------------------------------------------
// Sakcham's Priority SOD — sent as a DM at 10 AM Mon-Sat
// Shows: agency owners needing follow-up + D2C hot leads (bump2 purchased)
// Does NOT show: scoring internals, automation details, freelancer pipeline
// -----------------------------------------------------------------------
export async function sendSakhamSOD(): Promise<void> {
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  // Priority 1: Agency owners stuck in Paid ₹9 for >24h with no appointment booked
  let agencyRows: Array<{ name: string; phone: string | null; email: string | null; placed_at: Date; hours_waiting: number }> = [];
  try {
    const agencyResult = await pool.query(`
      SELECT
        c.first_name || COALESCE(' ' || c.last_name, '') AS name,
        (SELECT channel_value FROM contact_channels
         WHERE contact_id = c.id AND channel_type = 'whatsapp' LIMIT 1) AS phone,
        (SELECT channel_value FROM contact_channels
         WHERE contact_id = c.id AND channel_type = 'email' AND is_primary = true LIMIT 1) AS email,
        pc.placed_at,
        EXTRACT(EPOCH FROM (NOW() - pc.placed_at)) / 3600 AS hours_waiting
      FROM contacts c
      JOIN pipeline_contacts pc ON pc.contact_id = c.id
      JOIN pipelines p ON p.id = pc.pipeline_id
      WHERE p.name = 'Agency Owners'
        AND pc.stage_name = 'Paid ₹9'
        AND pc.placed_at < NOW() - INTERVAL '24 hours'
        AND NOT ('appt_booked' = ANY(c.tags))
      ORDER BY pc.placed_at ASC
      LIMIT 10
    `);
    agencyRows = agencyResult.rows as typeof agencyRows;
  } catch (e) {
    logger.error('[SakhamSOD] agency query failed:', e);
  }

  // Priority 2: D2C contacts with audit call (bump2) in last 48h, no appointment booked
  let d2cAuditRows: Array<{ name: string; phone: string | null; email: string | null; created_at: Date; hours_ago: number }> = [];
  try {
    const d2cResult = await pool.query(`
      SELECT
        c.first_name || COALESCE(' ' || c.last_name, '') AS name,
        (SELECT channel_value FROM contact_channels
         WHERE contact_id = c.id AND channel_type = 'whatsapp' LIMIT 1) AS phone,
        (SELECT channel_value FROM contact_channels
         WHERE contact_id = c.id AND channel_type = 'email' AND is_primary = true LIMIT 1) AS email,
        c.created_at,
        EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600 AS hours_ago
      FROM contacts c
      WHERE 'bump2' = ANY(c.tags)
        AND (c.metadata->>'segment' = 'd2c' OR c.metadata->>'segment' = 'ecom_brand' OR 'ecom_brand' = ANY(c.tags))
        AND c.created_at > NOW() - INTERVAL '48 hours'
        AND NOT ('appt_booked' = ANY(c.tags))
      ORDER BY c.created_at DESC
      LIMIT 10
    `);
    d2cAuditRows = d2cResult.rows as typeof d2cAuditRows;
  } catch (e) {
    logger.error('[SakhamSOD] d2c audit query failed:', e);
  }

  // Build message
  let msg = `📋 *Your Priority SOD — ${dateStr}*\n\n`;

  if (agencyRows.length === 0 && d2cAuditRows.length === 0) {
    msg += `✅ No priority follow-ups today. All clear!\n`;
  }

  if (agencyRows.length > 0) {
    msg += `🏢 *Agency Owners — need follow-up (stuck in Paid ₹9 > 24h)*\n`;
    for (const r of agencyRows) {
      const hrs = Math.round(r.hours_waiting);
      msg += `  • ${r.name} | ${r.phone ?? 'no phone'} | ${r.email ?? 'no email'} | waiting ${hrs}h\n`;
    }
    msg += `\n_Action: Call to book discovery / whitelist call_\n\n`;
  }

  if (d2cAuditRows.length > 0) {
    msg += `🎯 *D2C Hot Leads — bought audit call, no booking yet*\n`;
    for (const r of d2cAuditRows) {
      const hrs = Math.round(r.hours_ago);
      msg += `  • ${r.name} | ${r.phone ?? 'no phone'} | ${r.email ?? 'no email'} | bought ${hrs}h ago\n`;
    }
    msg += `\n_Action: Confirm audit call booking link was sent_\n`;
  }

  msg += `\n_Sent automatically at 10 AM · Reply DONE to mark follow-ups complete_`;

  await sendSlackDM(SLACK_SAKCHAM, msg);
  logger.info(`[SakhamSOD] sent — agency: ${agencyRows.length}, d2c_audit: ${d2cAuditRows.length}`);
}
