import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per this repo's vi.mock hoisting trap (factories hoist to the top of the
// file in source order, so a factory with a baked-in value gets silently
// reused/overwritten across every it() block — see seoCostGuardUsage.test.ts's
// header comment, and seoSearchConsoleService.test.ts's own copy of this same
// note): keep every factory value-free, forwarding only to these outer
// vi.fn()s, and configure behaviour per test with
// .mockResolvedValueOnce()/.mockImplementation() instead.
const mockPoolQuery = vi.fn();
vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
vi.mock('../utils/logger', () => ({
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

const mockResolveDefaultSeoTenantId = vi.fn();
vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: (...args: unknown[]) => mockResolveDefaultSeoTenantId(...args),
}));

const mockListSeoSites = vi.fn();
vi.mock('../services/seoSiteRegistry', () => ({
  listSeoSites: (...args: unknown[]) => mockListSeoSites(...args),
}));

import {
  runSeoAnalyticsPull,
  type SeoAnalyticsClient,
  type SeoAnalyticsRow,
} from '../services/seoAnalyticsService';
import type { SeoSite } from '../services/seoSiteRegistry';

function site(overrides: Partial<SeoSite> = {}): SeoSite {
  return {
    id: 'site-1',
    tenantId: 'tenant-1',
    clientId: null,
    label: 'Example Co',
    domain: 'example.com',
    platform: 'wordpress',
    adapterConfig: {},
    credentialProvider: null,
    gscProperty: null,
    ga4PropertyId: '123456789',
    riskProfile: 'standard',
    requiredChecks: [],
    autoPublishAllowed: false,
    observationWindowDays: 21,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type RunReportArgs = {
  property: string;
  requestBody: { dateRanges: Array<{ startDate: string; endDate: string }>; metrics: Array<{ name: string }> };
};

function fakeClient(
  impl: (args: RunReportArgs) => Promise<{ data: { rows?: SeoAnalyticsRow[] } }>,
): SeoAnalyticsClient {
  return { properties: { runReport: vi.fn(impl) } };
}

function sessionsResponse(sessions: number): { data: { rows: SeoAnalyticsRow[] } } {
  return { data: { rows: [{ metricValues: [{ value: String(sessions) }] }] } };
}

const NOW = new Date('2026-08-05T00:00:00.000Z');

// Shape fetchSeoCostGuardUsage (seoCostGuardUsage.ts) expects back from its
// single-row aggregate query — see that file's own test for the full field
// list. Zeroed by default so the cost guard, now wired into
// runSeoAnalyticsPull's per-site loop, allows every call unless a test
// deliberately pushes a field up to its cap.
function usageFetchRow(overrides: Partial<Record<string, string | number>> = {}) {
  return {
    month_cost_cents: 0,
    day_cost_cents: 0,
    tenant_day_serper_calls: 0,
    site_day_serper_calls: 0,
    tenant_day_pagespeed_calls: 0,
    tenant_day_gsc_calls: 0,
    tenant_day_ga4_calls: 0,
    site_day_publishes: 0,
    ...overrides,
  };
}

// Mutable per-test override for the seo_weekly_metrics UPDATE response —
// set by a test that wants to simulate an existing row (see the "merges
// into an existing row" test below). Reset to "no match" in beforeEach.
let weeklyMetricsUpdateResult: { rows: unknown[]; rowCount: number } = { rows: [], rowCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  weeklyMetricsUpdateResult = { rows: [], rowCount: 0 };
  // Routed by SQL shape, not call order: runSeoAnalyticsPull's per-site loop
  // now wraps its GA4 call in guardSeoSpend (seoCostGuardUsage.ts), which
  // fires its own usage-fetch/usage-record queries against this same mocked
  // pool ahead of and after the seo_weekly_metrics persistence queries this
  // file originally assumed were the only ones. Routing by SQL text keeps
  // every test below agnostic to how many cost-guard queries land in
  // between.
  mockPoolQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM seo_api_usage')) return { rows: [usageFetchRow()], rowCount: 1 };
    if (sql.includes('INSERT INTO seo_api_usage')) return { rows: [], rowCount: 1 };
    if (sql.includes('UPDATE seo_weekly_metrics')) return weeklyMetricsUpdateResult;
    if (sql.includes('INSERT INTO seo_weekly_metrics')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

describe('runSeoAnalyticsPull', () => {
  it('skips a site with no ga4PropertyId configured, without counting it as an error', async () => {
    mockListSeoSites.mockResolvedValueOnce([site({ ga4PropertyId: null })]);
    const client = fakeClient(async () => sessionsResponse(0));

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 0, rows: 0, errors: 0 });
    expect(client.properties.runReport).not.toHaveBeenCalled();
  });

  it('only pulls for active sites — a paused site is skipped like a missing ga4PropertyId', async () => {
    mockListSeoSites.mockResolvedValueOnce([site({ status: 'paused' })]);
    const client = fakeClient(async () => sessionsResponse(0));

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 0, rows: 0, errors: 0 });
    expect(client.properties.runReport).not.toHaveBeenCalled();
  });

  it('resolves the default SEO tenant when tenantId is omitted', async () => {
    mockResolveDefaultSeoTenantId.mockResolvedValueOnce('tenant-default');
    mockListSeoSites.mockResolvedValueOnce([]);
    const client = fakeClient(async () => sessionsResponse(0));

    const result = await runSeoAnalyticsPull(undefined, { client, now: NOW });

    expect(mockResolveDefaultSeoTenantId).toHaveBeenCalledOnce();
    expect(mockListSeoSites).toHaveBeenCalledWith('tenant-default');
    expect(result).toEqual({ sites: 0, rows: 0, errors: 0 });
  });

  it('queries the property with a dimensionless 28-day window and inserts a fresh row when none exists for this week, binding tenant_id + site_id', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    const client = fakeClient(async () => sessionsResponse(842));

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 1, rows: 1, errors: 0 });

    expect(client.properties.runReport).toHaveBeenCalledOnce();
    const call = (client.properties.runReport as ReturnType<typeof vi.fn>).mock.calls[0][0] as RunReportArgs;
    expect(call.property).toBe('properties/123456789');
    expect(call.requestBody.metrics).toEqual([{ name: 'sessions' }]);
    expect(call.requestBody.dateRanges).toHaveLength(1);
    expect(call.requestBody.dateRanges[0].startDate).toBe('2026-07-08'); // 28 days before endDate
    expect(call.requestBody.dateRanges[0].endDate).toBe('2026-08-04'); // yesterday relative to NOW

    const calls = mockPoolQuery.mock.calls as [string, unknown[]][];
    const update = calls.find(([sql]) => sql.includes('UPDATE seo_weekly_metrics'));
    const insert = calls.find(([sql]) => sql.includes('INSERT INTO seo_weekly_metrics'));
    expect(update).toBeDefined();
    expect(insert).toBeDefined();
    // UPDATE ran first and matched nothing (rowCount 0), so INSERT ran too.
    expect(insert?.[1][0]).toBe('tenant-1'); // tenant_id
    expect(insert?.[1][1]).toBe('site-1'); // site_id
    expect(insert?.[1]).toContain(842); // total_sessions / ga4_sessions
  });

  it('merges into an existing row for the same site+week (UPDATE only) instead of inserting a duplicate, leaving no INSERT behind', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    // Simulate a GSC row already present for this (tenant, site, week): the
    // UPDATE matches one row.
    weeklyMetricsUpdateResult = { rows: [{ id: 'row-1' }], rowCount: 1 };
    const client = fakeClient(async () => sessionsResponse(500));

    await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    // Filtered to seo_weekly_metrics calls only — the cost guard's own
    // usage-fetch/usage-record queries against seo_api_usage also hit this
    // mocked pool now, and are irrelevant to what this test asserts.
    const weeklyMetricsCalls = (mockPoolQuery.mock.calls as [string, unknown[]][])
      .filter(([sql]) => sql.includes('seo_weekly_metrics'));
    expect(weeklyMetricsCalls).toHaveLength(1); // UPDATE only — no fallback INSERT
    const [sql, params] = weeklyMetricsCalls[0];
    expect(sql).toContain('UPDATE seo_weekly_metrics');
    expect(sql).not.toContain('INSERT');
    expect(params[0]).toBe(500); // sessions value bound first
    expect(params[1]).toBe('tenant-1'); // tenant_id
    expect(params[2]).toBe('site-1'); // site_id
  });

  it('routes the GA4 call through the SEO cost guard, recording exactly 1 ga4 call at zero cost', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    const client = fakeClient(async () => sessionsResponse(300));

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 1, rows: 1, errors: 0 });

    const calls = mockPoolQuery.mock.calls as [string, unknown[]][];
    const usageFetch = calls.find(([sql]) => sql.includes('FROM seo_api_usage'));
    expect(usageFetch).toBeDefined(); // the guard actually consulted usage before calling GA4

    const usageInsert = calls.find(([sql, params]) => sql.includes('INSERT INTO seo_api_usage') && (params as unknown[])[2] === 'ga4');
    expect(usageInsert).toBeDefined();
    expect((usageInsert?.[1] as unknown[])[4]).toBe(1); // calls
    expect((usageInsert?.[1] as unknown[])[5]).toBe(0); // costCents — GA4 carries no direct provider cost
  });

  it('skips a site blocked by the SEO cost guard rather than crashing the sweep, and still pulls the next site', async () => {
    mockListSeoSites.mockResolvedValueOnce([
      site({ id: 'site-capped', domain: 'capped.example.com', ga4PropertyId: '111' }),
      site({ id: 'site-ok', domain: 'ok.example.com', ga4PropertyId: '222' }),
    ]);
    // The first guard check (site-capped) sees the tenant already at its GA4
    // cap; every later "FROM seo_api_usage" call falls back to the
    // zero-usage default from beforeEach, so site-ok's own guard check
    // passes normally right after.
    mockPoolQuery.mockImplementationOnce(async () => ({ rows: [usageFetchRow({ tenant_day_ga4_calls: 200 })], rowCount: 1 }));
    const client = fakeClient(async () => sessionsResponse(10));

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result.sites).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.rows).toBe(1); // only site-ok persisted
    expect(client.properties.runReport).toHaveBeenCalledTimes(1); // the capped site never reached the GA4 API call
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('capped.example.com'));
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('tenant_daily_ga4_cap_exhausted'));
  });

  it('does not abort the sweep when one site fails — the other site still gets pulled and persisted', async () => {
    mockListSeoSites.mockResolvedValueOnce([
      site({ id: 'site-a', domain: 'a.example.com', ga4PropertyId: '111' }),
      site({ id: 'site-b', domain: 'b.example.com', ga4PropertyId: '222' }),
    ]);
    const client = fakeClient(async (args) => {
      if (args.property === 'properties/111') {
        throw Object.assign(new Error('boom'), { code: 500 });
      }
      return sessionsResponse(10);
    });

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result.sites).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.rows).toBe(1); // only site-b persisted
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('a.example.com'));
  });

  it('classifies a 401 as an auth problem, distinct from a 429 quota problem', async () => {
    mockListSeoSites.mockResolvedValueOnce([site({ id: 'site-401', domain: 'unauth.example.com', ga4PropertyId: '401' })]);
    const authClient = fakeClient(async () => {
      throw Object.assign(new Error('Invalid Credentials'), { code: 401 });
    });
    const authResult = await runSeoAnalyticsPull('tenant-1', { client: authClient, now: NOW });
    expect(authResult.errors).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('auth:'));

    mockLoggerError.mockClear();
    mockListSeoSites.mockResolvedValueOnce([site({ id: 'site-429', domain: 'overquota.example.com', ga4PropertyId: '429' })]);
    const quotaClient = fakeClient(async () => {
      throw Object.assign(new Error('Quota exceeded'), { code: 429 });
    });
    const quotaResult = await runSeoAnalyticsPull('tenant-1', { client: quotaClient, now: NOW });
    expect(quotaResult.errors).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('quota:'));
  });

  it('treats a missing/zero-row GA4 response as zero sessions rather than throwing', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    const client = fakeClient(async () => ({ data: { rows: [] } }));

    const result = await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 1, rows: 1, errors: 0 });
    const insert = (mockPoolQuery.mock.calls as [string, unknown[]][]).find(([sql]) => sql.includes('INSERT INTO seo_weekly_metrics'));
    expect(insert?.[1]).toContain(0);
  });

  describe('credential safety', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('never logs the raw refresh token or client secret, even when the underlying error message contains them', async () => {
      process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN = 'super-secret-refresh-token-value';
      process.env.GOOGLE_SEO_OAUTH_CLIENT_SECRET = 'super-secret-client-secret-value';

      mockListSeoSites.mockResolvedValueOnce([site()]);
      const client = fakeClient(async () => {
        throw Object.assign(
          new Error('token refresh failed for super-secret-refresh-token-value using super-secret-client-secret-value'),
          { code: 401 },
        );
      });

      await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

      const allLoggedText = [
        ...mockLoggerError.mock.calls,
        ...mockLoggerWarn.mock.calls,
        ...mockLoggerInfo.mock.calls,
      ]
        .flat()
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
        .join('\n');

      expect(allLoggedText).not.toContain('super-secret-refresh-token-value');
      expect(allLoggedText).not.toContain('super-secret-client-secret-value');
      expect(allLoggedText).toContain('[redacted]');
    });
  });
});
