# WizMatch Outbound OS — PR 8B remediation (G3 pilot completion)

- **Branch:** `ge/outbound-08b-g3-pilot-completion`
- **Review base:** `ece8d3ba` (the corrected NOT-CODE-READY review that revoked the false
  `CODE_READY` verdict — see [`wizmatch-outbound-pr8b-opus-review.md`](wizmatch-outbound-pr8b-opus-review.md))
- **Remediated commit (code, before this doc/marker commit):** `84fc340e`
- **Remediated at:** 2026-07-27
- **Method:** five parallel read-only discovery agents (one per finding cluster), reconciled by
  the orchestrating session before any code was written; three isolated git-worktree
  implementation lanes with zero file overlap, run in parallel, each producing its own mutation
  controls; conservative main-session integration (three clean merges, zero conflicts) followed by
  one orchestrator-found-and-fixed integration defect (see below).

## Status

**All six High and all five Medium findings from the corrected review are closed.** All
authoritative gates pass on the fully integrated tree. `.ai/OUTBOUND_PR8B_CODE_READY` remains
absent — this document records remediation, not independent readiness. A fresh, independent
review session owns that verdict.

---

## An integration defect the lane-level gates could not have caught

Every implementation lane's own targeted tests, and the full `npm test` run in each isolated
worktree, passed before merge. But `npm test` never renders a React component — it cannot see a
Rules-of-Hooks violation. Lane 3's H-6 fix added a `useMemo` call in
`TodayDecisionWorkbench.jsx` *after* the component's three existing early `return` statements
(loading / disabled-on-server / error states). On the first render (`loading=true`) the component
returned before ever calling that hook; on the next render it called it — a different hook count
between renders, which is a hard React crash ("Rendered more hooks than during the previous
render"), not a lint warning.

This was invisible until the **full Playwright suite** ran against the integrated tree after all
three lanes were merged: `wizmatch-phase0-local.spec.ts`'s Today test failed on a missing "Today"
heading, and `wizmatch-a11y.spec.ts`'s Today scan failed a color-contrast check — both traced to
the *same* crash. The a11y failure was axe-core scanning the app's error-boundary fallback screen
(which has its own, unrelated, pre-existing contrast issue), not a real regression in the fixed
component. Fixed by moving the `useMemo` to be called unconditionally before any early return
(commit `84fc340e`). Full Playwright suite re-verified at the exact historical baseline —
**99 passed / 15 skipped / 0 failed** — after the fix.

This is the same class of lesson the corrected review itself was built on: a green suite proves
only what it exercises. Backend unit tests and even a clean `npm run admin:build` (a bundler, not
a renderer) cannot catch a hooks-order violation — only running the actual UI can, which is why
the full Playwright gate stayed in the loop rather than being treated as a formality after `npm
test` passed.

---

## Disposition — High findings

### H-1 — blocked-signal tenancy guard had no working control → **CLOSED**

The real production code (`prepareCompanies.ts`'s `fetchBestSignal`, lines 277-293) was already
tenant-safe — both the outer query and the correlated `NOT EXISTS` subquery filter on
`tenant_id`. The defect was entirely in the test: `prepareCompanies.test.ts` asserted
`source.toContain('p.tenant_id = s.tenant_id')` via `readFileSync` on the raw source file, and
that exact string also appears in a doc comment — so the assertion was satisfied by prose, not
real code. The behavioural mock's `excludesBlockedSignals` check never examined tenant
correlation at all.

**Fix:** (1) hardened `excludesBlockedSignals` to also require the tenant-correlation regex; (2)
replaced the doc-comment-vulnerable `readFileSync` assertion with one that captures the actual
runtime SQL text executed inside the test's query-interception mock and asserts against *that* —
structurally immune to comment-satisfaction, since a comment cannot survive into a template
literal's interpolated runtime value.

**Mutation control:** deleted `AND p.tenant_id = s.tenant_id` from the real query → **3 of 25
tests red** (the new runtime-capture test, plus two existing behavioural tests that now correctly
detect the unfiltered fallback). Restored → 25/25 green. `git diff` on the production file was
empty at both checkpoints — it was never actually left mutated.

### H-2 / H-3 — readiness CLI read `.env` from cwd; stale shell exports silently won → **CLOSED**

Implemented the owner-ratified D-R3 contract as an explicit `--audit-env-file <path>` flag
(deviation from the literally-specified `--env-file` name — see below), replacing the import-time
`import 'dotenv/config'` (which resolved `.env` relative to `process.cwd()` with no override of
already-set `process.env` keys). `dotenv.parse()` — never `dotenv.config()` — is used to read the
file without mutating the parent shell environment; when supplied, the file's values are fully
authoritative over anything already exported in the shell. `configuration_source` (`file` or
`process_environment`, plus resolved path) is now printed in the CLI's own report.

**Deviation 1, forced and documented in-code:** `--env-file` was proven — empirically, three ways
(plain `node`, `tsx`, and this repo's actual `npm run wizmatch:pilot-readiness --` wrapper) — to
collide with Node.js's own native `--env-file` flag (Node 20.6+), which intercepts it before the
script runs at all, in every argv position, including after the script path. The real npm-wrapper
invocation form (`npm run wizmatch:pilot-readiness -- --env-file /x`) reproducibly failed with
Node's own `node: /x: not found` error, not the intended script's behaviour. Renamed to
`--audit-env-file`, collision-free, verified through the exact real invocation form operators
will use.

**Deviation 2, forced and documented in-code:** the merge semantics are file-only when
`--audit-env-file` is supplied (no fallback to `process.env` for keys the file omits), not the
literal `{...processEnv, ...parsedFileValues}` spread. The literal formula cannot satisfy the
mission's own scenario 4 (a stale shell credential absent from the file must report clean) —
reproduced the failure empirically, then fixed.

**Scenario matrix — all pass**, run as real subprocess invocations (new first-of-its-kind
subprocess-integration test file, `wizmatchPilotReadinessCli.test.ts`, 16 tests):

| # | Scenario | Result |
|---|---|---|
| 1 | Safe file, repo cwd | exit 0 |
| 2 | Same file, `os.tmpdir()` cwd | identical output |
| 3 | Stale shell `SENDING=true` + file `false` | exit 0, file wins |
| 4 | Stale shell credential, file has none | exit 0, canary never printed |
| 5 | Missing `--audit-env-file` path | non-zero, resolved path in stderr |
| 6 | Unreadable file (directory / chmod 000) | non-zero, clear error, both sub-cases |
| 7 | File has dangerous values (sending / credential) | non-zero, both sub-cases |
| 8 | No flag, safe process env | exit 0, `configuration_source=process_environment` |
| 9 | No flag, dangerous process env | non-zero |
| 10 | No credential value leaks (3 shapes) | zero occurrences of canary |
| — | `--production` threading with `--audit-env-file` | NODE_ENV mismatch → danger; match → pass |

The pre-existing danger-condition checks (`enforce` mode, sending, automated emails, adapter,
preparation, all ten Smartlead credential aliases, the `SL_` prefix false-positive guard, roster
missing/whitespace/malformed/well-formed/all-users-override) were unchanged by this fix — the
core assessor's `env`-parameter contract was not touched — and were re-confirmed green as part of
the full suite (83/83 in the two readiness test files, re-run directly with a verbose reporter
during integration).

**Not fixed, flagged per scope:** `scripts/wizmatch-policy-readiness.ts` and
`scripts/wizmatch-staffing-backfill-preview.ts` share the same cwd-relative `dotenv/config`
pattern, confirmed by grep. Out of this remediation's explicit scope (H-2/H-3 named only the pilot
readiness CLI); recorded here as a candidate follow-up, not fixed.

Runbook updated: `docs/runbooks/WIZMATCH_SMARTLEAD_FREE_PILOT_GO_LIVE.md`'s G3 steps and read-only
verification block now use `--audit-env-file <path>` and explain why not `--env-file`.

### H-4 — policy gate fails open on an unrecognised `scope_type` → **CLOSED**

`outreachGate.ts`'s L1c non-overridable-block scan (~line 476) filtered candidates through
`effective.applicableRows` — built from a closed six-shape scope-key matcher — so a row with any
other `scope_type`, or even a *known*-type row that simply didn't match the request's own resolved
context, was silently invisible to the gate that actually decides whether to block a send.
`decisionWorkbenchActions.ts` scans the unfiltered `effective.allActiveRows` instead, which is why
that side already failed closed correctly.

**Fix:** `outreachGate.ts` now scans `allActiveRows` too, matching `decisionWorkbenchActions.ts`'s
existing pattern. **This is a real behavior change, not a narrow patch:** L1c now denies all
outreach for a company whenever *any* active non-overridable company-or-scope block exists,
regardless of whether the request's own resolved context matches that specific block's scope
(e.g. a non-overridable `region:india` block now also blocks a request that only resolves
`region:us`). Confirmed against `ADR-006-company-outreach-policy.md` D-17 ("non-overridability
binds at any scope... L1c denies at narrower scopes") before accepting the widening as correct,
not merely convenient.

**Mutation control:** reverted to `applicableRows` → the new positive test went red
(`expected 'allow' to be 'deny'`); a dedicated negative control (a non-matching *overridable*
block, which must **not** deny) stayed green throughout, proving the fix isn't simply more
restrictive across the board. Restored → 24/24 green.

Migration `0037_unknown_siren.sql` had no `CHECK` on `scope_type`'s value set at all — see D-R2
below for the constraint that now closes the DB-level half of this finding.

### H-5 — blocked signals still ranked/scored/recommended via client discovery → **CLOSED**

Three confirmed leak vectors, all in `src/routes/wizmatch.ts`'s `fetchClientDiscoverySignals`:
(1) the row-construction query had no policy predicate at all, so a blocked `specific_signal` row
still appeared in discovery results; (2) the `active_signal_count` subquery — a direct scoring
input in `wizmatchClientDiscovery.ts` — also had no exclusion, so a blocked signal inflated its
own company's discovery score even after (1) was fixed; (3) `fetchBlockedScopedIds` was called
only with `'specific_requirement'`, never `'specific_signal'`, anywhere in the repo.

**Fix:** added a tenant-scoped `NOT EXISTS` exclusion against `wizmatch_company_policies` —
mirroring `prepareCompanies.ts`'s existing pattern exactly — to **both** the row filter and the
`active_signal_count` subquery. `wizmatchRequirementPriority.ts` was read in full and confirmed to
touch only requirements, never signals, by design; no change was needed there.
`rankClientDiscoveryQueueWithPolicy`/`scoreClientDiscoveryOpportunityWithPolicy` needed no further
change once blocked signals are excluded at the SQL source.

**Mutation controls, all confirmed red→restore→green:** (1) removing the row-filter exclusion
entirely → 4 tests red; (2) removing only the count-subquery exclusion → 2 count-specific tests
red; (3) removing only the tenant predicate from the new exclusion (not the whole exclusion) →
exactly the dedicated tenant-scoping test and a static source-check go red, proving the tenant
correlation is load-bearing and not merely present. A companion test proves a blocked signal in
tenant B does not affect tenant A's results or counts.

### H-6 — bulk action bar enabled actions the selected rows individually forbade → **CLOSED**

`computeBulkCapability(role)` was a pure role gate with no item awareness, attached once per
response and shared across every queue/action/selection size. Every non-overridable/blocked row
lands in the "Paused or Blocked" queue, which offers `resume` as a bulk action — so the
guaranteed-to-fail combination was the *default* bulk action on the queue where those rows live.
The server already refused every target individually; this was a UI-honesty defect, not a
security hole, but UI honesty was this PR's own stated deliverable.

**Fix (client-side, no server contract change):** `admin/src/lib/todayActionCapabilities.js`
gained `resolveSelectionCapability(selection, action, bulkCapability)` — for a selection of one,
it returns that row's own single-context capability answer (this alone fixes M-0/M-1, below); for
a true multi-select it checks the role gate first (short-circuiting before any intersection, so a
`team_lead` can't get bulk-enabled just because every selected row happens to permit the action
individually), then intersects each selected row's own capability for that action, surfacing the
specific denial reason rather than the generic "Bulk actions require admin" message.
`TodayBulkActionBar.jsx` now resolves each action's enabled/disabled state independently instead
of sharing one capability prop across the whole bar, with the same visible-text +
`aria-describedby` accessible-reason pattern used by the per-row action buttons.
`TodayDecisionWorkbench.jsx` resolves selected ids to their current item objects via a memoized
lookup (see the integration-defect note above for the hooks-order bug this introduced and how it
was fixed).

**Mutation controls:** removing the intersection logic (falling back to the role-only answer) →
2 tests red (mixed-selection, all-non-overridable-selection); removing the single-row bypass → 1
test red (single-row `team_lead`). Both restored to green.

---

## Disposition — Medium findings

### M-0/M-1 — bulk bar denied `team_lead` at selection size 1, where the route allows → **CLOSED**

Closed as part of H-6's fix above: a selection of exactly one row now resolves through the row's
own single-target capability answer, not the always-admin-only bulk role gate. The route's own
`isBulk = targets.length > 1` contract was already correct and needed no change — confirmed by
route-level tests (1-target-`team_lead`-200, 2-target-`team_lead`-403, 1-target-`staff`-403,
already present in `wizmatchTodayRoutes.test.ts` prior to this branch, still passing).

### M-2 — `GET /staffing/access` mounted above the pilot gate → **VERIFIED, no code change**

Independently re-verified against every clause of the D-R1 exception (authenticated; tenant-safe;
current-caller-only; returns no roster members; returns no other user's access; does no
paid/provider/prep/sending/mutation work) by reading the full route handler and
`resolveStaffingAccess`'s complete body, not by re-accepting the prior audit's word. It genuinely
qualifies: the handler takes no id/param, reads exclusively from `req.user`, and
`resolveStaffingAccess` is fully synchronous with no I/O at all. No code change made.

### M-3 — pilot roster did not gate send/spend routes → **CLOSED**

`src/index.ts`'s mount for the 82-route `/api/wizmatch` router now includes `wizmatchPilotGate`:
`app.use('/api/wizmatch', requireAuth, wizmatchRequireAdmin, wizmatchPilotGate, wizmatchRouter)`.
Confirmed the internal-ingest/unsubscribe short-circuit (`/signals/ingest`,
`/signals/:id/(score|enrich|match)`, `/candidates/ingest`, `/classify-reply`, `/unsubscribe`) is
registered earlier and resolves before this mount is ever reached, so machine-to-machine calls
with no `req.user` are unaffected. **This is a real behavior change, disclosed explicitly:** every
GET/read route in the file is now pilot-gated too, not only the mutating ones — consistent with
how `wizmatchToday.ts` already gates its own read route the same way.

**Mutation control:** reverted the gate insertion → 2 of 7 new tests red (the source-scan layer;
a behavioral test suite mounting the real gate + real router also proves a non-roster user 403s on
`POST /signals/:id/send` and the paid-discovery route before the service is ever called). Restored
→ all 7 green.

**Collateral fix, documented as a deviation:** `wizmatchIndexMountOrder.test.ts` (outside this
lane's original ownership) did a literal substring match on the old mount line; updated its three
needles to include `wizmatchPilotGate,` — zero semantic change to that file's own assertions,
required only to keep the mount-order line's exact text in sync.

### M-4 — `NODE_ENV` still selected Staffing phase defaults → **CLOSED**

Both `wizmatchStaffingAccess.ts`'s `phaseEnabled()` and `wizmatchStaffing.ts`'s
`isStaffingPhaseEnabled()` now compute purely from their explicit `WIZMATCH_STAFFING_GATE_*`
flags, defaulting off when unset — no `NODE_ENV` branch in either. All call sites in the existing
test suites already set the relevant flag explicitly; no test fallout.

**Mutation control:** reverted both fixes → the fail-closed-in-production test and the P8B-3
each-role matrix test went red (non-production defaulted open again). Restored → green.

### M-5 — scope-boundary guard was a static 4-name list; capability wiring untested → **CLOSED**

The PR 9/10 scope-boundary guard now uses (1) a directory-membership allowlist on
`src/modules/outreach/providers/` (any new file of any name fails, not only specifically-named
ones — the allowlist itself was corrected during implementation to include the directory's real,
legitimate `index.ts` factory, which the original brief's "exactly two files" premise had missed);
(2) a shape-based identifier regex (`Smartlead\w*(Provider|Adapter|Client|Csv|Export|Import|
Parser)\w*`) instead of a static name list; (3) a migration-number-ceiling check
(`Math.max(...prefixes) === 37`) instead of a literal `0038` check, so it fails on any migration
numbered higher than 37, not only one exact filename.

**Construction-based mutation controls, all planted files removed afterward:** a real
`SmartleadCsvAdapter.ts` planted in the providers directory → both the shape-regex and the
directory-membership checks went red; a dummy `0038_test.sql` → the migration check went red; a
dummy `0039_something.sql` (skipping 0038 entirely, the exact evasion the old literal check
missed) → still correctly red. All restored to green, `git status`/`ls` confirmed no planted file
was left behind.

The previously-missing capability-wiring regression test was added to
`wizmatchTodayRoutes.test.ts`: seeds a blocked company item, calls `GET /today/queues` as two
different roles, and asserts `capabilities`/`bulkCapability` differ meaningfully between them (a
real behavioral branch — admin may override a blocked row, staff may not — not a cosmetic string
difference). Mutation control: hardcoding the role passed into capability attachment → test red;
restored → green.

---

## Owner decisions implemented

- **D-R1 (send/spend route gating):** implemented via M-3 above — the full 82-route router is now
  behind `wizmatchPilotGate`, in addition to its existing auth/tenant/RBAC checks. `GET
  /staffing/access` remains outside the gate under the explicit, independently re-verified
  exception (M-2).
- **D-R2 (scope-type database constraint):** implemented — see below.
- **D-R3 (deterministic readiness environment audit):** implemented as `--audit-env-file` — see
  H-2/H-3 above for the one literal-name deviation, forced and empirically proven necessary.

## Migration 0037 amendment and local verification

Amended (not replaced — no `0038` created) `src/db/migrations/0037_unknown_siren.sql` with:

```sql
CONSTRAINT "wizmatch_company_policies_scope_type_chk"
  CHECK (scope_type IN ('entire_company','region','business_unit','location',
                         'specific_signal','specific_requirement'))
```

placed first in the table's constraint block. The six values are the canonical set from
`docs/prd/005-wizmatch-outbound-operating-system.md:974` and `src/db/schema.ts`, not invented.
Kept in sync across three files that must agree for `drizzle-kit` to see zero drift:
- `src/db/migrations/0037_unknown_siren.sql` (the SQL itself)
- `src/db/schema.ts` (a matching `check()` in the same "scope identity" block)
- `src/db/migrations/meta/0037_snapshot.json` (the drizzle-kit diff baseline)

`SCOPE_TYPES` is now a single source of truth (`src/modules/outreach/policyTypes.ts`, an `as
const` tuple with `ScopeType` derived from it); `policyService.ts` imports it instead of
re-declaring its own copy. `validatePolicyWrite` was confirmed to already throw on an unrecognised
value (fail-closed application logic, the D-R2 requirement's second half).

**Schema/migration parity test** (`wizmatchPolicyScopeTypeParity.test.ts`): regex-extracts the
migration's CHECK value list and asserts set-equality against the imported `SCOPE_TYPES`.
Mutation control, both directions: removing a value from `SCOPE_TYPES` → red; removing the same
value from the migration SQL → red; both restored → green.

**`npm run db:generate` produces zero diff** after the three-file amendment — confirmed twice
(before and after the disposable-Postgres verification's mutation/restore cycles).

**Disposable local Postgres verification** — Docker's daemon was not running in this environment
(the binary is installed but inaccessible); used Homebrew's `postgresql@16` binaries
(`initdb`/`pg_ctl`) on a non-default port with a temp unix-socket dir instead, with guaranteed
`trap`-based teardown:

1. **Fresh replay** (0000→0037 on a clean instance): `db:migrate` exit 0.
2. **Incremental replay** (0000→0036, then the amended 0037 alone on top): exit 0, constraint
   confirmed present.
3. **Valid scope values accepted:** all six canonical values inserted successfully (with real
   tenant/company/signal/requirement fixture rows satisfying the table's other constraints).
4. **Invalid scope value rejected:** `'bogus_scope'` insert rejected by the new constraint.
5. **Reapply behaviour:** re-running `db:migrate` against an already-migrated instance is a safe
   no-op.
6. **Constraints coexist correctly:** a `specific_signal` row satisfying the new scope-type check
   but missing `signal_id` is still rejected by the pre-existing sibling `signal_ref_chk` —
   nothing was loosened by the new constraint.
7. **Teardown confirmed:** both `pg_ctl stop`, both temp directories removed, no stray Postgres
   process left on the verification port, no real/shared `DATABASE_URL` touched at any point.

No `0038` migration was created. No real, shared, or production database was accessed at any
point during this verification.

## Route-gating inventory (summary — full detail in Agent E's discovery report, folded into Lane 3)

All 82 routes in `src/routes/wizmatch.ts` are now behind the pilot roster gate via the single
router-level mount fix (M-3), rather than per-route surgery — deliberately, since partial gating
across 82 densely-mixed routes was judged higher-risk than gating the whole router and disclosing
the (intentional) side effect of also gating reads. `wizmatchPolicy.ts`, `wizmatchToday.ts`, and
`wizmatchPrepare.ts` were already correctly self-gated internally (`router.use(wizmatchPilotGate)`)
before this remediation and needed no change. `GET /staffing/access` is the one deliberate,
re-verified exception (M-2). The internal-ingest/unsubscribe machine-to-machine routes are
resolved by an earlier short-circuit and never reach any of these gates.

## Readiness environment-source contract

Final contract, implemented exactly as specified in D-R3 except for the one forced flag-name
deviation:

- `--audit-env-file <path>` supplied: path resolved to absolute, existence/readability checked
  (hard failure with the resolved path named, no fallback, on either failure); parsed via
  `dotenv.parse()` (never `dotenv.config()`, so the parent shell environment is never mutated);
  file values are fully authoritative over anything already exported in the shell;
  `configuration_source=file` plus the resolved path is reported; no credential value is ever
  printed.
- No flag supplied: `process.env` is inspected as-is; `configuration_source=process_environment`
  is reported; no file is read, implicitly or otherwise.

## Mutation red/green results

All individually documented above, per finding. Summary count: **H-1** (2 red→green pairs),
**H-2/H-3** (11 scenario pairs via real subprocess CLI invocation), **H-4** (1 pair + 1 negative
control), **H-5** (3 pairs), **H-6** (2 pairs), **M-3** (1 pair, 7-test suite), **M-4** (1 pair),
**M-5** (3 construction-based pairs + 1 capability-wiring pair). Every control that should have
stayed unaffected by a given mutation (e.g. H-4's non-matching-overridable-block negative control,
H-5's tenant-B-unaffected proof) was verified to stay green throughout, not only that the intended
assertion went red — proving each fix is scoped correctly, not merely more restrictive everywhere.

## Backend/admin/Playwright results (final integrated tree, after the hooks-order fix)

```
git diff --check                                          → clean
npm run build                                              → tsc, exit 0
npm test                                                    → 130 files / 1469 tests, all green
npm run admin:build                                         → exit 0
npx playwright test --config=playwright.wizmatch-local.config.ts
                                                             → 99 passed / 15 skipped / 0 failed
```

Test count grew from the review baseline (126 files / 1418 tests) to **130 files / 1469 tests**
(+4 files, +51 tests) — every new file and test enumerated in the per-finding sections above.
Playwright's 99/15/0 exactly matches every prior baseline in this stack; the 15 skips remain the
documented no-password real-backend specs.

## Remaining blockers by gate

**G1 (migration approval):** unchanged by this remediation — all of B-1 (apply `0037`), U-7
(shared-index owner sign-off), the production `information_schema` drift review, production-sized
lock measurement, and backup-state confirmation require production access this session does not
have and did not take. See `docs/go-live/WIZMATCH_G1_PRODUCTION_PREFLIGHT.md` (unchanged verdict:
**NO-GO**, for evidence-availability reasons, not a defect in `0037` — this remediation changed
`0037`'s content via the D-R2 CHECK constraint, which does not resolve any G1 blocker, all of
which are about production database access, not migration correctness).

**G2 (backfill approval):** unchanged — dry-run review against real production data remains the
standing precondition, unaffected by this remediation.

**G3 (shadow deployment):** every finding that was G3-blocking in the corrected review (H-1
through H-6, M-0/M-1 through M-5) is now closed. The standing G3 checklist items unrelated to code
(confirm `NODE_ENV=production` on the deployed service; set an explicit pilot roster id list, not
the all-users override; run the readiness CLI against the real deployment's environment with
`--audit-env-file`; enable the two functional-visibility flags) are unchanged human/operational
steps, not defects — G1 must still complete first since migrations run automatically at container
start on this repo's deploy topology (per the G1 preflight's Blocker 5), coupling G1 and G3 in
practice regardless of this remediation.

**G4 (future `enforce`):** unchanged — everything carried from PR 3/5/6/7's still-open items, plus
this pilot's own observation-window precondition. Not attempted or approached by this session.

## Confirmations

- `.ai/OUTBOUND_PR8B_CODE_READY` remains absent.
- Nothing pushed, merged, or deployed. No PR opened or modified during this remediation beyond the
  local branch's own commits.
- Migration `0037` was not applied to any real, shared, or production database — only to disposable
  local instances, created and torn down within this session, on non-default ports with temp
  unix-socket directories.
- `backfill --apply` was not run.
- Sending, preparation, the outreach adapter, paid discovery, and Smartlead all remain disabled;
  enforcement remains `shadow`. No code in this remediation enables any of them.
- No guardrail file was touched outside the explicit, owner-ratified D-R2 exception (`src/db/
  schema.ts`, `src/db/migrations/0037_unknown_siren.sql`, `src/db/migrations/meta/
  0037_snapshot.json` — all three edited strictly for the one CHECK constraint, no `0038` created).
  `src/middleware/auth.ts`, `src/middleware/rbac.ts`, `src/routes/cashfree.ts`, and
  `src/services/sodEodService.ts`'s Slack-DM logic remain untouched.
- `input-data/` remains ignored, untracked, and untouched.
- No PR 9/10 code exists — `wizmatchScopeBoundaryPR8B.test.ts`'s strengthened guard (M-5) confirms
  this mechanically, not only by manual review.
- Working tree is clean at the close of this remediation.
