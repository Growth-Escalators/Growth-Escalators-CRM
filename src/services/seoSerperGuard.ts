/**
 * `guardedSerperCall` — the one place all four Serper.dev call sites
 * (rankTrackingService, seoBacklinkService, seoContentGapService,
 * competitorContentService) route through, so the guard-around-a-call
 * sequence (fetch usage -> evaluate -> run or skip -> record) is written
 * once instead of once per service. Wires the pure `evaluateSeoCostGuard`
 * (seoCostGuard.ts) together with the impure usage store
 * (seoCostGuardUsage.ts) that another lane built, replacing the old global,
 * in-memory, process-lifetime `checkAndIncrementSeoSerperCap`
 * (seoWorkflowHealthService.ts) at these four call sites — see that
 * function's doc for why a shared global counter can't survive the product
 * going multi-tenant. `checkAndIncrementSeoSerperCap` itself is left
 * untouched; it is not deleted here (still referenced from comments in
 * worker.ts/featureFlags.ts — a separate cleanup).
 *
 * This deliberately does NOT reuse `seoCostGuardUsage.ts`'s `guardSeoSpend`.
 * That helper throws `SeoCostGuardBlockedError` on a block and only records
 * spend after its `run()` succeeds — the right contract for a route handler
 * that wants a catchable exception and treats "run() didn't finish" as "it
 * didn't cost anything", but wrong on both counts for these four cron-driven
 * services: they run unattended and must complete and report a capped run
 * rather than abort it (see each site's existing skip-and-continue loop over
 * keywords/domains), and a guarded `run()` here is a Serper HTTP call that
 * bills on send, not on success — see the first design note below for how
 * this file tells those two apart. So `guardedSerperCall` is built directly
 * on `seoCostGuard.ts`'s `evaluateSeoCostGuard` and `seoCostGuardUsage.ts`'s
 * `fetchSeoCostGuardUsage`/`recordSeoApiUsage` instead of on `guardSeoSpend`
 * — that file's own docblock names this as the expected path for a caller
 * whose needs don't fit its wrapper.
 *
 * Design choices, spelled out because they are not obvious from the code:
 *
 * - RECORD ON "THE REQUEST LEFT", NOT ON "run() SUCCEEDED": Serper bills the
 *   HTTP request, not the outcome — a non-OK response or a JSON-parsing
 *   failure afterwards still cost money; a `run()` that throws before ever
 *   calling `fetch()` (bad input building the query, a bug) cost nothing and
 *   recording it would be a pure overcount with no spend behind it.
 *   `guardedSerperCall` cannot see inside an opaque `run()` to tell these
 *   apart on its own, so `run` is handed a `markSpent()` callback and is
 *   responsible for calling it the instant `fetch()` resolves to a Response
 *   — before checking `.ok`, before parsing the body. Spend is then recorded
 *   iff `markSpent()` was called, regardless of whether `run()` goes on to
 *   resolve or throw. (Every current call site already isolates its
 *   `fetch()` in its own try/catch and converts expected failures — non-OK,
 *   network error — into a sentinel return rather than a throw; `markSpent()`
 *   still needs to be called eagerly right after `fetch()` because a
 *   `run()` throw is possible afterwards too, e.g. `res.json()` failing.)
 *
 * - NEVER THROWS: every guard-side failure — a DB error evaluating the cap,
 *   or `run()` itself throwing — resolves to `onBlocked()`, never a thrown
 *   error. These are cron paths; turning a broken guard into an unhandled
 *   rejection would take an entire scheduled run down over what should be,
 *   at worst, one skipped Serper call. This is intentionally fail-CLOSED: an
 *   evaluation the guard couldn't complete is treated as "no", not "yes" —
 *   spending on a guard we couldn't consult would defeat the point of having
 *   one.
 *
 * - PROVIDER-ENV NOT CHECKED HERE: `evaluateSeoCostGuard` can also block on
 *   `provider_config_missing`, but every current call site already checks
 *   `SERPER_API_KEY` and returns before ever reaching this guard (see
 *   rankTrackingService.ts / seoBacklinkService.ts / seoContentGapService.ts
 *   / competitorContentService.ts). `providerEnv.missing` is therefore always
 *   passed as `[]` here — this guard is purely a spend cap, not a credential
 *   check, and never logs `SERPER_API_KEY` or any other credential.
 *
 * - SITE-PAUSED NOT CHECKED HERE: `evaluateSeoCostGuard` also supports
 *   `sitePaused`, but honouring it would need a second DB read (the full
 *   `SeoSite` row, not just its id, since only the id is threaded through
 *   here). None of the four call sites asked for that, so `sitePaused` is
 *   left at its default (falsy) — a paused site still gets tenant/site
 *   Serper-cap enforcement today, just not an immediate hard stop. Flagging
 *   this as a gap for whichever lane owns site pausing.
 */

import logger from '../utils/logger';
import { evaluateSeoCostGuard, type SeoCostGuardEstimatedCalls, type SeoCostGuardEvaluation } from './seoCostGuard';
import { fetchSeoCostGuardUsage, recordSeoApiUsage } from './seoCostGuardUsage';
import { getSeoSiteByDomain } from './seoSiteRegistry';

// A guarded call always represents exactly one Serper search — none of the
// four call sites batch multiple queries into a single HTTP call.
const SERPER_CALL_ESTIMATE: SeoCostGuardEstimatedCalls = {
  serperCalls: 1,
  pagespeedCalls: 0,
  llmCalls: 0,
  gscCalls: 0,
  publishes: 0,
};

export interface GuardedSerperCallCtx {
  tenantId: string;
  /**
   * Null/undefined when no SEO site could be resolved for this call (a
   * project-name "domain" with no dot, a domain not yet registered, or a
   * caller that never had one to resolve). The guard still enforces the
   * tenant-level daily cap in that case — it just can't also enforce the
   * per-site one, since `fetchSeoCostGuardUsage` reports zero site-scoped
   * usage for a null siteId (see that function's doc on the NULL-parameter
   * FILTER behaviour).
   */
  siteId?: string | null;
  /**
   * Recorded against `seo_api_usage.operation` — a reporting dimension, not
   * a separate cap bucket (the daily Serper cap sums every operation for a
   * tenant/site regardless of this value). Deliberately distinct per call
   * site, e.g. 'rank_check' | 'backlink_search' | 'content_gap_search' |
   * 'competitor_search', so spend is attributable to the workflow that made it.
   */
  operation: string;
  /** Human-readable context for log lines only — a keyword or domain. Never a credential. */
  label: string;
}

/**
 * Fetches usage and evaluates the guard for one call. Returns `null` (never
 * throws) on any internal failure — the DB read failing, or anything else —
 * so `guardedSerperCall` can fail closed without a try/catch of its own at
 * every call site.
 */
async function resolveEvaluation(ctx: GuardedSerperCallCtx, now: Date): Promise<SeoCostGuardEvaluation | null> {
  const siteId = ctx.siteId ?? null;
  try {
    const usage = await fetchSeoCostGuardUsage(ctx.tenantId, siteId, now);
    return evaluateSeoCostGuard({
      tenantId: ctx.tenantId,
      // SeoCostGuardInput.siteId is typed as a required string, but only used
      // inside evaluateSeoCostGuard to build an idempotencyKey this guard
      // never consumes — '' is a safe stand-in for "no site", matching the
      // null already passed to fetchSeoCostGuardUsage above (every actual
      // budget number comes from `usage`, not from this field).
      siteId: siteId ?? '',
      operation: ctx.operation,
      estimate: SERPER_CALL_ESTIMATE,
      usage,
      providerEnv: { missing: [] },
      now,
    });
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        tenantId: ctx.tenantId,
        siteId,
        operation: ctx.operation,
        label: ctx.label,
      },
      `[seoSerperGuard] guard evaluation failed for "${ctx.label}" — failing closed`,
    );
    return null;
  }
}

export async function guardedSerperCall<T>(
  ctx: GuardedSerperCallCtx,
  /**
   * `run` receives `markSpent()` and MUST call it the instant `fetch()`
   * resolves to a Response — before checking `.ok` or parsing the body. See
   * the module doc's first design note for why this can't be inferred from
   * outside `run()`.
   */
  run: (markSpent: () => void) => Promise<T>,
  onBlocked: () => T,
): Promise<T> {
  const now = new Date();
  const evaluation = await resolveEvaluation(ctx, now);
  if (!evaluation) return onBlocked(); // internal guard error — already logged above, fail closed

  if (!evaluation.allowed) {
    logger.warn(
      { blockCode: evaluation.blockCode, tenantId: ctx.tenantId, siteId: ctx.siteId ?? null, operation: ctx.operation },
      `[seoSerperGuard] blocked "${ctx.label}" — ${evaluation.blockCode}`,
    );
    return onBlocked();
  }

  let spent = false;
  const markSpent = (): void => { spent = true; };

  // recordSeoApiUsage is documented to never throw (see seoCostGuardUsage.ts),
  // but this wrapper swallows defensively anyway: without that, a violation
  // of that contract inside the `try` below would fall into the same `catch`
  // as a failing `run()`, which would both (a) misreport a successful run()
  // as a blocked one to the caller and (b) call recordSpend() a second time
  // from the catch block — an actual double-record, not just a log line.
  const recordSpend = async (): Promise<void> => {
    try {
      await recordSeoApiUsage({
        tenantId: ctx.tenantId,
        siteId: ctx.siteId ?? null,
        provider: 'serper',
        operation: ctx.operation,
        calls: 1,
        costCents: evaluation.estimatedCostCents,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId, label: ctx.label },
        `[seoSerperGuard] recordSeoApiUsage rejected for "${ctx.label}" despite its documented contract — spend accounting may be inaccurate for this call`,
      );
    }
  };

  try {
    const result = await run(markSpent);
    if (spent) await recordSpend();
    return result;
  } catch (err) {
    // `spent` tells us whether the Serper request actually left before this
    // throw — see the module doc's first design note. Record iff it did;
    // either way this call is treated the same as a blocked one for the
    // caller (never throws — see "NEVER THROWS" below).
    if (spent) await recordSpend();
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId, label: ctx.label, spendRecorded: spent },
      `[seoSerperGuard] "${ctx.label}" threw after the guard allowed it — ${spent ? 'spend recorded (the request had already gone out)' : 'no spend recorded (it threw before the request left)'}`,
    );
    return onBlocked();
  }
}

/**
 * Per-run cache for domain -> SEO site id lookups. `getSeoSiteByDomain` is a
 * DB read; the four guarded call sites can loop over the same domain many
 * times in one run (e.g. rank-tracking checks dozens of keywords for the
 * same client domain) — resolving the site id once per keyword would turn
 * one guard check into two DB reads apiece. Call this once per run and reuse
 * the returned function for every lookup in that run.
 *
 * Scoped to a single `tenantId` and returned as a closure over a fresh Map
 * (not a module-level cache) so it never outlives one run and never serves a
 * stale id across runs after a site is added/archived mid-day.
 *
 * A domain that fails to resolve — not a registrable domain (see
 * `normaliseDomain` in seoSiteRegistry.ts, which throws on a bare project
 * name with no dot) or simply not registered — resolves to and caches
 * `null`, so a bad domain isn't re-looked-up on every keyword either; the
 * guard then falls back to tenant-level-only enforcement for that call (see
 * `GuardedSerperCallCtx.siteId`).
 */
export function createSeoSiteIdResolver(tenantId: string): (domain: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (domain: string): Promise<string | null> => {
    if (cache.has(domain)) return cache.get(domain) ?? null;
    const site = await getSeoSiteByDomain(tenantId, domain).catch(() => null);
    const siteId = site?.id ?? null;
    cache.set(domain, siteId);
    return siteId;
  };
}
