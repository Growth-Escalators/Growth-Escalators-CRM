# CURRENT_TASK.md

## Active task

**Wizmatch Contact Intelligence manual review workflow** — complete pending items 1-11 from the
Contact Intelligence build list and add plans for the next two modules: Client Discovery and
Candidate Intelligence.

Scope is **local implementation only**. This task may touch Contact Intelligence services/routes,
admin UI, tests, docs, schema/migration files already approved for the persistence slice, and AI
context. It must not add paid enrichment integrations, outreach sending, worker/cron automation,
deployment config, `package.json`, or `package-lock.json`.

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

## Next task

After this slice is verified, the next major build is Client Discovery / Company Signals. It should
reuse existing tables first, stay deterministic/low-cost, and feed only qualified companies into
Contact Intelligence.
