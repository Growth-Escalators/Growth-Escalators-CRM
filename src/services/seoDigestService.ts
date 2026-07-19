import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

/**
 * Backend-native weekly SEO opportunity digest.
 * Replaces n8n workflow mtrig-seo12 (Weekly Opportunity Digest).
 *
 * Summarizes open opportunities, recent alerts, and rank changes,
 * then sends to the #seo Slack channel.
 */

// ---------------------------------------------------------------------------
// Learning loop — historical outcome success rates per opportunity type.
//
// seo_opportunities.outcome is populated by the 14-day outcome check below
// (recovered/improved/worse/flat) once seo_content_calendar.opportunity_id +
// the content-calendar PATCH route (src/routes/seo.ts) propagate a
// published_url back onto the opportunity row. Everything downstream here —
// the priority-score nudge in seoContentGapService.ts / seoContentDecayService.ts
// / competitorContentService.ts, and the AI-prompt context in
// contentGenerationService.ts / competitorContentService.ts — reads from this.
// ---------------------------------------------------------------------------
export interface OpportunityTypeSuccessStats {
  successRate: number; // 0..1
  sampleSize: number;
}

const SUCCESSFUL_OUTCOMES = ['recovered', 'improved'];

export async function computeOpportunityTypeSuccessRates(): Promise<Record<string, OpportunityTypeSuccessStats>> {
  try {
    const result = await pool.query(`
      SELECT
        opportunity_type,
        COUNT(*)::int AS sample_size,
        COUNT(*) FILTER (WHERE outcome = ANY($1::text[]))::int AS successes
      FROM seo_opportunities
      WHERE outcome IS NOT NULL AND opportunity_type IS NOT NULL
      GROUP BY opportunity_type
    `, [SUCCESSFUL_OUTCOMES]);

    const rates: Record<string, OpportunityTypeSuccessStats> = {};
    for (const row of result.rows as Array<{ opportunity_type: string; sample_size: number; successes: number }>) {
      const sampleSize = Number(row.sample_size);
      rates[row.opportunity_type] = {
        successRate: sampleSize > 0 ? Number(row.successes) / sampleSize : 0,
        sampleSize,
      };
    }
    return rates;
  } catch (e) {
    logger.warn('[seo-digest] computeOpportunityTypeSuccessRates failed:', e instanceof Error ? e.message : String(e));
    return {};
  }
}

// Below this many measured outcomes for a given opportunity_type, we don't trust
// the signal enough to move prioritization — return the score unadjusted.
const MIN_SAMPLE_SIZE_FOR_ADJUSTMENT = 10;

/**
 * Nudge a priority score using historical success-rate data for its opportunity
 * type. Bounded to roughly +/-20%, centered on a 0.5 (coin-flip) baseline:
 * successRate 0.7 -> x1.2, successRate 0.3 -> x0.8. No-ops (returns baseScore
 * unchanged) when there isn't yet a trustworthy sample for that type.
 */
export function applySuccessRateAdjustment(
  baseScore: number,
  successRates: Record<string, OpportunityTypeSuccessStats>,
  opportunityType: string,
  bounds: { min?: number; max?: number } = {},
): number {
  const stats = successRates[opportunityType];
  if (!stats || stats.sampleSize < MIN_SAMPLE_SIZE_FOR_ADJUSTMENT) return baseScore;

  const rawMultiplier = 1 + (stats.successRate - 0.5);
  const multiplier = Math.max(0.8, Math.min(1.2, rawMultiplier));

  let adjusted = Math.round(baseScore * multiplier);
  if (bounds.min !== undefined) adjusted = Math.max(bounds.min, adjusted);
  if (bounds.max !== undefined) adjusted = Math.min(bounds.max, adjusted);
  return adjusted;
}

/**
 * A short paragraph of historical-performance context for AI content-generation
 * prompts (contentGenerationService.ts, competitorContentService.ts). Returns ''
 * (omit entirely) when there's no meaningful sample yet — a hollow "0% of 0
 * cases" line would be worse than no line at all.
 */
export function formatHistoricalPerformanceNote(
  opportunityType: string,
  successRates: Record<string, OpportunityTypeSuccessStats>,
  minSampleSize = 5,
): string {
  const stats = successRates[opportunityType];
  if (!stats || stats.sampleSize < minSampleSize) return '';
  const pct = Math.round(stats.successRate * 100);
  const label = opportunityType.replace(/_/g, '-');
  return `\n\nHistorical performance data: ${label}-driven pages have improved search rank in ${pct}% of ${stats.sampleSize} measured past attempts — factor this into your approach.`;
}

export async function sendWeeklyOpportunityDigest(): Promise<{ sent: boolean }> {
  try {
    const { sendSlackMessage } = await import('./slackService');
    const { SLACK_SEO_CHANNEL } = await import('../config/constants');
    const tenantId = await resolveDefaultSeoTenantId();

    // Pre-flight: if every upstream source is empty, don't send a hollow digest
    // that makes the team think "no news is good news". Send a single health-alert
    // to #seo instead so the broken pipeline gets fixed.
    const upstreamQ = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM seo_opportunities WHERE status = 'open' AND tenant_id = $1)::int AS open_opps,
        (SELECT COUNT(*) FROM seo_alerts_log WHERE created_at > NOW() - INTERVAL '7 days' AND tenant_id = $1)::int AS recent_alerts,
        (SELECT COUNT(*) FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days' AND tenant_id = $1)::int AS rankings
    `, [tenantId]);
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
          AND o.tenant_id = $1
        LIMIT 20
      `, [tenantId]);
      for (const opp of unmeasured.rows as Array<{ id: string; client_domain: string; keyword: string; created_at: string }>) {
        if (!opp.keyword) continue;
        const rankNow = await pool.query(
          `SELECT current_position FROM keyword_rankings
           WHERE (client_domain = $1 OR project_name = $1) AND keyword = $2 AND tenant_id = $3
           ORDER BY recorded_date DESC LIMIT 1`,
          [opp.client_domain, opp.keyword, tenantId],
        );
        const rankAtCreation = await pool.query(
          `SELECT current_position FROM keyword_rankings
           WHERE (client_domain = $1 OR project_name = $1) AND keyword = $2
             AND recorded_date <= $3::date
             AND tenant_id = $4
           ORDER BY recorded_date DESC LIMIT 1`,
          [opp.client_domain, opp.keyword, opp.created_at, tenantId],
        );
        if (rankNow.rows.length > 0 && rankAtCreation.rows.length > 0) {
          const now = Number((rankNow.rows[0] as { current_position: number }).current_position);
          const before = Number((rankAtCreation.rows[0] as { current_position: number }).current_position);
          const outcome = now < before - 5 ? 'recovered' : now < before ? 'improved' : now > before + 5 ? 'worse' : 'flat';
          await pool.query(
            `UPDATE seo_opportunities SET outcome = $1, outcome_measured_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [outcome, opp.id, tenantId],
          );
        }
      }
    } catch (e) {
      logger.warn('[seo-digest] outcome check failed:', e instanceof Error ? e.message : String(e));
    }

    // Learning loop: "what's working" — the opportunity type with the best measured
    // track record, if any type has a trustworthy sample yet. Computed once (this
    // data isn't per-client) and appended to every client's message below.
    const successRates = await computeOpportunityTypeSuccessRates();
    const bestPerformingType = Object.entries(successRates)
      .filter(([, stats]) => stats.sampleSize >= MIN_SAMPLE_SIZE_FOR_ADJUSTMENT)
      .sort((a, b) => b[1].successRate - a[1].successRate)[0];

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
            AND tenant_id = $2
        `, [domain, tenantId]);

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
            AND last_week.tenant_id = this_week.tenant_id
          WHERE this_week.client_domain = $1 AND this_week.tenant_id = $2
          ORDER BY this_week.week_start_date DESC
          LIMIT 1
        `, [domain, tenantId]);
        const trend = trendQ.rows[0] as { total_impressions: number; total_clicks: number; impressions_delta: number } | undefined;

        // Top 3 opportunities by priority_score
        const topOpps = await pool.query(`
          SELECT opportunity_type, description, estimated_impact, priority_score, keyword
          FROM seo_opportunities
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND status = 'open'
            AND tenant_id = $2
          ORDER BY COALESCE(priority_score, 0) DESC
          LIMIT 3
        `, [domain, tenantId]);

        // Recent alerts count
        const alertCount = await pool.query(`
          SELECT COUNT(*)::int AS count FROM seo_alerts_log
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND created_at > NOW() - INTERVAL '7 days'
            AND tenant_id = $2
        `, [domain, tenantId]);

        // Open opportunities count
        const oppCount = await pool.query(`
          SELECT COUNT(*)::int AS count FROM seo_opportunities
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND status = 'open'
            AND tenant_id = $2
        `, [domain, tenantId]);

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

        // Learning loop: what's working, based on measured outcomes (omitted until
        // some opportunity type has a trustworthy sample — see MIN_SAMPLE_SIZE_FOR_ADJUSTMENT).
        if (bestPerformingType) {
          const [type, stats] = bestPerformingType;
          const pct = Math.round(stats.successRate * 100);
          lines.push(`*What's working:* ${type.replace(/_/g, '-')} opportunities have improved rank in ${pct}% of ${stats.sampleSize} measured cases — lean into these.`);
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
