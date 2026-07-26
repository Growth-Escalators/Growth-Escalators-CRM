# CURRENT_TASK.md

## Active task

**PR 4 + PR 5 REVIEWED AND CODE READY 2026-07-26 at `a5e48602` (+ this review's fixes).**
Final independent code-readiness re-review of
`ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation`, three parallel read-only
Explore subagents, every load-bearing finding re-verified by hand, every fix with a control run.
Report: `docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md` (appended section "Final independent
code-readiness re-review"). Marker: **`.ai/OUTBOUND_PR5_CODE_READY` created.**

> **The fix pass genuinely closed C-1, C-2 and H-1…H-14 — with two exceptions found here.**
>
> **RC-1 (Critical, fixed) — the C-1 fix did not fully land.** H-2's null-`companyId` block in
> `wizmatchRequirementPriority.ts` sat on the one path that never reaches `resolveCompanyStatus`, so
> it never consulted the mode. `wizmatch_requirements.company_id` is nullable (masked clients) and
> the fetcher `LEFT JOIN`s with no filter, so in the shipped default `shadow` those requirements went
> `blocked` **and** `POST /requirement-priority/:id/review-plan` returned **409** — C-1's exact defect
> class, falsifying the claim that neither 409 fires in shadow. New in this range; the
> `wizmatchClientDiscovery.ts` block it claims to mirror predates the stack, so they are not
> equivalent. Fixed with `isEnforcementActive()`; canonical metadata still always attached (D-31).
>
> **RH-1 (High, fixed) — H-8/H-9/H-10 shipped with no regression test at all**, against an explicit
> claim that each had one. Deleting the enum validation, SSRF scrub or company-agreement invariant
> left the suite green. 23 tests added; controls fail 2 / 6 / 4.
>
> **RH-2 (High, fixed) — `wizmatchLinkage.test.ts` could not detect either regression D-32 exists to
> prevent** (dropped tenant predicate, reintroduced `.limit(1)`) — third recurrence of M-5/L-6/H-7, on
> the file the fix pass had just rewritten. Controls now fail 5 / 2.
>
> **RH-3 (High, fixed) — D-35's mode-flip alert could not fire for the mechanism that changes the
> mode.** The baseline was in-process only; the env var is applied by redeploying, so the real flip
> always arrived as a fresh process and was seeded silently. Now also compared against a persisted
> baseline in `audit_logs`, best-effort, once per process. Control fails 3.
>
> **Gates:** `git diff --check` clean · `npm run build` exit 0 · **113 files / 1030 tests** (was
> 113/1003) · `npm run admin:build` clean · Playwright `wizmatch-local` 97 passed / 15 skipped / 0
> failed. Boundary checks all pass — no guardrail file, no `package-lock.json`, no Growth/SEO/n8n or
> legacy-outreach contamination, no send or paid-provider capability enabled, no production action.
>
> **Playwright command note:** `--project=wizmatch-local` does not exist; use
> `npx playwright test --config=playwright.wizmatch-local.config.ts`.
>
> **Open, carried forward:** M-1 staff+ policy reads 403 at the `/api/wizmatch` mount (fails
> **closed**); **M-2 Command Center requirements/candidateIntelligence unfolded and the fetcher does
> not select `company_id` — inert in shadow, must close before G4/`enforce`**; M-3…M-9, L-1…L-6 (full
> table in the review); U-7, U-9, O-1; **B-1 — apply 0037 before this stack reaches `main`.**

**Exact next action:** owner decides whether M-2 lands as a PR 5 follow-up commit or is scheduled as a
hard G4 precondition. Then PR 6 (decision workbench — queues API + Today re-bucket + bulk bar) per the
standing 10-PR programme. **Do not** merge, deploy, apply 0037, run backfill `--apply`, or promote
`enforce` on the strength of this review. Before `main`: B-1 and the §10.11.4 fresh-database checks (G1).

---

## Prior task — PR 4 + PR 5 checkpoint fix pass (superseded by the re-review above)

**PR 4 + PR 5 CHECKPOINT FIX PASS COMPLETE 2026-07-26.** Every Critical/High finding in the
2026-07-26 independent Opus checkpoint review (`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`)
is closed on `ge/outbound-05-lifecycle-consolidation`. Owner decisions D-31 through D-39 were ratified
up front (C-1: option A, adapter respects `shouldBlock`) and are all implemented — D-31 (mode-aware
adapter, closes C-1), D-32 (multi-company most-restrictive-wins, closes U-13), D-33 (verified already
satisfied), D-34 (persisted, idempotent shadow observations in `audit_events`), D-35 (mode-flip
alert/audit once per transition), D-36 (tenant-bound versioned unsubscribe token, retires U-8), D-37
(fail-closed on every unknown policy value, folded into H-8's fix), D-38 (Duplicate Companies
nav/route/page all gated), D-39 (PRD-005 §22.4/§22.5 added). H-2 through H-14 are each fixed with a
dedicated regression test. Full detail: the checkpoint report's new "Fix pass" addendum,
`.ai/OUTBOUND_PR5_IMPLEMENTED`'s fix-pass section, and `.ai/HANDOFF_LOG.md`'s 2026-07-26 entry.

> **Gates on the fix-pass tree:** `git diff --check` clean · `npm run build` exit 0 ·
> **113 files / 1003 tests** (was 110/970 at checkpoint HEAD) · `npm run admin:build` clean ·
> Playwright `wizmatch-local` 97 passed / 15 skipped / 0 failed.
>
> **`.ai/OUTBOUND_PR5_CODE_READY` was deliberately NOT created by this fix pass** — that marker is
> reserved for an independent reviewer, per standing instruction, not for the session that made the
> fixes. Do not merge, deploy, apply 0037, run backfill `--apply`, or promote `enforce` on the strength
> of this fix pass. U-7, U-9, O-1 (PR 3 review) and B-1 (0037 must be applied before this stack reaches
> `main`) remain open, carried forward unchanged.

**Exact next action:** get an independent readiness re-review of PR 4 + PR 5 against the fix pass
(three-subagent method, per the PR 2/PR 3/PR 5-checkpoint precedent). If it passes, the reviewer
creates `.ai/OUTBOUND_PR5_CODE_READY`. **Do not** start PR 6 until that happens.

---

## Prior task — PR 4 + PR 5 independent Opus checkpoint review: NOT READY (superseded by the fix pass above)

**PR 4 + PR 5 REVIEWED 2026-07-26 — verdict NOT READY (fix-then-re-review).** Independent Opus
checkpoint review of `ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation` at
implementation HEAD `7777c455`, three parallel read-only Explore subagents, every load-bearing
finding re-verified by hand. Report:
`docs/reviews/wizmatch-outbound-pr5-opus-checkpoint.md`. **`.ai/OUTBOUND_PR5_CODE_READY` was
deliberately NOT created.**

> **Two Criticals. One is the blocker and needs an owner call.**
>
> **C-1 — PR 5 blocks in `shadow` mode. NOT FIXED.** The PR 5 adapter resolves the canonical decision
> and acts on it without ever consulting `shouldBlock` / `WIZMATCH_POLICY_ENFORCEMENT_MODE`. Two call
> sites are real write blocks (409), not display: `send-to-contact-intelligence` and the new
> `requirement-priority/:id/review-plan`. PRD-005 §16 rule 2 says shadow "blocks nothing"; gate G3
> requires "zero behavioural change post-deploy". With 0037 unapplied every company resolves
> `deny/policy_resolver_error`; applied-but-un-backfilled, `deny/policy_missing_root` — the
> client-discovery and requirement-priority surfaces go dark on merge, while
> `WIZMATCH_COMPANY_POLICY_ENABLED` being off 404s the API that would unblock them. Two defensible
> readings; both agree the two 409s are wrong. **Recommendation: make the adapter mode-aware.**
>
> **C-2 — no policy could ever be changed. FIXED.** `writeCompanyPolicy` inserted the new active row
> before superseding its predecessor, violating the non-deferrable partial unique index
> `wizmatch_company_policies_active_scope_uniq`. Every supersession, including every admin override,
> would have raised `23505` and 500'd against a real database. CI was green only because the mock
> enforced no constraints — the same class as the PR 2 FK-ordering Critical.
>
> **Also fixed, with control runs:** H-1 `POST /companies/bulk/policy` was shadowed by
> `POST /companies/:id/policy`, so the admin-only bulk endpoint never ran and the `team_lead` gate
> fired instead (confirmed against the repo's Express 5.2.1); H-12 the supersession test never
> asserted supersession happened. New `src/__tests__/wizmatchPolicyRoutes.test.ts` pins path
> precedence, the role gate that actually fires, and flag-off 404s against a real Express app.
>
> **Twelve Highs open**, including: requirement-priority fails **open** on a null `companyId`; the
> canonical REVIEW branch for contact intelligence is dead code; `priority` is folded but `nextAction`
> is not, so the workbench offers a live POST on a denied company; the fifth caller's scope-out reason
> is falsified by this same PR; the adapter test's mock discards `.where()`; unknown
> `outreachEligibility` fails **open**; `evidence_url` is not SSRF-scrubbed though §10.1/§18.2 name
> the control as shipping here; and **the PR 4 marker's flag-gating claim is false** — the Duplicate
> Companies page has no flag import and its nav entry and route are unconditional.
>
> **Gates on the post-fix tree:** `git diff --check` clean · build exit 0 · **110 files / 970 tests** ·
> `admin:build` clean · Playwright 97 passed / 15 skipped / 0 failed. Boundary checks all pass — no
> guardrail file, no `package-lock.json`, no Growth/SEO/n8n or legacy-outreach contamination, no send
> or paid-provider capability enabled, no production action.

**Exact next action:** get the owner decision on C-1, implement it, close the twelve open Highs, then
re-review. **Do not** merge, deploy, apply 0037, run backfill `--apply`, promote `enforce`, or start
PR 6 until that is done.

---

## Prior task — PR 5 implementation (self-reported)

**PR 5 IMPLEMENTED (self-reported, not independently reviewed) 2026-07-26 —
WizMatch Outbound Operating System, PR 5 of 10 (lifecycle consolidation).** Branch
`ge/outbound-05-lifecycle-consolidation` (cut from `ge/outbound-04-policy-ui-backfill`), local only,
NOT pushed, NOT merged. Marker: `.ai/OUTBOUND_PR5_IMPLEMENTED`. Full detail:
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`'s PR 5 section.

**Scope delivered:** migrated the five legacy eligibility computations named in PRD-005 §5.2 C-2 onto
the canonical resolver (`resolveCompanyStatus`/`evaluateWizmatchOutreachGate`, built in PR 2) via a
new compatibility adapter, `src/modules/outreach/legacyEligibilityAdapter.ts`. Four migrated
(`wizmatchClientDiscovery.ts`, `wizmatchCommandCenter.ts`, `wizmatchRequirementPriority.ts`,
`wizmatchContactIntelligence.ts`/`Repo.ts`); one (`wizmatchCandidateIntelligence.ts`) explicitly
scoped out with a disclosed reason (scores a candidate, not a company — the gate requires a
`companyId` this file structurally lacks). Fixed the concrete ADR-006 D-13 violation in
`wizmatchContactIntelligenceRepo.ts` (persisted legacy `status` no longer overrides a freshly computed
status, in both the read path and the write-time freeze clause). Added a contract test file proving
the migrated callers agree with the canonical resolver, and a source-level guard test preventing a
sixth independent eligibility computation.

**Verified this session:** `git diff --check` clean; `npm run build` exit 0; `npm test` 109 files /
966 tests green (was 107/948). No admin/UI files touched, so `admin:build`/Playwright were not run.

**Not done, deliberately:** migration 0037 still unapplied; backfill `--apply` not run; Today page not
re-bucketed; free-prep pipeline not built; no provider integration; enforcement mode untouched
(`shadow`); sending/paid-discovery/Smartlead untouched; U-13/U-14/U-10/U-12/L-7…L-13 from the PR 3
review still open, untouched by this PR (carried from PR 4, not this PR's scope).

**Exact next action:** get an independent readiness review of PR 5 (three-subagent method, per the
PR 2/PR 3 precedent — this marker is self-reported and has not had that yet), then PR 6 (decision
workbench — queues API + Today re-bucket + bulk bar) per the standing 10-PR programme. Stop after PR 6.

---

## Prior task — PR 4, policy UI/API/backfill/readiness

**PR 4 IMPLEMENTED (self-reported, not independently reviewed) 2026-07-26 at `9561c10` —
WizMatch Outbound Operating System, PR 4 of 10.** Branch `ge/outbound-04-policy-ui-backfill`
(cut from `ge/outbound-03-policy-enforcement`), local only, NOT pushed, NOT merged. This session
resumed an interrupted PR 4 build: most of the implementation already existed uncommitted in the
worktree; this session verified it against AGENTS.md/CLAUDE.md, PRD-005, ADR-006, ADR-007 and the
handoff log, fixed three defects found while verifying (a stray compiled `.js` duplicate of the
backfill script; `WizmatchDuplicateReviewPage` had a nav entry but no route wired into `App.jsx`;
`CompanyPolicySection` crashed the whole company drawer on a malformed policy-API response — caught
by two failing Playwright specs), ran the full gate suite, and committed. Marker:
`.ai/OUTBOUND_PR4_IMPLEMENTED` (full detail, including the exact gate output and everything
explicitly not done, is there — read it before resuming).

**Scope delivered:** policy read/write API + RBAC + admin bulk actions
(`src/routes/wizmatchPolicy.ts`, `src/modules/outreach/policyService.ts`); duplicate-company
review/resolve (`src/modules/outreach/duplicateService.ts`); dry-run-first backfill CLI
(`scripts/onboarding/wizmatch-policy-backfill.ts`, `src/modules/outreach/policyBackfill.ts`);
the §21.1 readiness report/CLI (`src/modules/outreach/policyReadiness.ts`,
`scripts/wizmatch-policy-readiness.ts`); company-drawer Policy section + a new Duplicate Companies
admin page. Everything is behind `WIZMATCH_COMPANY_POLICY_ENABLED` (default false — API 404s,
UI renders nothing when off).

**Verified this session:** `git diff --check` clean; `npm run build` exit 0; `npm test` 107 files /
948 tests green; `npm run admin:build` clean; full `playwright.wizmatch-local.config.ts` suite —
97 passed / 15 skipped (real-backend specs, no server started) / 0 failed.

**Not done, deliberately:** migration 0037 still unapplied; backfill `--apply` not run; enforcement
mode untouched (`shadow`); sending/paid-discovery/Smartlead untouched; **U-13** (`resolveWizmatchLinkage`
returns an arbitrary company on multi-linkage, fail-open), **U-14** (bulk-email/export per-row gating
performance), U-10, U-12, L-7…L-13 from the PR 3 review are **not folded into this PR** — no code in
this commit touches `wizmatchLinkage.ts` or the bulk-gating call sites. They were not part of the
already-started work found in the worktree this session, and this session was instructed to finish
only that, not start new scope. Recorded as open, not silently dropped.

**Exact next action:** get an independent readiness review of PR 4 (three-subagent method, per the
PR 2/PR 3 precedent — this marker is self-reported and has not had that yet), then an owner decision
on whether U-13/U-14/U-10/U-12/L-7…L-13 land as a PR 4 follow-up commit or are explicitly deferred to
PR 5. Then PR 5 (lifecycle consolidation) per the standing 10-PR programme. Stop after PR 5.

---

## Prior task — PR 3, policy enforcement (shadow) + readiness review

**PR 3 REVIEWED AND CODE READY 2026-07-26 at `21b3bc3` — WizMatch Outbound Operating System, Wave A.**
Branch `ge/outbound-03-policy-enforcement` (cut from `ge/outbound-02-policy-schema-service`), local
only, NOT pushed, NOT merged. Implements PRD-005 §22.3: every §8.10.1 caller-migration-checklist row
closed (migrated onto the gate, gate-or-reject, or routed through `suppress()`), A-1/A-4/mailer/HMAC
fixes, shadow-mode-default enforcement with a shadow-vs-enforce equivalence harness.
Marker: `.ai/OUTBOUND_PR3_CODE_READY`. **Does not promote `enforce`, does not enable sending** — both
kill-switches and the enforcement-mode default are untouched/off.

> **Independent readiness review 2026-07-26 — verdict fix-then-ship.**
> `docs/reviews/wizmatch-outbound-pr3-opus-review.md`. Three read-only Explore subagents; **six defects
> found and fixed in `21b3bc3`**, each with a control run proving the new test fails on it. Two of the six
> made the gate *report* a block while permitting the state it existed to prevent: row 4 hand-rolled
> `decision === 'deny'` so a `review` decision queued drafts every other site blocks, and row 12
> committed `status='approved'` on autocommit and *then* returned 403. Also: `POST /suppression` flipped
> `contacts.do_not_contact` for `hard_bounce` (the §8.4 grain collapse); `suppress()` wrote its audit row
> in a second autocommitted statement; `/send-test` discarded the resolved `contactId` so the A-1
> suppression union degraded to one grain; all three contact-grain writes missed mixed-case channel rows.
> The equivalence harness was strengthened — as submitted it compared the gate to itself, so **a live
> divergence in the same diff left it green**. Suite 103 files / **916** tests (was 896), build 0, tree clean.

**READ THIS BEFORE MERGING — hard deploy-order prerequisite (B-1), new and previously unrecorded.**
`suppress()` writes `wizmatch_suppression_events`, created **only by migration 0037**, which is
deliberately unapplied (G1, pending U-7). Before 0037 is applied, the **public
`GET /api/wizmatch/unsubscribe` route throws** (it worked before this PR), `POST /suppression` and
`/classify-reply` 500, and hard bounces are dropped — re-creating the A-4 defect §22.3 #6 closes.
This repo **auto-deploys on push to `main`**, so: **apply 0037 before PR 3 reaches `main`.**

**Four owner decisions before G4** (detail in the review §11): **U-8** unsubscribe tenant lookup is
"most recent sender wins" across tenants and the HMAC carries no tenant to disambiguate; **U-9** rows
15-17 gate at preparation level though §8.10.1 labels them `enrol`/`follow-up`; **O-1** §16 rule 5's
Slack-alert-on-mode-flip has no implementation and was undisclosed; **U-11** confirm PR 4 owns the
persisted `gate_denied` row. **B-2:** M-5/L-6 (the PR 2 review's own stated PR-3 prerequisites) are
still open and were undisclosed — the gate mocks still discard `.where()`, so deleting
`isNull(supersededAt)` or the linkage tenant predicates leaves the suite green. Close before G4.

**Exact next action:** get owner decisions on U-8, U-9 and O-1, then create
`ge/outbound-04-policy-ui-backfill` from `ge/outbound-03-policy-enforcement` and implement PRD-005's
PR 4 scope — policy read/write API + RBAC, company-drawer Policy section, effective-policy provenance
UI, duplicate comparison/Merge/Confirm-Separate, admin bulk actions, dry-run-first backfill (never run
`--apply`), readiness endpoint/CLI, pending-duplicate and shadow-block reporting. Fold in U-13
(most-restrictive-wins across multiple company linkages — today `.limit(1)` with no `ORDER BY` lets an
eligible company mask a blocked one), U-14 (batch or tenant-short-circuit the per-row gating on
`bulk-email`/`export`), U-10, U-12 and L-7…L-13. Flags default false. Then PR 5 (lifecycle
consolidation). Stop after PR 5.

---

## Prior task — PR 2, schema + migration + resolver/gate module

**DONE 2026-07-26 — WizMatch Outbound Operating System, PR 2 of 10
(`ge/outbound-02-policy-schema-service`, schema + migration `0037` + resolver/gate module — NOT
committed as a PR, local branch only, NOT pushed, NOT merged).** Implemented against PRD-005 §22.2
(twenty acceptance criteria). Full detail: `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`. Summary:

> **REVIEWED 2026-07-26 — verdict fix-then-ship.**
> `docs/reviews/wizmatch-outbound-pr2-opus-review.md`. Two Critical and five High defects found and
> fixed in four corrective commits (`79bb384`, `3057221`, `e690ac1`, `810d144`). The headline: **0037
> could not apply to any database** — all 29 composite FKs preceded their `(tenant_id, id)` target
> indexes (SQLSTATE 42830); fixed by statement reorder only. Also: `PolicyDecision` was forgeable;
> allowed campaign types/modes were zeroed on a deny; L1c hardcoded `preparationAllowed: true`; the
> suppression read did not lowercase the stored column; reason codes named the wrong cause; L5
> duplicate containment was never implemented. **One §22.2 criterion remains open: #16**, the
> cold-start root-policy row on every company insert path — needs an owner call on PR 2 vs PR 3, and
> must land before G2/G4. Suite now 60 outbound tests / 867 total, build 0, tree clean.
> The counts below are as-submitted and are superseded by the review where they differ (notably: 29
> composite FKs, not 22; 60 outbound tests, not 37; 99 files / 867 tests, not 97 / 840).

- `src/db/schema.ts` — 8 new tables (`wizmatch_company_policies`, `_policy_events`,
  `_duplicates`, `wizmatch_reply_mailboxes`, `wizmatch_outreach_batches`, `_enrolments`, `_events`,
  `wizmatch_suppression_events`), 2 additive ALTERs (`wizmatch_companies.account_owner_user_id`,
  `wizmatch_suppression_list.contact_channel_id`/`channel_invalid`), 6 additive non-partial
  `(tenant_id, id)` unique indexes (§10.10.1), 22 composite FKs, all §10.1/§10.6.1/§10.6.2/§10.7/§10.9.1
  CHECKs. `admin_override` and `suppression_scope` do not exist. Existing
  `wizmatch_suppression_tenant_email_uniq_idx` untouched.
- `src/db/migrations/0037_unknown_siren.sql` — generated by `db:generate`, then hand-hardened with
  `IF NOT EXISTS`/`DO $$...EXCEPTION WHEN duplicate_object` guards on the two ALTERs on long-lived
  tables (H-11), plus a marked manual guard block (§10.11.2) containing the one construct drizzle-kit
  cannot emit: the policy-immutability trigger (ADR-006 D-10). Zero destructive statements confirmed
  by grep. Journal `when=1785039545644` > `1784464092263`. **NOT applied to any database — that is G1.**
- `src/modules/outreach/` — `policyTypes.ts` (branded `PolicyDecision`), `scopeKey.ts`
  (`buildScopeKey()`, the sole producer of `scope_key`), `scopeApplicability.ts` (§8.1.1 region/BU/
  location resolution, fails closed per H-4), `policyResolver.ts` (Phase-0 per-dimension inheritance),
  `campaignCompatibility.ts` (§8.6/§8.7 routing matrix + combination rule), `outreachGate.ts`
  (`evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` / `resolveCompanyStatus` — L0-L8,
  fail-closed, no legacy fallback).
- `src/config/wizmatchOutreachStates.ts` — the one exported constant all four §10.6.2 partial-index
  predicates and the enrolment-state CHECK derive from. `src/config/wizmatchReasonCodes.ts` — the §9
  taxonomy as data, with a mechanical §9.11 invariant checker.
- Tests: `wizmatchOutreachGate.test.ts`, `wizmatchScopeKey.test.ts`, `wizmatchReasonCodes.test.ts`,
  `wizmatchCampaignCompatibility.test.ts` — 37 new tests, all passing. Full suite: 97 files / 840 tests
  passing (`npm run admin:install` run first, closing the pre-existing `lucide-react` load-failure gate).
  `npm run build` exits 0. **No caller migrates onto the gate in this PR** (PR 3 scope, §8.10.1).

**Known PR-2 scope limits, stated not hidden** (see `outreachGate.ts` header comment): the cold-start
contact-confidence gate (§7) is not wired in (no caller supplies it yet); duplicate-suspect containment
(L5, §8.8) is not queried from the gate in this PR; shadow-vs-enforce is a no-op either way since
nothing calls the gate yet. **Could not run:** the §10.11.4 fresh-database replay / incremental-apply /
re-apply-idempotency / production-drift-diff / lock-measurement / trigger-fire checks — direct
Postgres access (`psql`) was denied by this session's tool-permission layer despite a local Postgres
being available. These remain to run, with real output recorded, before G1.

---

## Prior task — PR 1, PRD + ADRs (docs only)

**IN PROGRESS 2026-07-26 — WizMatch Outbound Operating System, PR 1 of 10 (docs only, DRAFT PR, NOT
MERGED).** Branch `ge/outbound-01-prd-adrs`, worktree `~/repo-comparison/v2-outbound-os`, cut clean
from `origin/main` = `1e74812`. Adds `docs/prd/005-wizmatch-outbound-operating-system.md`,
`docs/decisions/ADR-006-company-outreach-policy.md` and `ADR-007-outreach-provider-boundary.md`.
**Documentation only** — no `schema.ts`, no migration, no backend, no frontend, no Railway change, no
env change, no production data, no sending, no paid provider. Full status:
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`.

**Push state:** `687b8a0` **is** on `origin/ge/outbound-01-prd-adrs`. Later commits are local only.
Do not rewrite that branch's history.

**SPEC-REPAIR PASS COMPLETE (2026-07-26).** The overnight Opus review
(`docs/reviews/wizmatch-outbound-overnight-opus-review.md`) found six CRITICAL and twelve HIGH defects
**in the specification**, not in code — no code exists. All are now dispositioned in that report's new
§19. Eight owner decisions D-1 … D-8 are recorded as PRD-005 §25.1 A-22 … A-30:

- **D-1** missing root policy fails closed (`policy_missing_root`); the legacy-status fallback is
  deleted, and `wizmatch_company_intelligence.status` is display-only from here on.
- **D-2** all 22 cross-table entity references become composite `(tenant_id, ref_id)` FKs;
  `scope_ref_id` is deleted in favour of typed `signal_id` / `requirement_id`.
- **D-3** raw SQL approved for the immutability trigger only, inside a marked guard block;
  `admin_override` deleted.
- **D-4** suppression keeps three grains in three homes; `suppression_scope` deleted and the existing
  `UNIQUE (tenant_id, email)` retained, so `0037` is **additive** (it was previously believed not to be).
- **D-5** one mandatory chokepoint — `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed`
  — plus a 31-row caller-migration checklist that is PR 3's acceptance evidence.
- **D-6** a reply does **not** release the company cold-email lock; 15 enrolment states, 8 live, 7
  terminal.
- **D-7** every permanent or non-overridable block requires evidence, CHECK-enforced.
- **D-8** the taxonomy freezes when PR 2 lands values, not before.

**PR 2 is unblocked.** Build against PRD-005 **§22.2** (twenty acceptance criteria); PR 3 against
§22.3. Marker: `.ai/OUTBOUND_PR2_SPEC_READY`. Two owner items remain open and neither blocks PR 2 —
**U-6** Smartlead fixtures (blocks PR 9) and **U-7** sign-off on three shared-table indexes (blocks G1).

**Reason-code taxonomy RATIFIED (2026-07-26), then corrected in the repair pass.**
`policy_accepts_external_vendors` requires evidence; `contact_role_mismatch` replaced by
`contact_role_uncertain` and `contact_role_confirmed_mismatch`; the 2026-07-09 cost-leakage audit's
"alert + keep sending" mailer decision is annotated superseded by ADR-006 D-11 (fail closed). The
repair pass additionally fixed five evidence violations, three preparation-flag contradictions, and
added `manual_admin_override` and `manual_lock_release`.

**What it specifies.** A decision-first outbound layer extending (not replacing) PRD-004: a scoped
company **outreach policy** authoritative over signal score and contact approval; a four-queue Today
decision workbench (Ready to Contact / Needs Review / Replies Needing Action / Paused or Blocked); a
zero-cost automatic preparation pipeline; and a provider-neutral outreach adapter whose first
implementation is Smartlead **CSV export + result CSV import** — no API, keys or recurring cost.

**Load-bearing design calls** (full rationale in ADR-006): policy scope identity is a canonical
`scope_key` (`entire_company`, `region:india`, `business_unit:cloud`, `signal:<uuid>`, …) so two
business units can both hold active policies while a duplicate is rejected by the database;
**per-dimension inheritance** with `entire_company` as the root, so a location-only pause never resets
an `existing_client` relationship or a company-wide hiring policy; hard blocks beat specificity;
`block_class` (`standard`/`compliance`/`legal`) + `is_non_overridable` replace a single overloaded
legal-hold flag, and a company removal request is **compliance, not legal**; privacy/GDPR erasure is
explicitly **not** an outreach policy and needs its own workflow (PRD §18.4, FUTURE list).

**Audit findings this stack fixes.** P0 — suppression is **fail-open**: `sendSignalDraftEmail()`
(`src/services/wizmatchOutreachService.ts:183-189`) checks only `wizmatch_suppression_list` and never
`contacts.do_not_contact`, which `PATCH /api/contacts/:id` sets freely. P1 — hard bounces are detected
then discarded (`wizmatchBounceParser.ts:57-77`, default-off flag). P1 — `POST /api/wizmatch/classify-reply`
is fully implemented but has **no caller in the repo**. Carried, not fixed: the `sequence_step` job
loop is dead (n8n undeployed since 2026-05-03), so WizMatch gets its own enrolment table instead.

**Exact next action (superseded by the PR 2 update above — kept for history):** ~~create
`ge/outbound-02-policy-schema-service`... begin PR 2~~ — **done**, see the Active task section at the
top of this file. Remaining before G1: run the ten §10.11.4 fresh-database verification requirements
with real output (needs a scratch Postgres — **not optional**: skipping the fresh `0000→0037` replay is
exactly what hid the Critical FK-ordering defect the review found), and obtain owner sign-off on U-7
(the three shared-table indexes).

**Before PR 3, in order:** (1) owner decision on §22.2 #16, the cold-start root-policy write on every
company insert path — the one criterion still open; (2) add a `lower(email)` expression index, since
the suppression-normalisation fix makes that read a sequential scan; (3) converge the two gate test
mocks so the original suite can also detect a wrong query predicate. Then PR 3 proper (caller migration
onto the gate, per the §8.10.1 checklist). Full list: §12 and §13 of
`docs/reviews/wizmatch-outbound-pr2-opus-review.md`.

**Rollout is gated.** Enforcement ships in `shadow` mode (logs what it would block, blocks nothing);
promotion to `enforce` needs a readiness report plus five hard preconditions and is an explicit owner
decision. `WIZMATCH_SENDING_ENABLED` and `AUTOMATED_EMAILS_ENABLED` are not modified by any milestone.

## Prior task — cost-safe POC/client search

**SHIPPED 2026-07-16 (`origin/main` = `695a139`, Railway deploy `35c38b14` SUCCESS): cost-safe
POC/client search — read-only preview + role targeting + credit banner.** Surfaces the existing
free-first, capped machinery so you can search for POCs (Talent Acquisition / HR-People /
Hiring-Delivery Mgr / Vendor-Procurement) without wasting credits: `buildPocSearchQuery(company,
domain, roles?)` is role-parameterized (default = original all-roles query, unchanged); a new
read-only `POST /signals/:id/discover-poc/preview` (`previewFreePocSearch`) returns the exact query +
remaining SearchAPI allowance (today X/5 · month Y/80) + cooldown/internal-contacts state + estimated
credit cost (0 or 1) and **calls no provider** (pure DB read); `/discover-poc` now takes a `roles`
body. The Signals "Find POC" is preview-first (query + role toggles + credit/cost + "Run free
search"), plus a Search-credits banner over the sourcing cards. The free run itself is unchanged
(internal CRM → website scrape → SearchAPI 1 credit only within the 5/day+80/mo caps + 30-day
cooldown + ≤5 cap; channels never guessed); Apollo/Snov stay OFF behind their gate. No schema/
migration, no guardrail file, no new env var. **Verified:** tsc, 455 Vitest (new
`wizmatchPocSearchPreview.test.ts` — role-set query builder + preview cost logic, DB-only/no-provider),
admin build, 97 Playwright (sourcing spec updated to preview-first). **Live:** deploy SUCCESS, zero
5xx, `/health` 200, SPA 200, the new preview route 401 (intact). **Enablement — NOW DONE:**
`WIZMATCH_POC_DISCOVERY_ENABLED=true` was set on the production `web` service (env
`81b087de`, Railway) and applied via a redeploy (empty commit `7223b49`, deploy `2c895610` SUCCESS —
`set_variables` alone did not restart the process, so a push was needed to reboot with the flag).
`SEARCHAPI_API_KEY` was already present (validated in prior handoffs; not re-read, to avoid leaking).
So the free POC search now RUNS in prod (capped 5/day + 80/mo + 30-day cooldown + ≤5 results,
preview-first, channels never guessed). **Apollo/Snov paid discovery stays OFF** behind
`WIZMATCH_PAID_DISCOVERY_ENABLED` + its cost guard — untouched.
Client-side cost-safety (TheirStack free preview + SearchAPI allowance) is on the same Signals
sourcing cards; Companies paid `discovery-preview` + Client-Discovery seeding are unchanged (paid
stays off / seeding is credit-free).

## Prior task — comprehensive filters on every page (SHIPPED `d7906e0` + analytics scoping `9767469`)

**SHIPPED 2026-07-16 (`origin/main` = `d7906e0`, Railway deploy `88cd21cf` SUCCESS): comprehensive,
consistent filtering on every Wizmatch page.** A new shared filter/table system
(`admin/src/components/wizmatch/filters/`: `useTableControls` + `FilterBar` + `filterPipeline` +
`exportCsv`, plus a sortable/column-hideable `ui/DataTable`) is wired into all 10 pages: Job
Leads/Signals, Candidates, Requirements, Companies, Hiring Contacts (both tabs), Talent Matching,
Submissions/Delivery, Placements, Contact Intelligence, Reports. Every page gets type-aware filters
(search / multi-select / numeric+date ranges / toggles), active-filter chips + Clear all, **shareable
URL views** (filters/sort/columns/page in the query string), **saved presets** (localStorage per
`pageId`), **CSV export of the filtered set**, and — on the table pages — sortable headers + column
show/hide. Server-paginated pages (Signals/Candidates/Requirements) filter AND **sort globally**
server-side via a safe allowlisted ORDER BY (`wizmatchOrderBy`; the user key/dir only look up a
hard-coded column map + normalised direction + `created_at` tiebreaker), and their CSV re-fetches the
full filtered set at the backend max (200). Client pages (Companies 500-cap, Delivery, Placements,
Contact Intelligence, Hiring Contacts fan-out) filter/sort in-browser over the loaded set. Backend
changes are **read-only query params + ORDER BY only** — no schema/migration, no env var, no
auth/RBAC/Cashfree/SOD-EOD, no pilot-flag change; one CI LATERAL join added to `listCompanies`.
**Verified:** tsc clean, 446 Vitest (53 files, incl. new `wizmatchRequirementsFilters.test.ts`
asserting the ORDER BY allowlist + injection-safe fallback), admin build clean, 97 Playwright (0
failed) — the loop caught + fixed 8 regressions (FilterBar contrast a11y across 6 pages, Reports
Status control, Companies URL shape, chip/checkbox/transition edge cases). **Live-verified** on prod:
deploy SUCCESS, no boot errors from the change, zero 5xx since deploy, `api/health` 200, CRM SPA 200,
wizmatch filter routes 401 (intact) with the new `sort=`/multi-value params. **Known follow-ups (not
blockers):** the staffing-analytics *date* filter on Reports is now **SHIPPED** (`9767469`, Railway
deploy `ca1fb1f6` SUCCESS) — `analytics(tenantId, from?, to?)` scopes the funnel/revenue/time-to-
start/recruiter+source/rejection metrics by the From/To range (SLA exceptions + aging stay
current-state; clearing the range = all-time); Reports `Status` is single-select (kept a funnel spec
meaningful); Placements recruiter/prime filters need backend fields;
client pages past their cap (Companies 500, etc.) need server pagination later. Also still open from
before: the broken cold-outreach send loop; strict India-only tightening; the deferred region-column
migration.

## Prior task — India-only sourcing (SHIPPED `ade021a`)

**SHIPPED 2026-07-16 (`origin/main` = `ade021a`, Railway deploy `b508ecc1` SUCCESS): India-only
sourcing.** Behind a `WIZMATCH_INDIA_ONLY` flag (default on, no infra change): the ATS poller drops
confident-US postings at ingest (keeps India + remote/blank — neutralizes US even if a US company
keeps polling, so no `ats_type` cleanup); X-Ray seed queries are now all Indian metros; the signals
list (`GET /signals`) excludes confident-US by default (`region=all` bypass, `region=us` invert);
Job Leads has an "India only / All regions" toggle (default India) and Requirements default to India;
the misleading "Outreach" nav decoy (Growth Saleshandy dashboard) was removed. TheirStack + SearchAPI
were already India-scoped. No schema/migration; existing US rows kept (hidden), viewable via the
toggle. **Live-verified**: Job Leads default 6714→3819 (US hidden), toggle restores 6714, Outreach
gone, zero console errors / Railway 5xx. **Known limitation / recommended next step**: the rule is
"exclude confident-US, keep ambiguous", so non-US **non-India** roles (e.g. Spotify São Paulo/Korea,
Airbnb) still show in the India view; tightening to *strict* India-only means excluding all confident
non-India places (with the tradeoff that an India role labelled only "Remote/Global" could be hidden).
Also still open: the broken cold-outreach send loop; the deferred region-column migration.

## Prior task — matching reachable + discardable drafts (SHIPPED `5cb7c31`)

**SHIPPED 2026-07-16 (Railway deploy `f4274479` SUCCESS): candidate
matching is now reachable through the UI + draft requirements are discardable.** The actionable
Gate-B matcher (`POST /staffing/requirements/:id/matches/recalculate`) had no UI trigger and the
Talent Matching workspace was hidden, so a user couldn't get from a requirement to recalculated
matches. Now: a "Recalculate matches" button in the requirement drawer runs the matcher and renders
ranked candidates (score/dimensions/blockers) with Shortlist/Watch/Reject, sorted by score + a
hide-blocked toggle + an "add must-have skills first" hint; Talent Matching is in nav + Cmd-K
search; requirement `?id=` deep-links open the drawer; the signal "Create requirement draft" shows
an "Open requirement →" CTA; requirement rows show a matched-candidate count badge. Backend: a DRAFT
requirement with only undecided (algorithm-computed) matches + no submissions is now deletable,
cascading its match rows + snapshots (discard experimental drafts); non-draft/human-decided/submitted
still 409. **Live walkthrough proved it end-to-end**: seeded a disposable company+signal → qualified
→ free Find-POC (paid off, 0 contacts found, ≤2 cap honored) → promoted → **Recalculate produced 311
ranked matched candidates** → draft-cascade delete removed the requirement + all 311 matches → signal
+ company deleted. Zero console errors, zero Railway 5xx. No schema/migration/guardrail/env/pilot-flag
change. Minor follow-up: the requirement delete-dialog copy still says "no candidate matches" (stale
frontend text; backend now allows undecided matches).

## Prior task — signal-500 fix + manual delete + candidate max-detail (SHIPPED `3b1dd05`)

**SHIPPED 2026-07-16 (Railway deploy `0e45691d` SUCCESS): signal-detail
500 fix + manual-delete for every entity + candidate max-detail.** The tenant-wide 500 on
`GET /api/wizmatch/signals/:id` (drafts sub-query used `messages.created_at`; that table only has
`sent_at`) is fixed and verified live (200, no console/Railway 5xx). New manual-delete affordances:
Job Signals "Delete permanently" (existing backend, new UI); Hiring-contact/POC **hard** delete
(new `deleteCompanyContact` — relationship-only, keeps the CRM contact + history, blocks on active
attribution/submission/interview); company/candidate/discovered-contact delete surfaced
consistently. Candidate 360 now returns + renders submission history. Both residual
`PROD_SMOKE_WIZMATCH_20260715221717` records (signal + company) were deleted live via the new UI.
POC hard-delete UI/route is unit+e2e-tested and deployed but wasn't exercised live (production has
zero linked hiring contacts to click). No schema/migration/guardrail/env/pilot-flag change.

## Prior active task — entity-first UI/UX push

**Entity-first UI/UX + complete-build push is live (commit `2d8ddd6`, Railway deployment
`baec1d83`, `SUCCESS`) — a navigation/UX/safety-tooling release, not a pilot-scope change. The
Wizmatch results-first sourcing pilot task below is still the substantive product work in front of
Jatin/Kanishk; this push doesn't change what they need to do next.**

Work directly in `/Users/jatinagrawal/repo-comparison/v2` on `main` (now equal to `origin/main`).
The `v2-wizmatch-phase0-trust` worktree referenced below may be stale relative to `main` post-push —
re-verify its branch position before resuming work there.

## Prior active task (still relevant — pilot data review)

**Wizmatch results-first sourcing — provider release is live for the Jatin/Kanishk production
pilot. Review genuine signals and configure approved ATS boards; enable X-Ray only after the first
genuine accepted, skill-reviewed requirement exists.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Verified release candidate

- `c293b88` adds SearchAPI.io public research, shared POC/X-Ray allowance, provider-account status,
  real free TheirStack preview, hiring-team evidence, requirement-specific X-Ray queries and honest
  provider UI.
- `142eb51` handles free-credit account reporting, excludes up to 500 seen TheirStack job IDs before
  paid retrieval, and retries one transient SearchAPI timeout/429/5xx response.
- No schema or migration changed. No credential value entered Git, docs, `.ai`, screenshots or
  command output.
- Final local suite: TypeScript build; 47 files / 395 Vitest tests; admin production build; 22/22
  Wizmatch Playwright scenarios; `git diff --check` clean.

## Isolated staging evidence

- Deployment `d3b0e543-87db-4fe3-87e2-703bebcbc350` is `SUCCESS`; health/database are green.
- Supplied temporary credentials validate: TheirStack reports 200 credits; SearchAPI.io reports
  100 starting free credits. Values remain secret.
- TheirStack imported 29 public India target-role signals across two capped runs: all 29 have
  distinct provider IDs and matching SAP/Java/JavaScript/frontend title evidence. One provider
  repeat updated the existing row rather than creating a duplicate; the release now excludes seen
  IDs before retrieval.
- ATS refreshed 10 controlled Greenhouse jobs with no new duplicates or errors.
- POC research produced six named public candidates and correctly left them
  `identified_channel_pending`; no email/phone was guessed.
- Requirement-first X-Ray produced 10 requirement-linked leads. All 10 remain unreviewed and cannot
  enter canonical matching until a recruiter validates evidence.
- Authenticated live Signals UI passed desktop, tablet and 390px mobile with all provider cards,
  shared allowance, no horizontal overflow, no console errors and no 5xx responses.
- Legacy Wizmatch automation, sending, paid discovery and Google fallback remain off. No outreach,
  consent, submission or production business record was created.

## Production activation

- `05a5c5a` is live. Code deployment `5e8d1302-2c50-4a2b-b7b3-4f3e1e160023` and provider-flag
  deployment `8d68a585-5277-4be4-8e90-cc830e1b4036` both reached `SUCCESS`.
- Source master, TheirStack, ATS and POC discovery are active. SearchAPI/TheirStack accounts validate;
  X-Ray is configured but off. Legacy automation, sending, paid discovery and Google fallback are off.
- The first production TheirStack run fetched/inserted 15 genuine public target-role signals with no
  errors or duplicates. Their 15 provider IDs are distinct. ATS ran safely but polled zero companies
  because no production company has an approved ATS board yet.
- Production Signals UI passed desktop/tablet/390px with no overflow, console errors or 5xx. Health
  and database are green; sampled traffic had zero 5xx, p95 73 ms and healthy CPU/memory.

## Exact next action

Jatin/Kanishk review the 15 signals in Job Signals, qualify useful ones, run Find POC, verify a genuine
contact channel and promote only real demand. Configure ATS type/slug/board URL on approved Company
360 records. Once one genuine requirement is accepted and has reviewed mandatory skills, enable
`WIZMATCH_XRAY_CANDIDATE_ENABLED=true` and run one manual requirement-first search.

Never add users, enable pilot-all, sending, paid discovery, Google fallback, legacy automation,
automatic requirements, outreach, consent, shortlist or submission. Never delete production data.
