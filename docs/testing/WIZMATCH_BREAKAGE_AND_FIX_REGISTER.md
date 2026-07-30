# WizMatch — breakage and fix register, 2026-07-30

QA run: full-platform validation and remediation.
Branch `qa/wizmatch-full-playwright-flow-remediation`, from `origin/main` at `f8036120`.

**No credential, secret, connection string, token or personal datum appears in this file.**

Findings are numbered `QA-n`. Where a finding corresponds to one already recorded in
[`WIZMATCH_FAILURE_MATRIX_2026-07-30.md`](WIZMATCH_FAILURE_MATRIX_2026-07-30.md), that ID is given.

Every fix below was **reproduced before it was written** and **mutation-tested after** — the
control was deliberately broken and watched to turn the test red, per this repo's standing rule
that a guard is assumed vacuous until seen to fail.

---

## QA-1 — Machine-sync lane unreachable (was M-1) · MEDIUM · **FIXED**

| | |
|---|---|
| **Feature** | Command Deck sync (`viewer` machine account, 8 allowlisted GET paths) |
| **User impact** | The Command Deck sync could read none of its 8 endpoints. No pilot-operator impact — it fails closed, so this is a broken feature, not a security hole. |
| **Expected** | A `viewer` GET on `/dashboard`, `/command-center`, `/candidate-intelligence/queue`, `/client-discovery/queue`, `/review-workbench`, `/guardrails`, `/placements`, `/candidates` returns 200. |
| **Actual** | 403 `staffing_pilot_access_required` on all 8. |
| **Reproduced** | `src/__tests__/wizmatchMachineSyncLaneMountIntegration.test.ts` — mounts the real routers in the real `src/index.ts` order. Before the fix all 8 returned 403. |

**Root cause.** `wizmatchPolicy.ts`, `wizmatchToday.ts` and `wizmatchPrepare.ts` each called
`router.use(wizmatchPilotGate)` with **no path argument**. Under `app.use('/api/wizmatch', ...)` an
unpathed `router.use` matches every path beneath the shared prefix — not only the paths that router
defines. All three are mounted at `index.ts:353/354/358`, ahead of the machine-sync lane at `:418`.
A `viewer` GET for `/dashboard` — a path none of them serves — was 403'd by the first router and
never reached the lane. `viewer` can never satisfy that gate: `PILOT_ELIGIBLE_ROLES`
(`wizmatchStaffingAccess.ts:13`) omits it and `pilotAllowed = roleEligible && (...)` (`:48`), so no
roster configuration admits it in any runtime.

**Correction to the original diagnosis.** The failure matrix did not record the precondition:
`featureGate` runs **before** the pilot gate in all three routers and calls `next('router')` when
its flag is off, skipping the gate entirely. **With the flags off — the local default — the lane
already worked.** This reproduces only in the flag-on configuration the live pilot runs. That is
why 55 passing unit tests on the predicate never saw it, and why any local check would have shown
it working.

**Files changed.** `src/routes/wizmatchPolicy.ts`, `wizmatchToday.ts`, `wizmatchPrepare.ts`.

**Fix.** Each gate now uses the existing `wizmatchPilotOrMachineSync` wrapper instead of the bare
gate. Chosen over scoping each `router.use` to a path regex — the option the failure matrix
suggested — because a regex duplicates the route table into a second place that can silently drift,
and would have to match Express's own path-matching semantics exactly or become a bypass. The
wrapper's predicate exact-matches 8 GET paths for a `viewer` only, and none of them is a route in
any of the three files, so every request those routers actually serve still hits the identical
roster check.

**Tests added.** 8 in `wizmatchMachineSyncLaneMountIntegration.test.ts`: all 8 paths return 200 for
a machine viewer, plus 5 fail-closed guards (non-allowlisted path, non-GET method, the flagged
surfaces themselves, a non-roster admin on an allowlisted path, a non-roster admin on the flagged
surfaces) so the fix cannot be widened by accident, plus one documenting the flags-off case.

**Current result.** 8/8 green. **Production follow-up:** none required — code-only.

---

## QA-2 — Cross-tenant read via unverified `tenantId` claim (was H-1) · HIGH · **FIXED**

| | |
|---|---|
| **Feature** | Authentication / tenant isolation |
| **User impact** | An actor able to mint a token could read any other tenant's data with HTTP 200. |
| **Expected** | A token whose `tenantId` claim does not match the user's `users.tenant_id` is refused. |
| **Actual** | Accepted. Handlers then scoped their queries by the attacker-supplied value. |
| **Reproduced** | `src/__tests__/auth.test.ts` → `requireAuth — tenant binding (H-1)`. 4 tests red before the fix. |

**Root cause.** `requireAuth` verified the JWT signature and the DB `token_version`, but never
compared `payload.tenantId` to `users.tenant_id`. The `token_version` check could not contain this:
it is keyed on `users.id`, so the attacker's own id and own current version both match — the tenant
was the only tampered claim, and nothing checked it. The practical bar was Railway project read
access rather than a secret compromise, because `list_variables` returns `JWT_SECRET` in plaintext
(failure-matrix M-11). Both pilot operators hold accounts in two tenants, so tenant binding is
load-bearing here rather than theoretical.

**Files changed.** `src/middleware/auth.ts`, `src/__tests__/auth.test.ts`.

**Fix.** `currentTokenVersion` became `currentIdentity` and selects `tenant_id` alongside
`token_version` in the same single-row query, cached under the same 30s TTL — so the warm path
still issues no query and **the binding is enforced on cache hits too**, not only cold lookups.
Both checks moved into one shared `identityMismatch` helper used by `requireAuth` and
`optionalAuth`, so the two cannot drift apart again the way H-4 did. Rejection returns one opaque
message for every reason; naming the tenant would confirm which claim was rejected and leak the
user's real tenant. The reason is logged server-side.

**Deliberately not added:** a separate `!identity.tenantId` branch. Both callers already reject a
falsy `tenantId` claim upstream, so it would be unreachable — and a guard no test can turn red is
indistinguishable from a vacuous one. Mutation testing caught this: the branch killed zero tests.

**Tests added.** 7. **Verified non-vacuous by mutation** — deleting the tenant comparison turns 4
red (forged tenant, NULL DB tenant, forged tenant on a warm cache hit, and the `optionalAuth`
equivalent).

**Current result.** 29/29 green in that file. **Production follow-up:** none required by this
change. Separately, `JWT_SECRET` remains readable via `list_variables` (M-11) — that is the
precondition this fix defends against, and it is unchanged.

---

## QA-3 — `users.is_active` existed in no migration (was M-3) · MEDIUM · **FIXED**

| | |
|---|---|
| **Feature** | Authentication; offboarding |
| **User impact** | A database built from migrations alone came up without the column. Because login references it in raw SQL, **login fails outright on such an environment** — any new environment, or a DR restore. |
| **Expected** | `users.is_active` present after a clean migration replay. |
| **Actual** | Absent. |
| **Reproduced** | Clean `drizzle-kit migrate` onto an empty PostgreSQL 18.4 database; `\d users` showed `id, tenant_id, name, email, password_hash, created_at, role, token_version` and no `is_active`. Independently confirmed by the infrastructure lane. |

**Root cause.** The column was created only by a fire-and-forget, error-swallowing runtime ALTER at
`src/routes/permissions.ts:21`, and modelled in neither `schema.ts` nor any migration — while
`src/routes/auth.ts` gates login on it at `:83`, `:169` and `:258`.

**Correction to the original diagnosis.** The failure matrix stated that "a swallowed ALTER failure
would make every account implicitly active." That is not the failure mode. If the column is absent
the login SQL *errors*, so login breaks rather than becoming permissive. The NULL-tolerant predicate
(`is_active IS NULL OR is_active = true`) only applies once the column exists.

**Files changed.** `src/db/schema.ts`, `src/db/migrations/0038_wild_marvex.sql`,
`src/db/migrations/meta/0038_snapshot.json`, `_journal.json`.

**Fix.** Modelled on the `users` table and generated via `npm run db:generate` (not hand-written).
The generated statement was then hand-edited to `ADD COLUMN IF NOT EXISTS`, which is a **correctness
requirement, not a style choice**: every existing database already has this column from the runtime
ALTER, so the bare form drizzle emits raises `column "is_active" of relation "users" already
exists` — **proven against the replay database**. Migrations run from the API service's
`startCommand`, so that error means **the API does not start**. The `IF NOT EXISTS` form was proven
to no-op cleanly against a database that already has the column.

`is_test_account` was named alongside `is_active` in the failure matrix but is referenced **nowhere**
in the codebase (independently confirmed by the infrastructure lane). It is deliberately **not**
added, rather than inventing a column no code reads.

**Tests added.** 5 source-level guards in `usersIsActiveMigrationGuard.test.ts`. Mutation-tested:
stripping `IF NOT EXISTS` turns the relevant test red.

**Production follow-up.** **This migration will execute on the next deploy to `main`.** It is
idempotent and proven to no-op against a database that already has the column, but it is the one
change in this branch that touches production Postgres. The ensure hook in `permissions.ts` is
deliberately left in place per the `ge-add-migration` skill; removing it is a follow-up once
production has the column via the migration path.

---

## QA-4 — Cross-tenant IDOR on the job queue · **CRITICAL** · **FIXED**

**New this run. Not in the failure matrix.**

| | |
|---|---|
| **Feature** | Background job queue (`/api/jobs`, polled by n8n) |
| **User impact** | Any authenticated user, of any role down to the lowest-privilege `staff` and in any tenant, could read every tenant's job payloads and claim/complete/dead-letter their jobs. |
| **Expected** | A caller sees and mutates only their own tenant's jobs. |
| **Actual** | `GET /api/jobs/pending` returned every tenant's jobs; `PATCH /api/jobs/:id/claim\|complete\|fail` acted on any job by GUID. |
| **Reproduced** | `src/__tests__/jobQueueTenantScope.test.ts` — 5 red before the fix. Route and service read directly to confirm. |

**Root cause.** `/api/jobs` is mounted with `requireAuth` **only** (`src/index.ts:252`) — no role
gate — and `getPendingJobs`/`claimJob`/`completeJob`/`failJob` filtered by `id`/`status`/`jobType`
and never by `tenant_id`, despite the `jobs` table carrying a `tenant_id` that `insertJob`
populates. The exposed payloads are raw webhook bodies and enrolment records: `sequence_step`
carries `contactId`/`tenantId`; `booking_processed` and `hot_lead_alert` carry contact names and
lead scores.

**Files changed.** `src/services/jobQueue.ts`, `src/routes/jobs.ts`.

**Fix.** An **optional** tenant scope, derived from `req.user` and never from a body, query or
header. The predicate is **"own tenant OR NULL", deliberately not strict equality**: webhook jobs
are inserted with an explicit `null` tenant (`webhooks.ts` — `inbound_wa`, `booking_failed`,
`form_submit`, `chatwoot_event`) and are system work not yet attributed to a tenant. A strict
`tenant_id = caller` filter would hide every one of them from every caller and **silently stop
inbound processing**. The scope is optional so internal system callers stay unscoped —
`stuckJobWorker` sweeps stuck jobs across all tenants and must keep doing so.

**Residual gap, recorded not hidden.** NULL-tenant jobs remain visible to every authenticated
tenant. Closing that requires attributing webhook jobs to a tenant at ingestion — a product change
beyond this pass. See the roadmap doc.

**Tests added.** 6, including one pinning that an unscoped call stays unscoped so a future
tightening cannot silently break the internal sweeper. Mutation-tested: neutering the predicate
turns 4 red.

**Production follow-up.** **Behaviour change to a live integration.** n8n polls this endpoint with
a user JWT that is not visible from this repo. If it relies on processing more than one tenant's
`sequence_step` jobs, it will now see only its own tenant's plus NULL-tenant jobs. **Verify n8n
polling after deploy.**

---

## QA-5 — No master send-flag re-check on sequence dispatch · MEDIUM · **FIXED**

| | |
|---|---|
| **Feature** | Outreach sequences (WizMatch-linked) |
| **User impact** | Latent. Turning sending OFF did not halt sequences already in flight. |
| **Expected** | Flipping `WIZMATCH_SENDING_ENABLED` off stops dispatch. |
| **Actual** | The worker kept enqueuing `sequence_step` jobs. |

**Root cause.** `sequenceWorker` gated WizMatch-linked enrolments on the outreach **policy** gate
only, which defaults to **shadow** (`outreachGate.ts` treats anything other than the literal
`'enforce'` as log-only) and so never blocks by default. `WIZMATCH_SENDING_ENABLED` was read once at
enrolment time and never again.

Not live today: sending is disabled and `multiDomainMailer` independently refuses to send. This is
the gate you want in place **before** the first real send.

**Files changed.** `src/workers/sequenceWorker.ts`.

**Fix.** A master-flag re-check before dispatch, **scoped to WizMatch-linked enrolments only** —
this worker serves every tenant's sequences and `WIZMATCH_SENDING_ENABLED` is a WizMatch switch, so
gating the whole worker would halt the Growth tenant's unrelated sequences. It **holds** without
advancing or cancelling: the step stays due, so re-enabling resumes exactly where it paused and a
temporary flag flip cannot destroy a sequence.

**Tests added.** 6, pinning both halves (held when linked, untouched when not), ordering, and
fail-closed semantics. Two mutations: removing the check turns 5 red; `!== 'true'` → `=== 'false'`
turns the fail-closed test red.

**Production follow-up.** None — no behaviour change while sending is off.

---

## QA-6 — Deactivation was not a kill switch on its own · MEDIUM · **FIXED**

**New this run.** Found by the Playwright lane against the real backend.

| | |
|---|---|
| **Expected** | A deactivated user's existing session stops working. |
| **Actual** | A token issued before deactivation kept working for up to its full 7-day expiry. |

**Root cause.** Login gates on `is_active`, but nothing re-checked it per request. **Never
exploitable through the supported path** — `DELETE /api/permissions/users/:userId` bumps
`token_version` in the same UPDATE, and the offboarding scripts were fixed to match in PR #91 — but
it made session death depend on remembering to bump a second column. Any other route to deactivation
(a direct SQL fix during an incident, a future code path, or that UPDATE partially applying) left
live sessions alive.

**Fix.** `is_active` joins the existing single-row identity select and is checked per request,
bounded by the same 30s TTL. **`=== false`, not falsy** — the column is nullable and login reads
`is_active IS NULL OR is_active = true`; a truthiness test would log out every user whose row
predates the backfill, which is most of them on any pre-0038 database.

**Tests added.** 3. Two mutations: removing the check turns 2 red; `=== false` → `!` turns the
NULL-semantics test red.

---

## QA-7 — 15 real-backend Playwright tests could not be un-skipped (was M-2) · MEDIUM · **CLOSED — not a code defect**

**Expected:** setting `WIZMATCH_E2E_TEST_PASSWORD` lets the hardening specs execute.
**Actual (as recorded):** they still reported `skipped`; cause never established.

**Root cause, now established.** Not a defect in the specs, the config, or Playwright/Node env
inheritance — all are correct as written. `export VAR=...` in one shell invocation followed by
`npx playwright test` in a **separate** invocation loses the variable: each command starts a fresh
shell and only the working directory persists. The original diagnosis verified the variable in one
process and ran the tests in another.

**Verified both directions, independently, this run:**

| | |
|---|---|
| same invocation | tests **EXECUTE** — 1 failed on a missing backend, 1 did not run. **Not skipped.** |
| variable absent | 2 skipped |

**Fix.** `scripts/run-wizmatch-e2e.sh` — the working path made executable rather than described.
Everything runs in one process, so the credential cannot be lost between being set and being used.
It also implements the regression guard M-2 asked for: **a skipped real-backend test now fails the
run** with a distinct exit code, instead of being silently counted as a pass. A DB-name interlock
refuses any target not containing `test`/`qa`/`e2e` (verified: exits 2 for `production`), and every
send/spend/provider flag is pinned off explicitly.

---

## Verified but NOT fixed — deliberate, with reasons

| ID | Finding | Severity | Why not fixed here |
|---|---|---|---|
| **QA-8** | `GET /health` returns HTTP 200 even when its own body says `unhealthy` (`healthRoute.ts:79-99` — `res.json()` with no `.status()`). `railway.json` sets `healthcheckPath=/health`, so Railway cannot see a DB outage. | HIGH | Owner decision: returning 503 makes Railway's healthcheck fail and restart or block a deploy on any transient DB blip — a real availability change to a live service. Needs a deliberate ops decision about restart behaviour, not a QA-pass edit. |
| **QA-9** | `input-data/` (~116MB of scraped business data) is excluded only via machine-local `.git/info/exclude`, not the tracked `.gitignore`. A fresh clone has no rule; `git add -A` there could commit the dataset. | HIGH | `.gitignore` carries an **uncommitted user change** in the working tree. Committing it would sweep up unrelated work, which the repo's dirty-worktree rule forbids. **Action required by owner** — see roadmap. |
| **QA-10** | Docs describe a two-service Railway topology (`web` + `worker`); the repo has only `railway.json` + a single-process `Procfile`. `docs/wizmatch/DATAFLOW.md:66` already records the real one. | MEDIUM | Documentation drift across several docs; corrected in this run's docs, but the stale claims live in files outside this branch's remit. Listed for follow-up. |
| **QA-11** | `WIZMATCH_OUTREACH_ADAPTER_ENABLED` is read only in the readiness report, never in the provider factory. `getOutreachProvider()` has **zero callers**, so nothing it could gate is wired up today. | MEDIUM (latent) | Not currently exploitable — there is no live path. Fixing it now would be speculative hardening of unreachable code. Flagged as a **hard precondition** before any real provider is wired. |
| **QA-12** | Upstash request cap exhausted, `[edge-drainer] loop error` every ~5.2s (failure-matrix C-1). | CRITICAL | Billing/plan decision on the Upstash account — **not a code or repo change.** Unchanged by this run. |
| **QA-13** | Migration journal hash drift on `0008`/`0009`/`0013`/`0014` (failure-matrix M-4). | MEDIUM | Pre-existing. Replay is internally consistent and applies clean — confirmed this run on PostgreSQL 18.4. Rewriting history is the wrong fix. |
| **QA-14** | 22 high-severity dependency advisories (`nodemailer` CRLF, `form-data` CRLF, `axios` ReDoS, `multer` DoS). | MEDIUM | Out of scope for a behavioural QA pass; `nodemailer`/`form-data` must be upgraded **before** email is ever enabled. |
| **QA-15** | Startup makes external PageSpeed calls despite `DISABLE_BACKGROUND_JOBS=true` (failure-matrix M-6). | MEDIUM | Verified still present. Not fixed — sits outside the WizMatch surface this run remediated, and gating it changes startup behaviour for the whole CRM. |
| **QA-16** | Additional IDOR / tenant-tampering candidates reported by the security lane: bookings detail, `messages`/`sequences` taking `tenantId` from `req.body`, growthOS GET routes with no permission check and no `tenant_id` column. | HIGH (if confirmed) | **PLAUSIBLE, not verified by me.** Reported by a lane and not independently reproduced in the time available. Listed as the **top follow-up** — see roadmap. I do not assert these as confirmed defects. |
