# CURRENT_TASK.md

## Active task

**Wizmatch data readiness + real-data UX** — turn the current demo/operating layer into a
real-data-ready internal workbench by adding a read-only readiness API/page, surfacing live-data
health inside the Review Workbench and Guardrail Center, and keeping guarded paid/automation
items blocked.

Scope is **Wizmatch backend services/routes, admin UI, tests, generated admin bundle, and AI
context**. This task must not add paid enrichment integrations, automatic outreach sending,
automatic candidate submissions, worker/cron automation, deployment config changes,
`package.json`, or `package-lock.json`.

## Definition of done

- [x] Add read-only `GET /api/wizmatch/readiness`.
- [x] Add deterministic readiness evaluation for database connectivity, required table presence,
  tenant-scoped row counts, latest activity, module status, empty-state reasons, operator notes,
  and guarded items.
- [x] Add `/wizmatch/readiness` and `/wizmatch/readiness-demo`.
- [x] Add Wizmatch sidebar entry for Data Readiness.
- [x] Surface readiness status inside Review Workbench and Guardrail Center.
- [x] Keep demo routes no-login and explicitly labeled as demo data.
- [x] Keep live routes protected by CRM auth.
- [x] Keep old/classic Wizmatch pages available.
- [x] Add focused readiness tests for healthy data, missing tables, and schema-present/no-data
  states.
- [x] Add route registration coverage for `/api/wizmatch/readiness`.
- [x] Run backend build, full Vitest suite, and admin build.

## Next task

After this slice is reviewed, the next major build should validate the authenticated live pages
against real CRM/Wizmatch records, then decide whether to apply the Contact Intelligence migration
in the intended environment. Paid enrichment, auto-send, auto-submit, and worker automation remain
blocked until separate approval.
