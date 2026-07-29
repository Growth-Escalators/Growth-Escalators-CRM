# WizMatch G3 smoke-test result — FINAL

**Date:** 2026-07-29 (UTC) · **Reviewer:** independent Opus lead session
**Verdict:** **PASS — no Critical or High finding.**
**No secret value, credential, password hash or personal datum beyond the two approved work
email addresses appears in this document.**

This records the independent post-deployment verification of the WizMatch two-user internal
pilot. It is deliberately explicit about which checks were **completed** and which remain
**not performed** — an unperformed check is recorded as unperformed, never as a pass.

---

## 1. Review method and outcome

An independent Opus review was run over the production-critical claims of the prior (GLM)
rollout session, on the standing rule that **previous reports are claims to verify, not
evidence to trust**. Three narrow, read-only lanes ran in parallel — Git/CI, database, and
runtime/configuration — and all three reported and were reconciled by the lead. The lead
independently re-inspected the most critical evidence rather than accepting any lane's
conclusion on its own.

**Result: zero Critical, zero High.** Four subordinate lane claims were checked and
**rejected** on the evidence, and one lane correction was **accepted**:

| Lane claim | Disposition |
|---|---|
| `wizmatchPilotReadiness.ts:233` is the outreach-adapter *gate* | **Rejected** — it is the *reporter*; the real block is the `KNOWN_PROVIDERS = ['mock']` allow-list |
| Journal row `id=37` proves migration `0037` | **Rejected** — a serial primary key is not a migration number; proven by hash instead |
| `users` has no `is_active` column | **Rejected** — it exists (`src/db/schema.ts:33`) and production returns `true` for both pilot users |
| All ten flags are explicit in the running deployment | **Rejected** — that is *staged service config*; four are absent from the running process |
| `WIZMATCH_STAFFING_PILOT_ALL_USERS` being *set* is not itself an open deployment | **Accepted** — it is set to `false`, which is the safe/closed state |

---

## 2. Active deployment and verified commit

| Item | Value |
|---|---|
| Railway project / service | `GE-Backend-Server` / `web` (environment `production`) |
| **Active deployment** | `21f4d381-e7af-4ab5-b81e-6548a57099b2` — **SUCCESS** |
| **Deployed commit** | `4a8d103a8670ab255b5eb8e84fdefa1814fe67d9` |
| Deployed at | 2026-07-28 15:57:17 UTC (4 s after the PR #89 merge at 15:57:13 UTC) |
| PR #89 | **MERGED**, base `main`, head `b35e16c4a47265e6f8ef1a263cc2132cad90c07c`, normal merge commit |
| App code after reviewed `0d330269` | **unchanged** — every later commit is docs/context only |

Two later deployments exist on the **same commit** and did **not** replace the active one:
`50ce0ec6-e956-42ca-8047-cfa4f3edee87` (FAILED) and
`6510b15e-d805-4acc-83e8-adae6a339a27` (REMOVED). Both were attempts to apply staged
configuration; both failed on the Railway builder. This is precisely why four staged
variables never reached the running process (§5).

> **Operator trap — record this.** Railway log queries default to the *latest* deployment,
> which is the REMOVED `6510b15e`, not the active one. Querying logs without pinning
> returns "No Deploy logs found" and reads as an outage. **Always pin
> `deployment_id=21f4d381-e7af-4ab5-b81e-6548a57099b2`.**

> **False-green health oracle — record this.** `https://ecom.growthescalators.com/health`
> returns **Vercel SPA HTML with HTTP 200**. It is not the API and must never be used as
> the API health check. The real API health endpoint is on `api.` / `crm.`, and it was
> verified healthy for the active deployment.

---

## 3. Completed smoke checks

Each of the following was performed and passed, read-only, against the live production
deployment or the production database.

| # | Check | Result |
|---|---|---|
| 1 | Active deployment is SUCCESS and serves the merged commit | **PASS** |
| 2 | API health endpoint (real API domain, not `ecom.`) responds healthy | **PASS** |
| 3 | WizMatch routes are mounted and live on the active deployment | **PASS** |
| 4 | Unauthenticated access to the WizMatch surface is refused | **PASS** |
| 5 | Migration `0037` applied **exactly once**, verified by **SHA-256 hash equality** — production journal hash `76729b60…5937db5` equals the local `sha256(0037_unknown_siren.sql)`; `0035`/`0036` also match | **PASS** |
| 6 | No `0038` exists in the repo or the journal | **PASS** |
| 7 | A redeploy cannot reapply `0037` — proven two independent ways (§4) | **PASS** |
| 8 | Backfill state: **183** active root policies, **0** missing, **0** duplicates, **0** non-WizMatch rows | **PASS** |
| 9 | **Every** root policy is `outreach_eligibility='needs_review'` — missing context never becomes `allow` | **PASS** |
| 10 | Production PostgreSQL server version **18.3** | **PASS** |
| 11 | Pilot roster is exactly two human UUIDs, both `admin`, both `is_active=true`, both in the WizMatch tenant | **PASS** |
| 12 | Itika has **no** production account in any tenant (0 case-insensitive matches) — deferral is real, not assumed | **PASS** |
| 13 | Machine principal `deck-sync` (`role='viewer'`) is **outside** the human roster | **PASS** |
| 14 | Roster gate parses `WIZMATCH_STAFFING_PILOT_ALL_USERS="false"` correctly — no JavaScript string-truthiness fail-open (§6) | **PASS** |
| 15 | Enforcement mode resolves to **`shadow`** in the running process | **PASS** |
| 16 | Sending, automated email, preparation, outreach adapter, paid discovery and Google fallback are all effectively disabled (§5, §6) | **PASS** |
| 17 | Readiness CLI exits **0** against both the *effective* running env and the *post-redeploy* env — identical PASS, so the pending redeploy is behaviourally inert | **PASS** |
| 18 | Encrypted logical backup exists, is `chmod 600`, is untracked and ignored, and was restore-tested into a disposable PostgreSQL 18 | **PASS** |

**No synthetic record was created, and therefore none required cleanup.** The planned
synthetic identifiers (`WizMatch Opus Pilot Test Company`, `Opus Pilot Test Record`,
`@example.invalid`) were **not** used, because every mutation-shaped smoke check requires an
authenticated session (§7). Nothing was written to production by this review.

---

## 4. Why a redeploy cannot reapply migration `0037`

Proven two independent ways, either of which is sufficient:

1. **Drizzle's pending rule.** `migrate()` compares only the newest applied migration's
   timestamp (`node_modules/drizzle-orm/pg-core/dialect.js:57-67` — `order by created_at
   desc limit 1`, applying only when `created_at < folderMillis`). The last applied
   `created_at` is `2026-07-28T14:54:18Z`, which exceeds **every** `folderMillis` in
   `_journal.json`. Nothing is pending.
2. **Stronger — migrations do not run on deploy at all.** The live Railway service start
   command is `node dist/index.js`. It **overrides** `railway.json`'s declared
   `node dist/scripts/migrate.js && node dist/index.js`. The migrate step is therefore not
   executed by any deployment. See the follow-up in the live-status document.

---

## 5. Configuration: running vs staged

The distinction below is load-bearing and was the single most-contested claim of the review.
`list_variables` reports **staged service configuration**; `railway ssh` + `printenv` reports
what deployment `21f4d381`'s **running process** actually has. They disagree.

**A — explicit in the running deployment** (verified in-container):
`NODE_ENV=production`, `WIZMATCH_SENDING_ENABLED=false`,
`WIZMATCH_STAFFING_PILOT_ALL_USERS=false`, `WIZMATCH_STAFFING_PILOT_USER_IDS` (exactly the
two roster UUIDs), `WIZMATCH_COMPANY_POLICY_ENABLED=true`,
`WIZMATCH_DECISION_WORKBENCH_ENABLED=true`.

**B — absent from the running process, effective through reviewed fail-safe code defaults:**
`WIZMATCH_POLICY_ENFORCEMENT_MODE`, `AUTOMATED_EMAILS_ENABLED`,
`WIZMATCH_AUTO_PREP_ENABLED`, `WIZMATCH_OUTREACH_ADAPTER_ENABLED`.

**C — staged in Railway, pending a successful redeploy:** the same four names, with the
values `shadow` / `false` / `false` / `false`. They will make explicit what §6 shows is
already the effective behaviour. **The pending redeploy changes no behaviour** — confirmed
empirically by check 17.

---

## 6. Why the four absent variables are safe (code evidence)

| Capability | Code | Behaviour when the variable is absent |
|---|---|---|
| Enforcement mode | `src/modules/outreach/outreachGate.ts:181` — `=== 'enforce' ? 'enforce' : 'shadow'` | **`shadow`** |
| Automated email | `src/services/multiDomainMailer.ts:54,158` — `!== 'true'` ⇒ throw | **throws, suppressed** |
| Automated email (2nd, independent) | `src/services/emailService.ts:140` — `=== 'true'` | **`false`** |
| Preparation / adapter flags | `src/services/wizmatchAutomation.ts:16-19` — allow-list `['1','true','yes','on']` | **`false`** |
| Outreach adapter (real block) | `src/modules/outreach/providers/index.ts` — `KNOWN_PROVIDERS = ['mock']`; default `'smartlead_csv'` is not constructible | **throws `unknown_provider`** |
| Roster gate | `src/services/wizmatchStaffingAccess.ts:16-18,40-58` — same allow-list parser | `enabled("false")` ⇒ **`false`**; access limited to the two roster UUIDs |

Every gate uses the **fail-closed** `=== 'true'` / allow-list idiom, never the fail-open
`!== 'false'`. The `NODE_ENV === 'production' ? strict : permissive` branch that previously
weakened the roster gate has been **deleted**, so it fails closed in every runtime.

The roster gate and the readiness CLI use the **identical** parser for
`WIZMATCH_STAFFING_PILOT_ALL_USERS`, so the readiness tool structurally cannot disagree with
runtime about roster admission. `OUTREACH_PROVIDER` being absent resolves to `smartlead_csv`,
which is **not** in `KNOWN_PROVIDERS` and therefore throws — that is the designed
fail-**closed** path, not a latent risk.

---

## 7. Not performed — stated honestly

These checks are **NOT VERIFIED**. They are not failures; they were deliberately not run.

1. **Authenticated behavioural smoke tests.** Non-pilot user denial, per-user pilot access,
   unknown-scope fail-closed behaviour, a company/signal block, and cross-tenant denial all
   require a logged-in session. Obtaining one would require requesting plaintext passwords,
   which is prohibited. **These belong to the two pilot operators to execute in their own
   sessions** — see the onboarding document.
2. **TheirStack post-deployment execution.** **Not verifiable yet.** Its next scheduled run
   is `'35 1 * * 1,4'` (`src/worker.ts:1710`) — **Thursday 2026-07-30 at 01:35 UTC**.
   **No claim is made that TheirStack is healthy.** It must be checked after that run.
3. **`[edge-drainer] loop error`.** A live Redis-side error repeats roughly every five
   seconds on the active deployment with an empty message body. Cause not established. It
   is unrelated to the WizMatch pilot surface and does not gate it, but it is real and
   currently unexplained.

---

## 8. Verdict

**G3 SMOKE PASS — no Critical or High finding.** Sending, automated email, preparation,
provider-backed outreach, paid discovery and Google fallback are all disabled; enforcement is
`shadow`; unknown scope fails closed; the roster is exactly two humans; the machine viewer
sits outside the human roster. Company Policy and Decision Workbench are enabled and
available.

Nothing in production was changed by this review: no variable, no user, no role, no roster,
no deployment, no migration, no backfill, no restore, no send.
