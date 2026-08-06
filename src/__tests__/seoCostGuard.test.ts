import { describe, expect, it } from 'vitest';
import {
  calculateSeoCostGuardCostCents,
  emptySeoCostGuardUsage,
  evaluateSeoCostGuard,
  getSeoCostGuardConfig,
  type SeoCostGuardEstimatedCalls,
  type SeoCostGuardUsage,
} from '../services/seoCostGuard';

function config(overrides: Partial<ReturnType<typeof getSeoCostGuardConfig>> = {}) {
  return {
    ...getSeoCostGuardConfig({
      SEO_MONTHLY_BUDGET_CENTS: '200000',
      SEO_DAILY_BUDGET_CENTS: '20000',
      SEO_MAX_SERPER_CALLS_PER_TENANT_DAY: '50',
      SEO_MAX_SERPER_CALLS_PER_SITE_DAY: '20',
      SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY: '100',
      SEO_MAX_GSC_CALLS_PER_TENANT_DAY: '200',
      SEO_MAX_PUBLISHES_PER_SITE_DAY: '3',
      SEO_SERPER_COST_CENTS: '100',
      SEO_PAGESPEED_COST_CENTS: '0',
      SEO_LLM_COST_CENTS: '500',
    } as NodeJS.ProcessEnv),
    ...overrides,
  };
}

function usage(overrides: Partial<SeoCostGuardUsage> = {}): SeoCostGuardUsage {
  return { ...emptySeoCostGuardUsage(), ...overrides };
}

function estimate(overrides: Partial<SeoCostGuardEstimatedCalls> = {}): SeoCostGuardEstimatedCalls {
  return {
    serperCalls: 0,
    pagespeedCalls: 0,
    llmCalls: 0,
    gscCalls: 0,
    publishes: 0,
    ...overrides,
  };
}

function evaluate(overrides: Partial<Parameters<typeof evaluateSeoCostGuard>[0]> = {}) {
  return evaluateSeoCostGuard({
    tenantId: 'tenant-1',
    siteId: 'site-1',
    operation: 'serper_search',
    estimate: estimate(),
    usage: usage(),
    providerEnv: { missing: [] },
    config: config(),
    now: new Date('2026-08-05T10:00:00.000Z'),
    ...overrides,
  });
}

describe('SEO cost guard', () => {
  it('allows a normal operation within budget and calculates cost cents', () => {
    const result = evaluate({ estimate: estimate({ serperCalls: 2, llmCalls: 1 }) });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.httpStatus).toBe(200);
    expect(result.blockCode).toBeNull();
    expect(result.blockReasons).toHaveLength(0);
    expect(result.estimatedCostCents).toBe(700); // 2*100 (serper) + 1*500 (llm)
    expect(calculateSeoCostGuardCostCents(estimate({ serperCalls: 2, llmCalls: 1 }), config())).toBe(700);
    // remainingCents reflects usage-to-date only, not the pending operation's estimate —
    // same convention as wizmatchCostGuard (see wizmatchCostGuard.test.ts:65, where a
    // non-zero estimatedCostCents still leaves remainingCents at the full budget).
    expect(result.budget.month.remainingCents).toBe(200000);
    expect(result.budget.day.remainingCents).toBe(20000);
  });

  it('gscCalls and publishes carry no direct provider cost', () => {
    const result = evaluate({ estimate: estimate({ gscCalls: 5, publishes: 2 }) });
    expect(result.estimatedCostCents).toBe(0);
  });

  it('blocks on monthly budget exhaustion (402)', () => {
    const result = evaluate({
      usage: usage({ monthCostCents: 200000 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('monthly_budget_exhausted');
    expect(result.httpStatus).toBe(402);
  });

  it('blocks on daily budget exhaustion (402)', () => {
    const result = evaluate({
      usage: usage({ dayCostCents: 20000 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('daily_budget_exhausted');
    expect(result.httpStatus).toBe(402);
  });

  it('blocks on tenant daily Serper cap exhaustion (429)', () => {
    const result = evaluate({
      usage: usage({ tenantDaySerperCalls: 50 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('tenant_daily_serper_cap_exhausted');
    expect(result.httpStatus).toBe(429);
  });

  it('blocks on site daily Serper cap exhaustion (429)', () => {
    const result = evaluate({
      usage: usage({ siteDaySerperCalls: 20 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('site_daily_serper_cap_exhausted');
    expect(result.httpStatus).toBe(429);
  });

  it('blocks on tenant daily PageSpeed cap exhaustion (429)', () => {
    const result = evaluate({
      usage: usage({ tenantDayPagespeedCalls: 100 }),
      estimate: estimate({ pagespeedCalls: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('tenant_daily_pagespeed_cap_exhausted');
    expect(result.httpStatus).toBe(429);
  });

  it('blocks on tenant daily GSC cap exhaustion (429)', () => {
    const result = evaluate({
      usage: usage({ tenantDayGscCalls: 200 }),
      estimate: estimate({ gscCalls: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('tenant_daily_gsc_cap_exhausted');
    expect(result.httpStatus).toBe(429);
  });

  it('blocks on site daily publish cap exhaustion (429)', () => {
    const result = evaluate({
      usage: usage({ siteDayPublishes: 3 }),
      estimate: estimate({ publishes: 1 }),
    });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('site_daily_publish_cap_exhausted');
    expect(result.httpStatus).toBe(429);
  });

  it('blocks on missing provider config (503)', () => {
    const result = evaluate({ providerEnv: { missing: ['SERPER_API_KEY'] } });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('provider_config_missing');
    expect(result.httpStatus).toBe(503);
    expect(result.blockReasons[0]).toContain('SERPER_API_KEY');
  });

  it('blocks on a paused site (503)', () => {
    const result = evaluate({ sitePaused: true });
    expect(result.allowed).toBe(false);
    expect(result.blockCode).toBe('site_paused');
    expect(result.httpStatus).toBe(503);
  });

  it('first-block-wins: keeps the first-checked blockCode/httpStatus even when a later check also blocks', () => {
    // site_paused is checked before budget exhaustion, so even though the monthly
    // budget is also blown, blockCode/httpStatus must stay pinned to site_paused/503
    // — not fall through to monthly_budget_exhausted/402.
    const result = evaluate({
      sitePaused: true,
      usage: usage({ monthCostCents: 200000 }),
      estimate: estimate({ serperCalls: 1 }),
    });

    expect(result.blockCode).toBe('site_paused');
    expect(result.httpStatus).toBe(503);
    expect(result.blockReasons.length).toBeGreaterThanOrEqual(2);
    expect(result.blockReasons.some(r => /paused/i.test(r))).toBe(true);
    expect(result.blockReasons.some(r => /monthly/i.test(r))).toBe(true);
  });

  it('collects every simultaneous block reason, not just the first', () => {
    const result = evaluate({
      usage: usage({ tenantDaySerperCalls: 50, siteDaySerperCalls: 20, tenantDayPagespeedCalls: 100 }),
      estimate: estimate({ serperCalls: 1, pagespeedCalls: 1 }),
    });

    expect(result.allowed).toBe(false);
    expect(result.blockReasons).toHaveLength(3);
    // Serper (tenant) is checked before Serper (site) is checked before PageSpeed.
    expect(result.blockCode).toBe('tenant_daily_serper_cap_exhausted');
  });

  it('lets plan limits tighten the site-level Serper cap below the env default', () => {
    // Env default site Serper cap is 20 (see config() above) — 2 used + 1 estimated
    // would be allowed under the env default.
    const withoutPlanLimit = evaluate({
      usage: usage({ siteDaySerperCalls: 2 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(withoutPlanLimit.allowed).toBe(true);

    const withPlanLimit = evaluate({
      planLimits: { seoSerperCallsPerSiteDay: 2 },
      usage: usage({ siteDaySerperCalls: 2 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(withPlanLimit.allowed).toBe(false);
    expect(withPlanLimit.blockCode).toBe('site_daily_serper_cap_exhausted');
    expect(withPlanLimit.policy.maxSerperCallsPerSiteDay).toBe(2);
    expect(withPlanLimit.budget.siteDaySerper.limit).toBe(2);
  });

  it('lets plan limits tighten the site-level publish cap below the env default', () => {
    // Env default site publish cap is 3 — 1 used + 1 estimated would be allowed.
    const withoutPlanLimit = evaluate({
      usage: usage({ siteDayPublishes: 1 }),
      estimate: estimate({ publishes: 1 }),
    });
    expect(withoutPlanLimit.allowed).toBe(true);

    const withPlanLimit = evaluate({
      planLimits: { seoPublishesPerSiteDay: 1 },
      usage: usage({ siteDayPublishes: 1 }),
      estimate: estimate({ publishes: 1 }),
    });
    expect(withPlanLimit.allowed).toBe(false);
    expect(withPlanLimit.blockCode).toBe('site_daily_publish_cap_exhausted');
    expect(withPlanLimit.policy.maxPublishesPerSiteDay).toBe(1);
  });

  it('plan limits do not affect the tenant-scoped Serper cap (only per-site caps are overridable)', () => {
    const result = evaluate({
      planLimits: { seoSerperCallsPerSiteDay: 2 },
      usage: usage({ tenantDaySerperCalls: 50, siteDaySerperCalls: 0 }),
      estimate: estimate({ serperCalls: 1 }),
    });
    expect(result.blockCode).toBe('tenant_daily_serper_cap_exhausted');
    expect(result.policy.maxSerperCallsPerTenantDay).toBe(50);
  });

  it('derives a deterministic idempotency key from tenantId/siteId/operation/date (UTC, not local time)', () => {
    const result = evaluate({
      tenantId: 'tenant-42',
      siteId: 'site-7',
      operation: 'publish',
      now: new Date('2026-08-05T23:59:59.000Z'),
    });
    expect(result.idempotencyKey).toBe('tenant-42:site-7:publish:2026-08-05');
  });

  it('is a pure function: identical input produces an identical result', () => {
    const input: Parameters<typeof evaluateSeoCostGuard>[0] = {
      tenantId: 'tenant-9',
      siteId: 'site-9',
      operation: 'pagespeed_check',
      estimate: estimate({ pagespeedCalls: 1 }),
      usage: usage({ tenantDayPagespeedCalls: 3 }),
      providerEnv: { missing: [] },
      config: config(),
      now: new Date('2026-08-05T00:00:00.000Z'),
    };
    expect(evaluateSeoCostGuard(input)).toEqual(evaluateSeoCostGuard(input));
  });
});
