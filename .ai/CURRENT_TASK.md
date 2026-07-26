# CURRENT_TASK.md

## Active task

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
