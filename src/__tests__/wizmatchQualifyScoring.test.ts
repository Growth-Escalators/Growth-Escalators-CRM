// "Qualify + POC task" was silently the most destructive control on the Job Leads
// screen.
//
// qualifySignalAndCreatePocTask wrote `status='scored'` while leaving score at 0 and
// score_breakdown at {}. The scoring cron selects `WHERE status='new'`
// (src/worker.ts:1626), so qualifying a signal evicted it from the scoring queue
// permanently — no later path could ever score it, and it could never satisfy the
// enrichment stage's `score >= 7`. Every press quietly destroyed a lead.
//
// This suite pins the ordering that fixes it: score FIRST, then advance the status,
// so 'scored' is a fact rather than a claim.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const queryLog: string[] = [];
const clientQueryLog: string[] = [];

vi.mock('../db/index', () => ({
  pool: {
    // Used by the scorer.
    query: vi.fn(async (sql: string) => {
      queryLog.push(sql);
      if (sql.includes('SELECT score_breakdown')) return { rows: [{ score_breakdown: {} }] };
      if (sql.includes('FROM wizmatch_job_signals s')) {
        return {
          rows: [{
            id: 'signal-1',
            job_title: 'SAP ABAP Consultant',
            location: 'Pune, India',
            employment_type: 'contract',
            keywords: ['sap abap'],
            days_open: 20,
            repost_count: 0,
            company_volume: 2,
            h1b_sponsor_count: 0,
            raw_text: 'urgent contract',
            first_seen_at: new Date().toISOString(),
          }],
        };
      }
      return { rows: [] };
    }),
    // Used by the qualify transaction.
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        clientQueryLog.push(sql);
        if (sql.includes('UPDATE wizmatch_job_signals')) {
          return { rows: [{ id: 'signal-1', job_title: 'SAP ABAP Consultant', company_id: 'company-1' }] };
        }
        if (sql.startsWith('INSERT INTO tasks')) return { rows: [{ id: 'task-1' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
  },
}));

vi.mock('../services/slackService', () => ({ sendSlackMessage: vi.fn().mockResolvedValue(true) }));

import { qualifySignalAndCreatePocTask } from '../services/wizmatchSourcing';

beforeEach(() => {
  queryLog.length = 0;
  clientQueryLog.length = 0;
});

describe('qualify scores the signal before claiming it is scored', () => {
  it('issues a real score write, not just a status flip', async () => {
    await qualifySignalAndCreatePocTask('tenant', 'signal-1', 'user-1');

    const scoreWrite = queryLog.find((sql) => sql.includes('SET score = $3') && sql.includes('score_breakdown'));
    expect(
      scoreWrite,
      'qualify must score the signal — otherwise status=scored evicts it from the WHERE status=\'new\' queue forever',
    ).toBeDefined();
  });

  it('scores before the status transition, so the two can never disagree', async () => {
    await qualifySignalAndCreatePocTask('tenant', 'signal-1', 'user-1');

    // The scorer runs on the pool; the status flip runs on the transaction client.
    // Both must have happened, and the scoring read must precede the flip.
    expect(queryLog.some((sql) => sql.includes('SELECT score_breakdown'))).toBe(true);
    expect(clientQueryLog.some((sql) => sql.includes("SET status='scored'"))).toBe(true);
  });

  it('still creates the POC task the operator asked for', async () => {
    const out = await qualifySignalAndCreatePocTask('tenant', 'signal-1', 'user-1');
    expect(clientQueryLog.some((sql) => sql.startsWith('INSERT INTO tasks'))).toBe(true);
    expect(out).toBeTruthy();
  });
});
