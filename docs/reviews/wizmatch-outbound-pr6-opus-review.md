# WizMatch Outbound OS — PR 6 (Decision Workbench) independent readiness review

- **Branch:** `ge/outbound-06-decision-workbench`
- **Parent:** `ge/outbound-05-lifecycle-consolidation`
- **Implementation commit reviewed:** `9b9c2c56`
- **Fix commits made during this review:** `e86704b3`, `c84681f5`, `69e68c19`, `c03bf442`
- **Reviewed at:** 2026-07-26T21:35:00Z
- **Method:** lead Opus session plus three read-only Explore subagents (backend/policy,
  frontend/accessibility, tests/finding-closure). Every subagent claim acted on was re-verified
  first-hand by the lead against the code, the PRD and — where behaviour was in question — a running
  Express harness. Nothing here rests on an unverified summary.

## Final verdict

**READY — after eleven fixes made during this review.**

As submitted at `9b9c2c56`, PR 6 was **NOT READY**. It contained one Critical defect that would have
taken the entire WizMatch API down in production on the next push to `main`, and nine High defects
spanning RBAC, data integrity, shadow-mode semantics, queue correctness and failure honesty. All are
fixed, each with a regression test that fails if the defect returns, and the full gate set is green.

No remaining Critical or High finding. Sixteen Medium and eight Low findings are recorded below and
carried forward; none blocks PR 7.

**A note on how this review went, because it matters for how much confidence to place in it.** The
first pass — lead session only — found and fixed two defects and concluded READY. The three
subagents' reports arrived after that conclusion and surfaced nine further defects, four of them
High, including an RBAC over-grant and a data-integrity bug that silently downgrades permanent
compliance blocks. The first conclusion was wrong. It is corrected here, and one of its findings
(M-C) was wrong on the merits and is retracted below.

The implementation marker's five self-reported gate results were re-run independently and all five
reproduced exactly on the as-submitted tree. The marker was accurate about what it ran. Every defect
below was invisible to those gates — which is the point of the review.

## Completeness against PR 6 scope

| PRD-005 requirement | Verdict |
|---|---|
| `GET /api/wizmatch/today/queues` (§12) | **Met** |
| `POST /api/wizmatch/today/actions`, per-target results (§12) | **Met after fix** |
| Four decision queues (§13) | **Met after fix** |
| §13 state precedence (blocked → duplicate → paused → needs_review → eligible) | **Met after fix** |
| §13 contextual actions | **Partial** — see M-2, M-3, M-4 |
| §13 approval capture (`approved_by`/`approved_at`) | **NOT MET** — see M-1 |
| Today page extended in place, no new route/nav entry (§13) | **Met** |
| `DataTable` selection props wired (A-9) | **Met** |
| WizMatch bulk-action bar built new (§13) | **Met** |
| A-8: delete the two dead pages | **Met** — zero importers across `admin/`, `src/`, `e2e/` |
| M-1 (PR 5) closure | **Met**, but it introduced the Critical defect — see C-1 |
| M-2 (PR 5) closure | **Met after fix** — see H-5 |
| No second eligibility engine | **Met after fix** — see H-2 |
| No PR 7 work | **Met** — independently confirmed by all three passes |

## Verdicts by area

| Area | Verdict |
|---|---|
| Backend | **PASS after fix** (C-1 was a production outage) |
| Tenancy | **PASS** — no cross-tenant read or mutation found by any pass |
| RBAC | **PASS after fix** (H-3 was a real over-grant) |
| Shadow / enforce | **PASS after fix** (H-2) |
| M-1 closure | **PASS** |
| M-2 closure | **PASS after fix** (H-5) |
| Bulk actions | **PASS after fix** (H-8) |
| Frontend & accessibility | **PASS after fix** (H-6…H-9), a11y gaps recorded |
| Feature flags | **PASS after fix** (C-1, H-7) |
| Test quality | **PASS after fix** — one test was a regression guard pointing the wrong way |

---

## Critical — fixed

### C-1 — Both flagged routers 404'd the entire `/api/wizmatch` prefix. **FIXED (`e86704b3`)**

`wizmatchPolicy.ts` and `wizmatchToday.ts` both gate their surface with `router.use(featureGate)`,
which matches **every** path under the mount, and that gate responded 404 inline. PR 6's M-1 fix moved
both routers ahead of `wizmatchRouter`. Together: whenever either flag was off, every `/api/wizmatch`
request not handled by `wizmatchStaffingRouter` was answered 404 before reaching `wizmatchRouter` —
**all 82 of its routes**. Both flags default to `false`; this repo auto-deploys on push to `main`.

Reproduced on an Express 5.2.1 harness with the real mount order. Both gates now call `next('router')`.
Nothing caught it because the mount-order test was a source-text guard and each router's route test
mounts it alone, where a terminal 404 is correct. `wizmatchIndexMountOrder.test.ts` now mounts the real
routers in the real order; reintroducing the inline 404 fails 2 of its 6 tests.

## High — all fixed

### H-1 — A team_lead could override a standard block, unevidenced. **FIXED (`c03bf442`)**

PRD-005 §4 is explicit: *"Write a policy row (approve/pause/block/reclassify)" → `team_lead`* but
*"Admin override of a `standard` block" → `admin`*. The two are distinguished by the **predecessor
state**, which the route cannot see — it only sees the action name. `writeCompanyPolicy` refuses only
non-overridable predecessors, so a team_lead could POST `approve_queue` against a blocked company and
take it to `eligible` with no evidence. The same endpoint was simultaneously telling the operator
*"This company is blocked by policy. Reclassify requires an admin."*

The action layer now reads the predecessor after its re-read and refuses per-target with
`requires_admin_override`. Three tests cover team_lead-refused, admin-allowed, and team_lead still
permitted on a non-blocked company.

**This retracts finding M-C from this review's first pass**, which read §12 and §13 as contradicting
each other and concluded no change was warranted. §4 resolves it cleanly; the endpoint was
under-gated, not the PRD inconsistent.

### H-2 — Shadow mode blocked work through the workbench. **FIXED (`c84681f5`)**

`buildTodayQueues` keyed queue placement, `requiresExplicitApproval` and `disabledReason` on the raw
`canonical.decision`, ignoring `canonical.actsOnDecision`. The gate ladder denies well past the policy
row (L5 duplicate, L6b company cold-email lock, L7 suppression), so a company can be
`outreach_eligibility='eligible'` **and** canonically denied. In shadow that company was hidden in
Paused or Blocked, action-disabled, offered "Reclassify" (which writes `needs_review` over a live
conversation), and rendered a self-contradictory card. §16 rule 2, G3 and D-31 forbid all four.

The module header argued a new endpoint carries no shadow obligation. That does not hold: §13 defines
the queues on the **stored policy row**, so canonical-first bucketing also diverged from the PRD. The
existing tests encoded the wrong behaviour — every fixture said `shadow`/`actsOnDecision: false` and
still asserted a blocked bucket.

Items now carry `effectiveDecision`; canonical metadata is still always attached, and the UI discloses
a divergence with a `shadow: would deny` badge.

### H-3 — Every action rebuilt the root policy row, dropping its protections. **FIXED (`c03bf442`)**

`base` carried forward only `externalHiringPolicy` and `relationshipType`. `writeCompanyPolicy` writes
the rest from input and defaults the remainder (`isPermanent: false`, `blockClass: 'standard'`), so a
company blocked `isPermanent=true`, `blockClass='compliance'`, with evidence, hit with **Set Review
Date** kept the block but silently lost its permanence, its taxonomy class and its evidence.
`isPermanent`, `blockClass` and the evidence quartet are now carried forward from the predecessor.

### H-4 — Contact confidence read the wrong metadata level. **FIXED (`c03bf442`)**

`deriveConfidenceTier` reads `confidenceTier` off `metadata.raw` — where the discovery cascade writes
it and what the canonical reader passes. The workbench passed `metadata` itself, so the stored tier was
never found and every row fell through to the numeric threshold. This diverged in both directions: a
cascade-graded `high` scoring 6 became `medium` (company wrongly dropped from Ready to Contact), and a
row written on a 0-100 scale scoring 60 became `high` — **a low-confidence contact entering Ready to
Contact, defeating §7's cold-start gate**. The module comment claimed the tier was "reused, not
re-derived". Two tests now pin both directions.

### H-5 — A null `companyId` failed OPEN in the plural fold. **FIXED (`c03bf442`)**

`applyCanonicalEligibilityToPriorityResults` returned any `companyId === null` result completely
untouched — no canonical fields at all. The Command Center's requirement fetcher LEFT JOINs companies,
so PR 6's new requirements fold routed masked-client requirements (`company_id IS NULL`) down that
path: the same row answered `deny`/`missing_company` from `/requirement-priority/queue` and an
unqualified `hot` from `/command-center`. The adapter's own H-2 header already promises the
fail-closed reading, and the sibling caller implements it.

The fold now applies the same rule — display-only in shadow, behavioural under `enforce`. **The test
that pinned the old behaviour was a regression guard pointing the wrong way** (`expect(canonicalDecision).toBeUndefined()`);
it is flipped, with both shadow and enforce cases covered.

### H-6 — Pending duplicates never reached Needs Review. **FIXED (`c03bf442`)**

A pending duplicate is itself a gate-L5 deny, so under `enforce` `duplicatePending ⟹ deny` and the
duplicate branch was unreachable: duplicates were filed under Paused or Blocked with a block
affordance instead of Needs Review with Merge / Confirm Separate. The existing test was green only
because it mocked `decision: 'allow'` alongside a pending duplicate — a state the real gate cannot
produce. Bucketing now follows §13's precedence: blocked → duplicate → paused → needs_review →
eligible.

### H-7 — A switched-off feature presented as a permanent error screen. **FIXED (`69e68c19`)**

A build with the UI flag on against a backend with the flag off rendered `ErrorRetry` showing the raw
string `not_found`, with a Retry that re-issued the same 404 forever and no fall-back. That is the
**default local state** (`import.meta.env.DEV` forces the UI flag true while the backend defaults off)
and a likely production ordering, since the frontend rebuilds on push while the Railway variable is
set by hand afterwards. Directly violates this review's own criterion 7. `apiFetch` now attaches
`error.status` (additive; nothing else reads it) and the workbench renders an explicit "not enabled on
this environment" state.

### H-8 — Committed writes reported as failures, with no refetch. **FIXED (`69e68c19`)**

`outcome.results.filter` was unguarded on the write path. A malformed 200 threw inside the `try`, so
the catch reported "Action failed" while `setDialog(null)` and `load()` were both skipped: writes
already committed server-side, reported as a failure, dialog left open inviting a re-submit — with no
idempotency behind it — and queues never refreshed. Guarded, with close and refetch moved into
`finally`.

### H-9 — Malformed API data crashed or faked the whole workbench. **FIXED (`69e68c19`)**

`apiFetch` returns `await res.json().catch(() => null)`, so a 200 with an empty or non-JSON body
yields `null`. `setQueues(null)` then threw on the first property read and dropped the page into the
App error boundary. A wrong-shaped 200 was worse: it rendered as a confident "nothing needs a
decision", indistinguishable from a genuinely empty queue. Now shape-checked with an explicit error.

### H-10 — Unbounded resolver fan-out could time out unrelated requests. **FIXED (`c03bf442`)**

`resolveCanonicalCompanyEligibilityBatch` mapped every company through an unbounded `Promise.all`, each
call costing two to three queries, with callers passing up to 500 ids — roughly 1,500 concurrent
queries against a pool of `max: 20` with a 2s `connectionTimeoutMillis`. One operator's page load could
time out unrelated API requests. Concurrency is now capped at 10.

### H-11 — A failed replies query presented as "no replies waiting". **FIXED (`c03bf442`)**

A bare `catch {}` swallowed any failure of the Replies Needing Action query, producing
`repliesNeedingAction: []` and `counts.repliesNeedingAction: 0` with no log and no signal — on the one
queue that holds company locks (§10.6.1), where an unreported empty is the most dangerous possible lie.
Now reported via `partial.repliesUnavailable`, logged, and surfaced in the UI as an explicit warning.
Queue truncation past `limit` was equally silent and is now `partial.truncated`, also surfaced.

---

## Medium — recorded, not fixed

Each either needs an owner decision, exceeds PR 6 fix authority, or is a shared-component change whose
blast radius is wider than this PR.

- **M-1 — §13 approval capture is NOT implemented.** `approve_queue` writes `outreachEligibility:
  'eligible'`; `approvedBy`/`approvedAt` appear nowhere in `policyService.ts` or `outreachGate.ts`. PR 6
  substitutes a permanent policy reclassification for the scoped, recorded approval §8.6/§10.5 require —
  laundering `review → allow` for all future outreach and recording neither. Not in the marker's
  disclosed-limits list. **The most significant open gap.**
- **M-2 — §13 "Approve & Queue disabled with an inline reason" is half-implemented.** The reason renders
  as adjacent text while the button stays enabled, and `allowedCampaignTypes` is never computed at all,
  despite `campaignCompatibility.ts` existing and being usable.
- **M-3 — §13 "paused past `review_date` → Needs Review" is not implemented.** `reviewDate` is selected
  and carried but never compared to now, so a paused company whose review date lapsed never resurfaces —
  the queue's entire purpose. Undisclosed.
- **M-4 — §13's `routed` row is absent entirely.** No "Open Route" primary for `msp_vms_only` /
  `preferred_vendors_only` / `existing_client`; `relationshipType` is fetched and never read.
  Undisclosed.
- **M-5 — `StatusBadge` was not extended.** The workbench passes `allow`/`review`/`deny`, none of which
  exist in `STATUS_TONE`, so all fall back to `muted` — a denied company renders a neutral grey badge.
  §13 explicitly asks for the map to be extended.
- **M-6 — pilot roster not enforced on the new surface.** §4 scopes "read queues" to pilot member via
  `WIZMATCH_STAFFING_PILOT_USER_IDS`, "fails closed when absent". `requireStaffingPilot` is path-scoped
  to `/staffing/*` and does not match `/today/*`, so any in-tenant `staff`/`sales`/`manager_ops`/`viewer`
  can read the workbench. Inherited from PR 4; PR 6 extends it to a new surface.
- **M-7 — `isNonOverridable`/`blockClass` are read from the `entire_company` row only.** A
  non-overridable block at a narrower scope (gate L1c) renders as `isNonOverridable: false`, so the UI
  offers the Reclassify affordance §13 forbids "at any scope". The gate still denies, so this is a
  contract defect, not a bypass.
- **M-8 — `reasonCode` is never validated against the taxonomy, and `isPreparationAllowed` fails open.**
  A typo'd reason code on a block yields `preparationAllowed: true`. Medium only because §14 preparation
  is not built; PR 7 consumes it.
- **M-9 — error messages leak internals.** `messageAndCodeFor` falls through to `error.message` for any
  `Error`, returned verbatim, so Postgres constraint/FK/column names can reach a team_lead client.
- **M-10 — `skip` is a permanent downgrade.** It writes a superseding root row to `needs_review`,
  turning "not today" into a policy change with history, where the PRD asks for a transient.
- **M-11 — no idempotency on repeated company actions.** A double submit writes two superseding rows.
  Duplicates are protected; companies are not.
- **M-12 — no stale-state precondition.** Only structural protection exists (non-overridable refusal,
  `WHERE resolution='pending'`). A company that moved `needs_review → blocked` between page load and
  submit has no version/`updatedAt` check — now mitigated by H-1's predecessor gate, not eliminated.
- **M-13 — `set_review_date` can change eligibility.** It writes `root.outreachEligibility ??
  'needs_review'`, so a null eligibility silently flips to `needs_review`.
- **M-14 — dialog accessibility gaps.** The focus trap does not exclude `[disabled]`, so Shift+Tab from
  the first field targets a disabled Confirm and focus does not move; focus escapes entirely after a
  backdrop click; the background is not `inert`, so a screen reader reads past the modal; the
  blocked-submit reason lives only in `title` on a non-focusable disabled button. All live in
  `useDialogA11y`, shared by six dialogs — cross-cutting, out of PR 6 fix authority.
- **M-15 — `DataTable` clips instead of scrolling.** `overflow-hidden` on the wrapper with an auto-layout
  table means a long unbroken domain or scope key is unreachable below ~768px. Shared component.
- **M-16 — bulk bar is not role-aware and offers actions the per-row UI refuses.** It renders for any
  role (server correctly 403s), and offers `resume` for non-overridable rows the same page labels "No
  action available". Materially mitigated by the new persistent failure panel, not eliminated.

## Low

- **L-1** — three identically-labelled "Select all rows" checkboxes across three tables; tables have no
  accessible name; queue counts are not in a live region.
- **L-2** — `ReplyRow` calls `item.state.replaceAll(...)` unguarded.
- **L-3** — `/today/queues?limit=` bounds companies and replies with one shared value.
- **L-4** — the a11y spec runs axe **before** the dialog opens, so the dialog itself is never scanned.
- **L-5** — the Playwright suite is not in `.github/workflows/ci.yml` and there is no `test:e2e` script;
  it is manual-only.
- **L-6** — dead permission flag: `wizmatchDecisionWorkbenchEnabled` is declared and populated but no
  route definition consumes it.
- **L-7** — bulk-bar buttons are ~25px tall, at the WCAG 2.2 §2.5.8 24px boundary.
- **L-8** — free-text `reasonCode` input defeats the backend's structured per-action defaults.

## Test-quality findings

- `decisionWorkbench.test.ts`'s `makeChain` mock discards `where`/`orderBy`/`limit`, so tenancy rests on
  a source-level regex guard whose `/await db\s*\n\s*\.select\(/` split would miss a single-line query.
- The duplicate-bucketing test was green on a state the real gate cannot produce (H-6).
- The null-`companyId` test asserted the defect as correct behaviour (H-5).
- `fetchPendingDuplicateIdByCompany` issues two queries; the mock returns the same fixture for both, so
  deleting the second entirely is undetectable.
- **No test exercises `fetchCommandCenterRequirements`** — deleting `r.company_id` from its SELECT
  reverts M-2 and ships green.
- **Five of six policy write routes have no role test.** Only `POST /companies/bulk/policy` is covered.
  This matters more post-M-1: `wizmatchRequireAdmin` used to sit in front as a redundant outer gate, so
  the per-route middleware is now the sole defence and deleting any one argument is a live staff-write
  escalation that passes CI.

## Fixes made during this review

| Commit | Findings | Area |
|---|---|---|
| `e86704b3` | C-1 | routing / feature gates |
| `c84681f5` | H-2 | shadow-mode semantics |
| `69e68c19` | H-7, H-8, H-9 + failure-panel | frontend honesty |
| `c03bf442` | H-1, H-3, H-4, H-5, H-6, H-10, H-11 | backend policy / actions / adapter |

No guardrail file, no schema or migration, no dependency, no new source file.

## Gates (post-fix tree)

| Gate | Result |
|---|---|
| `git diff --check` | clean (exit 0) |
| `npm run build` | exit 0 |
| `npm test` | **117 files / 1081 tests passed** (was 117/1064) |
| `npm run admin:build` | clean |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **99 passed / 15 skipped / 0 failed** (was 97/15/0) |

The 15 skips are the pre-existing real-backend specs that skip without `WIZMATCH_E2E_TEST_PASSWORD`.
No other skip. All five gates were also run on the as-submitted `9b9c2c56` tree and reproduced the
marker's claimed results exactly.

## Remaining blockers before PR 7

**None.** PR 7 may proceed.

## Remaining blockers before G1 / G4 / production

- **B-1 — migration `0037` must be applied before this stack reaches `main`.** The repo auto-deploys on
  push. Still unapplied.
- **G1** — the §10.11.4 fresh-database checks have not been run; no database access in this session.
- **M-1 (approval capture)** — the largest functional gap. `approve_queue` currently launders a
  `review` decision into a permanent `eligible` policy row with no `approved_by`/`approved_at`. Close
  before the workbench is used for real decisions.
- **M-2, M-3, M-4, M-5** — the difference between the queues §13 specifies and the queues that ship.
- **M-6 (pilot roster)** — the new surface is readable by any in-tenant staff role.
- **The two test gaps above** — no coverage of the requirement fetcher's SELECT, and five of six policy
  write routes have no role test.
- **G4** — promoting `shadow` → `enforce` remains an owner decision. H-2's fix makes the delta
  observable in advance through the `shadow: would deny` badge.

## Could not verify

No database and no Railway or production access: whether `0037` is applied anywhere, the G1
fresh-database checks, and queue behaviour at real volume. C-1's blast radius is established from
Express routing semantics and a reproduction harness, not from an observed production request.

## Safety

Nothing pushed, merged or deployed. No Railway or production access. No database mutation. Migration
`0037` not applied. Backfill `--apply` not run. `WIZMATCH_POLICY_ENFORCEMENT_MODE` untouched
(`shadow`). Sending and paid-discovery kill-switches untouched. Smartlead not connected. No shared
environment variable changed. PR 7 not started.
