# WizMatch G2 backfill — FINAL result

**Date:** 2026-07-28 · **Mechanism:** reviewed `wizmatch-policy-backfill` logic, executed as
a single atomic SQL statement in the production `Postgres` container (same values, predicate
and conflict target as `scripts/onboarding/wizmatch-policy-backfill.ts`; tenant scoped by
subquery, no hand-typed UUIDs).

## Dry run (read-only, twice — deterministic)
- Total WizMatch companies: **183**
- Missing a root policy: **183** (both dry runs identical)
- Companies with >1 active root: **0**
- Non-WizMatch policies: **0**
- Conclusion: every company predates the bootstrap; all need a deterministic root policy.

## Apply
`INSERT … SELECT … ON CONFLICT (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL
DO NOTHING` → **`INSERT 0 183`**. Values per the reviewed safety net:
`scope_type='entire_company'`, `scope_key='entire_company'`,
`outreach_eligibility='needs_review'`, `external_hiring_policy='unknown'`,
`relationship_type='new_prospect'`, `source='deterministic_rule'`,
`reason_code='policy_unknown_cold_start'`, `is_permanent=false`, `block_class='standard'`,
`is_non_overridable=false`.

**Missing context never becomes allow:** every row is `needs_review`, never `allow`.

## Post-apply verification (read-only)
- `missing_after = 0` (idempotent — a re-run would insert 0)
- `active_root_policies = 183` (exactly one per WizMatch company)
- Companies with >1 active root: **0**
- Non-WizMatch policies: **0** (tenant-safe)
- Rows deviating from `needs_review` / `policy_unknown_cold_start` / `deterministic_rule`: **0**

No provider, sending, preparation, or paid-discovery action occurred. Enforcement remains
`shadow`. Verdict: **G2 PASS.**
