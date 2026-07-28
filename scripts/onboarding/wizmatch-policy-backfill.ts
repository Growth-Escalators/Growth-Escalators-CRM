/**
 * PRD-005 §11 / ADR-006 "Backfill proposal" — dry-run-first root-policy
 * backfill. Writes one scope='entire_company' row
 * (outreach_eligibility='needs_review', external_hiring_policy='unknown',
 * relationship_type='new_prospect', source='deterministic_rule',
 * reason_code='policy_unknown_cold_start') for every existing
 * wizmatch_companies row that has no active root policy row yet.
 *
 * This is a SAFETY NET, not the primary mechanism — PR 2/3 already write the
 * root row in the same transaction/statement as every company-insert path
 * (companyBootstrap.ts). This script only catches companies that predate that
 * bootstrap (i.e. existed before migration 0037's tables did).
 *
 * SAFE BY DEFAULT: exits without writing any row unless --apply is passed.
 * Two machine guards, both required by PRD-005 §11 (resolves review M-6):
 *   1. Tolerance-deviation abort — if the live "missing" count at --apply time
 *      differs from the dry-run count by more than WIZMATCH_BACKFILL_TOLERANCE
 *      (default 5), the script aborts before writing anything.
 *   2. No-op-by-construction re-run — --apply reuses
 *      insertWizmatchCompanyRootPolicy(), which INSERTs with
 *      `ON CONFLICT (tenant_id, company_id, scope_key) WHERE superseded_at IS
 *      NULL DO NOTHING`, so a second --apply run against the same tenant
 *      writes exactly zero rows (idempotent, concurrency-safe).
 *
 * Usage (dry run — the only mode this session may execute):
 *   DATABASE_URL=... WIZMATCH_TENANT_ID=... npm run wizmatch:policy-backfill
 *
 * Usage (apply — NEVER run this from this session; requires explicit owner
 * approval per AGENTS.md, and is gate G2 in PRD-005 §21):
 *   DATABASE_URL=... WIZMATCH_TENANT_ID=... npm run wizmatch:policy-backfill -- --apply
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { insertWizmatchCompanyRootPolicy, withWizmatchCompanyTransaction } from '../../src/modules/outreach/companyBootstrap';
import { buildDryRunReport, assertWithinTolerance, DEFAULT_BACKFILL_TOLERANCE } from '../../src/modules/outreach/policyBackfill';

export { buildDryRunReport, assertWithinTolerance };

async function fetchMissingRootPolicyCompanies(
  pool: Pool,
  tenantId: string,
): Promise<{ totalCompanies: number; missing: Array<{ id: string; name: string }> }> {
  const totalResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM wizmatch_companies WHERE tenant_id = $1`,
    [tenantId],
  );
  const totalCompanies = Number(totalResult.rows[0]?.count ?? '0');

  const missingResult = await pool.query<{ id: string; name: string }>(
    `SELECT c.id, c.name
       FROM wizmatch_companies c
       WHERE c.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM wizmatch_company_policies p
           WHERE p.tenant_id = c.tenant_id
             AND p.company_id = c.id
             AND p.scope_type = 'entire_company'
             AND p.superseded_at IS NULL
         )
       ORDER BY c.created_at ASC`,
    [tenantId],
  );

  return { totalCompanies, missing: missingResult.rows };
}

async function main(): Promise<void> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  const connectionString = process.env.DATABASE_URL;
  if (!tenantId || !connectionString) {
    throw new Error('DATABASE_URL and WIZMATCH_TENANT_ID are required.');
  }
  const apply = process.argv.includes('--apply');
  const tolerance = Number(process.env.WIZMATCH_BACKFILL_TOLERANCE ?? DEFAULT_BACKFILL_TOLERANCE);

  const pool = new Pool({ connectionString });
  try {
    const { totalCompanies, missing } = await fetchMissingRootPolicyCompanies(pool, tenantId);
    const dryRunReport = buildDryRunReport('dry_run', tenantId, totalCompanies, missing);
    console.log(JSON.stringify(dryRunReport, null, 2));

    if (!apply) {
      console.log('\nDry run only — no row written. Pass --apply (with explicit owner approval) to write.');
      return;
    }

    // Guard 1: re-count immediately before writing and abort on drift.
    const live = await fetchMissingRootPolicyCompanies(pool, tenantId);
    assertWithinTolerance(missing.length, live.missing.length, tolerance);

    let written = 0;
    await withWizmatchCompanyTransaction(pool, async (client) => {
      for (const company of live.missing) {
        await insertWizmatchCompanyRootPolicy(client, tenantId, company.id);
        written += 1;
      }
    });

    console.log(
      JSON.stringify(
        { mode: 'apply', tenantId, attempted: live.missing.length, written },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[wizmatch policy backfill] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
