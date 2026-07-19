import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted above imports by Vitest so static imports below get mocked
// ---------------------------------------------------------------------------
vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/constants', () => ({
  SLACK_SEO_CHANNEL: 'C_SEO_TEST',
}));

// H18 — runContentDecayDetection() now resolves the single default SEO tenant
// before running any query. Mock it directly rather than the full db.select()
// chain seoTenantContext.ts uses internally.
vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-seo-default'),
}));

// Static imports get the mocked versions (vi.mock hoisting guarantees this)
import { pool } from '../db/index';
import { sendSlackMessage } from '../services/slackService';
import { runContentDecayDetection } from '../services/seoContentDecayService';

// ---------------------------------------------------------------------------
// Tests for seoContentDecayService.runContentDecayDetection()
// ---------------------------------------------------------------------------
describe('seoContentDecayService', () => {
  beforeEach(() => {
    // mockReset clears both call history AND the once-queue so tests are isolated
    vi.mocked(pool.query).mockReset();
    vi.mocked(sendSlackMessage).mockReset().mockResolvedValue(undefined as any);
  });

  // -------------------------------------------------------------------------
  // 1. Empty upstream — keyword_rankings has no recent rows
  // -------------------------------------------------------------------------
  it('returns 0 and posts Slack alert when keyword_rankings has no recent rows', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ cnt: 0 }] } as any);

    const result = await runContentDecayDetection();

    expect(result).toEqual({ opportunities: 0 });
    expect(sendSlackMessage).toHaveBeenCalledOnce();
    expect(vi.mocked(sendSlackMessage).mock.calls[0][1]).toMatch(/keyword_rankings/);
  });

  // -------------------------------------------------------------------------
  // 2. Happy path — one decayed keyword, no existing opportunity → inserts
  // -------------------------------------------------------------------------
  it('creates opportunity when keyword drops more than 5 positions', async () => {
    vi.mocked(pool.query)
      // 1. Pre-flight: recent rows exist
      .mockResolvedValueOnce({ rows: [{ cnt: 10 }] } as any)
      // 2. Decayed keywords CTE query
      .mockResolvedValueOnce({
        rows: [{
          client_domain: 'aarohaom.com',
          project_name: 'aarohaom.com',
          keyword: 'dental implants',
          current_position: 25,
          old_position: 10,
          change: -15,
          url_ranking: null,
        }],
      } as any)
      // 3. Dedup check — no existing opportunity
      .mockResolvedValueOnce({ rows: [] } as any)
      // 4. INSERT RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'abc-123' }] } as any)
      // 5. Top-100 fallout query — nothing lost
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await runContentDecayDetection();

    expect(result.opportunities).toBe(1);

    const allCalls = vi.mocked(pool.query).mock.calls;
    const insertCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seo_opportunities'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(expect.any(Array));
  });

  // -------------------------------------------------------------------------
  // 3. Dedup — same opportunity exists within 14 days → skip insertion
  // -------------------------------------------------------------------------
  it('skips duplicate opportunity for same keyword within 14 days', async () => {
    vi.mocked(pool.query)
      // 1. Pre-flight: recent rows exist
      .mockResolvedValueOnce({ rows: [{ cnt: 10 }] } as any)
      // 2. Decayed keywords CTE query
      .mockResolvedValueOnce({
        rows: [{
          client_domain: 'aarohaom.com',
          project_name: 'aarohaom.com',
          keyword: 'dental implants',
          current_position: 25,
          old_position: 10,
          change: -15,
          url_ranking: null,
        }],
      } as any)
      // 3. Dedup check — existing opportunity found (skip INSERT)
      .mockResolvedValueOnce({ rows: [{ id: 'existing-opp' }] } as any)
      // 4. Top-100 fallout query — nothing lost
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await runContentDecayDetection();

    expect(result.opportunities).toBe(0);

    const allCalls = vi.mocked(pool.query).mock.calls;
    const insertCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seo_opportunities'),
    );
    expect(insertCall).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 4. Top-100 fallout — no decay rows but a page that vanished from rankings
  // -------------------------------------------------------------------------
  it('creates lost_ranking opportunity for page that fell out of top 100', async () => {
    vi.mocked(pool.query)
      // 1. Pre-flight: recent rows exist
      .mockResolvedValueOnce({ rows: [{ cnt: 10 }] } as any)
      // 2. Decayed keywords CTE — nothing decayed
      .mockResolvedValueOnce({ rows: [] } as any)
      // 3. Top-100 fallout query — one lost page
      .mockResolvedValueOnce({
        rows: [{
          client_domain: 'aarohaom.com',
          project_name: 'aarohaom.com',
          keyword: 'ayurveda jaipur',
          current_position: 45,
          recorded_date: '2026-04-01',
        }],
      } as any)
      // 4. Dedup check for lost_ranking — not exists
      .mockResolvedValueOnce({ rows: [] } as any)
      // 5. INSERT RETURNING id for lost_ranking
      .mockResolvedValueOnce({ rows: [{ id: 'lost-uuid' }] } as any);

    const result = await runContentDecayDetection();

    expect(result.opportunities).toBe(1);

    const allCalls = vi.mocked(pool.query).mock.calls;
    const insertCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("'lost_ranking'"),
    );
    expect(insertCall).toBeDefined();
  });
});
