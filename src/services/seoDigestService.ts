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
//
// TENANT ISOLATION + CROSS-TENANT PRIORS — deliberate product decision, not
// a bug. A tenant's own measured outcomes are ALWAYS scoped by tenant_id in
// computeOpportunityTypeSuccessRates() below — that predicate is
// non-negotiable. Separately, and ONLY to fill the gap while a tenant's own
// sample is below MIN_SAMPLE_SIZE_FOR_ADJUSTMENT, that function blends in a
// "platform prior": the same success-rate computation run across every
// OTHER active tenant that has not opted out. This is intentional
// network-wide learning ("shared by default") so a brand-new reseller
// client gets a useful prioritization signal from day one instead of having
// no signal at all for months while it accumulates its own 10+ measured
// outcomes. Opt-out is per tenant via `tenants.settings.seo.contributePriors
// === false`; absent is opted-in, matching the shared-by-default decision.
//
// Practically: a reseller's SEO learning-loop numbers can, by default, be
// influenced by other tenants' aggregate (never row-level) outcome data.
// THIS MUST BE DISCLOSED in the reseller contract/ToS — a future reader who
// doesn't know this is deliberate will otherwise correctly flag it as a
// tenant-isolation bug. If the disclosure requirement ever changes, flip the
// `includePlatformPriors` default below rather than removing the mechanism.
// ---------------------------------------------------------------------------
export interface OpportunityTypeSuccessStats {
  successRate: number; // 0..1
  sampleSize: number;
}

const SUCCESSFUL_OUTCOMES = ['recovered', 'improved'];

// Below this many measured outcomes for a given opportunity_type, a tenant's
// OWN data isn't trusted enough to move prioritization alone — see the
// blending rule in computeOpportunityTypeSuccessRates() below, and the
// no-op guard in applySuccessRateAdjustment() further down.
const MIN_SAMPLE_SIZE_FOR_ADJUSTMENT = 10;

// Whether a tenant has opted OUT of contributing its outcomes to other
// tenants' platform-wide priors. Mirrors tenantFeatures.ts's defensive
// narrowing of the `settings` jsonb column (typeof/array checks, never a
// blind cast) so malformed or absent settings never throw — they just
// resolve to the shared-by-default outcome (opted in).
function tenantOptedIntoPriors(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true;
  const seo = (settings as Record<string, unknown>).seo;
  if (!seo || typeof seo !== 'object' || Array.isArray(seo)) return true;
  return (seo as Record<string, unknown>).contributePriors !== false;
}

/**
 * Tenant-scoped historical success rates per opportunity_type, optionally
 * blended with an opt-out-able platform-wide prior when the tenant's own
 * sample is too small to trust yet. See the big comment block above this
 * function for why cross-tenant blending exists and the disclosure
 * requirement it carries.
 *
 * `tenantId` defaults to resolveDefaultSeoTenantId() when omitted. That
 * default exists ONLY so call sites that haven't been threaded yet keep
 * compiling and keep behaving the same as before (scoped to the single SEO
 * tenant that exists in production today) rather than the pre-fix behaviour
 * of aggregating across every tenant. As of this change, competitorContentService.ts's
 * two call sites (runCompetitorContentAnalysis, analyzeCompetitorContent)
 * now pass their own resolved tenantId explicitly. Still calling with zero
 * args: seoContentGapService.ts:86, contentGenerationService.ts:166 and :295,
 * seoContentDecayService.ts:40 — those are out of this lane's scope. The
 * optional default is a transitional safety net, not the intended long-term
 * shape (see PR notes / report for this change).
 */
export async function computeOpportunityTypeSuccessRates(
  tenantId?: string,
  opts: { includePlatformPriors?: boolean } = {},
): Promise<Record<string, OpportunityTypeSuccessStats>> {
  const includePlatformPriors = opts.includePlatformPriors ?? true;
  try {
    const resolvedTenantId = tenantId ?? await resolveDefaultSeoTenantId();

    // The tenant's own outcomes — always scoped, non-negotiable.
    const ownResult = await pool.query(`
      SELECT
        opportunity_type,
        COUNT(*)::int AS sample_size,
        COUNT(*) FILTER (WHERE outcome = ANY($1::text[]))::int AS successes
      FROM seo_opportunities
      WHERE outcome IS NOT NULL AND opportunity_type IS NOT NULL AND tenant_id = $2
      GROUP BY opportunity_type
    `, [SUCCESSFUL_OUTCOMES, resolvedTenantId]);

    const own: Record<string, OpportunityTypeSuccessStats> = {};
    for (const row of ownResult.rows as Array<{ opportunity_type: string; sample_size: number; successes: number }>) {
      const sampleSize = Number(row.sample_size);
      own[row.opportunity_type] = {
        successRate: sampleSize > 0 ? Number(row.successes) / sampleSize : 0,
        sampleSize,
      };
    }

    if (!includePlatformPriors) return own;

    // Platform-wide prior: the same aggregation, run across every OTHER
    // active tenant that has not opted out. Isolated in its own try/catch so
    // a failure here degrades to "tenant-own data only" instead of losing
    // the (already-successful) own-tenant numbers above.
    let priors: Record<string, OpportunityTypeSuccessStats> = {};
    try {
      const tenantRows = await pool.query(`SELECT id, settings FROM tenants WHERE is_active = true`);
      const eligibleTenantIds = (tenantRows.rows as Array<{ id: string; settings: unknown }>)
        .filter((t) => t.id !== resolvedTenantId && tenantOptedIntoPriors(t.settings))
        .map((t) => t.id);

      if (eligibleTenantIds.length > 0) {
        const priorResult = await pool.query(`
          SELECT
            opportunity_type,
            COUNT(*)::int AS sample_size,
            COUNT(*) FILTER (WHERE outcome = ANY($1::text[]))::int AS successes
          FROM seo_opportunities
          WHERE outcome IS NOT NULL AND opportunity_type IS NOT NULL AND tenant_id = ANY($2::uuid[])
          GROUP BY opportunity_type
        `, [SUCCESSFUL_OUTCOMES, eligibleTenantIds]);

        for (const row of priorResult.rows as Array<{ opportunity_type: string; sample_size: number; successes: number }>) {
          const sampleSize = Number(row.sample_size);
          priors[row.opportunity_type] = {
            successRate: sampleSize > 0 ? Number(row.successes) / sampleSize : 0,
            sampleSize,
          };
        }
      }
    } catch (priorErr) {
      logger.warn('[seo-digest] platform-prior computation failed, falling back to tenant-own data:', priorErr instanceof Error ? priorErr.message : String(priorErr));
      priors = {};
    }

    // Blend rule (deliberately simple — a reader must be able to tell where
    // a number came from just by looking at it):
    //   weight_own = ownSampleSize / MIN_SAMPLE_SIZE_FOR_ADJUSTMENT (capped
    //     implicitly below 1 by the branch guard, since this only runs when
    //     ownSampleSize < MIN_SAMPLE_SIZE_FOR_ADJUSTMENT)
    //   blendedRate = weight_own * ownRate + (1 - weight_own) * priorRate
    //   blendedSampleSize = ownSampleSize + priorSampleSize
    // So the tenant's own data linearly dominates as its sample grows toward
    // the threshold (at the threshold, own data is used unblended — see the
    // guard below), and the reported sampleSize is always the honest total
    // evidence behind the number (own + borrowed), never inflated or hidden.
    const allTypes = new Set([...Object.keys(own), ...Object.keys(priors)]);
    const blended: Record<string, OpportunityTypeSuccessStats> = {};
    for (const type of allTypes) {
      const o = own[type] ?? { successRate: 0, sampleSize: 0 };
      const p = priors[type];
      if (o.sampleSize >= MIN_SAMPLE_SIZE_FOR_ADJUSTMENT || !p || p.sampleSize === 0) {
        blended[type] = o;
        continue;
      }
      const weightOwn = o.sampleSize / MIN_SAMPLE_SIZE_FOR_ADJUSTMENT;
      blended[type] = {
        successRate: weightOwn * o.successRate + (1 - weightOwn) * p.successRate,
        sampleSize: o.sampleSize + p.sampleSize,
      };
    }
    return blended;
  } catch (e) {
    logger.warn('[seo-digest] computeOpportunityTypeSuccessRates failed:', e instanceof Error ? e.message : String(e));
    return {};
  }
}

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

export async function sendWeeklyOpportunityDigest(tenantId?: string): Promise<{ sent: boolean }> {
  try {
    const { sendSlackMessage } = await import('./slackService');
    const { SLACK_SEO_CHANNEL } = await import('../config/constants');
    const tid = tenantId ?? await resolveDefaultSeoTenantId();

    // Every client this digest reports on comes from this tenant's registered
    // SEO sites (seoSiteRegistry.ts) — never a hardcoded domain list. A
    // hardcoded array here would, the day a second tenant is onboarded, show
    // that tenant GE's own client roster (or vice versa) instead of failing loud.
    const { listSeoSiteDomains } = await import('./seoSiteRegistry');
    const CLIENT_DOMAINS = await listSeoSiteDomains(tid);
    if (CLIENT_DOMAINS.length === 0) {
      logger.warn(`[seo-digest] tenant ${tid} has no registered SEO sites — nothing to digest`);
      return { sent: false };
    }

    // Label every message with the tenant this run covers. SLACK_SEO_CHANNEL
    // is a single shared constant (not tenant-scoped) — once a second tenant
    // starts running this digest, both tenants' messages land in the same
    // channel, so the label is the only thing that keeps them distinguishable.
    // See report for this change: a real per-tenant channel needs a
    // tenants.settings-driven override, which is a schema-adjacent decision
    // out of this lane's scope.
    let tenantLabel = tid;
    try {
      const tenantRow = await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [tid]);
      if (tenantRow.rows.length > 0) tenantLabel = (tenantRow.rows[0] as { slug: string }).slug;
    } catch { /* fall back to raw tenantId */ }

    // Pre-flight: if every upstream source is empty, don't send a hollow digest
    // that makes the team think "no news is good news". Send a single health-alert
    // to #seo instead so the broken pipeline gets fixed.
    const upstreamQ = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM seo_opportunities WHERE status = 'open' AND tenant_id = $1)::int AS open_opps,
        (SELECT COUNT(*) FROM seo_alerts_log WHERE created_at > NOW() - INTERVAL '7 days' AND tenant_id = $1)::int AS recent_alerts,
        (SELECT COUNT(*) FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - INTERVAL '10 days' AND tenant_id = $1)::int AS rankings
    `, [tid]);
    const { open_opps, recent_alerts, rankings } = upstreamQ.rows[0] as { open_opps: number; recent_alerts: number; rankings: number };
    if (Number(open_opps) === 0 && Number(recent_alerts) === 0 && Number(rankings) === 0) {
      const msg = `seo-digest [${tenantLabel}]: skipped — seo_opportunities, seo_alerts_log, and keyword_rankings all empty. Upstream SEO crons are broken, check Railway worker logs and SERPER_API_KEY.`;
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
      `, [tid]);
      for (const opp of unmeasured.rows as Array<{ id: string; client_domain: string; keyword: string; created_at: string }>) {
        if (!opp.keyword) continue;
        const rankNow = await pool.query(
          `SELECT current_position FROM keyword_rankings
           WHERE (client_domain = $1 OR project_name = $1) AND keyword = $2 AND tenant_id = $3
           ORDER BY recorded_date DESC LIMIT 1`,
          [opp.client_domain, opp.keyword, tid],
        );
        const rankAtCreation = await pool.query(
          `SELECT current_position FROM keyword_rankings
           WHERE (client_domain = $1 OR project_name = $1) AND keyword = $2
             AND recorded_date <= $3::date
             AND tenant_id = $4
           ORDER BY recorded_date DESC LIMIT 1`,
          [opp.client_domain, opp.keyword, opp.created_at, tid],
        );
        if (rankNow.rows.length > 0 && rankAtCreation.rows.length > 0) {
          const now = Number((rankNow.rows[0] as { current_position: number }).current_position);
          const before = Number((rankAtCreation.rows[0] as { current_position: number }).current_position);
          const outcome = now < before - 5 ? 'recovered' : now < before ? 'improved' : now > before + 5 ? 'worse' : 'flat';
          await pool.query(
            `UPDATE seo_opportunities SET outcome = $1, outcome_measured_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [outcome, opp.id, tid],
          );
        }
      }
    } catch (e) {
      logger.warn('[seo-digest] outcome check failed:', e instanceof Error ? e.message : String(e));
    }

    // Learning loop: "what's working" — the opportunity type with the best measured
    // track record, if any type has a trustworthy sample yet. Computed once per
    // tenant (this data isn't per client-domain within a tenant) and appended to
    // every client's message below.
    const successRates = await computeOpportunityTypeSuccessRates(tid);
    const bestPerformingType = Object.entries(successRates)
      .filter(([, stats]) => stats.sampleSize >= MIN_SAMPLE_SIZE_FOR_ADJUSTMENT)
      .sort((a, b) => b[1].successRate - a[1].successRate)[0];

    // Per-client digest — CLIENT_DOMAINS above is already this tenant's
    // registered site list, sourced from seoSiteRegistry.
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
        `, [domain, tid]);

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
        `, [domain, tid]);
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
        `, [domain, tid]);

        // Recent alerts count
        const alertCount = await pool.query(`
          SELECT COUNT(*)::int AS count FROM seo_alerts_log
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND created_at > NOW() - INTERVAL '7 days'
            AND tenant_id = $2
        `, [domain, tid]);

        // Open opportunities count
        const oppCount = await pool.query(`
          SELECT COUNT(*)::int AS count FROM seo_opportunities
          WHERE (client_domain = $1 OR project_name ILIKE '%' || split_part($1, '.', 1) || '%')
            AND status = 'open'
            AND tenant_id = $2
        `, [domain, tid]);

        const clientName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
        const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        // tenantLabel names which tenant this snapshot belongs to — see the
        // shared-channel note above resolveDefaultSeoTenantId's call site.
        const lines: string[] = [
          `*📊 ${clientName} (${domain}) — SEO Weekly Snapshot*`,
          `_${dateStr} · tenant: ${tenantLabel}_`,
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
      `_[${tenantLabel}] Weekly SEO digest sent: ${clientSummaries.join(', ')}_`
    ).catch(() => null);

    logger.info(`[seo-digest] weekly digest sent for tenant ${tenantLabel}, clients: ${clientSummaries.join(', ')}`);
    return { sent: true };
  } catch (e) {
    logger.error('[seo-digest] error:', e instanceof Error ? e.message : String(e));
    return { sent: false };
  }
}
