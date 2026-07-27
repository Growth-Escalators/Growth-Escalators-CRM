# WizMatch Outbound OS — PR 8B independent review (G3 pilot completion)

- **Branch:** `ge/outbound-08b-g3-pilot-completion`
- **Parent:** `ge/outbound-08a-live-pilot-hardening` (CODE READY at `f12c62ca`)
- **Reviewed commit:** `7a0cea2005ad8f8efeb460840b53f5cff201521f`
- **Reviewed at:** 2026-07-27T10:30:00Z
- **Reviewer:** independent Opus review session (not the implementing session)
- **Corrections made during this review:** none — no Critical or High defect was found

---

## FINAL VERDICT

**CODE READY at `7a0cea20`.** Marker written: `.ai/OUTBOUND_PR8B_CODE_READY`.

Zero Critical, zero High. Two Medium and four Low findings are recorded below; none blocks G3 under
the required initial pilot configuration. Unlike PR 8 (six High fixed during review) and PR 8A (three
High fixed during review), this branch required **no corrective commit** — the submitted code
survived every control this review ran.

That verdict is deliberately narrow: it certifies the **code**. It does not certify the production
schema, the backfill, or the deployment, all of which remain gated behind G1/G2/G3 approval tokens.

---

## Method, and an honest limitation

Five parallel read-only review agents were launched as specified (R1 policy/tenancy/block-scope,
R2 roster/auth/RBAC, R3 capabilities/UI/a11y, R4 readiness/credentials, R5 test quality). **All five
went idle without returning their reports** despite three escalating requests each. No agent output
was received, so **nothing in this document rests on a subagent's word.**

The review lead therefore performed all five lanes directly. This is stated plainly rather than
papered over, because the implementation report's own credibility rests on a five-agent
reconciliation and a reader is entitled to know this review could not reproduce that structure. What
this review substitutes for it is *more* mechanical evidence, not less: six red/green mutation
controls executed against the integrated tree, all seventeen readiness scenarios executed for real,
and line-by-line reading of every changed source file.

Where a claim below says "verified", it means the lead ran the command or read the lines and can
name them. Where it says "assessed", it means reasoned judgment without a mechanical control.

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
### High — none

### M-1 (Medium) — the readiness CLI's required-marker list stops at PR 8

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
- Confirm `NODE_ENV=production` on the deployed Railway service (no code check can substitute).
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
