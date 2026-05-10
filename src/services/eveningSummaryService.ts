import logger from '../utils/logger';
import { fetchTasksForMember, fetchCompletedTodayForMember } from './sodEodService';
import { sendSlackDM } from './slackService';
import { pool } from '../db/index';
import {
  SLACK_JATIN, SLACK_SAKCHAM, SLACK_KESHAV,
} from '../config/constants';

interface TeamMember {
  name: string;
  email: string;
  slackId: string;
  showTeamOverview: boolean;
  userId: string | null;
}

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
    } catch { /* ignore */ }
    team.push({ ...m, userId });
  }
  return team;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Great day';
  if (score >= 60) return 'Good day';
  if (score >= 40) return 'Needs focus';
  return 'Tough day';
}

export async function sendEveningSummaries(): Promise<{ sent: number; errors: string[] }> {
  console.log('[EveningSummary] starting…');
  const errors: string[] = [];
  const now = new Date();
  const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

  const team = await loadTeam();

  // ── Fetch per-member CRM tasks data in parallel ──
  const memberData = await Promise.all(
    team.map(async (m) => {
      try {
        const [tasks, completed] = await Promise.all([
          fetchTasksForMember(m.userId ?? ''),
          fetchCompletedTodayForMember(m.userId ?? ''),
        ]);
        return { member: m, tasks, completed };
      } catch (e) {
        logger.error(`[EveningSummary] CRM tasks fetch failed for ${m.name}:`, e);
        errors.push(`tasks: ${m.name}`);
        return {
          member: m,
          tasks: { overdue: [], dueToday: [], upcoming: [], all: [] },
          completed: [],
        };
      }
    })
  );

  // ── Shared data (only for showTeamOverview members) ──
  const [outreachResult, billingResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'Active') AS enriched, COUNT(*) FILTER (WHERE reply_category IS NOT NULL) AS replied, COUNT(*) FILTER (WHERE reply_category = 'Interested') AS interested FROM outreach_leads WHERE updated_at::date = CURRENT_DATE`)
      .catch(() => ({ rows: [{ enriched: 0, replied: 0, interested: 0 }] })),
    pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total FROM invoices WHERE created_at::date = CURRENT_DATE`)
      .catch(() => ({ rows: [{ cnt: 0, total: 0 }] })),
  ]);

  const outreach = outreachResult.rows[0] || { enriched: 0, replied: 0, interested: 0 };
  const billing = billingResult.rows[0] || { cnt: 0, total: 0 };

  let sent = 0;

  for (const md of memberData) {
    try {
      const m = md.member;
      const completedCount = md.completed.length;
      const overdueCount = md.tasks.overdue.length;
      const openCount = md.tasks.all.length;
      const score = completedCount > 0 ? Math.round((completedCount / (completedCount + overdueCount)) * 100) : 0;
      const label = scoreLabel(score);

      let msg = `*:crescent_moon: Evening Summary — ${m.name} | ${dayName} ${dateStr}*\n\n`;
      msg += `*:white_check_mark: COMPLETED TODAY:* ${completedCount} tasks\n`;
      msg += `*:clipboard: CARRYING FORWARD:* ${openCount} tasks (${overdueCount} overdue)\n`;

      if (m.showTeamOverview) {
        msg += `*:bar_chart: OUTREACH:* ${outreach.enriched} enriched, ${outreach.replied} replied, ${outreach.interested} interested\n`;
        msg += `*:moneybag: BILLING:* ${billing.cnt} invoices sent today (₹${Number(billing.total).toLocaleString('en-IN')})\n`;
      }

      msg += `\nScore: *${score}/100* — _${label}_`;

      const ok = await sendSlackDM(m.slackId, msg);
      if (ok) { sent++; console.log(`[EveningSummary] sent for ${m.name}`); }
      else { errors.push(`send: ${m.name}`); }
    } catch (e) {
      errors.push(`${md.member.name}: ${e}`);
    }
    await delay(2000);
  }

  console.log(`[EveningSummary] complete — sent: ${sent}/${team.length}, errors: ${errors.length}`);
  return { sent, errors };
}
