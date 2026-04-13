import logger from '../utils/logger';
import https from 'https';
import { fetchTasksForMember, fetchCompletedTodayForMember, type Task } from '../utils/clickupTasks';
import { sendSlackMessage, sendSlackDM } from './slackService';
import { pool } from '../db/index';
import {
  SLACK_SOD_EOD_CHANNEL,
  SLACK_JATIN, SLACK_SAKCHAM, SLACK_NIMISHA, SLACK_KESHAV,
  CLICKUP_JATIN, CLICKUP_SAKCHAM, CLICKUP_NIMISHA, CLICKUP_KESHAV,
  CLICKUP_TEAM_ID,
} from '../config/constants';

const SOD_EOD_CHANNEL = SLACK_SOD_EOD_CHANNEL;

const TEAM = [
  { name: 'Jatin',   clickupId: String(CLICKUP_JATIN),   slackId: SLACK_JATIN,   showTeamOverview: true  },
  { name: 'Sakcham', clickupId: String(CLICKUP_SAKCHAM),  slackId: SLACK_SAKCHAM,  showTeamOverview: true  },
  { name: 'Nimisha', clickupId: String(CLICKUP_NIMISHA),  slackId: SLACK_NIMISHA,  showTeamOverview: false },
  { name: 'Keshav',  clickupId: String(CLICKUP_KESHAV),   slackId: SLACK_KESHAV,   showTeamOverview: false },
];

// Extended task type with assignee name for team-level EOD
interface TeamTask extends Task {
  assigneeName: string;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// IST helpers (local — not exported from clickupTasks)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istTodayStartMs(): number {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  return new Date(Date.UTC(y, m, d)).getTime() - IST_OFFSET_MS;
}
function istTomorrowStartMs(): number { return istTodayStartMs() + 24 * 60 * 60 * 1000; }
function istTomorrowEndMs():   number { return istTodayStartMs() + 48 * 60 * 60 * 1000 - 1; }

// Format helpers (SOD — unchanged)
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
  return tasks.map(t => {
    let line = `✓ ${t.name}`;
    if (t.listName) line += ` — _${t.listName}_`;
    if (t.daysOverdue > 0) line += ` ⚠️ _was ${t.daysOverdue}d overdue_`;
    return line;
  }).join('\n');
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
// SOD Digest (unchanged)
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

  for (const mr of results) {
    try {
      let msg = '';

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
// EOD — Team-level data helpers
// -----------------------------------------------------------------------

/** All tasks completed today across all team members */
export async function fetchCompletedToday(): Promise<TeamTask[]> {
  const results: TeamTask[] = [];
  for (const member of TEAM) {
    try {
      const tasks = await fetchCompletedTodayForMember(member.clickupId);
      for (const t of tasks) results.push({ ...t, assigneeName: member.name });
    } catch (e) {
      logger.error(`[EOD] fetchCompletedToday failed for ${member.name}:`, e);
    }
  }
  return results;
}

/** All overdue open tasks, sorted worst-first */
export async function fetchOverdueTasks(): Promise<TeamTask[]> {
  const results: TeamTask[] = [];
  for (const member of TEAM) {
    try {
      const data = await fetchTasksForMember(member.clickupId);
      for (const t of data.overdue) results.push({ ...t, assigneeName: member.name });
    } catch (e) {
      logger.error(`[EOD] fetchOverdueTasks failed for ${member.name}:`, e);
    }
  }
  results.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return results;
}

/** Tasks currently in progress */
export async function fetchInProgressToday(): Promise<TeamTask[]> {
  const results: TeamTask[] = [];
  for (const member of TEAM) {
    try {
      const data = await fetchTasksForMember(member.clickupId);
      const inProgress = data.all.filter(t => {
        const s = t.status.toLowerCase().replace(/[\s_-]/g, '');
        return s === 'inprogress' || s === 'active' || s.includes('progress');
      });
      for (const t of inProgress) results.push({ ...t, assigneeName: member.name });
    } catch (e) {
      logger.error(`[EOD] fetchInProgressToday failed for ${member.name}:`, e);
    }
  }
  return results;
}

/** Tasks due tomorrow that are not yet started */
export async function fetchAtRiskTomorrow(): Promise<TeamTask[]> {
  const results: TeamTask[] = [];
  const tStart = istTomorrowStartMs();
  const tEnd   = istTomorrowEndMs();

  for (const member of TEAM) {
    try {
      const data = await fetchTasksForMember(member.clickupId);
      const atRisk = data.all.filter(t => {
        if (!t.dueDate) return false;
        if (t.dueDate < tStart || t.dueDate > tEnd) return false;
        const s = t.status.toLowerCase().replace(/[\s_-]/g, '');
        return !s.includes('progress') && !s.includes('review') && !s.includes('done') && !s.includes('complete');
      });
      for (const t of atRisk) results.push({ ...t, assigneeName: member.name });
    } catch (e) {
      logger.error(`[EOD] fetchAtRiskTomorrow failed for ${member.name}:`, e);
    }
  }
  return results;
}

/** 14-day completed task history for pattern analysis */
async function fetchMemberHistory14Days(member: typeof TEAM[0]): Promise<{ name: string; data: string }> {
  const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
  if (!CLICKUP_TOKEN) return { name: member.name, data: 'No data available' };

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

  return new Promise<{ name: string; data: string }>(resolve => {
    const params = new URLSearchParams({
      'assignees[]': member.clickupId,
      include_closed: 'true',
      'statuses[]': 'complete',
      date_updated_gt: String(fourteenDaysAgo),
      subtasks: 'true',
      page: '0',
    });
    const path = `/api/v2/team/${CLICKUP_TEAM_ID}/task?${params.toString()}`;

    https.get({ hostname: 'api.clickup.com', path, headers: { Authorization: CLICKUP_TOKEN } }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          type H = { name: string; due_date: string | null; date_done: string | null };
          const parsed = JSON.parse(raw) as { tasks?: H[] };
          const tasks = parsed.tasks || [];
          const onTime = tasks.filter(t => t.due_date && t.date_done && Number(t.date_done) <= Number(t.due_date)).length;
          const late   = tasks.filter(t => t.due_date && t.date_done && Number(t.date_done) >  Number(t.due_date)).length;
          const topNames = tasks.slice(0, 8).map(t => t.name).join(', ');
          resolve({
            name: member.name,
            data: `${tasks.length} tasks completed. ${onTime} on time, ${late} late. Examples: ${topNames || 'none'}`,
          });
        } catch {
          resolve({ name: member.name, data: 'History unavailable' });
        }
      });
    }).on('error', () => resolve({ name: member.name, data: 'History unavailable' }));
  });
}

/** Generate pattern insights via Claude API (Jatin-only) */
export async function generatePatternInsights(histories: Array<{ name: string; data: string }>): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return histories.map(h => `• *${h.name}:* ${h.data}`).join('\n');
  }
  try {
    const memberDetails = histories.map(h => `${h.name}: ${h.data}`).join('\n');
    const prompt = `You are analyzing task patterns for a D2C performance marketing team (Growth Escalators, India). Based on 14-day history, give a 1-2 sentence insight per person about their work pattern + one specific actionable suggestion. Be direct, not generic.\n\nTeam data:\n${memberDetails}\n\nFormat — one bullet per person:\n• *Name:* [insight + one specific suggestion]`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    type CR = { content?: Array<{ text: string }> };
    const json = await resp.json() as CR;
    return json.content?.[0]?.text?.trim() || histories.map(h => `• *${h.name}:* ${h.data}`).join('\n');
  } catch (e) {
    logger.error('[EOD] generatePatternInsights failed:', e);
    return histories.map(h => `• *${h.name}:* ${h.data}`).join('\n');
  }
}

/** Team score = (completed / (completed + overdue)) * 100 */
export function calculateDailyScore(completed: number, overdue: number): { score: number; emoji: string; label: string } {
  const total = completed + overdue;
  if (total === 0) return { score: 100, emoji: '🟢', label: 'Great day' };
  const score = Math.round((completed / total) * 100);
  if (score >= 80) return { score, emoji: '🟢', label: 'Great day' };
  if (score >= 60) return { score, emoji: '🟡', label: 'Good' };
  return { score, emoji: '🔴', label: 'Needs focus' };
}

function nextSodLabel(): string {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const day = istNow.getUTCDay();
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (day >= 5) return 'Monday'; // Fri/Sat/Sun → Monday
  if (day === 0) return 'Monday';
  return names[day + 1];
}

// -----------------------------------------------------------------------
// Enhanced EOD Summary
// -----------------------------------------------------------------------
export async function sendEODSummary(): Promise<{ sent: number; errors: string[] }> {
  console.log('[EOD] starting enhanced summary…');
  const errors: string[] = [];

  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const dateStr = istNow.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  let completed: TeamTask[] = [];
  let overdue:   TeamTask[] = [];
  let inProgress: TeamTask[] = [];
  let atRisk:    TeamTask[] = [];

  try {
    [completed, overdue, inProgress, atRisk] = await Promise.all([
      fetchCompletedToday(),
      fetchOverdueTasks(),
      fetchInProgressToday(),
      fetchAtRiskTomorrow(),
    ]);
  } catch (e) {
    logger.error('[EOD] parallel fetch failed:', e);
    errors.push('data-fetch');
  }

  const { score, emoji, label } = calculateDailyScore(completed.length, overdue.length);

  // ── Group data by team member ──
  const perMember: Record<string, { completed: TeamTask[]; open: number }> = {};
  for (const m of TEAM) {
    perMember[m.name] = { completed: [], open: 0 };
  }
  for (const t of completed) {
    if (perMember[t.assigneeName]) perMember[t.assigneeName].completed.push(t);
  }
  for (const t of overdue) {
    if (perMember[t.assigneeName]) perMember[t.assigneeName].open++;
  }
  for (const t of inProgress) {
    if (perMember[t.assigneeName]) perMember[t.assigneeName].open++;
  }

  // ── Channel message: per-person format ──
  let channelMsg = `*Team EOD — ${dateStr}*\n\n`;

  // Team summary header
  channelMsg += `Completed today across team: *${completed.length}*\n`;
  for (const m of TEAM) {
    const data = perMember[m.name];
    channelMsg += `• <@${m.slackId}>: *${data.completed.length} done*, ${data.open} open\n`;
  }

  // Per-person detail blocks
  for (const m of TEAM) {
    const data = perMember[m.name];
    channelMsg += `\n━━━━━━━━━━━━━━━━━━\n`;
    channelMsg += `📝 *EOD — <@${m.slackId}>*\n`;

    if (data.completed.length > 0) {
      channelMsg += `✅ *Completed:*\n`;
      for (const t of data.completed.slice(0, 10)) {
        channelMsg += `  • ${t.name}\n`;
      }
      if (data.completed.length > 10) channelMsg += `  _...and ${data.completed.length - 10} more_\n`;
    } else {
      channelMsg += `No tasks completed today.\n`;
    }

    channelMsg += `📋 Open: ${data.open} tasks\n`;

    if (data.completed.length === 0) {
      channelMsg += `💡 Remember to update ClickUp as you finish work!\n`;
    }
  }

  // Score footer
  channelMsg += `\n━━━━━━━━━━━━━━━━━━\n`;
  channelMsg += `📊 *Team Score: ${score}/100* ${emoji} ${label}\n`;
  channelMsg += `_Next SOD: ${nextSodLabel()} 10AM IST_`;

  let sent = 0;
  const channelOk = await sendSlackMessage(SOD_EOD_CHANNEL, channelMsg).catch(e => {
    errors.push(`channel-send: ${e}`); return false;
  });
  if (channelOk) { sent++; console.log('[EOD] channel message sent to #sod-eod'); }
  else { errors.push('channel-send-failed'); }

  // Jatin DM: channel content + D (pattern insights) + action items
  await delay(2000);
  let jatinMsg = channelMsg + '\n\n';

  // D — Pattern Insights (Jatin-only — never in channel, never shown to Sakcham)
  try {
    const histories = await Promise.all(TEAM.map(m => fetchMemberHistory14Days(m)));
    const insights = await generatePatternInsights(histories);
    jatinMsg += `━━━━━━━━━━━━━━━━━━━━━\n🧠 *Pattern Insights (Last 14 Days)*\n${insights}\n\n`;
  } catch (e) {
    logger.error('[EOD] pattern insights error:', e);
    errors.push('pattern-insights');
  }

  // Action items for Jatin
  const actionItems: string[] = [];
  const criticalOverdue = overdue.filter(t => t.daysOverdue >= 3);
  if (criticalOverdue.length > 0) {
    const names = [...new Set(criticalOverdue.slice(0, 3).map(t => t.assigneeName))].join(', ');
    actionItems.push(`Follow up on ${criticalOverdue.length} task(s) overdue 3+ days (${names})`);
  }
  if (atRisk.length > 0) actionItems.push(`Check in on ${atRisk.length} at-risk task(s) due tomorrow`);
  if (score < 60) actionItems.push('Score below 60 — review blockers and reset priorities in tomorrow\'s SOD');
  if (completed.length === 0) actionItems.push('No tasks marked complete — remind team to update ClickUp status');

  if (actionItems.length > 0) {
    jatinMsg += `💡 *Jatin\'s Action Items:*\n${actionItems.map(a => `  • ${a}`).join('\n')}`;
  }

  const dmOk = await sendSlackDM(SLACK_JATIN, jatinMsg).catch(e => {
    errors.push(`dm-jatin: ${e}`); return false;
  });
  if (dmOk) { sent++; console.log('[EOD] Jatin DM sent with pattern insights'); }
  else { errors.push('dm-jatin-failed'); }

  console.log(`[EOD] complete — sent: ${sent}, errors: ${errors.length}`);
  return { sent, errors };
}

// Alias for test scripts
export { sendEODSummary as generateEodSummary };

// -----------------------------------------------------------------------
// Sakcham's Priority SOD (unchanged)
// -----------------------------------------------------------------------
export async function sendSakhamSOD(): Promise<void> {
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

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
