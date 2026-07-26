# WizMatch Outbound Operating System — status

Chat-independent status for the `ge/outbound-0X-*` stacked-PR sequence. Read this before
`docs/prd/005-wizmatch-outbound-operating-system.md` if you only need "where are we, what's next."

> **Reviewed 2026-07-26 (Opus review lead), then repaired 2026-07-26 (spec-repair pass).** Full report:
> [`docs/reviews/wizmatch-outbound-overnight-opus-review.md`](../reviews/wizmatch-outbound-overnight-opus-review.md)
> — findings in §§3–6, dispositions in **§19**.
>
> **Current verdict: PR 2 may proceed**, against the acceptance criteria in PRD-005 §22.2.
> All six CRITICAL and all twelve HIGH findings are dispositioned: six CRITICAL resolved by
> specification change, eleven HIGH resolved, one (H-9) resolved as far as a CSV model permits with
> the residual limitation stated. Two owner items remain open and **neither blocks PR 2**: U-6
> (Smartlead fixtures, blocks PR 9) and U-7 (sign-off on three shared-table indexes, blocks G1).
>
> **Updated 2026-07-26 (this session): PR 2 implemented.** `ge/outbound-02-policy-schema-service` now
> has schema.ts additions, migration `0037`, and the L0-L8 resolver/gate module, against PRD-005 §22.2.
> **Not pushed, not merged, `0037` not applied to any database.** No caller migrates onto the gate —
> that is PR 3, still not started. PRs 3 and 4 branches still do not exist.
>
> **Updated 2026-07-26 (later same day): PR 2 closed out.** The Opus review's one open criterion
> (§22.2 #16, root-policy bootstrap on every company insert — B-1) is implemented and tested; the
> M-6 suppression expression index is added to `0037`; the ten §10.11.4 verifications ran with real
> output against disposable local Postgres databases (`127.0.0.1:5432`), superseding the prior
> session's "could not run — tool-permission denied" note below. Full detail:
> [`docs/reviews/wizmatch-outbound-pr2-opus-review.md`](../reviews/wizmatch-outbound-pr2-opus-review.md)
> §15. **Still not pushed, not merged, `0037` still not applied to production or Railway.** PR 3 was
> not started this session.
>
> **Updated 2026-07-26 (final independent readiness review): PR 2 is CODE READY at `102b657`.**
> The closeout above declared §22.2 #16 closed; an independent re-check found it closed on **two of
> three** company-insert paths, and on neither in the literal "same transaction" sense for the
> highest-volume path. Both gaps are fixed in `102b657`, verified against a disposable local
> PostgreSQL 16 through the real production code path. Marker: `.ai/OUTBOUND_PR2_CODE_READY`.
> Full report: [`docs/reviews/wizmatch-outbound-pr2-opus-review.md`](../reviews/wizmatch-outbound-pr2-opus-review.md)
> §16. **Still not pushed, not merged, `0037` still not applied to production or Railway. PR 3 not
> started.**

## Completed PRs

### PR 2 — `ge/outbound-02-policy-schema-service` — **implemented 2026-07-26, local only, not merged**

Built against PRD-005 §22.2 (twenty acceptance criteria). Summary (full detail in
`.ai/HANDOFF_LOG.md`'s 2026-07-26 PR-2 entry):

- **Schema** (`src/db/schema.ts`): 8 new tables, 2 additive ALTERs, 6 additive `(tenant_id, id)` unique
  indexes, 22 composite tenant-safe FKs, full CHECK set. First use of drizzle's `foreignKey()`/`check()`
  in this repo. `admin_override` / `suppression_scope` do not exist. Existing suppression unique index
  untouched.
- **Migration** (`src/db/migrations/0037_unknown_siren.sql`): generated via `db:generate`, hand-hardened
  with `IF NOT EXISTS` / `DO $$ EXCEPTION` guards on statements touching long-lived tables, plus one
  marked guard block for the policy-immutability trigger (the sole non-generatable construct). Zero
  destructive statements (grep-verified). Journal ordering correct. **Not applied — that is G1.**
- **Service** (`src/modules/outreach/`): `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed`
  / `resolveCompanyStatus`, branded `PolicyDecision`, `buildScopeKey()`, L0-L8 gate ladder, fail-closed,
  no legacy-status fallback. **No caller migrated onto it — PR 3 scope.**
- **Tests**: 37 new (scope key, taxonomy invariants, campaign-compatibility matrix, gate L0/L1/L1b/L3/
  L4/L5/L6/L6b/L7 scenarios). Full suite 97 files / 840 tests green after `npm run admin:install`.
  `npm run build` exits 0. `git diff --check` clean.
- **Could not run in this session**: the ten §10.11.4 fresh-database verification requirements needed
  real Postgres access; direct `psql` was denied by this session's tool-permission layer despite a
  local Postgres being reachable. Must run with real output before G1.
  **RUN in the 2026-07-26 closeout session** — see the addendum below and
  [`docs/reviews/wizmatch-outbound-pr2-opus-review.md`](../reviews/wizmatch-outbound-pr2-opus-review.md)
  §15 for full output. The remaining gap (production-sized index-lock measurement) is unchanged and
  still gates G1/U-7, not PR 2.
- **Honestly-scoped gaps**: cold-start confidence gating (§7) and duplicate-suspect containment (L5,
  §8.8) are not wired into the gate in this PR — no caller supplies that data yet; both are named
  in-code as PR-3/4 scope. §22.2 criterion 1 says "seven new tables" but its own §10.9.1 reference
  requires an eighth (`wizmatch_suppression_events`) — built all eight, flagging the PRD's own count as
  likely off-by-one rather than resolving it unilaterally.

### PR 1 — `ge/outbound-01-prd-adrs` (docs only) — **complete, not merged**

- Commit `687b8a0` — initial PRD-005 + ADR-006 + ADR-007 (taxonomy proposed, not ratified).
- Follow-up commit (this session) — final taxonomy ratification applied:
  - `policy_accepts_external_vendors` now requires evidence (`Evid` ⬜ → ✅, PRD §9.1).
  - `contact_role_mismatch` replaced by two codes (PRD §9.4):
    `contact_role_uncertain` (review, no evidence, never permanent) and
    `contact_role_confirmed_mismatch` (deny contact, evidence required, permanent only for the
    applicable employment relationship, learning label).
  - `docs/reviews/wizmatch-cost-leakage-audit-2026-07-09.md` §1 (verdict row 7) and §4
    ("All-domains-unhealthy Slack alert") annotated **superseded 2026-07-26** — the "keep sending"
    half of that decision is reversed by ADR-006 D-11 (fail closed). The alert-on-degradation half is
    unaffected.
  - PRD status header, §9 heading, ADR-006 status header and approval-question #1 updated from
    "awaiting ratification" to **ratified 2026-07-26**; §25.1 gained `A-21` recording the exact
    ratified changes; §25.2 now carries only `U-6` (Smartlead fixtures, blocks PR 9 only).
  - Consistency pass: full re-read of PRD-005 (all 26 sections) + ADR-006 + ADR-007 end-to-end;
    no other reference to `contact_role_mismatch` or to the un-ratified taxonomy status found outside
    §9 itself. `ge-add-ensure-table` skill (A-7/A-11) is still factually wrong
    (`.claude/skills/ge-add-ensure-table/SKILL.md` still claims "all ~12 Wizmatch tables use this
    pattern" and cites a non-existent `wizmatchOutreachTemplates.ts`) — **left untouched**, because its
    fix is scoped to the independent `ge/fix-ensure-table-skill` branch (§22), not this stack.
- **Push state (corrected 2026-07-26):** `687b8a0` **is pushed** — it exists on
  `origin/ge/outbound-01-prd-adrs`. Only `bbe881c` (ratification) is unpushed. An earlier version of
  this file and of `.ai/CURRENT_TASK.md` claimed "Not pushed", which was wrong; treat the remote branch
  as existing and do not rewrite its history. **Not merged.**

### PR 3 — `ge/outbound-03-policy-enforcement` — **not started** (branch does not exist)
### PR 4 — `ge/outbound-04-policy-ui-backfill` — **not started** (branch does not exist)

## Current branch

`ge/outbound-02-policy-schema-service`, worktree `/Users/jatinagrawal/repo-comparison/v2-outbound-os`.
**Working tree is clean** as of the final readiness review (2026-07-26); everything is committed.
PR 2 is code-ready at `102b657` and may be opened as a stacked draft. Nothing is pushed.

## Commit SHAs

- `687b8a0` — PRD-005 + ADR-006/007 initial commit (prior session). **On `origin`.**
- `bbe881c` — taxonomy ratification + this status doc. Local only.
- Review commit — this session's review report + handoff correction. Local only.

## Files changed (spec-repair session, 2026-07-26)

- `docs/prd/005-wizmatch-outbound-operating-system.md`
- `docs/decisions/ADR-006-company-outreach-policy.md`
- `docs/decisions/ADR-007-outreach-provider-boundary.md`
- `docs/reviews/wizmatch-outbound-overnight-opus-review.md` (new §19, findings preserved verbatim)
- `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md` (this file)
- `.ai/CURRENT_TASK.md`
- `.ai/HANDOFF_LOG.md`
- `.ai/OUTBOUND_PR2_SPEC_READY` (new marker)

Documentation and context layer only. No `src/`, no `admin/`, no `client/`, no migration, no config.

## Migration generated

**`0037_unknown_siren.sql` — generated this session (2026-07-26), NOT applied to any database.**
`npm run db:generate` (idx 37, journal `when=1785039545644` > `0036`'s `1784464092263`), then
hand-hardened per §10.11.2/H-11: `IF NOT EXISTS` on both `ADD COLUMN`s and on all six additive parent
unique indexes; the two `ADD CONSTRAINT`s touching long-lived tables (`wizmatch_companies`,
`wizmatch_suppression_list`) wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
one marked manual guard block containing the policy-immutability trigger (the only construct
drizzle-kit cannot emit). `grep -niE 'DROP TABLE|DROP COLUMN|DROP CONSTRAINT|DROP INDEX|ALTER COLUMN.*TYPE|SET NOT NULL|TRUNCATE|DELETE FROM'`
against the file returns zero matches. Re-running `npm run db:generate` reports "No schema changes,
nothing to migrate" — `schema.ts` and the migration are in sync.

## Tests run and results

PR 2 adds code. Measured this session (2026-07-26), real output:

```
npm run build           →  tsc, exit 0
npm run admin:install    →  added 162 packages (closes the lucide-react load gap)
npm test                →  Test Files  97 passed (97)
                              Tests  840 passed (840)
git diff --check        →  clean
```

37 of the 840 tests are new for PR 2: `wizmatchOutreachGate.test.ts`, `wizmatchScopeKey.test.ts`,
`wizmatchReasonCodes.test.ts`, `wizmatchCampaignCompatibility.test.ts`.

## Failed tests

None. The two suites that previously failed to **load** (`adminFrontendHelpers.test.js`,
`wizmatchRouteRegistry.test.js`, both on missing `lucide-react`) now pass — `npm run admin:install` was
run this session, closing that environmental gap. Root `package-lock.json` confirmed untouched by the
admin install (`git status --short` / `git diff --stat package-lock.json` both empty).

## §10.11.4 fresh-database verification — RUN 2026-07-26 (closeout session)

Superseded the prior session's tool-permission block. Ran against `127.0.0.1:5432` (confirmed local
before every command), using disposable databases (`wizmatch_pr2_verify_full`,
`wizmatch_pr2_verify_incremental`, plus three short-lived timing databases), all dropped after
recording results. Full detail and exact commands/output in
[`docs/reviews/wizmatch-outbound-pr2-opus-review.md`](../reviews/wizmatch-outbound-pr2-opus-review.md)
§15. Summary:

- Fresh `0000→0037` replay: succeeded (38/38 migrations, journal-ordered).
- Incremental (0000→0036, then 0037 alone against the same restore): succeeded.
- Re-apply of either database: no-op (drizzle-kit's hash tracking).
- Composite FKs: confirmed present via `\d wizmatch_company_policies`.
- Destructive-statement scan: zero (test-automated, re-confirmed).
- Immutability trigger: decision-column `UPDATE` rejected; supersession-metadata-only `UPDATE`
  succeeded.
- Root-policy CHECKs: complete `entire_company` row succeeds; incomplete one fails
  (`..._root_defines_all_chk`); scoped row overriding one dimension succeeds; no-op scoped row fails
  (`..._scoped_overrides_one_chk`).
- Duplicate ordered-pair CHECK and the cold-email-lock partial unique index both fired correctly.
- **Not run, and correctly out of scope for a disposable local database:** the production-sized
  index-build lock measurement on `users`/`contacts`/`contact_channels` (U-7 needs a
  production-sized restore) and the production `information_schema` drift diff (needs a copy of the
  actual production schema, not a fresh local one). Both remain explicit G1 prerequisites.

### Spec-repair pass — 2026-07-26 (docs only)

Applied on `ge/outbound-01-prd-adrs`. Eight owner decisions D-1 … D-8, recorded as PRD-005 §25.1
A-22 … A-30. Three read-only Explore subagents produced the evidence (schema/tenancy, chokepoint
callers, states/suppression/taxonomy); the main session owned every edit.

| Decision | Effect | Resolves |
|---|---|---|
| D-1 | Missing root policy → `deny` / `policy_missing_root`. Legacy-status fallback **deleted**. New gate **L0**. Legacy intelligence status is display-only | C-2 |
| D-2 | All **22** entity references become composite `(tenant_id, ref_id)` FKs. `scope_ref_id` **deleted**, replaced by typed `signal_id` / `requirement_id`. Signals table named as `wizmatch_job_signals` | C-3, H-5 |
| D-3 | Raw SQL approved for the immutability trigger only, in a marked guard block, six-step process. `admin_override` **deleted** | C-4, H-8, M-9 |
| D-4 | `suppression_scope` **deleted**; `UNIQUE (tenant_id, email)` **retained** → `0037` is additive again. Three grains, three homes, append-only `wizmatch_suppression_events` | C-5 |
| D-5 | `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` named; branded `PolicyDecision`; **31-row caller-migration checklist** with `file:line` | C-6, H-9 |
| D-6 | A reply does **not** release the cold-email lock. 15 enrolment states: 8 live, 7 terminal. All four lock predicates amended together | H-6 |
| D-7 | Evidence required for every permanent **or** non-overridable block, CHECK-enforced. New gate **L1c**. Taxonomy corrected; §9.11 gains invariant 5 | H-2, H-7 |
| D-8 | Taxonomy correctable until PR 2; after PR 2 a rename needs a migration plus compatibility mapping | — |

**Two schema facts the audit corrected that PR 2 must not get wrong:** the signals table is
`wizmatch_job_signals` — the table named `signals` is Growth's and has **no `tenant_id` at all**; and
adopting drizzle's `check()` for the first time may make drizzle-kit propose **dropping** the three
pre-existing CHECK constraints on Growth's `prospects` / `signals` tables (`0017:32-63`), which is the
concrete way an "additive" migration could damage Growth. §10.11.3 makes catching that a blocking gate.

## Blockers

**PR 2 is fully closed against §22.2 as of 2026-07-26 (closeout session).** §22.2 #16 (root-policy
bootstrap) is implemented and tested; M-6 (suppression expression index) is added; the §10.11.4
verifications ran with real output (see above), except the production-sized lock measurement, which
was never in scope for a local database. PR 3 builds against §22.3 (the §8.10.1 caller checklist) and
can start independently — it does not apply `0037` either. Remaining, unchanged: U-7 (owner sign-off
on the three shared-table indexes) and the production-sized lock measurement both still gate G1, not
PR 2 or PR 3.

Still open, neither blocking PR 2 or PR 3:

- **U-6** — sanitised Smartlead CSV fixtures. Blocks **PR 9** only.
- **U-7** — owner sign-off on the additive `(tenant_id, id)` unique indexes on `users`, `contacts` and
  `contact_channels`, which are core CRM tables shared with the Growth tenant. The indexes cannot fail
  or reject a write, but the build takes a brief write lock on another product's tables. Blocks **G1**
  only; PR 2 writes the schema and measures the lock.

Note the C-5 status change: the handoff previously recorded the suppression fix as **non-additive**.
Under D-4 it is **additive** — no index is dropped and no production dedup dry-run is needed.

## Do not commit

`package-lock.json` is modified in this worktree by unrelated local `npm install` churn. Committing it
would **revert CI hotfix `492a6a8`** (it deletes the `@emnapi` entries that hotfix added) and re-break
`npm ci`. Leave it unstaged.

## Deviations from PRD-005 (PR 2 session)

1. §22.2 criterion 1 literally reads "Seven new tables per §10.1–§10.7 and §10.9.1" — but §10.1-§10.7
   is seven sections (seven tables) and §10.9.1 (`wizmatch_suppression_events`) is an eighth, required
   by D-4/D-15's three-grain suppression model and referenced by name throughout §8.5/§10.9/§20.1's test
   list. Built all eight tables. This reads as a PRD count/reference mismatch against its own §10.9.1
   requirement, not a scope reduction — flagging for owner awareness rather than resolving unilaterally.
2. The §10.11.4 fresh-database verification requirements were not run against a real Postgres instance
   (see above) — a session tool-permission limitation, not a design deviation. Journal ordering and the
   destructive-statement scan were confirmed by direct inspection instead.
   **Resolved 2026-07-26 (closeout session)** — run against disposable local Postgres databases, real
   output recorded above and in the review doc §15. The production-sized lock measurement remains out
   of scope for a local database and still gates G1/U-7.
3. The gate module's L7 does not yet implement the cold-start contact-confidence gate (§7) or query
   `wizmatch_company_duplicates` for L5 pending-duplicate containment (§8.8) — both require data/wiring
   that has no caller yet in PR 2's no-callers-migrate scope. Stated in the module's header comment.
4. Test coverage is a representative core subset of §20.1's ~40-item list, not exhaustive — concurrency
   races, backfill idempotency, and CSV round-trip scenarios depend on code (backfill script, CSV
   adapter) that doesn't exist until later PRs in the stack.

No deviation weakens a stated invariant: fail-closed holds on every path exercised by the 37 new tests,
the immutability trigger is present, the suppression model is three-grain per D-4/D-15, and no legacy
fallback exists in `resolveCompanyStatus`.

## Subagent findings used (this session, PR 2)

Three read-only Explore subagents run in parallel before any edit, each restricted from editing,
committing, branch changes, migration application, production and Railway access.

1. **Migration/schema conventions** — confirmed 0037 is the next free journal index; the `0017` hand-SQL
   precedent (`DO $$ ... EXCEPTION WHEN duplicate_object`); zero triggers/functions in any migration;
   zero `foreignKey()`/`check()` usage in `schema.ts`; dumped exact current column/index definitions for
   every table PR 2 needed to reference or alter; confirmed `drizzle-orm` is actually `^0.45.1` (docs
   said 0.45.2 — a one-patch discrepancy, not load-bearing); confirmed clean working tree and missing
   `admin/node_modules`.
2. **Tenant reference matrix** — verified all 22 planned composite-FK targets against the live
   `schema.ts`; confirmed `signals` (Growth, no `tenant_id`) and `wizmatch_job_signals` (WizMatch,
   tenant-scoped) are genuinely distinct tables; confirmed none of `users`/`contacts`/`contact_channels`
   already had a `(tenant_id, id)` unique index; confirmed both `wizmatch_requirements.company_id` and
   `wizmatch_job_signals.company_id` are nullable (the same-tenant-not-same-company limitation is real).
3. **Resolver/test patterns** — read the e-sign provider module in full as the ADR-007 precedent;
   identified `wizmatchCostGuard.ts`'s pure-evaluator-with-typed-input-struct shape as the closer match
   for a policy gate than a provider-swap interface; confirmed no branded-type precedent exists in the
   repo (introduced fresh); surveyed `db` client re-export conventions and existing vitest DB-mocking
   patterns (`outboundTenantIsolation.test.ts`'s `vi.mock` idiom, adapted here via `vi.hoisted`).

## Security observations

None new. No credential, guardrailed auth/RBAC path, Cashfree route, or production-data path was
touched. `wizmatch_reply_mailboxes.provider_config` write-time secret-key rejection and `secret_ref`
scheme validation are specified in the schema comments but the validator itself is service-layer code
not yet written (no route calls this table in PR 2) — flagged so it isn't assumed to already exist.

## Exact next step

**Open PR 2 as a stacked draft** off `ge/outbound-01-prd-adrs` at `102b657`. PR 2 is code-ready and
the branch is clean; the readiness marker is `.ai/OUTBOUND_PR2_CODE_READY`.

**Then start PR 3** (`ge/outbound-03-policy-enforcement`, cut from this branch) — the §8.10.1 31-row
caller-migration checklist, the A-1/A-4 fixes, and the mailer fallback reversal (ADR-006 D-11).
PR 3 prerequisites are listed in review §16.11 (M-9 taxonomy CHECK with the write API, M-7, and the
L-6 predicate-capture gaps).

Before G1 (applying `0037` to production), independently of PR 3:

1. ~~Run the ten §10.11.4 verification requirements~~ **Done 2026-07-26**, and the fresh
   `0000→0037` replay was **re-run independently** in the final review (38 migrations applied on a
   fresh disposable local database). Two of the ten remain G1-gated and cannot be done from a local
   database: the production-sized index-lock measurement, and the production `information_schema`
   drift diff (review §16.8 M-10).
2. Obtain owner sign-off on U-7 (the three shared-table `(tenant_id, id)` indexes) — still open.
   **Recommend folding the M-10 drift diff into the same sign-off**, and correcting §22.2 #10's
   wording in a later docs-only pass, since its literal text asks PR 2 for production access that
   §22.2 #12 forbids until G1.
3. Do **not** apply `0037` to production, run the backfill with `--apply`, promote enforcement to
   `enforce`, touch Railway, or push without explicit confirmation. Do not stage `package-lock.json`.

### 2026-07-26 closeout session — what changed

- New commits (not yet pushed): root-policy bootstrap helper + call-site wiring
  (`src/modules/outreach/companyBootstrap.ts`, `wizmatchSourcing.ts`,
  `wizmatchContactIntelligenceRepo.ts`), the M-6 suppression expression index in `0037`, and tests
  for both, across `wizmatchSourcing.test.ts`, `wizmatchContactIntelligenceRepo.test.ts`,
  `wizmatchOutreachGateContract.test.ts`, `wizmatchOutboundMigrationContract.test.ts`.
- `npm run build` exit 0, `npm test` 99 files / 873 tests green, `git diff --check` clean,
  `npm run db:generate` reports no schema drift.
- Real local-Postgres verification performed and recorded (see §15 of the review doc); five
  disposable databases created and dropped, nothing applied to Railway or any shared database.
- PR 3 was not started. Working tree left clean of any leftover verification artifacts (temp files
  and disposable databases all removed).

### 2026-07-26 final independent readiness review — what changed

Three read-only Explore subagents (migration/DB; bootstrap/tenancy; resolver/suppression/tests) plus
main-session verification against a **disposable local PostgreSQL 16** at `127.0.0.1`, created and
dropped in-session. Full report: review doc §16.

**One new commit, `102b657` — `fix(wizmatch): close the three §22.2 #16 bootstrap gaps`:**

- **`scripts/onboarding/wizmatch-seed-ats-boards.ts` had no root-policy write at all** — a third
  company-insert path the closeout session missed. It is the only creator of ATS-linked companies
  (the daily 6 AM poller harvests them), so those companies were permanently L0
  `policy_missing_root` denied and **unrepairable by re-running the script**, whose
  `WHERE NOT EXISTS` guard never re-inserts the row. Now bootstraps inside the `BEGIN`/`COMMIT` it
  already held.
- **`wizmatchSourcing.ts` bootstrapped in a second statement**, not one transaction. A failure
  between the two committed a company with no policy, and re-ingestion could never repair it — the
  next upsert takes the `DO UPDATE` branch, so `(xmax = 0)` is false. Both writes are now **one**
  data-modifying-CTE statement; a single statement is atomic in PostgreSQL, which gives §8.1's
  guarantee without needing a dedicated connection and keeps the injectable `Queryable` contract.
- **`reason_code='policy_unknown_cold_start'` was missing from the persisted row**, which PRD §8.1
  and ADR-006 both specify.
- **`scope_key` now comes from `buildScopeKey()`** (§22.2 #17) rather than a duplicated literal.
- New `src/__tests__/wizmatchCompanyBootstrapCoverage.test.ts` asserts at **source level** that every
  file inserting a company also bootstraps — verified to go red with the seed script's bootstrap
  removed. The sourcing tests now assert the SQL **predicate** rather than a mock's return flag.

Neither gap was ever a safety hole — both fail closed — but both broke §21.2 condition 4 ("zero
companies missing an effective policy") for every company created after the fix, which is exactly
what D-1/A-30 exist to prevent.

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **100 files / 876 tests
green** · `npm run db:generate` "No schema changes, nothing to migrate."

**Verified on the disposable local database** (not by reasoning): fresh `0000→0037` replay applied 38
migrations; the real ingest path wrote the exact spec row; re-ingest left policy count at 1;
"companies missing a root policy" = 0; a duplicate active root row was rejected by
`wizmatch_company_policies_active_scope_uniq`; `EXPLAIN` shows the planner using
`wizmatch_suppression_tenant_lower_email_idx` for the gate's `tenant_id + lower(email)` predicate
(retiring M-6 with evidence). Pre-existing `UNIQUE (tenant_id, email)` confirmed intact.

**Not done, deliberately:** no push, no merge, no deploy, no Railway, no production or shared-database
migration, no backfill, no sending, no paid provider, no Smartlead, no PR 3 work, no caller wired onto
the gate, no schema or migration file edited, no Growth/SEO/n8n/legacy code touched. The disposable
database was dropped and the working tree left clean.

**Remaining owner items:** U-7 (three shared-table indexes) and the production-sized lock measurement
gate G1, unchanged; the production `information_schema` drift diff (M-10) is recommended to join the
same sign-off.
