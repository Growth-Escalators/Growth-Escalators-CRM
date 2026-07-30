# WizMatch — failure matrix, 2026-07-30

Every reproduced failure, with steps, expected vs actual, severity, fix, required regression test
and production impact. Commit `4678d505`, deployment `b26b90ef`.

**No credential, secret, connection string or personal datum appears here.**

---

## H-1 — Cross-tenant read via unverified `tenantId` claim · **HIGH**

| | |
|---|---|
| **Where** | `src/middleware/auth.ts:45` (and the `requireAuth` block at `:79–86`) |
| **Precondition** | Ability to sign a JWT. Not reachable by an ordinary authenticated user — **but see M-11: `list_variables` returns `JWT_SECRET` in plaintext, so the practical bar is Railway project read access, not a secret compromise.** |

**Steps to reproduce (local, synthetic):**
1. Seed one distinguishable candidate row in each of two tenants.
2. Log in as a WizMatch admin; decode the JWT.
3. Re-sign the identical claims with `JWT_SECRET`, changing only `tenantId` to the other tenant's UUID.
4. `GET /api/wizmatch/candidates` with the re-signed token.

**Expected:** 401/403, or an empty result — the token's tenant should be validated against the
user's actual tenant.
**Actual:** HTTP 200 returning the **other tenant's** row (`tenant_id` of `growth-escalators`,
carrying that tenant's synthetic marker).

**Why:** `requireAuth` fetches only `token_version`, keyed on `users.id`:
`db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId))`.
It never compares `payload.tenantId` to `users.tenant_id`. Handlers then scope by the
attacker-supplied `req.user.tenantId`.

**Suggested fix:** select `tenantId` in that same query and reject on mismatch — no extra round trip:

```ts
const [user] = await db.select({ tokenVersion: users.tokenVersion, tenantId: users.tenantId })
  .from(users).where(eq(users.id, userId)).limit(1);
// ... then, alongside the existing token_version check:
if (user.tenantId !== payload.tenantId) return res.status(401).json({ error: 'invalid token — tenant mismatch' });
```
Cache the tenantId alongside tokenVersion so the 30 s cache still applies.

**Regression test required:** a validly-signed token whose `tenantId` differs from the user's DB
tenant must 401. **Mutate the check away and watch the test go red** before accepting it — this
repo has a documented history of vacuous controls.

**Production impact:** none today (requires the signing secret). Removes the second barrier that
would otherwise contain a secret compromise. Note both pilot operators hold accounts in *two*
tenants, which makes correct tenant binding especially load-bearing here.

---

## M-1 — F-A machine-sync lane unreachable; Command Deck sync broken · **MEDIUM**

| | |
|---|---|
| **Where** | `src/index.ts:353`, `:354`, `:358` vs `:418`; `src/middleware/wizmatchMachineSyncLane.ts` |

**Steps to reproduce (local):**
1. Create a `viewer` user in the WizMatch tenant; log in.
2. `GET /api/wizmatch/dashboard` (or any of the other 7 allowlisted paths).

**Expected:** 200 — the owner-ratified F-A lane admits exactly 8 GET paths for `role='viewer'`.
**Actual:** **403 `staffing_pilot_access_required`** on all 8.

**Decisive discriminator:** `GET /api/wizmatch/zzz-does-not-exist-anywhere` returns **403 with the
pilot error, not 404** — proving `router.use(...)` middleware runs for every request through those
routers regardless of whether any route matches.

**Why:** `wizmatchPolicyRouter` (`:353`), `wizmatchTodayRouter` (`:354`) and `wizmatchPrepareRouter`
(`:358`) each call `router.use(wizmatchPilotGate)` with no path. They are mounted *before*
`wizmatchPilotOrMachineSync` at `:418`. The viewer is rejected at `:353`.

**Not a security defect** — it fails closed. But the feature does not work, and the go-live docs say
it does.

**Suggested fix (needs owner review — this is guarded middleware ordering):** mount
`wizmatchPilotOrMachineSync` *before* the three internally-gated routers, or give those routers'
`router.use` the same machine-sync bypass, or scope their `router.use` to the paths they actually
serve (as `wizmatchStaffing.ts:49` already does with `STAFFING_PATH`). The third is the smallest
and most consistent with existing practice.

**Regression test required:** an **integration** test against the assembled Express app — not the
pure predicate — asserting a `viewer` gets 200 on all 8 allowlisted paths and 403 elsewhere. The
existing 55 unit tests pass while the feature is broken, so they cannot serve as this evidence.

**Production impact:** the Command Deck sync (`crm-sync.mjs`) cannot read any of its 8 endpoints.
No pilot-user impact.

---

## M-2 — 15 real-backend Playwright tests cannot be un-skipped · **MEDIUM**

**Steps:** set `WIZMATCH_E2E_TEST_PASSWORD` (verified visible to node: `SET(28)`), start the real
backend on `:3000`, run the two hardening specs — also with the variable passed explicitly inline.
**Expected:** the 5 tests execute. **Actual:** all 5 × 3 projects still report `skipped`. Cause not
established.

**Fix:** diagnose why the worker does not observe the variable; document a working enablement path.
**Regression test:** a CI job that fails if these specs skip.
**Impact:** the contact-cap and delete/archive safety behaviours have no executed E2E coverage;
headline pass counts overstate real coverage.

---

## M-3 — `users.is_active` exists in no schema or migration · **MEDIUM**

**Steps:** build a database from migrations alone (`drizzle-kit migrate` on an empty PG18).
**Expected:** `users.is_active` present. **Actual:** absent — `users` is
`id, tenant_id, name, email, password_hash, created_at, role, token_version`.

**Why:** the column is created at runtime by
`db.execute(sql\`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true\`).catch(() => {})`
at `src/routes/permissions.ts:21` — fire-and-forget, errors swallowed. Login references
`u.is_active` in raw SQL and treats NULL as active.

**Fix:** add a real migration for `is_active` (and `is_test_account`) and model them in
`schema.ts`. **Guarded path — needs owner approval and generated migration, not a hand edit.**
**Regression test:** a fresh-DB boot test asserting login works and an inactive user is refused.
**Impact:** a DR restore or new environment can diverge from production; a swallowed ALTER failure
would make every account implicitly active.

---

## M-4 — Migration journal hash drift · **MEDIUM** *(pre-existing)*

Four local files (`0008`, `0009`, `0013`, `0014`) do not hash-match the production journal; two
production hashes (ids 5, 10) have no local file. `0009` traced conclusively: the applied blob is
journal id 10; the file was edited after application.
**Impact:** none at apply time (drizzle compares timestamps, not per-file hashes). A from-scratch
replay would not reproduce production history for those slots.
**Fix:** document the as-applied state; do not rewrite history. **Regression test:** a CI check
comparing local hashes to the production journal, reporting drift without failing the build.

---

## M-5 — Only backup predates `0037` and the backfill · **MEDIUM**

The encrypted archive (`2026-07-28T05:59:17Z`) is intact and restore-tested, but was taken
*before* migration `0037` and the G2 backfill. Restoring it would drop all 8 new tables and all 183
root-policy rows, requiring a mid-incident replay. Railway managed backup/PITR is unavailable, so
this is the only rollback path.
**Fix:** take a fresh encrypted logical backup of the current verified-good state before further
production writes. **Impact:** materially longer, riskier recovery.

---

## M-6 — Startup makes external network calls despite `DISABLE_BACKGROUND_JOBS=true` · **MEDIUM**

**Steps:** boot the backend with `DISABLE_BACKGROUND_JOBS=true` against an empty database.
**Expected:** no outbound third-party traffic. **Actual:** PageSpeed requests to three external
domains (HTTP 429) plus programmatic SEO generation, from `[startup] site_health_metrics empty`.
**Fix:** gate startup enrichment behind its own flag, or include it under the existing one.
**Regression test:** boot test asserting zero outbound requests when the flag is set.
**Impact:** unexpected third-party egress and quota consumption from any fresh environment.

---

## M-7 — 22 high-severity dependency advisories · **MEDIUM**

0 critical / 22 high / 12 moderate / 1 low. Most relevant: `nodemailer` CRLF header injection,
`form-data` CRLF injection, `axios` ReDoS, `multer` nested-field DoS.
**Fix:** upgrade transitives; prioritise `nodemailer`/`form-data` **before** email is ever enabled.
**Impact:** none while sending is disabled.

---

## M-8 — Shipped go-live documentation is now inaccurate · **MEDIUM**

The docs merged in PR #90 state "EXPLICIT CONFIG REDEPLOY PENDING" (now **resolved** — all four
variables are explicit in deployment `b26b90ef`) and that the viewer machine-sync lane admits eight
GET paths (it does **not** — M-1).
**Fix:** correct both statements. **Impact:** operators may trust a broken sync path and believe a
completed step is outstanding.

---

## L-1 — 30-second revocation window · **LOW**

`TOKEN_VERSION_CACHE_TTL_MS = 30_000` (`src/middleware/auth.ts:38`). A revoked session remains
usable for up to 30 s. Deliberate, documented, fail-closed on DB error. Accept or shorten for
privileged roles.

## L-2 — `/placements` 403 for the viewer · **LOW**

Pre-existing, documented, feeds no cockpit tile. Blocked by its own `['admin','team_lead']` check.

---

## Re-adjudicated — NOT defects

- **`SEC-ROLE-1`** (expected 403, got 401): the 401 is correct — the forged token carried a
  mismatched `token_version` and was rejected before the roster check. Harness error.
- **First `SEC-TEN-1` run** (both tenants returned `rows=0`): **inconclusive**, not a pass — no data
  existed to leak. Re-run with seeded rows produced H-1.
- **Initial `/auth/login` 404s and 429s**: wrong path, then the 5/60 s login limiter — harness
  artefacts. The limiter working is a positive finding (`SEC-1`).

---

## Not tested — no verdict claimed

Production authenticated checks (operator sessions required; no plaintext password requested) ·
TheirStack and ATS cron execution · full production user inventory · vitest coverage and CI gap
analysis · slow-query inventory, connection-pool behaviour, N+1 detection, bulk-action limits ·
timed policy resolution over the 1 000 seeded companies · CSRF (token-based auth, no cookie session
observed).

---

# Addendum — findings from the four lanes (folded in 2026-07-30, after first draft)

## C-1 — Upstash request cap exhausted · **CRITICAL**

**Where:** `src/services/edgeQueueDrainer.ts`; external Upstash Redis REST (**not** the Railway
`Redis` service).
**Reproduce:** `railway logs -s web -e production --lines 50`.
**Actual:** `Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500000` —
every ~5.2 s, continuously since boot. Verified by Lane 3 and independently by me.
**Expected:** the drainer consumes the `crm:events` stream written by Vercel edge functions
(Cashfree webhooks, lead/waitlist/agency-lead forms, Tally beacons).

**Read side is safe:** `XREADGROUP` never returns, so nothing is wrongly ACK'd or trimmed.
**Write side is the urgent unknown:** if the same account cap rejects the edge functions' `XADD`,
new leads and payment webhooks are failing to enqueue **right now** — live data loss at ingestion.
**Not confirmed here; check first.**

**Fix:** billing/plan decision on the Upstash account — not a code or Railway change. Optionally
lengthen the retry backoff when the error text matches the cap message.
**Regression test:** alert on sustained `[edge-drainer] loop error`. Note the MCP `get_logs`
`search=` filter **cannot see this line** (the logger nests it under `data`; Railway indexes only
top-level `msg`) — use the raw CLI.
**Impact:** CRM-wide. Does **not** touch the WizMatch pilot surface.

## H-2 — Active former-employee account · **HIGH** · ✅ **REMEDIATED 2026-07-30**

`nimisha.daiya@growthescalators.com`: `is_active=true`, `role='staff'`, `token_version=5`, despite
`src/scripts/removeNimisha.ts` existing since 2026-05-10 with no trace of having run.
**Employment status UNVERIFIED — confirm before acting.** If she has left, the account can log in
today. **Fix:** deactivate via `DELETE /api/permissions/users/:userId` (sets `is_active` *and*
bumps `token_version`). **Regression test:** an offboarding checklist assertion that no departed
staff row has `is_active=true`.

## H-3 — Offboarding scripts permit re-login · **HIGH** · ✅ **FIXED 2026-07-30**

`removeVishal.ts:93-97`, `removeNimisha.ts:97-101` set `role='deactivated'`, `token_version=-1`,
but **not** `is_active`. Login (`auth.ts:83`) gates on `is_active`, not role → re-login succeeds
with a known password and issues a fresh valid token. The API path (`permissions.ts:306-311`) is
correct. **Fix:** make the scripts set `is_active=false`, or delete them in favour of the API.
**Regression test:** run each script against a synthetic user, then assert login is refused.

## H-4 — `optionalAuth` does not enforce revocation · **HIGH** · ✅ **FIXED 2026-07-30**

`src/middleware/auth.ts:105-126` checks only that a `tokenVersion` claim exists — never the DB
value — unlike `requireAuth`. Mounted on `/api/outreach/leads` (`src/index.ts:281`). A revoked
session keeps authenticating there until JWT expiry (up to 7 days). Deliberate per comment at
`auth.ts:128-130`; **0 % test coverage**. **Fix:** owner decision — either re-check DB
`token_version` (consistent with `requireAuth`) or document the exemption explicitly.
**Regression test:** revoke, then assert `/api/outreach/leads` 401s.

## M-9 — Coverage blind spot: five files invisible to the CI gate · **HIGH (Lane 1)**

`wizmatchMachineSyncLane.ts`, `policyBackfill.ts`, `decisionWorkbenchCapabilities.ts`,
`outreachIdempotencyKey.ts`, `scopeKey.ts` are imported non-mocked by passing tests yet **never
appear in v8 coverage output**, not even at 0 %. Reproduced twice. Root cause unconfirmed.
**Impact:** CI's 30 % floor cannot see them; a drop to 0 % coverage would be invisible. One of them
is the middleware this run proved non-functional (M-1).

## M-10 — `emailService.ts` at 7.93 % statement coverage · **MEDIUM**

2.85 % branch, 14.28 % function, on a live-send email service. Matters more once email is enabled.

## M-11 — `list_variables` returns all secrets in plaintext · **MEDIUM (re-confirmed)**

Lane 3 re-confirmed the tool returns all 163 production variables in full plaintext, including
`JWT_SECRET` and `DATABASE_URL`. **This is what weakens H-1's precondition** from "secret
compromise" to "Railway read access". **Guidance: do not use `list_variables`** — use
`railway ssh` + `printenv` scoped to specific non-secret flags.

## CORRECTED — "deployment migrations are NOT automatic" was WRONG

Deploy logs for `b26b90ef` show `[migrate] Migration started … Migration complete` (18:36:58Z). The
`[migrate]` prefix is emitted only by `src/scripts/migrate.ts`, invoked only by `railway.json`'s
`startCommand`. **`railway.json` IS honoured; migrations DO run at deploy.** `get_service_config`
shows only the command's tail, and a `sh -c "A && B"` shell execs the final command, so PID 1
reading `node dist/index.js` was not proof. Corrected in `docs/go-live/`, `docs/handoffs/`,
`.ai/CURRENT_TASK.md` and (as an append-only note) `.ai/HANDOFF_LOG.md`. Builder drift
(NIXPACKS vs RAILPACK) is real but cosmetic — builds are green.

## Not a defect — `ecom.` false-green explained

The domain is still attached to this Railway service but dormant: its real DNS CNAME points to
Vercel, Railway reports `DNS_RECORD_STATUS_REQUIRES_UPDATE`, certificate stuck `ISSUING`. Hence
HTML-with-200 on `/health`. Use `api.` / `crm.`.


---

# Remediation applied — 2026-07-30 (owner-approved)

| ID | Action taken | Evidence |
|---|---|---|
| **H-2** | Both `nimisha.daiya@` and `vishal.malakar@` deactivated in production via the supported mechanism (`is_active=false` + `token_version` bump), with an `audit_events` row each. Nimisha tv 5→6; Vishal was already `is_active=false`, tv 3→4 so any lingering token is dead. `role` left intact, exactly as the API path does. **Zero records were assigned to either user**, so no reassignment was needed. | `UPDATE 2`, `INSERT 0 2`; post-commit verify shows both `is_active=f` |
| **H-3** | `src/scripts/removeVishal.ts` and `removeNimisha.ts` now set `is_active = false` alongside the `token_version = -1` sentinel, matching `permissions.ts:309`. A user "removed" by these scripts can no longer log back in. | both scripts, Step 4 |
| **H-4** | `optionalAuth` now verifies `token_version` against the database via the same 30s-TTL cache as `requireAuth`. A revoked token **degrades to anonymous** rather than 401, preserving the route's public-by-secret contract. Fail-closed on lookup error. | `src/middleware/auth.ts` |

**H-4 impact was narrower than first reported.** `src/routes/outreachLeads.ts` — the only mount
using `optionalAuth` — reads `req.user` **zero times**; it authorises via
`OUTREACH_INTERNAL_SECRET`. So no privilege decision was ever made from the stale identity. The fix
is defense-in-depth: it closes the gap before anyone adds a `req.user` check to that router.

**Regression tests added and proven non-vacuous.** Six new `optionalAuth` tests in
`src/__tests__/auth.test.ts`. Reverting the DB check turns **3 of them red** (revoked session,
missing user row, lookup throws) — verified by running the mutation, per this repo's standing rule
that a control is assumed vacuous until watched to fail.

**Gates:** `npm run build` exit 0 · `npm test` **132 files / 1557 tests** passing (was 1551).

**Still open from this run:** C-1 (Upstash — the urgent one), H-1, M-1, M-2, M-5, M-9, and the rest.
