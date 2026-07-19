import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted above imports by Vitest so static imports below get mocked
// ---------------------------------------------------------------------------
vi.mock('../db/index', () => ({
  db: {},
  pool: { query: vi.fn() },
}));

// seoDigestService.ts calls resolveDefaultSeoTenantId() (added by the H18 tenant-
// isolation work, merged in after this file was originally written) at the top of
// sendWeeklyOpportunityDigest(). The real implementation calls db.select(...), which
// throws against the empty `db: {}` mock above — caught by that function's outer
// try/catch, silently producing { sent: false } instead of the exception surfacing.
vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-seo-default'),
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn().mockResolvedValue(true),
}));

vi.mock('../config/constants', () => ({
  SLACK_SEO_CHANNEL: 'C_SEO_TEST',
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Static imports get the mocked versions (vi.mock hoisting guarantees this)
import { pool } from '../db/index';
import { sendSlackMessage } from '../services/slackService';
import {
  computeOpportunityTypeSuccessRates,
  applySuccessRateAdjustment,
  formatHistoricalPerformanceNote,
  sendWeeklyOpportunityDigest,
} from '../services/seoDigestService';

// ---------------------------------------------------------------------------
// Minimal Express-router test harness (same pattern used in
// billingRoutes.test.ts) — walks router.stack to find and invoke a route's
// handler chain directly, without needing supertest/a real HTTP server.
// ---------------------------------------------------------------------------
async function invokeRoute(router: any, path: string, method: string, req: any, res: any) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

function makeReqRes(params: Record<string, string>, body: Record<string, unknown>) {
  const req = { params, body, query: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

describe('seo-learning-loop', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    vi.mocked(sendSlackMessage).mockReset().mockResolvedValue(true as any);
  });

  // ---------------------------------------------------------------------------
  // computeOpportunityTypeSuccessRates()
  // ---------------------------------------------------------------------------
  describe('computeOpportunityTypeSuccessRates', () => {
    it('computes successRate + sampleSize per opportunity_type from fixed fixtures', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [
          { opportunity_type: 'content_gap', sample_size: 20, successes: 14 },
          { opportunity_type: 'content_decay', sample_size: 4, successes: 1 },
        ],
      } as any);

      const rates = await computeOpportunityTypeSuccessRates();

      expect(rates.content_gap).toEqual({ successRate: 0.7, sampleSize: 20 });
      expect(rates.content_decay).toEqual({ successRate: 0.25, sampleSize: 4 });
    });

    it('never throws — returns {} when the query fails', async () => {
      vi.mocked(pool.query).mockRejectedValueOnce(new Error('db down'));
      const rates = await computeOpportunityTypeSuccessRates();
      expect(rates).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // applySuccessRateAdjustment()
  // ---------------------------------------------------------------------------
  describe('applySuccessRateAdjustment', () => {
    it('returns the score unadjusted below the sample-size threshold (< 10)', () => {
      const rates = { content_gap: { successRate: 0.9, sampleSize: 9 } };
      expect(applySuccessRateAdjustment(50, rates, 'content_gap')).toBe(50);
    });

    it('returns the score unadjusted when there is no data for the type at all', () => {
      expect(applySuccessRateAdjustment(50, {}, 'content_gap')).toBe(50);
    });

    it('nudges the score up once sampleSize reaches the threshold (>= 10) with a strong rate', () => {
      const rates = { content_gap: { successRate: 0.7, sampleSize: 10 } };
      // multiplier = 1 + (0.7 - 0.5) = 1.2 -> round(50 * 1.2) = 60
      expect(applySuccessRateAdjustment(50, rates, 'content_gap')).toBe(60);
    });

    it('nudges the score down for a weak success rate', () => {
      const rates = { content_gap: { successRate: 0.3, sampleSize: 10 } };
      // multiplier = 1 + (0.3 - 0.5) = 0.8 -> round(50 * 0.8) = 40
      expect(applySuccessRateAdjustment(50, rates, 'content_gap')).toBe(40);
    });

    it('clamps the multiplier to +/-20% even for extreme success rates', () => {
      const rates = { content_gap: { successRate: 1, sampleSize: 50 } };
      // raw multiplier 1.5 clamped to 1.2 -> round(50 * 1.2) = 60
      expect(applySuccessRateAdjustment(50, rates, 'content_gap')).toBe(60);

      const worstRates = { content_gap: { successRate: 0, sampleSize: 50 } };
      // raw multiplier 0.5 clamped to 0.8 -> round(50 * 0.8) = 40
      expect(applySuccessRateAdjustment(50, worstRates, 'content_gap')).toBe(40);
    });

    it('respects explicit min/max bounds after adjustment', () => {
      const rates = { content_gap: { successRate: 0.9, sampleSize: 50 } };
      // 95 * 1.2 = 114, clamped down to the 100 ceiling
      expect(applySuccessRateAdjustment(95, rates, 'content_gap', { max: 100 })).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // formatHistoricalPerformanceNote()
  // ---------------------------------------------------------------------------
  describe('formatHistoricalPerformanceNote', () => {
    it('omits the note entirely below the sample-size floor (no hollow "0% of 0" line)', () => {
      expect(formatHistoricalPerformanceNote('content_gap', {})).toBe('');
      expect(
        formatHistoricalPerformanceNote('content_gap', { content_gap: { successRate: 0.5, sampleSize: 2 } }),
      ).toBe('');
    });

    it('includes a formatted note once the sample size is meaningful', () => {
      const rates = { content_gap: { successRate: 0.6, sampleSize: 8 } };
      const note = formatHistoricalPerformanceNote('content_gap', rates);
      expect(note).toContain('60%');
      expect(note).toContain('8 measured');
      expect(note).toContain('content-gap');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /content-calendar/:id — published_url propagation to seo_opportunities
  // ---------------------------------------------------------------------------
  describe('PATCH /content-calendar/:id — published_url propagation', () => {
    it('propagates published_url to the linked seo_opportunities row', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 42, opportunity_id: 'opp-1', published_url: 'https://x.com/a' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const { default: router } = await import('../routes/seo');
      const { req, res, jsonFn } = makeReqRes({ id: '42' }, { published_url: 'https://x.com/a' });

      await invokeRoute(router, '/content-calendar/:id', 'patch', req, res);

      const calls = vi.mocked(pool.query).mock.calls;
      expect(calls[0][0]).toMatch(/UPDATE seo_content_calendar/);
      expect(calls[1][0]).toMatch(/UPDATE seo_opportunities SET published_url/);
      expect(calls[1][1]).toEqual(['https://x.com/a', 'opp-1']);
      expect(jsonFn).toHaveBeenCalledWith({ id: 42, opportunity_id: 'opp-1', published_url: 'https://x.com/a' });
    });

    it('does not touch seo_opportunities when the calendar row has no opportunity_id', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: 43, opportunity_id: null, published_url: 'https://x.com/b' }],
      } as any);

      const { default: router } = await import('../routes/seo');
      const { req, res } = makeReqRes({ id: '43' }, { published_url: 'https://x.com/b' });

      await invokeRoute(router, '/content-calendar/:id', 'patch', req, res);

      expect(vi.mocked(pool.query).mock.calls.length).toBe(1); // only the calendar UPDATE
    });

    it('does not touch seo_opportunities when published_url is not part of the request', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: 44, opportunity_id: 'opp-2', status: 'writing' }],
      } as any);

      const { default: router } = await import('../routes/seo');
      const { req, res } = makeReqRes({ id: '44' }, { status: 'writing' });

      await invokeRoute(router, '/content-calendar/:id', 'patch', req, res);

      expect(vi.mocked(pool.query).mock.calls.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // End-to-end: the previously-broken outcome-measurement loop now closes.
  //
  // Before Stage 1, nothing ever set seo_opportunities.published_url, so the
  // 14-day outcome check in sendWeeklyOpportunityDigest() could never fire —
  // it had no rows to act on. This test proves the fix: (1) the content-
  // calendar PATCH now propagates published_url onto the linked opportunity,
  // and (2) once that's set and the opportunity is >14 days old, the weekly
  // digest measures the keyword-rank outcome and writes it back.
  // ---------------------------------------------------------------------------
  describe('end-to-end: outcome-measurement loop actually closes', () => {
    it('PATCH propagates published_url, then the weekly digest measures + writes an outcome for it', async () => {
      // ---- Phase 1: simulate publishing a content-calendar row linked to an opportunity ----
      vi.mocked(pool.query)
        .mockResolvedValueOnce({
          rows: [{ id: 99, opportunity_id: 'opp-loop-1', published_url: 'https://aarohaom.com/dental-implants' }],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const { default: router } = await import('../routes/seo');
      const { req: patchReq, res: patchRes } = makeReqRes(
        { id: '99' },
        { published_url: 'https://aarohaom.com/dental-implants' },
      );
      await invokeRoute(router, '/content-calendar/:id', 'patch', patchReq, patchRes);

      const patchCalls = vi.mocked(pool.query).mock.calls;
      expect(patchCalls[1][0]).toMatch(/UPDATE seo_opportunities SET published_url/);
      expect(patchCalls[1][1]).toEqual(['https://aarohaom.com/dental-implants', 'opp-loop-1']);

      // ---- Phase 2: the weekly digest should now be able to measure this opportunity ----
      vi.mocked(pool.query).mockReset();
      const backdatedCreatedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago

      vi.mocked(pool.query)
        // pre-flight — non-empty upstream, so the digest doesn't bail out early
        .mockResolvedValueOnce({ rows: [{ open_opps: 1, recent_alerts: 0, rankings: 5 }] } as any)
        // outcome check: unmeasured opportunities — the one we just "published" above
        .mockResolvedValueOnce({
          rows: [{ id: 'opp-loop-1', client_domain: 'aarohaom.com', keyword: 'dental implants', created_at: backdatedCreatedAt }],
        } as any)
        // current rank
        .mockResolvedValueOnce({ rows: [{ current_position: 4 }] } as any)
        // rank at creation time
        .mockResolvedValueOnce({ rows: [{ current_position: 22 }] } as any)
        // UPDATE seo_opportunities SET outcome = ...
        .mockResolvedValueOnce({ rows: [] } as any);
        // Remaining calls (learning-loop successRates + per-client loop queries) run out
        // of queued mocks and resolve to undefined; each per-client iteration has its own
        // try/catch in sendWeeklyOpportunityDigest, so this degrades gracefully and
        // doesn't affect the assertion below — the outcome UPDATE has already fired.

      const result = await sendWeeklyOpportunityDigest();
      expect(result.sent).toBe(true);

      const digestCalls = vi.mocked(pool.query).mock.calls;
      const outcomeUpdateCall = digestCalls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('UPDATE seo_opportunities SET outcome'),
      );
      expect(outcomeUpdateCall).toBeDefined();
      // rank improved from #22 to #4 (a >5-position gain) -> 'recovered'.
      // Third param is tenant_id (H18's tenant scoping, merged into this same UPDATE).
      expect(outcomeUpdateCall![1]).toEqual(['recovered', 'opp-loop-1', 'tenant-seo-default']);
    });
  });
});
