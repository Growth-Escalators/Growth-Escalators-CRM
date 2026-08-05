import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per this repo's vi.mock hoisting trap (factories hoist to the top of the
// file in source order, so a factory with a baked-in value gets silently
// reused/overwritten across every it() block — see seoCostGuardUsage.test.ts's
// header comment): keep every factory value-free, forwarding only to these
// outer vi.fn()s, and configure behaviour per test with
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

// guardSeoSpend itself has its own full test coverage in
// seoCostGuardUsage.test.ts — mocked here so this file tests only
// seoSearchConsoleService's own logic (site iteration, skip rules, error
// classification, persistence), not the guard's internals. The real
// SeoCostGuardBlockedError class is preserved via importOriginal so
// `instanceof` checks inside the service under test still work — it's the
// same class reference on both sides of the mock boundary.
const mockGuardSeoSpend = vi.fn();
vi.mock('../services/seoCostGuardUsage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/seoCostGuardUsage')>();
  return {
    ...actual,
    guardSeoSpend: (...args: unknown[]) => mockGuardSeoSpend(...args),
  };
});

import { SeoCostGuardBlockedError } from '../services/seoCostGuardUsage';
import type { SeoCostGuardEvaluation } from '../services/seoCostGuard';
import {
  runSeoSearchConsolePull,
  type SeoSearchConsoleClient,
  type SeoSearchConsoleRow,
} from '../services/seoSearchConsoleService';
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
    gscProperty: 'sc-domain:example.com',
    ga4PropertyId: null,
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

type GscQueryArgs = {
  siteUrl: string;
  requestBody: { startDate: string; endDate: string; dimensions?: string[]; rowLimit?: number };
};

function fakeClient(
  impl: (args: GscQueryArgs) => Promise<{ data: { rows?: SeoSearchConsoleRow[] } }>,
): SeoSearchConsoleClient {
  return { searchanalytics: { query: vi.fn(impl) } };
}

const NOW = new Date('2026-08-05T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  // Default: run the guard's caller-supplied work and pass its result through
  // unchanged, as if the guard always allowed the call — individual tests
  // override this to simulate a block.
  mockGuardSeoSpend.mockImplementation(async (input: { run: () => Promise<unknown> }) => ({
    evaluation: { allowed: true } as unknown as SeoCostGuardEvaluation,
    result: await input.run(),
  }));
});

describe('runSeoSearchConsolePull', () => {
  it('skips a site with no gscProperty configured, without counting it as an error', async () => {
    mockListSeoSites.mockResolvedValueOnce([site({ gscProperty: null })]);
    const client = fakeClient(async () => ({ data: { rows: [] } }));

    const result = await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 0, rows: 0, errors: 0 });
    expect(client.searchanalytics.query).not.toHaveBeenCalled();
    expect(mockGuardSeoSpend).not.toHaveBeenCalled();
  });

  it('only pulls for active sites — a paused site is skipped like a missing gscProperty', async () => {
    mockListSeoSites.mockResolvedValueOnce([site({ status: 'paused' })]);
    const client = fakeClient(async () => ({ data: { rows: [] } }));

    const result = await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 0, rows: 0, errors: 0 });
    expect(client.searchanalytics.query).not.toHaveBeenCalled();
  });

  it('resolves the default SEO tenant when tenantId is omitted', async () => {
    mockResolveDefaultSeoTenantId.mockResolvedValueOnce('tenant-default');
    mockListSeoSites.mockResolvedValueOnce([]);
    const client = fakeClient(async () => ({ data: { rows: [] } }));

    const result = await runSeoSearchConsolePull(undefined, { client, now: NOW });

    expect(mockResolveDefaultSeoTenantId).toHaveBeenCalledOnce();
    expect(mockListSeoSites).toHaveBeenCalledWith('tenant-default');
    expect(result).toEqual({ sites: 0, rows: 0, errors: 0 });
  });

  it('persists totals to seo_weekly_metrics and per-query rows to keyword_rankings, binding tenant_id + site_id on every write', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    const client = fakeClient(async (args) => {
      if (!args.requestBody.dimensions) {
        return { data: { rows: [{ clicks: 120, impressions: 4000, ctr: 0.03, position: 8.4 }] } };
      }
      return {
        data: {
          rows: [
            { keys: ['growth agency'], clicks: 10, impressions: 200, position: 5.2 },
            { keys: ['b2b outreach'], clicks: 4, impressions: 90, position: 12.1 },
          ],
        },
      };
    });

    const result = await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

    // 1 totals row + 2 query rows
    expect(result).toEqual({ sites: 1, rows: 3, errors: 0 });

    // Two GSC calls: one totals (no dimensions), one query-dimension (rowLimit 25).
    expect(client.searchanalytics.query).toHaveBeenCalledTimes(2);
    const calls = (client.searchanalytics.query as ReturnType<typeof vi.fn>).mock.calls as [GscQueryArgs][];
    expect(calls[0][0].siteUrl).toBe('sc-domain:example.com');
    expect(calls[0][0].requestBody.dimensions).toBeUndefined(); // totals call — no dimension
    expect(calls[1][0]).toMatchObject({ siteUrl: 'sc-domain:example.com', requestBody: { dimensions: ['query'], rowLimit: 25 } });

    const inserts = mockPoolQuery.mock.calls as [string, unknown[]][];
    const weeklyInsert = inserts.find(([sql]) => sql.includes('INSERT INTO seo_weekly_metrics'));
    expect(weeklyInsert?.[1][0]).toBe('tenant-1'); // tenant_id
    expect(weeklyInsert?.[1][1]).toBe('site-1'); // site_id
    expect(weeklyInsert?.[1]).toContain(120); // total_clicks
    expect(weeklyInsert?.[1]).toContain(4000); // total_impressions

    const keywordInserts = inserts.filter(([sql]) => sql.includes('INSERT INTO keyword_rankings'));
    expect(keywordInserts).toHaveLength(2);
    for (const [, params] of keywordInserts) {
      expect(params[0]).toBe('tenant-1'); // tenant_id
      expect(params[1]).toBe('site-1'); // site_id
    }
  });

  it('computes previousPosition/positionChange from the most recent prior row for that keyword', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT current_position')) return { rows: [{ current_position: '10.5' }] };
      return { rows: [] };
    });
    const client = fakeClient(async (args) => {
      if (!args.requestBody.dimensions) return { data: { rows: [{ clicks: 1, impressions: 1, position: 1 }] } };
      return { data: { rows: [{ keys: ['seo tools'], position: 7.5 }] } };
    });

    await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

    const inserts = mockPoolQuery.mock.calls as [string, unknown[]][];
    const kwInsert = inserts.find(([sql]) => sql.includes('INSERT INTO keyword_rankings'));
    expect(kwInsert?.[1]).toContain(7.5); // current_position
    expect(kwInsert?.[1]).toContain(10.5); // previous_position
    expect(kwInsert?.[1]).toContain(3); // position_change = 10.5 - 7.5
  });

  it('does not abort the sweep when one site fails — the other site still gets pulled and persisted', async () => {
    mockListSeoSites.mockResolvedValueOnce([
      site({ id: 'site-a', domain: 'a.example.com', gscProperty: 'sc-domain:a.example.com' }),
      site({ id: 'site-b', domain: 'b.example.com', gscProperty: 'sc-domain:b.example.com' }),
    ]);
    const client = fakeClient(async (args) => {
      if (args.siteUrl === 'sc-domain:a.example.com') {
        throw Object.assign(new Error('boom'), { code: 500 });
      }
      if (!args.requestBody.dimensions) return { data: { rows: [{ clicks: 1, impressions: 2, position: 3 }] } };
      return { data: { rows: [] } };
    });

    const result = await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

    expect(result.sites).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.rows).toBe(1); // only site-b's totals row persisted
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('a.example.com'));
  });

  it('classifies a 401 as an auth problem, distinct from a 429 quota problem', async () => {
    mockListSeoSites.mockResolvedValueOnce([site({ id: 'site-401', domain: 'unauth.example.com', gscProperty: 'sc-domain:unauth.example.com' })]);
    const authClient = fakeClient(async () => {
      throw Object.assign(new Error('Invalid Credentials'), { code: 401 });
    });
    const authResult = await runSeoSearchConsolePull('tenant-1', { client: authClient, now: NOW });
    expect(authResult.errors).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('auth:'));

    mockLoggerError.mockClear();
    mockListSeoSites.mockResolvedValueOnce([site({ id: 'site-429', domain: 'overquota.example.com', gscProperty: 'sc-domain:overquota.example.com' })]);
    const quotaClient = fakeClient(async () => {
      throw Object.assign(new Error('Quota exceeded'), { code: 429 });
    });
    const quotaResult = await runSeoSearchConsolePull('tenant-1', { client: quotaClient, now: NOW });
    expect(quotaResult.errors).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('quota:'));
  });

  it('treats a SeoCostGuardBlockedError as a per-site error rather than throwing out of the sweep', async () => {
    mockListSeoSites.mockResolvedValueOnce([site()]);
    const evaluation = {
      allowed: false,
      blockCode: 'tenant_daily_gsc_cap_exhausted',
      blockReasons: ['Tenant daily Search Console call cap has been reached.'],
    } as unknown as SeoCostGuardEvaluation;
    mockGuardSeoSpend.mockRejectedValueOnce(new SeoCostGuardBlockedError(evaluation));
    const client = fakeClient(async () => ({ data: { rows: [] } }));

    const result = await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

    expect(result).toEqual({ sites: 1, rows: 0, errors: 1 });
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('tenant_daily_gsc_cap_exhausted'));
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

      await runSeoSearchConsolePull('tenant-1', { client, now: NOW });

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
