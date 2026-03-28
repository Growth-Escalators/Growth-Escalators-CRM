import { fetchTasksForMember, fetchCompletedTodayForMember, type Task } from '../utils/clickupTasks';
import { sendSlackMessage } from './slackService';

const SOD_EOD_CHANNEL = 'C08EMRX2HHN';

const TEAM = [
  { name: 'Jatin',   clickupId: '88911769',  slackId: 'U073Y677JBB', showTeamOverview: true  },
  { name: 'Sakcham', clickupId: '242618940', slackId: 'U09TY8RGN30', showTeamOverview: true  },
  { name: 'Vishal',  clickupId: '100972806', slackId: 'U0ALC9Z09RA', showTeamOverview: false },
  { name: 'Nimisha', clickupId: '100972807', slackId: 'U0ALMKD2XFB', showTeamOverview: false },
  { name: 'Keshav',  clickupId: '4800274',   slackId: 'U073Y6S4K4H', showTeamOverview: false },
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
        console.error(`[SOD] fetch failed for ${m.name}:`, e);
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
        console.error(`[EOD] fetch failed for ${m.name}:`, e);
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
