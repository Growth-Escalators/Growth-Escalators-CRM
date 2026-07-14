# Wizmatch E2E Testing & Hardening Report

**Date:** 2026-07-14
**Branch:** `test/wizmatch-e2e-hardening` (child of `feat/wizmatch-entity-first-nav`)
**Base commit:** `dad46e4` (Phase 1A entity-first navigation registry)
**Status:** Not pushed. `main` and `rescue/wizmatch-codex-handoff` untouched at `1cb48c9`.

## Commits on this branch

| Hash | Subject |
|---|---|
| `b80304f` | fix(wizmatch): enforce five-contact discovery limit server-side |
| `628b373` | feat(wizmatch): add safe entity delete and archive controls |
| `8a5ed32` | fix(wizmatch): allow local Playwright/dev-server origins in dev CORS |
| `d0d6ab7` | test(wizmatch): add deterministic Playwright E2E hardening coverage |

## Files changed (15 files, +1090/-26)

```
admin/src/components/ConfirmDialog.jsx             (new)
admin/src/pages/WizmatchRequirementsPage.jsx
e2e/wizmatch-e2e-hardening-contact-cap.spec.ts      (new)
e2e/wizmatch-e2e-hardening-delete-archive.spec.ts   (new)
e2e/wizmatch-e2e-hardening-navigation.spec.ts       (new)
e2e/wizmatch-phase0-local.spec.ts
playwright.wizmatch-local.config.ts
src/__tests__/wizmatchContactDiscovery.test.ts
src/index.ts
src/routes/wizmatch.ts
src/routes/wizmatchStaffing.ts
src/scripts/seedE2ETestFixtures.ts                  (new)
src/services/wizmatchContactDiscovery.ts
src/services/wizmatchSourcing.ts
src/services/wizmatchStaffingDomain.ts
```

---

## Environment used

Everything ran against a **fully isolated local environment**, never a shared dev/staging/production database:

- **Database:** a new local Postgres database created for this run only — `wizmatch_e2e_test` (owner `jatinagrawal`, local Homebrew Postgres @ `localhost:5432`). Migrated fresh via `npm run db:migrate` (82 tables, 32 `wizmatch_*`). The repo's existing shared local dev DB (`growth_escalators_dev`) was deliberately **not** used or modified — it wasn't migrated to the current schema and mutating it as a side effect of this task felt like the wrong call.
- **Backend:** `npm run dev` with `DATABASE_URL` pointed at the above, `WIZMATCH_TENANT_ID` set, `DISABLE_BACKGROUND_JOBS=true`, and a locally-generated `JWT_SECRET` (not a real secret, not committed anywhere — the shared `.env` was never read or modified).
- **Admin frontend:** `npm run admin:dev` (manual verification) and Playwright's own isolated instance on `127.0.0.1:5184` (test runs, via `playwright.wizmatch-local.config.ts`'s `webServer`).
- **Test fixtures:** one Wizmatch tenant + one admin-role test user (`e2e.wizmatch.test@example.invalid`, randomly generated password), seeded via `src/scripts/seedE2ETestFixtures.ts`, which **refuses to run unless `DATABASE_URL` contains `wizmatch_e2e_test`** — a hard guard against accidentally seeding a real database.

### Exact local URLs
- Backend API: `http://localhost:3000`
- Admin (manual dev): `http://localhost:5174`
- Admin (Playwright-managed): `http://127.0.0.1:5184` (started/stopped automatically by the test run)

### Test data prefix
`E2E_WIZMATCH_<Date.now()>` for anything created directly (companies, requirements, signals, contacts). All disposable data created during this session was deleted at the end via the new DELETE endpoints (see Cleanup section) — verified zero `E2E_WIZMATCH_%`-prefixed rows remain in `wizmatch_companies`, `wizmatch_requirements`, `wizmatch_job_signals`, `contacts` at close.

### Exact command to rerun the full suite
```bash
# 1. One-time: create + migrate the isolated DB (skip if it already exists)
createdb -h localhost -U "$(whoami)" wizmatch_e2e_test
DATABASE_URL="postgresql://$(whoami)@localhost:5432/wizmatch_e2e_test" npm run db:migrate
DATABASE_URL="postgresql://$(whoami)@localhost:5432/wizmatch_e2e_test" npx tsx src/scripts/seedE2ETestFixtures.ts
# ^ note the printed TENANT_ID and TEST_PASSWORD

# 2. Start the backend against that DB
DATABASE_URL="postgresql://$(whoami)@localhost:5432/wizmatch_e2e_test" \
WIZMATCH_TENANT_ID="<tenant id from step 1>" \
DISABLE_BACKGROUND_JOBS=true \
JWT_SECRET="any-local-only-string" \
npm run dev

# 3. Run the full Playwright suite (desktop + tablet + mobile)
WIZMATCH_E2E_TEST_PASSWORD="<password from step 1>" \
npx playwright test --config=playwright.wizmatch-local.config.ts

# 4. Full verification
npm test                                    # vitest, 413 tests
npm run build                               # backend tsc
cd admin && npx tsc --noEmit && npm run build  # admin typecheck + build
git diff --check
```

---

## Test matrix — what's covered, what isn't

| # | Category | Status | Notes |
|---|---|---|---|
| 1 | Auth & shell (login/logout/unauthorized/tenant root/session) | **Partial** | Login/session covered indirectly (every real-backend spec logs in for real). Logout, explicit unauthorized-access, and session-refresh not separately spec'd. |
| 2 | Primary navigation (9 items) | **Done** | All 9 canonical paths + hrefs verified. |
| 3 | More menu (4 sections, expand/collapse, keyboard, mobile) | **Done** | Including the mobile hamburger-drawer interaction. |
| 4 | Phase 1A regressions (breadcrumbs, search, redirects, query/tab preservation, deep-link refresh, no loops, no overflow) | **Mostly done** | All 6 legacy redirects, query preservation, breadcrumb fix, deep-link refresh, no-loop, no-overflow all covered. **GlobalSearch opening/navigation not separately tested** — the Phase 1A code fix (missing `open` prop) was verified by build/typecheck only, not by a dedicated Playwright interaction test. |
| 5 | Job Leads & contact discovery cap | **Done for the cap; partial for the workflow** | Cap proven at unit + real-API level (see below). Full qualify/reject/discover-through-UI workflow for Job Leads specifically not spec'd (pre-existing `wizmatch-sourcing-local.spec.ts` covers the signal workflow generally). |
| 6 | Companies & Hiring Contacts | **Backend only** | Delete endpoints implemented and live-verified via direct API calls (create, 409-block, successful delete, dependent-row detachment). No Playwright UI spec for these two entities specifically — the Requirements page was chosen as the one full reference implementation given time constraints. |
| 7 | Roles/Requirements | **Done** | Full flow: create draft → open detail drawer → no native dialogs → delete via accessible dialog with typed-name + reason → verified gone via the real DELETE response and the UI's own list refresh → 409 when non-draft. |
| 8 | Candidates | **Backend only** | DELETE endpoint implemented, live-verified via curl (unlinked candidate deletes; dependency block would trigger on match/submission rows, not separately live-tested since matches/submissions weren't seeded in this run). No Playwright UI spec. |
| 9 | Matching & submissions | **Not covered this pass** | Pre-existing `wizmatch-gate-bc-local.spec.ts` covers some of this. No new coverage added. |
| 10 | Placement & finance safety | **Not covered this pass** | No placement-specific spec added; confirmed by code audit that no delete/cascade path exists for placements (see Protected Entities below). |
| 11 | Error/empty states | **Partial** | Covered extensively by the **pre-existing** `wizmatch-phase0-local.spec.ts` (demo-fallback removal, Error+Retry, honest empty states — these were Phase 1A/earlier work, re-verified passing here). No *new* error-state specs added for the delete/archive or cap features specifically beyond the 409 case. |
| 12 | Accessibility | **Partial** | Dialog focus trap, Escape-to-close, keyboard-operable More menu, and a strict `page.on('dialog')` guard (fails any test that triggers a native alert/confirm/prompt) are all real and tested. **`@axe-core/playwright` is not installed** in this repo — no automated axe sweep was run. Recommend adding it as a follow-up rather than installing it unprompted this late in the session. |

### Explicit scope note
Given the size of this task (contact-cap hardening across 2 backend code paths, a full delete/archive audit+implementation across 9 entity types, and a 12-category × 3-viewport Playwright matrix), I prioritized **backend correctness and safety** (contact cap, delete dependency-checking, audit trail) and **one fully-tested reference UI implementation** (Requirements) over building shallow UI coverage for every entity. Companies, Hiring Contacts, and Candidates have working, live-verified backend delete endpoints but no dedicated Playwright spec — extending the `ConfirmDialog` pattern to those three pages' UIs and adding their specs is the clearest next unit of work.

---

## Every defect found and fixed

1. **Contact-discovery cap had no upper bound.** `getWizmatchContactDiscoveryConfig()` read `WIZMATCH_MAX_CONTACT_CANDIDATES_SHOWN` with only a floor (`>= 0`), no ceiling — a misconfigured env value above 5 would have been honored. Fixed with `clampContactDiscoveryResultCount()` (range 1–5, default 3).
2. **The free/signal-based POC discovery path had *no* cap or dedup at all.** `discoverFreePocsForSignal()` (used by `POST /signals/:id/discover-poc`) built its candidate list from website scraping + public search and persisted every single one, unbounded — a real gap the paid-discovery path didn't have. Fixed by reusing the same `dedupeDiscoveryCandidates()` + cap before the persist loop.
3. **No delete/archive endpoint existed for 5 of 9 audited entities** (Job Leads, Companies, Hiring Contacts, Requirements, Candidates) — only relationship-level (not whole-entity) deletes existed. Implemented with dependency checks.
4. **FK-ordering bug in my own first delete implementation** (caught by live testing, not by code review): I inserted the audit event / deleted child rows in the wrong order relative to nulling out `wizmatch_staffing_events`/`wizmatch_task_links` foreign keys, causing the delete itself to throw a FK-violation 500. Fixed by nulling references *before* the delete, in all four affected endpoints.
5. **`deleteCompany` missed two tables with direct FKs to companies** (`wizmatch_discovery_runs`, `wizmatch_source_runs`) — found live when cleaning up test data (15 disposable companies all 400'd on delete). Fixed by adding both to the pre-delete cleanup.
6. **Dev CORS allowlist was missing the actual ports used locally.** Only `localhost:5173`/`:3000` were allowed in non-production; the admin dev server's real default (`5174`) and the Playwright-isolated port (`127.0.0.1:5184`) were both missing. A real browser DELETE request silently 500'd with "origin ... not allowed" — curl-based manual testing never caught this because curl doesn't enforce CORS. Fixed by adding both to the non-production-only allowlist.
7. **A pre-existing Playwright test's assertion went stale** from my own Phase 1A rename (`/wizmatch/dashboard` → `/wizmatch/today`) — `wizmatch-phase0-local.spec.ts` still expected the old `returnTo` path. Updated to match the intentional new canonical path.
8. **A flaky test-authoring bug in my own new spec**, not a product bug: asserting a fresh `request` fixture GET immediately after `expect(dialog).not.toBeVisible()` raced ahead of confirmed completion. Fixed by using `page.waitForResponse()` on the actual DELETE call and asserting the UI's own list no longer shows the row — both more deterministic and more representative of what a real user sees.

### Operational note (not a code defect, disclosed for completeness)
While restarting backend processes during this session, one `pkill -9 -f "index.ts"` pattern was too broad and killed several unrelated `~/profitleak` background dev processes that were running before this session started. They were not restarted automatically since the correct startup state wasn't known. This was flagged to you in-conversation immediately; to restore: `cd ~/profitleak && pnpm dev`. All process management after that point used precise PIDs, not pattern matching.

---

## Contact-discovery 5-contact cap — implementation and proof

**Layers enforced:**
- **Config layer** (`src/services/wizmatchContactDiscovery.ts`): `clampContactDiscoveryResultCount()` — hard ceiling 5, floor 1, default 3, applied to every read of `WIZMATCH_MAX_CONTACT_CANDIDATES_SHOWN`.
- **Paid-discovery persistence** (`executeWizmatchContactDiscovery`): dedupes, sorts, then `.slice(0, config.maxContactCandidatesShown)` *before* verification and persistence — was already correct at the default value, now also correct under misconfiguration.
- **Free/signal POC persistence** (`discoverFreePocsForSignal`): previously unbounded, now dedupes + caps identically before the insert loop.
- **API layer**: neither route accepts a client-supplied count override — the cap is entirely server-config-driven, so no request body can request more than the server allows.

**Proof:**
- Unit test (`src/__tests__/wizmatchContactDiscovery.test.ts`): mocked provider returns **12** raw candidates, config forced to a misconfigured value (999, itself run through the same clamp) → asserts `result.candidates.length <= 5` and `=== 5`, and that Reacher verification calls never exceed 5.
- Unit tests for the clamp function directly: 0 → 1, -5 → 1, 999 → 5, 6 → 5, every in-range value unchanged, `NaN` → default (3).
- Dedup test: two candidates with the same email in different casing collapse to one before the cap is even applied.
- Real-backend Playwright test (`wizmatch-e2e-hardening-contact-cap.spec.ts`): live `discovery-preview` call against the actual running API confirms `capStatus.maxContactCandidatesShown` is `3` (the real default in this environment) and always within `[1, 5]`.
- **Not exercised in this pass:** a live call that actually returns >5 real/mocked-at-the-network-boundary contacts through the full HTTP stack — this would require either real provider credentials (explicitly out of scope — "do not require live-provider access") or monkey-patching internal provider functions, which isn't feasible from an HTTP-only Playwright test. The unit test above is the rigorous proof for that specific scenario, per the task's own instruction to use mocked/test provider adapters by default.

---

## Delete/archive functionality by entity

| Entity | Before this pass | After this pass |
|---|---|---|
| Job Leads (signals) | Soft-reject only (`POST /signals/:id/reject`), no hard delete | + `DELETE /api/wizmatch/signals/:id` — blocked if promoted into a requirement or status is `placed` |
| Companies | No delete of any kind | + `DELETE /api/wizmatch/staffing/companies/:companyId` — blocked if any signals/requirements/hiring contacts exist |
| Hiring Contacts (`wizmatch_contact_candidates`) | Approve/reject review only, no hard delete | + `DELETE /api/wizmatch/contact-intelligence/contacts/:candidateId` — blocked once linked to a CRM contact |
| Roles/Requirements | `status='closed'` + full stage machine (`draft→qualifying→...→closed_lost/cancelled`) already existed | + `DELETE /api/wizmatch/requirements/:id` — draft-only, blocked by any match/submission. **UI wired** (ConfirmDialog on the Requirements page). |
| Candidates (pool) | `PUT` allows `availability_status` changes (archive-equivalent already existed) | + `DELETE /api/wizmatch/candidates/:id` — blocked by any match/submission |
| Submissions | Already had `POST /staffing/submissions/:id/withdraw` | Unchanged — already correct |
| Interviews | Already had `PUT /staffing/interviews/:id` (status-capable) | Unchanged — already correct |
| Offers | Already had `PUT /staffing/offers/:id/status` | Unchanged — already correct |
| Placements | No delete of any kind (by design) | **Unchanged, intentionally** — see Protected Entities |
| Consents | Already had `POST /staffing/consents/:id/revoke` | Unchanged — already correct |

### Entities intentionally protected from permanent deletion
Per policy, these are never hard-deletable through any code path added or found in this repo, and no new code introduces one: **Submissions, Interviews, Offers, Placements, invoices/collections (`wizmatch_staffing_commercials`/`wizmatch_staffing_adjustments`), and any Requirement once it has a match or submission.** Status transitions (withdraw/close/cancel) are the only supported path for these, all pre-existing and confirmed still functioning (pre-existing Playwright specs covering Gate B/C pass unchanged).

---

## Accessibility results

- No native `alert()`/`confirm()`/`prompt()` anywhere touched by this session's UI work — enforced by a hard `page.on('dialog')` guard across every new spec (would throw immediately on any native dialog).
- `ConfirmDialog`: `role="alertdialog"`, `aria-modal`, labelled inputs, focus moves to the first field on open, Tab/Shift+Tab cycle is trapped within the dialog, Escape closes and cancels (tested).
- More menu: `aria-expanded` state verified, keyboard-operable via Enter (tested).
- **Not run:** automated axe-core scan (`@axe-core/playwright` not installed in this repo). Recommend adding as a follow-up task rather than introducing a new dependency unprompted at the tail of this session.

## Responsive results
All 20 new hardening tests pass at desktop (1440×900), tablet (1024×768), and mobile (390×844) — 40/40 passed across tablet+mobile, 42/42 including the pre-existing suite on desktop. One real mobile-specific finding: the More-menu test needed to open the hamburger drawer first below the `md` breakpoint — this is existing, correct `Sidebar.jsx` behavior, not a defect; the test was adjusted to match it.

---

## Full verification results

| Check | Result |
|---|---|
| `npm test` (vitest) | **413/413 passed**, 48 files |
| `npm run build` (backend tsc) | clean |
| `cd admin && npx tsc --noEmit` | clean |
| `npm run admin:build` | clean |
| Playwright, desktop, full suite (22 pre-existing + 20 new) | **42/42 passed** |
| Playwright, tablet + mobile, new specs | **40/40 passed** |
| `git diff --check` | clean |
| Dependency audit | no new npm packages added this session |
| Secret scan of this branch's diff | clean — only variable/field names (`password`, `TEST_PASSWORD`) and a randomly-generated test credential in a script that refuses to run outside the disposable DB; no real values, no `.env` touched |
| No production endpoint used | confirmed — all requests targeted `localhost:3000` against the isolated `wizmatch_e2e_test` database |
| No existing real data deleted | confirmed — every delete this session targeted an `E2E_WIZMATCH_`-prefixed record created in this run; final audit query shows zero such rows remaining (fully cleaned up) |
| Contact discovery cap never exceeded 5 | confirmed at unit, integration, and real-API layers (see above) |
| No credentials/`.env` committed | confirmed |
| No rescue-branch files entered this branch | confirmed — `main` and `rescue/wizmatch-codex-handoff` both still at `1cb48c9`, untouched |

---

## Remaining blockers / recommended next steps

1. **UI coverage gap**: Companies, Hiring Contacts, and Candidates have working backend deletes but no `ConfirmDialog` wiring or Playwright spec yet — the Requirements page is the template to replicate.
2. **`@axe-core/playwright` not installed** — no automated accessibility sweep. Low-risk, recommended addition.
3. **GlobalSearch open/navigate** has no dedicated interaction test (the Phase 1A prop-fix itself was verified by build only).
4. **Matching/submissions/placements workflow** (categories 9–10 in the original matrix) has no *new* coverage this pass beyond what pre-existing Gate B/C specs already assert.
5. Full **12-category × 3-viewport** matrix as literally specified is not 100% complete — see the per-category table above for exact status.

No unresolved test failures, no quarantined tests, and no screenshots/traces of open failures to attach — everything currently in the suite is green.
