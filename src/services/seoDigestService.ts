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

    // Outcome check: measure opportunities published 14+ days ago but not yet measured
    try {
      const unmeasured = await pool.query(`
        SELECT o.id, o.client_domain, o.keyword, o.created_at
        FROM seo_opportunities o
        WHERE o.published_url IS NOT NULL
          AND o.outcome IS NULL
          AND o.created_at <= NOW() - INTERVAL '14 days'
        LIMIT 20
      `);
      for (const opp of unmeasured.rows as Array<{ id: string; client_domain: string; keyword: string; created_at: string }>) {
        if (!opp.keyword) continue;
        const rankNow = await pool.query(
          `SELECT current_position FROM keyword_rankings
           WHERE (client_domain = $1 OR project_name = $1) AND keyword = $2
           ORDER BY recorded_date DESC LIMIT 1`,
          [opp.client_domain, opp.keyword],
        );
        const rankAtCreation = await pool.query(
          `SELECT current_position FROM keyword_rankings
           WHERE (client_domain = $1 OR project_name = $1) AND keyword = $2
             AND recorded_date <= $3::date
           ORDER BY recorded_date DESC LIMIT 1`,
          [opp.client_domain, opp.keyword, opp.created_at],
        );
        if (rankNow.rows.length > 0 && rankAtCreation.rows.length > 0) {
          const now = Number((rankNow.rows[0] as { current_position: number }).current_position);
          const before = Number((rankAtCreation.rows[0] as { current_position: number }).current_position);
          const outcome = now < before - 5 ? 'recovered' : now < before ? 'improved' : now > before + 5 ? 'worse' : 'flat';
          await pool.query(
            `UPDATE seo_opportunities SET outcome = $1, outcome_measured_at = NOW() WHERE id = $2`,
            [outcome, opp.id],
          );
        }
      }
    } catch (e) {
      logger.warn('[seo-digest] outcome check failed:', e instanceof Error ? e.message : String(e));
    }

    // Per-client digest
    const CLIENT_DOMAINS = ['aarohaom.com', 'blackpandaenterprises.com', 'ageddentistry.org'];
    const clientSummaries: string[] = [];

    for (const domain of CLIENT_DOMAINS) {
      try {
        // North Star: net rank change this week
        const rankChanges = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE position_change > 0)::int AS wins,
            COUNT(*) FILTER (WHERE position_change < -5)::int AS losses,
            COALESCE(SUM(position_change) FILTER (WHERE position_change > 0), 0)::int AS gained,
            COALESCE(SUM(ABS(position_change)) FILTER (WHERE position_change < -5), 0)::int AS lost
          FROM keyword_rankings
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND recorded_date >= CURRENT_DATE - INTERVAL '7 days'
        `, [domain]);

        const rc = rankChanges.rows[0] as { wins: number; losses: number; gained: number; lost: number };
        const netChange = (rc.gained ?? 0) - (rc.lost ?? 0);
        const trendSymbol = netChange > 0 ? '↑' : netChange < 0 ? '↓' : '→';

        // Week-over-week impressions trend
        const trendQ = await pool.query(`
          SELECT
            this_week.total_impressions,
            this_week.total_clicks,
            (this_week.total_impressions - COALESCE(last_week.total_impressions, 0)) AS impressions_delta
          FROM seo_weekly_metrics this_week
          LEFT JOIN seo_weekly_metrics last_week
            ON last_week.client_domain = this_week.client_domain
            AND last_week.week_start_date = this_week.week_start_date - INTERVAL '7 days'
          WHERE this_week.client_domain = $1
          ORDER BY this_week.week_start_date DESC
          LIMIT 1
        `, [domain]);
        const trend = trendQ.rows[0] as { total_impressions: number; total_clicks: number; impressions_delta: number } | undefined;

        // Top 3 opportunities by priority_score
        const topOpps = await pool.query(`
          SELECT opportunity_type, description, estimated_impact, priority_score, keyword
          FROM seo_opportunities
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND status = 'open'
          ORDER BY COALESCE(priority_score, 0) DESC
          LIMIT 3
        `, [domain]);

        // Recent alerts count
        const alertCount = await pool.query(`
          SELECT COUNT(*)::int AS count FROM seo_alerts_log
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND created_at > NOW() - INTERVAL '7 days'
        `, [domain]);

        // Open opportunities count
        const oppCount = await pool.query(`
          SELECT COUNT(*)::int AS count FROM seo_opportunities
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND status = 'open'
        `, [domain]);

        const clientName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
        const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const lines: string[] = [
          `*📊 ${clientName} (${domain}) — SEO Weekly Snapshot*`,
          `_${dateStr}_`,
          '',
          `*North Star: Net rank change this week: ${netChange > 0 ? '+' : ''}${netChange} ${trendSymbol}* (${rc.wins ?? 0} wins, ${rc.losses ?? 0} losses)`,
        ];

        if (trend) {
          const impDelta = Number(trend.impressions_delta ?? 0);
          const impPct = trend.total_impressions && (trend.total_impressions - impDelta) > 0
            ? Math.round(impDelta / (trend.total_impressions - impDelta) * 100)
            : 0;
          lines.push(`📈 Impressions: ${(trend.total_impressions ?? 0).toLocaleString('en-IN')} (${impDelta >= 0 ? '+' : ''}${impPct}% vs last week)`);
          lines.push('');
        }

        const oppRows = topOpps.rows as Array<{ opportunity_type: string; description: string; estimated_impact: string; priority_score: number; keyword: string }>;
        if (oppRows.length > 0) {
          lines.push('*Top priorities this week:*');
          for (const o of oppRows) {
            const dot = o.estimated_impact === 'high' ? '🔴' : o.estimated_impact === 'medium' ? '🟡' : '🟢';
            const kw = o.keyword ? ` "${o.keyword}"` : '';
            lines.push(`${dot} [${o.opportunity_type}]${kw} — ${o.description.slice(0, 80)} (score: ${o.priority_score ?? 0})`);
          }
          lines.push('');
        }

        const totalAlerts = Number((alertCount.rows[0] as { count: number }).count);
        const totalOpps = Number((oppCount.rows[0] as { count: number }).count);
        lines.push(`_${totalAlerts} alert${totalAlerts !== 1 ? 's' : ''} · ${totalOpps} open opportunit${totalOpps !== 1 ? 'ies' : 'y'} total_`);

        await sendSlackMessage(SLACK_SEO_CHANNEL, lines.join('\n'));
        clientSummaries.push(`${clientName} (${netChange > 0 ? '+' : ''}${netChange} net)`);
      } catch (e) {
        logger.error(`[seo-digest] failed for ${domain}:`, e instanceof Error ? e.message : String(e));
        clientSummaries.push(`${domain} (error)`);
      }
    }

    // Team summary
    await sendSlackMessage(SLACK_SEO_CHANNEL,
      `_Weekly SEO digest sent: ${clientSummaries.join(', ')}_`
    ).catch(() => null);

    logger.info(`[seo-digest] weekly digest sent for clients: ${clientSummaries.join(', ')}`);
    return { sent: true };
  } catch (e) {
    logger.error('[seo-digest] error:', e instanceof Error ? e.message : String(e));
    return { sent: false };
  }
}
