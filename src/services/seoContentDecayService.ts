import { pool } from '../db/index';
import logger from '../utils/logger';

/**
 * Backend-native content decay detection.
 * Replaces n8n workflow mtrig-seo11 (Content Decay Detection).
 *
 * Finds keywords that have dropped significantly and creates SEO opportunities.
 */

export async function runContentDecayDetection(): Promise<{ opportunities: number }> {
  let opportunities = 0;

  try {
    // Find keywords that dropped >5 positions in the last 30 days
    const decayed = await pool.query(`
      WITH recent AS (
        SELECT DISTINCT ON (client_domain, keyword)
          client_domain, project_name, keyword, current_position, url_ranking, recorded_date
        FROM keyword_rankings
        WHERE recorded_date >= CURRENT_DATE - INTERVAL '7 days'
          AND current_position IS NOT NULL
        ORDER BY client_domain, keyword, recorded_date DESC
      ),
      older AS (
        SELECT DISTINCT ON (client_domain, keyword)
          client_domain, keyword, current_position AS old_position, recorded_date AS old_date
        FROM keyword_rankings
        WHERE recorded_date >= CURRENT_DATE - INTERVAL '35 days'
          AND recorded_date < CURRENT_DATE - INTERVAL '7 days'
          AND current_position IS NOT NULL
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
    `);

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
         LIMIT 1`,
        [domain, keyword],
      );
      if ((existing.rows as unknown[]).length > 0) continue;

      const impact = drop > 20 ? 'high' : drop > 10 ? 'medium' : 'low';
      const effort = currentPos <= 30 ? 'low' : 'medium';

      await pool.query(
        `INSERT INTO seo_opportunities
          (project_name, client_domain, opportunity_type, description, estimated_impact, effort_level, status)
         VALUES ($1, $1, 'content_decay', $2, $3, $4, 'open')`,
        [
          domain,
          `"${keyword}" dropped ${drop} positions (was #${oldPos}, now #${currentPos}). ${row.url_ranking ? `Page: ${row.url_ranking}` : 'Review and refresh content.'}`,
          impact,
          effort,
        ],
      );
      opportunities++;
    }

    // Also detect pages that fell out of top 100
    const lostRankings = await pool.query(`
      WITH last_seen AS (
        SELECT DISTINCT ON (client_domain, keyword)
          client_domain, project_name, keyword, current_position, recorded_date
        FROM keyword_rankings
        WHERE current_position IS NOT NULL AND current_position <= 100
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
        )
      LIMIT 10
    `);

    for (const row of lostRankings.rows as Array<Record<string, unknown>>) {
      const domain = String(row.client_domain);
      const keyword = String(row.keyword);

      const existing = await pool.query(
        `SELECT id FROM seo_opportunities
         WHERE (project_name = $1 OR client_domain = $1)
           AND opportunity_type = 'lost_ranking'
           AND description ILIKE '%' || $2 || '%'
           AND created_at > NOW() - INTERVAL '30 days'
         LIMIT 1`,
        [domain, keyword],
      );
      if ((existing.rows as unknown[]).length > 0) continue;

      await pool.query(
        `INSERT INTO seo_opportunities
          (project_name, client_domain, opportunity_type, description, estimated_impact, effort_level, status)
         VALUES ($1, $1, 'lost_ranking', $2, 'high', 'medium', 'open')`,
        [domain, `"${keyword}" lost ranking entirely (was #${row.current_position}, last seen ${new Date(row.recorded_date as string).toLocaleDateString('en-IN')}). Needs content refresh or new backlinks.`],
      );
      opportunities++;
    }
  } catch (e) {
    logger.error('[content-decay] error:', e instanceof Error ? e.message : String(e));
  }

  logger.info(`[content-decay] detected ${opportunities} decay opportunities`);
  return { opportunities };
}
