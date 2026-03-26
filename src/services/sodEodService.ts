import https from 'https';
import {
  TEAM_MEMBERS, SLACK_CHANNELS, SLACK_IDS,
  formatTaskList, postToChannel, delay,
} from '../utils/clickupSlack';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID;

interface ClickUpTask {
  id: string;
  name: string;
  status: { status: string; type: string };
  due_date: string | null;
  date_updated: string;
  [key: string]: unknown;
}

// Fetch tasks for a specific assignee with status filters
function fetchTasks(assigneeId: string, statuses: string[], includeClosedOpt = false, dateUpdatedGt?: number): Promise<ClickUpTask[]> {
  if (!CLICKUP_TOKEN || !CLICKUP_LIST_ID) return Promise.resolve([]);

  return new Promise(resolve => {
    const params = new URLSearchParams();
    params.set('assignees[]', assigneeId);
    statuses.forEach(s => params.append('statuses[]', s));
    params.set('include_closed', String(includeClosedOpt));
    if (dateUpdatedGt) params.set('date_updated_gt', String(dateUpdatedGt));

    const path = `/api/v2/list/${CLICKUP_LIST_ID}/task?${params.toString()}`;

    https.get({
      hostname: 'api.clickup.com',
      path,
      headers: { Authorization: CLICKUP_TOKEN! },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { tasks?: ClickUpTask[] };
          resolve(parsed.tasks || []);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayEnd(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function threeDaysFromNow(): number {
  return Date.now() + 3 * 24 * 60 * 60 * 1000;
}

function categorizeTasks(tasks: ClickUpTask[]): {
  overdue: ClickUpTask[];
  today: ClickUpTask[];
  upcoming: ClickUpTask[];
  open: ClickUpTask[];
} {
  const now = Date.now();
  const todayS = todayStart();
  const todayE = todayEnd();
  const threeDays = threeDaysFromNow();

  const overdue: ClickUpTask[] = [];
  const today: ClickUpTask[] = [];
  const upcoming: ClickUpTask[] = [];
  const open: ClickUpTask[] = [];

  for (const t of tasks) {
    const statusType = t.status?.type?.toLowerCase();
    if (statusType === 'closed' || statusType === 'done') continue;

    if (!t.due_date) {
      open.push(t);
      continue;
    }

    const dueMs = Number(t.due_date);
    if (dueMs < todayS) {
      overdue.push(t);
    } else if (dueMs >= todayS && dueMs <= todayE) {
      today.push(t);
    } else if (dueMs > todayE && dueMs <= threeDays) {
      upcoming.push(t);
    } else {
      open.push(t);
    }
  }

  return { overdue, today, upcoming, open };
}

// -----------------------------------------------------------------------
// SOD Digest — 10 AM IST daily Mon-Sat
// -----------------------------------------------------------------------
export async function runSodDigest(): Promise<void> {
  console.log('[SOD] starting digest…');
  if (!CLICKUP_TOKEN || !CLICKUP_LIST_ID) {
    console.log('[SOD] ClickUp not configured — skipping');
    return;
  }

  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  // Fetch tasks for all members
  const memberData: Array<{
    member: typeof TEAM_MEMBERS[0];
    overdue: ClickUpTask[];
    today: ClickUpTask[];
    upcoming: ClickUpTask[];
    total: number;
  }> = [];

  for (const member of TEAM_MEMBERS) {
    const tasks = await fetchTasks(member.clickupId, ['open', 'in progress', 'to do', 'in review']);
    const cats = categorizeTasks(tasks);
    memberData.push({
      member,
      overdue: cats.overdue,
      today: cats.today,
      upcoming: cats.upcoming,
      total: cats.overdue.length + cats.today.length + cats.upcoming.length + cats.open.length,
    });
    await delay(300); // avoid ClickUp rate limits
  }

  // Post order: Jatin first with team summary, then others
  const jatinData = memberData.find(m => m.member.clickupId === '88911769');
  const otherMembers = memberData.filter(m => m.member.clickupId !== '88911769');
  const orderedMembers = jatinData ? [jatinData, ...otherMembers] : otherMembers;

  for (const md of orderedMembers) {
    const { member, overdue, today, upcoming, total } = md;
    let msg = '';

    // Jatin gets team overview at top
    if (member.clickupId === '88911769') {
      const totalOverdue = memberData.reduce((sum, m) => sum + m.overdue.length, 0);
      msg += `📊 *Team Overview — ${dateStr}*\n`;
      msg += `Overdue across team: *${totalOverdue}*\n\n`;
      for (const om of otherMembers) {
        msg += `<@${om.member.slackId}>: ${om.overdue.length} overdue\n`;
      }
      msg += `\n---\n\n`;
    }

    if (total === 0) {
      msg += `📋 Good morning <@${member.slackId}> — your task list is clear today! 🎉\nAdd tasks in ClickUp if needed.`;
    } else {
      msg += `📋 Good morning <@${member.slackId}> — here's your day:\n`;

      if (overdue.length > 0) {
        msg += `🔴 *Overdue (${overdue.length}):*\n`;
        msg += formatTaskList(overdue, 'overdue') + '\n';
      }
      if (today.length > 0) {
        msg += `🟡 *Due Today (${today.length}):*\n`;
        msg += formatTaskList(today, 'today') + '\n';
      }
      if (upcoming.length > 0) {
        msg += `🟢 *Upcoming (${upcoming.length}):*\n`;
        msg += formatTaskList(upcoming, 'upcoming') + '\n';
      }

      msg += `\n${total} tasks total · Have a great day!`;
    }

    await postToChannel(SLACK_CHANNELS.sodEod, msg);
    await delay(2000);
  }

  console.log(`[SOD] digest complete — ${memberData.length} members processed`);
}

// -----------------------------------------------------------------------
// EOD Summary — 7 PM IST daily Mon-Sat
// -----------------------------------------------------------------------
export async function runEodSummary(): Promise<void> {
  console.log('[EOD] starting summary…');
  if (!CLICKUP_TOKEN || !CLICKUP_LIST_ID) {
    console.log('[EOD] ClickUp not configured — skipping');
    return;
  }

  const todayStartMs = todayStart();

  // Fetch data for each member
  const memberData: Array<{
    member: typeof TEAM_MEMBERS[0];
    completed: ClickUpTask[];
    openTasks: ClickUpTask[];
  }> = [];

  for (const member of TEAM_MEMBERS) {
    const [completedTasks, openTasks] = await Promise.all([
      fetchTasks(member.clickupId, ['complete', 'closed'], true, todayStartMs),
      fetchTasks(member.clickupId, ['open', 'in progress', 'to do', 'in review']),
    ]);
    memberData.push({
      member,
      completed: completedTasks,
      openTasks,
    });
    await delay(300);
  }

  const jatinData = memberData.find(m => m.member.clickupId === '88911769');
  const otherMembers = memberData.filter(m => m.member.clickupId !== '88911769');
  const orderedMembers = jatinData ? [jatinData, ...otherMembers] : otherMembers;

  for (const md of orderedMembers) {
    const { member, completed, openTasks } = md;
    let msg = '';

    // Jatin gets team summary
    if (member.clickupId === '88911769') {
      const totalCompleted = memberData.reduce((s, m) => s + m.completed.length, 0);
      const totalOpen = memberData.reduce((s, m) => s + m.openTasks.length, 0);
      msg += `📊 *EOD Team Summary*\n`;
      msg += `Completed today: *${totalCompleted}* · Open: *${totalOpen}*\n\n`;
      for (const om of otherMembers) {
        msg += `<@${om.member.slackId}>: ${om.completed.length} done, ${om.openTasks.length} open\n`;
      }
      msg += `\n---\n\n`;
    }

    if (completed.length === 0) {
      msg += `📝 EOD — <@${member.slackId}>\n`;
      msg += `No tasks marked complete today.\n`;
      msg += `Open tasks: ${openTasks.length}\n`;
      msg += `Remember to update ClickUp as you complete work!`;
    } else {
      msg += `✅ *EOD Summary — <@${member.slackId}>*\n`;
      msg += `*Completed today (${completed.length}):*\n`;
      msg += formatTaskList(completed, 'completed') + '\n';

      if (openTasks.length > 0) {
        msg += `*Still open (${openTasks.length}):*\n`;
        msg += formatTaskList(openTasks, 'open') + '\n';
      }

      msg += `\n${completed.length} done · ${openTasks.length} carry forward · Great work today!`;
    }

    await postToChannel(SLACK_CHANNELS.sodEod, msg);
    await delay(2000);
  }

  console.log(`[EOD] summary complete — ${memberData.length} members processed`);
}
