import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Team members (shared source of truth — used by analytics + intelligence)
// ---------------------------------------------------------------------------
export const TEAM_MEMBERS = [
  { name: 'Jatin',   clickupId: 88911769 },
  { name: 'Sakcham', clickupId: 242618940 },
  { name: 'Nimisha', clickupId: 100972807 },
  { name: 'Keshav',  clickupId: 4800274   },
];

export interface TeamMemberPerf {
  name: string;
  clickupId: number;
  completedToday: number;
  overdueCount: number;
  dueTodayCount: number;
  weekCompletionRate: number;
}

// ---------------------------------------------------------------------------
// Fetch team performance from ClickUp
// ---------------------------------------------------------------------------
export async function fetchTeamPerformance(): Promise<TeamMemberPerf[]> {
  const clickupToken = process.env.CLICKUP_API_TOKEN;
  const clickupTeamId = process.env.CLICKUP_TEAM_ID ?? '9016403868';

  if (!clickupToken) {
    logger.warn('[team-perf] CLICKUP_API_TOKEN not set');
    return TEAM_MEMBERS.map(m => ({
      ...m, completedToday: 0, overdueCount: 0, dueTodayCount: 0, weekCompletionRate: 0,
    }));
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const results: TeamMemberPerf[] = [];

  for (const member of TEAM_MEMBERS) {
    try {
      type CuRes = { tasks?: unknown[] };
      const cuHeaders = { Authorization: clickupToken };
      const cuTimeout = { signal: AbortSignal.timeout(8000) };

      const [todayTasksRes, overdueRes, dueTodayRes, weekRes] = await Promise.all([
        fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&statuses[]=complete&date_closed_gt=${todayStart.getTime()}&include_closed=true`, {
          headers: cuHeaders, ...cuTimeout,
        }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
        fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&due_date_lt=${Date.now()}&statuses[]=to+do&statuses[]=in+progress`, {
          headers: cuHeaders, ...cuTimeout,
        }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
        fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&due_date_gt=${todayStart.getTime()}&due_date_lt=${todayStart.getTime() + 86400000}`, {
          headers: cuHeaders, ...cuTimeout,
        }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
        fetch(`https://api.clickup.com/api/v2/team/${clickupTeamId}/task?assignees[]=${member.clickupId}&statuses[]=complete&date_closed_gt=${weekStart.getTime()}&include_closed=true`, {
          headers: cuHeaders, ...cuTimeout,
        }).then(r => r.json() as Promise<CuRes>).catch(() => ({ tasks: [] as unknown[] })),
      ]);

      const completedToday = todayTasksRes.tasks?.length ?? 0;
      const overdueCount   = overdueRes.tasks?.length ?? 0;
      const dueTodayCount  = dueTodayRes.tasks?.length ?? 0;
      const weekCompleted  = weekRes.tasks?.length ?? 0;
      const weekTotal      = weekCompleted + overdueCount;
      const weekRate       = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 100;

      results.push({ name: member.name, clickupId: member.clickupId, completedToday, overdueCount, dueTodayCount, weekCompletionRate: weekRate });
    } catch {
      results.push({ name: member.name, clickupId: member.clickupId, completedToday: 0, overdueCount: 0, dueTodayCount: 0, weekCompletionRate: 0 });
    }
  }

  return results;
}
