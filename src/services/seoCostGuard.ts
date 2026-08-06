/**
 * Per-tenant / per-site SEO API cost guard.
 *
 * Modelled directly on `wizmatchCostGuard.ts` (the strongest guardrail convention in
 * this repo) and replaces the old global, in-memory, process-lifetime Serper cap in
 * `seoWorkflowHealthService.ts` (`checkAndIncrementSeoSerperCap` / `SEO_SERPER_DAILY_CAP`,
 * default 50). That cap was fine when SEO automation ran for one internal tenant; it
 * cannot survive the system going multi-tenant and sold per-site — a single shared
 * counter lets tenants starve each other, resets on every deploy/restart, and gives no
 * way to quote an agency a fixed price without absorbing unbounded tail risk.
 *
 * `checkAndIncrementSeoSerperCap` is still present in seoWorkflowHealthService.ts
 * but now has ZERO callers: all four Serper spend sites (rankTracking, seoBacklink,
 * seoContentGap, competitorContent) moved onto `guardedSerperCall`
 * (seoSerperGuard.ts) in Phase 4. It is left in place only because three comments
 * in worker.ts/featureFlags.ts still describe it as the mechanism; removing it is a
 * separate cleanup, not a behaviour change.
 *
 * ---------------------------------------------------------------------------
 * INTENTIONALLY MISSING (do not add here without a migration + explicit sign-off):
 *
 * 1. `fetchSeoCostGuardUsage(pool, tenantId, siteId, now)` — DONE, but NOT here.
 *    It lives in `seoCostGuardUsage.ts`, backed by the `seo_api_usage` table
 *    added in migration 0049. It is a separate file precisely so THIS file stays
 *    pure: it deliberately still does NOT `import { pool }`, and must not start.
 * 2. `getSeoProviderEnvStatus(env)` — a pure helper that would compute
 *    `SeoCostGuardProviderEnvStatus.missing` from env (SERPER_API_KEY, a PageSpeed/
 *    Google API key, GSC service-account credentials, an LLM key). Not built yet;
 *    callers must supply `providerEnv.missing` themselves for now.
 *
 * Everything below this point is pure (no I/O) and fully unit-testable:
 * `getSeoCostGuardConfig` reads only from an injected `env` object, and
 * `evaluateSeoCostGuard` takes all usage/estimate data as input instead of querying
 * anything itself.
 *
 * ---------------------------------------------------------------------------
 * NOTE ON BLOCK CODES: this file enforces `tenant_daily_gsc_cap_exhausted` in
 * addition to the 8 block codes originally specified for this lane. The spec asked
 * for a `SEO_MAX_GSC_CALLS_PER_TENANT_DAY` config knob (mirroring the tenant/site
 * Serper caps and the tenant PageSpeed cap) but the given block-code enum omitted a
 * corresponding GSC code. Leaving the GSC cap unenforced would make that env var a
 * no-op, so a 9th code was added following the same `tenant_daily_<provider>_cap_
 * exhausted` naming pattern as the others. Flagging this explicitly for review by
 * whichever lane consumes `SeoCostGuardBlockCode` (routes/gate/adapter) — please
 * confirm it's handled (or tell me to drop GSC enforcement instead).
 * ---------------------------------------------------------------------------
 * GA4 CAP: this file also enforces `tenant_daily_ga4_cap_exhausted` /
 * `SEO_MAX_GA4_CALLS_PER_TENANT_DAY`, mirroring the GSC cap immediately above
 * field-for-field (own block code, own config knob, own estimate/usage/budget
 * field). This closes a gap `seoAnalyticsService.ts` used to document at
 * length: its GA4 pull ran entirely outside this guard because
 * `SeoCostGuardEstimatedCalls` had no `ga4Calls` field, and reusing `gscCalls`
 * would have corrupted the real GSC daily cap with unrelated GA4 traffic. See
 * that file's `runSeoAnalyticsPull` for the call site now wrapped in
 * `guardSeoSpend`.
 * ---------------------------------------------------------------------------
 */

export type SeoCostGuardBlockCode =
  | 'monthly_budget_exhausted'
  | 'daily_budget_exhausted'
  | 'tenant_daily_serper_cap_exhausted'
  | 'site_daily_serper_cap_exhausted'
  | 'tenant_daily_pagespeed_cap_exhausted'
  | 'tenant_daily_gsc_cap_exhausted'
  | 'tenant_daily_ga4_cap_exhausted'
  | 'site_daily_publish_cap_exhausted'
  | 'provider_config_missing'
  | 'site_paused';

export interface SeoCostGuardProviderCostCents {
  serper: number;
  pagespeed: number;
  llm: number;
}

export interface SeoCostGuardConfig {
  currency: string;
  monthlyBudgetCents: number;
  dailyBudgetCents: number;
  maxSerperCallsPerTenantDay: number;
  maxSerperCallsPerSiteDay: number;
  maxPagespeedCallsPerTenantDay: number;
  maxGscCallsPerTenantDay: number;
  maxGa4CallsPerTenantDay: number;
  maxPublishesPerSiteDay: number;
  providerCostCents: SeoCostGuardProviderCostCents;
}

/** What one operation is expected to cost/consume, before it runs. */
export interface SeoCostGuardEstimatedCalls {
  serperCalls: number;
  pagespeedCalls: number;
  llmCalls: number;
  gscCalls: number;
  ga4Calls: number;
  publishes: number;
}

/** Historical usage for the current month/day, as it will eventually come from `seo_api_usage`. */
export interface SeoCostGuardUsage {
  monthCostCents: number;
  dayCostCents: number;
  tenantDaySerperCalls: number;
  siteDaySerperCalls: number;
  tenantDayPagespeedCalls: number;
  tenantDayGscCalls: number;
  tenantDayGa4Calls: number;
  siteDayPublishes: number;
}

export interface SeoCostGuardProviderEnvStatus {
  missing: string[];
}

/**
 * Per-site overrides sourced from a plan's `limits` jsonb, e.g.
 * `{"seoSites":1,"seoPublishesPerSiteDay":3}`. Only the caps this guard actually
 * enforces are applied here (`seoPublishesPerSiteDay`, `seoSerperCallsPerSiteDay`).
 * `seoSites` is accepted so the type matches the real jsonb shape but is NOT
 * enforced by this guard — it's a site-count entitlement (how many sites a plan may
 * onboard), not a per-operation cap, and belongs to whichever route handles site
 * creation/onboarding.
 */
export interface SeoCostGuardPlanLimits {
  seoSites?: number;
  seoPublishesPerSiteDay?: number;
  seoSerperCallsPerSiteDay?: number;
}

export interface SeoCostGuardInput {
  tenantId: string;
  siteId: string;
  /** Free-form operation label, e.g. 'serper_search' | 'pagespeed_check' | 'gsc_pull' | 'publish'. Used only for the idempotency key. */
  operation: string;
  estimate: SeoCostGuardEstimatedCalls;
  usage: SeoCostGuardUsage;
  providerEnv: SeoCostGuardProviderEnvStatus;
  /** True when the site record itself has been paused (billing, abuse, customer request). */
  sitePaused?: boolean;
  planLimits?: SeoCostGuardPlanLimits;
  config?: SeoCostGuardConfig;
  now?: Date;
}

interface SeoCostGuardCountBudget {
  used: number;
  limit: number;
  remaining: number;
  estimated: number;
}

interface SeoCostGuardCostBudget {
  usedCents: number;
  limitCents: number;
  remainingCents: number;
}

export interface SeoCostGuardEvaluation {
  allowed: boolean;
  status: 'ready' | 'blocked';
  httpStatus: 200 | 402 | 429 | 503;
  blockCode: SeoCostGuardBlockCode | null;
  blockReasons: string[];
  idempotencyKey: string;
  currency: string;
  estimatedCostCents: number;
  budget: {
    month: SeoCostGuardCostBudget;
    day: SeoCostGuardCostBudget;
    tenantDaySerper: SeoCostGuardCountBudget;
    siteDaySerper: SeoCostGuardCountBudget;
    // Not in the literal spec'd budget shape (month/day/tenantDaySerper/siteDaySerper/
    // siteDayPublishes only) — added because the pagespeed/GSC caps below need
    // somewhere to report used/limit/remaining too. Purely additive; safe to ignore.
    tenantDayPagespeed: SeoCostGuardCountBudget;
    tenantDayGsc: SeoCostGuardCountBudget;
    tenantDayGa4: SeoCostGuardCountBudget;
    siteDayPublishes: SeoCostGuardCountBudget;
  };
  providerEnv: SeoCostGuardProviderEnvStatus;
  /** The config actually applied, i.e. env defaults with `planLimits` overrides already merged in. */
  policy: SeoCostGuardConfig;
}

function intEnv(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : defaultValue;
}

export function getSeoCostGuardConfig(env: NodeJS.ProcessEnv = process.env): SeoCostGuardConfig {
  return {
    currency: env.SEO_COST_CURRENCY || 'INR',
    monthlyBudgetCents: intEnv(env.SEO_MONTHLY_BUDGET_CENTS, 200000),
    dailyBudgetCents: intEnv(env.SEO_DAILY_BUDGET_CENTS, 20000),
    // Replaces the old global SEO_SERPER_DAILY_CAP (default 50) — same default,
    // now scoped per tenant instead of shared across every tenant on the box.
    maxSerperCallsPerTenantDay: intEnv(env.SEO_MAX_SERPER_CALLS_PER_TENANT_DAY, 50),
    maxSerperCallsPerSiteDay: intEnv(env.SEO_MAX_SERPER_CALLS_PER_SITE_DAY, 20),
    maxPagespeedCallsPerTenantDay: intEnv(env.SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY, 100),
    maxGscCallsPerTenantDay: intEnv(env.SEO_MAX_GSC_CALLS_PER_TENANT_DAY, 200),
    // Same "free Google API" story as GSC immediately above — same default
    // (200) and parsing convention, kept as its own cap/env var so GA4 usage
    // is never folded into the GSC counter (see the GA4 CAP module-doc note).
    maxGa4CallsPerTenantDay: intEnv(env.SEO_MAX_GA4_CALLS_PER_TENANT_DAY, 200),
    maxPublishesPerSiteDay: intEnv(env.SEO_MAX_PUBLISHES_PER_SITE_DAY, 3),
    providerCostCents: {
      serper: intEnv(env.SEO_SERPER_COST_CENTS, 100),
      // PageSpeed Insights is a free Google API — 0 by default, but overridable in
      // case a paid proxy/quota tier is ever put in front of it.
      pagespeed: intEnv(env.SEO_PAGESPEED_COST_CENTS, 0),
      llm: intEnv(env.SEO_LLM_COST_CENTS, 500),
    },
  };
}

export function emptySeoCostGuardUsage(): SeoCostGuardUsage {
  return {
    monthCostCents: 0,
    dayCostCents: 0,
    tenantDaySerperCalls: 0,
    siteDaySerperCalls: 0,
    tenantDayPagespeedCalls: 0,
    tenantDayGscCalls: 0,
    tenantDayGa4Calls: 0,
    siteDayPublishes: 0,
  };
}

export function calculateSeoCostGuardCostCents(
  estimate: SeoCostGuardEstimatedCalls,
  config: SeoCostGuardConfig = getSeoCostGuardConfig(),
): number {
  // gscCalls, ga4Calls, and publishes carry no direct provider cost of their own
  // (GSC and GA4 are both free Google APIs; a publish's cost, if any, shows up as
  // its llmCalls for the content generation that produced it).
  return (estimate.serperCalls * config.providerCostCents.serper)
    + (estimate.pagespeedCalls * config.providerCostCents.pagespeed)
    + (estimate.llmCalls * config.providerCostCents.llm);
}

function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/** Merges plan-jsonb overrides onto env defaults for the caps that are actually per-site. */
function applyPlanLimits(config: SeoCostGuardConfig, planLimits: SeoCostGuardPlanLimits | undefined): SeoCostGuardConfig {
  if (!planLimits) return config;
  return {
    ...config,
    maxSerperCallsPerSiteDay: planLimits.seoSerperCallsPerSiteDay ?? config.maxSerperCallsPerSiteDay,
    maxPublishesPerSiteDay: planLimits.seoPublishesPerSiteDay ?? config.maxPublishesPerSiteDay,
  };
}

export function evaluateSeoCostGuard(input: SeoCostGuardInput): SeoCostGuardEvaluation {
  const config = applyPlanLimits(input.config || getSeoCostGuardConfig(), input.planLimits);
  const estimatedCostCents = calculateSeoCostGuardCostCents(input.estimate, config);

  const tenantDaySerper: SeoCostGuardCountBudget = {
    used: input.usage.tenantDaySerperCalls,
    limit: config.maxSerperCallsPerTenantDay,
    remaining: remaining(config.maxSerperCallsPerTenantDay, input.usage.tenantDaySerperCalls),
    estimated: input.estimate.serperCalls,
  };
  const siteDaySerper: SeoCostGuardCountBudget = {
    used: input.usage.siteDaySerperCalls,
    limit: config.maxSerperCallsPerSiteDay,
    remaining: remaining(config.maxSerperCallsPerSiteDay, input.usage.siteDaySerperCalls),
    estimated: input.estimate.serperCalls,
  };
  const tenantDayPagespeed: SeoCostGuardCountBudget = {
    used: input.usage.tenantDayPagespeedCalls,
    limit: config.maxPagespeedCallsPerTenantDay,
    remaining: remaining(config.maxPagespeedCallsPerTenantDay, input.usage.tenantDayPagespeedCalls),
    estimated: input.estimate.pagespeedCalls,
  };
  const tenantDayGsc: SeoCostGuardCountBudget = {
    used: input.usage.tenantDayGscCalls,
    limit: config.maxGscCallsPerTenantDay,
    remaining: remaining(config.maxGscCallsPerTenantDay, input.usage.tenantDayGscCalls),
    estimated: input.estimate.gscCalls,
  };
  const tenantDayGa4: SeoCostGuardCountBudget = {
    used: input.usage.tenantDayGa4Calls,
    limit: config.maxGa4CallsPerTenantDay,
    remaining: remaining(config.maxGa4CallsPerTenantDay, input.usage.tenantDayGa4Calls),
    estimated: input.estimate.ga4Calls,
  };
  const siteDayPublishes: SeoCostGuardCountBudget = {
    used: input.usage.siteDayPublishes,
    limit: config.maxPublishesPerSiteDay,
    remaining: remaining(config.maxPublishesPerSiteDay, input.usage.siteDayPublishes),
    estimated: input.estimate.publishes,
  };

  const blockReasons: string[] = [];
  let blockCode: SeoCostGuardBlockCode | null = null;
  let httpStatus: SeoCostGuardEvaluation['httpStatus'] = 200;

  const setBlock = (code: SeoCostGuardBlockCode, status: SeoCostGuardEvaluation['httpStatus'], reason: string) => {
    if (!blockCode) {
      blockCode = code;
      httpStatus = status;
    }
    blockReasons.push(reason);
  };

  if (input.sitePaused) {
    setBlock('site_paused', 503, 'This site is paused and cannot run SEO operations.');
  }
  if (input.providerEnv.missing.length > 0) {
    setBlock('provider_config_missing', 503, `Provider config missing: ${input.providerEnv.missing.join(', ')}.`);
  }
  if (input.usage.monthCostCents + estimatedCostCents > config.monthlyBudgetCents) {
    setBlock('monthly_budget_exhausted', 402, 'Monthly SEO budget would be exceeded.');
  }
  if (input.usage.dayCostCents + estimatedCostCents > config.dailyBudgetCents) {
    setBlock('daily_budget_exhausted', 402, 'Daily SEO budget would be exceeded.');
  }
  if (tenantDaySerper.used + tenantDaySerper.estimated > tenantDaySerper.limit) {
    setBlock('tenant_daily_serper_cap_exhausted', 429, 'Tenant daily Serper call cap has been reached.');
  }
  if (siteDaySerper.used + siteDaySerper.estimated > siteDaySerper.limit) {
    setBlock('site_daily_serper_cap_exhausted', 429, 'Site daily Serper call cap has been reached.');
  }
  if (tenantDayPagespeed.used + tenantDayPagespeed.estimated > tenantDayPagespeed.limit) {
    setBlock('tenant_daily_pagespeed_cap_exhausted', 429, 'Tenant daily PageSpeed call cap has been reached.');
  }
  if (tenantDayGsc.used + tenantDayGsc.estimated > tenantDayGsc.limit) {
    setBlock('tenant_daily_gsc_cap_exhausted', 429, 'Tenant daily Search Console call cap has been reached.');
  }
  if (tenantDayGa4.used + tenantDayGa4.estimated > tenantDayGa4.limit) {
    setBlock('tenant_daily_ga4_cap_exhausted', 429, 'Tenant daily Analytics (GA4) call cap has been reached.');
  }
  if (siteDayPublishes.used + siteDayPublishes.estimated > siteDayPublishes.limit) {
    setBlock('site_daily_publish_cap_exhausted', 429, 'Site daily publish cap has been reached.');
  }

  const allowed = blockReasons.length === 0;
  const now = input.now || new Date();
  const day = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  return {
    allowed,
    status: allowed ? 'ready' : 'blocked',
    httpStatus,
    blockCode,
    blockReasons,
    idempotencyKey: `${input.tenantId}:${input.siteId}:${input.operation}:${day}`,
    currency: config.currency,
    estimatedCostCents,
    budget: {
      month: {
        usedCents: input.usage.monthCostCents,
        limitCents: config.monthlyBudgetCents,
        remainingCents: remaining(config.monthlyBudgetCents, input.usage.monthCostCents),
      },
      day: {
        usedCents: input.usage.dayCostCents,
        limitCents: config.dailyBudgetCents,
        remainingCents: remaining(config.dailyBudgetCents, input.usage.dayCostCents),
      },
      tenantDaySerper,
      siteDaySerper,
      tenantDayPagespeed,
      tenantDayGsc,
      tenantDayGa4,
      siteDayPublishes,
    },
    providerEnv: input.providerEnv,
    policy: config,
  };
}
