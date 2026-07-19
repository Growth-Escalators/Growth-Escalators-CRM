import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB pool
// ---------------------------------------------------------------------------
vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock Slack (sendSlackMessage is called on SERPER_API_KEY missing)
// ---------------------------------------------------------------------------
vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/constants', () => ({
  SLACK_SEO_CHANNEL: 'C_SEO_TEST',
}));

// H18 — runRankChecks() now resolves the single default SEO tenant before
// running any query. Mock it directly rather than the full db.select() chain
// seoTenantContext.ts uses internally.
vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-seo-default'),
}));

// ---------------------------------------------------------------------------
// Tests for rankTrackingService.runRankChecks()
// ---------------------------------------------------------------------------
describe('rankTrackingService', () => {
  const originalKey = process.env.SERPER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore env var after each test
    if (originalKey !== undefined) {
      process.env.SERPER_API_KEY = originalKey;
    } else {
      delete process.env.SERPER_API_KEY;
    }
  });

  // -------------------------------------------------------------------------
  // 1. Missing SERPER_API_KEY → throws AND calls sendSlackMessage
  // -------------------------------------------------------------------------
  it('throws and posts Slack alert when SERPER_API_KEY is missing', async () => {
    // The module reads SERPER_API_KEY at import time, so we must reset modules
    // and re-import with the env var deleted to exercise the guard at call time.
    delete process.env.SERPER_API_KEY;

    // Reset module registry so rankTrackingService re-evaluates the top-level
    // const SERPER_API_KEY = process.env.SERPER_API_KEY with our deleted value.
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.mock('../db/index', () => ({
      pool: { query: vi.fn() },
    }));
    vi.mock('../services/slackService', () => ({
      sendSlackMessage: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mock('../config/constants', () => ({
      SLACK_SEO_CHANNEL: 'C_SEO_TEST',
    }));
    vi.mock('../services/seoTenantContext', () => ({
      resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-seo-default'),
    }));

    const { runRankChecks } = await import('../services/rankTrackingService');
    const { sendSlackMessage } = await import('../services/slackService');

    await expect(runRankChecks()).rejects.toThrow(/SERPER_API_KEY/);
    expect(sendSlackMessage).toHaveBeenCalledOnce();
    expect(vi.mocked(sendSlackMessage).mock.calls[0][1]).toMatch(/SERPER_API_KEY/);
  });

  // -------------------------------------------------------------------------
  // 2. Happy path — valid API key, Serper returns results
  //    This test mocks fetch and pool.query to verify the function completes
  //    and returns the expected shape { checked: N, errors: N }.
  // -------------------------------------------------------------------------
  it('returns { checked, errors } shape when Serper returns valid data', async () => {
    process.env.SERPER_API_KEY = 'test-serper-key';
    vi.resetModules();

    vi.mock('../db/index', () => ({
      pool: { query: vi.fn() },
    }));
    vi.mock('../services/slackService', () => ({
      sendSlackMessage: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mock('../config/constants', () => ({
      SLACK_SEO_CHANNEL: 'C_SEO_TEST',
    }));
    vi.mock('../services/seoTenantContext', () => ({
      resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-seo-default'),
    }));

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [
          { position: 5, title: 'Aaroha Om', link: 'https://aarohaom.com/page', domain: 'aarohaom.com' },
        ],
        answerBox: undefined,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { pool } = await import('../db/index');
    const { runRankChecks } = await import('../services/rankTrackingService');

    // pool.query called at least for: getKeywordsToTrack, getPreviousPosition, INSERT
    // getKeywordsToTrack — returns existing keywords from DB
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [{
          project_name: 'aarohaom',
          client_domain: 'aarohaom.com',
          keyword: 'ayurvedic treatment',
        }],
      } as any)
      // getPreviousPosition query
      .mockResolvedValueOnce({ rows: [] } as any)
      // INSERT keyword_rankings
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await runRankChecks();

    expect(result).toHaveProperty('checked');
    expect(result).toHaveProperty('errors');
    expect(typeof result.checked).toBe('number');
    expect(typeof result.errors).toBe('number');
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    vi.unstubAllGlobals();
  });
});
