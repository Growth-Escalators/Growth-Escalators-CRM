# Wizmatch Architecture — Complete Build Snapshot

Describes actual implemented behavior as of `feat/wizmatch-complete-build`.
See `docs/build/WIZMATCH_ROUTE_AND_WORKSPACE_MAP.md` for the exact route table
and `docs/release/WIZMATCH_RELEASE_READINESS.md` for what's genuinely tested
vs. built-but-unverified.

## Frontend

- React SPA (`admin/`, Vite), shared by the Growth-Escalators CRM and
  Wizmatch tenants — tenant is resolved from hostname/query/localStorage
  (`admin/src/lib/auth.js`), routes under `/wizmatch/*` for the Wizmatch
  product.
- **Route registry** (`admin/src/routes/wizmatchRouteRegistry.ts`, added in
  Phase 1A) is the single source of truth for Wizmatch nav labels, icons,
  groups, permissions, and legacy-path aliases. `navEntries.js`,
  `Breadcrumbs.jsx`, and `App.jsx`'s alias redirects all derive from it.
- **Shared UX primitives** (`admin/src/components/wizmatch/`): `EmptyState`,
  `ErrorRetry`, `StatusBadge`, `Toast`/`ToastProvider` (mounted once in
  `AppLayout`), plus the pre-existing `ConfirmDialog.jsx` (accessible
  confirmation modal used for every delete/archive action across the
  product — no native `alert()`/`confirm()`/`prompt()` in any canonical
  workflow).
- **Today workspace** (`WizmatchTodayPage.jsx`) is the login destination —
  unifies the practical purpose of the old Dashboard/My Work/Review
  Workbench pages into one bucketed action queue (Overdue/Due
  Today/Blocked/Waiting/Recently Changed/Team Review), each item deep-linking
  to its entity.
- **Global Search** (`GlobalSearch.jsx` + `GET /api/search`) covers Contacts,
  Deals, Wizmatch Companies, Requirements, and Submissions (Hiring Contacts
  and Candidates are covered indirectly — both live in the shared `contacts`
  table, already searched).

## Backend

- Express + Drizzle/Postgres. `/api/wizmatch/*` is mounted twice
  (`src/index.ts`): `wizmatchStaffingRouter` (`src/routes/wizmatchStaffing.ts`,
  the newer "Staffing OS" model — companies/contacts/requirements/matching/
  delivery, phase-gated A/B/C, wider role access) first, then
  `wizmatchRouter` (`src/routes/wizmatch.ts`, the older "intelligence"
  model — signals/candidate-pool/requirements-CRUD/placements-Kanban,
  admin/team_lead/viewer only) second.
- **Two coexisting data models** for company/contact and candidate concepts
  (see `docs/testing/WIZMATCH_E2E_HARDENING_REPORT.md`'s earlier audit)
  remain unreconciled in this build — this is a known, documented
  architectural debt, not something this pass attempted to unify at the
  schema level (see release-readiness "Known Limitations").
- **Delete/archive** endpoints (added in the prior hardening pass, this
  build's parent commits) follow one consistent pattern — see
  `WIZMATCH_DELETE_ARCHIVE_POLICY.md`.
- **Contact-discovery cap**: enforced in `src/services/wizmatchContactDiscovery.ts`
  (`clampContactDiscoveryResultCount`, range 1–5, default 3) and reused by
  both the paid-discovery path and the free/signal-based POC path
  (`discoverFreePocsForSignal` in `src/services/wizmatchSourcing.ts`).

## What this build added on top of that foundation

See the commit list in `docs/build/WIZMATCH_COMPLETE_BUILD_LOG.md` and the
product-completion matrix in the release-readiness report for the accurate,
up-to-date answer — this file describes structure, not a completeness claim.
