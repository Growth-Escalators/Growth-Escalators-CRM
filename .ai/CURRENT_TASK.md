# CURRENT_TASK.md

## Active task

**Wizmatch V2 admin presentation pages** — add CRM-styled V2 pages for the local Wizmatch
intelligence modules without removing the existing classic pages.

Scope is **admin UI + AI context only**. This task may touch admin React routing/pages/nav and
AI context. It must not add paid enrichment integrations, candidate submissions, outreach sending,
worker/cron automation, backend routes/services, database schema, migrations, deployment config,
`package.json`, or `package-lock.json`.

## Definition of done

- [x] Add review-action state transition contract for company/contact/discovery decisions.
- [x] Record schema plan in an ADR before writable API/UI work.
- [x] Add the three approved MVP persistence tables to `src/db/schema.ts`.
- [x] Add a matching SQL migration for those three tables only.
- [x] Add focused tests for safe review actions and paid-discovery blocking.
- [x] Run focused Contact Intelligence tests.
- [x] Run backend `npm run build`.
- [x] Run full `npm test`.
- [x] Regenerate `.ai/AI_BRIEF.md`.
- [x] Add persisted snapshot route for deterministic Contact Intelligence results.
- [x] Add writable manual review API routes for company and contact candidate decisions.
- [x] Add manual contact candidate import route.
- [x] Add explicit CRM contact linking route after candidate approval.
- [x] Wire admin UI actions for snapshot, approve/reject/watchlist, manual contact add, contact
  approve/reject, and CRM linking.
- [x] Add API route registration test.
- [x] Create `docs/prd/002-client-discovery-plan.md`.
- [x] Create `docs/prd/003-candidate-intelligence-plan.md`.
- [x] Add deterministic Client Discovery scoring service with exact Phase 1 weights.
- [x] Add Client Discovery queue/detail/qualify/handoff API routes.
- [x] Add Client Discovery admin page and demo route.
- [x] Add deterministic Candidate Intelligence scoring service with exact Phase 1 weights.
- [x] Add Candidate Intelligence queue/detail/requirement-match/review-plan API routes.
- [x] Add Candidate Intelligence admin page and demo route.
- [x] Add focused service and route registration tests.
- [x] Run focused tests, backend build, admin build, and full backend test suite.
- [x] Add deterministic Analytics / ROI service.
- [x] Add read-only `/api/wizmatch/analytics/roi` endpoint.
- [x] Upgrade Wizmatch Analytics admin page with ROI KPIs, funnel, module scorecards,
  recommendations, risks, and guardrails.
- [x] Add no-login `/wizmatch/analytics-demo` route.
- [x] Add ROI service tests and route registration coverage.
- [x] Add CRM-styled V2 pages for Command Center, Client Discovery, Contact Intelligence,
  Candidate Intelligence, and Analytics / ROI.
- [x] Add separate authenticated `-new` routes and no-login `-new-demo` routes without removing
  classic pages.
- [x] Add Wizmatch sidebar entries for the V2 pages.
- [x] Verify V2 demo routes render without browser runtime errors.

## Next task

After this slice is verified, the next major build should be a unified review/action workbench that
turns these V2 operating views into safe manual actions: approve contacts, shortlist candidates,
prioritize requirements, and resolve safety blockers without auto-sending.
