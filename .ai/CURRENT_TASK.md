# CURRENT_TASK.md

## Active task

**Wizmatch daily operations + candidate intake** — finish the next safe operating slice after the
paid discovery/cost-guard release by adding manual candidate-profile intake and an operator SOP.

Scope is **Candidate Intelligence intake backend/UI, parser tests, route registration, operator
documentation, generated admin bundle, and AI context**. This task must not add new database
tables, migrations, automatic outreach sending, automatic candidate submissions, worker/cron
automation, paid provider calls, deployment config changes, `package.json`, or `package-lock.json`.

## Definition of done

- [x] Add `src/services/wizmatchCandidateIntake.ts` for CSV/manual profile parsing, normalization,
  validation, limits, warnings, and dry-run preparation.
- [x] Add `POST /api/wizmatch/candidate-intelligence/intake`.
- [x] Default the intake route to preview-only unless `dryRun=false` and `confirmImport=true`.
- [x] Reuse `findOrCreateContact` so email/phone normalization and CRM contact dedupe stay intact.
- [x] Skip duplicate candidate profiles when a Wizmatch candidate already exists for the CRM contact.
- [x] Score preview/imported candidates through deterministic Candidate Intelligence.
- [x] Keep intake manual and authenticated; no outreach, submission, placement update, provider call,
  paid enrichment, worker, or cron action occurs.
- [x] Add Candidate Profile Intake UI to Candidate Intelligence with sample CSV, preview scores, and
  import result feedback.
- [x] Fix the Candidate Intelligence Shortlist button to call the supported `shortlist` action.
- [x] Add `docs/wizmatch-daily-operations.md` for day-to-day operator usage.
- [x] Add focused parser tests and route registration coverage.
- [x] Run backend build, full Vitest suite, admin build, and refresh AI brief.

## Next task

After this slice is verified, use `/wizmatch/readiness` and `docs/wizmatch-daily-operations.md`
to onboard the team into daily operation. Paid discovery still requires provider env setup and a
small controlled Tier A pilot. Automatic outreach, automatic candidate submissions, and worker/cron
automation remain out of scope.
