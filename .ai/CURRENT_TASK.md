# CURRENT_TASK.md

## Active task

**Wizmatch Contact Intelligence persistence slice** — complete the first three Phase 2 items:
review action model, schema plan/ADR, and database migration for the approved MVP Contact
Intelligence entities.

Scope is **local implementation only**. This task may touch the Contact Intelligence service
contract, tests, `src/db/schema.ts`, one migration SQL file, and AI/docs context. It must not add
writable API routes, admin action buttons, paid enrichment integrations, outreach sending,
worker/cron automation, deployment config, `package.json`, or `package-lock.json`.

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

## Next task

After this slice is verified, the next major step is writable API routes for manual review
actions. That should still avoid paid enrichment, worker/cron automation, and outreach sending.
