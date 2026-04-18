/**
 * Outreach Funnel Metrics
 *
 * Daily snapshot of the white-label outreach funnel — lets us answer
 * "is outreach making money?" in one glance.
 *
 * Ran by a 23:55 IST worker cron (see src/worker.ts — "Outreach Funnel Snapshot").
 * Metrics captured in outreach_funnel_daily (one row per snapshot_date).
 * Discovery cost tracking is incremented during the day by the discovery + scraper
 * crons via incrementDiscoveryCost() / incrementSerperCalls().
 *
 * Exposed to the dashboard via GET /api/outreach/leads/funnel.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';

// Google Places Text Search pricing (per call, USD). Used to convert API call
// counts into cost-per-qualified-lead.
const PLACES_TEXT_SEARCH_COST_USD = 0.032;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
export async function ensureOutreachFunnelTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_funnel_daily (
      id                      SERIAL PRIMARY KEY,
      snapshot_date           DATE UNIQUE NOT NULL,
      leads_new               INTEGER DEFAULT 0,
      leads_enriched          INTEGER DEFAULT 0,
      leads_uploaded          INTEGER DEFAULT 0,
      replies_total           INTEGER DEFAULT 0,
      replies_interested      INTEGER DEFAULT 0,
      replies_not_now         INTEGER DEFAULT 0,
      replies_not_interested  INTEGER DEFAULT 0,
      replies_unsubscribe     INTEGER DEFAULT 0,
      replies_uncategorized   INTEGER DEFAULT 0,
      deals_created           INTEGER DEFAULT 0,
      discovery_api_calls     INTEGER DEFAULT 0,
      discovery_cost_usd      NUMERIC(10,4) DEFAULT 0,
      serper_api_calls        INTEGER DEFAULT 0,
      created_at              TIMESTAMP DEFAULT NOW(),
      updated_at              TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS outreach_funnel_daily_date_idx ON outreach_funnel_daily(snapshot_date DESC)`,
  ).catch(() => {});
  logger.info('[outreach-funnel] outreach_funnel_daily table ready');
}

// ---------------------------------------------------------------------------
// Upsert helpers used by worker crons during the day
// ---------------------------------------------------------------------------
async function upsertTodayRow(): Promise<void> {
  await pool.query(`
    INSERT INTO outreach_funnel_daily (snapshot_date)
    VALUES (CURRENT_DATE)
    ON CONFLICT (snapshot_date) DO NOTHING
  `);
}

/**
 * Called by the daily-discovery cron after each Google Places run.
 * Accumulates API calls + USD cost into today's row.
 */
export async function incrementDiscoveryCost(apiCalls: number): Promise<void> {
  if (apiCalls <= 0) return;
  try {
    await upsertTodayRow();
    await pool.query(
      `UPDATE outreach_funnel_daily
       SET discovery_api_calls = discovery_api_calls + $1,
           discovery_cost_usd  = discovery_cost_usd + ($1 * $2),
           updated_at          = NOW()
       WHERE snapshot_date = CURRENT_DATE`,
      [apiCalls, PLACES_TEXT_SEARCH_COST_USD],
    );
  } catch (e) {
    logger.warn(`[outreach-funnel] incrementDiscoveryCost failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Called by the directory scrapers after each Serper batch.
 */
export async function incrementSerperCalls(apiCalls: number): Promise<void> {
  if (apiCalls <= 0) return;
  try {
    await upsertTodayRow();
    await pool.query(
      `UPDATE outreach_funnel_daily
       SET serper_api_calls = serper_api_calls + $1,
           updated_at       = NOW()
       WHERE snapshot_date = CURRENT_DATE`,
      [apiCalls],
    );
  } catch (e) {
    logger.warn(`[outreach-funnel] incrementSerperCalls failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// End-of-day snapshot — called by the 23:55 IST worker cron
// ---------------------------------------------------------------------------
export interface FunnelSnapshotResult {
  date: string;
  leadsNew: number;
  leadsEnriched: number;
  leadsUploaded: number;
  repliesTotal: number;
  repliesInterested: number;
  repliesNotNow: number;
  repliesNotInterested: number;
  repliesUnsubscribe: number;
  repliesUncategorized: number;
  dealsCreated: number;
}

export async function snapshotTodaysFunnel(): Promise<FunnelSnapshotResult> {
  await upsertTodayRow();

  // Counts are "events that happened today" derived from outreach_leads timestamps.
  // leads_new:       created_at::date = today
  // leads_enriched:  status = 'Active' and enriched_at::date = today
  // leads_uploaded:  saleshandy_uploaded_at::date = today
  // replies_*:       status = 'Replied' or 'Closed' + reply_category set, updated_at::date = today
  // deals_created:   crm_deal_id set, updated_at::date = today (best-effort — CRM sync updates updated_at)
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM outreach_leads WHERE created_at::date = CURRENT_DATE) AS leads_new,
      (SELECT COUNT(*)::int FROM outreach_leads WHERE status = 'Active' AND enriched_at::date = CURRENT_DATE) AS leads_enriched,
      (SELECT COUNT(*)::int FROM outreach_leads WHERE saleshandy_uploaded_at::date = CURRENT_DATE) AS leads_uploaded,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE updated_at::date = CURRENT_DATE AND reply_category IS NOT NULL) AS replies_total,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE updated_at::date = CURRENT_DATE AND reply_category = 'INTERESTED') AS replies_interested,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE updated_at::date = CURRENT_DATE AND reply_category = 'NOT_NOW') AS replies_not_now,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE updated_at::date = CURRENT_DATE AND reply_category = 'NOT_INTERESTED') AS replies_not_interested,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE updated_at::date = CURRENT_DATE AND reply_category = 'UNSUBSCRIBE') AS replies_unsubscribe,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE updated_at::date = CURRENT_DATE AND reply_category = 'UNCATEGORIZED') AS replies_uncategorized,
      (SELECT COUNT(*)::int FROM outreach_leads
         WHERE crm_deal_id IS NOT NULL AND updated_at::date = CURRENT_DATE) AS deals_created
  `);

  const row = result.rows[0] as Record<string, number>;

  await pool.query(
    `UPDATE outreach_funnel_daily
     SET leads_new              = $1,
         leads_enriched         = $2,
         leads_uploaded         = $3,
         replies_total          = $4,
         replies_interested     = $5,
         replies_not_now        = $6,
         replies_not_interested = $7,
         replies_unsubscribe    = $8,
         replies_uncategorized  = $9,
         deals_created          = $10,
         updated_at             = NOW()
     WHERE snapshot_date = CURRENT_DATE`,
    [
      row.leads_new, row.leads_enriched, row.leads_uploaded,
      row.replies_total, row.replies_interested, row.replies_not_now,
      row.replies_not_interested, row.replies_unsubscribe, row.replies_uncategorized,
      row.deals_created,
    ],
  );

  const snapshot: FunnelSnapshotResult = {
    date: new Date().toISOString().slice(0, 10),
    leadsNew: row.leads_new,
    leadsEnriched: row.leads_enriched,
    leadsUploaded: row.leads_uploaded,
    repliesTotal: row.replies_total,
    repliesInterested: row.replies_interested,
    repliesNotNow: row.replies_not_now,
    repliesNotInterested: row.replies_not_interested,
    repliesUnsubscribe: row.replies_unsubscribe,
    repliesUncategorized: row.replies_uncategorized,
    dealsCreated: row.deals_created,
  };

  logger.info({ snapshot }, '[outreach-funnel] daily snapshot recorded');
  return snapshot;
}

// ---------------------------------------------------------------------------
// Read API for the dashboard
// ---------------------------------------------------------------------------
export interface FunnelDailyRow {
  snapshot_date: string;
  leads_new: number;
  leads_enriched: number;
  leads_uploaded: number;
  replies_total: number;
  replies_interested: number;
  replies_not_now: number;
  replies_not_interested: number;
  replies_unsubscribe: number;
  replies_uncategorized: number;
  deals_created: number;
  discovery_api_calls: number;
  discovery_cost_usd: number;
  serper_api_calls: number;
}

export interface FunnelSummary {
  days: number;
  totals: {
    leadsNew: number;
    leadsEnriched: number;
    leadsUploaded: number;
    repliesTotal: number;
    repliesInterested: number;
    repliesNotNow: number;
    repliesNotInterested: number;
    repliesUnsubscribe: number;
    dealsCreated: number;
    discoveryCostUsd: number;
    discoveryApiCalls: number;
    serperApiCalls: number;
  };
  rates: {
    // All expressed as percentages 0–100 (rounded to 2 dp).
    replyRate: number;           // repliesTotal / leadsUploaded
    interestedRate: number;      // repliesInterested / repliesTotal
    enrichmentRate: number;      // leadsEnriched / leadsNew
    unsubscribeRate: number;     // repliesUnsubscribe / repliesTotal
  };
  costs: {
    costPerEnrichedLead: number;   // USD
    costPerInterestedReply: number;
  };
  daily: FunnelDailyRow[];
}

export async function getFunnelSummary(days = 30): Promise<FunnelSummary> {
  const clampedDays = Math.min(Math.max(Math.floor(days), 1), 180);

  const result = await pool.query(
    `SELECT snapshot_date, leads_new, leads_enriched, leads_uploaded,
            replies_total, replies_interested, replies_not_now,
            replies_not_interested, replies_unsubscribe, replies_uncategorized,
            deals_created, discovery_api_calls, discovery_cost_usd, serper_api_calls
     FROM outreach_funnel_daily
     WHERE snapshot_date >= CURRENT_DATE - ($1::int - 1)
     ORDER BY snapshot_date ASC`,
    [clampedDays],
  );

  const daily = (result.rows as Array<Record<string, string | number>>).map((r) => ({
    snapshot_date: typeof r.snapshot_date === 'string'
      ? r.snapshot_date
      : new Date(r.snapshot_date as unknown as string).toISOString().slice(0, 10),
    leads_new: Number(r.leads_new) || 0,
    leads_enriched: Number(r.leads_enriched) || 0,
    leads_uploaded: Number(r.leads_uploaded) || 0,
    replies_total: Number(r.replies_total) || 0,
    replies_interested: Number(r.replies_interested) || 0,
    replies_not_now: Number(r.replies_not_now) || 0,
    replies_not_interested: Number(r.replies_not_interested) || 0,
    replies_unsubscribe: Number(r.replies_unsubscribe) || 0,
    replies_uncategorized: Number(r.replies_uncategorized) || 0,
    deals_created: Number(r.deals_created) || 0,
    discovery_api_calls: Number(r.discovery_api_calls) || 0,
    discovery_cost_usd: Number(r.discovery_cost_usd) || 0,
    serper_api_calls: Number(r.serper_api_calls) || 0,
  })) as FunnelDailyRow[];

  const totals = daily.reduce(
    (a, d) => ({
      leadsNew: a.leadsNew + d.leads_new,
      leadsEnriched: a.leadsEnriched + d.leads_enriched,
      leadsUploaded: a.leadsUploaded + d.leads_uploaded,
      repliesTotal: a.repliesTotal + d.replies_total,
      repliesInterested: a.repliesInterested + d.replies_interested,
      repliesNotNow: a.repliesNotNow + d.replies_not_now,
      repliesNotInterested: a.repliesNotInterested + d.replies_not_interested,
      repliesUnsubscribe: a.repliesUnsubscribe + d.replies_unsubscribe,
      dealsCreated: a.dealsCreated + d.deals_created,
      discoveryCostUsd: a.discoveryCostUsd + d.discovery_cost_usd,
      discoveryApiCalls: a.discoveryApiCalls + d.discovery_api_calls,
      serperApiCalls: a.serperApiCalls + d.serper_api_calls,
    }),
    {
      leadsNew: 0, leadsEnriched: 0, leadsUploaded: 0,
      repliesTotal: 0, repliesInterested: 0, repliesNotNow: 0,
      repliesNotInterested: 0, repliesUnsubscribe: 0, dealsCreated: 0,
      discoveryCostUsd: 0, discoveryApiCalls: 0, serperApiCalls: 0,
    },
  );

  const pct = (numerator: number, denominator: number): number =>
    denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;
  const usd = (numerator: number, denominator: number): number =>
    denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;

  return {
    days: clampedDays,
    totals: {
      ...totals,
      discoveryCostUsd: Math.round(totals.discoveryCostUsd * 10000) / 10000,
    },
    rates: {
      replyRate: pct(totals.repliesTotal, totals.leadsUploaded),
      interestedRate: pct(totals.repliesInterested, totals.repliesTotal),
      enrichmentRate: pct(totals.leadsEnriched, totals.leadsNew),
      unsubscribeRate: pct(totals.repliesUnsubscribe, totals.repliesTotal),
    },
    costs: {
      costPerEnrichedLead: usd(totals.discoveryCostUsd, totals.leadsEnriched),
      costPerInterestedReply: usd(totals.discoveryCostUsd, totals.repliesInterested),
    },
    daily,
  };
}
