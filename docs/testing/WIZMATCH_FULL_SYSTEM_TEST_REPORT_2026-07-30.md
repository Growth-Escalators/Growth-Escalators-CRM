# WizMatch / Growth Escalators CRM — full system test report

**Date:** 2026-07-30 (UTC) · **Type:** evidence-producing validation run, not a development session
**No secret value, credential, password hash, connection string, token or candidate personal datum appears in this document.**

---

## 1. Executive verdict

> # LIMITED PILOT ONLY — REMEDIATION REQUIRED

The two-user WizMatch pilot remains **safe to continue**: every sending-adjacent capability is
provably disabled, roster admission is correct, and session revocation works on the supported path.

But this run found **one Critical** (Upstash quota exhausted — possible live data loss at CRM event
ingestion, outside the pilot surface), **four High** (cross-tenant read via unverified `tenantId`;
an active former-employee account; offboarding scripts that allow re-login; `optionalAuth` not
enforcing revocation), and **one broken owner-ratified feature** (the F-A machine-sync lane is
unreachable). `FULL SYSTEM READY` is not available: authenticated production checks and cron
execution remain **unperformed**, which the brief makes disqualifying.

**The Critical is a CRM-wide issue, not a pilot blocker.** The pilot verdict and the CRM verdict
differ, and the Critical should be triaged first regardless of pilot plans.

**Material change since the last report:** PR #90's merge triggered a **new successful
deployment**, and the four previously-staged variables are now **explicit in the running process**.
Two flags that were previously `true` in production — `WIZMATCH_PAID_DISCOVERY_ENABLED` and
`WIZMATCH_GOOGLE_FALLBACK_ENABLED` — are now `false`. The "EXPLICIT CONFIG REDEPLOY PENDING"
caveat is **resolved**.

---

## 2. Exact commit and deployment tested

| Item | Value |
|---|---|
| `origin/main` | `4678d505b1e6655bb575e05a878cc600a88e3c5e` (merge of docs PR #90) |
| PR #90 | MERGED 2026-07-29T18:34:46Z |
| **Active deployment** | `b26b90ef-a7cc-4214-97d3-3167b56c5403` — **SUCCESS** |
| Deployed commit | `4678d505…` (2026-07-29 18:34:48 UTC, 2 s after merge) |
| Previously-active `21f4d381` | now **REMOVED** — the brief's warning was correct |
| Failed predecessors | `50ce0ec6` FAILED, `6510b15e` REMOVED (both on `4a8d103a`) |
| Real API health | `api.` / `crm.` → `{"status":"healthy","env":"production","checks":{"database":{"status":"ok"}}}` |
| Local test tree | detached worktree at `4678d505`, byte-identical to `origin/main` |

**The Railway builder has recovered** — `b26b90ef` succeeded where `50ce0ec6` failed.

---

## 3. Test inventory

| Suite | Where | Result |
|---|---|---|
| Authentication / roster / tenant / viewer / revocation matrix | local, purpose-built | **26 / 27** |
| Negative safety proofs | local, purpose-built | **31 / 31** |
| Local security probes | local, purpose-built | **8 / 10** (2 re-adjudicated, §14) |
| Cross-tenant escape test | local, purpose-built | **1 defect confirmed** |
| Playwright `wizmatch-local` | local, real backend | **99 passed / 15 skipped / 0 failed** |
| Full vitest suite (Lane 1) | local, clean worktree | **132 files / 1551 tests, all passing** |
| Machine-sync lane unit tests | local | 55 / 55 passed *(yet the feature is broken — §15)* |
| Production DB / migration / backfill / backup (Lane 2) | production, read-only | no Critical |
| Code / CI / coverage (Lane 1) | local | reported — §5 |
| Runtime / crons / infra (Lane 3) | production, read-only | reported — 1 **Critical** |
| Access / user inventory (Lane 4) | production, read-only | reported — 1 **High** |

**All four lanes ultimately reported**, after this report's first draft was written from Lane 2 plus
my own direct verification. Their late findings are folded in below, and **one of them corrected a
headline claim of mine** (§10). Lane 1's suite numbers required a second `cd admin && npm ci
--legacy-peer-deps` step, which CI performs explicitly and Lane 1 initially missed — its first
"2 failed suites" result was its own setup error, not a repo regression.

---

## 4. Pass / fail / skipped counts

- Purpose-built local suites: **65 / 68** assertions passed (3 failures: 1 real defect, 2 harness
  errors re-adjudicated in §14).
- Playwright: **99 passed, 15 skipped, 0 failed**. The 15 skips are the real-backend hardening
  specs and **could not be un-skipped** — see M-2.
- Vitest full suite and coverage: **NOT RUN** in this session (Lane 1 did not report).

---

## 5. Coverage by critical module (Lane 1)

**Global:** Statements **49.36 %** (7110/14402) · Branches **45.44 %** (5087/11193) · Functions
**49.64 %** (1198/2413) · Lines **50.99 %** (6409/12568).

`vitest.config.ts` sets a **flat 30 % floor**, self-described as "a floor against backsliding, not
a target". Passing the gate therefore proves only "no regression below 30 %", and there is **no
per-file gate** — several production-critical files sit well under it.

| Module | Stmt | Branch | Func | Line |
|---|---|---|---|---|
| `middleware/auth.ts` | 76.56 | 60.71 | 75 | 76.66 |
| `middleware/rbac.ts` | 59.37 | **33.33** | 71.42 | 61.29 |
| `middleware/wizmatchPilotGate.ts` | 81.81 | 75 | 100 | 81.81 |
| **`middleware/wizmatchMachineSyncLane.ts`** | **ABSENT** | — | — | — |
| `services/wizmatchStaffingAccess.ts` | 66 | 71.79 | 66.66 | 74.41 |
| `modules/outreach/outreachGate.ts` | 97.54 | 87.7 | 95.83 | 99.12 |
| `modules/outreach/companyBootstrap.ts` | 88.88 | 100 | 83.33 | 88.23 |
| **`modules/outreach/policyBackfill.ts`** | **ABSENT** | — | — | — |
| `routes/wizmatchPolicy.ts` | **38.55** | **25** | 41.66 | 38.55 |
| `routes/wizmatchToday.ts` | 89.13 | 70.83 | 100 | 88.37 |
| `modules/outreach/decisionWorkbench.ts` | 95.48 | 93.54 | 100 | 96.66 |
| `…/decisionWorkbenchActions.ts` | 89.77 | 88.52 | 100 | 92.68 |
| **`…/decisionWorkbenchCapabilities.ts`** | **ABSENT** | — | — | — |
| `services/multiDomainMailer.ts` | 89.7 | 76.47 | 66.66 | 91.66 |
| **`services/emailService.ts`** | **7.93** | **2.85** | **14.28** | **8.06** |
| `modules/outreach/providers/index.ts` | 88.23 | 87.5 | 100 | 87.5 |
| `services/wizmatchPilotReadiness.ts` | 98.93 | 86.11 | 92.85 | 98.86 |
| `modules/outreach/prepareCompanies.ts` | 87.85 | 76.56 | 79.16 | 91.2 |
| `src/scripts/migrate.ts` | excluded by documented design (`vitest.config.ts`) | | | |
| `scripts/wizmatch-pilot-readiness.ts` | never instrumented — tested via `spawnSync` child process | | | |

**M-9 (High) — coverage blind spot.** Five source files that are directly, non-mockedly imported by
real passing tests **never appear in the v8 coverage report at all** — not even as a 0 % row:
`wizmatchMachineSyncLane.ts`, `policyBackfill.ts`, `decisionWorkbenchCapabilities.ts`,
`outreachIdempotencyKey.ts`, `scopeKey.ts`. Reproduced by Lane 1 twice (full suite and an isolated
5-file run). Root cause unconfirmed. **Consequence: the CI threshold gate cannot see these files,
so a regression to 0 % coverage in any of them would be invisible.** One of them is the very
middleware this run proved non-functional (M-1) — its 55 green unit tests are, by this measure,
not counted at all.

**M-10 (Medium) — `emailService.ts` at 7.93 % statement coverage** on a live-send email service.

---

## 6. Authentication matrix (local, synthetic users)

| ID | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| AUTH-1/2 | Active approved admin logs in | 200 + token | 200 + token | PASS |
| AUTH-3 | Inactive former employee | 401, no token | 401 | **PASS** |
| AUTH-4 | Wrong password | 401 | 401 | PASS |
| AUTH-5 | Correct credential, **wrong tenant slug** | 401 | 401 | **PASS** |
| AUTH-6 | Non-pilot admin authenticates (roster is authz) | 200 | 200 | PASS |
| AUTH-7/8/9 | team_lead / viewer / other-tenant authenticate | 200 | 200 | PASS |
| AUTHZ-1 | Unauthenticated WizMatch surface | 401 | 401 | PASS |
| AUTHZ-2 | Garbage bearer token | 401 | 401 | PASS |
| SEC-1 | Login rate limiter (5 / 60 s) | 429 | 429 at attempt 2 | PASS |
| REVOKE-1 | `token_version` bump kills live JWT | 200 → 401 | 200 → 401 | **PASS** |
| REVOKE-2 | Deactivation kills session **and** blocks re-login | 401 / 401 | 401 / 401 | **PASS** |

**Login is tenant-scoped** — the handler requires `t.slug = tenantSlug`, resolved from the request
(explicit `tenantSlug`/`product`, else host, else `DEFAULT_TENANT_SLUG`). A correct credential
against the wrong slug is a 401. This confirms the operational trap already recorded in the
onboarding runbook.

**Session revocation is sound.** `permissions.ts:309` sets `is_active=false` **and** bumps
`token_version`; login enforces `is_active` (`auth.ts:83`), `requireAuth` enforces `token_version`
(`auth.ts:81`) and **fails closed on DB error**. Propagation is bounded by a 30 s cache (L-1).

---

## 7. Tenant-isolation matrix

| ID | Check | Expected | Actual | Verdict |
|---|---|---|---|---|
| TENANT-1 | Other-tenant admin on WizMatch surface | 403 | 403 | PASS |
| AUTH-5 | Cross-tenant login refused | 401 | 401 | PASS |
| **H-1** | **Forged `tenantId` claim returns other tenant's row** | no data | **other tenant's row returned** | **FAIL** |

H-1 is the High finding. Detail in §14 and in the failure matrix.

---

## 8. Feature matrix — dangerous capabilities (31/31 proven disabled)

Every capability was proven blocked **both** when its flag is absent **and** when it is `"false"`,
using the product's own exported gates — never a re-implemented copy.

| Capability | Absent | `"false"` | Control (proves non-vacuity) |
|---|---|---|---|
| Sending | blocked | blocked | — |
| Automated email | blocked | blocked | `"true"` ⇒ enabled ✅ |
| Auto-preparation | blocked | blocked | — |
| Outreach adapter | blocked | blocked | — |
| Paid discovery | blocked | blocked | — |
| Google fallback | blocked | blocked | — |
| Enforcement mode | `shadow` | `shadow` | exactly `"enforce"` ⇒ enforcing ✅ |

Additional proofs: garbage enforcement values and wrong-case `"Enforce"` both fail closed to
`shadow`. `listKnownOutreachProviders()` is exactly `["mock"]`; **six** provider names —
absent (⇒ `smartlead_csv`), `smartlead_csv`, `smartlead`, `SmartLeadCsvAdapter`, `apollo`, `snov`
— all throw `unknown_provider`, while `"mock"` constructs (control). The singleton was reset
between every case, or the results would have been meaningless.

The JS string-truthiness trap was tested explicitly: `"false"` is truthy in JavaScript, and every
gate still returns `false`.

---

## 9. Job / cron matrix

| Job | Status |
|---|---|
| TheirStack (`'35 1 * * 1,4'`) | **Scheduled, execution NOT VERIFIED.** Boot log confirms `[cron] Wizmatch TheirStack results-first importer scheduled`. **No claim is made that it is healthy.** |
| ATS poller (6:10 AM IST daily) | **Scheduled, execution NOT VERIFIED** — same basis. |
| Sequence worker | **Alive and idle — verified.** Logs `[sequenceWorker] Processed 0 enrolments` every ~30 s. |
| Sending / provider / paid discovery | **No evidence of any** — zero log hits for provider or send activity. |
| Local background jobs | disabled via `DISABLE_BACKGROUND_JOBS=true` |

**Date nuance worth recording.** The deployment clock reads **2026-07-29 ~19:00 UTC**, which is
2026-07-30 in IST (UTC+5:30). Deployment `b26b90ef` started 18:34 UTC on 07-29 — *after* that day's
01:35 UTC cron window and *before* the next Mon/Thu slot (**Thu 2026-07-30 01:35 UTC**, still ahead).
So no TheirStack execution could have occurred on this deployment yet, and its absence from the logs
is expected rather than a failure signal. Verify after that window.

---

## 10. Infrastructure findings — running process (verified by me)

`railway ssh --service web` + `printenv` on the active deployment. **All eleven intended values
now match**, and all four previously-staged variables are explicit:

```
NODE_ENV=production                        WIZMATCH_POLICY_ENFORCEMENT_MODE=shadow
WIZMATCH_SENDING_ENABLED=false             AUTOMATED_EMAILS_ENABLED=false
WIZMATCH_AUTO_PREP_ENABLED=false           WIZMATCH_OUTREACH_ADAPTER_ENABLED=false
WIZMATCH_PAID_DISCOVERY_ENABLED=false      WIZMATCH_GOOGLE_FALLBACK_ENABLED=false
WIZMATCH_COMPANY_POLICY_ENABLED=true       WIZMATCH_DECISION_WORKBENCH_ENABLED=true
WIZMATCH_STAFFING_PILOT_ALL_USERS=false
```

`OUTREACH_PROVIDER` is **absent** ⇒ defaults to `smartlead_csv` ⇒ not constructible ⇒ throws
(fail-closed, by design). `WIZMATCH_STAFFING_PILOT_USER_IDS` contains exactly **2** ids.

**Still true:** `ecom.growthescalators.com/health` returns Vercel SPA HTML with 200 — a
**false-green oracle**, not the API. Lane 3 established why it lingers: the domain is still attached
to this Railway service but dormant, its real DNS CNAME points at Vercel, and Railway reports
`DNS_RECORD_STATUS_REQUIRES_UPDATE` with its certificate stuck in `ISSUING`.

### CORRECTION — migrations DO run at deploy (I previously reported the opposite)

**My earlier claim that "deployment migrations are currently NOT automatic" was WRONG**, both in
this report's first draft and in the go-live docs merged in PR #90. Lane 3 challenged it and was
right.

Deploy logs for `b26b90ef`, pinned and time-boxed:

```
18:36:58.351Z [migrate] Migration started
18:36:58.351Z [migrate] Migrations folder: /app/src/db/migrations
18:36:58.351Z [migrate] Acquiring migration lock...
18:36:58.351Z [migrate] Lock acquired
18:36:58.351Z [migrate] Migration complete
```

The `[migrate]` prefix is emitted **only** by `src/scripts/migrate.ts`, which is invoked **only** by
`railway.json`'s `startCommand`. So `railway.json` **is** honoured and migrations **do** run before
the server starts.

**Why I got it wrong:** `get_service_config` reports `Start command: node dist/index.js`, and PID 1
in the container is `node dist/index.js` with no parent shell — both of which I read as proof the
compound command was overridden. Neither is conclusive: a `sh -c "A && B"` shell commonly `exec`s
the final command, leaving `node` as PID 1, and the config field shows only the tail segment. **The
log evidence is decisive and the process evidence is not.**

**This inverts the operational guidance.** A future migration **will** auto-apply on deploy. The
earlier advice to "apply any future migration deliberately" was wrong and could have caused a
double application. Builder drift (repo NIXPACKS vs live RAILPACK) is real but currently harmless —
the build is green.

### Critical — Upstash quota exhausted (`[edge-drainer] loop error`)

Root cause found by Lane 3 and **independently reproduced by me** from raw CLI logs:

```
Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000.
```

Every `XGROUP CREATE` and `XREADGROUP` against the external Upstash Redis REST endpoint has failed
continuously since boot, retrying every ~5.2 s. This is an **Upstash plan/quota lockout, not a code
defect** — no Railway change fixes it. Detail and the data-loss question in §15.

**Tooling note:** the MCP `get_logs` `search=` filter silently drops this line, because the logger
nests the error under a `data` field and Railway indexes only top-level `msg`. Raw
`railway logs -s web -e production --lines N` surfaces it. That is why earlier passes saw an
"empty" error.

---

## 11. Database findings (Lane 2, read-only production)

Verified under `default_transaction_read_only=on` with an empirical write-probe confirming the DB
rejected writes.

- Production Postgres is service `Postgres` (`0c31ec38…`), **PostgreSQL 18.3**, 54 MB, uptime 133 d.
  `Postgres-K0lx` is Documenso's DB (PG 17.10), **not** production.
- Migration `0037` applied **exactly once**, hash `76729b60…7db5` == local file SHA-256. `0035`,
  `0036` likewise. **No `0038`** anywhere. Journal = 36 rows.
- All 8 `0037` tables, **32/32** named indexes (incl. 3 U-7 shared indexes), 145 constraints
  (17 CHECKs on `wizmatch_company_policies`), immutability trigger + function all present and enabled.
- **183** active root policies, **0** missing, **0** duplicates, **1:1** with companies.
- **0** rows with `outreach_eligibility='allow'` — all 183 are `needs_review`.
- **0** cross-tenant policy rows; 100 % `wizmatch`.
- Backfill dry run re-run today: **0 missing**, deterministic across two runs, zero writes.

---

## 12. Backup / recovery findings

- Encrypted archive present, `-rw-------` (600), directory `700`; **current ciphertext SHA-256
  matches the manifest exactly** — no tampering. No plaintext `.dump` residue. Keychain entry
  exists (presence only). Restore-test evidence clean (0-byte error logs, 0 blocked reads).
- Recovery point `2026-07-28T05:59:17Z`.
- **M-5:** the archive predates migration `0037` **and** the G2 backfill. Restoring it today would
  roll back the schema (all 8 tables) and all 183 root-policy rows, requiring a replay of `0037`
  plus the backfill during an incident. Railway managed backup/PITR is unavailable, so this is the
  **only** rollback mechanism. **A fresh logical backup is recommended before any further
  production writes.**

---

## 13. Performance findings (local, disposable)

| Endpoint | c=1 | c=10 | c=25 | c=50 |
|---|---|---|---|---|
| `/health` p50 / p95 (ms) | 5 / 5 | 14 / 15 | 14 / 17 | **16 / 22** |

`/health` scales cleanly to 50 concurrent with no errors. **WizMatch endpoint throughput is not
reported**: at c≥25 responses were non-2xx *and* very fast (2–5 ms), which is the signature of rate
limiting rather than saturation. Presenting those as latency figures would be misleading, so they
are withheld. Policy resolution over **1 000 synthetic companies** was seeded successfully; a
timed resolution benchmark was **not completed**. Slow-query inventory, pool behaviour, N+1
detection and bulk-action limits were **not measured**.

---

## 14. Security findings

**Passed:** `alg=none` forgery rejected · wrong-secret signature rejected · expired token rejected ·
missing-claims token rejected · SQL-injection payloads produced no driver error or leak · unknown
UUID does not leak (404) · reflected XSS payload not echoed · 3 of 4 security headers present ·
login rate limiting enforced.

**Two initial "failures" re-adjudicated after inspection — I will not report a harness bug as a
product defect:**

- `SEC-ROLE-1` expected 403, got 401. The 401 is **correct**: my forged token carried a mismatched
  `token_version`, so `requireAuth` rejected it before the roster check. Harness error, not a defect.
- `SEC-TEN-1` initially "passed then failed" ambiguously because both tenants were empty
  (`rows=0`). That result was **inconclusive**, not a pass. I seeded one distinguishable candidate
  per tenant and re-ran — which produced H-1 below.

### H-1 (High) — cross-tenant read via unverified `tenantId` claim

A token carrying a WizMatch admin's genuine `id` and `token_version` but a **forged `tenantId`**
returned the *other* tenant's candidate row (`tenant_id` of `growth-escalators`, containing that
tenant's synthetic marker). `requireAuth` looks up `token_version` **by user id alone**
(`src/middleware/auth.ts:45`) and never verifies that `payload.tenantId` matches `users.tenant_id`.
Downstream handlers then scope by the attacker-supplied `req.user.tenantId`.

**Precondition: the ability to sign a JWT (i.e. possession of `JWT_SECRET`).** An ordinary user
cannot mint such a token — the `tenantId` claim is set at login from the database, and login itself
is tenant-scoped. So this is **not** remotely exploitable by an unauthenticated or ordinary
authenticated user, which is why it is graded High and not Critical.

**However, that precondition is weaker than it looks.** Lane 3 re-confirmed that
`mcp__railway__list_variables` returns **all 163 production variables in full plaintext** —
including `JWT_SECRET`, `DATABASE_URL` and every third-party token — rather than presence-only. So
the practical bar is *Railway project read access*, not a secret compromise. Anyone with that
access can mint a token for any tenant and read that tenant's data, and nothing downstream would
stop them. That linkage is the reason this finding is worth fixing promptly even though it is not
remotely exploitable.

**Standing guidance, now reinforced:** do not use `list_variables`. Use `railway ssh` + `printenv`
scoped to the specific non-secret flags, as this run did.

It is a trust-boundary defect: a claim is trusted without verification, and the fix is one
comparison in a query that already runs.

**Dependency audit:** 0 critical, **22 high**, 12 moderate, 1 low. Notable given this codebase:
`nodemailer` CRLF header injection, `form-data` CRLF injection, `axios` ReDoS, `multer` DoS. None
is a live path while sending is disabled; `nodemailer`/`form-data` become relevant the moment email
is enabled.

---

## 15. Every reproduced failure

### C-1 (Critical) — Upstash request cap exhausted; event ingestion may be dropping data

`[edge-drainer] loop error: Command failed: ERR max requests limit exceeded. Limit: 500000,
Usage: 500000` — continuous since boot, every ~5.2 s. Verified independently by Lane 3 (raw CLI)
and by me.

`src/services/edgeQueueDrainer.ts` drains an Upstash Redis Stream (`crm:events`, group
`railway-drainer`) that **Vercel edge functions write to** — Cashfree webhooks, lead/waitlist/
agency-lead forms, pending-order pings, Tally beacons. This is external Upstash SaaS, **not** the
Railway `Redis` service in this project.

**Read side:** `XREADGROUP` never returns, so `handleEntry`/`dispatch` are never reached and nothing
is wrongly ACK'd or trimmed — unprocessed events should still be queued.
**Write side — the urgent, open question:** if the same account-level cap also rejects the edge
functions' `XADD` calls, **new leads and Cashfree webhooks are failing to enqueue at all right
now**. That is live data loss at ingestion. Confirming it requires Vercel logs or the Upstash
console; **it was not confirmed here and must be checked first.**

Queue depth **UNVERIFIED** — querying it would require handling the plaintext Upstash token, which
was deliberately avoided. Check via the Upstash console.

**Not a WizMatch pilot issue** — it does not touch the pilot surface — but it is the most urgent
finding in this report for the CRM as a whole.

### H-2 (High) — a former employee's account is still active

`nimisha.daiya@growthescalators.com` is `is_active=true`, `role='staff'`, `token_version=5`, despite
a dedicated offboarding script (`src/scripts/removeNimisha.ts`, added 2026-05-10) existing in the
repo. Her row shows no trace of that script having run — it would set `role='deactivated'` and
`token_version=-1`, and neither matches.

**Whether she has actually left is UNVERIFIED** — the script's existence is not proof of
departure. **Confirm employment status before acting.** If she has left, this account can log in
today.

### H-3 (High) — offboarding scripts do not set `is_active`, so re-login is still possible

`src/scripts/removeVishal.ts:93-97` and `removeNimisha.ts:97-101` set `role='deactivated'` and
`token_version=-1` but **never touch `is_active`**. That invalidates existing sessions, but login
(`auth.ts:83`) gates only on `is_active`, **not** on role — so anyone offboarded *only* via these
scripts can log back in with a known password and receive a fresh valid token.

The supported API path (`DELETE /api/permissions/users/:userId`, `permissions.ts:306-311`) does
**not** have this gap — it sets both in one statement. Vishal's row matches the API path, so the
correct mechanism was used for him. The scripts are the hazard.

**This qualifies my §6 conclusion:** session revocation is effective *via the supported API path*.
It is **not** effective if only these scripts are used.

### H-4 (High) — `optionalAuth` does not re-check `token_version` (Lane 1)

`src/middleware/auth.ts:105-126` checks only that the JWT *carries* a `tokenVersion` claim; unlike
`requireAuth` it never compares it to the database. It is mounted on exactly one route —
`/api/outreach/leads` (`src/index.ts:281`). **A revoked session keeps authenticating there until
natural JWT expiry (up to 7 days).** The asymmetry is deliberate per the in-code comment, and the
whole path has **0 % test coverage**.

**Second qualification of §6:** revocation is bounded by ~30 s everywhere `requireAuth` runs, but
is effectively *not enforced at all* on `/api/outreach/leads`.

### M-1 (Medium) — the F-A machine-sync lane is unreachable; Command Deck sync is broken

All eight allowlisted GET paths return **403 `staffing_pilot_access_required`** for a `viewer`.

**Mechanism, proven not inferred.** `wizmatchPolicyRouter` (`index.ts:353`), `wizmatchTodayRouter`
(`:354`) and `wizmatchPrepareRouter` (`:358`) each call `router.use(wizmatchPilotGate)` with **no
path**, so the gate runs for *every* request under `/api/wizmatch`. `wizmatchPilotOrMachineSync` is
only mounted at **`:418`**, after all three. A `viewer` is rejected at `:353` before the lane runs.

**Decisive discriminator:** `GET /api/wizmatch/zzz-does-not-exist-anywhere` — a path on no router —
returns **403 with the pilot error rather than 404**, proving router-level middleware executes
regardless of route matching.

**The lane's own 55 unit tests pass**, and an isolated Express probe confirms
`isWizmatchMachineSyncRequest` returns `true` for `req.path='/dashboard'` with a viewer principal.
The predicate is correct; the *mount order* defeats it. This is the repo's recurring
"green-test-proves-nothing" class, now at integration level.

**It fails closed**, so it is not a security defect — but the owner-ratified F-A fix does not work,
and shipped documentation (including the go-live docs merged in PR #90) states that it does.

### M-2 (Medium) — 15 real-backend Playwright tests cannot be un-skipped

The contact-cap and delete/archive specs skip on `!WIZMATCH_E2E_TEST_PASSWORD`. With the variable
set and **verified visible to node in the same shell** (`SET(28)`), and passed again explicitly
inline, all 5 tests × 3 projects **still skip**. Cause not established. Consequence: the
safety-relevant real-backend E2E coverage has never executed, and "99 passed / 15 skipped"
overstates real coverage.

### M-3 (Medium) — `users.is_active` is not in the schema or any migration

It is created by a fire-and-forget `ALTER TABLE … ADD COLUMN IF NOT EXISTS … .catch(() => {})` at
`src/routes/permissions.ts:21`. A fresh database built purely from migrations (local, staging, or a
disaster-recovery restore) does **not** have it — confirmed on this run's clean PG18 cluster.
Login references `u.is_active` in raw SQL, and the guard treats NULL as active. Drizzle's `users`
model has no `isActive` field at all.

**Correction to my own prior report:** I previously cited `schema.ts:33` as evidence that `users`
has `isActive` and rejected a teammate's contrary claim on that basis. Line 33 belongs to the
**`tenants`** table. The teammate was right about the Drizzle model; I was wrong.

### M-4 (Medium) — migration journal hash drift (Lane 2)

Four local migration files (`0008`, `0009`, `0013`, `0014`) do not hash-match the production
journal, and two production hashes have no local file. Lane 2 traced `0009` conclusively: the
originally-applied blob is journal id 10; the file was edited afterwards. Pre-existing, unrelated
to `0035–0037`, and harmless to drizzle's apply-time behaviour — but a from-scratch replay would
not reproduce production history for those slots.

### M-6 (Medium) — external network calls at startup despite `DISABLE_BACKGROUND_JOBS=true`

Booting the backend locally issued real outbound PageSpeed requests to three third-party domains
(HTTP 429) and ran programmatic SEO generation. These are startup tasks, not crons, and the flag
does not suppress them. No WizMatch sending occurred, but a fresh environment reaches the public
internet unprompted.

### M-7 (Medium) — 22 high-severity dependency advisories (§14)

### M-8 (Medium) — shipped documentation is now inaccurate

The go-live docs merged in PR #90 state (a) "EXPLICIT CONFIG REDEPLOY PENDING" — now resolved, and
(b) that the viewer machine-sync lane admits eight GET paths — it does not (M-1).

### L-1 (Low) — 30-second revocation window

`TOKEN_VERSION_CACHE_TTL_MS = 30_000`: a revoked session stays usable for up to 30 s. Deliberate
and documented, with a fail-closed rationale.

### L-2 (Low) — `/placements` 403 for the viewer

Pre-existing, documented, feeds no cockpit tile.

---

## 16–22. Reproduction, expectations, severity, fixes

Per-defect reproduction steps, expected vs actual behaviour, suggested fix, required regression
test and production impact are in
[`WIZMATCH_FAILURE_MATRIX_2026-07-30.md`](WIZMATCH_FAILURE_MATRIX_2026-07-30.md).

---

## 23. Safe remediation order

0. **C-1 — FIRST, TODAY.** Determine whether Upstash's request cap is also rejecting the Vercel
   edge functions' `XADD` writes. If so, lead/webhook ingestion is losing data right now. Check the
   Upstash console and Vercel logs; restoring request budget is a billing/plan decision for the
   account owner, not a code change.
1. **H-2** — confirm Nimisha's employment status; if she has left, deactivate via the **API path**
   (which sets `is_active` *and* bumps `token_version`), not the scripts.
2. **H-3** — fix `removeVishal.ts` / `removeNimisha.ts` to set `is_active=false`, or delete them in
   favour of the API path.
3. **H-1** — verify `tenantId` in `requireAuth` (smallest change, largest trust-boundary gain).
4. **H-4** — decide whether `optionalAuth` on `/api/outreach/leads` should check DB `token_version`.
5. **M-1** — restore the machine-sync lane (mount order); unblocks Command Deck sync.
6. **M-5** — take a fresh encrypted logical backup (post-`0037`, post-backfill).
7. **M-8** — correct the shipped go-live documentation *(the migration claim is already corrected —
   see §10)*.
8. **M-9** — investigate the coverage blind spot; five files are invisible to the CI gate.
9. **M-2** — repair the E2E enablement path, then run those 15 tests.
10. **M-3** — model `users.is_active` / `is_test_account` in a real migration.
11. **M-10 / M-7 / M-6 / M-4** — email-service coverage, dependency upgrades, startup egress,
    journal drift.

Full sequencing and rationale: [`WIZMATCH_REMEDIATION_PLAN_2026-07-30.md`](WIZMATCH_REMEDIATION_PLAN_2026-07-30.md).

---

## What was NOT done

No production write. No production redeploy, variable change, roster change, migration, backfill or
restore. No send, no provider invocation, no paid discovery, no Smartlead. No real candidate,
prospect or client contacted. No dangerous flag enabled anywhere. No application code modified.
Production authenticated checks were **not performed** — they require the operators' own logged-in
sessions, and no plaintext password was requested. All local testing used synthetic
`@example.invalid` identities on a disposable PostgreSQL 18 cluster containing no production data.

> # LIMITED PILOT ONLY — REMEDIATION REQUIRED
