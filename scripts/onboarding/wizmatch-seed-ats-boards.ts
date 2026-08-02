#!/usr/bin/env npx tsx
/**
 * Seed a starter set of public ATS boards into wizmatch_companies so the existing
 * ATS poller (wizmatchAtsPoller.ts, daily 6 AM IST cron) has companies to harvest.
 * Idempotent on (tenant_id, ats_type, ats_slug). Every slug below was validated
 * live against the public API and returns real open jobs.
 *
 * Extend the BOARDS list and re-run to add more. Run:
 *   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/onboarding/wizmatch-seed-ats-boards.ts'
 */
import dotenv from 'dotenv'; dotenv.config();
import { Pool } from 'pg';
import { insertWizmatchCompanyRootPolicy } from '../../src/modules/outreach/companyBootstrap';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

/**
 * The ATS poller selects companies WHERE ats_board_url IS NOT NULL
 * (src/services/wizmatchAtsPoller.ts). This script previously omitted the
 * column, so every company it seeded was filtered straight back out and the
 * poller marked each daily run `skipped` — the header's claim that the poller
 * "will harvest these automatically" was false as written.
 *
 * Note the column is a human-confirmation flag, not a fetch target: the poller
 * reads it into its row type but never requests it. All three vendors are
 * fetched from `ats_slug` alone. These templates therefore only need to match
 * what detectAtsType() already proposes as the canonical board URL
 * (wizmatchAtsPoller.ts detectAtsType return values).
 */
function boardUrlFor(atsType: string, slug: string): string | null {
  switch (atsType) {
    case 'greenhouse': return `https://boards.greenhouse.io/${slug}`;
    case 'lever':      return `https://jobs.lever.co/${slug}`;
    case 'ashby':      return `https://boards.ashby.com/${slug}`;
    default:           return null; // unknown vendor stays NULL and stays unpolled
  }
}

// [name, domain, ats_type, ats_slug]
const BOARDS: [string, string, string, string][] = [
  ['Airbnb', 'airbnb.com', 'greenhouse', 'airbnb'],
  ['Stripe', 'stripe.com', 'greenhouse', 'stripe'],
  ['Databricks', 'databricks.com', 'greenhouse', 'databricks'],
  ['Dropbox', 'dropbox.com', 'greenhouse', 'dropbox'],
  ['Coinbase', 'coinbase.com', 'greenhouse', 'coinbase'],
  ['Robinhood', 'robinhood.com', 'greenhouse', 'robinhood'],
  ['Figma', 'figma.com', 'greenhouse', 'figma'],
  ['Brex', 'brex.com', 'greenhouse', 'brex'],
  ['Discord', 'discord.com', 'greenhouse', 'discord'],
  ['Reddit', 'reddit.com', 'greenhouse', 'reddit'],
  ['Instacart', 'instacart.com', 'greenhouse', 'instacart'],
  ['Gusto', 'gusto.com', 'greenhouse', 'gusto'],
  ['Asana', 'asana.com', 'greenhouse', 'asana'],
  ['Samsara', 'samsara.com', 'greenhouse', 'samsara'],
  ['Affirm', 'affirm.com', 'greenhouse', 'affirm'],
  ['Flexport', 'flexport.com', 'greenhouse', 'flexport'],
  ['Lyft', 'lyft.com', 'greenhouse', 'lyft'],
  ['Twitch', 'twitch.tv', 'greenhouse', 'twitch'],
  ['Cloudflare', 'cloudflare.com', 'greenhouse', 'cloudflare'],
  ['MongoDB', 'mongodb.com', 'greenhouse', 'mongodb'],
  ['Datadog', 'datadoghq.com', 'greenhouse', 'datadog'],
  ['GitLab', 'gitlab.com', 'greenhouse', 'gitlab'],
  ['Elastic', 'elastic.co', 'greenhouse', 'elastic'],
  ['Okta', 'okta.com', 'greenhouse', 'okta'],
  ['Spotify', 'spotify.com', 'lever', 'spotify'],
  ['Veeva Systems', 'veeva.com', 'lever', 'veeva'],
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const client = await pool.connect();
  try {
    const wt = await client.query(`SELECT id FROM tenants WHERE slug='wizmatch'`);
    if (!wt.rowCount) throw new Error('wizmatch tenant not found');
    const tenantId = wt.rows[0].id;

    const before = await client.query(
      `SELECT count(*) AS n FROM wizmatch_companies WHERE tenant_id=$1 AND ats_slug IS NOT NULL`, [tenantId]);
    console.log(`ATS-board companies before: ${before.rows[0].n}`);

    await client.query('BEGIN');
    let inserted = 0;
    for (const [name, domain, atsType, atsSlug] of BOARDS) {
      const r = await client.query(
        `INSERT INTO wizmatch_companies (tenant_id, name, domain, ats_type, ats_slug, ats_board_url, industry, country)
         SELECT $1,$2,$3,$4,$5,$6,'Technology','US'
         WHERE NOT EXISTS (
           SELECT 1 FROM wizmatch_companies WHERE tenant_id=$1 AND ats_type=$4 AND ats_slug=$5
         ) RETURNING id`,
        [tenantId, name, domain, atsType, atsSlug, boardUrlFor(atsType, atsSlug)]);
      if (r.rowCount) {
        inserted += 1;
        // PRD-005 §8.1 / §22.2 #16 — every company-insert path writes the
        // cold-start root policy in the same transaction. Without this, boards
        // seeded here would be permanently L0 `policy_missing_root` denied, and
        // re-running this script could never repair them: the WHERE NOT EXISTS
        // guard means the row is never re-inserted.
        await insertWizmatchCompanyRootPolicy(client, tenantId, r.rows[0].id);
      }
    }
    await client.query('COMMIT');

    const after = await client.query(
      `SELECT ats_type, count(*) AS n FROM wizmatch_companies WHERE tenant_id=$1 AND ats_slug IS NOT NULL GROUP BY ats_type`, [tenantId]);
    console.log(`Inserted ${inserted} new ATS-board companies.`);
    console.table(after.rows);
    console.log('The ATS poller (daily 6 AM IST) will harvest these into job signals automatically.');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED, rolled back:', e?.message || e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
main();
