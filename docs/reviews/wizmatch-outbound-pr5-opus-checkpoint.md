# WizMatch Outbound OS — PR 4 + PR 5 independent Opus checkpoint review

**Date:** 2026-07-26
**Branch:** `ge/outbound-05-lifecycle-consolidation`
**Range reviewed:** `ge/outbound-03-policy-enforcement..ge/outbound-05-lifecycle-consolidation`
**Implementation HEAD reviewed:** `7777c455`
**Method:** three parallel read-only Explore subagents (security/RBAC/tenancy/policy; state-machine/idempotency/bypass; UI/worker/test-quality), every load-bearing finding re-verified by hand by the lead reviewer before inclusion.

## Verdict: **NOT READY — fix-then-re-review**

Two Critical defects. One of them (**C-2**) is fixed in this review pass with a control run; the
other (**C-1**) is a genuine owner decision and is **not** fixed here. `.ai/OUTBOUND_PR5_CODE_READY`
is deliberately **not** created.

The headline: **PR 5 blocks in shadow mode.** PRD-005 §16 rule 2 says shadow "blocks nothing", and
gate G3 requires "zero behavioural change confirmed post-deploy". PR 5's compatibility adapter
resolves the canonical policy decision and acts on it **without ever consulting
`shouldBlock`/`WIZMATCH_POLICY_ENFORCEMENT_MODE`**, and two of its call sites are real write blocks
(HTTP 409), not display. With the shipped defaults this takes effect on merge.

Separately, **C-2** meant no policy could be changed at all: `writeCompanyPolicy` inserted the new
active row *before* superseding its predecessor, violating the non-deferrable partial unique index.
The entire PR 4 write path — including every admin override — would have failed against a real
database on first use. It passed CI only because the test mock enforced no constraints.

---

## Gates (run by the lead reviewer on the post-fix tree)

| Gate | Before fixes (`7777c455`) | After fixes |
|---|---|---|
| `git diff --check` | clean | clean |
| `npm run build` | exit 0 | exit 0 |
| `npm test` | 109 files / 966 tests | **110 files / 970 tests** |
| `npm run admin:build` | clean | clean |
| Playwright `wizmatch-local` (full) | 97 passed / 15 skipped / 0 failed | 97 passed / 15 skipped / 0 failed |

The self-reported gate figures in `.ai/OUTBOUND_PR4_IMPLEMENTED` and `.ai/CURRENT_TASK.md` were
independently reproduced and are accurate.

## Boundary and contamination checks — all PASS

Verified against the actual changed-file list, not against the markers:

- **No guardrail file touched**: `src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`,
  `src/middleware/rbac.ts`, `src/routes/cashfree.ts`, `src/services/sodEodService.ts` are all absent
  from the diff. `wizmatchPolicy.ts` *imports* `requireRole` — consumption, not modification.
- **No `package-lock.json`**, no Growth/SEO/n8n files, no legacy-outreach code
  (`wizmatchOutreachService.ts`, Saleshandy, `sequence_step`). Every grep hit for those terms is
  prose inside `.ai/*` / `docs/handoffs/*` marker files, never code.
- **`package.json`**: exactly two added lines, both inside `"scripts"`. No dependency added.
- **No send or paid-provider capability enabled.** `WIZMATCH_SENDING_ENABLED`,
  `AUTOMATED_EMAILS_ENABLED`, `WIZMATCH_PAID_DISCOVERY_ENABLED`,
  `WIZMATCH_POLICY_ENFORCEMENT_MODE` appear only as prose in marker files. No mailer/transport call,
  no provider client, no default flipped.
- **No production action occurred**: migration 0037 not applied, backfill `--apply` not run, nothing
  pushed/merged/deployed, no Railway or production access, Smartlead not connected.

---

## Critical

### C-1 — PR 5 enforces in `shadow` mode; §16 rule 2 and gate G3 are both violated *(NOT fixed — owner decision)*

`src/modules/outreach/legacyEligibilityAdapter.ts:53-65`, consumed at
`src/services/wizmatchClientDiscovery.ts`, `wizmatchRequirementPriority.ts`,
`wizmatchCommandCenter.ts`, `wizmatchContactIntelligenceRepo.ts`, `src/routes/wizmatch.ts:1038,1412`.

`resolveCanonicalCompanyEligibility` calls `resolveCompanyStatus`, which returns the raw ladder
decision and **ignores `enforcementMode` entirely**. The mode gate is `shouldBlock`
(`outreachGate.ts:494-508`), and the adapter never calls it. Every PR 3 call site routes through
`shouldBlock`; PR 5 routes around it.

Verified by the lead reviewer: `resolveCompanyStatus` (`outreachGate.ts:536-539`) returns
`{ decision, reasonCode }` with no mode consultation, and no call path from the adapter reaches
`shouldBlock`.

These are real side effects, not display:

- `POST /client-discovery/companies/:companyId/send-to-contact-intelligence` — now 409s when the
  canonical decision denies (`routes/wizmatch.ts:1038-1045`).
- `POST /requirement-priority/:requirementId/review-plan` — **new in this PR**, 409s on
  `priority === 'blocked'` (`routes/wizmatch.ts:1412-1420`).
- `GET /client-discovery/queue`, `GET /requirement-priority/queue` — items become `blocked`.
- `persistContactIntelligenceSnapshot` writes the derived status into the table.

None of these is gated by `WIZMATCH_COMPANY_POLICY_ENABLED` either — that flag covers only the
policy write API. So while it is off (the default), an operator **cannot create the root policy row
that would unblock the company**.

**Failure scenario, all flags at documented defaults:** migration 0037 unapplied → the policies
table does not exist → `fetchActivePolicyRows` throws → the gate's catch-all returns
`deny/policy_resolver_error` → every company denies. Even after 0037 is applied, every company
without a backfilled root row returns `deny/policy_missing_root` (backfill `--apply` has not been
run). The client-discovery and requirement-priority surfaces go dark on deploy, in the mode
specified to change nothing.

**Spec:** PRD-005 §16 rule 2 ("Shadow logs the decision and, for a would-block, writes a
`gate_denied` observation. **It blocks nothing.**"); §22 gate G3 ("Deploy shadow enforcement — PR 3
merged; **zero behavioural change confirmed post-deploy**"); §21.2, whose G4 preconditions are
measured by a readiness report that this change makes structurally meaningless.

**Why this is an owner decision and not a unilateral fix.** There are two defensible readings and
they produce different products:

- **(A) Adapter respects `shouldBlock`.** Shadow becomes a true no-op, §16/G3 hold, and the PR 5
  consolidation stays inert until G4. Spec-faithful; defers the "surfaces agree" benefit.
- **(B) Display-layer folding is intentionally immediate** (the adapter's own docstring says
  "applied here at the display layer too") and §16 rule 2 governs only the send/enrol gate. Under
  this reading the two **409 write blocks** are still defects and must be mode-gated regardless.

Both readings agree the two 409s are wrong; they disagree on the ranking/display fold. That choice
belongs to the owner. **Recommendation: (A)** — it is what §16 and G3 literally say, and it keeps
the readiness report meaningful, which is the only instrument for deciding G4.

### C-2 — `writeCompanyPolicy` inserted before superseding, so no policy could ever be changed *(FIXED in this pass)*

`src/modules/outreach/policyService.ts`.

`wizmatch_company_policies_active_scope_uniq` is a **partial unique INDEX** on
`(tenant_id, company_id, scope_key) WHERE superseded_at IS NULL`
(`0037_unknown_siren.sql:258`, `schema.ts:2491`). A unique index is non-deferrable — Postgres
enforces it per statement, not at COMMIT. The predecessor was still active when the new row was
inserted, so every supersession raised `23505` and rolled the transaction back.

**Failure scenario:** company X has the bootstrapped root row. A team lead POSTs any policy change →
`duplicate key value violates unique constraint "wizmatch_company_policies_active_scope_uniq"` →
500 `internal_error`. Every policy write, and `writeCompanyPolicyOverride` with it, was dead on
arrival. The admin override path — the only escape hatch from a non-overridable block — was
included.

**Why CI was green:** the test mock (`wizmatchPolicyService.test.ts`) enforced no uniqueness, so it
accepted an ordering that cannot work against a real database. This is the same class as the PR 2
review's FK-ordering Critical: a schema invariant that only a real database (or a mock that models
it) can catch.

**Fix applied:** pre-generate the new policy id, supersede the predecessor **first** (single UPDATE
touching only `superseded_at`/`superseded_by_policy_id`, the two columns the immutability trigger
permits), then insert with the explicit id. Same transaction, same audit-event guarantee.

**Control run:** the mock now enforces the real partial unique index. Reverting the fix produces
`FAIL … duplicate key value violates unique constraint "wizmatch_company_policies_active_scope_uniq"`
on the supersession test. The test could not previously fail — it never asserted that supersession
happened at all (see H-12).

---

## High

| ID | File | Defect | Status |
|---|---|---|---|
| **H-1** | `routes/wizmatchPolicy.ts` | `POST /companies/bulk/policy` was registered *after* `POST /companies/:id/policy`; Express matched the parameterised route with `id='bulk'`, so the PRD-mandated **admin-only** bulk endpoint never ran and the `team_lead` gate fired instead. Confirmed empirically against the repo's own Express 5.2.1. | **FIXED** |
| **H-2** | `wizmatchRequirementPriority.ts:250` | `if (!input.companyId) return scored;` — fails **open** where the canonical resolver denies (`outreachGate.ts:269-271`). `wizmatch_requirements.company_id` is nullable (the documented masked-client case). `wizmatchClientDiscovery.ts` guards this; requirement-priority does not. | open |
| **H-3** | `legacyEligibilityAdapter.ts:146` | The canonical REVIEW branch for contact intelligence is **dead code** — it keys on `companyStatus === 'ready_for_discovery'`, which `statusForTier` never produces. Verified: the literal appears only in the type union, two SQL `IN` lists reading pre-existing rows, this branch, and the test that hand-injects it. A company needing human review is presented and persisted as fully qualified. | open |
| **H-4** | `legacyEligibilityAdapter.ts:94-106` | The fold-in rewrites `priority` but not `nextAction`, breaking the `priority==='blocked' ⟺ nextAction==='blocked'` invariant the old code held by construction. `wizmatchReviewWorkbench.ts:165` derives `allowed` from `nextAction`, so a canonically-DENIED company renders "Resolve client blocker" **and** an enabled POST button. `score` is likewise left stale. This is the PR 2/PR 3 pattern: the gate reports the block while permitting the state it exists to prevent. | open |
| **H-5** | `wizmatchContactIntelligenceRepo.ts:752` | Deleting the write-time status-freeze `CASE` is more permissive, not less: a human `reject_company` decision is reverted to `qualified` on the next snapshot, and PR 5 writes no policy row in its place. D-1 says legacy writers stay live during transition; this made one ineffective with no canonical replacement. | open |
| **H-6** | `wizmatchCandidateIntelligence.ts:3-9` | The fifth caller's scope-out is **disclosed but wrong**. Its stated reason ("carries no `companyId`") is falsified by this same PR, which adds `companyId` to the file's input type and populates it from `r.company_id`. The guard test then launders the false claim into a permanent allowlist entry. | open |
| **H-7** | `wizmatchLegacyEligibilityAdapter.test.ts:26-41` | The mock uses a bare `where: () => …`, discarding every predicate — tenant scoping, `company_id`, `isNull(supersededAt)`, `resolution='pending'`, the lowercased suppression match are all untested. Its own header claims it reuses the *fixed* idiom from `wizmatchOutreachGateContract.test.ts`; it reuses the broken one. This is PR 3's M-5/L-6, regressed. | open |
| **H-8** | `policyService.ts:94-149` | No enum validation on `outreachEligibility` (or `externalHiringPolicy`/`relationshipType`/`blockClass`/`evidenceKind`), and no DB CHECK on the column. An out-of-vocabulary value fails **open**: every gate comparison is literal equality, there is no `else → deny`, so `'Blocked'` reaches the terminal `allow`. Note the asymmetry — unknown hiring-policy/relationship values fail *closed* via a throw; only eligibility fails open. | open |
| **H-9** | `policyService.ts:269,298` | `evidence_url` is persisted verbatim. PRD-005 §10.1 specifies it as "**SSRF-scrubbed via existing `normalizeDomain()`**" and §18.2 lists the scrub as a control shipping in this PR. `normalizeDomain` exists and is never imported. | open |
| **H-10** | `policyService.ts:140-145` | The signal/requirement ↔ **company** agreement invariant is not implemented. §10.1 explicitly designates it "a service-layer invariant with its own test (§20.1), not an FK", because no FK can enforce it. Result: a scoped block written against the wrong company is accepted, shown in the UI as blocked, and never applies. Fails open, silently, with a green UI. | open |
| **H-11** | `WizmatchDuplicateReviewPage.jsx` | **The PR 4 marker's claim is false.** It states both UI surfaces are behind the flag ("API 404s, UI renders null"); the Duplicate Companies page has no flag import, its nav entry is `searchVisible: true`, and its route is mounted unconditionally. Verified: `companyPolicyFlag` is imported only by `CompanyPolicySection.jsx`. With the flag off, the nav entry is visible in production and the page renders a permanent error panel. | open |
| **H-12** | `wizmatchPolicyService.test.ts:253` | The test named "supersedes the prior active row … links it via `supersededByPolicyId`" **never asserted either**. Deleting the whole supersession UPDATE left the suite green. | **FIXED** |
| **H-13** | `wizmatchLegacyEligibilityAdapter.test.ts:209` | "requirement priority caps a locally-hot result to watch" is vacuous — the fixture scores 63/100, already `watch` before any policy applies, so the REVIEW branch is never entered. The test name is also factually wrong. | open |
| **H-14** | `duplicateService.ts:105-115` | `resolveDuplicate` accepts `reasonCode` and `evidence`, then discards both, and writes **no** audit or event row — for the decision that lifts L5 duplicate containment on two companies. The UI demands a mandatory justification and throws it away. §12 requires these routes be audited; `assignAccountOwner` in the same PR does it correctly. | open |

## Medium (summary)

`policyService.ts` evidence checks pass on whitespace-only values and never validate `evidenceKind`,
and the admin-override path writes `evidence_kind = NULL` for a standard block (ADR-006 D-7/D-18) ·
`resolveDuplicate` is a read-modify-write with no transaction and no `resolution='pending'` predicate
on the UPDATE, so two reviewers racing both succeed (the PR 3 `suppress()` defect class) ·
the `/api/wizmatch` mount at `index.ts:330` runs `wizmatchRequireAdmin` as prefix middleware and
terminates before the policy router, so §4's "read policy → staff+" is not delivered and the
router's own header comment asserts the opposite (fails **closed**, no escalation) ·
`isPreparationAllowed` returns `true` for any unrecognised reason code, and `reasonCode` is an
unvalidated free-form string, so a typo on a compliance block silently re-enables free preparation ·
`wizmatchCommandCenter.test.ts` stubs the new fold to an identity function, removing coverage rather
than adding it · the command-center **requirements** queue is unfolded (its fetcher does not even
select `company_id`), so one response contradicts itself · `qualificationTier` is not folded, so a
denied company still yields an `allowed: true` approve-contact action · the UI flag is a differently
named build-time Vite variable forced on in dev, so local dev shows a permanently red panel and a
production flag flip does not reveal the UI · the "shadow would-have-blocked" number is disclosed as
a snapshot proxy **only in a source comment**, while every sibling metric carries an in-band
`unavailable: true` · `CompanyPolicySection`'s crash fix is half complete (`= []` defaults do not
fire on JSON `null`; four unguarded dereferences remain) · the two named cross-tenant tests cannot
fail (both arrange states where the mock returns `[]` for any predicate) · `listCompaniesByPolicy`
has no consumer anywhere · the guard test is real but narrow (a differently-ordered union, a new
computation inside an allowlisted file, or anything outside `src/` escapes it; its "must import the
adapter" assertion is a substring a comment satisfies) · the batch adapter is an uncapped per-company
fan-out (~200 concurrent queries on `/command-center?limit=75` against a 20-connection pool).

## Low (summary)

Backfill tolerance guard compares a count to a re-read taken three lines later in the same run, so it
can essentially never fire, and a non-numeric `WIZMATCH_BACKFILL_TOLERANCE` yields `NaN` which
disables it · non-UUID scope refs surface as 500 rather than 400 · `listDuplicates` fetches every
company in the tenant · `bulkWriteCompanyPolicy` echoes raw driver error text · `contactsReviewed`
counts every status other than `needs_review` · empty tenant reports 100% coverage and passes G4
condition 4 vacuously, and a test locks that in as intended · `selectCompaniesForContactIntelligenceWithPolicy`
is a pure no-op alias whose name implies a check it does not perform · `.ai/OUTBOUND_PR5_IMPLEMENTED`
is four lines and carries none of the evidence its PR 4 sibling carries, for the commit that actually
changes runtime behaviour.

---

## What was verified clean

- **Tenancy is genuinely sound.** Every read and write in `policyService.ts`, `duplicateService.ts`
  and `policyReadiness.ts` carries `eq(tenantId, …)`; `actorFrom(req)` derives the tenant only from
  `req.user.tenantId`, never from the body. Cross-tenant bulk writes are blocked at the database by
  the composite FK `(tenant_id, company_id) → wizmatch_companies(tenant_id, id)`.
- **Feature flag on the API side is correct and strict.** `featureGate` is a `router.use` above every
  route, returns 404 before any DB access, is read per-request, and uses `!== 'true'` so unset,
  empty, `'TRUE'` and `'1'` all fail safe. It covers all nine endpoints.
- **The policy write is a real single transaction** — all statements use `tx`, not `db`. PR 3's
  `suppress()` two-autocommit defect is *not* repeated. The supersession UPDATE touches only the two
  columns the immutability trigger permits.
- **Non-overridable blocks cannot be evaded**, including at a narrower scope: L1c scans all
  applicable rows, not just the winner.
- **No PR 3 suppression regression.** `outreachGate.ts` is not in the diff; the lowercase matching,
  single-transaction `suppress()`, and `hard_bounce` grain separation fixes are all intact.
- **No secrets or PII** anywhere in the range; the readiness report emits counts and a tenant UUID
  only.
- **Backfill is safe by default** — no write without `--apply`, `ON CONFLICT DO NOTHING` arbitrating
  on the real partial index, one transaction, tenant-scoped throughout.
- **The equivalence harness is not a tautology.** Unlike PR 3's, it compares the adapter to the
  *real* resolver chain with only `db` stubbed. Its weakness is the fixture (H-7/H-13), not
  self-comparison.
- **ADR-006 D-13 is correctly enforced** in the read path and the write path; no remaining reader
  treats `wizmatch_company_intelligence.status` as authoritative for an outreach decision.
- **A canonical DENY can never be upgraded to an allow** by any fold function, and blocker codes are
  append-idempotent.
- **UI tenant scoping is clean** — Wizmatch routes are stamped `product: 'wizmatch'` and cannot leak
  into the Growth CRM nav or Cmd-K.

## Could not verify

- **No database access**, so C-2's unique violation is proven from the index definition, the
  statement order and Postgres semantics plus a mock that models the constraint — not from an
  observed production error. The §10.11.4 fresh-database checks remain outstanding (G1).
- Migration 0037's applied state anywhere; the live count of companies lacking a root policy row
  (C-1's blast radius) and of requirements with `company_id IS NULL` (H-2's frequency).
- Runtime cost of the readiness report's per-company gate loop and the batch adapter's fan-out.
- **PRD-005 has no §22.4 / §22.5.** Acceptance criteria exist for PR 2 (§22.2) and PR 3 (§22.3) and
  then stop. PR 4 and PR 5 were assessed against §4, §8, §10.1, §11.3, §12, §16, §18.2, §21.1 and
  §5.2 C-2 instead. Whether the missing sections were meant to be authored is an owner question.

---

## Changes made by this review

Two commits' worth of change, both inside PR 4's already-implemented boundary, both spec-mandated,
neither requiring an owner decision, both with a control run:

1. `src/modules/outreach/policyService.ts` — supersede-before-insert (C-2).
2. `src/routes/wizmatchPolicy.ts` — `/companies/bulk/policy` registered above `/companies/:id/policy` (H-1).
3. `src/__tests__/wizmatchPolicyService.test.ts` — mock now enforces the partial unique index;
   supersession test now asserts `supersededAt`, `supersededByPolicyId` and the one-active-row
   invariant (H-12).
4. `src/__tests__/wizmatchPolicyRoutes.test.ts` (new) — route-level contract against a real Express
   app: path precedence, which role gate actually fires, and flag-off 404s.

Control runs, both reproduced:

- Reverting C-2 → supersession test fails with the exact `23505` unique-constraint violation.
- Reverting H-1 → the bulk-handler test fails and the role-gate assertion shows `['admin','team_lead']`
  firing instead of `['admin']`.

## Required before PR 5 can be called ready

1. **Owner decision on C-1** (recommend option A), then implement it. This is the blocker.
2. Fix H-2 … H-11, H-13, H-14. H-9 and H-10 are explicitly named in the PRD as controls shipping in
   this PR and are simply absent; H-3, H-4, H-6, H-7 and H-11 each falsify a claim the code or its
   marker makes about itself.
3. Re-verify the PR 4 marker's flag-gating claim after H-11 is fixed, and give PR 5 a marker with the
   evidence its PR 4 sibling carries.
4. Carried forward, still open and untouched by this range: **U-13** (`resolveWizmatchLinkage`
   arbitrary-company fail-open), **U-14** (bulk-email/export per-row gating), U-10, U-12, L-7…L-13
   from the PR 3 review; **B-1** (0037 must be applied before this stack reaches `main` — the repo
   auto-deploys on push); U-7, U-8, U-9, O-1.

**Do not merge, deploy, apply 0037, run backfill `--apply`, or promote `enforce` on the strength of
this review.**
