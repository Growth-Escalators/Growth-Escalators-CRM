import { describe, it, expect, vi } from 'vitest';
import { claimBootBackfill } from '../services/bootBackfillGuard';

function makeFakePool(insertRows: Array<{ name: string }>) {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce({ rows: insertRows }), // INSERT ... ON CONFLICT
  } as unknown as import('pg').Pool;
}

describe('claimBootBackfill (M17 — idempotent startup backfills)', () => {
  it('returns true for the first instance to claim a name', async () => {
    const pool = makeFakePool([{ name: 'comprehensive-purchase-backfill' }]);
    const claimed = await claimBootBackfill(pool, 'comprehensive-purchase-backfill');
    expect(claimed).toBe(true);
  });

  it('returns false when the name was already claimed (ON CONFLICT DO NOTHING → no rows)', async () => {
    const pool = makeFakePool([]);
    const claimed = await claimBootBackfill(pool, 'comprehensive-purchase-backfill');
    expect(claimed).toBe(false);
  });

  it('ensures the table exists before attempting the claim insert', async () => {
    const pool = makeFakePool([{ name: 'initial-pagespeed-check' }]);
    await claimBootBackfill(pool, 'initial-pagespeed-check');
    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toMatch(/CREATE TABLE IF NOT EXISTS boot_backfills_completed/);
    expect(calls[1][0]).toMatch(/INSERT INTO boot_backfills_completed/);
    expect(calls[1][0]).toMatch(/ON CONFLICT \(name\) DO NOTHING/);
    expect(calls[1][1]).toEqual(['initial-pagespeed-check']);
  });

  it('different names claim independently', async () => {
    const poolA = makeFakePool([{ name: 'a' }]);
    const poolB = makeFakePool([{ name: 'b' }]);
    expect(await claimBootBackfill(poolA, 'a')).toBe(true);
    expect(await claimBootBackfill(poolB, 'b')).toBe(true);
  });
});
