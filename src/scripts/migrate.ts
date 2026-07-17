import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import type { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../db/index';

// Arbitrary but fixed lock key — must stay constant across deploys so every
// instance contends for the same lock.
const MIGRATE_LOCK_KEY = 847_291_003;

// Isolated from the process.exit()-driven entrypoint below so this is
// unit-testable with a mock pool — the entrypoint itself calls
// dotenv.config()/process.exit() at import/call time, which isn't something
// a test can safely exercise directly.
//
// Caller MUST NOT call pool.end() until after this resolves/rejects.
// pool.end() waits for every checked-out client to be returned to the
// pool; this function is the only thing that returns lockClient. Calling
// pool.end() from inside here (the original bug) — or before this
// function's finally block has run — deadlocks: pool.end() never resolves
// because lockClient is never released. Confirmed in production: two
// consecutive deploys hung silently right after migrate() completed, for
// 5-8 minutes each, until Railway's healthcheck killed the container.
export async function runMigrationsWithLock(
  migrationPool: Pool,
  lockKey: number,
  runMigration: () => Promise<void>,
): Promise<void> {
  const lockClient = await migrationPool.connect();
  try {
    console.log('[migrate] Acquiring migration lock...');
    await lockClient.query('SELECT pg_advisory_lock($1)', [lockKey]);
    console.log('[migrate] Lock acquired');

    await runMigration();
    console.log('[migrate] Migration complete');
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => {});
    lockClient.release();
  }
}

async function main() {
  const migrationsFolder = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');
  console.log('[migrate] Migration started');
  console.log('[migrate] Migrations folder:', migrationsFolder);

  let exitCode = 0;
  try {
    // drizzle's migrator takes no lock of its own and decides pending work
    // by comparing only the newest applied migration's timestamp. Two
    // instances booting concurrently (a rolling deploy) could both read the
    // same "nothing pending" snapshot and both start applying the same
    // batch — non-idempotent statements (plain CREATE INDEX, ADD COLUMN
    // without IF NOT EXISTS) then abort the loser into the 3-retry crash
    // loop railway.json configures. pg_advisory_lock is BLOCKING (not
    // _try_) so the second instance waits for the first to finish and
    // commit before it re-checks what's pending, rather than racing or
    // skipping.
    await runMigrationsWithLock(pool, MIGRATE_LOCK_KEY, () => migrate(db, { migrationsFolder }));
  } catch (error) {
    console.error('[migrate] Migration failed:', error);
    exitCode = 1;
  }

  await pool.end();
  process.exit(exitCode);
}

main();
