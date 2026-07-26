// PRD-005 §22.2 #16, §8.1, ADR-006 A-30 — the cold-start root-policy bootstrap.
//
// Every company-insert path must write the entire_company root policy row in
// the same operation that creates the company row, so a company row is never
// observable without an effective policy — the exact failure D-1/A-22 exist
// to prevent (a missing root row must fail closed, but "always fails closed
// forever" is worse than "always has a row"). The default root row is
// deliberately NOT an allow: outreach starts at needs_review, so the L0-L8
// gate (src/modules/outreach/outreachGate.ts) returns review (or deny, never
// allow) for a brand-new company until a human or the scoring pipeline sets a
// real relationship.
//
// Scope discipline (§22.2 #16, do-not-touch list):
//   - No allow policy is ever created here.
//   - No backfill: existing companies are untouched: this only fires on the
//     insert path.
//   - No Growth/legacy prospects or signals table is touched.

export type WizmatchQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

/** PRD-005 §22.2 — the exact default root row. Not exported piecemeal so no
 * caller can construct a partial/incorrect root row by hand. */
export const WIZMATCH_ROOT_POLICY_DEFAULTS = Object.freeze({
  scopeType: 'entire_company',
  scopeKey: 'entire_company',
  outreachEligibility: 'needs_review',
  externalHiringPolicy: 'unknown',
  relationshipType: 'new_prospect',
  blockClass: 'standard',
  isNonOverridable: false,
  source: 'deterministic_rule',
} as const);

/**
 * Idempotent and concurrency-safe: relies on the partial unique index
 * `wizmatch_company_policies_active_scope_uniq` on
 * (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL (migration
 * 0037). Two concurrent callers racing to bootstrap the same company can
 * never both succeed in creating an active root row — the loser's INSERT is
 * a no-op via ON CONFLICT DO NOTHING, so duplicate active root policies are
 * impossible (§22.2 requirement 4). Never overwrites an existing root row.
 */
export async function insertWizmatchCompanyRootPolicy(
  client: WizmatchQueryable,
  tenantId: string,
  companyId: string,
): Promise<void> {
  const d = WIZMATCH_ROOT_POLICY_DEFAULTS;
  await client.query(
    `INSERT INTO wizmatch_company_policies
       (tenant_id, company_id, scope_type, scope_key, outreach_eligibility,
        external_hiring_policy, relationship_type, block_class, is_non_overridable, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL DO NOTHING`,
    [
      tenantId,
      companyId,
      d.scopeType,
      d.scopeKey,
      d.outreachEligibility,
      d.externalHiringPolicy,
      d.relationshipType,
      d.blockClass,
      d.isNonOverridable,
      d.source,
    ],
  );
}

/**
 * Runs `run` inside one BEGIN/COMMIT transaction on a dedicated client from
 * `pool.connect()` — never on the shared Pool's `.query()`, which hands out a
 * different connection per call and so cannot hold a transaction across two
 * statements. Used to make company-row creation and root-policy creation
 * atomic wherever a caller can afford a dedicated connection (§22.2
 * requirement 2). Rolls back and rethrows on any error.
 */
export async function withWizmatchCompanyTransaction<T>(
  pool: { connect: () => Promise<any> },
  run: (client: WizmatchQueryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
