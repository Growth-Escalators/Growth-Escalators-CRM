# WizMatch Outbound OS — PR 8B final independent review (remediated tree)

- **Branch:** `ge/outbound-08b-g3-pilot-completion` (PR #89, draft, stacked on PR #88)
- **Review base:** `ece8d3ba`
- **Remediated code HEAD reviewed:** `84fc340e` (tree state `30e6ccf1`, two docs commits on top)
- **Fixes made during this review:** `5f045b5d` (tests + doc accuracy), `2b1f074a` (F-A disclosure)
- **F-A resolution:** `111e5322` (machine-sync lane), `43c7fa89` + `0d330269` (two vacuous controls)
- **Final reviewed code commit:** `0d330269`
- **Reviewed at:** 2026-07-27T15:20:00Z
- **Reviewer:** fresh independent Opus session, no memory of the remediation work
- **Method:** five parallel read-only Explore subagents (R1–R5) + the lead's own independent pass;
  every mutation control executed by the lead, since the agents were read-only

---

## FINAL VERDICT

> ## **CODE READY** — at `0d330269`, after F-A was resolved.
>
> `.ai/OUTBOUND_PR8B_CODE_READY` is created. **Zero Critical, zero High.**
>
> This document's original verdict was NOT CODE READY, blocked on one new High (F-A). The owner
> ratified a narrow machine-sync exception; it is implemented, independently reviewed by two fresh
> agents, and verified here by eleven executed mutation controls. The verdict below is superseded
> and left intact as the record of why the branch was held.
>
> **Still true, and the reason to read the rest of this document:** across this review and its F-A
> follow-up, **six separate mutation controls were found to be vacuous** — four on the remediated
> tree, two in the F-A lane's own tests. Every one has been fixed and proven red. This is the third
> consecutive round in which this branch's mutation evidence was overstated, and in two cases a
> reviewer cited a control that could not fail as its own evidence.

### Superseded original verdict (kept as the record)

> ## **NOT CODE READY.**
>
> The six prior High findings are all genuinely closed — verified by mutation, not by reading the
> remediation report. The blocker is **one new High finding (F-A)** that the remediation
> introduced and no document disclosed: the M-3 pilot gate locks every `viewer` account out of all
> 82 WizMatch routes, permanently and unfixable by configuration, and the repo's own comment names
> `viewer` as the Command Deck sync account. **It requires an owner decision before merge**, and
> merging auto-deploys.
>
> Separately, **four narrow mutation controls stayed green** on the submitted tree — four safety
> properties the remediation reports as closed had no regression control at all. Those are fixed in
> this review (`5f045b5d`) and all four now go red.

---

## F-A RESOLUTION (owner-ratified, implemented and reviewed)

**Owner decision:** a narrow read-only machine-sync exception. `viewer` is explicitly NOT made
generally pilot-eligible, is NOT added to the roster, and the pilot gate is NOT removed from the
WizMatch router. The human pilot roster is exactly three people (two `admin`, one `team_lead` — that
tier chosen deliberately so the third member can perform policy writes, approvals, owner assignment
and duplicate resolution). Their identities are resolved to user ids read-only at G3 and are
deliberately **not** recorded in this repository.

**Implementation** — `src/middleware/wizmatchMachineSyncLane.ts` (commit `111e5322`), mounted as
`wizmatchPilotOrMachineSync` replacing `wizmatchPilotGate` at exactly one line in `src/index.ts`.
`requireAuth` and `wizmatchRequireAdmin` still run first, so the lane is unreachable without
authentication and without passing RBAC. The lane engages only when **all** hold:

| Condition | Effect |
|---|---|
| `req.method === 'GET'` | no mutation, ever; `HEAD`/`OPTIONS` refused too |
| `req.user` present, non-empty `tenantId` **and** `id` | tenant-safe; handlers read `req.user.tenantId` only |
| `req.user.role === 'viewer'` | the documented machine/service identity |
| `req.path` **exactly equals** one of eight frozen paths | not a prefix, regex or wildcard |

Anything else delegates to the untouched `wizmatchPilotGate`. `PILOT_ELIGIBLE_ROLES` has a zero-line
diff; `wizmatchPilotGate.ts` has a zero-line diff.

**Authorization boundary (reviewer A, independently confirmed).** Verified with live Express 5.2.1
probes using raw `http.request()` to bypass client-side URL normalisation: `req.path` is neither
percent-decoded nor dot-segment-normalised, so `/dashboard/`, `/Dashboard`, `/%64ashboard`,
`/%2e%2e/signals`, `/dashboard/../signals`, `/dashboard%00`, `/dashboard;x=1` and `//dashboard` all
fail exact equality and fall through to the gate. No method-override middleware exists anywhere in
the app. None of the four earlier-mounted WizMatch routers defines any of the eight paths, so
nothing can shadow the lane.

**Effective authorization change:** before, all 82 routes 403'd every viewer. After, a `viewer` may
issue `GET` on eight paths and nothing else. All 74 other routes, and every non-GET on those eight,
remain gated exactly as before. Human roles are unchanged.

### Two more vacuous controls, found and fixed during the F-A review

- **The tenant-safety assertion could not fail.** It looped over `poolQuery.mock.calls` asserting no
  call carried an attacker-supplied tenant; with an empty call list the loop body never ran. Proven
  by removing `/dashboard` from the allowlist — the request 403s, no query runs, and the test stayed
  **green**. It now asserts the handler was actually reached and that a query carried the
  authenticated tenant. Fixed in `43c7fa89`. **Reviewer A had cited this exact test as its evidence
  for the owner's "tenant-safe resolution" constraint.**
- **A second assertion accepted either outcome.** A test named "403s on a Workbench/policy-adjacent
  read" asserted `expect([200, 403]).toContain(status)` and discarded the body. Its name was also
  wrong — `/review-workbench` is allowlisted, so the real answer is 200, and the range had been
  widened to paper over the mismatch. Found by reviewer C, rewritten into two deterministic claims,
  fixed in `0d330269`. Requirement 2 proper is proven where it belongs, in
  `wizmatchTodayRoutes.test.ts` and `wizmatchPolicyRoutes.test.ts`.

### F-A mutation controls — eleven run by the lead, all red

| # | Mutation | Result |
|---|---|---|
| A | exact match → `startsWith` | **RED** — 2 failed |
| B | drop `req.method === 'GET'` | **RED** — 3 failed |
| C | drop `role === 'viewer'` | **RED** — 6 failed |
| D | drop the `tenantId` requirement | **RED** — 2 failed |
| E | widen the allowlist by one entry | **RED** — 5 failed |
| F | drop the `req.user` presence check | **RED** — 2 failed |
| G | drop the `id` requirement | **RED** — 2 failed |
| H | lane always allows (gate never reached) | **RED** — 22 failed across 2 files |
| I | widen method check to allow `HEAD` | **RED** — 1 failed (new control) |
| J | de-allowlist `/dashboard` (tenant-test vacuity probe) | was **GREEN**, now **RED** after fix |
| K | de-allowlist `/review-workbench` (C's probe) | was **GREEN**, now **RED** after fix |

### Recorded, not fixed

- **`GET /placements` will still 403 for the sync — pre-existing, not an F-A regression.** That route
  carries its own `['admin','team_lead']` check (`src/routes/wizmatch.ts:3352`), verified
  byte-identical at the review base and on `origin/main`. It is the only one of the eight with such a
  check. The lane correctly carries the request *past* the pilot gate; the route's own RBAC then
  refuses it with the distinguishable body `commercial_access_requires_lead`. No cockpit tile depends
  on it — `buildWizmatchTile()` reads only `command-center`. Whether to widen that route's RBAC is a
  separate decision; it does not block G3.
- **Reported flake (reviewer A, N-2), not reproduced.** One failure was observed when three test
  files ran together. **Not reproduced in 13 runs** — 8 sequential and 5 deliberately concurrent. The
  single observation coincided with the lead's Playwright suite saturating CPU and ports. Recorded as
  a CI watch item; nothing fixed, because nothing reproducible was found.
- **The sync's live identity is unverified.** The lane engages only for `role === 'viewer'`. The
  repo documents the sync as a viewer and `crm-sync.mjs:257` treats `role === 'viewer'` as its own
  service-account marker, but confirming the production principal needs production access this review
  deliberately did not take. **A mandatory read-only G3 check** now covers principal, role, tenant and
  endpoints. If no legitimate production sync exists, the lane simply stays unused — no account is to
  be manufactured.

### What the remediation got right, stated plainly

The six High fixes are real, and the two that mattered most — H-1's tenancy control and H-6's
intersection — are now pinned by controls that genuinely fail. H-1's replacement assertion captures
the **runtime SQL string** rather than the source text, which is structurally immune to the
doc-comment satisfaction that defeated the original. H-5's new test mock is a faithful SQL
interpreter that even guards against the `wp.tenant_id` substring false-positive it tripped over
while being written. That is good work, and the mutation results below confirm it rather than
taking it on trust.

### Where its evidence was overstated

The remediation report states M-4's control turned red for "both fixes". It did not. Reintroducing
the `NODE_ENV` fallback in `wizmatchStaffing.ts`'s own `isStaffingPhaseEnabled` left the suite
**green** — the existing test samples only `NODE_ENV='production'`, the single value at which the
fixed and the vulnerable implementations agree. Three further controls were green for the same
class of reason. The pattern from the previous round — *a passing control proves only what it
mutates* — recurred, one level down.

---

## AGENT RECONCILIATION — AND A PROCESS FAILURE WORTH RECORDING

Across this review and its F-A follow-up, **five of eight subagents went idle without delivering
their reports** (R1, R3, R4 in the first pass; FA-rev-B twice and FA-rev-B2 twice in the second).
This is the exact failure that caused the original wrong CODE READY verdict on this branch. No
verdict was formed while any report was outstanding. R1/R3/R4 delivered in full when re-prompted;
FA-rev-B and FA-rev-B2 never did, and were replaced by FA-rev-C, which delivered and immediately
found a vacuous test the lead had missed. **The structure earned its keep in both rounds** — the
highest-yield findings in each came from agents, not the lead.

## FIVE-AGENT RECONCILIATION

All five reports returned and were reconciled before any verdict. **R1, R3 and R4 initially went
idle without delivering their reports** — the exact failure that produced the previous wrong
verdict. They were re-prompted and delivered in full; no verdict was formed in the interim.

| Agent | Scope | Outcome vs the lead's own pass |
|---|---|---|
| R1 | H-1 tenancy, test fidelity | Agreed CLOSED. Found no path the lead missed. Both traced the same three query sites. |
| R2 | H-2/H-3 readiness contract | **Found what the lead had not**: relative-path cwd dependence + the doc overclaim. Lead reproduced it independently and *downgraded* R2's emphasis — the CLI echoes the resolved path, so the H-2 failure mode (file silently ignored) really is closed. Medium, agreed. |
| R3 | H-4/H-5 policy, migration, discovery | Agreed CLOSED. **Predicted the `validatePolicyWrite` coverage gap**; the lead confirmed it and found it worse than R3 estimated (full suite green, not just a subset). |
| R4 | H-6 bulk capability, UI | Agreed REMEDIATED. Independently confirmed the lead's `selectedItemsFor` reachability argument by enumerating every `setQueues`/`setSelected` call site. |
| R5 | Mediums, route gating, scope boundary | **The highest-yield report.** Found the M-4 and M-2 vacuous controls and the scope-guard evasion, all three confirmed empirically by the lead. |

Corrections applied to agent claims: R5's route inventory of "152 total" is right but the "82" in
prior docs was never a whole-surface claim; R5's M5b mutation was superseded by direct evasion
testing; R2's H-2 grade was moderated, as above. R1's hand-traced mutation predictions were all
confirmed by actual execution.

---

## PRIOR HIGH FINDINGS — VERDICTS

| # | Finding | Verdict | Proof |
|---|---|---|---|
| H-1 | Blocked-signal tenancy had no working control | **CLOSED** | M1 red: deleting *only* `p.tenant_id = s.tenant_id` → 3 failed / 22 passed. This is the mutation that was green last round. |
| H-2 | Readiness CLI cwd-dependent | **CLOSED for the reported failure mode**; residual Medium on relative paths, fixed by documentation + test | 17-scenario matrix; lead-reproduced dirA/dirB probe |
| H-3 | Stale exports override the audited file | **CLOSED** | File-only merge, no `processEnv` spread; scenarios 3/4/17 |
| H-4 | Unknown `scope_type` fails open | **CLOSED, both halves** | M3b-3 red (gate); DB CHECK proven on disposable Postgres; app half had **no control** — now added and red |
| H-5 | Blocked signals rank/score/recommend | **CLOSED** | M1b, M3b-1, M3b-2 all red across both exclusions |
| H-6 | Bulk bar enables per-row-forbidden actions | **CLOSED** | M4a, M4a2, M4b, M4c all red |

## MEDIUM FINDINGS — VERDICTS

| # | Finding | Verdict |
|---|---|---|
| M-1 | `team_lead` bulk at count=1 | **CLOSED** — `selection.length === 1` matches `isBulk = targets.length > 1` |
| M-2 | `/staffing/access` current-caller-only | **Code correct, control was VACUOUS** — subject injection left the suite green. Fixed in `5f045b5d`; now red |
| M-3 | Pilot gate on send/spend/prep/provider routes | **CLOSED** — M5a red; but see **F-A** for its undisclosed consequence |
| M-4 | Staffing phases explicit, default off | **Code correct, control was VACUOUS** — fixed; now red. No production regression: production already resolved these off |
| M-5 | Capability wiring + PR 9/10 scope guard | **NOT CLOSED as submitted** — `SmartLeadCsvAdapter` and three other names evaded the guard. Fixed in `5f045b5d`; all evasions now caught, plus a structural `KNOWN_PROVIDERS` pin |

## OWNER DECISIONS

| # | Decision | Verdict |
|---|---|---|
| D-R1 | All send/spend/prep/provider/outreach-mutation routes pilot-gated | **CONFIRMED** — all four routers gated; `wizmatchStaffing.ts`'s 57 routes are a non-outreach domain with its own equivalent gate, all 57 matching its path regex |
| D-R2 | `0037` carries the canonical CHECK; no `0038` | **CONFIRMED** — verified on disposable Postgres, three-way parity exact, no `0038` |
| D-R3 | `--audit-env-file` deterministic and file-authoritative | **CONFIRMED with a documented precondition** — file-authoritative fully; deterministic for absolute paths, now documented and tested |

## AREA VERDICTS

| Area | Verdict |
|---|---|
| Tenancy | **PASS** — three query sites, all correlated; the decisive mutation now fails |
| Migration | **PASS** — replay, incremental, accept/reject, parity all verified on throwaway DBs |
| Readiness environment | **PASS** with the relative-path precondition documented |
| Policy / discovery | **PASS** — every discovery/ranking/scoring/routing path excludes blocked signals |
| Route gating | **PASS** structurally; **F-A** is its undisclosed consequence |
| Bulk capability | **PASS** — genuine `every` semantics, fail-closed on empty, backend authoritative per target |
| Frontend / accessibility | **PASS** with two Lows — hook ordering correct; disabled reasons both visible and `aria-describedby`; native `disabled` removes them from tab order (pre-existing, repo-wide) |

---

## MUTATION CONTROL TABLE

Every mutation was applied to the real file, the suite run, and the file restored from a
byte-identical backup with a SHA-256 equality assertion. `git status` was empty after every batch.

| # | Mutation | Expected | Result |
|---|---|---|---|
| M1 | Delete only `p.tenant_id = s.tenant_id` in `prepareCompanies.ts` | RED | **RED** — 3 failed |
| M1b | Delete only the tenant correlation in the client-discovery row filter | RED | **RED** — 2 failed |
| M3b-1 | Remove the whole client-discovery row exclusion | RED | **RED** — 4 failed |
| M3b-2 | Remove the `active_signal_count` exclusion | RED | **RED** — 2 failed |
| M3b-3 | Revert gate to `applicableRows` | RED | **RED** — 1 failed, negative control stayed green |
| M4a | Intersection → first row only | RED | **RED** — 2 failed |
| M4a2 | Intersection → union (`some`) | RED | **RED** — 1 failed |
| M4b | Remove empty-selection fail-closed guard | RED | **RED** — 1 failed |
| M4c | Remove backend per-target admin-override re-check | RED | **RED** — 1 failed |
| M5a | Remove pilot gate from the `index.ts` mount | RED | **RED** — 5 failed across 2 files |
| **M5d** | Reintroduce `NODE_ENV` in `isStaffingPhaseEnabled` | RED | **GREEN — vacuous.** Fixed → now **RED**, 9 failed |
| **M5c** | `/staffing/access` accepts caller-supplied subject | RED | **GREEN — vacuous.** Fixed → now **RED**, 2 failed |
| **M3a** | Remove `validatePolicyWrite` unknown-scope guard | RED | **GREEN — vacuous, full suite 1469 green.** Fixed → now **RED**, 6 failed |
| **M5b** | Scope-guard evasion by plausible identifier | caught | **`SmartLeadCsvAdapter`, `SmartLeadAdapter`, `smartLeadExporter`, `CsvBulkOutreachAdapter` all EVADED.** Fixed → all now caught |
| M2c | Drop the resolved-path disclosure from the report | RED | **RED** — 2 failed (new control) |

## GATES

Final, at `0d330269`:

```
git diff --check                          → clean
npm run build                             → tsc, exit 0
npm test                                  → 132 files / 1551 tests, all passed
npm run admin:build                       → exit 0
npx playwright test --config=playwright.wizmatch-local.config.ts
                                          → 99 passed / 15 skipped / 0 failed
```

Intermediate: 130/1469 as submitted (reproduced exactly, so the remediation marker did not overstate
its numbers) → 131/1495 after this review's first fixes → 132/1551 after F-A.

The submitted tree reproduced the claimed **130 files / 1469 tests** exactly before any fix, so the
remediation marker did not overstate its numbers. This review's fixes add 1 file / 26 tests.
Playwright matches every prior baseline in this stack.

## MIGRATION VERIFICATION (disposable local Postgres only, all torn down)

- Fresh replay of all 38 migrations through `0037` — OK
- Incremental `0000..0036`, then `0037` alone — OK
- Re-execution of the same SQL correctly errors (migrations are not idempotent by design; drizzle
  tracks applied migrations by journal entry, so this is not a defect)
- All six canonical `scope_type` values accepted
- Seven invalid values — `unknown_scope`, `entire_Company`, `ENTIRE_COMPANY`, `team`,
  `specific_signals`, `regionx`, and an injection string — **all rejected by
  `wizmatch_company_policies_scope_type_chk` specifically**, isolated by making `scope_key`
  prefix-consistent so no other CHECK could take the credit
- Three-way parity exact: migration SQL == `schema.ts` == `meta/0037_snapshot.json` == the
  constraint Postgres actually stores
- No real database was accessed or mutated at any point

---

## FINDINGS

### Critical — none

### HIGH — one, now RESOLVED

#### F-A — the M-3 pilot gate locks out every `viewer`, and no roster entry can restore it — **RESOLVED at `111e5322`**

`viewer` is absent from `PILOT_ELIGIBLE_ROLES` (`wizmatchStaffingAccess.ts:13`), and
`resolveStaffingAccess` computes `pilotAllowed = roleEligible && (allUsers || ids.has(userId))` —
role-eligibility is tested **before** roster membership. A `viewer` therefore passes
`wizmatchRequireAdmin` and is then 403'd by `wizmatchPilotGate` on all 82 routes, **including every
GET**, in every runtime, with no configuration that changes it.

This is deliberate, pre-existing gate behaviour (pinned by `wizmatchPilotGate.test.ts:90`). What is
new is M-3 extending it from the policy/today/prepare routers to the main one — and `src/index.ts`
justified `viewer`'s place in that allow-list as *"the read-only Command Deck sync account"*.

*Failure scenario, concrete:* `GE-Brain/scripts/crm-sync.mjs:49-56` reads eight routes from this
router — `/dashboard`, `/command-center`, `/candidate-intelligence/queue`,
`/client-discovery/queue`, `/review-workbench`, `/guardrails`, `/placements`, `/candidates`. If the
sync authenticates as `viewer`, every one returns 403 from the moment this branch is deployed, and
the repo auto-deploys on merge to `main`. The Command Deck's WizMatch card goes stale silently.

*Not fixed here, deliberately:* the remedy is an owner call. Adding `viewer` to
`PILOT_ELIGIBLE_ROLES` or exempting GETs are RBAC/trust-boundary changes a reviewer should not make
unilaterally; re-roling the sync account is an ops action outside this session's authority. All four
options are recorded as a blocking pre-merge checklist item in the go-live runbook (`2b1f074a`),
and the stale `index.ts` comment is corrected.

*Caveat stated honestly:* the repo documents the sync account as `viewer`; I could not confirm the
live account's actual role without production access, which is out of bounds for this review. The
owner must confirm which it is.

### MEDIUM — four, all fixed in this review

- **F-B** — `0037` was amended in place. `drizzle-kit migrate` tracks applied migrations by journal
  entry, not content hash, so on any database where `0037` had already run the new CHECK would be
  **silently skipped forever**. Not triggered — `0037` is unapplied everywhere and G1 is NO-GO — but
  it belongs in the G1 preflight. *Recorded, not fixed (documentation of an ops hazard).*
- **R5-B / M-4 control vacuous** — fixed, `5f045b5d`.
- **R5-C / M-2 control vacuous** — fixed, `5f045b5d`.
- **R3-F5 / H-4 application half untested** — fixed, `5f045b5d`. Most consequential of the three:
  the DB CHECK is not in force until `0037` is applied, so this guard is currently the *only*
  protection against an unrecognised `scope_type`.
- **R5-A / M-5 scope guard evadable** — fixed, `5f045b5d`.
- **R2-1 / cwd-independence overclaim** — fixed, `5f045b5d`.

### LOW — recorded, not fixed

- **R3-F1** — the parity test reads the migration SQL but never `schema.ts`; a `schema.ts`-only
  drift is caught by `npm run db:generate`, not by `npm test`.
- **R3-F2** — `findUnresolvableScopeType` only recognises region/BU/location; an out-of-vocabulary
  scope is inert there rather than affirmatively denying. Unreachable given the CHECK, but the
  safety is delegated to the DB and undocumented in the function.
- **R4-F1** — `TodayBulkActionBar` is never rendered in a real DOM by any test; all coverage is at
  the pure-function level.
- **R4-F2** — the displayed selection count and the capability-driving array are computed
  independently. Unreachable today (`load()` resets selection, no polling — confirmed by both the
  lead and R4), but an unenforced invariant.
- **R4-F3 / disabled focusability** — native `disabled` removes disabled buttons from tab order, so
  a keyboard-only operator cannot land on the reason. Pre-existing and repo-wide.
- **R5-D** — staffing-phase enablement is implemented twice; only one copy had coverage until this
  review.
- **R5-E** — `wizmatchPilotGate.ts:5-11` still describes the pre-P8B-3 permissive behaviour.
- **R5-F** — no path-collision test across the five routers sharing `/api/wizmatch`. No collision
  exists today (both R5 and the lead checked by hand).
- **R1-N2** — no test runs against real Postgres; tenancy assertions are SQL-text or Drizzle-AST
  based. Strictly better than canned mocks, but no query planner is exercised.
- **M-4 dev ergonomics** — Staffing phases now default off locally too; no doc tells a developer to
  set `WIZMATCH_STAFFING_GATE_*_ENABLED`.

---

## BLOCKERS BY GATE

### Before G1 (apply migration `0037`) — unchanged, still NO-GO
- **B-1** — `0037` must be applied before this stack reaches `main`; requires production access.
- **U-7** — owner sign-off on the three shared-table `(tenant_id, id)` indexes.
- Production-sized index-lock measurement and the production `information_schema` drift diff.
- **NEW (F-B)** — re-run the drift check against the *amended* `0037`, and confirm no environment
  has `0037` already recorded as applied, which would silently skip the new CHECK.

### Before G2 (backfill `--apply`)
- Nothing new. Dry-run review against real production data remains the precondition.

### Before G3 (merge + shadow deployment)
- **F-A — RESOLVED in code.** What remains is the mandatory read-only production check of the sync
  principal / role / tenant / endpoints, and the three-member roster configuration. Both are
  checklist items in the go-live runbook, not code blockers.
- Standing: confirm `NODE_ENV=production` on Railway; set `WIZMATCH_STAFFING_PILOT_USER_IDS` to an
  explicit UUID list (not the all-users override, and not containing a `viewer`, who is silently
  denied); set `WIZMATCH_COMPANY_POLICY_ENABLED` and `WIZMATCH_DECISION_WORKBENCH_ENABLED`; run
  `npm run wizmatch:pilot-readiness -- --production --audit-env-file <absolute-path>`; manually
  verify `.ai/OUTBOUND_PR8A_CODE_READY` and `OUTBOUND_PR8B_CODE_READY` (the CLI checks neither).

### Before G4 (promotion to `enforce`)
- Everything carried from PR 3/5/6, plus PR 7's O-2.
- H-4's database half only takes effect once `0037` is applied.
- G3's observation window must show the readiness report's hard preconditions met.

### Owner decisions still open
1. ~~**F-A**~~ — **RATIFIED and implemented.** Narrow machine-sync exception; see above.
2. **PR 7 O-3 / PR8A S2-3** — role tier for `POST .../prepare`. Verified inert while
   `WIZMATCH_AUTO_PREP_ENABLED=false`.
3. **PR 6 M-1 residual** — dedicated `approved_by`/`approved_at` columns. Migration-gated.
4. Whether `--audit-env-file` should hard-reject relative paths (contract change).

### Deferred to PR 9 / PR 10
Unchanged, still gated on U-6 (sanitised Smartlead fixtures). The scope guard is now materially
stronger: `KNOWN_PROVIDERS` is pinned to `['mock']`, which detects a PR 9 provider regardless of
naming or file location — the evasion class R5 found.

---

## CONFIRMATIONS

- **Nothing pushed, merged or deployed.** No PR opened or modified.
- **Migration `0037` not applied to any real database.** All migration work ran on throwaway local
  databases, each dropped by a shell trap; no leftover databases remain.
- **Backfill `--apply` not run.**
- **Sending, automated emails, preparation, the outreach adapter and paid discovery all remain
  disabled.** No code in this branch or this review enables any of them.
- **Enforcement remains `shadow`.** **Smartlead remains disconnected**; no credential exists in the
  tree — only detection logic and synthetic fixtures. No secret value was printed at any point
  (canary-grepped across every readiness run).
- **PR 9 and PR 10 have not started** — `providers/` holds exactly three files, `KNOWN_PROVIDERS` is
  `['mock']`, no migration above `0037`.
- **No guardrail file was modified by this review.** `schema.ts`, `migrations/`, `auth.ts`,
  `rbac.ts`, `cashfree.ts`, `sodEodService.ts` untouched. `src/index.ts` received a comment-only
  edit.
- **`input-data/` untouched** — ignored, zero files tracked, zero staged, never accessed.
- **No destructive git command** — no `reset --hard`, no `clean`, no `checkout --`, no force-push.
  Every mutation restored from a byte-identical backup with a hash assertion.
- **No production, Railway or database access** was taken.
- **Working tree clean** at review close.
