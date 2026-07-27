# WizMatch Outbound OS — PR 8B independent review (G3 pilot completion)

- **Branch:** `ge/outbound-08b-g3-pilot-completion`
- **Parent:** `ge/outbound-08a-live-pilot-hardening` (CODE READY at `f12c62ca`)
- **Reviewed commit:** `7a0cea2005ad8f8efeb460840b53f5cff201521f`
- **Reviewed at:** 2026-07-27T10:30:00Z
- **Reviewer:** independent Opus review session (not the implementing session)
- **Corrections made during this review:** none to code. **The review's own first verdict was
  corrected — see below.**

---

## FINAL VERDICT

> ## **NOT CODE READY. Marker REVOKED.**
>
> **An earlier revision of this document declared CODE READY at `7a0cea20` with "zero Critical, zero
> High". That verdict was WRONG and is withdrawn.** `.ai/OUTBOUND_PR8B_CODE_READY` was created and
> has been deleted.
>
> **Six High-severity findings**, every one independently re-verified by the review lead. Two of them
> break the readiness CLI that *is* the mechanical G3 gate. One proves a test this review originally
> cited as its own evidence **cannot fail**.

### How the first verdict went wrong — stated plainly

The five parallel review agents were launched as specified, went idle without reporting, and the lead
issued a verdict on the strength of his own pass alone. **The agents then returned complete reports,
and they found what the lead had missed:** six High findings, of which the lead had independently
found exactly one — and had graded it Medium.

The lead's six mutation controls were real and all went red. But *a passing control proves only what
it mutates.* The sharpest instance:

- The lead's mutation 5 deleted the **entire `NOT EXISTS` block** in `prepareCompanies.ts`, correctly
  went red, and was recorded as proving the tenancy guarantee.
- R5 deleted **only the line `AND p.tenant_id = s.tenant_id`** — and **all 25 tests still passed**,
  reproduced by the lead. The accompanying source-grep guard is satisfied by a **doc comment** on
  line 276.

Same file, same guarantee: one mutation red, one green. The green one was the one that mattered. A
"PASS — tenancy" verdict was issued on a control that could not fail.

**Recorded rather than smoothed over:** a single-reviewer pass with genuine mutation discipline still
missed five of six High findings. The parallel-agent structure was not ceremony, and a verdict should
not have been issued while it was outstanding.

---

## Method

Five parallel read-only review agents (R1 policy/tenancy/block-scope, R2 roster/auth/RBAC,
R3 capabilities/UI/a11y, R4 readiness/credentials, R5 test quality), plus the lead's own independent
pass. The agents' reports arrived after the lead had already committed a verdict.

**Every High and Medium below was re-verified by the lead before being accepted** — by mutation, by
red/green command pair, or by reading the named lines. Nothing is accepted on an agent's word alone.

---

## Gates — re-run independently against the integrated tree

```
git diff --check                                          → clean
npm run build                                             → tsc, exit 0
npm test                                                  → 126 files / 1418 tests, all green
npm run admin:build                                       → exit 0
npx playwright test --config=playwright.wizmatch-local.config.ts
                                                          → 99 passed / 15 skipped / 0 failed
```

Every number matches the implementation report exactly.

**The 15 Playwright skips were checked, not assumed.** They are 5 tests × 3 projects, all in
`e2e/wizmatch-e2e-hardening-contact-cap.spec.ts` and `e2e/wizmatch-e2e-hardening-delete-archive.spec.ts`,
every one gated on `test.skip(!TEST_PASSWORD, 'WIZMATCH_E2E_TEST_PASSWORD not set …')`. These are the
documented real-backend no-password skips. No undocumented skip exists, and no skip masks a
PR 8B-relevant assertion.

---

## Mutation controls — six run, six genuinely red

Each mutation was applied to the integrated tree, the targeted suites run, and the file restored from
a byte-identical backup. `git status --porcelain` was confirmed empty after every restore. No
destructive git command was used at any point.

| # | Mutation applied | Result | Proves |
|---|---|---|---|
| 1 | Removed the signal/requirement exclusion from `isCompanyOrScopeFreezingBlock` (`policyResolver.ts:120`) | **6 red across 3 files** | L4 signal blocks genuinely do not freeze company actions |
| 2 | Reinstated the `NODE_ENV === 'production'` roster ternary (`wizmatchStaffingAccess.ts:52`) | **19 red across 5 files** | Roster fail-closed is genuinely environment-independent |
| 3 | Swapped exact-name credential matching for an `SL_` prefix test (`wizmatchPilotReadiness.ts:184`) | **1 red** | The `SL_`-prefix negative case is non-vacuous |
| 4 | Flipped the frontend capability fallback to fail-open (`todayActionCapabilities.js:19,21`) | **6 red** | Missing/malformed capabilities genuinely fail closed |
| 5 | Removed the blocked-signal `NOT EXISTS` from `prepareCompanies.ts` `fetchBestSignal` | **3 red** | A blocked signal genuinely cannot drive a draft |
| 6 | Dropped `eq(tenantId)` from `fetchBlockedScopedIds` (`policyResolver.ts:149`) | **2 red** | The tenant predicate is genuinely asserted, not assumed |

Mutation 2's red count (19 across 5 files) matches the implementation report's claim exactly.

**Mutation 6 is the most important of the six.** This repo has twice shipped tests whose Drizzle mock
discarded `.where()`, so a deleted tenant predicate stayed green (PR 3 review finding B-2). This
review specifically hunted that pattern and found it **closed**:
`src/__tests__/wizmatchRequirementScopeBlock.test.ts:23-34` captures the `where()` condition into
`capturedWhere`, then walks the real Drizzle predicate graph (`collectColumnNames`) and asserts all
five columns are referenced and the caller's tenant id is bound. Deleting the tenant predicate fails
it. That is a real control, not a source regex.

---

## Readiness CLI — all 17 scenarios executed for real

Run via the actual CLI against the integrated tree with `env -i` isolation and **synthetic values
only** (`FAKE-CANARY-DO-NOT-USE-9f3c1a`). No real credential was used or printed at any point.

| # | Scenario | Expected | Observed |
|---|---|---|---|
| 1 | Safe approved configuration | PASS | exit 0, 0 dangers |
| 2 | `--production` asserted, `NODE_ENV=development` | FAIL | `DANGER [runtime:NODE_ENV]`, NOT SAFE |
| 3 | `WIZMATCH_POLICY_ENFORCEMENT_MODE=enforce` | FAIL | exit 1 |
| 4 | `WIZMATCH_SENDING_ENABLED=true` | FAIL | exit 1 |
| 5 | `AUTOMATED_EMAILS_ENABLED=true` | FAIL | exit 1 |
| 6 | `WIZMATCH_AUTO_PREP_ENABLED=true` | FAIL | exit 1 |
| 7 | `WIZMATCH_OUTREACH_ADAPTER_ENABLED=true` | FAIL | exit 1, 2 dangers |
| 8 | `OUTREACH_PROVIDER=smartlead_csv` | FAIL | exit 1 |
| 9 | `SMARTLEAD_API_KEY` present | FAIL | exit 1, **name shown, value not** |
| 10 | `SL_API_KEY` present | FAIL | exit 1, value not printed |
| 11 | `SL_TOKEN` configured alias | FAIL | exit 1, value not printed |
| 12 | Missing roster | FAIL | exit 1 |
| 13 | Whitespace-only roster | FAIL | exit 1 |
| 14 | Malformed roster (non-UUID) | FAIL | exit 1, `pilot-roster:format` |
| 15 | Unknown provider | FAIL | exit 1 |
| 16 | `SL_TIMEZONE` + `SLACK_WEBHOOK_URL` | **must not fail on name alone** | exit 0, 0 dangers |
| 17 | Safe values via a real `.env` copy with a canary | PASS, no secret printed | exit 0, canary count 0 |
| — | All-users override, no explicit roster | FAIL | exit 1 |

Scenario 9's exact output was inspected: `Smartlead-shaped environment variable(s) are set:
SMARTLEAD_API_KEY (value not shown)`. Name disclosed, value withheld — correct.

For scenario 17 a temporary `.env` was created (confirmed gitignored at `.gitignore:4` **before**
creation), used, deleted, and the tree re-verified clean.

---

## Verdicts by area

| Area | Verdict | Evidence |
|---|---|---|
| **Implementation completeness** | **PASS** | All four ratified decisions P8B-1…4 present in the diff |
| **Policy / block-scope** | **PASS** | One shared predicate in `policyResolver.ts:113-121`, imported by `outreachGate.ts`, `decisionWorkbench.ts`, `decisionWorkbenchActions.ts`. Mutations 1 and 5 red |
| **Unknown scope fails closed** | **PASS** | `isCompanyOrScopeFreezingBlock` treats an absent/unrecognised `scopeType` as company-freezing (`policyResolver.ts:120`) — verified by reading, not claimed |
| **Tenancy** | **PASS** | Mutation 6 red. `fetchBlockedScopedIds` filters tenant first; `prepareCompanies.ts` carries `p.tenant_id = s.tenant_id` into the correlated subquery |
| **Canonical resolver** | **PASS** | No second eligibility engine; shared predicates live only in `policyResolver.ts` |
| **Shadow / enforce** | **PASS** | Untouched by this branch beyond the orthogonal L1c/L4 fix; `enforce` remains an exact-string comparison |
| **Pilot roster** | **PASS** | Mutation 2 red across 5 files. `allowed = configured && pilotAllowed`, no environment branch |
| **RBAC vs pilot membership** | **PASS** | Verified by reading every mount: `requireAuth → wizmatchRequireStaffing → featureGate → wizmatchPilotGate → per-route requireRole`. Pilot membership grants no write |
| **Route mount order** | **PASS** | `POST /companies/bulk/policy` (`wizmatchPolicy.ts:111`) precedes `POST /companies/:id/policy` (`:125`). No static route is shadowed |
| **Unauthenticated carve-out** | **PASS** | `src/index.ts:315-322` regexes are anchored to `/signals/ingest`, `/signals/:id/(score\|enrich\|match)`, `/candidates/ingest`, `/classify-reply`, `/unsubscribe`. **None can match a pilot path** — verified |
| **Row/bulk capability parity** | **PASS with a recorded Medium** | `wizmatchCapabilityEnforcementParity.test.ts` runs both the real enforcement path and the prediction against one fixture, with positive and negative cases. See M-2 |
| **Frontend / fail-closed** | **PASS** | Mutation 4 red. `todayActionCapabilities.js` returns `UNKNOWN` (disabled) on absent/malformed data |
| **Accessibility** | **PASS** | Disabled reasons are **both** visible text and `aria-describedby` targets (`TodayDecisionWorkbench.jsx` `ActionButton`, `TodayBulkActionBar.jsx`) — not title-only |
| **Preparation / evidence** | **PASS** | Mutation 5 red. Prep routes verified genuinely inert — see below |
| **Readiness / credentials** | **PASS with a recorded Medium** | All 17 scenarios. See M-1 |
| **Operator guide** | **PASS with a correction** | See L-3 and the roster note below |
| **Test quality** | **PASS** | Six controls red; the historical `.where()`-dropping class is closed |
| **PR 9 / PR 10 boundary** | **PASS** | `wizmatchScopeBoundaryPR8B.test.ts` strips comments and proves its stripping in both directions. No provider impl, no reply-ingestion code, no `0038` |

### Preparation is genuinely inert — verified, not accepted on assertion

The implementation report leans on "the prepare route is inert while `WIZMATCH_AUTO_PREP_ENABLED=false`"
to argue the open PR7 O-3 role-tier decision does not block G3. That claim was checked directly:
`src/routes/wizmatchPrepare.ts:27-34` registers `featureGate` **before** `wizmatchPilotGate`, and it
calls `next('router')` — skipping the entire router, not responding inline. With the flag off, both
`POST /companies/:id/prepare` and `GET /companies/:id/prepare/status` are unreachable. **The claim
holds, and PR7 O-3 genuinely does not block G3 under the required configuration.**

---

## Findings

### Critical — none

### HIGH — six, all re-verified by the lead

#### H-1 — the tenancy guard on the blocked-signal exclusion has no working control (R5-F1)
`src/__tests__/prepareCompanies.test.ts:612-615` asserts `expect(source).toContain('p.tenant_id = s.tenant_id')`.
`src/modules/outreach/prepareCompanies.ts:276` contains that exact string **inside a doc comment**,
so the grep is satisfied by prose. The behavioural mock at `:91-107` interprets the SQL, but its
`excludesBlockedSignals` conjunction checks `NOT EXISTS`, the table name, `scope_type`,
`outreach_eligibility` and `superseded_at` — **never the tenant correlation.**

**Verified by mutation:** deleting only `AND p.tenant_id = s.tenant_id` from `:283` → **25/25 tests
still pass.** The only cross-tenant guard on that subquery has no control at all, and this review's
first revision graded it PASS.

#### H-2 — readiness CLI reads `.env` from `cwd`, silently ignoring the audited file (R4-H1)
`scripts/wizmatch-pilot-readiness.ts:28` uses `import 'dotenv/config'`, which resolves `.env` relative
to `process.cwd()`, while `repoRoot` is resolved independently from `__dirname`. Run from any other
directory and the file is ignored with no "loaded 0 variables" notice — and every marker/migration
check still reports OK, because those key off `repoRoot`.

**Verified by red/green pair**, same dangerous `.env` (sending enabled + a fake Smartlead credential):
from another cwd → `RESULT: no dangerous configuration detected`, exit 0. With `cwd` set to the file's
directory → **2 DANGERs, NOT SAFE.** The runbook's G3 step instructs exactly the failing usage.

#### H-3 — stale shell exports silently override the audited `.env` (R4-H2)
dotenv does not override variables already in `process.env`. **Verified:** a `.env` with
`WIZMATCH_SENDING_ENABLED=true` and a Smartlead credential, with the safe values exported in the
shell → "sending is off", "No Smartlead-shaped environment variable is set", **exit 0.** This repo's
own dev workflow exports those same variables.

**H-2 and H-3 together mean the readiness CLI can report SAFE against a configuration with sending
enabled and a live Smartlead credential present.** It is the mechanical G3 gate. This is why the
"all 17 scenarios pass" result in this document is necessary but **not sufficient** — the matrix
passes env vars inline and never exercises the `.env` path the runbook actually prescribes.

#### H-4 — the gate fails OPEN on an unrecognised `scope_type` (R1-F1)
`outreachGate.ts:476` scans `effective.applicableRows`, built from `buildCandidateScopeKeys` — a
closed list of six known scope shapes. A row at any other `scope_type` never becomes a candidate, so
the gate never sees it. `decisionWorkbenchActions.ts:256` scans `allActiveRows` and **does** catch it.
The two layers disagree, and **the side that gates the send is the one that fails open.**

**Verified:** there is no `CHECK (scope_type IN (...))`. `0037_unknown_siren.sql:21` is a bare
`"scope_type" text NOT NULL`, and every constraint at `:44-55` is a conditional an unrecognised value
satisfies vacuously. Validation exists only in app code (`policyService.ts:158`) — which a backfill
or manual SQL bypasses. **The G2 backfill is the realistic write path.**

#### H-5 — blocked signals still rank, score and drive recommendations (R1-F2)
PR 8B closed the blocked-signal leak at two call sites and this document graded that **PASS**. There
is a **third**. **Verified:** `routes/wizmatch.ts:396` maps `id: row.id` from
`SELECT s.id FROM wizmatch_job_signals s`, so `ClientDiscoveryInput.id` **is the signal id**;
`fetchBlockedScopedIds` is called **only** with `'specific_requirement'`, never `'specific_signal'`;
and `active_signal_count` (`routes/wizmatch.ts:450-452`) carries **no policy predicate** while being a
scoring input (`wizmatchClientDiscovery.ts:217-220`). A blocked signal still ranks, still recommends,
and still raises its own company's discovery score.

#### H-6 — the bulk bar enables actions the selected rows individually forbid (R3-H1)
`decisionWorkbenchCapabilities.ts:168-172` — `computeBulkCapability` takes **only** the role and never
sees an item. **This review originally graded it Medium; that was too low.** R3's reachability
argument is correct and decisive: `decisionWorkbench.ts:618` routes **every** non-overridable company
into "Paused or Blocked", and `TodayDecisionWorkbench.jsx:41` offers `resume` as a bulk action on
exactly that queue. The guaranteed-to-fail combination is the **default bulk action on the queue
where those rows all live.** The card renders "No action available" while the bar above it renders
Resume enabled — from data already in the same payload.

Not a security hole: the server refuses every target at `decisionWorkbenchActions.ts:256-264`. But
per-target results are a safety net, not an honesty mechanism, and UI honesty *is* this PR's
deliverable.

---

### MEDIUM — verified

#### M-0 — bulk bar denies `team_lead` at selection size 1, where the server allows (R3-H2)
`wizmatchToday.ts:98` defines `isBulk = targets.length > 1`, but the bar renders whenever
`size > 0` (`TodayDecisionWorkbench.jsx:517`) and always resolves the admin-only bulk answer.
**Verified.** A `team_lead` selecting one row is told "Bulk actions require admin" — a false
statement. Fail-closed, but the UI gives two answers for one action.

#### M-01 — `GET /staffing/access` is registered above the pilot gate (R2-F1)
**Verified:** `wizmatchStaffing.ts:39` registers the route; the gate `router.use` is at `:46`. Express
runs layers in registration order, so this is the one Staffing OS route reachable without roster
membership. It returns `{allowed, configured, phases, role, capabilities}` — a config-state oracle for
any role in the mount allow-list. Roster ids do **not** leak.

#### M-02 — the pilot roster does not gate the send/spend routes (R2-F2)
**Verified:** `src/index.ts:361` mounts the 82-route `wizmatchRouter` behind `requireRole` only —
`grep -c wizmatchPilotGate src/routes/wizmatch.ts` → **0**. `POST /signals/:id/send`,
`/contact-intelligence/…/discover`, `/signals/:id/discover-poc` and `/client-discovery/seed-company`
live there. A `team_lead` deliberately left **off** the roster can still trigger contact discovery,
and once sending is enabled, a real send. **The roster restricts the workbench but not the things
that cost money or email a human** — the opposite of how "pilot roster" reads in the runbook. Either
extend the gate or state the boundary explicitly in the runbook and operator guide.

#### M-03 — `NODE_ENV` still selects Staffing phase defaults (R2-F3, upgraded from this review's L-2)
`wizmatchStaffingAccess.ts:23` and `wizmatchStaffing.ts:31` both return `NODE_ENV !== 'production'`
when the phase flag is unset. The second is a **live 404 gate** on phase B/C routes. This review
originally recorded it as Low on the grounds that phases are display-only; R2 showed the second call
site is admission-adjacent. The P8B-3 comment's "no environment-string branch" is true of `allowed`
and **not** of the file.

#### M-04 — the capability-attachment wiring has no test (R5-F4)
**Verified:** `grep -ic capabilit src/__tests__/wizmatchTodayRoutes.test.ts` → **0**. Reverting
`wizmatchToday.ts:86` to `res.json(queues)`, or hardcoding `'admin'` for `req.user?.role`, leaves
1418/1418 green. That wiring **is** P8B-2's deliverable and the S2-4 fix.

#### M-05 — the PR 9/10 scope-boundary guard proves far less than claimed (R5-F3)
**Verified by construction:** `export class SmartleadCsvAdapter {}` — an entirely plausible PR 9 name
— **evades** the guard, as does `smartleadExport()`. It is a four-identifier name list. The migration
check tests only the `0038` prefix, so `0039` passes. Either strengthen it or downgrade the claim
that it proves "PR 9 and PR 10 have not started".

#### M-1 (Medium) — the readiness CLI's required-marker list stops at PR 8

`src/services/wizmatchPilotReadiness.ts:36-45`. `REQUIRED_CODE_READY_MARKERS` covers PR 2, 3, 5, 6, 7
and 8. It does **not** require `OUTBOUND_PR8A_CODE_READY`, and it has no PR 8B marker check at all —
PR 8A appears only as a *warning* on its self-reported `IMPLEMENTED` marker (`:133-140`).

*Failure scenario:* an operator runs `npm run wizmatch:pilot-readiness -- --production` as the G3
gate on a tree where PR 8A and PR 8B were never independently reviewed. The CLI reports "no dangerous
configuration detected" and exits 0, because it never asks about those markers.

*Why it is not fixed here:* the readiness tests run against the **real** repo root
(`wizmatchPilotReadiness.test.ts:13`), so adding `OUTBOUND_PR8B_CODE_READY` to the required list
couples the suite to a marker this same session creates. Under Stage 1B's policy — fix Critical and
High, record Medium and Low — this is recorded rather than fixed.

*Mitigation, mandatory:* **G3 must verify both markers by hand.** This is now an explicit checklist
item; do not treat a green CLI as covering it.

### M-2 (Medium) — the bulk action bar is a pure role gate and can enable a per-row-refused action

`decisionWorkbenchCapabilities.ts:168-172` — `computeBulkCapability` considers **role only**. It does
not reconcile the states of the N selected rows.

*Failure scenario:* an admin selects 10 companies, 3 of which carry non-overridable company-scope
blocks, and clicks "Approve & Queue". The button was enabled; 7 succeed and 3 are refused.

*Why it is not a G3 blocker:* the server remains authoritative and `runTodayActions` returns
**per-target results — never a silent partial success**, so the operator is told exactly which rows
were refused and why. The behaviour is disclosed in the module's own header. Closing it properly
means client-side reconciliation of N heterogeneous rows, which is a design change beyond this
branch's four ratified decisions. Recorded for the owner; suitable for a follow-up PR.

### L-1 (Low) — stale security comment in `wizmatchPilotGate.ts`

`src/middleware/wizmatchPilotGate.ts:8-11` still states the gate "is permissive only in non-production
so local dev/test does not require the roster to be configured". **P8B-3 deleted that behaviour.** The
code is correct; the comment describes the defect that was removed, and could mislead a future
engineer into "restoring" the permissive branch. The file is not in this branch's diff, so correcting
it is left as a one-line follow-up rather than an unrelated file addition.

### L-2 (Low) — residual `NODE_ENV` dependency in the same file

`src/services/wizmatchStaffingAccess.ts:23` — `phaseEnabled()` still defaults to
`env.NODE_ENV !== 'production'`. This affects Staffing OS **phase visibility** only, is consumed
behind `access.allowed` (`admin/src/App.jsx:203`), and does not touch any PR 8B pilot surface. Not a
pilot-gate hole. Recorded so it is not mistaken for one, and so a future reader does not assume
P8B-3 removed every `NODE_ENV` branch from this file.

### L-3 (Low) — implementation report imprecision

The report states capability attachment happens on "both routes" (Lane B2). `wizmatchToday.ts`
defines two routes, but only `GET /today/queues` returns items and only it needs capabilities;
`POST /today/actions` enforces its own role allow-list. Nothing is missing — the wording is loose.

### L-4 (Low) — one tautological assertion

`wizmatchRequirementScopeBlock.test.ts` asserts `expect(serialised).not.toContain('tenant-2')`, but
`tenant-2` appears nowhere in the fixture, so the assertion cannot fail. Harmless — the positive
assertions in the same test carry the guarantee (mutation 6 proves it) — but it is not the control it
reads as.

---

## A behavioural fact that changes the G3 roster and the onboarding role matrix

**`viewer` is not a pilot-eligible role.** `PILOT_ELIGIBLE_ROLES`
(`wizmatchStaffingAccess.ts:13`) is `admin, team_lead, manager_ops, sales, staff` — `viewer` is
absent, even though `wizmatchRequireStaffing` (`src/index.ts:326`) admits it to the coarse gate. A
`viewer` is therefore **403'd at the pilot gate and cannot read the pilot surfaces at all**, even when
explicitly named on the roster. This is tested deliberately
(`wizmatchPilotGate.test.ts:90,139`; `wizmatchTodayRoutes.test.ts:132`).

This matters because the orchestration brief's Phase 9 smoke-test plan assumes a "pilot viewer reads
but cannot mutate" tier. **That tier does not exist.** The real read-only tier inside the pilot is
`staff` / `manager_ops` / `sales`: they pass the pilot gate and can read queues and policy, but every
mutation requires `team_lead`+ (policy write, owner assign, duplicate resolve, single Today action) or
`admin` (override, bulk, readiness report, all bulk Today actions).

The G3 roster and the Phase 10 role matrix must be written against the real tiers, not the assumed
one. This is a specification-versus-implementation mismatch in the brief, not a defect in the code.

---

## Blockers by gate

### Before G1 (migration 0037)
- **B-1** (carried) — 0037 must be applied before PR 3's code reaches `main`; `suppress()` writes
  `wizmatch_suppression_events`, which only 0037 creates. Requires production access.
- **U-7** (carried) — owner sign-off on the three shared-table `(tenant_id, id)` indexes on `users`,
  `contacts`, `contact_channels` (Growth-tenant tables).
- Production-sized index-lock measurement and the production `information_schema` drift diff — neither
  is possible from a local database.

### Before G2 (backfill `--apply`)
- Nothing new from this branch. Dry-run review against real production data remains the precondition.

### Before G3 (merge + shadow deployment)

**BLOCKING — must be fixed and re-reviewed before PR 8B can be CODE READY:**
- **H-1** — fix the `prepareCompanies` mock to assert the tenant correlation; delete the source grep.
- **H-2 / H-3** — load `.env` from an explicit absolute path with `{ override: true }`, print the
  resolved path, and raise a `danger` when nothing parsed.
- **H-5** — mirror the requirement fix into `rankClientDiscoveryQueueWithPolicy` /
  `scoreClientDiscoveryOpportunityWithPolicy`, plus a `NOT EXISTS` on `active_signal_count`.
- **H-6 / M-0** — intersect the bulk capability with the selected rows, and switch on count.
- **M-01** — move `GET /staffing/access` below the pilot gate.
- **M-02** — extend the pilot gate to the send/spend routes, **or** state the boundary explicitly in
  the runbook and operator guide. Owner's call which.
- **M-03** — default the Staffing phase flags to false.
- **M-04** — add the capability-attachment route test.
- **M-05** — strengthen the scope-boundary guard or downgrade its claim.

**H-4** does not block G3 (shadow blocks nothing) but **blocks G4**, and its `CHECK (scope_type IN …)`
half must be sequenced into a migration — **not `0038`**, which this session is forbidden to create.

**Standing checklist items (unchanged):**
- Confirm `NODE_ENV=production` on the deployed Railway service — **now verified**, see below.
- Set `WIZMATCH_STAFFING_PILOT_USER_IDS` to an explicit UUID list — **not** the all-users override,
  and **not** containing a `viewer`, who would be silently denied.
- Set `WIZMATCH_COMPANY_POLICY_ENABLED=true` and `WIZMATCH_DECISION_WORKBENCH_ENABLED=true`.
- Run `npm run wizmatch:pilot-readiness -- --production` against the real environment.
- **NEW (M-1):** manually verify `.ai/OUTBOUND_PR8A_CODE_READY` and `.ai/OUTBOUND_PR8B_CODE_READY`
  both exist — the CLI does not check either.

### Before G4 (promotion to `enforce`)
- Everything carried from PR 3/5/6, plus PR 7's O-2 (cross-job duplicate-contact race, migration-gated).
- G3's observation window must show the readiness report's hard preconditions met.
- M-2 (bulk capability honesty) should be closed before enforcement makes a refusal consequential.

### Owner decisions still open — neither blocks G3
1. **PR 7 O-3 / PR8A S2-3** — role tier for `POST .../prepare` (currently staff+). **Verified inert**
   while `WIZMATCH_AUTO_PREP_ENABLED=false`. Must be ratified before preparation is ever enabled.
2. **PR 6 M-1 residual** — dedicated `approved_by`/`approved_at` columns versus the current
   actor/source/event-chain provenance. Migration-gated.

### Deferred to PR 9 — unchanged, still gated on U-6 (sanitised Smartlead fixtures)
### Deferred to PR 10 — unchanged (tenant-pinned reply poller, event-map constraints)

---

## Confirmations

- **Nothing pushed, merged or deployed.** No PR opened during this review.
- **Migration `0037` not applied** to any database. No `0038` exists.
- **Backfill `--apply` not run.**
- **Sending, automated emails, preparation, the outreach adapter and paid discovery all remain
  disabled.** No code in this branch enables any of them.
- **No Smartlead credential exists** in the tree; only detection logic and synthetic test fixtures.
- **Enforcement remains `shadow`.**
- **No guardrail file touched** — `schema.ts`, `migrations/`, `auth.ts`, `rbac.ts`, `cashfree.ts`,
  `sodEodService.ts` all confirmed absent from the diff.
- **`input-data/` untouched** — ignored, 0 files tracked, 0 staged, never accessed.
- **No force-push, no `git reset --hard`, no `git clean`, no destructive command** at any point.
- **No production, Railway or database access** was taken during this review.
- **Working tree clean** at review close.
