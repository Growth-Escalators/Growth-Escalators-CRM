import { pool } from '../db/index';
import logger from '../utils/logger';

/**
 * Backend-native SEO alert generation.
 * Replaces n8n workflow mtrig-seo02 (Alert Triggers).
 *
 * Checks existing data tables for anomalies and inserts alerts into seo_alerts_log.
 */

const CLIENT_DOMAINS = ['aarohaom.com', 'blackpandaenterprises.com', 'ageddentistry.org'];

export async function runSeoAlertChecks(): Promise<{ alerts: number }> {
  // Pre-flight: if all upstream tables are empty, the "zero alerts" we'd produce
  // is meaningless — it's indistinguishable from "all pipelines are broken".
  // Bail loudly so the Railway env / cron health gets checked.
  const upstreamQ = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days')::int AS rankings,
      (SELECT COUNT(*) FROM site_health_metrics WHERE checked_at >= NOW() - INTERVAL '10 days')::int AS health,
      (SELECT COUNT(*) FROM seo_weekly_metrics WHERE week_start_date >= CURRENT_DATE - INTERVAL '14 days')::int AS gsc
  `);
  const { rankings, health, gsc } = upstreamQ.rows[0] as { rankings: number; health: number; gsc: number };
  if (Number(rankings) === 0 && Number(health) === 0 && Number(gsc) === 0) {
    const msg = 'seo-alerts: all 3 upstream tables (keyword_rankings, site_health_metrics, seo_weekly_metrics) are empty for the last 10-14 days — upstream crons are broken, skipping alert generation to avoid false all-clear';
    logger.error(`[seo-alerts] ${msg}`);
    try {
      const { sendSlackMessage } = await import('./slackService');
      const { SLACK_SEO_CHANNEL } = await import('../config/constants');
      await sendSlackMessage(SLACK_SEO_CHANNEL, `⚠️ ${msg}`);
    } catch { /* slack non-critical */ }
    return { alerts: 0 };
  }

  let alerts = 0;

  for (const domain of CLIENT_DOMAINS) {
    try {
      // 1. Keyword position drop alerts (>5 positions in last 7 days)
      const drops = await pool.query(`
        SELECT keyword, current_position, previous_position, position_change
        FROM keyword_rankings
        WHERE (client_domain = $1 OR project_name ILIKE '%' || $1 || '%')
          AND position_change IS NOT NULL AND position_change < -5
          AND recorded_date >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY position_change ASC
        LIMIT 10
      `, [domain]);

      for (const row of drops.rows as Array<Record<string, unknown>>) {
        await insertAlert(domain, 'rank_drop',
          `Keyword "${row.keyword}" dropped ${Math.abs(Number(row.position_change))} positions (now #${row.current_position})`,
          'warning');
        alerts++;
        // (ClickUp opportunity task creation removed — ClickUp dropped 2026-05-09)
      }

      // 2. PageSpeed score drop alerts
      const healthCheck = await pool.query(`
        SELECT pagespeed_mobile, pagespeed_desktop, lcp, cls
        FROM site_health_metrics
        WHERE project_name ILIKE '%' || $1 || '%'
        ORDER BY checked_at DESC LIMIT 2
      `, [domain.split('.')[0]]);

      if (healthCheck.rows.length >= 2) {
        const current = healthCheck.rows[0] as Record<string, number>;
        const previous = healthCheck.rows[1] as Record<string, number>;
        if (current.pagespeed_mobile && previous.pagespeed_mobile &&
            current.pagespeed_mobile < previous.pagespeed_mobile - 10) {
          await insertAlert(domain, 'pagespeed_drop',
            `Mobile PageSpeed dropped from ${previous.pagespeed_mobile} to ${current.pagespeed_mobile}`,
            'warning');
          alerts++;
        }
        if (current.lcp && current.lcp > 4.0) {
          await insertAlert(domain, 'lcp_slow',
            `LCP is ${current.lcp}s (should be <2.5s)`,
            'high');
          alerts++;
        }
      }

      // 3. Zero impressions alert (GSC data)
      const noTraffic = await pool.query(`
        SELECT total_clicks, total_impressions
        FROM seo_weekly_metrics
        WHERE (client_domain = $1 OR project_name ILIKE '%' || $1 || '%')
        ORDER BY week_start_date DESC LIMIT 1
      `, [domain]);

      if (noTraffic.rows.length > 0) {
        const row = noTraffic.rows[0] as Record<string, number>;
        if (row.total_clicks === 0 && row.total_impressions === 0) {
          await insertAlert(domain, 'zero_traffic',
            `Zero clicks and impressions this week — check GSC indexing`,
            'critical');
          alerts++;
        }
      }

      // 4. New keyword in top 10 (positive alert)
      const newTop10 = await pool.query(`
        SELECT keyword, current_position
        FROM keyword_rankings
        WHERE (client_domain = $1 OR project_name ILIKE '%' || $1 || '%')
          AND current_position <= 10 AND previous_position > 10
          AND recorded_date >= CURRENT_DATE - INTERVAL '7 days'
        LIMIT 5
      `, [domain]);

      for (const row of newTop10.rows as Array<Record<string, string>>) {
        await insertAlert(domain, 'new_top10',
          `"${row.keyword}" entered top 10 (now #${row.current_position})`,
          'info');
        alerts++;
      }
    } catch (e) {
      logger.error(`[seo-alerts] error for ${domain}:`, e instanceof Error ? e.message : String(e));
    }
  }

  logger.info(`[seo-alerts] generated ${alerts} alerts`);
  return { alerts };
}

async function insertAlert(domain: string, alertType: string, message: string, severity: string): Promise<void> {
  // Deduplicate: don't insert if same alert exists in last 24h
  const existing = await pool.query(
    `SELECT id FROM seo_alerts_log
     WHERE project_name = $1 AND alert_type = $2 AND message = $3
       AND created_at > NOW() - INTERVAL '24 hours'
     LIMIT 1`,
    [domain, alertType, message],
  );
  if ((existing.rows as unknown[]).length > 0) return;

  await pool.query(
    `INSERT INTO seo_alerts_log (project_name, client_domain, alert_type, message, severity)
     VALUES ($1, $1, $2, $3, $4)`,
    [domain, alertType, message, severity],
  );
}
