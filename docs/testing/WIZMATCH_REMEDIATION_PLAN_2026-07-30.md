# WizMatch — remediation plan, 2026-07-30

Issue-ready specifications for every confirmed defect. Ordered for safe execution.
**Do not batch these into one PR.** Items 1 and 2 touch guarded paths and need owner approval.

Baseline: commit `4678d505`, deployment `b26b90ef` (SUCCESS).

---

## Safe remediation order

| # | ID | Severity | Change | Guarded? | Blocks pilot? |
|---|---|---|---|---|---|
| **0** | **C-1** | **Critical** | **Upstash quota exhausted — confirm whether edge `XADD` writes are also failing (possible live ingestion data loss)** | Billing/plan decision | No (CRM-wide, not pilot) |
| 0a | H-2 | High | Confirm Nimisha's employment status; deactivate via the **API path** if she has left | **Yes** — production user | No |
| 0b | H-3 | High | Offboarding scripts must set `is_active=false`, or be deleted in favour of the API | No (scripts) | No |
| 0c | H-4 | High | Decide whether `optionalAuth` re-checks DB `token_version` | **Yes** — auth | No |
| 0d | M-9 | High | Investigate why 5 files are invisible to v8 coverage / the CI gate | No | No |
| 1 | H-1 | High | Verify `tenantId` in `requireAuth` | **Yes** — auth trust boundary | No |
| 2 | M-1 | Medium | Restore machine-sync lane reachability | **Yes** — middleware ordering | No |
| 3 | M-5 | Medium | Fresh encrypted logical backup | **Yes** — production data | No |
| 4 | M-8 | Medium | Correct shipped go-live docs | No | No |
| 5 | M-2 | Medium | Repair E2E enablement, run the 15 tests | No | No |
| 6 | M-3 | Medium | Model `users.is_active` in a migration | **Yes** — schema | No |
| 7 | M-7 | Medium | Dependency upgrades | No | No |
| 8 | M-6 | Medium | Gate startup external calls | No | No |
| 9 | M-4 | Medium | Document journal drift + CI drift check | No | No |
| 10 | L-1, L-2 | Low | Accept or tune | No | No |

**C-1 comes first and is not optional.** It is the only Critical, it is live right now, and the
open question — whether Upstash's cap is also rejecting the Vercel edge functions' `XADD` writes —
determines whether leads and Cashfree webhooks are being lost at ingestion today. Check the Upstash
console and Vercel logs before anything else here. Restoring request budget is a billing decision
for the account owner; **do not act on it unilaterally.** It does not touch the WizMatch pilot.

H-2/H-3 come next because together they mean a departed employee may retain working access.

Rationale for the rest: H-1 is the smallest change with the largest trust-boundary gain. M-1
restores a feature the owner already ratified. M-5 must precede any further production writes.
M-8 stops operators trusting a broken path. Everything after is hygiene.

---

## 1 — H-1 · Verify `tenantId` in `requireAuth`

**Files:** `src/middleware/auth.ts` (**guarded** — trust boundary; owner approval required).

**Problem:** `requireAuth` fetches only `token_version`, keyed on `users.id`, and never checks that
`payload.tenantId` matches the user's actual tenant. A validly-signed token with a forged
`tenantId` reads another tenant's data (proven).

**Change:** extend the existing lookup and cache to carry `tenantId`; reject on mismatch alongside
the existing `token_version` check. No extra query.

**Acceptance:**
- A token whose `tenantId` differs from the user's DB tenant → **401**.
- A genuine token still works; the 30 s cache still applies.
- Both pilot operators (who hold accounts in *two* tenants) can still log into each tenant normally.

**Regression test:** integration-level, against the assembled app. **Mutate the new check away and
confirm the test goes red before accepting it.**

**Risk:** low code risk, high blast radius — it sits on every authenticated request. Ship alone,
verify the roster and both operators' access immediately after.

---

## 2 — M-1 · Restore machine-sync lane reachability

**Files:** `src/index.ts` mounts (`:353`, `:354`, `:358`, `:418`) and/or `router.use` in
`wizmatchPolicy.ts`, `wizmatchToday.ts`, `wizmatchPrepare.ts` (**guarded** — middleware ordering on
the pilot gate; owner approval required).

**Problem:** those three routers call `router.use(wizmatchPilotGate)` with no path, so the gate runs
for every `/api/wizmatch/*` request and 403s a `viewer` before `wizmatchPilotOrMachineSync` at
`:418` is reached. Proven by a non-existent path returning 403 rather than 404.

**Preferred change:** scope each router's `router.use` to the paths that router actually serves —
mirroring the existing, already-correct pattern at `wizmatchStaffing.ts:49` (`STAFFING_PATH` regex).
This is the smallest change and leaves the pilot gate's semantics untouched for humans.

**Alternatives considered:** mounting the lane earlier (changes gate ordering for all routers — more
blast radius); adding a machine-sync bypass inside each `router.use` (duplicates the lane in three
places).

**Acceptance:**
- A `viewer` gets **200** on all 8 allowlisted GET paths, **403** on everything else.
- `/placements` continues to 403 (L-2, unchanged).
- Non-roster admins and team_leads are still 403'd on `/dashboard` (no regression to ROSTER-3/4).
- A non-existent path returns **404**, not the pilot 403.

**Regression test:** **integration** test against the assembled Express app. The existing 55 unit
tests pass while the feature is broken and must not be cited as evidence.

---

## 3 — M-5 · Fresh encrypted logical backup

**Guarded — production data.** Owner-approved procedure only.

Take a new encrypted logical dump of the current verified-good state (post-`0037`,
post-backfill: 183 root policies, all `needs_review`). Same controls as the 2026-07-28 archive:
AES-256-CBC + PBKDF2-SHA256, passphrase in Keychain, `chmod 600`, plaintext shredded, manifest with
both SHA-256 digests, restore-tested into a disposable PG18.

**Acceptance:** restore test reproduces 183 root policies and all 8 `0037` tables. Retain the old
archive until the new one is verified. **Do not delete the old backup first.**

---

## 4 — M-8 · Correct shipped go-live documentation

**Files:** `docs/go-live/WIZMATCH_PILOT_LIVE_STATUS_FINAL.md`,
`WIZMATCH_G3_SMOKE_TEST_RESULT_FINAL.md`, `WIZMATCH_PILOT_TEAM_ONBOARDING_FINAL.md`.

Two corrections: the "EXPLICIT CONFIG REDEPLOY PENDING" caveat is **resolved** (all four variables
now explicit in `b26b90ef`; `PAID_DISCOVERY` and `GOOGLE_FALLBACK` also now `false`); and the
machine-sync lane does **not** currently admit the 8 GET paths (M-1). Docs-only; no code.

---

## 5 — M-2 · Repair the E2E enablement path

Diagnose why Playwright workers do not observe `WIZMATCH_E2E_TEST_PASSWORD` (verified set and
visible to node in the same shell). Then run the 5 real-backend tests against a disposable local
stack and record the result.

**Acceptance:** the 5 tests execute and pass; a CI job fails if they silently skip.

---

## 6 — M-3 · Model `users.is_active` in a migration

**Guarded — schema.** Generate a migration (`npm run db:generate`); never hand-edit
`schema.ts`/migrations. Add `is_active` and `is_test_account` to the `users` model and a real
migration, then remove or keep the runtime `ALTER` at `permissions.ts:21` as a belt-and-braces
no-op.

**Acceptance:** a database built from migrations alone has both columns; login refuses an inactive
user on a fresh DB; the swallowed-error path can no longer leave the column missing.
**Sequencing note:** any new migration's `folderMillis` must exceed the newest applied
`created_at` (`2026-07-28T14:54:18Z`) or drizzle will silently skip it. Today's date satisfies this.

---

## 6a — H-3 · Fix the offboarding scripts

`src/scripts/removeVishal.ts:93-97` and `removeNimisha.ts:97-101` set `role='deactivated'` and
`token_version=-1` but never `is_active`. Login gates on `is_active`, not role, so re-login
succeeds. **Fix:** set `is_active=false` in the same statement, or delete both scripts and
standardise on `DELETE /api/permissions/users/:userId`, which is already correct.
**Acceptance:** run each script against a synthetic user, then assert login is refused.

## 6b — H-4 · `optionalAuth` revocation decision

`src/middleware/auth.ts:105-126` never compares the claim to the DB, unlike `requireAuth`. Mounted
only on `/api/outreach/leads`. **Owner decision:** either re-check DB `token_version` (consistent,
costs one cached lookup) or document the exemption and its up-to-7-day window explicitly.
**Acceptance:** revoke a session, then assert the chosen behaviour on that route. Note this path
currently has 0 % coverage, so add tests either way.

## 6c — M-9 · Coverage blind spot

Five test-imported files never appear in v8 coverage output. Until resolved, the 30 % CI floor
cannot see them. **Acceptance:** all five appear in the report with real numbers; consider a
per-file floor for guardrail middleware.

## 6d — M-11 · Retire `list_variables` from all guidance

It returns all 163 production variables in plaintext, including `JWT_SECRET` — which is what
weakens H-1's precondition. Replace every documented use with `railway ssh` + `printenv` scoped to
specific non-secret flags.

## 7 — M-7 · Dependency upgrades

Prioritise `nodemailer` and `form-data` (CRLF injection) **before** email is ever enabled, then
`axios` (ReDoS) and `multer` (DoS). Re-run `npm audit`, `npm run build`, `npm test` after each.

---

## 8 — M-6 · Gate startup external calls

Put the PageSpeed/site-health and programmatic-SEO startup tasks behind their own flag, or include
them under `DISABLE_BACKGROUND_JOBS`.
**Acceptance:** booting with the flag set produces zero outbound third-party requests.

---

## 9 — M-4 · Document journal drift, add a CI drift check

Record the as-applied state for slots `0008`, `0009`, `0013`, `0014` and journal ids 5 and 10.
**Do not rewrite migration history.** Add a CI check that compares local hashes to the production
journal and reports drift without failing the build.

---

## 10 — L-1 / L-2 · Accept or tune

L-1: decide whether a 30 s revocation window is acceptable for admin roles. L-2: `/placements`
viewer 403 — leave as documented unless the Command Deck needs it after M-1 lands.

---

## Still outstanding — not defects, but not verified

These must be closed before any `FULL SYSTEM READY` claim:

1. **Production authenticated read-only checks** for both operators (dashboards, Company Policy,
   Decision Workbench, queues, non-pilot denial, cross-tenant denial, machine-viewer GET). Requires
   their own logged-in sessions; no plaintext password may be requested.
2. **TheirStack cron verification** after a scheduled run (`'35 1 * * 1,4'`).
3. **ATS job verification.**
4. **Vitest coverage + CI gap analysis** (Lane 1 did not report).
5. **Full production user inventory / access audit** (Lane 4 did not report) — see
   [`WIZMATCH_USER_ACCESS_AUDIT_2026-07-30.md`](WIZMATCH_USER_ACCESS_AUDIT_2026-07-30.md).
6. **Whether a write-based production smoke test is still necessary** — see below.

### Is a write-based production smoke test still required?

**Recommendation: not yet, and not before items 1–3 above.** Every write-path behaviour reachable
without production data has now been proven locally against the same commit — roster admission,
tenant isolation, session revocation, unknown-scope handling and all six dangerous-capability gates
(31/31, with non-vacuous controls). A production write would add little evidence and would consume
the recovery-point argument in M-5. If the owner still wants one after M-5 lands, it should be a
single synthetic company created and deleted by a named operator, in one session, with the record
id logged.
