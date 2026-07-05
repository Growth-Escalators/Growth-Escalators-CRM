# CURRENT_TASK.md

## Active task

**Wizmatch Intelligence Command Center local build** — create a broad, read-only Phase 1
operating layer for Wizmatch that combines Contact Intelligence, Client Discovery scoring,
Candidate Intelligence scoring, requirement priority, module health, and a unified manual-review
command queue.

Scope is **local implementation only**. This task may touch backend services/routes, admin UI,
and tests, but must not change database schema, migrations, paid enrichment integrations,
outreach sending, worker/cron automation, deployment config, `package.json`, or `package-lock.json`.

## Definition of done

- [x] Reuse the Phase 1 Contact Intelligence deterministic service and caps.
- [x] Add deterministic Command Center scoring for client opportunities, candidates, requirements,
  module health, and review actions.
- [x] Add a read-only `/api/wizmatch/command-center` endpoint using existing Wizmatch tables only.
- [x] Add a CRM admin Command Center page and demo route.
- [x] Add focused unit tests for Command Center scoring.
- [x] Run focused tests, full `npm test`, backend `npm run build`, and admin `npm run build`.
- [x] Start admin localhost demo for review.

## Next task

Review the local Command Center at `/wizmatch/command-center-demo`. If accepted, decide whether
to commit/push this local implementation branch, then plan the first schema-backed persistence
slice separately before any migration or paid enrichment work.
