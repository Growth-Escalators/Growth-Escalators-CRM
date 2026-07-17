import type { Pool } from 'pg';

// One-time startup backfills in index.ts are guarded by this so a rolling
// deploy (two instances briefly up at once) can't run the same backfill
// twice concurrently, and so they don't re-scan/re-spend on every
// subsequent boot. The INSERT ... ON CONFLICT DO NOTHING claim is atomic —
// only one instance racing for the same name gets rows.length > 0.
export async function claimBootBackfill(dbPool: Pool, name: string): Promise<boolean> {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS boot_backfills_completed (
      name VARCHAR(200) PRIMARY KEY,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  const r = await dbPool.query(
    `INSERT INTO boot_backfills_completed (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name`,
    [name],
  );
  return r.rows.length > 0;
}
