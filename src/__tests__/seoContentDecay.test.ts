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
      // 2. Learning loop: computeOpportunityTypeSuccessRates() — no history yet
      .mockResolvedValueOnce({ rows: [] } as any)
      // 3. Decayed keywords CTE query
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
      // 4. Dedup check — no existing opportunity
      .mockResolvedValueOnce({ rows: [] } as any)
      // 5. INSERT RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'abc-123' }] } as any)
      // 6. Content-calendar insert (linked to the new opportunity)
      .mockResolvedValueOnce({ rows: [] } as any)
      // 7. Top-100 fallout query — nothing lost
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await runContentDecayDetection();

    expect(result.opportunities).toBe(1);

    const allCalls = vi.mocked(pool.query).mock.calls;
    const insertCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seo_opportunities'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(expect.any(Array));

    const calendarCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seo_content_calendar'),
    );
    expect(calendarCall).toBeDefined();
    // opportunity_id (last param) must be the id returned by the seo_opportunities INSERT
    expect(calendarCall![1]).toContain('abc-123');
  });

  // -------------------------------------------------------------------------
  // 3. Dedup — same opportunity exists within 14 days → skip insertion
  // -------------------------------------------------------------------------
  it('skips duplicate opportunity for same keyword within 14 days', async () => {
    vi.mocked(pool.query)
      // 1. Pre-flight: recent rows exist
      .mockResolvedValueOnce({ rows: [{ cnt: 10 }] } as any)
      // 2. Learning loop: computeOpportunityTypeSuccessRates() — no history yet
      .mockResolvedValueOnce({ rows: [] } as any)
      // 3. Decayed keywords CTE query
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
      // 4. Dedup check — existing opportunity found (skip INSERT)
      .mockResolvedValueOnce({ rows: [{ id: 'existing-opp' }] } as any)
      // 5. Top-100 fallout query — nothing lost
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
      // 2. Learning loop: computeOpportunityTypeSuccessRates() — no history yet
      .mockResolvedValueOnce({ rows: [] } as any)
      // 3. Decayed keywords CTE — nothing decayed
      .mockResolvedValueOnce({ rows: [] } as any)
      // 4. Top-100 fallout query — one lost page
      .mockResolvedValueOnce({
        rows: [{
          client_domain: 'aarohaom.com',
          project_name: 'aarohaom.com',
          keyword: 'ayurveda jaipur',
          current_position: 45,
          recorded_date: '2026-04-01',
        }],
      } as any)
      // 5. Dedup check for lost_ranking — not exists
      .mockResolvedValueOnce({ rows: [] } as any)
      // 6. INSERT RETURNING id for lost_ranking
      .mockResolvedValueOnce({ rows: [{ id: 'lost-uuid' }] } as any)
      // 7. Content-calendar insert (linked to the new opportunity)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await runContentDecayDetection();

    expect(result.opportunities).toBe(1);

    const allCalls = vi.mocked(pool.query).mock.calls;
    const insertCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("'lost_ranking'"),
    );
    expect(insertCall).toBeDefined();

    const calendarCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seo_content_calendar'),
    );
    expect(calendarCall).toBeDefined();
    expect(calendarCall![1]).toContain('lost-uuid');
  });

  // -------------------------------------------------------------------------
  // 5. Learning loop — priority score is nudged once sampleSize >= 10 for the
  //    opportunity type, and left unadjusted below that threshold.
  // -------------------------------------------------------------------------
  it('nudges priority_score using historical success rate once sampleSize >= 10', async () => {
    vi.mocked(pool.query)
      // 1. Pre-flight: recent rows exist
      .mockResolvedValueOnce({ rows: [{ cnt: 10 }] } as any)
      // 2. Learning loop: strong historical performance for content_decay (successRate 0.8, sampleSize 12)
      .mockResolvedValueOnce({
        rows: [{ opportunity_type: 'content_decay', sample_size: 12, successes: 10 }],
      } as any)
      // 3. Decayed keywords CTE query — drop of 15, impact 'high' (>20? no, 15 -> medium), impactWeight 2
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
      // 4. Dedup check — no existing opportunity
      .mockResolvedValueOnce({ rows: [] } as any)
      // 5. INSERT RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'abc-456' }] } as any)
      // 6. Content-calendar insert
      .mockResolvedValueOnce({ rows: [] } as any)
      // 7. Top-100 fallout query — nothing lost
      .mockResolvedValueOnce({ rows: [] } as any);

    await runContentDecayDetection();

    const allCalls = vi.mocked(pool.query).mock.calls;
    const insertCall = allCalls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO seo_opportunities'),
    );
    expect(insertCall).toBeDefined();
    // raw score: drop=15, impact='medium' (10<15<=20) -> weight 2 -> 15*2=30
    // successRate 0.8 -> multiplier clamped to 1.2 -> round(30*1.2) = 36
    // priority_score is second-to-last bound param — tenant_id (H18) is last.
    const params = insertCall![1] as unknown[];
    expect(params[params.length - 2]).toBe(36);
    expect(params[params.length - 1]).toBe('tenant-seo-default');
  });
});
