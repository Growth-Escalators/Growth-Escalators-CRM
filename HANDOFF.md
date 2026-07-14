# Wizmatch Complete Build — Handoff

Read this first if you're picking this up cold. For full detail, read (in
this order): `docs/build/WIZMATCH_COMPLETE_BUILD_LOG.md` →
`docs/release/WIZMATCH_RELEASE_READINESS.md` →
`docs/testing/WIZMATCH_COMPLETE_TEST_MATRIX.md`.

## Where things stand

Branch `feat/wizmatch-complete-build` (12 commits on top of
`test/wizmatch-e2e-hardening`), not pushed, not merged. Backend build/tests
and admin build are green; the full local Playwright suite
(`playwright.wizmatch-local.config.ts`) is green (67 passed, 15 skipped for
missing env var, 0 failed).

Status is **"Complete with documented limitations — not release-ready as-is."**
See the release-readiness doc for the exact reasoning; short version: no
accessibility scan ran, 3 of 4 new pages have no dedicated Playwright spec
(code-reviewed only), and the 26-step scripted acceptance journey wasn't run
as a single pass.

## What's actually new in this build

- **Today** (`admin/src/pages/WizmatchTodayPage.jsx`) — the login
  destination, bucketed work queue.
- **Companies** (`WizmatchCompaniesPage.jsx`) — list, 360 drawer, hiring
  contact linking, discovery trigger ("Discover contacts"), permanent delete.
- **Hiring Contacts** (`WizmatchHiringContactsPage.jsx`) — linked contacts
  tab + discovery-queue review tab.
- **Candidates** — extended with a 360 drawer + explainable matching
  (`MatchExplanation.jsx`).
- **Submissions & Delivery** — every native `prompt()`/`alert()` replaced
  with accessible dialogs (`DialogShell.jsx` + 6 dialog components).
- **Placements** — extended with a tabbed detail modal.
- **Reports** — rebuilt around the full Job Lead → Collection funnel.

## What to do next, in order

1. Install `@axe-core/playwright` and run an accessibility scan against
   Companies, Hiring Contacts, Candidates 360, the delivery dialogs, and
   Placements detail — all new modal-heavy surfaces.
2. Add Playwright coverage for Candidates 360, Placements detail, and the
   Reports funnel — currently code-reviewed but not test-proven.
3. Run the Companies "Discover contacts" trigger against the real backend
   once (it's currently only proven against a mocked backend).
4. Decide whether to reconcile the two coexisting backend data models
   ("Staffing OS" in `wizmatchStaffing.ts`/`wizmatchStaffingDomain.ts` vs.
   the older "intelligence" model in `wizmatch.ts`) — this is pre-existing
   architectural debt this build didn't attempt to fix, documented in
   `docs/build/WIZMATCH_ARCHITECTURE.md`.
5. Only after 1–2 above: consider this release-ready and plan the merge.

## How to run everything locally

```bash
# Backend (isolated test DB, already migrated + seeded)
DATABASE_URL=postgresql://<user>@localhost:5432/wizmatch_e2e_test npm run dev

# Admin dev server
npm --prefix admin run dev

# Full E2E suite (spins up its own isolated admin server on :5184)
npx playwright test --config=playwright.wizmatch-local.config.ts

# Backend unit/integration tests + build
npm test && npm run build

# Admin build
npm --prefix admin run build
```

Test user credentials come from `src/scripts/seedE2ETestFixtures.ts` —
it refuses to run against anything but a database whose `DATABASE_URL`
contains `wizmatch_e2e_test`.

## Don't repeat these mistakes

- Two button-label collisions were found and fixed during this build (a
  panel toggle and its own confirm button sharing the same accessible name).
  When adding a new trigger-opens-dialog pattern, give the trigger and the
  dialog's primary action visibly different labels, or scope Playwright
  locators to `page.getByRole('alertdialog')` first.
- `WizmatchTodayPage`'s data-fetch `.catch()` blocks look like harmless
  resilience but can silently turn a real outage into a false "nothing to
  do" empty state — any new page that swallows fetch errors for UX
  resilience needs an explicit disclosed-failure path, not just a fallback
  value.
- Company/contact sub-resource routes in this codebase are inconsistently
  prefixed (`/api/wizmatch/staffing/companies/:id` for the company itself,
  but `/api/wizmatch/companies/:id/contacts` — no `/staffing/` — for its
  contacts). Verify the real route in `src/routes/wizmatchStaffing.ts`
  before assuming a consistent prefix.
