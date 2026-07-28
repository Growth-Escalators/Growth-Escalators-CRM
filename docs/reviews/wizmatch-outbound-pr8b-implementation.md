# WizMatch Outbound OS — PR 8B implementation (G3 pilot completion)

- **Branch:** `ge/outbound-08b-g3-pilot-completion` · **Parent:** `ge/outbound-08a-live-pilot-hardening`
  (independently reviewed, CODE READY at `f12c62ca`, marker `.ai/OUTBOUND_PR8A_CODE_READY`)
- **Parent HEAD at branch start:** `64e34a6a` (docs-only commit after the reviewed `f12c62ca`)
- **Implemented:** 2026-07-27, this session. Marker: `.ai/OUTBOUND_PR8B_IMPLEMENTED` (self-reported —
  an independent Opus review, per standing practice on this stack, owns `.ai/OUTBOUND_PR8B_CODE_READY`).
- **Method:** three read-only Stage A Explore subagents in parallel (policy/signal-scope, pilot-gate/RBAC,
  workbench frontend/capabilities, readiness/credential-safety, test/finding-matrix — five agents total,
  one more than the minimum three, since the mission specified five discovery lanes), reconciled by the
  lead; three isolated Stage B implementation lanes in separate git worktrees, run in parallel, each with
  its own mutation-control matrix; cherry-picked into this branch in the order policy → access →
  readiness, with zero conflicts; one orchestrator-owned integration pass (cross-lane parity test,
  scope-boundary regression guard, one e2e fixture fix).

## Commits on this branch

```
e2a8598c fix(wizmatch): preserve signal-scoped block semantics
a229ab9b fix(wizmatch): enforce pilot roster and role-aware actions
dd7f977c fix(wizmatch): harden Smartlead-free readiness checks
a7d53235 fix(wizmatch): PR 8B integration — parity/scope-boundary guards, e2e fixture fix
```

33 files changed, 2300 insertions, 197 deletions across the four commits. No guardrail file touched
(`src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`, `src/middleware/rbac.ts`,
`src/routes/cashfree.ts`, `src/services/sodEodService.ts` — all confirmed absent from the diff). No
migration added (`0037_unknown_siren.sql` remains the latest; no `0038`).

---

## FINAL VERDICT

**IMPLEMENTED.** All four owner-ratified decisions (P8B-1 through P8B-4) are implemented and tested.
Every G3-blocking finding in scope is closed. Two findings remain genuine, disclosed,
**not-yet-ratified owner decisions** (§9) that this branch deliberately did not resolve — neither is a
blocker before G3 under the required initial pilot configuration, and both are carried forward
unchanged from prior reviews, not new to this branch.

All final gates green on the fully integrated tree (not per-lane): `git diff --check` clean, `npm run
build` exit 0, `npm test` **126 files / 1418 tests**, `npm run admin:build` exit 0, Playwright
`wizmatch-local` **99 passed / 15 skipped / 0 failed** (exact match to the PR 8A baseline). The pilot
readiness CLI passes the approved safe baseline and fires on all required danger conditions, including
the two new ones this branch adds (an unaliased Smartlead credential; a malformed pilot roster).

## Verdicts by area

| Area | Verdict |
|---|---|
| **P8B-1 signal/scope semantics** | **PASS.** A `specific_signal`/`specific_requirement` non-overridable block now denies only that signal/requirement — it no longer freezes company-level review, preparation, assignment, or review-date actions, and never silently converts into a permanent company-wide block. A company/region/business-unit/location-scoped non-overridable block continues to freeze every company-level unblocking action, for every role including admin, unchanged. The distinction is keyed on the real `scope_type` DB column via one shared, exported predicate (`policyResolver.ts`) that `decisionWorkbenchActions.ts`, `decisionWorkbench.ts`, and `outreachGate.ts` all import — no second eligibility engine. |
| **Blocked-signal evidence leak (Task 1 requirement #5)** | **PASS.** Closed at the two real call sites that could otherwise leak a blocked signal/requirement into readiness, recommendation, confidence, or personalisation: `prepareCompanies.ts`'s `fetchBestSignal` now excludes a blocked signal via a tenant-scoped correlated exclusion and falls through to the next-best eligible one; `wizmatchRequirementPriority.ts` now denies a requirement carrying its own active block regardless of score, in both `*WithPolicy` entry points. Overridability is deliberately excluded from both checks — a merely-overridable blocked signal/requirement is still blocked until an admin actually overrides it. |
| **Pilot-roster verdict (P8B-3)** | **PASS.** `resolveStaffingAccess`'s `NODE_ENV === 'production' ? strict : permissive` ternary is deleted outright — `allowed = configured && pilotAllowed` in every runtime, with no environment-string condition anywhere. A missing, empty, or malformed roster fails closed in dev, staging, test, and production alike. No dev-bypass flag was introduced. Pilot membership grants no RBAC on its own — every write route's own `requireTeamLead`/`requireAdmin`/inline bulk check is unchanged and still runs after the pilot gate. Auth → tenant (a JWT claim checked inside `requireAuth`, this repo has no separate tenant middleware) → coarse RBAC → feature flag → pilot gate → fine RBAC ordering is confirmed correct and unchanged. |
| **Role/action-capability verdict (P8B-2)** | **PASS.** New `decisionWorkbenchCapabilities.ts` is the single, canonical, testable capability calculation, computed server-side and attached to every item in `GET /today/queues` plus a top-level bulk capability; the frontend (`TodayDecisionWorkbench.jsx`, `TodayBulkActionBar.jsx`) renders from it directly with no independent role logic of its own. A `staff`/`manager_ops`/`sales` pilot-eligible reader now sees zero enabled write actions; a `team_lead` sees a blocked-company override correctly disabled with "requires admin"; the bulk bar is gated on role alone, matching the route's admin-only bulk rule. Every disabled action carries its own `aria-describedby` pointing at always-visible text, not only a `title` attribute. The frontend's fallback for missing/malformed capability data fails **closed** (disabled, generic reason) — required after an initial review pass shipped it fail-open, corrected before commit. The real enforcement path (`decisionWorkbenchActions.ts`) is untouched and remains authoritative; a malicious direct call still gets the same server denial it always did (existing tests confirmed unchanged, not re-derived). |
| **Credential-detection verdict (P8B-4)** | **PASS.** The readiness CLI now detects the ten required Smartlead credential aliases (`SMARTLEAD_API_KEY`/`_KEY`/`_TOKEN`/`_API_TOKEN`/`_SECRET`/`_CLIENT_SECRET`, `SL_API_KEY`/`_API_TOKEN`/`_TOKEN`/`_SECRET`) by exact-name Set membership, in addition to the pre-existing broad `/SMARTLEAD/i` name test (kept, not replaced, so an unenumerated name like `SMARTLEAD_WORKSPACE_TOKEN` is still caught). No prefix test exists anywhere — an unrelated `SL_`-prefixed variable (`SL_TIMEZONE`) is confirmed not flagged. No credential value is ever printed; only names, counts, and pre-existing safe enum fields are interpolated into any finding message. |
| **Preparation verdict** | **PASS, unchanged by design.** `WIZMATCH_AUTO_PREP_ENABLED` stays `false` for this pilot; nothing in this branch enables preparation, the adapter, or any scheduler. The one preparation-adjacent code change (excluding a blocked signal from `fetchBestSignal`) is a correctness fix to draft/evidence quality, not a change to whether preparation runs. |
| **Queue verdict** | **PASS.** Precedence is unchanged (Paused/Blocked → Routed → Needs Review → Replies Needing Action → Ready to Contact). A company whose only block is signal/requirement-scoped no longer incorrectly lands in Paused or Blocked — it follows its normal decision/confidence bucketing, with the block disclosed via the new `nonOverridableBlockKind` field (`'signal' \| 'requirement' \| 'company_scope' \| null`) rather than by freezing the queue placement itself. |
| **Tenancy verdict** | **PASS.** Every new/modified query filters `tenantId` first: `fetchNarrowerNonOverridableBlockByCompany`'s scope-type-aware predicate, the new `fetchBlockedScopedIds` helper (signal/requirement exclusion), and `prepareCompanies.ts`'s correlated exclusion subquery (`p.tenant_id = s.tenant_id`). A dedicated test in the requirement-priority suite proves a blocked requirement in one tenant can never enter another tenant's exclusion set — non-vacuously, since the mock leaves the real Drizzle predicate graph intact and the test asserts the serialised predicate contains the calling tenant's id and never another's. |
| **Readiness verdict** | **PASS.** All 17 required scenarios re-run for real against the fully integrated tree (§6). The roster contract in the readiness CLI now matches the runtime contract exactly (unconditional danger on missing/empty/all-users-override roster, matching `resolveStaffingAccess`'s unconditional fail-closed design) — this cross-check was verified by the orchestrator, not assumed from either lane's self-report. Remains read-only, network-free, DB-free, migration-free, secret-safe by construction. |
| **Operator-readiness verdict** | **PASS.** New `docs/runbooks/WIZMATCH_INTERNAL_PILOT_OPERATOR_GUIDE.md` covers the required role matrix, queue/action definitions, disabled-action explanations (including the new signal-vs-company-scope wording), escalation path, and first-day/first-week/smoke-test/rollback checklists, without fabricating team names or production URLs. |
| **Test-quality verdict** | **PASS.** Every Stage B lane ran real mutation-control pairs (both red and green states reported and independently spot-checked by the orchestrator against the actual committed diffs — not accepted on a lane's self-report alone). The orchestrator added two further cross-cutting tests neither lane could own: a capability-vs-enforcement parity test (proving the two independent implementations of the same four rules cannot silently drift, with its own mutation control) and a scope-boundary regression guard (proving PR 9/10 have not started, with its own mutation control against a real planted offender, not just its self-test). One real Playwright a11y regression was found and fixed during final-gate verification (not merely reported) — see §7. |
| **Scope boundary** | **PASS.** No guardrail file, no migration, no `0038`, no Smartlead/sending/enrolment/reply-ingestion/paid-discovery code, no `package-lock.json` change, no Growth/SEO/n8n change, no production action. Confirmed by the new `wizmatchScopeBoundaryPR8B.test.ts` (mechanical, not one-off grep) in addition to a manual `git diff --stat` check. |

---

## The three Stage B lanes — commit-by-commit

### Lane B1 — policy/signal-scope (`e2a8598c`)

Files: `policyResolver.ts` (new exports `isSignalOrRequirementScoped`, `isCompanyOrScopeFreezingBlock`,
`fetchBlockedScopedIds`), `decisionWorkbenchActions.ts` (freeze-scope fix), `decisionWorkbench.ts`
(scope-type-aware narrower-block query, new `nonOverridableBlockKind` field, reworded
`disabledReasonFor`), `outreachGate.ts` (L1c predicate narrowed; L4 branch upgraded from a
provenance-discarding `denyDecision` call to a real `makeDecision` call carrying the blocking row's
actual `isNonOverridable`/`blockClass`/`evidence`/`reasonCode`), `prepareCompanies.ts` (blocked-signal
exclusion), `wizmatchRequirementPriority.ts` (blocked-requirement exclusion in both `*WithPolicy` entry
points), plus five test files (one new: `wizmatchRequirementScopeBlock.test.ts`).

Seven mutation-control pairs run and independently spot-checked by the orchestrator against the real
diff (`decisionWorkbench.ts` reviewed line-by-line): scope-type exclusion reverted (2 red → 28 green);
company-freezing bucketing reverted (3 red → 37 green); SQL scope-type predicate dropped (1 red → 37
green); L4 branch's provenance carry-through reverted (2 red → 22 green); L1c/L4 re-conflated (3 red →
22 green); blocked-signal exclusion removed from `prepareCompanies.ts` (3 red → 25 green); blocked-
requirement exclusion removed (3 red → 8 green). Every control case that should be unaffected by a
mutation (a region/business-unit-scoped block, an unblocked sibling requirement) stayed green in both
states, proving the fix is scoped correctly and not merely permissive.

**One deviation confirmed correct by the orchestrator:** the lane's judgment call to make the blocked-
signal/requirement exclusion unconditional on shadow/enforce mode (not gated like
`withMissingCompanyBlocker`) is accepted — a non-overridable block, at any scope, is an explicit
human-authored row, not a resolver-inferred default, and this repo's existing pattern already applies
stored non-overridable blocks identically in shadow and enforce for exactly that reason. Task 1's
requirement #5 is stated unconditionally in the mission brief, not shadow-gated.

### Lane B2 — access/RBAC/UI (`a229ab9b`)

Files: `wizmatchStaffingAccess.ts` (ternary deleted), six test files updated for the resulting blast
radius (`wizmatchPilotGate.test.ts`'s inverted old-contract assertions rewritten; `wizmatchIndexMountOrder.test.ts`,
`wizmatchPolicyRoutes.test.ts`, `wizmatchTodayRoutes.test.ts`, `wizmatchPrepareRoutes.test.ts` all gained
an explicit test-configured roster since none previously mocked the pilot gate at all), new
`decisionWorkbenchCapabilities.ts` (+ 37-test suite), `wizmatchToday.ts` (capability attachment on both
routes), `TodayDecisionWorkbench.jsx`/`TodayBulkActionBar.jsx` (consume capabilities), new
`admin/src/lib/todayActionCapabilities.js` (fail-closed frontend fallback helper, tested via the
existing `adminFrontendHelpers.test.js` harness since the repo's vitest config runs in a Node
environment with no component rendering).

Full-suite verification (not just targeted files) run twice by the lane: once at 123 files/1333 tests
after the initial pass, once at 123 files/1349 tests after the fail-closed-fallback correction (+14
fail-closed cases, +2 positive controls). Nine mutation-control pairs run: the full Part-A blast radius
(39 red across five files before the roster env var was added, then green); the original NODE_ENV
ternary reinstated (19 red across five files, `NODE_ENV=production` cases correctly stayed green under
the mutation — proving the old code was only ever correct for that one literal string); five capability-
rule mutations (role allow-list, blocked+non-admin override, non-overridable short-circuit, P8B-1
signal/requirement cross-check, `set_review_date` dimension-completeness), each isolated to its own red
count and restored to the full 37/37 green.

**One correction made by the orchestrator before accepting this lane's work:** the frontend capability
fallback initially defaulted to *enabled* when `item.capabilities` was absent or malformed. Task 3's
explicit requirement #10 ("unknown roles and malformed capability inputs fail closed") makes this a
correctness defect, not a style preference — an absent-capabilities response is exactly a malformed
capability input. The lane corrected this to fail closed (`{enabled: false, reason: 'Unable to
determine permissions...'}`) with a dedicated 14-case mutation-tested suite before the commit was
accepted into this branch.

### Lane B3 — readiness/config (`dd7f977c`)

Files: `wizmatchPilotReadiness.ts` (local `PROVIDER_CREDENTIAL_ENV_VARS` map, dual-detector credential
check, unconditional roster-danger logic, new `pilot-roster:format` malformed-entry check, corrected
doc comments), `scripts/wizmatch-pilot-readiness.ts`, `wizmatchPilotReadiness.test.ts` (58 → 61 tests
across two rounds), two docs (`WIZMATCH_SMARTLEAD_FREE_PILOT_CONFIG.md`,
`WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md`) corrected only where this lane's change made a stated fact
stale.

All 17 required scenarios run for real via actual CLI invocations in the isolated worktree (not test-
level assertions alone), re-verified independently by the orchestrator against the fully integrated
tree post-cherry-pick (§6). Four mutation-control pairs: alias-Set/map desync (1 red of 58); exact-name
check swapped for a prefix test (the `SL_TIMEZONE` negative case goes red, proving the negative
assertion is non-vacuous); UUID-shape filter removed (2 red); roster-danger re-gated on
`productionTarget` (2 red). A fifth, requested by the orchestrator after the lane's own self-review
flagged the gap: the all-users-override danger was still gated on `productionTarget`, leaving exactly
the hole the roster fix had just closed for the missing-roster case. Fixed in an amended commit, with
its own `it.each` covering four runtimes and a control proving the two non-production cases go red
under a reverted gate while the two production-target cases correctly stay green (proving the new
cases are what pin the change, not a weakening of prior coverage).

---

## Findings reconciled — PR 8A residual matrix

| ID | One-line description | Classification |
|---|---|---|
| S1-2 (PR8A) | L4 per-signal vs L1c scope-level block conflation | **Resolved by PR 8B** (P8B-1, Lane B1) |
| S2-4 (PR8A) | Workbench shows always-403 actions to staff | **Resolved by PR 8B** (P8B-2, Lane B2) |
| H-4 (PR8A) | Pilot gate fail-closed depends on an unverified runtime `NODE_ENV` | **Resolved by PR 8B** (P8B-3, Lane B2) for the code side. **Confirming the live Railway `NODE_ENV=production` value remains a human G3 checklist step** — no code change can substitute for that, and none was claimed to. |
| S3-1 (PR8A) | Smartlead detection is name-substring-only, misses aliases | **Resolved by PR 8B** (P8B-4, Lane B3) |
| PR6 M-2 | Approve & Queue disabled-reason renders but button stays enabled; `allowedCampaignTypes` never computed | **Partially resolved as a side effect of P8B-2's capability rework** (the "button stays enabled" half — Approve & Queue is now correctly disabled when appropriate, driven by real capability data). The `allowedCampaignTypes` advisory-display gap is a **separate, non-blocker-before-G3 item, not addressed** — out of this branch's ratified scope (not one of P8B-1…4), and the backend already 403s correctly regardless. |
| PR7 O-3 / PR8A S2-3 | `POST .../prepare` is a write at pilot-member tier (staff+) with no role gate, while every other write in this stack is `team_lead`+ | **Owner decision still required — NOT resolved by this branch, deliberately.** PRD-005 §4's permission table has no row for "trigger preparation" at all; the current staff+ tier is the original implementer's documented judgment call, not a PRD mandate. Mechanically copying the team_lead+ pattern from sibling writes would resolve an undecided interpretive question in one particular direction, not apply an existing rule — the same category of error PR 8A's review explicitly refused to make for S1-2 in the opposite (loosening) direction. **Not a blocker before G3**: the route is inert while `WIZMATCH_AUTO_PREP_ENABLED=false`, which is this pilot's required initial value. Recorded for ratification before preparation is ever enabled. |
| PR6 M-1 residual | `wizmatch_company_policies` has no dedicated `approved_by`/`approved_at` columns; provenance is `actor_user_id` + `source` + the event chain (made airtight at the write chokepoint by PR 8A's H-3) | **Owner decision still required — NOT resolved by this branch, deliberately.** Adding dedicated columns is a migration, doubly out of this branch's authority (schema guardrail + owner decision). PR 8A's own review already stated this needs "a migration and an owner decision" if the owner wants a dedicated pair rather than the current provenance chain. **Not a blocker before G3** — the current chain already proves who approved what, when. |
| S3-3 (PR8A) | Runbook names no concrete `railway run` mechanism | Non-blocker, docs-only, unchanged (needs the real service name, which no code-only branch can supply) |
| PR8 M-6…M-14, L-1…L-11 | Various (readiness enforced by convention, no `tenantId` on `getConfigStatus()`, `WIZMATCH_OUTREACH_ADAPTER_ENABLED` read by no code, ADR-007 doc drift, etc.) | **Deferred to PR 9** — unaffected by this branch, still gated on U-6 (sanitised Smartlead fixtures) |
| PR8 H-4, M-10, M-11 (PR10 event map) | Multi-tenant reply poller tenant-pinning gap; missing tenantId/NOT NULL constraints in the provider-neutral event map | **Deferred to PR 10** — unaffected by this branch |
| B-1 (carried since PR5) | Migration `0037` must be applied before `main` | **Blocker before G1** — requires production access, correctly out of this branch's authority; confirmed untouched (`git diff --stat` shows no `schema.ts`/`migrations/` change) |
| U-7 (carried since PR8A) | Shared-index owner sign-off (`users`/`contacts`/`contact_channels`) | **Blocker before G1** — needs the Growth-tenant owner, unrelated to this branch's four lanes |
| PR7 O-2 | Cross-job duplicate-contact race, needs a partial unique index | **Blocker before G4** — migration-gated, unaffected by this branch |

**No prior finding was falsely closed.** Every classification above traces to either a specific code
change verified in this branch's diff, or an explicit statement that the item is unaffected/out of
scope, cross-checked against the PR6/PR7/PR8/PR8A review documents' own wording before being marked
resolved, deferred, or still-open.

---

## Mutation/control summary (all lanes + orchestrator)

| Guard | Red proof | Green proof |
|---|---|---|
| Signal-level block freezing company actions | Reverted scope-type exclusion → 2 red | Restored → 28/28 |
| Company/scope block becoming actionable | Reverted bucketing → 3 red | Restored → 37/37 |
| Blocked signal in prepared draft | Removed exclusion → 3 red | Restored → 25/25 |
| Blocked requirement in priority ranking | Removed exclusion → 3 red | Restored → 8/8 |
| Pilot roster bypass outside `NODE_ENV=production` | Reverted ternary → 19 red across 5 files | Restored → all green |
| Missing/empty roster admitting users | `it.each` across 5 runtimes, all assert DENY | Confirmed via real code path, no mock |
| Pilot membership granting RBAC | Negative-proof audit: every write route's role check confirmed unconditional after the pilot gate | N/A (audit, not a red/green pair — see Lane B2 report) |
| Staff seeing an enabled action the server rejects | Removed role branch → 7 red | Restored → 37/37 |
| Bulk/row capability disagreement | Bulk-vs-single role-list mismatch asserted directly (Mutation 1's discriminating case) | Confirmed |
| Hidden frontend action still unauthorized server-side | Existing `wizmatchTodayRoutes.test.ts` staff-403/team_lead-bulk-403 tests confirmed unchanged, still passing | Confirmed, not re-derived |
| `SL_API_KEY` passing readiness | New scenario, real CLI run → exit 1 | N/A (danger-only scenario) |
| Credential alias evading detection | Alias-Set/map desync → 1 red | Restored → 58/58 (then 61/61 after all-users fix) |
| Unrelated `SL_`-prefixed false positive | Exact-match swapped for prefix test → new negative test red | Restored → green |
| Smartlead provider selection passing readiness | Real CLI run → exit 1 | N/A |
| Credential value printed | Grepped stdout for fake canary value across all 17 scenarios → 0 matches | N/A |
| Safe shadow/all-off config failing | Real CLI run, safe baseline → exit 0 | Confirmed |
| Shadow becoming behaviourally blocking | Unaffected by this branch — confirmed no change to `outreachGate.ts`'s mode-awareness beyond the L1c/L4 fix, which is orthogonal to shadow/enforce | N/A |
| Tenant predicate removed | Dedicated test asserts the real Drizzle predicate graph contains the calling tenant's id and never another's | Confirmed non-vacuous (mock leaves real predicates intact) |
| Canonical resolver bypassed | No second eligibility engine created — confirmed by reading every changed file's imports; shared predicates live in `policyResolver.ts` alone | Confirmed |
| Unknown role/block scope failing open | Unrecognised scope key falls back to the restrictive `company_scope` answer (capability module); unrecognised role fails closed (roster matrix `it.each`) | Confirmed, tested |
| PR 9/10 leaking into this branch | New `wizmatchScopeBoundaryPR8B.test.ts`, planted a real `SmartleadProvider` identifier → 1 red | Removed → 4/4 green |
| Capability prediction vs real enforcement drift | New `wizmatchCapabilityEnforcementParity.test.ts`, broke the capability module's company-scope predicate → 2/8 red | Restored → 8/8 green |

---

## Tests and gates — final integrated tree

```
git diff --check                                          → clean
npm run build                                              → tsc, exit 0
npm test                                                    → 126 files / 1418 tests, all green
npm run admin:build                                         → exit 0
npx playwright test --config=playwright.wizmatch-local.config.ts
                                                             → 99 passed / 15 skipped / 0 failed
```

The 15 skips are the documented no-password real-backend specs (two hardening specs × 5 tests × 3
projects), identical in count and reason to every prior PR in this stack.

**One real Playwright regression was found and fixed during final verification, not merely reported:**
the integrated capability rework correctly surfaced that `e2e/wizmatch-a11y.spec.ts`'s Today fixture
predates capability-driven rendering and supplied no `capabilities` field, so the new fail-closed
frontend fallback correctly disabled every action — including the one the test's keyboard/focus
assertion targeted (Approve & Queue on an already-`outreachEligibility: 'eligible'` company, which the
real backend has refused as `already_approved` since PR 8A's H-3 fix; the fixture was exercising a
state the real backend would never actually allow to proceed). Fixed by retargeting the interaction to
a company where the action is genuinely available and adding realistic `capabilities` fixture data
elsewhere in the same test, matching real server semantics rather than reintroducing the old always-
enabled behaviour. Full suite re-confirmed at the exact 99/15/0 baseline after the fix.

## Readiness CLI — all 17 required scenarios, re-run against the final integrated tree

| # | Scenario | Result |
|---|---|---|
| 1 | Safe approved configuration | exit 0, zero dangers |
| 2 | `--production` asserted, `NODE_ENV` unset | exit 1, `runtime:NODE_ENV` danger |
| 3 | `WIZMATCH_POLICY_ENFORCEMENT_MODE=enforce` | exit 1 |
| 4 | `WIZMATCH_SENDING_ENABLED=true` | exit 1 |
| 5 | `AUTOMATED_EMAILS_ENABLED=true` | exit 1 |
| 6 | `WIZMATCH_AUTO_PREP_ENABLED=true` | exit 1 |
| 7 | `WIZMATCH_OUTREACH_ADAPTER_ENABLED=true` | exit 1 |
| 8 | `OUTREACH_PROVIDER=smartlead_csv` | exit 1 |
| 9 | `SMARTLEAD_API_KEY` present | exit 1, value never printed |
| 10 | `SL_API_KEY` present (new alias detection) | exit 1, value never printed |
| 11 | `SL_TOKEN` alias present (new) | exit 1, value never printed |
| 12 | Missing roster, no `--production` (now unconditional) | exit 1 |
| 13 | Whitespace-only roster | exit 1 |
| 14 | Malformed roster (non-UUID entries) | exit 1, `pilot-roster:format` danger, count only, entries never printed |
| 15 | Unknown provider | exit 1 |
| 16 | Unrelated `SL_`-prefixed non-credential var (`SL_TIMEZONE`) | exit 0, never flagged by name alone |
| 17 | Safe values via a real local `.env` copy, with a fake secret canary value | exit 0, canary value never appears in output |
| — | All-users override, no `--production` (now unconditional, closed as a follow-up) | exit 1 |

Zero failures against the required matrix. All secret/canary values confirmed absent from every log
via direct `grep` against captured CLI output, not merely asserted.

---

## Blockers by gate

### Before G1 (migration approval)
- **B-1** (carried) — apply migration `0037`; requires production access, out of this branch's authority.
- **U-7** (carried) — shared-index owner sign-off (`users`/`contacts`/`contact_channels`), needs the
  Growth-tenant owner.

### Before G2 (backfill approval)
- Nothing new from this branch. Dry-run review against production data remains the standing
  precondition, unaffected by PR 8B.

### Before G3 (shadow deployment)
- **Confirm `NODE_ENV=production` on the deployed Railway service** — a human checklist step no code
  change can substitute for; the readiness CLI's `runtime:NODE_ENV` danger check still fires on a
  mismatch, but cannot itself verify the live value.
- Set `WIZMATCH_STAFFING_PILOT_USER_IDS` to an explicit id list (not the all-users override).
- Run `npm run wizmatch:pilot-readiness -- --production` against the deployment's actual environment.
- Set `WIZMATCH_COMPANY_POLICY_ENABLED=true` and `WIZMATCH_DECISION_WORKBENCH_ENABLED=true`.
- **Nothing else.** Every G3 checklist item that PR 8A's review flagged as needing an owner decision
  (S1-2, S2-4, S3-1) is resolved by this branch.

### Before G4 (future `enforce`)
- Everything carried from PR 3/5/6, plus PR 7's O-2 (cross-job duplicate-contact race, migration-gated).
- G3's observation window must show the readiness report's hard preconditions met.

### Deferred to PR 9 (Smartlead CSV adapter)
Unchanged, still gated on U-6 (sanitised Smartlead fixtures). PR 8 review's M-6…M-14 and L-1…L-11
carried verbatim.

### Deferred to PR 10 (reply ingestion)
Unchanged. PR 8 review's H-4 (tenant-pinned reply poller), M-10, M-11 carried verbatim.

### Owner decisions still required (neither blocks G3)
1. **PR 7 O-3 / PR8A S2-3** — the role tier for `POST .../prepare` (currently staff+, undecided by
   PRD-005 §4). Inert while `WIZMATCH_AUTO_PREP_ENABLED=false`.
2. **PR6 M-1 residual** — whether `wizmatch_company_policies` gets dedicated `approved_by`/`approved_at`
   columns versus the current actor/source/event-chain provenance. Migration-gated.

---

## Confirmations

- **Nothing pushed, merged, or deployed.** All commits are local to this branch and the (now-removed)
  temporary worktrees.
- **Migration `0037` was not applied** to any database. No `0038` created.
- **Backfill `--apply` was not run.**
- **Sending, preparation, the outreach adapter, and paid discovery all remain disabled** — no code in
  this branch enables any of them; the readiness CLI confirms this against the required safe
  configuration.
- **No Smartlead connection of any kind, no provider credential used.**
- **PR 9 and PR 10 remain deferred** — confirmed both by manual review and by the new
  `wizmatchScopeBoundaryPR8B.test.ts` mechanical guard.
- **No guardrail file touched.**
- **Working tree is clean** apart from one pre-existing, unrelated untracked directory (`input-data/` —
  CSV artifacts from an unrelated task, present before this session started, never staged or touched).
- **Three temporary worktrees and branches** (`tmp/pr8b-policy-scope`, `tmp/pr8b-access-actions`,
  `tmp/pr8b-readiness-config`) were removed after their commits were confirmed reachable from this
  branch's HEAD (see `.ai/HANDOFF_LOG.md` for the exact cleanup commands run).
