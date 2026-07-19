import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

/**
 * Backend-native content decay detection.
 * Replaces n8n workflow mtrig-seo11 (Content Decay Detection).
 *
 * Finds keywords that have dropped significantly and creates SEO opportunities.
 */

export async function runContentDecayDetection(): Promise<{ opportunities: number }> {
  let opportunities = 0;
  const tenantId = await resolveDefaultSeoTenantId();

  try {
    // Pre-flight: if upstream rank tracker is silently broken (missing SERPER_API_KEY,
    // Serper outage, etc.), keyword_rankings stops getting new rows and content decay
    // returns 0 with no signal. Fail loudly in that case.
    const recentRowsQ = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM keyword_rankings
       WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days' AND tenant_id = $1`,
      [tenantId],
    );
    const recentRows = Number((recentRowsQ.rows[0] as { cnt: number }).cnt);
    if (recentRows === 0) {
      const msg = 'content_decay: keyword_rankings has 0 rows in the last 10 days — upstream rank tracker is broken (check SERPER_API_KEY on Railway worker and WF Rank Tracking logs).';
      logger.error(`[content-decay] ${msg}`);
      try {
        const { sendSlackMessage } = await import('./slackService');
        const { SLACK_SEO_CHANNEL } = await import('../config/constants');
        await sendSlackMessage(SLACK_SEO_CHANNEL, `⚠️ ${msg}`);
      } catch { /* slack non-critical */ }
      return { opportunities: 0 };
    }

    // Learning loop: historical outcome success rates per opportunity type, computed
    // once per run and used to nudge priority scores (see applySuccessRateAdjustment).
    const { computeOpportunityTypeSuccessRates, applySuccessRateAdjustment } = await import('./seoDigestService');
    const successRates = await computeOpportunityTypeSuccessRates();

    // Find keywords that dropped >5 positions in the last 30 days
    const decayed = await pool.query(`
      WITH recent AS (
        SELECT DISTINCT ON (client_domain, keyword)
          client_domain, project_name, keyword, current_position, url_ranking, recorded_date
        FROM keyword_rankings
        WHERE recorded_date >= CURRENT_DATE - INTERVAL '7 days'
          AND current_position IS NOT NULL
          AND tenant_id = $1
        ORDER BY client_domain, keyword, recorded_date DESC
      ),
      older AS (
        SELECT DISTINCT ON (client_domain, keyword)
          client_domain, keyword, current_position AS old_position, recorded_date AS old_date
        FROM keyword_rankings
        WHERE recorded_date >= CURRENT_DATE - INTERVAL '35 days'
          AND recorded_date < CURRENT_DATE - INTERVAL '7 days'
          AND current_position IS NOT NULL
          AND tenant_id = $1
        ORDER BY client_domain, keyword, recorded_date DESC
      )
      SELECT r.client_domain, r.project_name, r.keyword,
             r.current_position, o.old_position,
             (o.old_position - r.current_position) AS change,
             r.url_ranking
      FROM recent r
      JOIN older o ON o.client_domain = r.client_domain AND o.keyword = r.keyword
      WHERE r.current_position > o.old_position + 5
      ORDER BY (r.current_position - o.old_position) DESC
      LIMIT 20
    `, [tenantId]);

    for (const row of decayed.rows as Array<Record<string, unknown>>) {
      const domain = String(row.client_domain);
      const keyword = String(row.keyword);
      const currentPos = Number(row.current_position);
      const oldPos = Number(row.old_position);
      const drop = currentPos - oldPos;

      // Deduplicate: don't insert if same opportunity exists in last 14 days
      const existing = await pool.query(
        `SELECT id FROM seo_opportunities
         WHERE (project_name = $1 OR client_domain = $1)
           AND opportunity_type = 'content_decay'
           AND description ILIKE '%' || $2 || '%'
           AND created_at > NOW() - INTERVAL '14 days'
           AND tenant_id = $3
         LIMIT 1`,
        [domain, keyword, tenantId],
      );
      if ((existing.rows as unknown[]).length > 0) continue;

      const impact = drop > 20 ? 'high' : drop > 10 ? 'medium' : 'low';
      const effort = currentPos <= 30 ? 'low' : 'medium';

      const positionDrop = currentPos - oldPos;  // this is the drop magnitude (positive number)
      const impactWeight = impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
      const rawPriorityScore = Math.round(positionDrop * impactWeight);
      // Learning loop: nudge the score using how well past content_decay opportunities
      // actually performed (no-op until sampleSize >= 10 for this opportunity type).
      const priorityScore = applySuccessRateAdjustment(rawPriorityScore, successRates, 'content_decay', { min: 0 });

      const insertResult = await pool.query(
        `INSERT INTO seo_opportunities
          (project_name, client_domain, opportunity_type, description, estimated_impact, effort_level, status, keyword, priority_score, tenant_id)
         VALUES ($1, $1, 'content_decay', $2, $3, $4, 'open', $5, $6, $7)
         RETURNING id`,
        [
          domain,
          `"${keyword}" dropped ${drop} positions (was #${oldPos}, now #${currentPos}). ${row.url_ranking ? `Page: ${row.url_ranking}` : 'Review and refresh content.'}`,
          impact,
          effort,
          keyword,
          priorityScore,
          tenantId,
        ],
      );
      opportunities++;
      const decayOppId = (insertResult.rows[0] as { id: string }).id;

      // Link a content-calendar row to this opportunity so it's measurable the same
      // way content-gap opportunities are (mirrors seoContentGapService.ts's shape).
      try {
        await pool.query(`
          INSERT INTO seo_content_calendar (client_domain, keyword, content_type, title, status, priority, source, opportunity_id)
          VALUES ($1, $2, 'refresh', $3, 'planned', $4, 'content_decay', $5)
          ON CONFLICT (client_domain, keyword, content_type) DO NOTHING
        `, [domain, keyword, `Refresh: "${keyword}"`, impact, decayOppId]);
      } catch (calErr) {
        logger.warn(`[content-decay] calendar insert skipped: ${calErr instanceof Error ? calErr.message : String(calErr)}`);
      }
    }

    // Also detect pages that fell out of top 100
    const lostRankings = await pool.query(`
      WITH last_seen AS (
        SELECT DISTINCT ON (client_domain, keyword)
          client_domain, project_name, keyword, current_position, recorded_date
        FROM keyword_rankings
        WHERE current_position IS NOT NULL AND current_position <= 100
          AND tenant_id = $1
        ORDER BY client_domain, keyword, recorded_date DESC
      )
      SELECT ls.client_domain, ls.project_name, ls.keyword, ls.current_position, ls.recorded_date
      FROM last_seen ls
      WHERE ls.recorded_date < CURRENT_DATE - INTERVAL '14 days'
        AND NOT EXISTS (
          SELECT 1 FROM keyword_rankings kr
          WHERE kr.client_domain = ls.client_domain AND kr.keyword = ls.keyword
            AND kr.recorded_date >= CURRENT_DATE - INTERVAL '14 days'
            AND kr.current_position IS NOT NULL
            AND kr.tenant_id = $1
        )
      LIMIT 10
    `, [tenantId]);

    for (const row of lostRankings.rows as Array<Record<string, unknown>>) {
      const domain = String(row.client_domain);
      const keyword = String(row.keyword);

      const existing = await pool.query(
        `SELECT id FROM seo_opportunities
         WHERE (project_name = $1 OR client_domain = $1)
           AND opportunity_type = 'lost_ranking'
           AND description ILIKE '%' || $2 || '%'
           AND created_at > NOW() - INTERVAL '30 days'
           AND tenant_id = $3
         LIMIT 1`,
        [domain, keyword, tenantId],
      );
      if ((existing.rows as unknown[]).length > 0) continue;

      const currentPos = Number(row.current_position);
      const rawPriorityScore = Math.max(1, 50 - (currentPos ?? 100));
      // Learning loop: nudge the score using how well past lost_ranking opportunities
      // actually performed (no-op until sampleSize >= 10 for this opportunity type).
      const priorityScore = applySuccessRateAdjustment(rawPriorityScore, successRates, 'lost_ranking', { min: 1 });

      const lostInsertResult = await pool.query(
        `INSERT INTO seo_opportunities
          (project_name, client_domain, opportunity_type, description, estimated_impact, effort_level, status, keyword, priority_score, tenant_id)
         VALUES ($1, $1, 'lost_ranking', $2, 'high', 'medium', 'open', $3, $4, $5)
         RETURNING id`,
        [domain, `"${keyword}" lost ranking entirely (was #${row.current_position}, last seen ${new Date(row.recorded_date as string).toLocaleDateString('en-IN')}). Needs content refresh or new backlinks.`, keyword, priorityScore, tenantId],
      );
      opportunities++;
      const lostOppId = (lostInsertResult.rows[0] as { id: string }).id;

      // Link a content-calendar row to this opportunity so it's measurable the same
      // way content-gap opportunities are (mirrors seoContentGapService.ts's shape).
      try {
        await pool.query(`
          INSERT INTO seo_content_calendar (client_domain, keyword, content_type, title, status, priority, source, opportunity_id)
          VALUES ($1, $2, 'refresh', $3, 'planned', 'high', 'lost_ranking', $4)
          ON CONFLICT (client_domain, keyword, content_type) DO NOTHING
        `, [domain, keyword, `Recover: "${keyword}"`, lostOppId]);
      } catch (calErr) {
        logger.warn(`[content-decay] calendar insert skipped (lost_ranking): ${calErr instanceof Error ? calErr.message : String(calErr)}`);
      }
    }
  } catch (e) {
    logger.error('[content-decay] error:', e instanceof Error ? e.message : String(e));
  }

  logger.info(`[content-decay] detected ${opportunities} decay opportunities`);
  return { opportunities };
}
