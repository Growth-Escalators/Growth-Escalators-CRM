/**
 * Impure half of the SEO cost guard: the DB-touching usage fetch, the usage
 * writer, and a per-site advisory lock — split into its own file so that
 * `seoCostGuard.ts` stays pure/no-I/O (see the "INTENTIONALLY MISSING" note
 * at the top of that file). This is the same pure/impure split
 * `wizmatchCostGuard.ts` (pure) / `wizmatchSourcing.ts`'s
 * `fetchWizmatchCostGuardUsage`+`withWizmatchSourceLock` (impure) already
 * use in this repo — this file is modelled directly on those.
 *
 * Backing table: `seo_api_usage` (migration 0049, see `src/db/schema.ts`).
 * One row per billable call, tenant_id/site_id/provider/operation/calls/
 * cost_cents/created_at — deliberately append-only (see the schema comment)
 * rather than a running counter, so this file has to aggregate on read.
 */
import { pool } from '../db/index';
import logger from '../utils/logger';
import {
  emptySeoCostGuardUsage,
  evaluateSeoCostGuard,
  type SeoCostGuardConfig,
  type SeoCostGuardEstimatedCalls,
  type SeoCostGuardEvaluation,
  type SeoCostGuardPlanLimits,
  type SeoCostGuardProviderEnvStatus,
  type SeoCostGuardUsage,
} from './seoCostGuard';

// ---------------------------------------------------------------------------
// Timezone boundary for "day" and "month" caps
// ---------------------------------------------------------------------------
// Growth Escalators operates in IST (UTC+5:30, no DST). A UTC day boundary
// would reset a tenant's daily cap at 05:30 IST — mid-morning local time —
// which doesn't line up with any calendar boundary an agency watching their
// usage actually experiences, and it moves the monthly reset off the 1st in
// local terms too. So both boundaries below are computed as IST midnight,
// converted back to the UTC instant Postgres will compare `created_at`
// against.
//
// IST's offset is fixed (+5:30, India does not observe DST), so this is a
// deterministic arithmetic shift — no timezone database or Intl API needed:
// shift `now` forward by the offset, read the UTC calendar fields off that
// shifted instant (which now equal the IST wall-clock date), floor to the
// day/month boundary in that frame, then shift back by the same offset to
// get the real UTC instant that boundary corresponds to.
//
// `wizmatchCostGuard.ts`'s `sameDayStart`/`sameMonthStart` use the process's
// local time instead of doing this — acceptable there because that guard's
// caps aren't shown on a customer-facing usage dashboard. This guard's caps
// are meant to be quotable/explainable to an agency, so the boundary is
// pinned to IST explicitly rather than inherited from whatever TZ the
// Railway service happens to be running under.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const dayStartShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(dayStartShifted - IST_OFFSET_MS);
}

function istMonthStart(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const monthStartShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1);
  return new Date(monthStartShifted - IST_OFFSET_MS);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Mirrors wizmatchCostGuard's isMissingOptionalCostGuardTable: the
// seo_api_usage table is created by a migration that runs on boot, so a
// process that queries it before that migration has landed (a fresh deploy,
// a worker that races ahead of the migration step) must degrade to "no
// usage yet" rather than throw and take the guarded operation down with it.
function isMissingSeoApiUsageTable(error: unknown): boolean {
  const pgError = error as { code?: string; message?: string } | null;
  if (!pgError) return false;
  return pgError.code === '42P01'
    || /relation "seo_api_usage" does not exist/i.test(pgError.message || '');
}

/**
 * Fetches all eight `SeoCostGuardUsage` fields in one round trip via
 * `SUM(...) FILTER (WHERE ...)` over a single tenant-scoped, month-bounded
 * read of `seo_api_usage`. Eight separate queries per guarded call would
 * make the guard itself cost more (in DB round trips, under load) than the
 * operation it's guarding — the whole point of a cost guard is to be cheap
 * to consult.
 *
 * `siteId` may be null (tenant-level operations, e.g. a GSC token refresh
 * that isn't attributable to one site — see the schema comment on
 * `seo_api_usage.site_id`). When it's null, `site_id = $4::uuid` compares
 * every row's site_id against a NULL parameter, which SQL evaluates as
 * UNKNOWN for every row; a FILTER treats UNKNOWN as "exclude", so the
 * site-scoped sums simply see zero matching rows and COALESCE to 0. No
 * separate branch needed to avoid a broken predicate.
 */
export async function fetchSeoCostGuardUsage(
  tenantId: string,
  siteId: string | null,
  now: Date = new Date(),
): Promise<SeoCostGuardUsage> {
  const monthStart = istMonthStart(now);
  const dayStart = istDayStart(now);

  let result: {
    rows: Array<{
      month_cost_cents: unknown;
      day_cost_cents: unknown;
      tenant_day_serper_calls: unknown;
      site_day_serper_calls: unknown;
      tenant_day_pagespeed_calls: unknown;
      tenant_day_gsc_calls: unknown;
      tenant_day_ga4_calls: unknown;
      site_day_publishes: unknown;
    }>;
  };
  try {
    result = await pool.query(
      `SELECT
         COALESCE(SUM(cost_cents), 0) AS month_cost_cents,
         COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= $3::timestamptz), 0) AS day_cost_cents,
         COALESCE(SUM(calls) FILTER (WHERE created_at >= $3::timestamptz AND provider = 'serper'), 0) AS tenant_day_serper_calls,
         COALESCE(SUM(calls) FILTER (WHERE created_at >= $3::timestamptz AND provider = 'serper' AND site_id = $4::uuid), 0) AS site_day_serper_calls,
         COALESCE(SUM(calls) FILTER (WHERE created_at >= $3::timestamptz AND provider = 'pagespeed'), 0) AS tenant_day_pagespeed_calls,
         COALESCE(SUM(calls) FILTER (WHERE created_at >= $3::timestamptz AND provider = 'gsc'), 0) AS tenant_day_gsc_calls,
         COALESCE(SUM(calls) FILTER (WHERE created_at >= $3::timestamptz AND provider = 'ga4'), 0) AS tenant_day_ga4_calls,
         COALESCE(SUM(calls) FILTER (WHERE created_at >= $3::timestamptz AND provider = 'publish' AND site_id = $4::uuid), 0) AS site_day_publishes
       FROM seo_api_usage
       WHERE tenant_id = $1::uuid AND created_at >= $2::timestamptz`,
      [tenantId, monthStart, dayStart, siteId],
    );
  } catch (error) {
    if (!isMissingSeoApiUsageTable(error)) throw error;
    return emptySeoCostGuardUsage();
  }

  const row = result.rows[0];
  if (!row) return emptySeoCostGuardUsage();

  return {
    monthCostCents: num(row.month_cost_cents),
    dayCostCents: num(row.day_cost_cents),
    tenantDaySerperCalls: num(row.tenant_day_serper_calls),
    siteDaySerperCalls: num(row.site_day_serper_calls),
    tenantDayPagespeedCalls: num(row.tenant_day_pagespeed_calls),
    tenantDayGscCalls: num(row.tenant_day_gsc_calls),
    tenantDayGa4Calls: num(row.tenant_day_ga4_calls),
    siteDayPublishes: num(row.site_day_publishes),
  };
}

/**
 * Appends one row of recorded spend. Must never throw: the provider call
 * this is recording has already happened and already cost money by the time
 * this runs, so a DB hiccup here (including the same "table not migrated
 * yet" case `fetchSeoCostGuardUsage` degrades on) must not fail the request
 * that already spent it — that would be strictly worse than an under-counted
 * cap, because it throws away a successful result on top of losing the
 * accounting for it.
 */
export async function recordSeoApiUsage(entry: {
  tenantId: string;
  siteId?: string | null;
  provider: string;
  operation: string;
  calls?: number;
  costCents?: number;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO seo_api_usage (tenant_id, site_id, provider, operation, calls, cost_cents)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
      [
        entry.tenantId,
        entry.siteId ?? null,
        entry.provider,
        entry.operation,
        Math.max(1, Math.floor(entry.calls ?? 1)),
        // Integer cents, never a float — money in floating point accumulates
        // error exactly where a cap is supposed to be exact.
        Math.max(0, Math.floor(entry.costCents ?? 0)),
      ],
    );
  } catch (error) {
    logger.error(
      { err: error, tenantId: entry.tenantId, siteId: entry.siteId ?? null, provider: entry.provider, operation: entry.operation },
      '[seoCostGuardUsage] failed to record SEO API usage — swallowing so the already-completed operation is not failed by an accounting write',
    );
  }
}

/**
 * Serializes SEO spend for one (tenant, site, key) so two concurrent callers
 * cannot both read "under the cap" from `fetchSeoCostGuardUsage`, both pass
 * `evaluateSeoCostGuard`, and both spend — the classic check-then-spend race.
 * Copied verbatim in shape from `withWizmatchSourceLock`
 * (`src/services/wizmatchSourcing.ts`): a non-blocking Postgres advisory
 * lock keyed by `hashtext()` of a string, held only for the duration of
 * `run()`, released in a `finally` so a throwing `run()` can't leak it.
 * Returns `null` (rather than blocking) when the lock is already held, so a
 * concurrent caller gets a clear "busy" signal instead of queueing.
 *
 * The lock key is prefixed `seo-site:` — distinct from wizmatch's
 * `wizmatch-source:` prefix — so the two guards' advisory locks can never
 * collide even though both hash through the same `hashtext()` keyspace.
 */
export async function withSeoSiteLock<T>(
  tenantId: string,
  siteId: string,
  key: string,
  run: () => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  const lockKey = `seo-site:${tenantId}:${siteId}:${key}`;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
    if (!lock.rows[0]?.locked) return null;
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
    }
  } finally {
    client.release();
  }
}

/** Thrown by `guardSeoSpend` when `evaluateSeoCostGuard` blocks the operation. Callers that want the block reason/HTTP status can read `.evaluation`. */
export class SeoCostGuardBlockedError extends Error {
  constructor(public readonly evaluation: SeoCostGuardEvaluation) {
    super(evaluation.blockReasons.join(' ') || 'SEO cost guard blocked this operation');
    this.name = 'SeoCostGuardBlockedError';
  }
}

/**
 * Thin composition of fetch -> evaluate -> caller's work -> record, for
 * call sites that want the whole guarded flow in one call instead of wiring
 * the pieces themselves. Optional — the four exports above are sufficient
 * on their own, and a caller with unusual needs (e.g. recording under a
 * provider label this function doesn't know about) should just call them
 * directly instead of fighting this wrapper.
 *
 * Deliberately does NOT take the advisory lock itself — locking is a
 * call-site decision (not every guarded operation is racy enough to need
 * one, and the lock key namespacing is caller-specific); wrap a call to this
 * in `withSeoSiteLock` when that's needed.
 */
export async function guardSeoSpend<T>(input: {
  tenantId: string;
  siteId: string;
  operation: string;
  estimate: SeoCostGuardEstimatedCalls;
  providerEnv: SeoCostGuardProviderEnvStatus;
  sitePaused?: boolean;
  planLimits?: SeoCostGuardPlanLimits;
  config?: SeoCostGuardConfig;
  now?: Date;
  run: () => Promise<T>;
}): Promise<{ evaluation: SeoCostGuardEvaluation; result: T }> {
  const now = input.now || new Date();
  const usage = await fetchSeoCostGuardUsage(input.tenantId, input.siteId, now);
  const evaluation = evaluateSeoCostGuard({
    tenantId: input.tenantId,
    siteId: input.siteId,
    operation: input.operation,
    estimate: input.estimate,
    usage,
    providerEnv: input.providerEnv,
    sitePaused: input.sitePaused,
    planLimits: input.planLimits,
    config: input.config,
    now,
  });
  if (!evaluation.allowed) {
    throw new SeoCostGuardBlockedError(evaluation);
  }

  const result = await input.run();

  // Record actual spend AFTER the work succeeds — recording an estimate
  // before running would overcount on failure, and recording is best-effort
  // (recordSeoApiUsage never throws) so it can't roll the already-succeeded
  // result back either way. gscCalls/ga4Calls/publishes carry no direct
  // provider cost of their own (see calculateSeoCostGuardCostCents's
  // comment) but are still recorded so their day-scoped caps stay accurate.
  const config = evaluation.policy;
  const entries: Array<{ provider: string; calls: number; costCents: number }> = [
    { provider: 'serper', calls: input.estimate.serperCalls, costCents: input.estimate.serperCalls * config.providerCostCents.serper },
    { provider: 'pagespeed', calls: input.estimate.pagespeedCalls, costCents: input.estimate.pagespeedCalls * config.providerCostCents.pagespeed },
    { provider: 'llm', calls: input.estimate.llmCalls, costCents: input.estimate.llmCalls * config.providerCostCents.llm },
    { provider: 'gsc', calls: input.estimate.gscCalls, costCents: 0 },
    { provider: 'ga4', calls: input.estimate.ga4Calls, costCents: 0 },
    { provider: 'publish', calls: input.estimate.publishes, costCents: 0 },
  ];
  for (const entry of entries) {
    if (entry.calls > 0) {
      await recordSeoApiUsage({
        tenantId: input.tenantId,
        siteId: input.siteId,
        provider: entry.provider,
        operation: input.operation,
        calls: entry.calls,
        costCents: entry.costCents,
      });
    }
  }

  return { evaluation, result };
}
