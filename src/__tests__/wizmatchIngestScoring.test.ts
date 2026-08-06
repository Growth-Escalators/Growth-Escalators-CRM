// Scoring was unreachable in production, and "Qualify" corrupted whatever it touched.
//
// scoreSignalById had exactly three callers: a cron behind
// WIZMATCH_LEGACY_AUTOMATION_ENABLED (false in prod), an HTTP route behind
// requireInternalToken (no operator session can reach it), and no UI at all. So every
// signal sat at score 0 with score_breakdown {} forever, which starved every
// downstream stage — enrichment selects score >= 7, matching selects status='enriched'.
//
// Worse, qualifySignalAndCreatePocTask wrote status='scored' WITHOUT scoring. The
// scoring cron selects WHERE status='new', so a qualified signal was evicted from the
// scoring queue permanently and could never be scored by any path afterwards.
//
// These tests pin both behaviours at the seam that actually broke: the SQL issued.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { ingestWizmatchSignals } from '../services/wizmatchSourcing';
import { ensureSignalScored, isWizmatchScoreAlertsEnabled } from '../services/wizmatchSignalPipeline';

type Call = { sql: string; params?: unknown[] };

/** Fake executor that satisfies both the ingest path and the scorer's read/write. */
function makeDb(overrides: { breakdown?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO wizmatch_companies')) return { rows: [{ id: 'company-1', inserted: false }] };
      if (sql.includes('INSERT INTO wizmatch_job_signals')) return { rows: [{ id: 'signal-1' }] };
      if (sql.includes('UPDATE wizmatch_job_signals')) return { rows: [] };
      // The scorer's SELECT — it joins wizmatch_companies and computes company_volume.
      if (sql.includes('FROM wizmatch_job_signals s')) {
        return {
          rows: [{
            id: 'signal-1',
            job_title: 'SAP ABAP Consultant',
            location: 'Pune, India',
            employment_type: 'contract',
            keywords: ['sap abap'],
            days_open: 12,
            repost_count: 0,
            company_volume: 3,
            h1b_sponsor_count: 0,
            raw_text: 'urgent contract role',
            first_seen_at: new Date().toISOString(),
            score_breakdown: overrides.breakdown ?? {},
          }],
        };
      }
      if (sql.includes('SELECT score_breakdown')) {
        return { rows: [{ score_breakdown: overrides.breakdown ?? {} }] };
      }
      return { rows: [] };
    },
  };
  return { db, calls };
}

const NEW_SIGNAL = {
  job_title: 'SAP ABAP Consultant',
  source: 'theirstack',
  provider_id: 'job-77',
  company_name: 'Company A',
  location: 'Pune, India',
};

afterEach(() => {
  delete process.env.WIZMATCH_SCORE_ALERTS_ENABLED;
  vi.restoreAllMocks();
});

describe('signals are scored on arrival', () => {
  it('writes a real score and breakdown for every newly inserted signal', async () => {
    const { db, calls } = makeDb();

    const result = await ingestWizmatchSignals('tenant', [NEW_SIGNAL], db);
    expect(result.inserted).toBe(1);

    // The scoring UPDATE must have been issued against the SAME injected executor.
    const scoreWrite = calls.find((c) => c.sql.includes('SET score = $3') && c.sql.includes('score_breakdown'));
    expect(scoreWrite, 'ingest must score the signal it just inserted').toBeDefined();

    // And it must carry a genuinely populated breakdown — an empty {} here would
    // reproduce the exact production symptom this test exists to prevent.
    const breakdownJson = String(scoreWrite!.params?.[3] ?? '{}');
    expect(Object.keys(JSON.parse(breakdownJson)).length).toBeGreaterThan(0);
  });

  it('keeps the signal when scoring throws, rather than losing it', async () => {
    const calls: Call[] = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO wizmatch_companies')) return { rows: [{ id: 'c1', inserted: false }] };
        if (sql.includes('INSERT INTO wizmatch_job_signals')) return { rows: [{ id: 'signal-1' }] };
        if (sql.includes('UPDATE wizmatch_job_signals')) return { rows: [] };
        // Scorer read explodes.
        if (sql.includes('FROM wizmatch_job_signals s')) throw new Error('scorer boom');
        return { rows: [] };
      },
    };

    const result = await ingestWizmatchSignals('tenant', [NEW_SIGNAL], db);

    // A scoring fault must not be counted as an ingest error, and must not undo the
    // insert — an unscored signal is recoverable, a dropped one is not.
    expect(result.inserted).toBe(1);
    expect(result.errors).toBe(0);
    expect(calls.some((c) => c.sql.includes('INSERT INTO wizmatch_job_signals'))).toBe(true);
  });
});

describe('priority Slack alerts are opt-in', () => {
  it('stays off unless explicitly enabled', () => {
    expect(isWizmatchScoreAlertsEnabled()).toBe(false);
    process.env.WIZMATCH_SCORE_ALERTS_ENABLED = 'true';
    expect(isWizmatchScoreAlertsEnabled()).toBe(true);
  });

  it('does not treat an arbitrary value as enabled', () => {
    process.env.WIZMATCH_SCORE_ALERTS_ENABLED = 'maybe';
    expect(isWizmatchScoreAlertsEnabled()).toBe(false);
  });
});

describe('ensureSignalScored is idempotent', () => {
  it('scores a signal whose breakdown is empty', async () => {
    const { db, calls } = makeDb({ breakdown: {} });
    const outcome = await ensureSignalScored('tenant', 'signal-1', { db, notify: false });
    expect(outcome).toEqual({ scored: true, reason: 'scored_now' });
    expect(calls.some((c) => c.sql.includes('SET score = $3'))).toBe(true);
  });

  it('leaves an already-scored signal alone, so re-qualifying cannot re-fire the alert', async () => {
    const { db, calls } = makeDb({ breakdown: { urgency: 3, region: 'india' } });
    const outcome = await ensureSignalScored('tenant', 'signal-1', { db, notify: false });
    expect(outcome).toEqual({ scored: false, reason: 'already_scored' });
    expect(calls.some((c) => c.sql.includes('SET score = $3'))).toBe(false);
  });

  it('reports a missing signal instead of scoring nothing silently', async () => {
    const db = { async query() { return { rows: [] }; } };
    expect(await ensureSignalScored('tenant', 'nope', { db })).toEqual({ scored: false, reason: 'not_found' });
  });
});
