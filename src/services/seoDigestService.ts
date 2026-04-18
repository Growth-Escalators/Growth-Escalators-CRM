import { pool } from '../db/index';
import logger from '../utils/logger';

/**
 * Backend-native weekly SEO opportunity digest.
 * Replaces n8n workflow mtrig-seo12 (Weekly Opportunity Digest).
 *
 * Summarizes open opportunities, recent alerts, and rank changes,
 * then sends to the #seo Slack channel.
 */

export async function sendWeeklyOpportunityDigest(): Promise<{ sent: boolean }> {
  try {
    const { sendSlackMessage } = await import('./slackService');
    const { SLACK_SEO_CHANNEL } = await import('../config/constants');

    // Pre-flight: if every upstream source is empty, don't send a hollow digest
    // that makes the team think "no news is good news". Send a single health-alert
    // to #seo instead so the broken pipeline gets fixed.
    const upstreamQ = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM seo_opportunities WHERE status = 'open')::int AS open_opps,
        (SELECT COUNT(*) FROM seo_alerts_log WHERE created_at > NOW() - INTERVAL '7 days')::int AS recent_alerts,
        (SELECT COUNT(*) FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days')::int AS rankings
    `);
    const { open_opps, recent_alerts, rankings } = upstreamQ.rows[0] as { open_opps: number; recent_alerts: number; rankings: number };
    if (Number(open_opps) === 0 && Number(recent_alerts) === 0 && Number(rankings) === 0) {
      const msg = 'seo-digest: skipped — seo_opportunities, seo_alerts_log, and keyword_rankings all empty. Upstream SEO crons are broken, check Railway worker logs and SERPER_API_KEY.';
      logger.error(`[seo-digest] ${msg}`);
      await sendSlackMessage(SLACK_SEO_CHANNEL, `⚠️ ${msg}`);
      return { sent: false };
    }

    // 1. Open opportunities
    const opps = await pool.query(`
      SELECT client_domain, opportunity_type, description, estimated_impact, effort_level
      FROM seo_opportunities
      WHERE status = 'open'
      ORDER BY
        CASE estimated_impact WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 15
    `);

    // 2. Recent alerts (last 7 days)
    const alerts = await pool.query(`
      SELECT COALESCE(client_domain, project_name) AS client_domain, alert_type, COALESCE(message, alert_message) AS message
      FROM seo_alerts_log
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // 3. Top rank improvements this week
    const improvements = await pool.query(`
      SELECT COALESCE(client_domain, project_name) AS client_domain, keyword, current_position, position_change
      FROM keyword_rankings
      WHERE position_change > 0 AND (recorded_date >= CURRENT_DATE - INTERVAL '7 days' OR checked_at >= NOW() - INTERVAL '7 days')
      ORDER BY position_change DESC
      LIMIT 5
    `);

    // 4. Build digest message
    const lines: string[] = [
      '*📊 Weekly SEO Opportunity Digest*',
      `_${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}_`,
      '',
    ];

    // Rank wins
    const wins = improvements.rows as Array<Record<string, unknown>>;
    if (wins.length > 0) {
      lines.push('*🏆 Rank Wins This Week*');
      for (const w of wins) {
        lines.push(`• *${w.client_domain}* — "${w.keyword}" ↑${w.position_change} (now #${w.current_position})`);
      }
      lines.push('');
    }

    // Open opportunities
    const oppRows = opps.rows as Array<Record<string, string>>;
    if (oppRows.length > 0) {
      lines.push(`*🎯 Open Opportunities (${oppRows.length})*`);
      for (const o of oppRows.slice(0, 8)) {
        const impact = o.estimated_impact === 'high' ? '🔴' : o.estimated_impact === 'medium' ? '🟡' : '🟢';
        lines.push(`${impact} *${o.client_domain}* [${o.opportunity_type}] ${o.description.slice(0, 100)}`);
      }
      if (oppRows.length > 8) lines.push(`_…and ${oppRows.length - 8} more_`);
      lines.push('');
    } else {
      lines.push('*🎯 No open opportunities* — all caught up!');
      lines.push('');
    }

    // Alerts summary
    const alertRows = alerts.rows as Array<Record<string, string>>;
    if (alertRows.length > 0) {
      lines.push(`*⚠️ Alerts This Week (${alertRows.length})*`);
      for (const a of alertRows.slice(0, 5)) {
        const icon = a.severity === 'critical' ? '🔴' : a.severity === 'high' ? '🟠' : '🟡';
        lines.push(`${icon} *${a.client_domain}* — ${a.message.slice(0, 80)}`);
      }
      lines.push('');
    }

    // Content calendar status
    try {
      const calendarStats = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'planned') AS planned,
          COUNT(*) FILTER (WHERE status = 'writing') AS writing,
          COUNT(*) FILTER (WHERE status = 'review') AS review,
          COUNT(*) FILTER (WHERE status = 'published' AND updated_at >= NOW() - INTERVAL '30 days') AS published_this_month
        FROM seo_content_calendar
      `);
      const cs = calendarStats.rows[0] as Record<string, unknown> | undefined;
      if (cs) {
        lines.push('*Content Pipeline*');
        lines.push(`• Planned: ${cs.planned} | Writing: ${cs.writing} | In Review: ${cs.review} | Published (30d): ${cs.published_this_month}`);
        lines.push('');
      }
    } catch { /* content calendar not yet set up */ }

    lines.push('_View details: /crm/seo_');

    const message = lines.join('\n');
    const sent = await sendSlackMessage(SLACK_SEO_CHANNEL, message);
    logger.info(`[seo-digest] weekly digest ${sent ? 'sent' : 'failed'}`);
    return { sent };
  } catch (e) {
    logger.error('[seo-digest] error:', e instanceof Error ? e.message : String(e));
    return { sent: false };
  }
}
