import https from 'https';

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_TEAM_ID = process.env.CLICKUP_TEAM_ID || '9016403868';

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

interface RawTask {
  id: string;
  name: string;
  status: { status: string; type: string };
  due_date: string | null;
  date_updated: string;
  list?: { name: string };
  url?: string;
  priority?: { priority: string } | null;
  [key: string]: unknown;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istTodayStartMs(): number {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();
  return new Date(Date.UTC(y, m, d)).getTime() - IST_OFFSET_MS;
}

function istTodayEndMs(): number {
  return istTodayStartMs() + 24 * 60 * 60 * 1000 - 1;
}

function formatDateIST(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function parseTask(raw: RawTask): Task {
  const dueMs = raw.due_date ? Number(raw.due_date) : null;
  const daysOverdue = dueMs && dueMs < Date.now()
    ? Math.floor((Date.now() - dueMs) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    id: raw.id,
    name: raw.name || 'Untitled',
    status: raw.status?.status || 'unknown',
    statusType: raw.status?.type || 'open',
    dueDate: dueMs,
    dueDateFormatted: dueMs ? formatDateIST(dueMs) : 'No due date',
    listName: raw.list?.name || '',
    url: raw.url || '',
    priority: raw.priority?.priority || 'none',
    daysOverdue,
  };
}

function fetchPage(clickupUserId: string, page: number, extraParams?: Record<string, string>): Promise<{ tasks: RawTask[]; lastPage: boolean }> {
  if (!CLICKUP_TOKEN) return Promise.resolve({ tasks: [], lastPage: true });

  return new Promise(resolve => {
    const params = new URLSearchParams({
      'assignees[]': clickupUserId,
      include_closed: 'false',
      subtasks: 'true',
      page: String(page),
    });
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
    }

    const path = `/api/v2/team/${CLICKUP_TEAM_ID}/task?${params.toString()}`;

    https.get({
      hostname: 'api.clickup.com',
      path,
      headers: { Authorization: CLICKUP_TOKEN! },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { tasks?: RawTask[]; last_page?: boolean };
          resolve({ tasks: parsed.tasks || [], lastPage: parsed.last_page !== false });
        } catch (e) {
          console.error('[ClickUp] parse error:', e);
          resolve({ tasks: [], lastPage: true });
        }
      });
    }).on('error', (e) => {
      console.error('[ClickUp] request error:', e.message);
      resolve({ tasks: [], lastPage: true });
    });
  });
}

export async function fetchTasksForMember(clickupUserId: string): Promise<{
  overdue: Task[];
  dueToday: Task[];
  upcoming: Task[];
  all: Task[];
}> {
  const allRaw: RawTask[] = [];
  let page = 0;

  while (page < 5) { // safety cap
    const result = await fetchPage(clickupUserId, page);
    allRaw.push(...result.tasks);
    if (result.lastPage || result.tasks.length === 0) break;
    page++;
  }

  const todayS = istTodayStartMs();
  const todayE = istTodayEndMs();
  const threeDaysOut = todayE + 3 * 24 * 60 * 60 * 1000;

  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const upcoming: Task[] = [];
  const all: Task[] = [];

  for (const raw of allRaw) {
    const st = raw.status?.type?.toLowerCase();
    if (st === 'closed' || st === 'done') continue;

    const task = parseTask(raw);
    all.push(task);

    if (!task.dueDate) continue;

    if (task.dueDate < todayS) {
      overdue.push(task);
    } else if (task.dueDate >= todayS && task.dueDate <= todayE) {
      dueToday.push(task);
    } else if (task.dueDate > todayE && task.dueDate <= threeDaysOut) {
      upcoming.push(task);
    }
  }

  return { overdue, dueToday, upcoming, all };
}

export async function fetchCompletedTodayForMember(clickupUserId: string): Promise<Task[]> {
  if (!CLICKUP_TOKEN) return [];

  const todayS = istTodayStartMs();
  const allRaw: RawTask[] = [];
  let page = 0;

  while (page < 5) {
    const result = await fetchPage(clickupUserId, page, {
      'statuses[]': 'complete',
      include_closed: 'true',
      date_updated_gt: String(todayS),
    });
    allRaw.push(...result.tasks);
    if (result.lastPage || result.tasks.length === 0) break;
    page++;
  }

  return allRaw.map(parseTask);
}
