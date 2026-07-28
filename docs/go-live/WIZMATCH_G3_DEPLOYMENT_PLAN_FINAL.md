# WizMatch G3 deployment plan — FINAL

**Gate token:** `APPROVE_G3_MERGE_DEPLOY_SHADOW` (supplied). Proceed only if final CI is green
on the exact PR head and every G3 precondition holds.

## Preconditions (all met at the time of this plan)
- Migration `0037` applied + journal-verified in production (Phase G ✓).
- Backfill applied + idempotent + tenant-safe (Phase H ✓).
- App code unchanged after reviewed `0d330269`; all later commits docs-only.
- Encrypted logical backup restorable; recovery point = `2026-07-28T05:59:17Z`.
- All dangerous features currently off; enforcement `shadow`.

## Two-user pilot roster (owner decision — Itika deferred)
Exactly two humans, exact lowercase UUIDs **read from the production DB** (never hand-typed —
homoglyph lesson), both in the WizMatch tenant, both `admin`:
- `jatin@growthescalators.com` → admin
- `kanishk.khandelwal@growthescalators.com` → admin

No Itika, no `viewer`, no machine-sync principal in the human roster. The existing
`WIZMATCH_STAFFING_PILOT_USER_IDS` already holds exactly these two (verified by set-membership
in the G1 read-only pass); G3 re-verifies it equals the two DB-read UUIDs.

## Steps (in order)
1. **Push docs-only evidence once** (this doc set). No app-code change.
2. **Final full CI** on the exact PR head (`npm run build`, `npm test`, admin build,
   Playwright). **Stop if not green.**
3. **Mark PR #89 ready for review**, then **merge with a normal merge commit** (preserve
   history). The repo auto-deploys on push to `main`; the deploy runs
   `node dist/scripts/migrate.js && node dist/index.js` — `0037` is already in the journal, so
   migrate.js skips it (no re-apply).
4. **Verify the deployed commit** equals the merged PR head; verify `web` reaches SUCCESS.
5. **Enable pilot features** (Railway variables on `web`, non-secret values via
   `set_variables`): `WIZMATCH_COMPANY_POLICY_ENABLED=true`,
   `WIZMATCH_DECISION_WORKBENCH_ENABLED=true`. (Each triggers a redeploy of the new code.)
6. **Re-verify the roster** `WIZMATCH_STAFFING_PILOT_USER_IDS` equals exactly the two DB-read
   admin UUIDs (no Itika, no viewer, no machine principal). Adjust only if it does not.
7. **Run readiness** (`npm run wizmatch:pilot-readiness -- --audit-env-file …`) — must exit 0
   against the production-safe baseline (sending/prep/adapter/email/paid-discovery off,
   enforcement shadow, NODE_ENV=production, roster present).
8. **Production smoke tests** (controlled synthetic records only; no real prospect, no email,
   no enrolment, no provider) — see `WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md`.

## Final production safety state (must hold)
```
NODE_ENV=production
WIZMATCH_POLICY_ENFORCEMENT_MODE=shadow
WIZMATCH_SENDING_ENABLED=false
AUTOMATED_EMAILS_ENABLED=false
WIZMATCH_AUTO_PREP_ENABLED=false
WIZMATCH_OUTREACH_ADAPTER_ENABLED=false
WIZMATCH_COMPANY_POLICY_ENABLED=true
WIZMATCH_DECISION_WORKBENCH_ENABLED=true
```
Smartlead absent. Paid discovery disabled. No real email; no enrolment; no provider invocation.

## Rollback
If a production defect appears: flip the offending `WIZMATCH_*_ENABLED` flag(s) to false
(redeploy). If schema/data repair is needed, the recovery point is the encrypted logical
backup (`2026-07-28T05:59:17Z`); a full restore is a separate explicit owner decision.
