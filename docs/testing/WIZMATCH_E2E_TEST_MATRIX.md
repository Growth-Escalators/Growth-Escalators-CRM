# WizMatch — E2E test matrix, 2026-07-30

Branch `qa/wizmatch-full-playwright-flow-remediation`.

**A skipped test is never recorded as a pass in this matrix.** That rule exists because the previous
run's headline counts overstated real coverage: 15 real-backend tests skipped silently and were
counted as green. See register QA-7.

---

## How to run each suite

| Suite | Command | Needs |
|---|---|---|
| Unit / integration (vitest) | `npm test` | nothing |
| WizMatch real-backend E2E | `bash scripts/run-wizmatch-e2e.sh` | disposable Postgres + seeded fixtures |
| WizMatch mocked-session E2E | `npx playwright test --config=playwright.wizmatch-local.config.ts` | nothing (admin Vite boots itself) |
| Contracts / e-signature E2E | `bash scripts/run-contracts-e2e.sh` | disposable Postgres |
| Seed synthetic fixtures | `npx tsx scripts/qa/seed-fixtures.ts` | `DATABASE_URL` naming a `qa`/`test` database |
| Reset synthetic fixtures | `npx tsx scripts/qa/seed-fixtures.ts --reset` | as above |

`run-wizmatch-e2e.sh` exists specifically because exporting the test credential in one shell and
running Playwright in another loses it — the cause of QA-7. It also **fails the run (exit 3) if any
test skips**, and refuses any database whose name lacks `test`/`qa`/`e2e` (exit 2).

---

## Automated suite — final state

| | Count |
|---|---|
| Test files | **138** (baseline 132) |
| Tests passed | **1615** (baseline 1557) |
| Failed | **0** |
| Skipped | **0** |
| Flaky / retried | **0** |
| Build (`tsc`) | exit 0 |
| `admin:build` | exit 0 |
| Statement coverage | 49.62% |
| Branch coverage | 45.74% |
| Line coverage | 51.25% |
| Duration | ~9s |

**+58 tests added by this run**, all tied to a specific confirmed defect and all mutation-verified.

---

## Regression tests added

| File | Tests | Defect | Mutation proof |
|---|---|---|---|
| `wizmatchMachineSyncLaneMountIntegration.test.ts` | 9 | QA-1 | 8 paths returned 403 before the fix |
| `onConflictAmbiguousColumnGuard.test.ts` | 3 | QA-17 | revert qualification → red (guard itself was vacuous twice — see register) |
| `auth.test.ts` (socket handshake) | 7 | QA-18 | revert wiring → red |
| `timingSafeSecretMatch.test.ts` | 9 | QA-19 | revert one site to `!==` → red |
| `auth.test.ts` (tenant binding) | 7 | QA-2 | delete the tenant comparison → 4 red |
| `auth.test.ts` (deactivation) | 3 | QA-6 | remove check → 2 red; `=== false`→`!` → 1 red |
| `usersIsActiveMigrationGuard.test.ts` | 5 | QA-3 | strip `IF NOT EXISTS` → 1 red |
| `jobQueueTenantScope.test.ts` | 6 | QA-4 | neuter predicate → 4 red |
| `sequenceWorkerSendGate.test.ts` | 6 | QA-5 | remove check → 5 red; flip fail-closed → 1 red |
| `wizmatchScopeBoundaryPR8B.test.ts` | +2 | guard re-expressed as intent | allowlist control |
| `wizmatchPilotReadiness.test.ts` | +1 | sentinel still fires | real 0039 probe file |

---

## Journey coverage — honest status

`EXECUTED` = ran and passed. `NOT RUN` = no executed coverage from this run. **`NOT RUN` never
implies broken, and never implies working.**

| Journey | Status | Evidence |
|---|---|---|
| **A — Authentication & access** | **EXECUTED** | `wizmatch-qa-real-backend-auth-safety.spec.ts` + 10 unit tests. Covers tenant binding, `token_version` revocation, deactivated users, roster admission, roster-UUID case sensitivity |
| **B — Today / Decision Workbench** | **NOT RUN** | Queue construction has unit coverage; no executed UI coverage of queues, precedence, filters, URL persistence, pagination, selection, bulk permissions, the 8 action flows, or the concurrent-update conflict |
| **C — Company Policy** | **PARTIAL** | Rules unit-tested; not re-verified via UI/API this run. a11y scan of the page did run |
| **D — Job Leads → Company** | **NOT RUN** | Cold-start policy transaction has unit coverage |
| **E — Contact discovery & confidence** | **NOT RUN** | Confidence tiers, suppression grain, bounce/unsubscribe/complaint all unverified |
| **F — Requirements** | **NOT RUN** | Unit coverage only |
| **G — Candidates & matching** | **NOT RUN** | **Java≠JavaScript and broad-SAP≠SAP-module were NOT verified** |
| **H — Submissions / interviews / placements** | **NOT RUN** | Tables and routes exist and are real; behaviour unverified |
| **I — CRM ops pages** | **NOT RUN** | — |
| **J — Negative outreach safety** | **EXECUTED (static + spec)** | Every gate confirmed fail-closed when its flag is *unset*, not merely `false`. No gate found fail-open |
| **K — Accessibility** | **EXECUTED** | axe on Login, Job Leads, Requirements, Company Policy, Duplicate Companies + mobile horizontal-overflow |

---

## Browser matrix

| Browser | Status |
|---|---|
| Chromium | Used for all executed Playwright work |
| Firefox | **NOT RUN** |
| WebKit | **NOT RUN** |

Viewports exercised: desktop 1440×900, tablet 1024×768, mobile 390×844 (the existing hardening
config drives all three for its specs).

---

## Sending / spend safety — gate-by-gate

Every gate below was confirmed to fail closed when its flag is **absent**, which is the case that
matters: an unset variable must not read as permission.

| Gate | Enforcement point | Unset ⇒ |
|---|---|---|
| `WIZMATCH_SENDING_ENABLED` | `wizmatch.ts:2999-3004` | **Closed** (403 `sending_disabled`) |
| `AUTOMATED_EMAILS_ENABLED` | `multiDomainMailer.ts:53-55` | **Closed** (throws) |
| `WIZMATCH_AUTO_PREP_ENABLED` | `wizmatchPrepare.ts` feature gate | **Closed** |
| Paid discovery / Apollo / Snov | `wizmatchContactDiscovery.ts:90,166,329,339` | **Closed** |
| Google fallback | `wizmatchContactDiscovery.ts:115,318` | **Closed** |
| Provider selection | readiness checker | Unrecognised provider ⇒ dangerous |
| SMTP transport | `multiDomainMailer.ts:111,180` | Never built at module load; only inside the gated path |
| Sequence dispatch | `sequenceWorker.ts` (**added this run**) | **Closed** |

`WIZMATCH_POLICY_ENFORCEMENT_MODE` defaults to **shadow**, deliberately. It is a compliance gate
layered on top of the master switches, not a substitute — and enabling enforcement beyond shadow was
explicitly out of scope for this run.

---

## Environment used

| | |
|---|---|
| PostgreSQL | **18.4** (disposable cluster, port 5433, trust auth, TCP-only) — separate from the developer's PG 16.13 on 5432, which was never touched |
| Migration replay | Clean from empty: 98 tables, 39 migrations |
| Node | v24.13.0 (repo declares `>=20`) |
| Playwright | 1.59.1 |
| Synthetic tenants | `wizmatch-test`, `growth-escalators-test` |
| Synthetic identities | 10, all `@example.invalid` |
| Production access | **Read-only static analysis only. No production write, deploy, env change, send, or provider call occurred.** |

---

## Production read-only smoke (Phase 5)

**UNPERFORMED.** Authenticated production sessions were not available and no password was requested
or used. Per the brief this is recorded as UNPERFORMED, **not** as passing.

That leaves these unverified against the live deployment: current deployment commit, real backend
health, per-operator surface access, the five Today queues, machine GET lane behaviour, latest cron
status, live Redis errors, and live effective feature flags.
