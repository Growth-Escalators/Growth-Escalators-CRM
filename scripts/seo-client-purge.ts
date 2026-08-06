#!/usr/bin/env npx tsx
/**
 * seo-client-purge.ts — retire aarohaom.com, blackpandaenterprises.com and
 * ageddentistry.org from every SEO table.
 *
 * See docs/go-live/SEO_CLIENT_DATA_PURGE_PLAN.md before running this against
 * anything but local dev. That document has the full table-by-table
 * reasoning, the FK-driven deletion order, what is deliberately excluded, and
 * the three preconditions (backup restore-tested, dry run reviewed, owner's
 * explicit second confirmation) that must all hold before --execute is ever
 * passed against a real database.
 *
 * SAFETY MODEL
 *   1. DRY RUN BY DEFAULT. No arguments = count and print only. The mutating
 *      code path (runExecute's transaction) is never reached unless --execute,
 *      a matching --confirm string, and (for any non-local DATABASE_URL)
 *      --allow-non-local are ALL present. There is no bare --yes shortcut.
 *   2. TENANT-SCOPED. Every query binds tenant_id, resolved by tenant SLUG
 *      ('growth-escalators'), never a hardcoded UUID — the same slug resolves
 *      to a different id in every database. A domain-only predicate would
 *      risk deleting another tenant's rows if a domain string ever collided;
 *      this is exactly the cross-tenant hazard the seo_sites registry (see
 *      its docblock in src/db/schema.ts) was introduced to close.
 *   3. ONE TRANSACTION. The whole delete — all 15 tables, in FK order — runs
 *      on a single pooled client between BEGIN and COMMIT. Any failure, at
 *      any step, rolls back everything. A partial purge cannot happen.
 *   4. MIGRATION-STATE TOLERANT. seo_sites / site_changes / seo_site_snapshots
 *      / seo_api_usage (migrations 0046-0049) may not exist yet in every
 *      environment. Each is existence-checked before being touched, and
 *      skipped (not crashed on) if absent.
 *
 * USAGE
 *   Dry run (safe against any environment, including production):
 *     DATABASE_URL=... npx tsx scripts/seo-client-purge.ts
 *
 *   Execute (only after every precondition in the plan doc is met):
 *     DATABASE_URL=... npx tsx scripts/seo-client-purge.ts \
 *       --execute \
 *       --confirm="DELETE aarohaom.com blackpandaenterprises.com ageddentistry.org PERMANENTLY" \
 *       --allow-non-local
 *
 *   --help for the full usage text.
 *
 * Never put a credential or connection string in this file. DATABASE_URL /
 * DATABASE_PUBLIC_URL come from the environment only.
 */

import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

const TENANT_SLUG = 'growth-escalators';

const TARGET_DOMAINS = ['aarohaom.com', 'blackpandaenterprises.com', 'ageddentistry.org'];

// Legacy short-form aliases. scripts/test-seo-system.ts:117 expects
// client_knowledge_base.project_name to historically hold these short forms
// rather than the full domain — a symptom of years of column drift
// (ensureSeoTables() ALTER-ing tables schema.ts never knew about; see
// migration 0035's header). Local dev's seed uses the full-domain form
// consistently, so this could not be confirmed against real data — treat
// production as unverified until a dry run there proves it either way. Kept
// as a lookup (not just a flat array) so the source of each alias is legible.
const LEGACY_ALIASES: Record<string, string[]> = {
  'aarohaom.com': ['aarohaom'],
  'blackpandaenterprises.com': ['blackpanda'],
  'ageddentistry.org': ['ageddentistry'],
};

// Every string this purge will match against project_name/client_domain
// columns, lowercased (matching is case-insensitive + trimmed — see
// legacyPredicate below). A superset on purpose: matching seo_sites.domain
// (which always contains a dot, per normaliseDomain's own validation) against
// the short aliases is a no-op there, not a hazard.
const ALL_MATCH_NAMES = [...TARGET_DOMAINS, ...Object.values(LEGACY_ALIASES).flat()].map((s) =>
  s.toLowerCase(),
);

// Typed confirmation required for --execute. Deliberately spells out all
// three domains (not a bare --yes) so a copy-pasted command that drifted to
// the wrong target is caught by a literal string mismatch, not a fuzzy flag.
const CONFIRMATION_PHRASE =
  'DELETE aarohaom.com blackpandaenterprises.com ageddentistry.org PERMANENTLY';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// ---------------------------------------------------------------------------
// Table specs, in FK-safe deletion order (children before parents). See
// "Deletion order, and why" in the plan doc for the dependency graph this
// order is derived from.
// ---------------------------------------------------------------------------

interface TableSpec {
  name: string;
  hasProjectName: boolean;
  hasClientDomain: boolean;
  hasSiteId: boolean;
  // Only true for seo_sites itself — matched by `domain`, not project_name/client_domain/site_id.
  isRegistry?: boolean;
}

const TABLES: TableSpec[] = [
  { name: 'seo_site_snapshots', hasProjectName: false, hasClientDomain: false, hasSiteId: true },
  { name: 'seo_content_calendar', hasProjectName: false, hasClientDomain: true, hasSiteId: true },
  { name: 'site_changes', hasProjectName: false, hasClientDomain: false, hasSiteId: true },
  { name: 'seo_opportunities', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'seo_api_usage', hasProjectName: false, hasClientDomain: false, hasSiteId: true },
  { name: 'client_knowledge_base', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'client_pages', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'keyword_rankings', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'backlink_data', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'site_health_metrics', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'seo_weekly_metrics', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'seo_alerts_log', hasProjectName: true, hasClientDomain: true, hasSiteId: true },
  { name: 'content_gap_analysis', hasProjectName: true, hasClientDomain: true, hasSiteId: false },
  { name: 'brand_mentions', hasProjectName: true, hasClientDomain: false, hasSiteId: false },
  { name: 'seo_sites', hasProjectName: false, hasClientDomain: false, hasSiteId: false, isRegistry: true },
];

// ---------------------------------------------------------------------------
// Connection — same convention as scripts/db-table-sizes.ts: prefer the
// PUBLIC url when running off a laptop, warn loudly on an unresolvable
// internal Railway host.
// ---------------------------------------------------------------------------

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL (or DATABASE_PUBLIC_URL) not set.');
    console.error('  Local:  DATABASE_URL=postgresql://you@localhost:5432/ge_local_dev npx tsx scripts/seo-client-purge.ts');
    console.error('  Prod:   railway variables --service Postgres | grep -i public');
    console.error("          DATABASE_PUBLIC_URL='postgresql://...' npx tsx scripts/seo-client-purge.ts");
    process.exit(1);
  }
  const isInternal = url.includes('railway.internal');
  const looksLikeLaptop = !process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_PROJECT_ID;
  if (isInternal && looksLikeLaptop) {
    console.error('DATABASE_URL points at postgres.railway.internal — only resolvable inside');
    console.error("Railway's private network. Use the Postgres service's PUBLIC url instead:");
    console.error('  railway variables --service Postgres | grep -i public');
    process.exit(1);
  }
  return url;
}

function hostnameOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    console.error('DATABASE_URL is not a parseable connection string. Refusing to run.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  execute: boolean;
  confirm: string | null;
  allowNonLocal: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false, confirm: null, allowNonLocal: false, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw === '--execute') args.execute = true;
    else if (raw === '--allow-non-local') args.allowNonLocal = true;
    else if (raw.startsWith('--confirm=')) args.confirm = raw.slice('--confirm='.length);
  }
  return args;
}

function printHelp(): void {
  console.log(`
seo-client-purge.ts — retire aarohaom.com, blackpandaenterprises.com, ageddentistry.org

Read docs/go-live/SEO_CLIENT_DATA_PURGE_PLAN.md first. This is an irreversible
production data deletion; the plan doc has the preconditions.

Usage:
  npx tsx scripts/seo-client-purge.ts                Dry run (default). Counts
                                                       and prints only — cannot
                                                       delete anything.
  npx tsx scripts/seo-client-purge.ts --help          Show this help.

  Deletion requires ALL of the following together:
    --execute
    --confirm="${CONFIRMATION_PHRASE}"
    --allow-non-local   (only required when DATABASE_URL does not resolve to
                         localhost / 127.0.0.1 / ::1 — i.e. this looks like it
                         could be a shared or production database. Dry runs
                         never need this flag.)

  npx tsx scripts/seo-client-purge.ts --execute \\
    --confirm="${CONFIRMATION_PHRASE}" \\
    --allow-non-local

Env:
  DATABASE_URL / DATABASE_PUBLIC_URL   Connection string. Public URL preferred
                                        (matches scripts/db-table-sizes.ts) so
                                        this also works run from a laptop
                                        against Railway.

Targets tenant '${TENANT_SLUG}' only, resolved by slug (never a hardcoded id —
the UUID differs per database). See the plan doc for the full table list, the
FK-driven deletion order, and what is deliberately NOT deleted.
`);
}

// ---------------------------------------------------------------------------
// Introspection helpers — tolerate environments that haven't run migrations
// 0046-0049 yet (registry-era tables) rather than crashing on a missing
// relation/column.
// ---------------------------------------------------------------------------

async function tableExists(client: PoolClient | Pool, name: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT to_regclass('public.' || $1) IS NOT NULL AS exists`, [name]);
  return Boolean(rows[0]?.exists);
}

async function columnExists(client: PoolClient | Pool, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return Boolean(rows[0]?.exists);
}

async function resolveTenantId(client: PoolClient | Pool): Promise<string> {
  const { rows } = await client.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
  if (rows.length === 0) {
    throw new Error(`No tenant with slug '${TENANT_SLUG}' found in this database. Refusing to guess.`);
  }
  return rows[0].id as string;
}

async function resolveSiteIds(client: PoolClient | Pool, tenantId: string): Promise<string[]> {
  if (!(await tableExists(client, 'seo_sites'))) return [];
  const { rows } = await client.query(
    `SELECT id FROM seo_sites WHERE tenant_id = $1 AND lower(domain) = ANY($2::text[])`,
    [tenantId, TARGET_DOMAINS],
  );
  return rows.map((r) => r.id as string);
}

// ---------------------------------------------------------------------------
// Predicate builder — one shape reused for both COUNT (dry run) and DELETE
// (execute). Placeholders are numbered to match exactly the values returned
// ($1 is always tenantId) — Postgres cannot infer a type for a parameter
// number that's never referenced in the query text (e.g. building the SQL
// with a fixed $1/$2/$3 layout and then omitting the $2 clause for a
// site-only table fails with "could not determine data type of parameter
// $2"), so every clause here is only added — and only numbered — when it's
// actually used.
// ---------------------------------------------------------------------------

async function buildPredicate(
  client: PoolClient | Pool,
  spec: TableSpec,
  tenantId: string,
  siteIds: string[],
): Promise<{ where: string; values: unknown[] }> {
  const values: unknown[] = [tenantId];

  if (spec.isRegistry) {
    values.push(TARGET_DOMAINS);
    return { where: `tenant_id = $1 AND lower(domain) = ANY($2::text[])`, values };
  }

  const parts: string[] = [];
  let nextIdx = 2;

  if (spec.hasClientDomain || spec.hasProjectName) {
    const namesIdx = nextIdx++;
    values.push(ALL_MATCH_NAMES);
    if (spec.hasClientDomain) parts.push(`lower(trim(client_domain)) = ANY($${namesIdx}::text[])`);
    if (spec.hasProjectName) parts.push(`lower(trim(project_name)) = ANY($${namesIdx}::text[])`);
  }

  // Column-existence-checked independently of table existence: migration 0046
  // adds site_id to these legacy tables in the same migration that creates
  // seo_sites, but checking directly (rather than assuming) costs one cheap
  // query and means a half-applied migration state fails safe, not silently.
  const siteIdUsable = spec.hasSiteId && (await columnExists(client, spec.name, 'site_id'));
  if (siteIdUsable) {
    const siteIdx = nextIdx++;
    values.push(siteIds);
    parts.push(`site_id = ANY($${siteIdx}::uuid[])`);
  }

  if (parts.length === 0) {
    throw new Error(`${spec.name}: no usable match column found — refusing to build an empty WHERE`);
  }
  return { where: `tenant_id = $1 AND (${parts.join(' OR ')})`, values };
}

async function countMatching(
  client: PoolClient | Pool,
  spec: TableSpec,
  tenantId: string,
  siteIds: string[],
): Promise<number> {
  const { where, values } = await buildPredicate(client, spec, tenantId, siteIds);
  const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${spec.name} WHERE ${where}`, values);
  return rows[0].c as number;
}

async function countTotalForTenant(client: PoolClient | Pool, table: string, tenantId: string): Promise<number> {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return rows[0].c as number;
}

// ---------------------------------------------------------------------------
// Pre-flight FK sanity checks — catch a cross-domain reference with a legible
// message instead of a raw FK-violation error, and (in execute mode) abort
// the whole transaction rather than leaving anything half-deleted.
// ---------------------------------------------------------------------------

interface PreflightResult {
  label: string;
  ok: boolean;
  count: number;
  detail: string;
}

async function runPreflightChecks(
  client: PoolClient | Pool,
  tenantId: string,
  siteIds: string[],
): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];

  if (siteIds.length > 0 && (await tableExists(client, 'seo_opportunities')) && (await tableExists(client, 'seo_content_calendar'))) {
    // After step 2 (seo_content_calendar delete) removes every calendar row
    // for these domains, any surviving reference to one of these
    // opportunities from a DIFFERENT domain's calendar entry would block
    // step 4 (seo_opportunities delete) on the FK. Check it explicitly.
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM seo_content_calendar cc
       JOIN seo_opportunities o ON o.id = cc.opportunity_id
       WHERE o.tenant_id = $1 AND (lower(trim(o.client_domain)) = ANY($2::text[]) OR lower(trim(o.project_name)) = ANY($2::text[]) OR o.site_id = ANY($3::uuid[]))`,
      [tenantId, ALL_MATCH_NAMES, siteIds],
    );
    const c = rows[0].c as number;
    results.push({
      label: 'seo_content_calendar rows (any domain) referencing a target seo_opportunities row',
      ok: c === 0,
      count: c,
      detail: c === 0
        ? 'none — safe to delete seo_opportunities after seo_content_calendar'
        : 'BLOCKING: another domain calendar entry points at an opportunity this purge would delete',
    });
  }

  if (siteIds.length > 0 && (await tableExists(client, 'site_changes'))) {
    const { rows: selfRef } = await client.query(
      `SELECT COUNT(*)::int AS c FROM site_changes sc
       WHERE sc.tenant_id = $1 AND sc.site_id != ALL($2::uuid[])
         AND sc.superseded_by_change_id IN (SELECT id FROM site_changes WHERE tenant_id = $1 AND site_id = ANY($2::uuid[]))`,
      [tenantId, siteIds],
    );
    const c1 = selfRef[0].c as number;
    results.push({
      label: 'site_changes rows on OTHER sites referencing a target site_changes row (superseded_by_change_id)',
      ok: c1 === 0,
      count: c1,
      detail: c1 === 0 ? 'none' : 'BLOCKING: another site\'s change was superseded by one of these',
    });
  }

  if (siteIds.length > 0 && (await tableExists(client, 'seo_site_snapshots')) && (await tableExists(client, 'site_changes'))) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM seo_site_snapshots s
       WHERE s.tenant_id = $1 AND s.site_id != ALL($2::uuid[])
         AND s.matched_change_id IN (SELECT id FROM site_changes WHERE tenant_id = $1 AND site_id = ANY($2::uuid[]))`,
      [tenantId, siteIds],
    );
    const c = rows[0].c as number;
    results.push({
      label: 'seo_site_snapshots rows on OTHER sites matched to a target site_changes row',
      ok: c === 0,
      count: c,
      detail: c === 0 ? 'none' : 'BLOCKING: another site\'s snapshot drift-matched one of these changes',
    });
  }

  // seo_sites.client_id linkage — informational only (not a delete blocker;
  // clients is never touched by this script), but must be surfaced loudly:
  // see "What is deliberately NOT deleted" in the plan doc.
  if (siteIds.length > 0 && (await tableExists(client, 'seo_sites'))) {
    const { rows } = await client.query(
      `SELECT s.domain, s.client_id FROM seo_sites s WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[]) AND s.client_id IS NOT NULL`,
      [tenantId, siteIds],
    );
    results.push({
      label: 'seo_sites rows linked to a CRM clients row (client_id IS NOT NULL)',
      ok: true, // informational, not blocking — this script never touches `clients`
      count: rows.length,
      detail: rows.length === 0
        ? 'none — safe, these were never billing/CRM clients'
        : `INFO: ${rows.map((r) => r.domain).join(', ')} linked to a clients row — that row is NOT touched by this script, but flag it to the owner before running --execute`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Distinct-value dump — every project_name/client_domain value this tenant's
// SEO tables actually contain, marked against the match set, so a human
// reviewing dry-run output can catch an alias the LEGACY_ALIASES map missed.
// ---------------------------------------------------------------------------

async function dumpDistinctNames(client: PoolClient | Pool, tenantId: string): Promise<void> {
  const textTables = TABLES.filter((t) => !t.isRegistry && (t.hasProjectName || t.hasClientDomain));
  const selects: string[] = [];
  for (const t of textTables) {
    if (!(await tableExists(client, t.name))) continue;
    if (t.hasProjectName) selects.push(`SELECT DISTINCT project_name AS name FROM ${t.name} WHERE tenant_id = $1`);
    if (t.hasClientDomain) selects.push(`SELECT DISTINCT client_domain AS name FROM ${t.name} WHERE tenant_id = $1`);
  }
  if (selects.length === 0) return;
  const { rows } = await client.query(`${selects.join(' UNION ')} ORDER BY 1`, [tenantId]);
  console.log('\nDistinct project_name / client_domain values found (tenant-scoped), matched against target set:');
  for (const row of rows) {
    const name = row.name as string | null;
    if (name === null) continue;
    const matched = ALL_MATCH_NAMES.includes(name.trim().toLowerCase());
    console.log(`  ${matched ? '✓ MATCHED' : '·        '}  ${name}`);
  }
  console.log('  Anything unmarked above that you recognise as one of these three clients under a');
  console.log('  different alias means LEGACY_ALIASES in this script needs updating before --execute.\n');
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

async function runDryRun(pool: Pool): Promise<void> {
  const tenantId = await resolveTenantId(pool);
  console.log(`Tenant '${TENANT_SLUG}' = ${tenantId}\n`);

  const siteIds = await resolveSiteIds(pool, tenantId);
  console.log(`Resolved ${siteIds.length}/${TARGET_DOMAINS.length} target domains to a seo_sites row.`);
  if (siteIds.length < TARGET_DOMAINS.length) {
    console.log('  (Fewer than 3 is expected on an environment that has not run migration 0046 yet,');
    console.log('   or on one where a domain was never registered in seo_sites — string-keyed rows');
    console.log('   are still matched and counted below either way.)\n');
  } else {
    console.log('');
  }

  console.log('=== Per-table match counts (this purge would delete these many rows) ===');
  let grandTotal = 0;
  for (const spec of TABLES) {
    if (!(await tableExists(pool, spec.name))) {
      console.log(`  ${spec.name.padEnd(24)} (table not present in this database — skipped)`);
      continue;
    }
    const matched = await countMatching(pool, spec, tenantId, siteIds);
    const total = await countTotalForTenant(pool, spec.name, tenantId);
    grandTotal += matched;
    console.log(`  ${spec.name.padEnd(24)} matched=${String(matched).padStart(6)}   tenant_total=${total}`);
  }
  console.log(`\nTOTAL rows across all tables that --execute would delete: ${grandTotal}\n`);

  await dumpDistinctNames(pool, tenantId);

  console.log('=== Pre-flight FK / cross-reference checks ===');
  const checks = await runPreflightChecks(pool, tenantId, siteIds);
  if (checks.length === 0) {
    console.log('  (skipped — registry-era tables not present in this database)');
  }
  for (const c of checks) {
    console.log(`  [${c.ok ? 'OK  ' : 'FAIL'}] ${c.label}: ${c.count} — ${c.detail}`);
  }
  const blocking = checks.filter((c) => !c.ok);
  if (blocking.length > 0) {
    console.log('\n  BLOCKING ISSUES FOUND — --execute will refuse to run until these are resolved.');
  }

  console.log('\nThis was a dry run. Nothing was written. See docs/go-live/SEO_CLIENT_DATA_PURGE_PLAN.md');
  console.log('for the preconditions required before passing --execute.');
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function runExecute(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const summary: Array<{ table: string; before: number; deleted: number; after: number; totalBefore: number; totalAfter: number }> = [];
  try {
    await client.query('BEGIN');

    const tenantId = await resolveTenantId(client);
    const siteIds = await resolveSiteIds(client, tenantId);
    console.log(`Tenant '${TENANT_SLUG}' = ${tenantId}, resolved site_ids = [${siteIds.join(', ') || 'none'}]\n`);

    console.log('Re-running pre-flight checks inside the transaction before deleting anything...');
    const checks = await runPreflightChecks(client, tenantId, siteIds);
    for (const c of checks) console.log(`  [${c.ok ? 'OK  ' : 'FAIL'}] ${c.label}: ${c.count} — ${c.detail}`);
    const blocking = checks.filter((c) => !c.ok);
    if (blocking.length > 0) {
      throw new Error(
        `Pre-flight check(s) failed — refusing to delete anything: ${blocking.map((c) => c.label).join('; ')}`,
      );
    }
    console.log('All pre-flight checks passed.\n');

    for (const spec of TABLES) {
      if (!(await tableExists(client, spec.name))) {
        console.log(`  ${spec.name.padEnd(24)} (table not present — skipped)`);
        continue;
      }
      const totalBefore = await countTotalForTenant(client, spec.name, tenantId);
      const before = await countMatching(client, spec, tenantId, siteIds);
      const { where, values } = await buildPredicate(client, spec, tenantId, siteIds);
      const { rowCount } = await client.query(`DELETE FROM ${spec.name} WHERE ${where}`, values);
      const deleted = rowCount ?? 0;
      const after = await countMatching(client, spec, tenantId, siteIds);
      const totalAfter = await countTotalForTenant(client, spec.name, tenantId);
      summary.push({ table: spec.name, before, deleted, after, totalBefore, totalAfter });
      console.log(
        `  ${spec.name.padEnd(24)} before=${before}  deleted=${deleted}  after=${after}  ` +
          `tenant_total ${totalBefore} -> ${totalAfter}`,
      );
      if (after !== 0) {
        throw new Error(`${spec.name}: ${after} matching row(s) remain after DELETE — aborting transaction`);
      }
      if (totalBefore - deleted !== totalAfter) {
        throw new Error(
          `${spec.name}: tenant total changed by more than the rows this purge deleted ` +
            `(${totalBefore} - ${deleted} != ${totalAfter}) — aborting transaction`,
        );
      }
    }

    await client.query('COMMIT');
    console.log('\nCOMMIT complete. All 15 tables processed inside one transaction.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nROLLED BACK — nothing was deleted.');
    throw err;
  } finally {
    client.release();
  }

  console.log('=== Summary (paste into .ai/HANDOFF_LOG.md) ===');
  console.log(JSON.stringify({ tenantSlug: TENANT_SLUG, domains: TARGET_DOMAINS, at: new Date().toISOString(), tables: summary }, null, 2));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const databaseUrl = resolveDatabaseUrl();
  const host = hostnameOf(databaseUrl);
  const isLocal = LOCAL_HOSTS.has(host);

  console.log(`Connected host: ${host}${isLocal ? ' (local)' : ' (NOT local — treat as potentially production)'}`);

  const wantsDelete = args.execute || args.confirm !== null;
  if (wantsDelete) {
    if (!args.execute || args.confirm !== CONFIRMATION_PHRASE) {
      console.error('\nRefusing to delete: --execute AND an exact --confirm string are both required.');
      console.error(`Expected --confirm="${CONFIRMATION_PHRASE}"`);
      printHelp();
      process.exit(1);
    }
    if (!isLocal && !args.allowNonLocal) {
      console.error(`\nRefusing to delete: DATABASE_URL resolves to '${host}', which is not localhost.`);
      console.error('This looks like it could be a shared or production database. Pass --allow-non-local');
      console.error('only after every precondition in docs/go-live/SEO_CLIENT_DATA_PURGE_PLAN.md is met.');
      process.exit(1);
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway.internal') || isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    if (wantsDelete) {
      console.log('\n*** EXECUTE MODE — this will permanently delete data. ***\n');
      await runExecute(pool);
    } else {
      await runDryRun(pool);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n[seo-client-purge] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
