import { describe, expect, it } from 'vitest';
import { createWizmatchDeliveryService } from '../services/wizmatchDeliveryDomain';

// analytics(tenantId, from?, to?) applies an optional From/To scope to the
// historical/volume metrics by each row's primary event date, while the
// current-state metrics (SLA exceptions, aging) and the monthly cohort series
// stay unscoped. We inject a fake pool that records each (sql, params) call.

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rows: [{}] }; },
  };
  return { pool: pool as any, calls };
}
const find = (calls: { sql: string; params: unknown[] }[], needle: string) => calls.find((c) => c.sql.includes(needle))!;
const rangeFor = (col: string) => `${col} >= $2::date AND ${col} < ($3::date + 1)`;

describe('wizmatchDeliveryService.analytics — optional From/To period scope', () => {
  it('scopes the historical metrics by primary event date and passes [tenant, from, to]', async () => {
    const { pool, calls } = fakePool();
    const out = await createWizmatchDeliveryService(pool).analytics('tenant-1', '2026-06-01', '2026-06-30');

    const funnel = find(calls, 'SELECT status,COUNT(*)::int AS count');
    expect(funnel.sql).toContain(rangeFor('created_at'));
    expect(funnel.params).toEqual(['tenant-1', '2026-06-01', '2026-06-30']);

    // commercial + time-to-start scope by placement created_at
    expect(find(calls, 'SUM(c.gross_margin_amount)').sql).toContain(rangeFor('p.created_at'));
    expect(find(calls, 'average_days').sql).toContain(rangeFor('p.created_at'));
    // recruiter (s.created_at) + source (both joins) + rejection (union) scoped
    expect(find(calls, 'AS recruiter').sql).toContain(rangeFor('s.created_at'));
    expect(find(calls, 'COALESCE(c.source').sql).toContain(rangeFor('s.created_at'));
    expect(find(calls, 'withdrawal_reason').sql).toContain(rangeFor('created_at'));

    expect(out.range).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('leaves current-state metrics (SLA exceptions, aging) and cohorts unscoped', async () => {
    const { pool, calls } = fakePool();
    await createWizmatchDeliveryService(pool).analytics('tenant-1', '2026-06-01', '2026-06-30');

    for (const needle of ['overdue_submissions', "'0-2d'", 'AS cohort']) {
      const q = find(calls, needle);
      expect(q.sql).not.toContain('$2::date');
      expect(q.params).toEqual(['tenant-1']);
    }
  });

  it('with no range, every query is all-time with [tenant] and no date predicate', async () => {
    const { pool, calls } = fakePool();
    const out = await createWizmatchDeliveryService(pool).analytics('tenant-1');
    expect(calls.every((c) => !c.sql.includes('$2::date'))).toBe(true);
    expect(calls.every((c) => JSON.stringify(c.params) === JSON.stringify(['tenant-1']))).toBe(true);
    expect(out.range).toBeNull();
  });
});
