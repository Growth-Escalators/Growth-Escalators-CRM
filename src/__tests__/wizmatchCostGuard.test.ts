import { describe, expect, it } from 'vitest';
import {
  buildWizmatchDiscoveryProviderEstimate,
  calculateWizmatchProviderCostCents,
  emptyWizmatchCostGuardUsage,
  evaluateWizmatchCostGuard,
  fetchWizmatchCostGuardUsage,
  getWizmatchCostGuardConfig,
  getWizmatchProviderEnvStatus,
  type WizmatchCostGuardUsage,
} from '../services/wizmatchCostGuard';

function config(overrides: Partial<ReturnType<typeof getWizmatchCostGuardConfig>> = {}) {
  return {
    ...getWizmatchCostGuardConfig({
      WIZMATCH_MONTHLY_DISCOVERY_BUDGET_CENTS: '500000',
      WIZMATCH_DAILY_DISCOVERY_BUDGET_CENTS: '50000',
      WIZMATCH_MAX_PAID_RUNS_PER_TENANT_DAY: '20',
      WIZMATCH_MAX_PAID_RUNS_PER_USER_DAY: '5',
      WIZMATCH_MAX_APOLLO_CALLS_PER_TENANT_DAY: '50',
      WIZMATCH_MAX_SNOV_CALLS_PER_TENANT_DAY: '50',
      WIZMATCH_MAX_REACHER_CALLS_PER_TENANT_DAY: '150',
      WIZMATCH_MAX_GOOGLE_FALLBACK_CALLS_PER_TENANT_DAY: '25',
      WIZMATCH_APOLLO_COST_CENTS: '1500',
      WIZMATCH_SNOV_COST_CENTS: '1000',
      WIZMATCH_REACHER_COST_CENTS: '200',
      WIZMATCH_GOOGLE_FALLBACK_COST_CENTS: '100',
    } as NodeJS.ProcessEnv),
    ...overrides,
  };
}

function usage(overrides: Partial<WizmatchCostGuardUsage> = {}): WizmatchCostGuardUsage {
  return {
    ...emptyWizmatchCostGuardUsage(),
    ...overrides,
    providerCallsToday: {
      ...emptyWizmatchCostGuardUsage().providerCallsToday,
      ...(overrides.providerCallsToday || {}),
    },
  };
}

function evaluate(overrides: Partial<Parameters<typeof evaluateWizmatchCostGuard>[0]> = {}) {
  return evaluateWizmatchCostGuard({
    tenantId: 'tenant-1',
    userId: 'user-1',
    companyId: 'company-1',
    estimatedProviderCalls: buildWizmatchDiscoveryProviderEstimate({ googleFallbackEnabled: true, enableApollo: true, enableSnov: true }),
    usage: usage(),
    providerEnv: { missing: [] },
    config: config(),
    now: new Date('2026-07-06T10:00:00.000Z'),
    ...overrides,
  });
}

describe('Wizmatch cost guard', () => {
  it('allows a normal preview and calculates provider-call cost', () => {
    const result = evaluate();

    expect(result.allowed).toBe(true);
    expect(result.estimatedCostCents).toBe(3200);
    expect(calculateWizmatchProviderCostCents(buildWizmatchDiscoveryProviderEstimate({ googleFallbackEnabled: true, enableApollo: true, enableSnov: true }), config())).toBe(3200);
    expect(result.budget.month.remainingCents).toBe(500000);
  });

  it('estimates only free providers (~Serper) when Apollo/Snov are disabled — reacher self-hosted is free', () => {
    // Default free-first config: Apollo/Snov off, Serper on. Reacher priced at 0 (self-hosted).
    const freeConfig = getWizmatchCostGuardConfig({ WIZMATCH_GOOGLE_FALLBACK_COST_CENTS: '100' } as NodeJS.ProcessEnv);
    const estimate = buildWizmatchDiscoveryProviderEstimate({ googleFallbackEnabled: true });
    expect(calculateWizmatchProviderCostCents(estimate, freeConfig)).toBe(100);
    const zeroSpend = buildWizmatchDiscoveryProviderEstimate({ googleFallbackEnabled: false });
    expect(calculateWizmatchProviderCostCents(zeroSpend, freeConfig)).toBe(0);
  });

  it('hard-blocks monthly and daily budget exhaustion', () => {
    expect(evaluate({ usage: usage({ monthCostCents: 498000 }) }).blockCode).toBe('monthly_budget_exhausted');
    expect(evaluate({ usage: usage({ dayCostCents: 48000 }) }).blockCode).toBe('daily_budget_exhausted');
    expect(evaluate({ usage: usage({ monthCostCents: 498000 }) }).httpStatus).toBe(402);
  });

  it('hard-blocks tenant/user run caps and provider caps', () => {
    expect(evaluate({ usage: usage({ tenantRunsToday: 20 }) }).blockCode).toBe('tenant_daily_run_cap_exhausted');
    expect(evaluate({ usage: usage({ userRunsToday: 5 }) }).blockCode).toBe('user_daily_run_cap_exhausted');
    expect(evaluate({ usage: usage({ providerCallsToday: { apollo: 50, snov: 0, reacher: 0, googleFallback: 0 } }) }).blockCode).toBe('provider_daily_cap_exhausted');
    expect(evaluate({ usage: usage({ tenantRunsToday: 20 }) }).httpStatus).toBe(429);
  });

  it('hard-blocks missing provider env vars', () => {
    const providerEnv = getWizmatchProviderEnvStatus(
      { WIZMATCH_GOOGLE_FALLBACK_ENABLED: 'true' } as NodeJS.ProcessEnv,
      { googleFallbackEnabled: true, enableApollo: true, enableSnov: true },
    );
    const result = evaluate({ providerEnv });

    expect(result.allowed).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.providerEnv.missing).toContain('APOLLO_API_KEY');
    expect(result.providerEnv.missing).toContain('SERPER_API_KEY');
  });

  it('does NOT require Apollo/Snov keys when those providers are disabled (free-first default)', () => {
    const providerEnv = getWizmatchProviderEnvStatus(
      { REACHER_BASE_URL: 'https://reacher.example' } as NodeJS.ProcessEnv,
      { googleFallbackEnabled: false, enableApollo: false, enableSnov: false },
    );
    expect(providerEnv.missing).not.toContain('APOLLO_API_KEY');
    expect(providerEnv.missing).not.toContain('SNOV_CLIENT_ID');
    expect(providerEnv.missing).toHaveLength(0);
  });

  it('returns zero usage when the optional discovery-runs table is missing', async () => {
    const pool = {
      query: async () => {
        const error = new Error('relation "wizmatch_discovery_runs" does not exist') as Error & { code: string };
        error.code = '42P01';
        throw error;
      },
    };

    await expect(fetchWizmatchCostGuardUsage(pool as any, 'tenant-1', 'user-1')).resolves.toEqual(emptyWizmatchCostGuardUsage());
  });
});
