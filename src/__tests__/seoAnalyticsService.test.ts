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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing seo_weekly_metrics row for this (tenant, site,
  // week) — the UPDATE matches nothing, so persistGa4Sessions falls through
  // to INSERT. Individual tests override this to simulate a GSC row already
  // sitting there.
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
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
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'row-1' }], rowCount: 1 });
    const client = fakeClient(async () => sessionsResponse(500));

    await runSeoAnalyticsPull('tenant-1', { client, now: NOW });

    expect(mockPoolQuery).toHaveBeenCalledTimes(1); // UPDATE only — no fallback INSERT
    const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE seo_weekly_metrics');
    expect(sql).not.toContain('INSERT');
    expect(params[0]).toBe(500); // sessions value bound first
    expect(params[1]).toBe('tenant-1'); // tenant_id
    expect(params[2]).toBe('site-1'); // site_id
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
