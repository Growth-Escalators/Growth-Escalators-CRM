import { fetchTasksForMember, fetchCompletedTodayForMember, type Task } from '../utils/clickupTasks';
import { sendSlackMessage } from './slackService';

const SOD_EOD_CHANNEL = 'C08EMRX2HHN';

const TEAM = [
  { name: 'Jatin',     clickupId: '88911769',  slackId: 'U073Y677JBB', isAdmin: true },
  { name: 'Vishal',    clickupId: '100972806', slackId: 'U0ALC9Z09RA', isAdmin: false },
  { name: 'Sanskriti', clickupId: '100860514', slackId: 'U09TXBW2XPX', isAdmin: false },
  { name: 'Sakcham',   clickupId: '242618940', slackId: 'U09TY8RGN30', isAdmin: false },
  { name: 'Nimisha',   clickupId: '100972807', slackId: 'U0ALMKD2XFB', isAdmin: false },
  { name: 'Keshav',    clickupId: '4800274',   slackId: 'U073Y6S4K4H', isAdmin: false },
];

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function formatOverdueList(tasks: Task[]): string {
  return tasks.map(t => {
    const ago = t.daysOverdue === 1 ? '1 day ago' : `${t.daysOverdue} days ago`;
    return `• ${t.name}${t.listName ? ` — ${t.listName}` : ''} _(due ${ago})_`;
  }).join('\n');
}

function formatTodayList(tasks: Task[]): string {
  return tasks.map(t => `• ${t.name}${t.listName ? ` — ${t.listName}` : ''}`).join('\n');
}

function formatUpcomingList(tasks: Task[]): string {
  return tasks.map(t => `• ${t.name}${t.listName ? ` — ${t.listName}` : ''} _(due ${t.dueDateFormatted})_`).join('\n');
}

function formatCompletedList(tasks: Task[]): string {
  return tasks.map(t => `✓ ${t.name}`).join('\n');
}

function formatOpenList(tasks: Task[]): string {
  return tasks.map(t => {
    if (t.daysOverdue > 0) return `• ${t.name} — _${t.daysOverdue} day${t.daysOverdue === 1 ? '' : 's'} overdue_ ⚠️`;
    return `• ${t.name}`;
  }).join('\n');
}

// -----------------------------------------------------------------------
// SOD Digest
// -----------------------------------------------------------------------
export async function sendSODDigest(): Promise<{ sent: number; errors: string[] }> {
  console.log('[SOD] starting digest…');
  const errors: string[] = [];

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  // Fetch tasks for all members in parallel
  const memberResults = await Promise.all(
    TEAM.map(async (m) => {
      try {
        const data = await fetchTasksForMember(m.clickupId);
        return { member: m, ...data, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[SOD] fetch failed for ${m.name}:`, msg);
        return { member: m, overdue: [] as Task[], dueToday: [] as Task[], upcoming: [] as Task[], all: [] as Task[], error: msg };
      }
    })
  );

  let sent = 0;
  const jatinResult = memberResults.find(r => r.member.isAdmin);
  const othersResults = memberResults.filter(r => !r.member.isAdmin);

  // Send Jatin's message first with team overview
  if (jatinResult) {
    try {
      const totalOverdue = memberResults.reduce((s, r) => s + r.overdue.length, 0);
      let msg = `📊 *Team Overview — ${dateStr}*\n\nOverdue across team: *${totalOverdue}*\n`;

      for (const or of othersResults) {
        if (or.overdue.length > 0) msg += `• <@${or.member.slackId}>: ${or.overdue.length} overdue\n`;
      }

      msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n📋 *Your tasks, Jatin:*\n`;
      msg += buildPersonalSOD(jatinResult);

      const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg);
      if (ok) { sent++; console.log('[SOD] sent to channel for Jatin'); }
      else { errors.push('channel post failed for Jatin'); }
    } catch (e) { errors.push(`Jatin error: ${e}`); }
    await delay(2000);
  }

  // Send each other member's message
  for (const mr of othersResults) {
    try {
      const total = mr.overdue.length + mr.dueToday.length + mr.upcoming.length;

      let msg: string;
      if (total === 0 && mr.all.length === 0) {
        msg = `📋 Good morning <@${mr.member.slackId}>! 🎉\nYour task list is clear today. Add tasks in ClickUp if needed.`;
      } else {
        msg = `📋 Good morning <@${mr.member.slackId}> — here's your day:\n\n`;
        msg += buildPersonalSOD(mr);
      }

      const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg);
      if (ok) { sent++; console.log(`[SOD] sent for ${mr.member.name}`); }
      else { errors.push(`channel post failed for ${mr.member.name}`); }
    } catch (e) { errors.push(`${mr.member.name}: ${e}`); }
    await delay(2000);
  }

  console.log(`[SOD] complete — sent: ${sent}/${TEAM.length}, errors: ${errors.length}`);
  return { sent, errors };
}

function buildPersonalSOD(r: { overdue: Task[]; dueToday: Task[]; upcoming: Task[]; all: Task[] }): string {
  const total = r.overdue.length + r.dueToday.length + r.upcoming.length;
  let msg = '';

  if (r.overdue.length > 0) {
    msg += `🔴 *Overdue (${r.overdue.length}):*\n${formatOverdueList(r.overdue)}\n\n`;
  }
  if (r.dueToday.length > 0) {
    msg += `🟡 *Due Today (${r.dueToday.length}):*\n${formatTodayList(r.dueToday)}\n\n`;
  }
  if (r.upcoming.length > 0) {
    msg += `🟢 *Upcoming (${r.upcoming.length}):*\n${formatUpcomingList(r.upcoming)}\n\n`;
  }

  if (total > 0) msg += `_${total} tasks total · Have a great day! 💪_`;
  else if (r.all.length > 0) msg += `_${r.all.length} tasks with no due date. Set due dates in ClickUp!_`;

  return msg;
}

// -----------------------------------------------------------------------
// EOD Summary
// -----------------------------------------------------------------------
export async function sendEODSummary(): Promise<{ sent: number; errors: string[] }> {
  console.log('[EOD] starting summary…');
  const errors: string[] = [];

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const memberResults = await Promise.all(
    TEAM.map(async (m) => {
      try {
        const [completed, taskData] = await Promise.all([
          fetchCompletedTodayForMember(m.clickupId),
          fetchTasksForMember(m.clickupId),
        ]);
        return { member: m, completed, openTasks: taskData.all, overdue: taskData.overdue, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[EOD] fetch failed for ${m.name}:`, msg);
        return { member: m, completed: [] as Task[], openTasks: [] as Task[], overdue: [] as Task[], error: msg };
      }
    })
  );

  let sent = 0;
  const jatinResult = memberResults.find(r => r.member.isAdmin);
  const othersResults = memberResults.filter(r => !r.member.isAdmin);

  // Jatin's team EOD overview
  if (jatinResult) {
    try {
      const totalCompleted = memberResults.reduce((s, r) => s + r.completed.length, 0);
      const totalOpen = memberResults.reduce((s, r) => s + r.openTasks.length, 0);

      let msg = `📊 *Team EOD — ${dateStr}*\n\nCompleted today across team: *${totalCompleted}*\n`;
      for (const or of othersResults) {
        msg += `• <@${or.member.slackId}>: ${or.completed.length} done, ${or.openTasks.length} open\n`;
      }

      msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += buildPersonalEOD(jatinResult);

      const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg);
      if (ok) { sent++; } else { errors.push('channel post failed for Jatin'); }
    } catch (e) { errors.push(`Jatin: ${e}`); }
    await delay(2000);
  }

  for (const mr of othersResults) {
    try {
      const msg = buildPersonalEOD(mr);
      const ok = await sendSlackMessage(SOD_EOD_CHANNEL, msg);
      if (ok) { sent++; console.log(`[EOD] sent for ${mr.member.name}`); }
      else { errors.push(`channel post failed for ${mr.member.name}`); }
    } catch (e) { errors.push(`${mr.member.name}: ${e}`); }
    await delay(2000);
  }

  console.log(`[EOD] complete — sent: ${sent}/${TEAM.length}, errors: ${errors.length}`);
  return { sent, errors };
}

function buildPersonalEOD(r: { member: typeof TEAM[0]; completed: Task[]; openTasks: Task[]; overdue: Task[] }): string {
  if (r.completed.length === 0) {
    return `📝 *EOD — <@${r.member.slackId}>*\nNo tasks completed today.\nOpen: ${r.openTasks.length} tasks\n_Remember to update ClickUp as you finish work!_`;
  }

  let msg = `✅ *EOD Summary — <@${r.member.slackId}>*\n\n`;
  msg += `*Completed today (${r.completed.length}):*\n${formatCompletedList(r.completed)}\n\n`;

  if (r.openTasks.length > 0) {
    msg += `*Still open (${r.openTasks.length}):*\n${formatOpenList(r.openTasks)}\n\n`;
  }

  msg += `_${r.completed.length} done · ${r.openTasks.length} carry forward_`;
  return msg;
}
