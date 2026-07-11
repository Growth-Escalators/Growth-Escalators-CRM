/**
 * One-time backfill: classify existing Wizmatch contacts.
 *
 * Wizmatch created contacts before auto-tagging existed, so their TAGS column is
 * empty and business contacts have no company name. This tags them by source and
 * fills company_name from the linked job signal — matching what the code now does
 * at creation time (wizmatchGithubMiner → 'Candidate', enrich → 'Client Lead').
 *
 * SAFE-BY-DEFAULT: runs a read-only preview (counts + samples) unless `--commit`
 * is passed. With `--commit` it wraps all writes in a single transaction. It never
 * bumps last_activity_at (so it won't reorder the CRM list) and only ADDS a tag
 * when it's missing (idempotent — safe to re-run).
 *
 * Usage:
 *   DATABASE_URL=<postgres url> WIZMATCH_TENANT_ID=<uuid> npx tsx scripts/onboarding/backfill-wizmatch-contact-tags.ts            # dry run
 *   DATABASE_URL=<postgres url> WIZMATCH_TENANT_ID=<uuid> npx tsx scripts/onboarding/backfill-wizmatch-contact-tags.ts --commit   # write
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const TENANT = process.env.WIZMATCH_TENANT_ID;
const CONN = process.env.DATABASE_URL;

if (!CONN) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!TENANT) { console.error('WIZMATCH_TENANT_ID not set'); process.exit(1); }

// Public Railway Postgres uses a self-signed cert; the app pool sets the same.
const ssl = /railway\.internal/.test(CONN) ? undefined : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: CONN, ssl, connectionTimeoutMillis: 20_000 });

async function n(sql: string, params: unknown[]): Promise<number> {
  const r = await pool.query(sql, params);
  return Number(r.rows[0]?.count ?? 0);
}

async function main() {
  console.log(`\n=== Wizmatch contact backfill — ${COMMIT ? 'COMMIT' : 'DRY RUN (read-only)'} ===`);
  console.log(`tenant: ${TENANT}\n`);

  // --- READ FIRST: how many rows each write would touch ---
  const candNeed = await n(
    `SELECT count(*)::int AS count FROM contacts
     WHERE tenant_id = $1 AND source = 'wizmatch_github'
       AND NOT ('Candidate' = ANY(COALESCE(tags, '{}')))`,
    [TENANT],
  );
  const bizTagNeed = await n(
    `SELECT count(*)::int AS count FROM contacts
     WHERE tenant_id = $1 AND source = 'wizmatch_enrichment'
       AND NOT ('Client Lead' = ANY(COALESCE(tags, '{}')))`,
    [TENANT],
  );
  const bizCompanyNeed = await n(
    `SELECT count(*)::int AS count FROM contacts c
     WHERE c.tenant_id = $1 AND c.source = 'wizmatch_enrichment'
       AND (c.company_name IS NULL OR c.company_name = '')
       AND EXISTS (
         SELECT 1 FROM wizmatch_job_signals s JOIN wizmatch_companies comp ON comp.id = s.company_id
         WHERE s.contact_id = c.id AND comp.name IS NOT NULL AND comp.name <> ''
       )`,
    [TENANT],
  );

  console.log('Rows to change:');
  console.log(`  + tag "Candidate"      (source=wizmatch_github)     : ${candNeed}`);
  console.log(`  + tag "Client Lead"    (source=wizmatch_enrichment) : ${bizTagNeed}`);
  console.log(`  + fill company_name    (from linked signal)         : ${bizCompanyNeed}\n`);

  // Sample of business contacts that will get a company name (transparency).
  const sample = await pool.query(
    `SELECT c.id, c.first_name, c.last_name, comp.name AS company
     FROM contacts c
     JOIN wizmatch_job_signals s ON s.contact_id = c.id
     JOIN wizmatch_companies comp ON comp.id = s.company_id
     WHERE c.tenant_id = $1 AND c.source = 'wizmatch_enrichment'
       AND (c.company_name IS NULL OR c.company_name = '') AND comp.name IS NOT NULL
     LIMIT 5`,
    [TENANT],
  );
  if (sample.rows.length) {
    console.log('Sample company fills:');
    for (const r of sample.rows) console.log(`  ${r.first_name} ${r.last_name} → ${r.company}`);
    console.log('');
  }

  if (!COMMIT) {
    console.log('DRY RUN — no writes. Re-run with --commit to apply.\n');
    await pool.end();
    return;
  }

  // --- WRITE (transactional) ---
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r1 = await client.query(
      `UPDATE contacts SET tags = array_append(COALESCE(tags, '{}'), 'Candidate'), updated_at = now()
       WHERE tenant_id = $1 AND source = 'wizmatch_github'
         AND NOT ('Candidate' = ANY(COALESCE(tags, '{}')))`,
      [TENANT],
    );
    const r2 = await client.query(
      `UPDATE contacts SET tags = array_append(COALESCE(tags, '{}'), 'Client Lead'), updated_at = now()
       WHERE tenant_id = $1 AND source = 'wizmatch_enrichment'
         AND NOT ('Client Lead' = ANY(COALESCE(tags, '{}')))`,
      [TENANT],
    );
    const r3 = await client.query(
      `UPDATE contacts c SET company_name = comp.name, updated_at = now()
       FROM wizmatch_job_signals s JOIN wizmatch_companies comp ON comp.id = s.company_id
       WHERE s.contact_id = c.id AND c.tenant_id = $1 AND c.source = 'wizmatch_enrichment'
         AND (c.company_name IS NULL OR c.company_name = '') AND comp.name IS NOT NULL AND comp.name <> ''`,
      [TENANT],
    );
    await client.query('COMMIT');
    console.log(`COMMITTED: candidate=${r1.rowCount}, client-lead=${r2.rowCount}, company=${r3.rowCount}\n`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLED BACK:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
