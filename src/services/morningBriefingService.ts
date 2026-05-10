import logger from '../utils/logger';
import { fetchTasksForMember } from './sodEodService';
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

export async function sendMorningBriefings(): Promise<{ sent: number; errors: string[] }> {
  console.log('[MorningBriefing] starting…');
  const errors: string[] = [];
  const now = new Date();
  const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

  const team = await loadTeam();

  // ── Shared data (only needed for showTeamOverview members) ──
  const [
    pipelineResult,
    proposalResult,
    adsResult,
    overdueInvoicesResult,
    outreachResult,
    discoveryResult,
    intelligenceResult,
    failedCronsResult,
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(deal_value), 0) AS total FROM deals WHERE stage NOT IN ('won','lost','Won','Lost')`)
      .catch(() => ({ rows: [{ cnt: 0, total: 0 }] })),
    pool.query(`SELECT COUNT(*) AS cnt FROM deals WHERE LOWER(stage) = 'proposal'`)
      .catch(() => ({ rows: [{ cnt: 0 }] })),
    pool.query(`SELECT COALESCE(SUM((data->>'spend')::numeric), 0) AS spend, CASE WHEN COALESCE(SUM((data->>'spend')::numeric), 0) > 0 THEN ROUND(COALESCE(SUM((data->>'purchase_value')::numeric), 0) / SUM((data->>'spend')::numeric), 1) ELSE 0 END AS roas FROM ads_insights_cache WHERE date = CURRENT_DATE`)
      .catch(() => ({ rows: [{ spend: 0, roas: 0 }] })),
    pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_due), 0) AS total FROM invoices WHERE status = 'overdue'`)
      .catch(() => ({ rows: [{ cnt: 0, total: 0 }] })),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'Active') AS enriched, COUNT(*) FILTER (WHERE reply_category IS NOT NULL) AS replied FROM outreach_leads WHERE updated_at::date = CURRENT_DATE`)
      .catch(() => ({ rows: [{ enriched: 0, replied: 0 }] })),
    pool.query(`SELECT credits_remaining FROM discovery_api_usage ORDER BY created_at DESC LIMIT 1`)
      .catch(() => ({ rows: [] as Array<{ credits_remaining: number }> })),
    pool.query(`SELECT problems FROM ai_intelligence_reports WHERE report_date = CURRENT_DATE AND status = 'complete' ORDER BY created_at DESC LIMIT 1`)
      .catch(() => ({ rows: [] as Array<{ problems: unknown }> })),
    pool.query(`SELECT job_name FROM cron_job_logs WHERE status = 'failed' AND started_at >= NOW() - INTERVAL '24 hours'`)
      .catch(() => ({ rows: [] as Array<{ job_name: string }> })),
  ]);

  const pipeline = pipelineResult.rows[0] || { cnt: 0, total: 0 };
  const proposals = proposalResult.rows[0]?.cnt || 0;
  const ads = adsResult.rows[0] || { spend: 0, roas: 0 };
  const overdueInv = overdueInvoicesResult.rows[0] || { cnt: 0, total: 0 };
  const outreach = outreachResult.rows[0] || { enriched: 0, replied: 0 };
  const discoveryRemaining = discoveryResult.rows[0]?.credits_remaining ?? 'N/A';
  const discoveryTotal = 2500;
  const failedCrons = failedCronsResult.rows as Array<{ job_name: string }>;

  // Parse intelligence actions
  let actionItems: string[] = [];
  try {
    const raw = intelligenceResult.rows[0]?.problems;
    if (raw && Array.isArray(raw)) {
      actionItems = (raw as Array<{ title?: string; owner?: string }>)
        .filter(p => p.title)
        .slice(0, 5)
        .map(p => `• ${p.title}${p.owner ? ` _(${p.owner})_` : ''}`);
    }
  } catch { /* ignore parse errors */ }

  // ── Fetch CRM tasks for all members in parallel ──
  const taskResults = await Promise.all(
    team.map(async (m) => {
      try {
        const data = await fetchTasksForMember(m.userId ?? '');
        return { member: m, ...data };
      } catch (e) {
        logger.error(`[MorningBriefing] CRM tasks fetch failed for ${m.name}:`, e);
        errors.push(`tasks: ${m.name}`);
        return { member: m, overdue: [], dueToday: [], upcoming: [], all: [] };
      }
    })
  );

  let sent = 0;

  for (const cr of taskResults) {
    try {
      const m = cr.member;
      let msg = `*:sunny: Morning Briefing — ${m.name} | ${dayName} ${dateStr}*\n\n`;

      if (m.showTeamOverview) {
        msg += `*:bar_chart: YOUR NUMBERS*\n`;
        msg += `• Pipeline: ₹${Number(pipeline.total).toLocaleString('en-IN')} active (${proposals} in proposal)\n`;
        msg += `• Ads: ₹${Number(ads.spend).toLocaleString('en-IN')} spent, ${ads.roas}x ROAS\n`;
        msg += `• Overdue invoices: ${overdueInv.cnt} (₹${Number(overdueInv.total).toLocaleString('en-IN')})\n`;
        msg += `• Outreach: ${outreach.enriched} enriched, ${outreach.replied} replied\n`;
        msg += `• Discovery budget: ${discoveryRemaining}/${discoveryTotal}\n\n`;

        const ownerActions = actionItems.filter(a =>
          a.toLowerCase().includes(m.name.toLowerCase())
        ).slice(0, 3);
        if (ownerActions.length > 0) {
          msg += `*:red_circle: ACTION NEEDED (${ownerActions.length})*\n`;
          msg += ownerActions.join('\n') + '\n\n';
        }
      }

      // CRM tasks section (all members)
      msg += `*:clipboard: YOUR TASKS*\n`;
      msg += `• ${cr.dueToday.length} due today, ${cr.overdue.length} overdue\n`;
      if (cr.overdue.length > 0) {
        const top = cr.overdue[0];
        msg += `  _Top overdue: ${top.name} (${top.daysOverdue}d)_\n`;
      }

      if (m.showTeamOverview && failedCrons.length > 0) {
        msg += `\n*:warning: SYSTEM*\n`;
        msg += `${failedCrons.length} cron(s) failed in last 24h: ${failedCrons.map(c => c.job_name).join(', ')}\n`;
      }

      const ok = await sendSlackDM(m.slackId, msg);
      if (ok) { sent++; console.log(`[MorningBriefing] sent for ${m.name}`); }
      else { errors.push(`send: ${m.name}`); }
    } catch (e) {
      errors.push(`${cr.member.name}: ${e}`);
    }
    await delay(2000);
  }

  console.log(`[MorningBriefing] complete — sent: ${sent}/${team.length}, errors: ${errors.length}`);
  return { sent, errors };
}
