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

import { buildScopeKey } from './scopeKey';

export type WizmatchQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

/** PRD-005 §22.2 — the exact default root row. Not exported piecemeal so no
 * caller can construct a partial/incorrect root row by hand. `scopeKey` comes
 * from `buildScopeKey`, the only permitted producer of a scope key (§22.2 #17),
 * rather than a duplicated literal. */
export const WIZMATCH_ROOT_POLICY_DEFAULTS = Object.freeze({
  scopeType: 'entire_company',
  scopeKey: buildScopeKey('entire_company'),
  outreachEligibility: 'needs_review',
  externalHiringPolicy: 'unknown',
  relationshipType: 'new_prospect',
  blockClass: 'standard',
  isNonOverridable: false,
  source: 'deterministic_rule',
  // PRD-005 §8.1 and ADR-006 ("Backfill proposal") both name the reason code
  // that must be persisted on the cold-start row, so a raw read of the table
  // (or the PR 4 backfill's own reconciliation) sees the same fact the resolver
  // derives. Permitted with no evidence because the row is neither permanent
  // nor non-overridable, so `..._evidence_required_chk` is satisfied.
  reasonCode: 'policy_unknown_cold_start',
} as const);

/** Column list for the root-policy INSERT. Shared by the standalone helper and
 * the single-statement (CTE) form below so the two can never drift apart. */
const ROOT_POLICY_COLUMNS =
  '(tenant_id, company_id, scope_type, scope_key, outreach_eligibility,' +
  ' external_hiring_policy, relationship_type, block_class, is_non_overridable, source, reason_code)';

/** Arbiter is the partial unique index `wizmatch_company_policies_active_scope_uniq`. */
const ROOT_POLICY_ON_CONFLICT =
  'ON CONFLICT (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL DO NOTHING';

/** The default values in `ROOT_POLICY_COLUMNS` order, after tenant_id and company_id. */
function rootPolicyValueParams(): unknown[] {
  const d = WIZMATCH_ROOT_POLICY_DEFAULTS;
  return [
    d.scopeType,
    d.scopeKey,
    d.outreachEligibility,
    d.externalHiringPolicy,
    d.relationshipType,
    d.blockClass,
    d.isNonOverridable,
    d.source,
    d.reasonCode,
  ];
}

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
  await client.query(
    `INSERT INTO wizmatch_company_policies
       ${ROOT_POLICY_COLUMNS}
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ${ROOT_POLICY_ON_CONFLICT}`,
    [tenantId, companyId, ...rootPolicyValueParams()],
  );
}

/**
 * The bootstrap as a data-modifying CTE, for a caller that creates the company
 * with a single upsert on the shared pool and so cannot hold a multi-statement
 * transaction (§22.2 #16 requires the root policy to be written in the *same
 * transaction* as the company row). A single SQL statement is atomic in
 * PostgreSQL, so folding both writes into one statement gives that guarantee
 * without needing a dedicated `pool.connect()` client.
 *
 * `companyCte` must name a preceding CTE that returns `id` and a boolean
 * `inserted`; the policy row is written only when `inserted` is true, so an
 * upsert that merely updated an existing company never touches its policy.
 *
 * Verified against PostgreSQL 16: the composite FK
 * `(tenant_id, company_id) -> wizmatch_companies(tenant_id, id)` resolves
 * within the same statement, because FK checks fire as end-of-statement
 * AFTER-ROW triggers.
 */
export function wizmatchRootPolicyBootstrapCte(
  companyCte: string,
  tenantParam: string,
  firstParam: number,
): { sql: string; params: unknown[] } {
  const p = (offset: number) => `$${firstParam + offset}`;
  return {
    sql: `INSERT INTO wizmatch_company_policies
       ${ROOT_POLICY_COLUMNS}
     SELECT ${tenantParam}, ${companyCte}.id,
            ${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}
     FROM ${companyCte} WHERE ${companyCte}.inserted
     ${ROOT_POLICY_ON_CONFLICT}`,
    params: rootPolicyValueParams(),
  };
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
