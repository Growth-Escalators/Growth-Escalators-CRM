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

// ---------------------------------------------------------------------------
// Tests for seoWorkflowHealthService.checkAndIncrementSeoSerperCap()
//
// The SEO-side Serper daily cost cap (seo-learning-loop). rankTrackingService
// is the cap's first/primary consumer, so this lives alongside its tests.
// SEO_SERPER_DAILY_CAP is read once at module load time, so each test resets
// the module registry with the env var set before re-importing.
// ---------------------------------------------------------------------------
describe('checkAndIncrementSeoSerperCap', () => {
  const originalCap = process.env.SEO_SERPER_DAILY_CAP;

  afterEach(() => {
    if (originalCap !== undefined) {
      process.env.SEO_SERPER_DAILY_CAP = originalCap;
    } else {
      delete process.env.SEO_SERPER_DAILY_CAP;
    }
    vi.useRealTimers();
  });

  it('allows calls under the cap and blocks at/over it', async () => {
    process.env.SEO_SERPER_DAILY_CAP = '3';
    vi.resetModules();
    const { checkAndIncrementSeoSerperCap } = await import('../services/seoWorkflowHealthService');

    expect(checkAndIncrementSeoSerperCap()).toBe(true);  // 1 — under cap
    expect(checkAndIncrementSeoSerperCap()).toBe(true);  // 2 — under cap
    expect(checkAndIncrementSeoSerperCap()).toBe(true);  // 3 — at cap (this call itself is allowed)
    expect(checkAndIncrementSeoSerperCap()).toBe(false); // 4 — over cap, blocked
    expect(checkAndIncrementSeoSerperCap()).toBe(false); // 5 — still blocked
  });

  it('falls back to a default cap of 50 when SEO_SERPER_DAILY_CAP is unset', async () => {
    delete process.env.SEO_SERPER_DAILY_CAP;
    vi.resetModules();
    const { checkAndIncrementSeoSerperCap } = await import('../services/seoWorkflowHealthService');

    for (let i = 0; i < 50; i++) {
      expect(checkAndIncrementSeoSerperCap()).toBe(true);
    }
    expect(checkAndIncrementSeoSerperCap()).toBe(false); // 51st call blocked
  });

  it('resets the count on a new calendar day', async () => {
    process.env.SEO_SERPER_DAILY_CAP = '1';
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T10:00:00Z'));

    const { checkAndIncrementSeoSerperCap } = await import('../services/seoWorkflowHealthService');

    expect(checkAndIncrementSeoSerperCap()).toBe(true);  // uses today's only allowed call
    expect(checkAndIncrementSeoSerperCap()).toBe(false); // capped for today

    vi.setSystemTime(new Date('2026-07-20T10:00:00Z')); // next day
    expect(checkAndIncrementSeoSerperCap()).toBe(true);  // resets on the new day
  });
});
