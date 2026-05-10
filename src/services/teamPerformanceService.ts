import logger from '../utils/logger';
import { pool } from '../db/index';

// ---------------------------------------------------------------------------
// Team members (shared source of truth — used by analytics + intelligence)
// CRM-tasks-backed (replaces ClickUp). Resolves user IDs by email at runtime.
// ---------------------------------------------------------------------------
export const TEAM_MEMBERS_BASE = [
  { name: 'Jatin',   email: 'jatin@growthescalators.com'        },
  { name: 'Sakcham', email: 'sakcham@growthescalators.com'      },
  { name: 'Keshav',  email: 'keshav.growthescalators@gmail.com' },
];

export interface TeamMemberPerf {
  name: string;
  userId: string | null;
  completedToday: number;
  overdueCount: number;
  dueTodayCount: number;
  weekCompletionRate: number;
}

async function lookupUserId(email: string): Promise<string | null> {
  try {
    const r = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    return (r.rows[0] as { id: string } | undefined)?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch team performance from CRM tasks table
// ---------------------------------------------------------------------------
export async function fetchTeamPerformance(): Promise<TeamMemberPerf[]> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const tomorrow   = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);

  const results: TeamMemberPerf[] = [];

  for (const member of TEAM_MEMBERS_BASE) {
    const userId = await lookupUserId(member.email);
    if (!userId) {
      results.push({ name: member.name, userId: null, completedToday: 0, overdueCount: 0, dueTodayCount: 0, weekCompletionRate: 0 });
      continue;
    }

    try {
      const [completedTodayRes, overdueRes, dueTodayRes, weekCompletedRes] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM tasks
           WHERE assigned_to = $1 AND status = 'done' AND updated_at >= $2`,
          [userId, todayStart],
        ).catch(() => ({ rows: [{ cnt: 0 }] })),
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM tasks
           WHERE assigned_to = $1 AND status != 'done' AND due_at < NOW()`,
          [userId],
        ).catch(() => ({ rows: [{ cnt: 0 }] })),
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM tasks
           WHERE assigned_to = $1 AND status != 'done'
             AND due_at >= $2 AND due_at < $3`,
          [userId, todayStart, tomorrow],
        ).catch(() => ({ rows: [{ cnt: 0 }] })),
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM tasks
           WHERE assigned_to = $1 AND status = 'done' AND updated_at >= $2`,
          [userId, weekStart],
        ).catch(() => ({ rows: [{ cnt: 0 }] })),
      ]);

      const completedToday = Number((completedTodayRes.rows[0] as { cnt: number }).cnt ?? 0);
      const overdueCount   = Number((overdueRes.rows[0] as { cnt: number }).cnt ?? 0);
      const dueTodayCount  = Number((dueTodayRes.rows[0] as { cnt: number }).cnt ?? 0);
      const weekCompleted  = Number((weekCompletedRes.rows[0] as { cnt: number }).cnt ?? 0);
      const weekTotal      = weekCompleted + overdueCount;
      const weekRate       = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 100;

      results.push({ name: member.name, userId, completedToday, overdueCount, dueTodayCount, weekCompletionRate: weekRate });
    } catch (e) {
      logger.error(`[team-perf] failed for ${member.name}:`, e);
      results.push({ name: member.name, userId, completedToday: 0, overdueCount: 0, dueTodayCount: 0, weekCompletionRate: 0 });
    }
  }

  return results;
}
