# WizMatch — full platform validation and remediation, 2026-07-30

**No credential, secret, connection string, token or personal datum appears in this file.**

Companion documents:
[breakage register](WIZMATCH_BREAKAGE_AND_FIX_REGISTER.md) ·
[current platform behaviour](WIZMATCH_CURRENT_PLATFORM_BEHAVIOUR.md) ·
[remaining gaps and roadmap](WIZMATCH_REMAINING_GAPS_AND_ROADMAP.md) ·
[E2E test matrix](WIZMATCH_E2E_TEST_MATRIX.md)

---

## 1. Executive verdict

> ## LIMITED PILOT READY — REMAINING GAPS DOCUMENTED

The two-user internal pilot can continue. **Nine defects were confirmed and fixed**, including a
**CRITICAL cross-tenant data exposure** and a **HIGH that made contact discovery return 500 on every
call** — neither found by any previous run. Every sending, spending and
provider gate was confirmed fail-closed. Nothing was enabled, deployed, or sent.

It is **not** FULL PLATFORM READY, and the reason is coverage rather than a known blocking defect:
**eight of eleven required journeys (B–I) have no executed end-to-end coverage from this run**, and
Firefox/WebKit were not exercised. The brief forbids declaring full readiness while critical
journeys are untested, and they are. Saying otherwise would misrepresent what was actually verified.

It is not PILOT NOT READY either: no defect blocking the current two-user pilot remains open. The
CRITICAL that was found is fixed; the CRITICAL that remains (Upstash) is a billing decision outside
this repo and does not touch the WizMatch pilot surface.

---

## 2–3. Commit and branch tested

| | |
|---|---|
| Branch | `qa/wizmatch-full-playwright-flow-remediation` |
| Base | `origin/main` at **`f8036120`** |
| Commits added | 11 |

**The brief's expected base commit was `4678d505`. It was stale** — `origin/main` had advanced to
`f8036120` (PR #91, which merged the previous QA run's auth fixes and its failure matrix). The brief
told me to verify rather than assume; this run is based on the actual tip. That matters, because PR
#91 had already fixed H-2/H-3/H-4, so those are correctly reported here as already-closed rather
than re-found.

---

## 4. Environment architecture

| | |
|---|---|
| Database | Disposable **PostgreSQL 18.4** cluster, port **5433**, trust auth, TCP-only, datadir outside the repo |
| Isolation | The developer's PostgreSQL **16.13** on 5432 was never used, written to, or stopped |
| Node | v24.13.0 (repo declares `>=20`) |
| Playwright | 1.59.1, Chromium |
| Production | **Read-only static analysis only.** No production write, deploy, env change, send, provider call, or spend occurred |

PostgreSQL 18 was required by the brief and was installed but not running; a fresh throwaway cluster
was initialised rather than reusing the developer's PG 16 instance.

---

## 5. Synthetic fixtures

Two tenants (`wizmatch-test`, `growth-escalators-test`) and ten identities covering the access
matrix: two pilot admins, a team lead, staff, a non-pilot admin, a machine viewer, an inactive
former employee, an other-tenant admin, a mixed-case email, and a duplicate-email collision.

Every address is on `@example.invalid`. Companies are limited to the three approved synthetic names.
**No production datum was copied.** The seed is deterministic and idempotent.

**Production-safety interlock, verified firing:** the seed refuses to run when `NODE_ENV=production`,
when `DATABASE_URL` is unset or unparseable, or when the target database name lacks `qa`/`test` — a
database named `realprod` is refused with a named error, not a warning.

---

## 6. Baseline before any change

Clean `npm ci` → build → test → admin:build, before editing anything:

| | |
|---|---|
| `npm ci` (root + admin) | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | **132 files / 1557 tests, all passing** |
| `npm run admin:build` | exit 0 |
| Playwright, mocked-session config | ran; the real-backend hardening specs **skipped** (finding QA-7) |

**The baseline was entirely green.** Every defect in this report was invisible to the existing suite
— which is the substantive finding of this run, and the reason each fix ships with a test proven to
fail without it.

---

## 7–9. Feature, route and role inventory

Full inventories are in the companion documents. In summary: ~82 routes behind `wizmatchRouter`,
plus three flag-gated routers (policy 9 routes, today 2, prepare 2), the staffing router, and the
shared CRM surface.

**Every WizMatch request passes two independent locks: role, and pilot-roster membership.** An
unconfigured roster fails closed in *every* environment, local included — there is no
`NODE_ENV`-based escape hatch.

The `viewer` role is a **machine** account, not a human tier: blocked from every non-GET request by
construction, and admitted to exactly 8 GET paths via the machine-sync lane.

---

## 10. Browser matrix

| Browser | Status |
|---|---|
| Chromium | All executed Playwright work |
| Firefox | **NOT RUN** |
| WebKit | **NOT RUN** |

Viewports: desktop 1440×900, tablet 1024×768, mobile 390×844.

---

## 11. Journey results

| Journey | Result |
|---|---|
| A — Authentication & access | **EXECUTED** |
| B — Today / Decision Workbench | **NOT RUN** |
| C — Company Policy | **PARTIAL** (unit-covered; not re-verified via UI/API) |
| D — Job Leads → Company | **NOT RUN** |
| E — Contact discovery & confidence | **NOT RUN** |
| F — Requirements | **NOT RUN** |
| G — Candidates & matching | **NOT RUN** — including Java≠JavaScript and SAP-module specificity |
| H — Submissions / interviews / placements | **NOT RUN** |
| I — CRM ops pages | **NOT RUN** |
| J — Negative outreach safety | **EXECUTED** |
| K — Accessibility | **EXECUTED** |

This is the honest limit of the run. Eleven journeys of 10–20 sub-requirements each is multiple days
of work; the time available was spent on depth in authentication, outreach safety and the confirmed
defects rather than shallow passes everywhere. **No untested journey is reported as passing.**

---

## 12. Database results

- Clean migration replay from empty onto PostgreSQL 18.4: **succeeded**, 98 tables, 39 migrations.
- **`users.is_active` was absent after a pure replay** — confirmed via `\d users`, the decisive
  evidence for QA-3. Now fixed and re-verified present.
- `users.is_test_account` exists **nowhere** in schema, migrations or code — recorded as a platform
  gap, and deliberately **not** invented.
- Migration journal: 38 entries pre-existing, ordering internally consistent, replays clean. The
  known hash drift on `0008`/`0009`/`0013`/`0014` is pre-existing and not a functional defect.
- No tenant-scoped table was found lacking a `tenant_id` column — with the reported exception of the
  growthOS tables, which is an unverified lane claim (QA-16). **MOOT as of 2026-08-05: Growth OS was
  deleted entirely; its tables are orphaned in Postgres, not dropped.**

---

## 13. Security results

**Confirmed and fixed:** one CRITICAL (cross-tenant job-queue IDOR, QA-4), two HIGH (tenant-claim
binding QA-2; `discovery-preview` 500-on-every-call QA-17), four MEDIUM (deactivation kill switch
QA-6, sequence send-gate QA-5, socket-handshake revocation QA-18, timing-unsafe secret compare
QA-19).

**Confirmed and deliberately not fixed:** health-endpoint false-green (QA-8, needs an ops decision
on restart behaviour), `input-data/` gitignore exposure (QA-9, blocked by an unrelated dirty file).

**Reported but NOT confirmed by me:** six further IDOR/tenant-tampering candidates (QA-16). These are
stated as unverified, not as findings. They are the top follow-up precisely because they are the same
class as QA-4, which was real.

**Re-adjudicated as NOT a defect:** `OUTREACH_PROVIDER` unset defaults to the *name* `smartlead_csv`,
which the security lane flagged as worth confirming. Verified safe — `KNOWN_PROVIDERS` holds only
`mock`, so it throws `unknown_provider`. Fails closed.

**Verified sound:** RBAC fails closed on an unknown permission name; `requireRole` defaults to the
*least*-privileged role; the login rate limiter works; no module-scope SMTP transport exists;
password hashes are not exposed; only the mock outreach provider can be constructed.

---

## 14. Accessibility results

axe run against Login, Job Leads, Requirements, Company Policy and Duplicate Companies, plus a
mobile horizontal-overflow check. Covered in the extended spec: keyboard navigation, focus
visibility, labels, table headers, and disabled-control reasons exposed via `aria-describedby`.

Dialog focus-trapping and screen-reader announcement of errors were **not** separately verified.

---

## 15. Background-job results

Every scheduled job was inventoried statically. **No job was executed against an external API**, by
design. The edge-drainer's Upstash cap exhaustion (failure-matrix C-1) was **not** reproduced
locally — it requires the live Upstash account — and is unchanged by this run.

`sequenceWorker` gained a master send-flag re-check (QA-5). `stuckJobWorker` was deliberately left
unscoped in QA-4 so it can keep sweeping across tenants.

---

## 16–20. Discrepancies, causes, fixes, tests, before/after

Full detail in the [register](WIZMATCH_BREAKAGE_AND_FIX_REGISTER.md). Summary:

| ID | Severity | Fixed | Tests | Mutation-proven |
|---|---|---|---|---|
| QA-1 machine-sync lane unreachable | MEDIUM | ✅ (7 of 8) | 9 | 8 paths were 403 before |
| QA-2 cross-tenant `tenantId` claim | HIGH | ✅ | 7 | delete check → 4 red |
| QA-3 `users.is_active` unmigrated | MEDIUM | ✅ | 5 | strip `IF NOT EXISTS` → 1 red |
| QA-4 **job-queue cross-tenant IDOR** | **CRITICAL** | ✅ | 6 | neuter predicate → 4 red |
| QA-5 no send-flag re-check on dispatch | MEDIUM | ✅ | 6 | remove → 5 red |
| QA-6 deactivation not a kill switch | MEDIUM | ✅ | 3 | remove → 2 red |
| QA-7 real-backend specs unskippable | MEDIUM | ✅ (harness) | runner | — |
| QA-17 **`discovery-preview` 500s on every call** | **HIGH** | ✅ | 3 | revert qualification → red |
| QA-18 socket handshake skipped revocation | MEDIUM | ✅ | 7 | revert wiring → red |
| QA-19 timing-unsafe secret compare | MEDIUM | ✅ | 9 | revert to `!==` → red |

**Before:** 132 files / 1557 tests. **After:** 138 files / **1615 tests**. All passing, 0 skipped,
0 flaky. Build and admin:build exit 0.

**Every fix was reproduced before it was written and mutation-tested after.** Four mutations produced
genuinely useful results rather than confirmation: one showed a defensive branch in the auth fix was
unreachable dead code (it was removed rather than shipped as an untestable guard); one caught a
NULL-handling trap in QA-6 that would have logged out every user on a pre-0038 database; and two
caught the QA-17 guard being **vacuous** — its first two versions passed while the known defect was
mutated back in, because of comment-stripping ordering bugs. Without mutation testing, that guard
would have shipped protecting nothing.

**One correction to a claim made earlier in this run:** the QA-1 fix restores **7 of 8** machine-sync
paths, not 8. `GET /placements` carries its own role check downstream of the repaired gate
(failure-matrix L-2, pre-existing). The integration test necessarily mounts a stub downstream router,
so it could not see that; the Playwright lane testing the real router did. An honesty guard now pins
it.

---

## 21–22. Remaining failures and skips

**Remaining test failures: none.** **Remaining skips in the automated suite: none.**

Real-backend Playwright specs do not run in the DB-less unit suite by design; they are driven by
`scripts/run-wizmatch-e2e.sh`, which **fails the run if anything skips**.

**Untested is not the same as passing.** Journeys B–I and the Firefox/WebKit matrix are unexecuted
and are reported as such throughout.

---

## 23. Production actions required

**Production changes made by this run: NONE.**

Required of the owner:

1. **Verify n8n after deploy** — QA-4 changes `/api/jobs` semantics for a live integration.
2. **Migration 0038 will run on the next deploy.** Idempotent and proven to no-op where the column
   exists; confirm it applies cleanly.
3. **Upstash cap (CRITICAL, unchanged)** — check whether the write side is dropping inbound leads and
   payment webhooks. Billing decision, not code.
4. **Fresh encrypted backup** — the only one predates `0037`, and now `0038` as well.

---

## 24. Infrastructure actions required

**Infrastructure changes made by this run: NONE.** No Railway, Vercel, DNS, env var or deployment
change was made or attempted.

Required: add `input-data/` to the tracked `.gitignore` (QA-9); decide health-endpoint restart
semantics (QA-8); correct the Railway topology claims in `docs/ARCHITECTURE.md` and
`docs/DEPLOYMENT.md` (QA-10).

---

## 25. Final allowed usage

- The two-user internal pilot may continue on the existing WizMatch surfaces.
- Operators may run the full review workflow: queues, policy decisions, contact review,
  requirements, candidates, matching.
- The Command Deck sync will work again once this branch is deployed.
- Local QA against the disposable database, using the committed fixtures and runner.

## 26. Final prohibited usage

- **No real sending.** Every gate stays off.
- **No paid discovery**, no Apollo/Snov, no Google fallback.
- **No enforcement beyond shadow.**
- **No Smartlead connection**; no real outreach provider — only the mock may be constructed.
- **No production writes** from QA tooling. The seed's interlock enforces this mechanically.
- **Do not use Railway `list_variables`** — it returns secrets in plaintext (M-11), and that is the
  precondition QA-2 exists to defend against.

---

## Phase 5 — production read-only smoke: **UNPERFORMED**

Authenticated production sessions were not available; no password was requested or used. Per the
brief this is recorded as **UNPERFORMED, not as passing**. Unverified against the live deployment:
deployment commit, backend health, per-operator surface access, the five Today queues, machine GET
lane behaviour, cron status, live Redis errors, and live effective flags.

---

## Method note

Four narrow parallel lanes (architecture/coverage, infrastructure/fixtures, Playwright/a11y,
security/workers) fed findings to a single reviewing lead. **Lane output was treated as a lead, not
as a conclusion.** Every claim acted on was independently re-verified against the code before any
fix; claims that could not be verified in the time available are labelled unverified and were left
unfixed rather than being fixed speculatively (QA-16).

Two lane claims were corrected in the process: the failure matrix's account of the M-3 failure mode
(a missing column breaks login rather than making everyone active), and its account of M-1 (which
reproduces only when the pilot feature flags are on — the reason it escaped 55 passing unit tests).
