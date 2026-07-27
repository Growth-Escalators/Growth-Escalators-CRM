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
> **Updated 2026-07-27: PR 7 implemented (self-reported).** `ge/outbound-07-free-prep`
> (`prepareCompaniesJob`, PRD-005 §14) is built against a code-ready PR 6
> (`.ai/OUTBOUND_PR6_CODE_READY`). Full detail:
> [`docs/reviews/wizmatch-outbound-pr7-implementation.md`](../reviews/wizmatch-outbound-pr7-implementation.md)
> and the PR 7 section at the bottom of this file. **Not independently reviewed yet — do not start PR 8
> before that review.**
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

---

## PR 3 — `ge/outbound-03-policy-enforcement` (2026-07-26, local only, NOT pushed/merged)

Cut from `ge/outbound-02-policy-schema-service` at `4b68769`. Implements PRD-005 §22.3 — shadow
enforcement wired onto the §8.10.1 caller checklist, plus the A-1/A-4/mailer/HMAC fixes. **Does not
promote `enforce` and does not enable sending** — `WIZMATCH_POLICY_ENFORCEMENT_MODE` ships defaulting
to `shadow`, `WIZMATCH_SENDING_ENABLED` and `AUTOMATED_EMAILS_ENABLED` are untouched.

**Chokepoint semantics fixed for real use (this PR, not PR 2):** `evaluateWizmatchOutreachGate`
already existed but nothing called it. Two gaps had to close before wiring any caller:
- `assertWizmatchOutreachAllowed` unconditionally threw on any non-allow — that's correct for
  `enforce` but would have made every wired call site block in `shadow` too, which the review's own
  P R2 note flagged as "shadow-vs-enforce is a no-op either way in PR 2: nothing calls this module."
  Fixed with a new exported `shouldBlock(ctx, decision)` helper: computes `decision !== 'allow' &&
  enforcementMode === 'enforce'`, and logs a structured `shadow would-block` observation on every
  would-block in shadow mode (§16 rule 2's "gate_denied observation" — logged today; a persisted,
  queryable observation table is PR 4/readiness-report scope, stated not hidden).
- Added `suppress()` as the sole write path for the email/channel suppression grain (§8.10.1 rows
  25-29): lowercases the address, writes `wizmatch_suppression_list` AND the append-only
  `wizmatch_suppression_events` audit row in one call. Every bounce/unsubscribe/manual-suppress
  caller now routes through it instead of a bespoke `db.insert`.
- Added `resolveWizmatchLinkage(tenantId, contactId)` / `resolveWizmatchLinkageByEmail` (§8.10.2):
  canonical `wizmatch_company_contacts`, then `wizmatch_contact_candidates.crm_contact_id`, then
  `wizmatch_job_signals.contact_id`, in that order — the sole way any shared-CRM path decides "is
  this contact WizMatch's."

**§8.10.1 checklist disposition:**
- **Rows 1-18 (WizMatch send/enrol core) — migrated onto the gate.** `sendColdEmail` (via
  `sendSignalDraftEmail`), the follow-up re-enrolment raw insert, `generateSignalDraftEmails`,
  `/signals/:id/send|draft|enrich|discover-poc`, `/classify-reply`'s NOT_NOW retry and
  NOT_INTERESTED/UNSUBSCRIBE auto-suppress, the four contact-intelligence routes, the three
  `wizmatchStaffingDomain.ts` writers (`createCompanyContact`, `addRequirementContact`,
  `setNextAction`), and `sequenceWorker.ts`'s dispatch loop (cancels a WizMatch-linked enrolment on
  DENY instead of dispatching). **Row 9 (`/signals/ingest`) is classified out of per-call gate
  scope, recorded not hidden**: it's a bulk raw-signal insert with no single company target per
  call — new companies it creates already get a root policy via PR 2's #16 bootstrap fix, and the
  actual outreach send is gated downstream at rows 1-2. Preparation-only routes (enrich,
  discover-poc, contact-intelligence discover/manual/link/review, the two staffing writers, the
  next-action writer) block only when `!decision.preparationAllowed` (§8.8) — an ordinary review or
  cold-email lock does not stop preparation, only a permanent/non-overridable block does.
- **Rows 19-24 (shared CRM paths) — gate or reject.** `POST /contacts/bulk-email` resolves the
  WizMatch link per recipient and reports rejections in the response (`rejected` count +
  `rejectedDetail`) rather than silently dropping them from `sent`, per §22.3 #3. `POST
  /contacts/export` excludes denied WizMatch-linked rows and stamps the response with
  `X-Wizmatch-Policy-Excluded-Count`. `emailTemplates.ts` send-test, `email.ts` manual/send, and
  `emailService.ts`'s `sendSequenceEmail`/`sendManualEmail` call sites all gate on the resolved
  linkage; `/api/email/send`'s caller-supplied `tenantId` is explicitly checked against
  `WIZMATCH_TENANT_ID` before trusting it. `sequenceService.ts`'s `enrolContact` gates alongside its
  existing `do_not_contact` throw — the single choke point for `/api/sequences/enrol` too.
- **Rows 25-29 (suppression writes) — routed through `suppress()`.** Bounce parser, the
  `/classify-reply` auto-suppress, the unsubscribe route, and `POST /suppression` all call it now;
  `GET /suppression`'s email filter is lowercased (row 28).
- **Row 30 (warm-up) — mailbox-health-only, no company policy.** `sendWarmupEmails` now queries
  `wizmatch_domain_health` and skips any inbox whose domain isn't `healthy`, before ever calling
  company policy (it never did, and still doesn't — company policy is for actual outreach, not
  mailbox warmup).
- **Out-of-tenant list — unchanged, re-verified.** No edit touched `routes/outbound.ts`,
  `outreachEnrichmentService.ts`, `saleshandyStatsService.ts`, or the Growth-tenant half of
  `imapService.ts`'s reply matching.

**A-1/A-4/mailer/HMAC fixes:**
- **A-1 (suppression union)** — the inline, non-lowercased `wizmatch_suppression_list` query at
  `wizmatchOutreachService.ts:183-189` is deleted; the gate's `findSuppression` (already lowercasing
  both sides, from PR 2) is now actually reachable, closing the gap for real.
- **A-4 (hard bounces discarded)** — `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED` no longer gates anything;
  `bounceSuppressionEnabled()` is kept as a compatibility no-op returning `true`. Hard bounces are
  now always persisted via `suppress()`.
- **Mailer fail-closed (§18.3)** — `sendColdEmail`'s "no healthy domain → use all inboxes" fallback
  is reversed: it now throws unless `WIZMATCH_MAILER_EMERGENCY_OVERRIDE=true` (default false, read
  per-call — not cached at import time, the same mistake the shadow-mode flag deliberately avoids),
  which logs at error level and Slack-alerts `WIZMATCH_SYSTEM_CHANNEL` on every use
  (`allowDuringPause: true` — a mailer emergency must not be silently swallowed by the routine-Slack
  pause flag). Does not enable or activate sending; both kill-switches are unmodified.
- **Unsubscribe HMAC normalisation** — the mint side (`wizmatchOutreachService.ts`) now signs over
  `toEmail.trim().toLowerCase()`, matching the verify side (`routes/wizmatch.ts`'s `/unsubscribe`,
  which already lowercased its query param). Every mixed-case recipient's unsubscribe link now
  verifies.
- **Unsubscribe sending-tenant fix** — `/unsubscribe` no longer hardcodes `process.env
  .WIZMATCH_TENANT_ID`; it looks up the most recent outbound email to the address via
  `contact_channels` + `messages` and uses that tenant, falling back to `WIZMATCH_TENANT_ID` only
  when no send history exists.

**Shadow-vs-enforce equivalence harness (§22.3 #10):**
`src/__tests__/wizmatchOutreachShadowEquivalence.test.ts` runs a fixed fixture set (L0 missing root,
L1 non-overridable block, L2 overridable block, L7 suppression deny, allow) through
`evaluateWizmatchOutreachGate` in both modes and asserts the decisions are identical except for the
`enforcementMode` field, plus a direct test that only `enforce` makes
`assertWizmatchOutreachAllowed` throw. This makes G3's "zero behavioural change" claim mechanically
checkable rather than argued.

**Two existing PR-2-era test assumptions were corrected, not just accommodated:**
`wizmatchOutreachGate.test.ts`'s `assertWizmatchOutreachAllowed` tests assumed it always throws on
deny — true only for `enforce`; the tests now cover both modes explicitly. This is a deliberate
semantic change from PR 2 (where nothing called the gate, so the distinction didn't matter yet), not
a regression.

**Verified:** `npm run build` exit 0. `npm test` — **103 files / 896 tests, all green** (18 new tests
across four new/rewritten files: `wizmatchOutreachShadowEquivalence.test.ts`,
`wizmatchLinkage.test.ts`, `wizmatchOutreachSuppress.test.ts`, plus warm-up-health cases added to
`multiDomainMailer.test.ts`). `git diff --check` clean. No admin/UI files touched, so no admin build
or Playwright run for this PR.

**Known scope limits, stated not hidden (mirrors PR 2's convention):**
- The follow-up re-enrolment at `wizmatchOutreachService.ts` still writes to the generic CRM
  `sequence_enrolments` table, not `wizmatch_outreach_enrolments` — it is now gated, but a full
  migration onto the dedicated enrolment table (with its state machine and cold-email-lock
  uniqueness constraints) is out of scope for this PR.
- The §16 rule-2 "gate_denied observation" is a structured console log today, not a persisted,
  queryable row — the readiness report that consumes it is PR 4 scope.
- A handful of preparation-gate checks in `wizmatchStaffingDomain.ts`/`routes/wizmatch.ts` run
  after the row that establishes the relationship/status change has already been written (e.g. the
  contact-review approval), rather than before, in existing code that returns the row via
  `RETURNING`. Not a data-integrity issue — the outreach action itself is still gated downstream —
  but not fully transactional either; worth tightening in a follow-up pass rather than this PR.
- Duplicate-review UI, effective-policy provenance UI, and the readiness report/CLI are PR 4 scope
  per the original plan, unchanged.

**Not done, deliberately:** no push, no merge, no deploy, no Railway, no production or shared
database access, no migration applied, no backfill, no promotion of `enforce`, no sending or paid
provider enabled, no Smartlead work, no Growth/SEO/n8n/legacy outreach code touched.

### 2026-07-26 — PR 3 independent code-readiness review: **CODE READY at `21b3bc3`**

Full report: [`docs/reviews/wizmatch-outbound-pr3-opus-review.md`](../reviews/wizmatch-outbound-pr3-opus-review.md).
Three read-only Explore subagents (caller checklist/bypass; suppression/unsubscribe/bounce/tenant;
shadow semantics/mailbox health/test quality) plus main-session verification; every Critical/High
finding re-read by hand before any fix, and every fix carries a control run that reintroduces the
defect and confirms the new test goes red. Marker: `.ai/OUTBOUND_PR3_CODE_READY`.

**Verdict: fix-then-ship.** All 30 §8.10.1 rows are closed, 16 call sites gate on one shared helper,
and shadow provably blocks nothing at every one of them. **Six defects were found and fixed in
`21b3bc3`** — two of which made the gate *report* a block while permitting the state it existed to
prevent:

- **Row 4** (`generateSignalDraftEmails`) hand-rolled its predicate as `decision === 'deny'` instead of
  `shouldBlock`'s `!== 'allow'`, so under `enforce` a `review` decision queued three AI-written drafts
  that every other send/queue site blocks — and emitted no §16 rule-2 shadow observation at all.
- **Row 12** (`/contact-intelligence/contacts/:id/review`) committed `status='approved'` on the shared
  pool (autocommit, no transaction) and *then* returned 403. The candidate was genuinely approved on a
  company the gate had just refused. The marker called this "not a data-integrity issue"; it was one.
- **`POST /suppression`** flipped `contacts.do_not_contact` for **every** reason including `hard_bounce`
  and `complaint` — the §8.4 grain collapse, three lines below the new `suppress()` call.
- **`suppress()`** wrote the effective row and the append-only audit row as two autocommitted
  statements, so §8.10 rule 4's "guaranteed rather than remembered" was only "usual". Now one transaction.
- **`/send-test`** (row 21) resolved a `contactId` and discarded it, so the gate saw an address only and
  the A-1 suppression union silently degraded to the email grain — a `do_not_contact` contact was emailed.
- **All three contact-grain writes** matched `channel_value` exactly against a lowercased address (the
  H-3 class, one layer out), and `/classify-reply` omitted the contact grain entirely.

**The equivalence harness was strengthened**, because as submitted it compared the gate to itself: the
evaluator never branches on the mode, so parity was structurally guaranteed and **D-1, a live divergence
in the same diff, left it green**. It now pins each fixture's decision and level, spans seven ladder
rungs, guards against fixture-set shrinkage, and pins eight §16 rule-3 near-miss values (`'ENFORCE'`,
`'enforce '`, `''`, …) that nothing previously pinned.

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **103 files / 916 tests green**
(896 as submitted, +20).

**HARD DEPLOY-ORDER PREREQUISITE (B-1) — new, introduced by this PR, and not previously recorded
anywhere.** `suppress()` writes `wizmatch_suppression_events`, a table created **only by migration
0037**, which is deliberately unapplied (G1, pending U-7). Every row 25-29 path now routes through it.
Before 0037 is applied, the **public `GET /api/wizmatch/unsubscribe` route throws** (the recipient sees an
error page — it worked before this PR), `POST /suppression` and `/classify-reply` 500, and hard bounces
are caught and dropped, re-creating the A-4 defect §22.3 #6 closes. The specified rollout order (G1 → G2/G3)
prevents this, but **this repo auto-deploys on push to `main`**, so the ordering must be explicit:
**apply 0037 before PR 3 reaches `main`.**

**Four owner decisions before G4:**
- **U-8** — the unsubscribe tenant lookup is "most recent sender wins" across all tenants. Better than
  the hardcoded env tenant it replaced (§22.3 #8 is met), but if Growth mailed the same address more
  recently, a WizMatch unsubscribe click writes under Growth and WizMatch never learns of it. The HMAC
  carries no tenant, so the token cannot disambiguate. Sign the tenant in, or narrow the lookup.
- **U-9** — rows 15-17 gate at preparation level, but §8.10.1 labels them `enrol`/`follow-up` and §8.8
  says queueing is denied while a duplicate is pending. Interpretive; PR 4's merge UI assumes no further
  relationship-building happens on pending-duplicate companies meanwhile.
- **O-1** — §16 rule 5's Slack-alert-on-mode-flip has **no implementation anywhere**, and unlike the
  other deferrals it was **not disclosed**. Today a flip to `enforce` fires no automated signal.
- **U-11** — confirm PR 4 is the agreed home for §8.10 rule 6's persisted `gate_denied` row (a
  structured console log today).

**B-2 — M-5/L-6 remain open**, contrary to the PR 2 review's own stated PR-3 prerequisites, and
undisclosed. `wizmatchOutreachGateContract.test.ts` was not touched, and both new test files repeat the
discard-the-`.where()` mock. Deleting `isNull(supersededAt)`, the cold-email-lock `outreachMode` filter,
or `resolveWizmatchLinkage`'s tenant predicates leaves the whole suite green. Close before G4.

**Recommended for PR 4:** U-13 (`resolveWizmatchLinkage` returns an *arbitrary* company when a contact is
linked to several — `.limit(1)` with no `ORDER BY` — so an eligible company can mask a blocked one;
not fixed here because most-restrictive-wins means changing the contract and eight call sites),
U-14 (per-row linkage+ladder runs for every tenant sequentially on `bulk-email`/`export`; a 5,000-row
Growth export becomes tens of thousands of round-trips), U-10, U-12 and L-7…L-13.

**Not done, deliberately:** no push, no merge, no deploy, no Railway, no production or shared-database
access, migration 0037 **not applied**, no backfill, no promotion of `enforce`, no sending or paid
discovery enabled, no Smartlead, no PR 4 work, no guardrail file touched (`schema.ts`, `migrations/`,
`auth.ts`, `rbac.ts`, `cashfree.ts`, `sodEodService.ts` all verified untouched), no `admin/`, `client/`,
`scripts/` or `package-lock.json` change, no Growth/SEO/n8n/legacy outreach code touched.

---

## PR 5 — `ge/outbound-05-lifecycle-consolidation` — **implemented 2026-07-26, local only, NOT pushed, NOT merged, self-reported (no independent review yet)**

Note: this doc was not updated when PR 4 (`ge/outbound-04-policy-ui-backfill`) was implemented and
closed out — see `.ai/HANDOFF_LOG.md` and `.ai/OUTBOUND_PR4_IMPLEMENTED` for that PR's full detail.
This entry covers PR 5 only, built on top of PR 4.

Built against PRD-005 §5.2 C-2 / §11.3 / §23's "Lifecycle" impact row and ADR-006 D-13: migrate the
five legacy eligibility computations onto the canonical resolver
(`resolveCompanyStatus`/`evaluateWizmatchOutreachGate`, `src/modules/outreach/outreachGate.ts`,
already built in PR 2) and stop treating `wizmatch_company_intelligence.status` as authoritative.

**New module** — `src/modules/outreach/legacyEligibilityAdapter.ts`. The single place that translates a
canonical decision into each legacy response shape: `resolveCanonicalCompanyEligibility` /
`resolveCanonicalCompanyEligibilityBatch` wrap `resolveCompanyStatus`;
`applyCanonicalEligibilityToPriorityResult(s)` folds a decision onto the 4-value
`hot|warm|watch|blocked` shape (client discovery, command center, requirement priority);
`applyCanonicalEligibilityToContactIntelligence` folds it onto the 9-value `companyStatus` +
`hardBlocks[]` shape (contact intelligence). A canonical DENY always forces the most restrictive
legacy bucket regardless of local score; a canonical REVIEW caps `hot`/`warm` down to `watch` /
`needs_review`. Fail-closed is inherited from `resolveCompanyStatus` — the adapter adds no fallback.

**Five findings, four migrated onto the adapter, one explicitly scoped out (disclosed, not silent):**

1. `wizmatchClientDiscovery.ts` — new `rankClientDiscoveryQueueWithPolicy` /
   `scoreClientDiscoveryOpportunityWithPolicy` / `selectCompaniesForContactIntelligenceWithPolicy`
   async wrappers around the existing pure sync scorer. Wired into all four
   `/client-discovery/*` routes plus the review-workbench aggregator in `src/routes/wizmatch.ts`.
2. `wizmatchCommandCenter.ts` — its own independent re-implementation of client-discovery scoring now
   folds the same canonical decision via the adapter; `buildWizmatchCommandCenter` is now async and
   takes `tenantId`. Its embedded `candidateIntelligence`/`requirements` sub-scores are unchanged (see
   #3 below for why).
3. `wizmatchRequirementPriority.ts` — new `scoreRequirementPriorityWithPolicy` /
   `rankRequirementPriorityQueueWithPolicy`. Required threading a real `companyId` through
   `CandidateRequirementInput`/`RequirementPriorityInput` and the `fetchCandidateIntelligenceRequirements`
   SQL (`r.company_id` was not previously selected) — this **replaces** the indirect, legacy
   `companyTier` dependency the file's `accountQuality` component read before. Also closes a real gap:
   `POST /requirement-priority/:requirementId/review-plan` previously gated the write **client-side
   only** (admin button `disabled=`); it now 409s server-side on a canonical/local `blocked` priority,
   matching the pattern `candidate-intelligence/.../review` already used.
4. `wizmatchContactIntelligence.ts` / `wizmatchContactIntelligenceRepo.ts` — `buildContactIntelligenceResult`
   now folds the canonical decision via the adapter before returning. **Fixed the concrete D-13
   violation**: `withPersistedContactIntelligence` used to let the persisted legacy `status` column
   override a freshly computed status (`persisted.company.status || item.companyStatus`); it now always
   uses the freshly computed, canonical-folded value. `persistContactIntelligenceSnapshot`'s SQL had a
   `CASE WHEN review_status IN ('approved','rejected') THEN status ELSE EXCLUDED.status END` freeze
   clause that could keep a stale legacy status alive forever after one human review; it now always
   writes `EXCLUDED.status`.
5. `wizmatchCandidateIntelligence.ts` — **explicitly not migrated**, and why is disclosed in the file's
   own header comment: it scores a *candidate* (a person), not a company. `CandidateIntelligenceInput`
   carries no `companyId` (a candidate is not 1:1 with one company), and
   `evaluateWizmatchOutreachGate` denies without one — there is structurally no company to resolve a
   policy against here. Its `do_not_contact_or_suppressed` blocker is a contact-grain check (ADR-006
   D-7), a different concern from the company-grain question the canonical resolver answers.

**Guard test** (`src/__tests__/wizmatchLegacyEligibilityGuard.test.ts`) — a source-level scan (same
pattern as the PR 2 §22.2 #16 `wizmatchCompanyBootstrapCoverage.test.ts`) for the literal
`'hot' | 'warm' | 'watch' | 'blocked'` union PRD-005 §5.2 C-2 names as the shape of the disagreement.
Fails if a new file declares it without being added to an explicit, reasoned allowlist; asserts the
three company-scoped migrated files import the adapter; asserts the D-13 fix's specific override
string cannot reappear in `wizmatchContactIntelligenceRepo.ts`. Also allowlists (disclosed, not
silently exempted) a sixth pre-existing site the audit surfaced but this PR did not touch —
`wizmatchReviewWorkbench.ts:114` re-derives a `hot|warm|watch` value from `qualificationTier` for
display bucketing — recorded as a candidate for a future PR, not fixed here (no unrelated work).

**Contract tests** (`src/__tests__/wizmatchLegacyEligibilityAdapter.test.ts`) — reuses the
`wizmatchOutreachGateContract.test.ts` drizzle mock idiom. For the same canonical decision (missing
root / non-overridable company-removal block / needs_review / allow), asserts client discovery,
requirement priority and contact intelligence all encode the identical fact, and that a canonical
allow never clears a local hard block (client discovery's `non_tech_signal` case).

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **109 files / 966 tests
green** (was 107/948; +2 test files, +18 tests). No admin/UI files touched, so `admin:build` and
Playwright were not run (per task instructions, only required when admin UI changes).

**Not done, deliberately:** no migration 0037 application, no backfill `--apply`, no re-bucketing of
the Today page, no free-prep pipeline build, no provider integration, no Smartlead/API/keys, no
sending or paid-discovery flag change, no guardrail file touched (`schema.ts`, `migrations/`,
`auth.ts`, `rbac.ts`, `cashfree.ts`, `sodEodService.ts` verified untouched), no
Growth/SEO/n8n/`package-lock.json` change, nothing pushed/merged/deployed, no Railway or production
access, no database mutation, no Smartlead network calls.

**Open, carried forward, not silently dropped:** `wizmatchCandidateIntelligence.ts`'s candidate-level
suppression check is not unified with the canonical gate's suppression union (structurally out of
reach without a wider redesign of the candidate/requirement input contracts — see finding 5 above);
`wizmatchReviewWorkbench.ts:114`'s display-bucket re-derivation is allowlisted but not fixed; U-13/
U-14/U-10/U-12/L-7…L-13 from the PR 3 review remain open from PR 4, untouched by this PR.

**Exact next action:** get an independent readiness review of PR 5 (three-subagent method, per the
PR 2/PR 3 precedent), then PR 6 (decision workbench — queues API + Today re-bucket + bulk bar) per the
standing 10-PR programme. Stop after PR 6.

---

## PR 4 + PR 5 — independent Opus checkpoint review, 2026-07-26: **NOT READY**

Full report: [`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`](../reviews/wizmatch-outbound-pr5-opus-checkpoint.md).
Range `ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation`, implementation
HEAD `7777c455`. Three parallel read-only Explore subagents; every load-bearing finding re-verified
by hand before inclusion. **`.ai/OUTBOUND_PR5_CODE_READY` was deliberately NOT created.**

**Two Criticals.**

- **C-1 — PR 5 blocks in `shadow` mode. NOT FIXED; owner decision required.** The PR 5 compatibility
  adapter resolves the canonical decision and acts on it without ever consulting `shouldBlock` /
  `WIZMATCH_POLICY_ENFORCEMENT_MODE`. Two call sites are real write blocks (HTTP 409), not display:
  `send-to-contact-intelligence` and the new `requirement-priority/:id/review-plan`. PRD-005 §16 rule
  2 says shadow "blocks nothing" and gate G3 requires "zero behavioural change confirmed
  post-deploy". With 0037 unapplied every company resolves `deny/policy_resolver_error`; once applied
  but un-backfilled, `deny/policy_missing_root`. The client-discovery and requirement-priority
  surfaces go dark on merge, and `WIZMATCH_COMPANY_POLICY_ENABLED` being off means the unblock API is
  404'd. Two defensible readings (adapter respects `shouldBlock` → shadow is a true no-op, vs.
  display-layer folding is intentionally immediate); both agree the two 409s are wrong.
  **Recommendation: make the adapter mode-aware.**
- **C-2 — no policy could ever be changed. FIXED in this pass.** `writeCompanyPolicy` inserted the new
  active row *before* superseding its predecessor, violating the non-deferrable partial unique index
  `wizmatch_company_policies_active_scope_uniq`. Every supersession — including every admin override,
  the only escape from a non-overridable block — would have raised `23505` and 500'd against a real
  database. CI was green only because the test mock enforced no constraints (same class as the PR 2
  FK-ordering Critical).

**Fixed in this review pass** (all inside PR 4's boundary, spec-mandated, no owner decision, each
with a reproduced control run): C-2 supersede-before-insert; H-1 `POST /companies/bulk/policy` was
shadowed by `POST /companies/:id/policy` so the admin-only bulk endpoint never ran and the
`team_lead` gate fired instead (confirmed empirically against the repo's Express 5.2.1); H-12 the
supersession test never asserted supersession happened. New `src/__tests__/wizmatchPolicyRoutes.test.ts`
mounts the real router on a real Express app and pins path precedence, the role gate that actually
fires, and flag-off 404s.

**Fourteen Highs, twelve open.** H-2 requirement-priority fails **open** on a null `companyId` where
the resolver denies · H-3 the canonical REVIEW branch for contact intelligence is dead code
(`ready_for_discovery` is never produced) · H-4 `priority` is folded but `nextAction`/`score` are not,
so the workbench shows a denied company with `allowed: true` and a live POST button · H-5 deleting the
status-freeze reverts a human `reject_company` with no canonical replacement · H-6 the fifth caller's
scope-out reason is falsified by this same PR, which adds the `companyId` it claims is absent ·
H-7 the adapter test's mock discards `.where()`, regressing PR 3's M-5/L-6 against its own cited
source · H-8 unknown `outreachEligibility` fails **open** through the whole ladder · H-9
`evidence_url` is not SSRF-scrubbed though §10.1/§18.2 name the control as shipping here · H-10 the
signal/requirement↔company agreement invariant §10.1 designates service-enforced is absent ·
**H-11 the PR 4 marker's flag-gating claim is false** — the Duplicate Companies page has no flag
import and its nav entry and route are unconditional · H-13 the requirement-priority REVIEW test is
vacuous (fixture already scores `watch`) · H-14 duplicate resolution discards `reasonCode`/`evidence`
and writes no audit row.

**Gates, re-run by the reviewer on the post-fix tree:** `git diff --check` clean · `npm run build`
exit 0 · `npm test` **110 files / 970 tests** (was 109/966) · `npm run admin:build` clean ·
Playwright `wizmatch-local` 97 passed / 15 skipped / 0 failed. The self-reported PR 4/PR 5 gate
figures were independently reproduced and are accurate.

**Boundary checks — all PASS.** No guardrail file touched; no `package-lock.json`; no Growth/SEO/n8n
or legacy-outreach contamination; `package.json` is script-only with no dependency added; no send or
paid-provider capability enabled and no flag default flipped; no production action — 0037 unapplied,
backfill `--apply` not run, nothing pushed/merged/deployed, no Railway access, Smartlead not
connected.

**Exact next action:** owner decision on C-1, then fix C-1 and the twelve open Highs, then re-review.
Do not merge, deploy, apply 0037, run backfill `--apply`, or promote `enforce` on the strength of
this review. Still carried forward: U-13, U-14, U-10, U-12, L-7…L-13 from the PR 3 review, and B-1
(0037 must be applied before this stack reaches `main` — the repo auto-deploys on push).

---

## PR 4 + PR 5 — checkpoint fix pass, 2026-07-26: all Critical/High findings closed

Owner ratified D-31 through D-39 (C-1: option A, adapter respects `shouldBlock`). This session
implemented all of them plus H-2 through H-14. Full per-finding detail: the checkpoint report's new
"Fix pass" addendum (`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`) and
`.ai/OUTBOUND_PR5_IMPLEMENTED`'s fix-pass section.

**Shape of the fix:**
- **C-1**: `legacyEligibilityAdapter.ts`/`outreachGate.ts` — mode-aware adapter. Canonical decision
  metadata always computed/displayable; legacy behavioural output only overridden under the exact
  string `enforce`. The two shadow-mode 409s (send-to-contact-intelligence, review-plan) are gone.
- **H-2…H-14**: null-companyId fail-open, dead REVIEW branch, unfolded `nextAction`, an unprotected
  human rejection, a falsified scope-out disclosure, a discard-the-`.where()` mock, two fail-open
  enums, a missing SSRF scrub, a missing company-agreement invariant, an unconditional Duplicate
  Companies surface, a vacuous test fixture, and a duplicate-resolution audit gap — each fixed with a
  dedicated regression test.
- **D-32 (U-13)**: `wizmatchLinkage.ts` now resolves every tenant-safe linked company and picks the
  most restrictive by canonical decision (deny > review > allow), with provenance. No call site needed
  editing — all seven only read `linkage.companyId`.
- **D-33**: verified already satisfied. **D-34**: persisted, idempotent shadow observations in
  `audit_events` (migration 0010, no 0037 dependency); readiness report's `shadowObservedCompanyCount`
  consumes it. **D-35**: mode-flip Slack alert + audit exactly once per transition. **D-36**:
  tenant-bound versioned unsubscribe tokens (`src/modules/outreach/unsubscribeToken.ts`), retiring
  U-8's "most recent sender wins" — legacy tokens still accepted only when exactly one tenant resolves
  deterministically, ambiguous ones rejected and audited. **D-37**: folded into H-8's enum-validation
  fix. **D-38**: Duplicate Companies nav/route/page all gated on `companyPolicyUiEnabled`/
  `wizmatchCompanyPolicyEnabled`. **D-39**: PRD-005 gained §22.4/§22.5.
- Corrected (not deleted) the PR 4 marker's false flag-gating claim in `.ai/OUTBOUND_PR4_IMPLEMENTED`.

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **113 files / 1003 tests**
(was 110/970) · `npm run admin:build` clean · Playwright `wizmatch-local` 97 passed / 15 skipped /
0 failed.

**Not done, deliberately:** `.ai/OUTBOUND_PR5_CODE_READY` was **not** created — reserved for an
independent reviewer. No push/merge/deploy; migration 0037 unapplied; backfill `--apply` not run;
`enforce` not promoted; sending/paid-discovery/Smartlead untouched; no guardrail file touched; no
Growth/SEO/n8n/legacy-outreach/`package-lock.json` change. U-7, U-9, O-1, B-1 remain open, carried
forward unchanged.

**Exact next action:** independent re-review of PR 4 + PR 5 against this fix pass (three-subagent
method). If it passes, the reviewer creates `.ai/OUTBOUND_PR5_CODE_READY`. Do not start PR 6 until
that happens.

---

## PR 4 + PR 5 — final independent code-readiness re-review, 2026-07-26: **READY**

Reviewed `ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation` at
implementation/fix HEAD `a5e48602`. Three parallel read-only Explore subagents (gate mode/linkage/
unsubscribe; PR 4 RBAC/UI/backfill/readiness/evidence; lifecycle adapter/routes/test-quality); every
load-bearing finding re-verified by hand, every fix made here carries a control run. Full report:
`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`, appended section "Final independent
code-readiness re-review". Marker: **`.ai/OUTBOUND_PR5_CODE_READY` created.**

`a5e48602` genuinely closed C-1, C-2 and H-1…H-14 — with two exceptions this review found and fixed.

**RC-1 (Critical, fixed here) — the C-1 fix did not fully land.** H-2's null-`companyId` block in
`wizmatchRequirementPriority.ts` was applied on the one path that never reaches
`resolveCompanyStatus`, so it never consulted the mode. `wizmatch_requirements.company_id` is
nullable (masked clients) and the fetcher `LEFT JOIN`s with no filter, so in the shipped default
`shadow` those requirements rendered `blocked` **and** `POST /requirement-priority/:id/review-plan`
returned **409** — C-1's exact defect class, falsifying the fix pass's claim that neither 409 fires
in shadow. Confirmed new in this range (absent at `58e77706`); the `wizmatchClientDiscovery.ts`
block it says it mirrors *does* predate the stack, so the two are not equivalent. Fixed by exporting
`isEnforcementActive()` from `outreachGate.ts` and gating the block on it, while always attaching
`canonicalDecision`/`canonicalReasonCode` for display — D-31 as ratified, no new decision.

**RH-1 (High, fixed here) — H-8, H-9 and H-10 shipped with no regression test at all**, contradicting
the fix pass's "each fixed with a dedicated regression test". Deleting the enum validation, the SSRF
scrub or the company-agreement invariant left the suite green. 23 tests added; control runs fail 2, 6
and 4 respectively.

**RH-2 (High, fixed here) — `wizmatchLinkage.test.ts` could not detect either regression D-32 exists
to prevent.** The mock ignored `where()` and `.limit()` was a no-op, so deleting the tenant predicate
or reverting to `.limit(1)` both stayed green — the third recurrence of M-5/L-6/H-7, on the file the
fix pass had just rewritten. Mock now honours both; control runs fail 5 and 2.

**RH-3 (High, fixed here) — D-35's mode-flip alert could not fire for the mechanism that changes the
mode.** The baseline was in-process only and seeded silently whenever undefined; the env var is
applied by redeploying, so the real flip always arrives as a fresh process and was swallowed. The
baseline is now also persisted in `audit_logs` (not `audit_events` — its `tenant_id` is `NOT NULL`
with an FK, and a mode flip is system-wide) and compared once per process, best-effort. Four tests
added, each re-importing the module to simulate a boot; control run fails 3. Disclosed limitation:
at most once per *process*, not per fleet — cross-process dedup needs a schema change and a decision.

**Gates on the post-review tree:** `git diff --check` clean · `npm run build` exit 0 · `npm test`
**113 files / 1030 tests** (was 113/1003) · `npm run admin:build` clean · Playwright `wizmatch-local`
97 passed / 15 skipped / 0 failed.

> **Playwright command note.** `npx playwright test --project=wizmatch-local` does not work — no such
> project exists; `wizmatch-local` is a separate *config*. Use
> `npx playwright test --config=playwright.wizmatch-local.config.ts`.

**Open, carried forward with severity** (full table in the review): M-1 `/api/wizmatch`'s
`wizmatchRequireAdmin` prefix middleware blocks staff+ policy reads (fails **closed**); **M-2 Command
Center requirements/candidateIntelligence are unfolded and the fetcher does not select `company_id` —
inert in shadow but must close before G4/`enforce`**; M-3 workbench `allowed: true` is unconditional
(backend re-checks, so UI-truthfulness only); M-4 shadow-observation check-then-insert race; M-5
unsubscribe payload delimiter; M-6 override evidence not trimmed / `evidenceKind` compile-time only;
M-7 `listDuplicates` unbounded; M-8 the admin flag is a build-time `VITE_`-prefixed variable so a
backend flag flip alone will not reveal the UI; M-9 `duplicateService.ts`'s docstring misdescribes its
own audit write; L-1…L-6. Plus U-7, U-9, O-1 and **B-1 (apply 0037 before this stack reaches `main` —
the repo auto-deploys on push)**.

**Not done:** nothing pushed/merged/deployed; no Railway or production access; migration 0037 not
applied; backfill `--apply` not run; `WIZMATCH_POLICY_ENFORCEMENT_MODE` untouched (`shadow`);
sending/paid-discovery/Smartlead untouched; no guardrail file touched; **no PR 6 work started**.

**Exact next action:** owner decides whether M-2 lands as a PR 5 follow-up or is scheduled as a hard
G4 precondition, then PR 6 (decision workbench — queues API + Today re-bucket + bulk bar). Before
this stack reaches `main`: apply migration 0037 (B-1) and run the §10.11.4 fresh-database checks (G1).

---

## PR 6 — `ge/outbound-06-decision-workbench` — **implemented 2026-07-26, local only, NOT pushed, NOT merged, self-reported (no independent review yet)**

Built against PRD-005 §12 "Decision workbench" / §13 "UI design and states" / §4 (RBAC). Cut from
`ge/outbound-05-lifecycle-consolidation`. Also closes M-1 and M-2 from the PR 5 final re-review.

**M-1 fixed.** `src/index.ts` mounted `wizmatchRequireAdmin` (admin/team_lead/viewer) as prefix
middleware for the whole `/api/wizmatch` surface, ahead of `wizmatchPolicyRouter` — a staff-tier
request 403'd before it could ever reach a router whose own gate would have allowed it (§4 says
policy reads are staff+). `wizmatchPolicyRouter` and the new `wizmatchTodayRouter` now mount BEFORE
that admin gate; no role check anywhere was widened, each router still enforces its own RBAC. Guarded
by a source-level ordering test (`wizmatchIndexMountOrder.test.ts`) since importing `src/index.ts`
directly in a unit test would open a real HTTP listener and Postgres pool.

**M-2 fixed.** `wizmatchCommandCenter.ts`'s `requirements` array was one of two arrays left unfolded
by PR 5, and its fetcher (`fetchCommandCenterRequirements`) didn't even select `company_id` — there
was nothing to fold against. `r.company_id` is now selected; `CommandCenterRequirementInput` /
`ScoredRequirement` gained `companyId` and `blockers`; `buildWizmatchCommandCenter` now folds
`requirements` through `applyCanonicalEligibilityToPriorityResults`, the same call `clientDiscovery`
already used. `candidateIntelligence` is **not** folded — disclosed in the module's own header comment,
identical reasoning to why `wizmatchCandidateIntelligence.ts` itself was excluded in PR 5: a
talent-pool candidate is not 1:1 with one company, so there is no single company to resolve a policy
decision against. Proven end-to-end (real adapter, DB-mocked resolver) by two new tests in
`wizmatchLegacyEligibilityAdapter.test.ts`.

**New backend.** `src/modules/outreach/decisionWorkbench.ts` (`buildTodayQueues`) re-buckets companies
into the four PRD-005 §13 queues purely by calling `resolveCanonicalCompanyEligibilityBatch` (PR 5's
adapter — no second eligibility engine): `deny` → Paused or Blocked; `review` or a pending duplicate →
Needs Review; `allow` + a high-confidence contact → Ready to Contact; `allow` with no
high-confidence contact → Needs Review (never silently dropped). Replies Needing Action queries
`wizmatch_outreach_enrolments` for the five live-conversation states PRD-005 §13 names (`replied`,
`awaiting_action`, `positive_reply`, `referral_received`, `conversation_open` — the three pre-reply live
states `queued`/`exported`/`sent` are deliberately excluded). Every per-row fold is try/catch-guarded;
a malformed row is skipped and reported in `partial.skippedCompanyIds`/`skippedEnrolmentIds` rather
than crashing the response. `decisionWorkbenchActions.ts` (`runTodayActions`) implements every
contextual action (`approve_queue`/`skip`/`pause`/`resume`/`block`/`reject`/`assign_owner`/
`set_review_date`/`merge`/`confirm_separate`) as a call into the **existing** PR 4 `policyService`/
`duplicateService` write functions — no new write path. Whole-request validation rejects a
mixed/empty/malformed selection up front (400); each target then runs independently in its own
try/catch, returning a per-target `results[]` so one target's failure (no root policy row, a
`PolicyOverrideRefusedError` on a non-overridable predecessor, an already-resolved duplicate) never
hides or aborts another's outcome.

**New routes.** `src/routes/wizmatchToday.ts` — `GET /api/wizmatch/today/queues` (staff+),
`POST /api/wizmatch/today/actions` (team_lead+ for a single target; **admin-only when the request
names more than one target**, per PRD-005 §4's "bulk policy write, bulk queue action → admin" — the
bulk/non-bulk distinction is a body property, so it's checked inside the handler, not via a
route-level role gate). The whole router 404s behind `WIZMATCH_DECISION_WORKBENCH_ENABLED` (default
false), same convention as `wizmatchPolicy.ts`.

**Frontend.** `WizmatchTodayPage.jsx` extended in place — no new route, no new nav entry.
`decisionWorkbenchUiEnabled` (new `admin/src/lib/decisionWorkbenchFlag.js`, same
`import.meta.env.DEV || VITE_...` idiom as the existing company-policy flag) switches the page body
between the legacy My Work buckets and the new `TodayDecisionWorkbench.jsx`; `/wizmatch/today`'s route
entry stays `permission: 'always'` either way, so a flag flip can never make Today unreachable.
`TodayDecisionWorkbench.jsx` reuses `DataTable`'s previously-unused `selectedIds`/`onToggleRow`/
`onToggleAll` props (PRD-005 §5.3 A-9) for per-queue bulk selection; evidence cards show the policy
badge, reason code, scope provenance, contact-confidence tier, and an inline disabled-reason
(`title` + `aria-label`) on every unavailable action, per §13's "never silently hidden" rule.
`TodayActionDialog.jsx` captures reason code/evidence/review date/owner before any mutation, reusing
the existing `useDialogA11y` focus-trap hook. `TodayBulkActionBar.jsx` is the first WizMatch-side bulk
bar — PRD-005 §5.3 A-9 explicitly calls out that the Growth `BulkActionBar.jsx` is hardcoded to Growth
endpoints and cannot be reused directly; only its floating-bar visual pattern was copied. Bulk actions
are queue-scoped and exclude any combination that isn't uniformly safe (no bulk merge/confirm-separate,
since that needs every selected row to share one pending-duplicate id). `DataTable`'s selection
checkboxes gained `aria-label`s (additive).

**A-8 closed.** Deleted `WizmatchCommandCenterPage.jsx` and `WizmatchReviewQueuePage.jsx` — PRD-005
§5.3 names both as dead, unrouted pages with disposition "Deleted — PR 6". Confirmed zero importers
first.

**Tests.** `decisionWorkbench.test.ts` (bucket assignment, malformed-row safety, reply-state
filtering, a source-level tenant-predicate guard), `decisionWorkbenchActions.test.ts` (whole-request
validation, per-target partial success/failure, action→write mapping), `wizmatchTodayRoutes.test.ts`
(feature flag, RBAC incl. the single-vs-bulk admin distinction), `wizmatchIndexMountOrder.test.ts`
(M-1 regression guard), plus two new M-2 contract tests in `wizmatchLegacyEligibilityAdapter.test.ts`.
`e2e/wizmatch-a11y.spec.ts`'s `Today` case now mocks populated `/today/queues` data and adds a
keyboard-focus assertion; it caught one real a11y defect — a `blocked`-tone `StatusBadge` used the
shared, repo-wide `badge-danger` class, which fails color contrast at this size — fixed by dropping the
redundant badge (the canonical-decision badge already carries the same fact) rather than editing a
class shared by dozens of unrelated pages. `e2e/wizmatch-phase0-local.spec.ts`'s pre-existing Today
empty-state test was updated to mock `/today/queues` and the new empty-state copy, since the legacy
checklist it tested no longer renders once the workbench flag is on (the dev server always has it on).

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **117 files / 1064 tests
green** (was 113/1030) · `npm run admin:build` clean · Playwright `wizmatch-local` full suite —
**97 passed / 15 skipped (real-backend specs, no server started — pre-existing) / 0 failed**.

**Not done, deliberately:** migration 0037 still unapplied; backfill `--apply` not run; enforcement
mode untouched (`shadow`); both sending kill-switches untouched; no paid provider enabled; Smartlead
not connected; no guardrail file touched (`schema.ts`, `migrations/`, `auth.ts`, `rbac.ts`,
`cashfree.ts`, `sodEodService.ts` all verified untouched); no Growth/SEO/n8n/`package-lock.json`
change; nothing pushed, merged, or deployed; no Railway or production access; no database mutation.

**Open, carried forward, not silently dropped:** the free-preparation pipeline (§14) is not built, so
"Ready to Contact" approximates §13's definition using policy decision + contact confidence only (no
`preparationAllowed`/prep-report signal exists yet); "Reclassify" reuses the `resume` action rather
than a full re-classification UI across all 8 hiring-policy values; "route a reply" is a navigation
link, not a new write action — the enrolment-transition endpoint is PR 9 (outreach adapter) scope.
M-3…M-9, L-1…L-6, U-7, U-9, O-1, B-1 from the PR 5 re-review remain open, untouched by this PR.

**Exact next action:** get an independent readiness review of PR 6 (three-subagent method, per the
PR 2/PR 3/PR 5 precedent), then PR 7 per the standing 10-PR programme. Before this stack reaches
`main`: apply migration 0037 (B-1) and run the §10.11.4 fresh-database checks (G1).

---

## PR 6 — independent readiness review (2026-07-26) — **CODE READY after eleven fixes**

Full report: [`docs/reviews/wizmatch-outbound-pr6-opus-review.md`](../reviews/wizmatch-outbound-pr6-opus-review.md).
Marker: `.ai/OUTBOUND_PR6_CODE_READY`. Reviewed `9b9c2c56`; fixes `e86704b3`, `c84681f5`, `69e68c19`,
`c03bf442`.

**As submitted, PR 6 was NOT READY:** one Critical and ten High defects, none visible to the five
gates the implementing session ran — all five of which reproduced exactly, so the marker did not
overstate itself.

**Method note, recorded because it changed the outcome.** The lead session's first pass found two
defects and concluded READY. The three subagents' reports arrived after that conclusion and surfaced
nine more, four of them High — including an RBAC over-grant and a data-integrity bug. The first
conclusion was wrong and is corrected in the report. One first-pass finding (M-C, "the PRD contradicts
itself on Reclassify") was wrong on the merits and is **retracted**: §4 is explicit that admin override
of a `standard` block is admin, so the endpoint was under-gated, not the PRD inconsistent.

**Critical:** C-1 — `router.use(featureGate)` responded 404 inline in both flagged routers. Mounted
ahead of `wizmatchRouter` by PR 6's M-1 fix, with either flag off (both default `false`), all 82
`wizmatchRouter` routes 404'd. On a repo that auto-deploys from `main`, an API outage on the next push.
Reproduced on an Express 5.2.1 harness; fixed with `next('router')`.

**High, all fixed:** H-1 a team_lead could override a `standard` block unevidenced, contradicting §4 —
and the endpoint was telling the operator it required an admin · H-2 shadow mode blocked work
(bucketing keyed on raw `canonical.decision`, not `actsOnDecision`) · H-3 every action rebuilt the root
policy row, so Set Review Date silently stripped `isPermanent`/`blockClass`/evidence from a permanent
compliance block · H-4 contact confidence read `metadata` instead of `metadata.raw`, so the cascade tier
was never found and a low-confidence contact could enter Ready to Contact, defeating §7's cold-start
gate · H-5 a null `companyId` failed OPEN in the plural fold, so a masked-client requirement answered
`deny` on one surface and unqualified `hot` on another — and the test pinning it was a regression guard
pointing the wrong way · H-6 pending duplicates never reached Needs Review (L5 deny made the branch
unreachable under `enforce`) · H-7 a switched-off feature rendered a permanent error screen with an
infinite Retry — the default local state · H-8 committed writes reported as failures with no refetch
and the dialog left open · H-9 a malformed 200 crashed the page or faked "nothing needs a decision" ·
H-10 unbounded resolver fan-out (~1,500 concurrent queries against a pool of 20) · H-11 a failed
replies query presented as "no replies waiting" on the queue that holds company locks.

**Verdicts:** backend PASS after fix · tenancy PASS · RBAC PASS after fix · shadow/enforce PASS after
fix · M-1 PASS · M-2 PASS after fix · bulk actions PASS after fix · frontend & a11y PASS after fix ·
feature flags PASS after fix · test quality PASS after fix.

**Gates (post-fix):** `git diff --check` clean · `npm run build` exit 0 · `npm test` **117 files /
1081 tests** (was 117/1064) · `npm run admin:build` clean · Playwright **99 passed / 15 skipped
(documented no-credential real-backend specs) / 0 failed**.

**Open, carried forward — the ones that matter most:** M-1 **§13 approval capture is NOT implemented**
(`approve_queue` launders `review → eligible` as a permanent policy row with no `approved_by`/
`approved_at`) · M-2 Approve & Queue renders its disabled reason but stays enabled, `allowedCampaignTypes`
never computed · M-3 "paused past `review_date` → Needs Review" not implemented, so a lapsed pause never
resurfaces · M-4 §13's `routed` row absent entirely · M-5 `StatusBadge` not extended, so a denied company
renders neutral grey · M-6 pilot roster not enforced on `/today/*` · M-7…M-16 and L-1…L-8 in the report.
Two test gaps worth closing: nothing exercises `fetchCommandCenterRequirements` (deleting `r.company_id`
reverts M-2 and ships green), and five of six policy write routes have no role test — which matters more
now that the outer admin gate no longer backs them up. M-3…M-9, L-1…L-6, U-7, U-9, O-1 and B-1 from the
PR 5 re-review remain open.

**Before PR 7:** nothing. PR 7 may proceed.
**Before G1/G4/production:** apply migration `0037` (B-1) · run the §10.11.4 fresh-database checks (G1) ·
close M-1 before the workbench is used for real decisions · close M-2…M-6 before an operator relies on
the queues · close the two test gaps · G4 remains an owner decision, now observable in advance via the
`shadow: would deny` badge.

**Safety:** nothing pushed, merged or deployed; no Railway or production access; no database mutation;
`0037` not applied; backfill `--apply` not run; enforcement still `shadow`; sending and paid-discovery
kill-switches untouched; Smartlead not connected; no shared env var changed; PR 7 not started.

---

## PR 7 — implemented (self-reported, 2026-07-27)

Full report: [`docs/reviews/wizmatch-outbound-pr7-implementation.md`](../reviews/wizmatch-outbound-pr7-implementation.md).
Marker: `.ai/OUTBOUND_PR7_IMPLEMENTED`. Branch `ge/outbound-07-free-prep`, cut from a code-ready PR 6
(`.ai/OUTBOUND_PR6_CODE_READY`, `docs/reviews/wizmatch-outbound-pr6-opus-review.md`).

**Scope:** PRD-005 §14 `prepareCompaniesJob` — zero-cost company preparation. New
`src/modules/outreach/prepareCompanies.ts` (`prepareCompaniesJob`, `prepareSingleCompany`,
`getPrepStatus`), new `src/routes/wizmatchPrepare.ts` (`POST/GET .../prepare`), a new
`WIZMATCH_AUTO_PREP_ENABLED` cron in `worker.ts` (default off), and a targeted SSRF fix in
`src/services/emailExtractorService.ts` (redirect-hop revalidation, bounded to 3 hops — the shared
`fetchPage` helper PR 7's website-discovery step depends on had none).

**Zero-spend, by construction and by test.** The module calls only `websitePatternSearch`
(`costCents: 0`) for new-contact discovery — never `discoverFreePocsForSignal` as a whole, since its
SearchAPI rung can spend a credit; never Apollo/Snov/Serper. A static test parses the module's own
`import` lines and fails if a paid identifier (`Apollo`, `Snov`, `Serper`, `SearchAPI`,
`searchPublicWeb`, `discoverFreePocsForSignal`) ever appears there.

**Tenant safety, locking, idempotency.** Every query is tenant-scoped (tests assert `tenantId` is bound
first on every statement). The whole run is serialised per tenant via the existing
`withWizmatchSourceLock` advisory lock. Storage reuses the existing `wizmatch_company_intelligence.metadata`
jsonb column (`metadata.prep`) — **no migration**. The prep report is a single overwrite, never
appended; a newly discovered contact is inserted only when no existing candidate row already carries
the same email, so a retried or concurrent run cannot duplicate contacts/evidence/reports/drafts.

**Policy gate, cold-start confidence gate, campaign recommendation, drafting** — all reuse existing PR
2/PR 5 canonical modules (`evaluateWizmatchOutreachGate`, `deriveConfidenceTier`,
`computeCampaignCompatibility`) rather than re-deriving any of their logic. `preparationAllowed` is the
hard stop. Medium/low contact confidence is recorded but never auto-surfaced as the recommended
contact. Draft personalisation is a deterministic template merge (no LLM call); `hypotheses` is always
empty in v1 — the module never fabricates a fact.

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **119 files / 1097 tests**
(was 117/1081 at the PR 6 review baseline, +16 new tests) · `npm run admin:build` clean (no admin files
touched — PR 7 is backend-only) · Playwright `wizmatch-local` **99 passed / 15 skipped / 0 failed**,
identical to the PR 6 baseline.

**Disclosed, not silently dropped:** no per-domain rate limiter beyond the per-run fetch cap and
sequential (concurrency-1) processing — no such utility exists anywhere in the repo yet, a pre-existing
gap this PR does not introduce but also does not generalise-fix. No CLI (PRD-005 §12 names only the two
HTTP routes for Preparation). The §7 cold-start confidence gate remains unwired *inside*
`evaluateWizmatchOutreachGate` itself (confirmed still true, `outreachGate.ts:13-17`); PR 7 applies an
equivalent gate at its own job level, sufficient for this PR's own output but not a fix to that shared
gap for other callers. The PR 6 §13 approval-capture gap (`approve_queue` has no `approved_by`/
`approved_at`) is **not** touched or closed by this PR.

**Not done, by instruction:** migration 0037 still not applied; no backfill `--apply`; enforcement mode
untouched (`shadow`); both sending kill-switches untouched; no paid provider enabled; Smartlead not
connected; no guardrail file touched (`schema.ts`, `migrations/`, `auth.ts`, `rbac.ts`, `cashfree.ts`,
`sodEodService.ts` all verified untouched); no Growth/SEO/n8n/`package-lock.json` change; nothing
pushed, merged, or deployed; no Railway or production access; no database mutation; no scheduler or
production invocation enabled.

**Exact next action:** get an independent readiness review of PR 7 (three-subagent method, per the
PR 2/3/5/6 precedent). Then PR 8 (`ge/outbound-08-outreach-adapter` — interface + mock + factory, no
Smartlead) per the standing 10-PR programme. **Do not** start PR 8 before that review.

---

## PR 7 — independently reviewed and CODE READY (2026-07-26)

Full report: [`docs/reviews/wizmatch-outbound-pr7-opus-review.md`](../reviews/wizmatch-outbound-pr7-opus-review.md).
Markers: `.ai/OUTBOUND_PR7_IMPLEMENTED` (self-reported) + `.ai/OUTBOUND_PR7_CODE_READY` (independent).
Branch `ge/outbound-07-free-prep`, local only, NOT pushed, NOT merged.

**Verdict: NOT READY as submitted at `ac2c2b06`; READY at `70c310b5`** after **twelve** fixes made
during the review — five High, seven Medium — plus three test-quality gaps closed. Method: three
parallel read-only Explore subagents, reconciled with an independent hand review; every fix has a
control run proving its new test fails on the defect (six controls, failing 1/1/2/2/4/1).

None of the twelve was visible to the five gates the implementing session ran, and all five gates
reproduced exactly on the submitted tree (119 files / 1097 tests), so the `IMPLEMENTED` marker did not
overstate itself. What it did overstate is corrected in §6 of the report.

**The five High findings.**
- **H-1** — `deriveConfidenceTier` was passed the whole `metadata` column instead of `metadata.raw`.
  This is **PR 6's H-4 reintroduced**: every canonically-written contact read as ungraded and fell back
  to the numeric heuristic, promoting an explicitly-graded `low` contact to `high` whenever its score
  was ≥ 8 — defeating §7's cold-start gate and putting that contact's name into the draft as a
  verified fact. The PR's own test encoded the wrong shape, so it could never have caught it.
- **H-2** — the discovered-contact INSERT wrote the provider's `raw` object *as* the metadata column
  rather than the canonical `{ reasons, providerCostCents, raw }` envelope, silently stripping
  `confidenceTier`/`roleCategory`/`team`/`mxProvider` from every other reader of that row.
- **H-3** — a gate `deny` that still permits preparation (`policy_paused_by_owner`,
  `manual_block_by_operator`, `signal_role_irrelevant` — only six §9 codes stop prep) was reported
  `status: 'prepared'` with a full draft, i.e. a policy-denied company presented as ready to contact.
- **H-4** — a `medium`-confidence contact was likewise reported `prepared`, against PRD-005's explicit
  "high → Ready; medium → Needs Review".
- **H-5** — the batch selector starved itself: `skipped` and `failed` companies never wrote a freshness
  key, so with `ORDER BY updated_at DESC LIMIT 25` the same dead companies refilled every run forever.
  A tenant with 25+ permanently-denied companies would never prepare any other company, and the report
  would look identical every day.
- **H-6** — `WIZMATCH_AUTO_PREP_ENABLED=1` started the **cron** (which scrapes websites and writes
  contact candidates) while both HTTP routes stayed 404. PR 6's M-D class, on a new flag.

**Seven Mediums fixed:** a dedup that could never fire (`ON CONFLICT DO NOTHING` with no unique index
on `wizmatch_contact_candidates`) replaced by an atomic `INSERT … WHERE NOT EXISTS`; missing
`company_intelligence_id`; a scraped contact falsely also tagged `internal_crm` provenance; a draft
greeting a published `careers@` role inbox by "first name"; a website budget that understated the
outbound HTTP surface ~11× and dropped scrapes whose company later failed; a 0-row report write
reported as success; a hardcoded `zeroSpend: true` replaced by a measurement; and a `409` returned for
a company that does not exist.

**Three test gaps closed:** the mount-order guard did not cover the new router; the SSRF
redirect-revalidation fix — the security core of the PR's §18.2 claim — shipped with **no test at
all** (reverting `redirect: 'manual'` → `'follow'` left the suite green); and the tenant-predicate
assertions were vacuous against a dropped `WHERE` clause (third recurrence of the PR 2 / PR 5
mock-vacuity finding).

**Gates on `70c310b5`:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **119 files /
1119 tests** (+22) · `npm run admin:build` clean · Playwright `wizmatch-local` **99 passed / 15 skipped
/ 0 failed**.

**Boundary checks all pass:** no guardrail file, no migration, no `package-lock.json`, no admin/client/
scripts change, no Growth/SEO/n8n contamination, no PR 8 adapter or Smartlead reference, no send or
paid-provider capability enabled, no production action. No PR 6 Medium/Low finding is falsely marked
closed anywhere; M-D itself (on `WIZMATCH_DECISION_WORKBENCH_ENABLED`) remains open.

**Before PR 8:** nothing. PR 8 may start from `70c310b5`.
**Before enabling `WIZMATCH_AUTO_PREP_ENABLED` with real data:** O-1 (a denied company with no
intelligence row still churns — decide whether being denied may create one), O-3 (ratify staff+ on a
write surface, and PR 6's M-6 pilot roster, now applying to a write for the first time), O-4 (§21 G5
calls this job "read-only"; it is not).
**Before G4/`enforce`:** O-2 (cross-job duplicate-contact race with `poc_discovery` — a partial unique
index would be a migration, blocked behind 0037), plus everything carried from PR 3/5/6.
**Before `main`:** **B-1 — apply `0037`** (the repo auto-deploys on push), then the §10.11.4
fresh-database checks (G1).

**Safety:** nothing pushed, merged or deployed; no Railway or production access; no database mutation;
`0037` not applied; backfill `--apply` not run; enforcement still `shadow`; sending and paid-discovery
kill-switches untouched; Smartlead not connected; no shared env var changed; PR 8 not started.

---

## PR 8 — implemented (self-reported, 2026-07-27)

**WizMatch Outbound Operating System, PR 8 of 10 (provider-neutral outreach adapter).** Branch
`ge/outbound-08-outreach-adapter` (cut from code-ready `ge/outbound-07-free-prep` at `70c310b5`), local
only, NOT pushed, NOT merged. Marker: `.ai/OUTBOUND_PR8_IMPLEMENTED`. Full detail:
[`docs/reviews/wizmatch-outbound-pr8-implementation.md`](../reviews/wizmatch-outbound-pr8-implementation.md).
**Self-reported, not independently reviewed yet — do not start PR 9 before that review**, and PR 9
remains separately gated on the sanitised Smartlead fixtures (U-6) regardless.

**Scope delivered:** the ADR-007 D-1 provider boundary — `src/modules/outreach/providers/outreach-provider.interface.ts`
(vendor-neutral types, an 11-flag typed `OutreachProviderCapabilities`, `OutreachProviderIdentity`,
`OutreachProviderConfigStatus`, the two-method `OutreachProvider` interface, the 7-code
`OutreachProviderError`, and the `assertOutreachProviderCapability`/`assertOutreachProviderReady`
enforcement helpers), `providers/mock.provider.ts` (`MockOutreachProvider` — deterministic, in-memory,
per-tenant call capture/id sequencing, controllable success/unsupported/failure/duplicate scenarios,
`__reset`/`__setScenario`/`__setConfigStatus`/`__getCalls` test hooks), `providers/index.ts` (lazy
singleton factory mirroring `src/modules/esign/providers/index.ts` — `getOutreachProvider`/
`setOutreachProvider`/`resetOutreachProvider`/`listKnownOutreachProviders`, `KNOWN_PROVIDERS = ['mock']`
as an allow-list with no fallback branch), and `outreachIdempotencyKey.ts`
(`deriveOutreachIdempotencyKey` — the ADR-007 D-3 four-tier order, provider-neutral, ready for PR 9/10
to reuse). **No Smartlead code, no credentials, no network call, no sending, no policy/enrolment/
suppression write.**

**Deliberate departure from esign's own convention, noted so it isn't mistaken for a copy error:** the
esign factory falls through an unrecognised `ESIGN_PROVIDER` value to the real `DocumensoProvider`
(fail-open-to-default). PR 8's factory does the opposite — an unrecognised or unimplemented name
(including the documented default `'smartlead_csv'`, which has no builder yet) throws `unknown_provider`
rather than substituting anything. This is required by the PR 8 task spec ("no implicit fallback to
another provider", "unknown provider fails closed") and is a safer default than the pattern it mirrors.

**Documentation also produced:**
[`docs/handoffs/WIZMATCH_PR9_SANITISED_FIXTURE_CHECKLIST.md`](WIZMATCH_PR9_SANITISED_FIXTURE_CHECKLIST.md)
(what PR 9 needs before it can start — no Smartlead field invented) and
[`docs/handoffs/WIZMATCH_PR10_PROVIDER_EVENT_MAP.md`](WIZMATCH_PR10_PROVIDER_EVENT_MAP.md) (the
provider-neutral fields PR 10's reply-ingestion path will need, grounded in the existing
`wizmatch_reply_mailboxes`/`wizmatch_outreach_events` schema and `imapService.ts`/`classify-reply`
behaviour — several gaps, e.g. no occurred-at timestamp captured today, are stated rather than papered
over with an invented field).

**Gates:** `git diff --check` clean · `npm run build` exit 0 · `npm test` **120 files / 1154 tests**
(was 119/1119 at the PR 7 review baseline, +1 file / +35 tests, all non-vacuous against the required
failure-scenario list — see the implementation report's table) · `npm run admin:build` clean (no admin
files touched) · Playwright `wizmatch-local` **99 passed / 15 skipped / 0 failed**, identical to the
PR 7 baseline.

**Method:** three parallel read-only Explore subagents (provider contracts/capabilities/schema;
test/DI/reset patterns and the recurring mock-vacuity defect class; PR 9/10 fixture and event-field
groundwork), per the PR 2–7 precedent.

**Not done, deliberately:** no Smartlead API/CSV implementation; no IMAP/reply-ingestion
implementation; no schema or migration change (no `0038`); `WIZMATCH_OUTREACH_ADAPTER_ENABLED`/
`OUTREACH_PROVIDER` not wired into any route or worker job (nothing calls the factory yet — that is
PR 9/10 scope); no guardrail file touched; no Growth/SEO/n8n/`package-lock.json` change; nothing
pushed, merged, or deployed; no Railway or production access; no database mutation; no sending or paid
discovery enabled.

**Exact next action:** get an independent readiness review of PR 8 (three-subagent method). PR 9
(`ge/outbound-09-smartlead-csv`) remains **GATED** on the sanitised Smartlead fixtures (U-6) regardless
of that review's outcome. Stop after PR 8.
