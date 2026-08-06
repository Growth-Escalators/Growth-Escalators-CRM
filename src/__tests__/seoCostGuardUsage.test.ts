import { beforeEach, describe, expect, it, vi } from 'vitest';

// Per this repo's vi.mock hoisting trap (factories hoist to the top of the
// file in source order, so a factory with a baked-in value gets silently
// reused/overwritten across every it() block): keep the factory value-free —
// it only forwards to these outer vi.fn()s — and configure behaviour per
// test with .mockResolvedValueOnce()/.mockRejectedValueOnce() instead of
// baking return values into the factory itself. Modelled on
// wizmatchSourceLockAndRecovery.test.ts, which tests the sibling
// withWizmatchSourceLock this file's withSeoSiteLock is copied from.
const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock('../db/index', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: (...args: unknown[]) => mockPoolConnect(...args),
  },
}));

const mockLoggerError = vi.fn();
vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => mockLoggerError(...args) },
}));

import { getSeoCostGuardConfig, emptySeoCostGuardUsage, type SeoCostGuardEstimatedCalls } from '../services/seoCostGuard';
import {
  fetchSeoCostGuardUsage,
  guardSeoSpend,
  recordSeoApiUsage,
  SeoCostGuardBlockedError,
  withSeoSiteLock,
} from '../services/seoCostGuardUsage';

function estimate(overrides: Partial<SeoCostGuardEstimatedCalls> = {}): SeoCostGuardEstimatedCalls {
  return { serperCalls: 0, pagespeedCalls: 0, llmCalls: 0, gscCalls: 0, ga4Calls: 0, publishes: 0, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
});

describe('fetchSeoCostGuardUsage', () => {
  it('populates every one of the eight usage fields from the single-row SQL result', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        month_cost_cents: '1500',
        day_cost_cents: '300',
        tenant_day_serper_calls: '4',
        site_day_serper_calls: '2',
        tenant_day_pagespeed_calls: '6',
        tenant_day_gsc_calls: '9',
        tenant_day_ga4_calls: '11',
        site_day_publishes: '1',
      }],
    });

    const usage = await fetchSeoCostGuardUsage('tenant-1', 'site-1', new Date('2026-08-05T10:00:00.000Z'));

    expect(usage).toEqual({
      monthCostCents: 1500,
      dayCostCents: 300,
      tenantDaySerperCalls: 4,
      siteDaySerperCalls: 2,
      tenantDayPagespeedCalls: 6,
      tenantDayGscCalls: 9,
      tenantDayGa4Calls: 11,
      siteDayPublishes: 1,
    });
    // One round trip only — not eight queries.
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it('keeps GSC and GA4 call counts on independent SQL filters — a row cannot cross-contaminate the other provider\'s counter', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ ...zeroRow(), tenant_day_gsc_calls: '5', tenant_day_ga4_calls: '9' }],
    });

    const usage = await fetchSeoCostGuardUsage('tenant-1', 'site-1', new Date('2026-08-05T10:00:00.000Z'));

    // Distinct values landing in distinct fields (not swapped, not summed)
    // proves the query filters each provider separately.
    expect(usage.tenantDayGscCalls).toBe(5);
    expect(usage.tenantDayGa4Calls).toBe(9);

    const [sql] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/provider = 'gsc'/);
    expect(sql).toMatch(/provider = 'ga4'/);
  });

  it('binds tenant_id in the query, scoped to the caller-supplied tenant', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ...zeroRow() }] });

    await fetchSeoCostGuardUsage('tenant-abc', 'site-1', new Date('2026-08-05T10:00:00.000Z'));

    const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/tenant_id\s*=\s*\$1/);
    expect(params[0]).toBe('tenant-abc');
  });

  it('passes a null siteId straight through as a bound parameter rather than special-casing it', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ ...zeroRow() }] });

    const usage = await fetchSeoCostGuardUsage('tenant-1', null, new Date('2026-08-05T10:00:00.000Z'));

    const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    // site_id = $4::uuid against a NULL parameter evaluates to UNKNOWN for
    // every row, which FILTER treats as "exclude" — no separate IS NULL
    // branch is needed, and the call must not throw building the query.
    expect(sql).toMatch(/site_id\s*=\s*\$4/);
    expect(params[3]).toBeNull();
    expect(usage.siteDaySerperCalls).toBe(0);
    expect(usage.siteDayPublishes).toBe(0);
  });

  it('returns empty usage instead of throwing when seo_api_usage is undefined (42P01)', async () => {
    const error = Object.assign(new Error('relation "seo_api_usage" does not exist'), { code: '42P01' });
    mockPoolQuery.mockRejectedValueOnce(error);

    await expect(fetchSeoCostGuardUsage('tenant-1', 'site-1')).resolves.toEqual(emptySeoCostGuardUsage());
  });

  it('does not swallow unrelated DB errors', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('connection terminated'));

    await expect(fetchSeoCostGuardUsage('tenant-1', 'site-1')).rejects.toThrow('connection terminated');
  });

  function zeroRow() {
    return {
      month_cost_cents: 0,
      day_cost_cents: 0,
      tenant_day_serper_calls: 0,
      site_day_serper_calls: 0,
      tenant_day_pagespeed_calls: 0,
      tenant_day_gsc_calls: 0,
      tenant_day_ga4_calls: 0,
      site_day_publishes: 0,
    };
  }
});

describe('recordSeoApiUsage', () => {
  it('inserts one row binding tenant_id', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await recordSeoApiUsage({ tenantId: 'tenant-1', siteId: 'site-1', provider: 'serper', operation: 'serper_search', calls: 2, costCents: 200 });

    const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO seo_api_usage');
    expect(sql).toMatch(/tenant_id/);
    expect(params).toEqual(['tenant-1', 'site-1', 'serper', 'serper_search', 2, 200]);
  });

  it('never throws when the write fails — swallows and logs instead', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      recordSeoApiUsage({ tenantId: 'tenant-1', provider: 'serper', operation: 'serper_search' }),
    ).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  it('degrades the same way when the table itself is missing (42P01), matching the fetch side', async () => {
    const error = Object.assign(new Error('relation "seo_api_usage" does not exist'), { code: '42P01' });
    mockPoolQuery.mockRejectedValueOnce(error);

    await expect(
      recordSeoApiUsage({ tenantId: 'tenant-1', provider: 'serper', operation: 'serper_search' }),
    ).resolves.toBeUndefined();
  });
});

describe('withSeoSiteLock', () => {
  it('runs the callback and returns its result when the lock is acquired', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] }) // pg_try_advisory_lock
      .mockResolvedValueOnce({ rows: [] }); // pg_advisory_unlock

    const result = await withSeoSiteLock('tenant-1', 'site-1', 'publish', async () => 'done');

    expect(result).toBe('done');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    // Namespaced distinctly from wizmatch's `wizmatch-source:` lock keys so
    // the two guards' hashtext() advisory locks can never collide.
    const lockKeyArg = mockClientQuery.mock.calls[0][1][0] as string;
    expect(lockKeyArg).toBe('seo-site:tenant-1:site-1:publish');
  });

  it('returns null without running the callback when the lock is already held', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const run = vi.fn().mockResolvedValue('should not run');

    const result = await withSeoSiteLock('tenant-1', 'site-1', 'publish', run);

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
    // Only the lock attempt — no matching unlock call — but the client is
    // still released back to the pool.
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('still releases the client and unlocks when the callback throws', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      withSeoSiteLock('tenant-1', 'site-1', 'publish', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    expect(mockClientQuery).toHaveBeenCalledTimes(2); // lock + unlock, even though run() threw
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });
});

describe('guardSeoSpend', () => {
  const zeroUsageRow = {
    rows: [{
      month_cost_cents: 0,
      day_cost_cents: 0,
      tenant_day_serper_calls: 0,
      site_day_serper_calls: 0,
      tenant_day_pagespeed_calls: 0,
      tenant_day_gsc_calls: 0,
      tenant_day_ga4_calls: 0,
      site_day_publishes: 0,
    }],
  };

  it('throws SeoCostGuardBlockedError and never runs the callback when the guard blocks', async () => {
    mockPoolQuery.mockResolvedValueOnce(zeroUsageRow); // the usage fetch only

    const run = vi.fn();
    await expect(
      guardSeoSpend({
        tenantId: 'tenant-1',
        siteId: 'site-1',
        operation: 'publish',
        estimate: estimate({ publishes: 1 }),
        providerEnv: { missing: [] },
        sitePaused: true,
        config: getSeoCostGuardConfig({} as NodeJS.ProcessEnv),
        run,
      }),
    ).rejects.toBeInstanceOf(SeoCostGuardBlockedError);

    expect(run).not.toHaveBeenCalled();
    // Fetch only — no usage row gets recorded for a blocked operation.
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it('records one usage row per nonzero estimate dimension after the callback succeeds', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(zeroUsageRow) // fetch
      .mockResolvedValue({ rows: [], rowCount: 1 }); // every insert

    const run = vi.fn().mockResolvedValue('ok');
    const { result } = await guardSeoSpend({
      tenantId: 'tenant-1',
      siteId: 'site-1',
      operation: 'serper_search',
      estimate: estimate({ serperCalls: 2, llmCalls: 1 }),
      providerEnv: { missing: [] },
      config: getSeoCostGuardConfig({} as NodeJS.ProcessEnv),
      run,
    });

    expect(result).toBe('ok');
    // 1 fetch + 2 inserts (serper, llm) — pagespeed/gsc/publishes stayed at 0 and are not recorded.
    expect(mockPoolQuery).toHaveBeenCalledTimes(3);
    const insertCalls = mockPoolQuery.mock.calls.slice(1);
    const serperInsert = insertCalls.find(([, params]) => (params as unknown[])[2] === 'serper');
    const llmInsert = insertCalls.find(([, params]) => (params as unknown[])[2] === 'llm');
    expect((serperInsert?.[1] as unknown[])[4]).toBe(2); // calls
    expect((serperInsert?.[1] as unknown[])[5]).toBe(200); // 2 * default SEO_SERPER_COST_CENTS (100)
    expect((llmInsert?.[1] as unknown[])[4]).toBe(1);
    expect((llmInsert?.[1] as unknown[])[5]).toBe(500); // default SEO_LLM_COST_CENTS
  });

  it('records a ga4 usage row at zero cost, separate from the gsc row, when both are nonzero', async () => {
    mockPoolQuery
      .mockResolvedValueOnce(zeroUsageRow) // fetch
      .mockResolvedValue({ rows: [], rowCount: 1 }); // every insert

    const run = vi.fn().mockResolvedValue('ok');
    await guardSeoSpend({
      tenantId: 'tenant-1',
      siteId: 'site-1',
      operation: 'ga4_pull',
      estimate: estimate({ gscCalls: 2, ga4Calls: 1 }),
      providerEnv: { missing: [] },
      config: getSeoCostGuardConfig({} as NodeJS.ProcessEnv),
      run,
    });

    const insertCalls = mockPoolQuery.mock.calls.slice(1);
    const gscInsert = insertCalls.find(([, params]) => (params as unknown[])[2] === 'gsc');
    const ga4Insert = insertCalls.find(([, params]) => (params as unknown[])[2] === 'ga4');
    expect(gscInsert).toBeDefined();
    expect(ga4Insert).toBeDefined();
    // Distinct rows, distinct call counts — a GA4 estimate never gets folded
    // into the GSC row or vice versa.
    expect((gscInsert?.[1] as unknown[])[4]).toBe(2);
    expect((ga4Insert?.[1] as unknown[])[4]).toBe(1);
    expect((ga4Insert?.[1] as unknown[])[5]).toBe(0); // ga4 carries no direct provider cost
  });
});
