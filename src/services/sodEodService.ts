import logger from '../utils/logger';
import { sendSlackMessage, sendSlackDM } from './slackService';
import { pool } from '../db/index';
import {
  SLACK_SOD_EOD_CHANNEL,
  SLACK_JATIN, SLACK_SAKCHAM, SLACK_KESHAV,
} from '../config/constants';

const SOD_EOD_CHANNEL = SLACK_SOD_EOD_CHANNEL;

// CRM-tasks-backed team digest (replaces ClickUp). userId is filled at runtime
// via lookup against users.email so additions/removals just need an email here.
interface TeamMember {
  name: string;
  email: string;
  slackId: string;
  showTeamOverview: boolean;
  userId: string | null;
}

// Active team — user explicitly requested KEEP Sakcham, drop Vishal + Nimisha.
const TEAM_BASE: Omit<TeamMember, 'userId'>[] = [
  { name: 'Jatin',   email: 'jatin@growthescalators.com',           slackId: SLACK_JATIN,   showTeamOverview: true  },
  { name: 'Sakcham', email: 'sakcham@growthescalators.com',         slackId: SLACK_SAKCHAM, showTeamOverview: true  },
  { name: 'Keshav',  email: 'keshav.growthescalators@gmail.com',    slackId: SLACK_KESHAV,  showTeamOverview: false },
];

async function loadTeam(): Promise<TeamMember[]> {
  const team: TeamMember[] = [];
  for (const m of TEAM_BASE) {
    let userId: string | null = null;
    try {
      const r = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [m.email]);
      userId = (r.rows[0] as { id: string } | undefined)?.id ?? null;
    } catch { /* ignore — userId stays null */ }
    team.push({ ...m, userId });
  }
  return team;
}

// Public Task shape — matches the previous ClickUp-backed shape so existing
// callers (and tests) stay compatible.
export interface Task {
  id: string;
  name: string;
  status: string;
  statusType: string;
  dueDate: number | null;
  dueDateFormatted: string;
  listName: string;
  url: string;
  priority: string;
  daysOverdue: number;
}

interface TeamTask extends Task {
  assigneeName: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function istTodayStartMs(): number {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  return new Date(Date.UTC(y, m, d)).getTime() - IST_OFFSET_MS;
}
function istTodayEndMs():     number { return istTodayStartMs() + 24 * 60 * 60 * 1000 - 1; }
function istTomorrowStartMs(): number { return istTodayStartMs() + 24 * 60 * 60 * 1000; }
function istTomorrowEndMs():   number { return istTodayStartMs() + 48 * 60 * 60 * 1000 - 1; }

function formatDateIST(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function rowToTask(row: { id: string; title: string; status: string | null; due_at: Date | null; updated_at?: Date | null }): Task {
  const dueMs = row.due_at ? new Date(row.due_at).getTime() : null;
  const daysOverdue = dueMs && dueMs < Date.now()
    ? Math.floor((Date.now() - dueMs) / (1000 * 60 * 60 * 24))
    : 0;
  const status = row.status || 'open';
  const statusType = (status === 'done' || status === 'complete') ? 'closed' : 'open';

  return {
    id: row.id,
    name: row.title || 'Untitled',
    status,
    statusType,
    dueDate: dueMs,
    dueDateFormatted: dueMs ? formatDateIST(dueMs) : 'No due date',
    listName: '',
    url: '',
    priority: 'none',
    daysOverdue,
  };
}

export async function fetchTasksForMember(userId: string): Promise<{
  overdue: Task[];
  dueToday: Task[];
  upcoming: Task[];
  all: Task[];
}> {
  const empty = { overdue: [] as Task[], dueToday: [] as Task[], upcoming: [] as Task[], all: [] as Task[] };
  if (!userId) return empty;

  const todayS = istTodayStartMs();
  const todayE = istTodayEndMs();
  const threeDaysOut = todayE + 3 * 24 * 60 * 60 * 1000;

  let r;
  try {
    r = await pool.query(
      `SELECT id, title, status, due_at
       FROM tasks
       WHERE assigned_to = $1
         AND status != 'done'`,
      [userId],
    );
  } catch (e) {
    logger.error('[sod] fetchTasksForMember query failed:', e);
    return empty;
  }

  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const upcoming: Task[] = [];
  const all: Task[] = [];

  for (const raw of r.rows as Array<{ id: string; title: string; status: string | null; due_at: Date | null }>) {
    const task = rowToTask(raw);
    all.push(task);
    if (!task.dueDate) continue;
    if (task.dueDate < todayS)                                     overdue.push(task);
    else if (task.dueDate >= todayS && task.dueDate <= todayE)     dueToday.push(task);
    else if (task.dueDate > todayE && task.dueDate <= threeDaysOut) upcoming.push(task);
  }

  return { overdue, dueToday, upcoming, all };
}

export async function fetchCompletedTodayForMember(userId: string): Promise<Task[]> {
  if (!userId) return [];
  const todayS = istTodayStartMs();
  const todayE = istTodayEndMs();

  try {
    const r = await pool.query(
      `SELECT id, title, status, due_at, updated_at
       FROM tasks
       WHERE assigned_to = $1
         AND status = 'done'
         AND updated_at >= to_timestamp($2 / 1000.0)
         AND updated_at <= to_timestamp($3 / 1000.0)`,
      [userId, todayS, todayE],
    );
    return (r.rows as Array<{ id: string; title: string; status: string | null; due_at: Date | null; updated_at: Date | null }>).map(rowToTask);
  } catch (e) {
    logger.error('[sod] fetchCompletedTodayForMember query failed:', e);
    return [];
  }
}

// Format helpers (SOD)
function fmtOverdue(tasks: Task[]): string {
  return tasks.map(t => {
    const ago = t.daysOverdue === 1 ? '1 day ago' : `${t.daysOverdue} days ago`;
    return `  • ${t.name} _(due ${ago})_`;
  }).join('\n');
}
function fmtToday(tasks: Task[]): string {
  return tasks.map(t => `  • ${t.name}`).join('\n');
}
function fmtUpcoming(tasks: Task[]): string {
  return tasks.map(t => `  • ${t.name} _(due ${t.dueDateFormatted})_`).join('\n');
}

type MemberResult = {
  member: TeamMember;
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

  const team = await loadTeam();

  const results: MemberResult[] = await Promise.all(
    team.map(async (m) => {
      try {
        const data = await fetchTasksForMember(m.userId ?? '');
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
        const othersForOverview = results.filter(r => r.member.email !== mr.member.email);
        msg += `📊 *Team Overview — ${dateStr}*\n\nOverdue across team: *${totalOverdue}*\n`;
        for (const o of othersForOverview) {
          msg += `- <@${o.member.slackId}> (${o.member.name}): ${o.overdue.length} overdue\n`;
        }
        msg += `\n━━━━━━━━━━━━━━━━━━\n📋 *Your tasks, ${mr.member.name}:*\n`;
        msg += buildTaskSection(mr);
      } else {
        const total = mr.overdue.length + mr.dueToday.length + mr.upcoming.length;
        if (total === 0 && mr.all.length === 0) {
          msg = `📋 Good morning <@${mr.member.slackId}>! 🎉\nYour task list is clear today. Add tasks in CRM if needed.`;
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

  console.log(`[SOD] complete — sent: ${sent}/${team.length}, errors: ${errors.length}`);
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
// EOD — team-level helpers
// -----------------------------------------------------------------------
export async function fetchCompletedToday(): Promise<TeamTask[]> {
  const team = await loadTeam();
  const results: TeamTask[] = [];
  for (const member of team) {
    if (!member.userId) continue;
    try {
      const tasks = await fetchCompletedTodayForMember(member.userId);
      for (const t of tasks) results.push({ ...t, assigneeName: member.name });
    } catch (e) {
      logger.error(`[EOD] fetchCompletedToday failed for ${member.name}:`, e);
    }
  }
  return results;
}

export async function fetchOverdueTasks(): Promise<TeamTask[]> {
  const team = await loadTeam();
  const results: TeamTask[] = [];
  for (const member of team) {
    if (!member.userId) continue;
    try {
      const data = await fetchTasksForMember(member.userId);
      for (const t of data.overdue) results.push({ ...t, assigneeName: member.name });
    } catch (e) {
      logger.error(`[EOD] fetchOverdueTasks failed for ${member.name}:`, e);
    }
  }
  results.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return results;
}

export async function fetchInProgressToday(): Promise<TeamTask[]> {
  const team = await loadTeam();
  const results: TeamTask[] = [];
  for (const member of team) {
    if (!member.userId) continue;
    try {
      const data = await fetchTasksForMember(member.userId);
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

export async function fetchAtRiskTomorrow(): Promise<TeamTask[]> {
  const team = await loadTeam();
  const results: TeamTask[] = [];
  const tStart = istTomorrowStartMs();
  const tEnd   = istTomorrowEndMs();

  for (const member of team) {
    if (!member.userId) continue;
    try {
      const data = await fetchTasksForMember(member.userId);
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
// EOD Summary
// -----------------------------------------------------------------------
export async function sendEODSummary(): Promise<{ sent: number; errors: string[] }> {
  console.log('[EOD] starting summary…');
  const errors: string[] = [];

  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const dateStr = istNow.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const team = await loadTeam();

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

  const perMember: Record<string, { completed: TeamTask[]; overdue: TeamTask[]; inProgress: TeamTask[] }> = {};
  for (const m of team) perMember[m.name] = { completed: [], overdue: [], inProgress: [] };
  for (const t of completed)   if (perMember[t.assigneeName]) perMember[t.assigneeName].completed.push(t);
  for (const t of overdue)     if (perMember[t.assigneeName]) perMember[t.assigneeName].overdue.push(t);
  for (const t of inProgress)  if (perMember[t.assigneeName]) perMember[t.assigneeName].inProgress.push(t);

  let sent = 0;

  // Individual messages — non-leader members
  const individualMembers = team.filter(m => !m.showTeamOverview);
  for (const m of individualMembers) {
    const data = perMember[m.name];
    const openCount = data.overdue.length + data.inProgress.length;

    let msg = `📝 *EOD — <@${m.slackId}> · ${dateStr}*\n\n`;

    if (data.completed.length > 0) {
      msg += `✅ *Completed today (${data.completed.length}):*\n`;
      for (const t of data.completed.slice(0, 10)) msg += `  • ${t.name}\n`;
      if (data.completed.length > 10) msg += `  _...and ${data.completed.length - 10} more_\n`;
    } else {
      msg += `No tasks completed today.\n`;
      msg += `💡 _Remember to mark tasks done in CRM as you finish them!_\n`;
    }

    if (data.overdue.length > 0) {
      msg += `\n🔴 *Overdue (${data.overdue.length}):*\n`;
      for (const t of data.overdue.slice(0, 5)) msg += `  • ${t.name} — _${t.daysOverdue}d overdue_\n`;
    }

    msg += `\n📋 Open: ${openCount} tasks`;

    const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg).catch(e => {
      errors.push(`channel-${m.name}: ${e}`); return false;
    });
    if (ok) { sent++; console.log(`[EOD] individual message sent for ${m.name}`); }
    await delay(1500);
  }

  // Combined message — leaders
  let teamMsg = `📊 *Team EOD — ${dateStr}*\n\n`;
  teamMsg += `Completed today across team: *${completed.length}*\n`;
  for (const m of team) {
    const data = perMember[m.name];
    const openCount = data.overdue.length + data.inProgress.length;
    teamMsg += `• <@${m.slackId}>: *${data.completed.length} done*, ${openCount} open\n`;
  }

  const leaderMembers = team.filter(m => m.showTeamOverview);
  for (const m of leaderMembers) {
    const data = perMember[m.name];
    const openCount = data.overdue.length + data.inProgress.length;
    teamMsg += `\n━━━━━━━━━━━━━━━━━━\n`;
    teamMsg += `📝 *EOD — <@${m.slackId}>*\n`;

    if (data.completed.length > 0) {
      teamMsg += `✅ *Completed:*\n`;
      for (const t of data.completed.slice(0, 10)) teamMsg += `  • ${t.name}\n`;
      if (data.completed.length > 10) teamMsg += `  _...and ${data.completed.length - 10} more_\n`;
    } else {
      teamMsg += `No tasks completed today.\n`;
    }

    teamMsg += `📋 Open: ${openCount} tasks\n`;
  }

  teamMsg += `\n━━━━━━━━━━━━━━━━━━\n`;
  teamMsg += `📊 *Team Score: ${score}/100* ${emoji} ${label}\n`;
  teamMsg += `_Next SOD: ${nextSodLabel()} 10AM IST_`;

  const channelOk = await sendSlackMessage(SOD_EOD_CHANNEL, teamMsg).catch(e => {
    errors.push(`channel-team: ${e}`); return false;
  });
  if (channelOk) { sent++; console.log('[EOD] team overview sent to #sod-eod'); }

  // Jatin private DM with action items
  await delay(2000);
  let jatinMsg = teamMsg + '\n\n';

  const actionItems: string[] = [];
  const criticalOverdue = overdue.filter(t => t.daysOverdue >= 3);
  if (criticalOverdue.length > 0) {
    const names = [...new Set(criticalOverdue.slice(0, 3).map(t => t.assigneeName))].join(', ');
    actionItems.push(`Follow up on ${criticalOverdue.length} task(s) overdue 3+ days (${names})`);
  }
  if (atRisk.length > 0) actionItems.push(`Check in on ${atRisk.length} at-risk task(s) due tomorrow`);
  if (score < 60) actionItems.push('Score below 60 — review blockers and reset priorities in tomorrow\'s SOD');
  if (completed.length === 0) actionItems.push('No tasks marked complete — remind team to update CRM task status');

  if (actionItems.length > 0) {
    jatinMsg += `💡 *Jatin\'s Action Items:*\n${actionItems.map(a => `  • ${a}`).join('\n')}`;
  }

  const dmOk = await sendSlackDM(SLACK_JATIN, jatinMsg).catch(e => {
    errors.push(`dm-jatin: ${e}`); return false;
  });
  if (dmOk) { sent++; console.log('[EOD] Jatin DM sent'); }

  console.log(`[EOD] complete — sent: ${sent}, errors: ${errors.length}`);
  return { sent, errors };
}

export { sendEODSummary as generateEodSummary };

// -----------------------------------------------------------------------
// Sakcham's Priority SOD (unchanged — DB-driven, no ClickUp)
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
