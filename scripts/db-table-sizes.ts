/**
 * DB Table Size Audit
 *
 * Prints the top 25 user tables by total disk size + row count,
 * plus a summary line for total DB size. Used to spot bloated tables
 * that could be archived or pruned.
 *
 * Run locally:
 *   npx tsx scripts/db-table-sizes.ts
 *
 * Run against Railway prod (uses Railway service env, including DATABASE_URL):
 *   railway run --service web npm run db:sizes
 *
 * Read-only — safe to run on prod.
 */

import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set.');
  console.error('   Local: source .env or set DATABASE_URL=postgresql://...');
  console.error('   Prod:  railway run --service web npm run db:sizes');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
});

async function main(): Promise<void> {
  try {
    // Total DB size
    const dbSizeRes = await pool.query<{ db: string; size: string; bytes: string }>(`
      SELECT
        current_database() AS db,
        pg_size_pretty(pg_database_size(current_database())) AS size,
        pg_database_size(current_database())::text AS bytes
    `);
    const dbRow = dbSizeRes.rows[0];

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Database: ${dbRow.db}`);
    console.log(`  Total size: ${dbRow.size} (${Number(dbRow.bytes).toLocaleString()} bytes)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Top 25 tables by total relation size (data + indexes + toast)
    const tablesRes = await pool.query<{
      table: string;
      total_size: string;
      data_size: string;
      index_size: string;
      total_bytes: string;
      row_count: string | null;
    }>(`
      SELECT
        schemaname || '.' || relname AS table,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_size_pretty(pg_relation_size(relid)) AS data_size,
        pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size,
        pg_total_relation_size(relid)::text AS total_bytes,
        n_live_tup::text AS row_count
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 25
    `);

    if (tablesRes.rows.length === 0) {
      console.log('  (no user tables found)');
      return;
    }

    // Format as a table
    const colWidths = {
      table: Math.max(5, ...tablesRes.rows.map(r => r.table.length)),
      total: Math.max(10, ...tablesRes.rows.map(r => r.total_size.length)),
      data: Math.max(9, ...tablesRes.rows.map(r => r.data_size.length)),
      index: Math.max(10, ...tablesRes.rows.map(r => r.index_size.length)),
      rows: Math.max(9, ...tablesRes.rows.map(r => (r.row_count ?? '?').length)),
    };

    const pad = (s: string, w: number, right = false) =>
      right ? s.padStart(w) : s.padEnd(w);

    console.log(
      '  ' +
        pad('TABLE', colWidths.table) +
        '  ' +
        pad('TOTAL', colWidths.total, true) +
        '  ' +
        pad('DATA', colWidths.data, true) +
        '  ' +
        pad('INDEX', colWidths.index, true) +
        '  ' +
        pad('ROWS', colWidths.rows, true),
    );
    console.log(
      '  ' +
        '─'.repeat(colWidths.table) +
        '  ' +
        '─'.repeat(colWidths.total) +
        '  ' +
        '─'.repeat(colWidths.data) +
        '  ' +
        '─'.repeat(colWidths.index) +
        '  ' +
        '─'.repeat(colWidths.rows),
    );

    for (const r of tablesRes.rows) {
      const rows = r.row_count ?? '?';
      const rowsFmt = rows === '?' ? rows : Number(rows).toLocaleString();
      console.log(
        '  ' +
          pad(r.table, colWidths.table) +
          '  ' +
          pad(r.total_size, colWidths.total, true) +
          '  ' +
          pad(r.data_size, colWidths.data, true) +
          '  ' +
          pad(r.index_size, colWidths.index, true) +
          '  ' +
          pad(rowsFmt, colWidths.rows, true),
      );
    }

    console.log('');
    console.log('  Tip: tables >100 MB are usually the first candidates for');
    console.log('  archival, partitioning, or column pruning.');
    console.log('');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
