# CURRENT_TASK.md

## Active task

**Wizmatch unified operating workbench** — build the next manual-action layer across the
Wizmatch intelligence modules: review workbench, requirement priority, candidate review
persistence, guardrail center, and local demo flow.

Scope is **Wizmatch backend services/routes, admin UI, tests, generated admin bundle, and AI
context**. This task must not add paid enrichment integrations, automatic outreach sending,
automatic candidate submissions, worker/cron automation, deployment config changes,
`package.json`, or `package-lock.json`.

## Definition of done

- [x] Add deterministic Requirement Priority service with urgency, India-first, candidate
  coverage, contact readiness, requirement quality, and safety scoring.
- [x] Add unified Review Workbench service that combines Client Discovery, Contact
  Intelligence, Candidate Intelligence, Requirement Priority, and Safety items.
- [x] Persist Candidate Intelligence review intent using existing `wizmatch_candidates.india_specific`
  metadata, without schema or migration changes.
- [x] Add `/api/wizmatch/requirement-priority/queue`.
- [x] Add `/api/wizmatch/requirement-priority/:requirementId/review-plan`.
- [x] Add `/api/wizmatch/review-workbench`.
- [x] Add `/api/wizmatch/guardrails`.
- [x] Add focused tests for requirement priority/workbench safety behavior.
- [x] Add route registration coverage for the new endpoints.
- [x] Add CRM-styled admin pages for Review Workbench, Requirement Priority, Guardrail Center,
  and Local Demo Flow.
- [x] Add authenticated and no-login demo routes for the new pages.
- [x] Add Wizmatch sidebar entries for the new pages.
- [x] Verify new demo routes render without browser runtime errors.
- [x] Verify safe action button works in demo mode.

## Next task

After this slice is reviewed, the next major build should make the new workbench the primary
Wizmatch operating homepage and progressively move live reviewer actions from the older classic
pages into the new workbench while preserving the no-paid-enrichment/no-auto-send/no-auto-submit
guardrails.
