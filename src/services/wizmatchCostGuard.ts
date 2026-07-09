import type { Pool } from 'pg';

export type WizmatchCostGuardBlockCode =
  | 'monthly_budget_exhausted'
  | 'daily_budget_exhausted'
  | 'tenant_daily_run_cap_exhausted'
  | 'user_daily_run_cap_exhausted'
  | 'provider_daily_cap_exhausted'
  | 'provider_config_missing';

export type WizmatchProviderCallCounts = {
  apollo: number;
  snov: number;
  reacher: number;
  googleFallback: number;
};

export interface WizmatchCostGuardConfig {
  currency: string;
  monthlyDiscoveryBudgetCents: number;
  dailyDiscoveryBudgetCents: number;
  maxPaidRunsPerTenantDay: number;
  maxPaidRunsPerUserDay: number;
  maxProviderCallsPerTenantDay: WizmatchProviderCallCounts;
  providerCostCents: WizmatchProviderCallCounts;
}

export interface WizmatchCostGuardUsage {
  monthCostCents: number;
  dayCostCents: number;
  tenantRunsToday: number;
  userRunsToday: number;
  providerCallsToday: WizmatchProviderCallCounts;
}

export interface WizmatchProviderEnvStatus {
  missing: string[];
}

export interface WizmatchCostGuardInput {
  tenantId: string;
  userId: string | null | undefined;
  companyId: string;
  estimatedProviderCalls: WizmatchProviderCallCounts;
  usage: WizmatchCostGuardUsage;
  providerEnv: WizmatchProviderEnvStatus;
  config?: WizmatchCostGuardConfig;
  now?: Date;
}

export interface WizmatchCostGuardEvaluation {
  allowed: boolean;
  status: 'ready' | 'blocked';
  httpStatus: 200 | 402 | 429 | 503;
  blockCode: WizmatchCostGuardBlockCode | null;
  blockReasons: string[];
  idempotencyKey: string;
  currency: string;
  estimatedCostCents: number;
  budget: {
    month: { usedCents: number; limitCents: number; remainingCents: number };
    day: { usedCents: number; limitCents: number; remainingCents: number };
    userDayRuns: { used: number; limit: number; remaining: number };
    tenantDayRuns: { used: number; limit: number; remaining: number };
    providerDayCalls: Record<keyof WizmatchProviderCallCounts, { used: number; limit: number; remaining: number; estimated: number }>;
  };
  providerEnv: WizmatchProviderEnvStatus;
  policy: WizmatchCostGuardConfig;
}

function intEnv(value: string | undefined, defaultValue: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : defaultValue;
}

function providerCounts(overrides: Partial<Record<keyof WizmatchProviderCallCounts, number>> = {}): WizmatchProviderCallCounts {
  return {
    apollo: Math.max(0, Math.floor(overrides.apollo ?? 0)),
    snov: Math.max(0, Math.floor(overrides.snov ?? 0)),
    reacher: Math.max(0, Math.floor(overrides.reacher ?? 0)),
    googleFallback: Math.max(0, Math.floor(overrides.googleFallback ?? 0)),
  };
}

export function getWizmatchCostGuardConfig(env: NodeJS.ProcessEnv = process.env): WizmatchCostGuardConfig {
  return {
    currency: env.WIZMATCH_COST_CURRENCY || 'INR',
    monthlyDiscoveryBudgetCents: intEnv(env.WIZMATCH_MONTHLY_DISCOVERY_BUDGET_CENTS, 500000),
    dailyDiscoveryBudgetCents: intEnv(env.WIZMATCH_DAILY_DISCOVERY_BUDGET_CENTS, 50000),
    maxPaidRunsPerTenantDay: intEnv(env.WIZMATCH_MAX_PAID_RUNS_PER_TENANT_DAY, 20),
    maxPaidRunsPerUserDay: intEnv(env.WIZMATCH_MAX_PAID_RUNS_PER_USER_DAY, 5),
    maxProviderCallsPerTenantDay: {
      apollo: intEnv(env.WIZMATCH_MAX_APOLLO_CALLS_PER_TENANT_DAY, 50),
      snov: intEnv(env.WIZMATCH_MAX_SNOV_CALLS_PER_TENANT_DAY, 50),
      reacher: intEnv(env.WIZMATCH_MAX_REACHER_CALLS_PER_TENANT_DAY, 150),
      googleFallback: intEnv(env.WIZMATCH_MAX_GOOGLE_FALLBACK_CALLS_PER_TENANT_DAY, 25),
    },
    providerCostCents: {
      apollo: intEnv(env.WIZMATCH_APOLLO_COST_CENTS, 1500),
      snov: intEnv(env.WIZMATCH_SNOV_COST_CENTS, 1000),
      // Reacher is self-hosted on Railway — marginal cost per verification is ~0.
      reacher: intEnv(env.WIZMATCH_REACHER_COST_CENTS, 0),
      googleFallback: intEnv(env.WIZMATCH_GOOGLE_FALLBACK_COST_CENTS, 100),
    },
  };
}

export function emptyWizmatchCostGuardUsage(): WizmatchCostGuardUsage {
  return {
    monthCostCents: 0,
    dayCostCents: 0,
    tenantRunsToday: 0,
    userRunsToday: 0,
    providerCallsToday: providerCounts(),
  };
}

export interface WizmatchProviderEnvOptions {
  googleFallbackEnabled?: boolean;
  enableApollo?: boolean;
  enableSnov?: boolean;
}

/**
 * Reports which provider env vars are missing. Only requires keys for providers
 * that are actually enabled — the free website/pattern + Reacher path needs no
 * Apollo/Snov keys, so those are only checked when WIZMATCH_ENABLE_APOLLO/SNOV are on.
 * Accepts a legacy boolean (googleFallbackEnabled) for backward compatibility.
 */
export function getWizmatchProviderEnvStatus(
  env: NodeJS.ProcessEnv = process.env,
  options: WizmatchProviderEnvOptions | boolean = false,
): WizmatchProviderEnvStatus {
  const opts: WizmatchProviderEnvOptions = typeof options === 'boolean' ? { googleFallbackEnabled: options } : options;
  const missing: string[] = [];
  if (opts.enableApollo && !env.APOLLO_API_KEY) missing.push('APOLLO_API_KEY');
  if (opts.enableSnov) {
    const snovClientId = env.SNOV_CLIENT_ID || env.SNOVIO_API_KEY || env.SNOV_API_KEY;
    const snovClientSecret = env.SNOV_CLIENT_SECRET || env.SNOVIO_CLIENT_SECRET;
    if (!snovClientId) missing.push('SNOV_CLIENT_ID');
    if (!snovClientSecret) missing.push('SNOV_CLIENT_SECRET');
  }
  if (!env.REACHER_BASE_URL) missing.push('REACHER_BASE_URL');
  if (opts.googleFallbackEnabled && !env.SERPER_API_KEY) missing.push('SERPER_API_KEY');
  return { missing };
}

export function calculateWizmatchProviderCostCents(
  providerCalls: WizmatchProviderCallCounts,
  config: WizmatchCostGuardConfig = getWizmatchCostGuardConfig(),
) {
  return (providerCalls.apollo * config.providerCostCents.apollo)
    + (providerCalls.snov * config.providerCostCents.snov)
    + (providerCalls.reacher * config.providerCostCents.reacher)
    + (providerCalls.googleFallback * config.providerCostCents.googleFallback);
}

export interface WizmatchDiscoveryEstimateOptions {
  googleFallbackEnabled?: boolean;
  enableApollo?: boolean;
  enableSnov?: boolean;
}

/**
 * Worst-case provider-call estimate for one discovery run. Only counts paid
 * providers that are actually enabled — with Apollo/Snov off (default), the
 * estimate is just Reacher (self-hosted, priced ₹0) + optional Serper (~₹1).
 * Accepts a legacy boolean (googleFallbackEnabled) for backward compatibility.
 */
export function buildWizmatchDiscoveryProviderEstimate(
  options: WizmatchDiscoveryEstimateOptions | boolean,
): WizmatchProviderCallCounts {
  const opts: WizmatchDiscoveryEstimateOptions = typeof options === 'boolean' ? { googleFallbackEnabled: options } : options;
  return providerCounts({
    apollo: opts.enableApollo ? 1 : 0,
    snov: opts.enableSnov ? 1 : 0,
    reacher: 3,
    googleFallback: opts.googleFallbackEnabled ? 1 : 0,
  });
}

function remaining(limit: number, used: number) {
  return Math.max(0, limit - used);
}

function sameMonthStart(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function sameDayStart(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseProviderCalls(metadata: unknown): WizmatchProviderCallCounts {
  if (!metadata || typeof metadata !== 'object') return providerCounts();
  const providerCalls = (metadata as { providerCalls?: unknown }).providerCalls;
  if (!providerCalls || typeof providerCalls !== 'object') return providerCounts();
  const raw = providerCalls as Partial<Record<keyof WizmatchProviderCallCounts, unknown>>;
  return providerCounts({
    apollo: Number(raw.apollo || 0),
    snov: Number(raw.snov || 0),
    reacher: Number(raw.reacher || 0),
    googleFallback: Number(raw.googleFallback || 0),
  });
}

function isMissingOptionalCostGuardTable(error: unknown): boolean {
  const pgError = error as { code?: string; message?: string } | null;
  if (!pgError) return false;
  return pgError.code === '42P01'
    || /relation "wizmatch_discovery_runs" does not exist/i.test(pgError.message || '');
}

export async function fetchWizmatchCostGuardUsage(
  pool: Pool,
  tenantId: string,
  userId: string | null | undefined,
  now = new Date(),
): Promise<WizmatchCostGuardUsage> {
  const monthStart = sameMonthStart(now);
  const dayStart = sameDayStart(now);
  let result: { rows: Array<{ cost_cents: unknown; requested_by: unknown; metadata: unknown; created_at: string | number | Date }> };
  try {
    result = await pool.query(
      `SELECT cost_cents, requested_by, metadata, created_at
       FROM wizmatch_discovery_runs
       WHERE tenant_id = $1
         AND paid_provider = true
         AND created_at >= $2`,
      [tenantId, monthStart],
    );
  } catch (error) {
    if (!isMissingOptionalCostGuardTable(error)) throw error;
    return emptyWizmatchCostGuardUsage();
  }

  const usage = emptyWizmatchCostGuardUsage();
  for (const row of result.rows) {
    const costCents = Number(row.cost_cents || 0);
    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    usage.monthCostCents += Number.isFinite(costCents) ? costCents : 0;
    if (createdAt >= dayStart) {
      usage.dayCostCents += Number.isFinite(costCents) ? costCents : 0;
      usage.tenantRunsToday += 1;
      if (userId && String(row.requested_by || '') === String(userId)) usage.userRunsToday += 1;
      const providerCalls = parseProviderCalls(row.metadata);
      usage.providerCallsToday.apollo += providerCalls.apollo;
      usage.providerCallsToday.snov += providerCalls.snov;
      usage.providerCallsToday.reacher += providerCalls.reacher;
      usage.providerCallsToday.googleFallback += providerCalls.googleFallback;
    }
  }
  return usage;
}

export function evaluateWizmatchCostGuard(input: WizmatchCostGuardInput): WizmatchCostGuardEvaluation {
  const config = input.config || getWizmatchCostGuardConfig();
  const estimatedCostCents = calculateWizmatchProviderCostCents(input.estimatedProviderCalls, config);
  const providerDayCalls = {
    apollo: {
      used: input.usage.providerCallsToday.apollo,
      limit: config.maxProviderCallsPerTenantDay.apollo,
      remaining: remaining(config.maxProviderCallsPerTenantDay.apollo, input.usage.providerCallsToday.apollo),
      estimated: input.estimatedProviderCalls.apollo,
    },
    snov: {
      used: input.usage.providerCallsToday.snov,
      limit: config.maxProviderCallsPerTenantDay.snov,
      remaining: remaining(config.maxProviderCallsPerTenantDay.snov, input.usage.providerCallsToday.snov),
      estimated: input.estimatedProviderCalls.snov,
    },
    reacher: {
      used: input.usage.providerCallsToday.reacher,
      limit: config.maxProviderCallsPerTenantDay.reacher,
      remaining: remaining(config.maxProviderCallsPerTenantDay.reacher, input.usage.providerCallsToday.reacher),
      estimated: input.estimatedProviderCalls.reacher,
    },
    googleFallback: {
      used: input.usage.providerCallsToday.googleFallback,
      limit: config.maxProviderCallsPerTenantDay.googleFallback,
      remaining: remaining(config.maxProviderCallsPerTenantDay.googleFallback, input.usage.providerCallsToday.googleFallback),
      estimated: input.estimatedProviderCalls.googleFallback,
    },
  };

  const blockReasons: string[] = [];
  let blockCode: WizmatchCostGuardBlockCode | null = null;
  let httpStatus: WizmatchCostGuardEvaluation['httpStatus'] = 200;

  const setBlock = (code: WizmatchCostGuardBlockCode, status: WizmatchCostGuardEvaluation['httpStatus'], reason: string) => {
    if (!blockCode) {
      blockCode = code;
      httpStatus = status;
    }
    blockReasons.push(reason);
  };

  if (input.providerEnv.missing.length > 0) {
    setBlock('provider_config_missing', 503, `Provider config missing: ${input.providerEnv.missing.join(', ')}.`);
  }
  if (input.usage.monthCostCents + estimatedCostCents > config.monthlyDiscoveryBudgetCents) {
    setBlock('monthly_budget_exhausted', 402, 'Monthly paid discovery budget would be exceeded.');
  }
  if (input.usage.dayCostCents + estimatedCostCents > config.dailyDiscoveryBudgetCents) {
    setBlock('daily_budget_exhausted', 402, 'Daily paid discovery budget would be exceeded.');
  }
  if (input.usage.tenantRunsToday >= config.maxPaidRunsPerTenantDay) {
    setBlock('tenant_daily_run_cap_exhausted', 429, 'Tenant daily paid discovery run cap has been reached.');
  }
  if (input.usage.userRunsToday >= config.maxPaidRunsPerUserDay) {
    setBlock('user_daily_run_cap_exhausted', 429, 'Your daily paid discovery run cap has been reached.');
  }
  for (const [provider, status] of Object.entries(providerDayCalls) as Array<[keyof WizmatchProviderCallCounts, typeof providerDayCalls.apollo]>) {
    if (status.used + status.estimated > status.limit) {
      setBlock('provider_daily_cap_exhausted', 429, `${provider} daily provider call cap would be exceeded.`);
    }
  }

  const allowed = blockReasons.length === 0;
  const now = input.now || new Date();
  const cooldownWindow = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  return {
    allowed,
    status: allowed ? 'ready' : 'blocked',
    httpStatus,
    blockCode,
    blockReasons,
    idempotencyKey: `${input.tenantId}:${input.companyId}:${input.userId || 'unknown'}:${cooldownWindow}`,
    currency: config.currency,
    estimatedCostCents,
    budget: {
      month: {
        usedCents: input.usage.monthCostCents,
        limitCents: config.monthlyDiscoveryBudgetCents,
        remainingCents: remaining(config.monthlyDiscoveryBudgetCents, input.usage.monthCostCents),
      },
      day: {
        usedCents: input.usage.dayCostCents,
        limitCents: config.dailyDiscoveryBudgetCents,
        remainingCents: remaining(config.dailyDiscoveryBudgetCents, input.usage.dayCostCents),
      },
      userDayRuns: {
        used: input.usage.userRunsToday,
        limit: config.maxPaidRunsPerUserDay,
        remaining: remaining(config.maxPaidRunsPerUserDay, input.usage.userRunsToday),
      },
      tenantDayRuns: {
        used: input.usage.tenantRunsToday,
        limit: config.maxPaidRunsPerTenantDay,
        remaining: remaining(config.maxPaidRunsPerTenantDay, input.usage.tenantRunsToday),
      },
      providerDayCalls,
    },
    providerEnv: input.providerEnv,
    policy: config,
  };
}
