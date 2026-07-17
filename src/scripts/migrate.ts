import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../db/index';

// Arbitrary but fixed lock key — must stay constant across deploys so every
// instance contends for the same lock.
const MIGRATE_LOCK_KEY = 847_291_003;

async function runMigrations() {
  const migrationsFolder = path.join(__dirname, '..', '..', 'src', 'db', 'migrations');
  console.log('[migrate] Migration started');
  console.log('[migrate] Migrations folder:', migrationsFolder);

  // drizzle's migrator takes no lock of its own and decides pending work by
  // comparing only the newest applied migration's timestamp. Two instances
  // booting concurrently (a rolling deploy) could both read the same
  // "nothing pending" snapshot and both start applying the same batch —
  // non-idempotent statements (plain CREATE INDEX, ADD COLUMN without IF
  // NOT EXISTS) then abort the loser into the 3-retry crash loop railway.json
  // configures. pg_advisory_lock is BLOCKING (not _try_) so the second
  // instance waits for the first to finish and commit before it re-checks
  // what's pending, rather than racing or skipping.
  const lockClient = await pool.connect();
  let exitCode = 0;
  try {
    console.log('[migrate] Acquiring migration lock...');
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    console.log('[migrate] Lock acquired');

    await migrate(db, { migrationsFolder });
    console.log('[migrate] Migration complete');
  } catch (error) {
    console.error('[migrate] Migration failed:', error);
    exitCode = 1;
  } finally {
    // Release the advisory lock AND return this client to the pool *before*
    // pool.end() below. pool.end() blocks until every checked-out client is
    // released; if lockClient is still checked out it hangs forever, so
    // process.exit() never fires and the start command's
    // `&& node dist/index.js` never runs — the server never boots and the
    // deploy dies on a silent healthcheck failure. (Regression from the
    // advisory-lock change: process.exit() used to sit inside try/catch,
    // making this finally unreachable.)
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]).catch(() => {});
    lockClient.release();
  }

  await pool.end();
  process.exit(exitCode);
}

runMigrations();
