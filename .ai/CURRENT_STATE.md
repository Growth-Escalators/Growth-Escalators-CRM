# CURRENT_STATE.md — last-known-good snapshot

_Update this when the working state of the repo meaningfully changes. Keep it short and true._

## What works (baseline)

- CRM + API live on Railway. Repo-local docs describe a single Express + Socket.io + node-cron
  process (`DISABLE_BACKGROUND_JOBS=true` for API-only mode); production may run this split
  across separate `web` + `worker` Railway services if configured that way in the Railway UI —
  **verify actual topology before changing deployment/worker assumptions**, don't assume two services.
- D2C landing on Vercel (`ecom.growthescalators.com`).
- `npm run build` and `npm test` pass on `main`.

## In progress

- **Wizmatch intelligence operating layer**: local implementation now includes Contact
  Intelligence manual review/persistence, Client Discovery deterministic scoring + handoff, and
  Candidate Intelligence deterministic readiness/matching. Admin demo routes exist for Command
  Center, Contact Intelligence, Client Discovery, and Candidate Intelligence. Still no paid
  enrichment, outreach sending, candidate auto-submission, worker/cron automation, package, or
  deployment changes.

## Recently landed (context)

- Wizmatch Requirement Sheets + India-relevance foundation (region-aware scoring/matching,
  branded requirement PDFs, candidate ingest endpoint, Naukri job-signal scraper rewrite).
- Wizmatch placements wired into the CRM deals/pipeline layer.

## Known issues / watch-outs

- `contacts` shares column names (`tenant_id`, `status`, `source`, `score`) with several
  Wizmatch tables → JOIN queries must alias filter columns or Postgres throws 42702.
- If the worker runs as a separate Railway service, it serves only a health probe, not the API →
  worker crons must call `WIZMATCH_API_BASE_URL` (public `web` URL), not `localhost`.
- Local demo routes `/wizmatch/command-center-demo`, `/wizmatch/contact-intelligence-demo`,
  `/wizmatch/client-discovery-demo`, and `/wizmatch/candidate-intelligence-demo` work without
  DB/login. Authenticated routes need a healthy local API/database and CRM auth token.
- Contact Intelligence persistence/API/UI are local-only until reviewed and migrated in the
  intended environment. Paid discovery remains blocked by service caps.
- Applying `src/db/migrations/0021_contact_intelligence_phase2.sql` to any real database is still
  a separate environment decision; this session did not touch production DB state.
- Candidate Intelligence review is planning-only in this slice: it returns review guidance but
  does not persist candidate review state or create submissions.

## How to rebuild context fast

`git branch --show-current` + `git status --short` → `git fetch origin` (pull `main` only if
intentionally on it with a clean tree) → read `.ai/CURRENT_TASK.md` → `npm run ai:brief` → read `AGENTS.md`.
