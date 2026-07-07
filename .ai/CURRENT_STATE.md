# CURRENT_STATE.md — last-known-good snapshot

_Update this when the working state of the repo meaningfully changes. Keep it short and true._

## What works (baseline)

- CRM + API live on Railway. Repo-local docs describe a single Express + Socket.io + node-cron
  process (`DISABLE_BACKGROUND_JOBS=true` for API-only mode); production may run this split
  across separate `web` + `worker` Railway services if configured that way in the Railway UI —
  **verify actual topology before changing deployment/worker assumptions**, don't assume two services.
- D2C landing on Vercel (`ecom.growthescalators.com`).
- `npm run build` and `npm test` pass on `main`.
- Facebook Lead Forms now have a safe ingestion path:
  `GET/POST /webhooks/meta-leads`, Meta signature verification using the raw request body,
  connected-page token lookup via `social_accounts`, CRM contact create/reuse via
  `findOrCreateContact`, `facebook_lead` / `meta_lead_form` tagging, `lastActivityAt` bumping,
  and Slack notifications to the existing BD/Sales channel. The Social Accounts page exposes
  webhook/config status and a protected page-subscribe action for `leadgen` webhooks.

## In progress

- **Wizmatch intelligence operating layer**: local implementation now includes Contact
  Intelligence manual review/persistence, Client Discovery deterministic scoring + handoff,
  Candidate Intelligence deterministic readiness/matching + persisted review intent, Requirement
  Priority scoring, a unified Review Workbench, Guardrail Center, Local Demo Flow, and deterministic
  Analytics / ROI. It now also includes a read-only Data Readiness API/page that checks required
  table presence, tenant-scoped counts, latest activity, module status, empty-state reasons,
  operator notes, and guarded blocked items. Contact Intelligence now has a preview-first manual
  discovery layer for Apollo/Snov/Reacher and controlled Google fallback, gated by env flags,
  eligibility rules, hard-blocking budget/rate caps, provider-env checks, advisory-lock
  duplicate protection, cooldown, and explicit `confirmPreview=true`. Admin classic pages,
  CRM-styled V2 pages, and the new operating pages exist.
  `/wizmatch` now lands on the Review Workbench, and the visible Wizmatch sidebar is cleaned down
  to the primary operating/V2 pages: Review Workbench, Data Readiness, Client Discovery, Contact
  Intelligence, Candidate Intelligence, Requirement Priority, Guardrails, and Analytics. Duplicated
  old frontend routes now redirect to their new pages. The operating frontend has module/priority
  filters, readiness strips, richer CRM-style action cards, guardrail/cost panels, preview links,
  Contact Intelligence discovery preview/run controls, budget/provider-env visibility, and
  requirement review-plan feedback. Candidate Intelligence V2 now includes the manual Candidate
  Profile Intake panel and authenticated `POST /api/wizmatch/candidate-intelligence/intake`
  endpoint for preview-first CSV/profile imports. Intake creates/reuses CRM contacts and Wizmatch
  candidate records only after explicit confirmation; it scores profiles deterministically and does
  not send outreach, submit candidates, call providers, or update placements.
  Paid discovery defaults off unless env-enabled and manually run after preview. Still no outreach
  sending, candidate auto-submission, worker/cron automation, package, or deployment changes.

## Recently landed (context)

- Wizmatch Requirement Sheets + India-relevance foundation (region-aware scoring/matching,
  branded requirement PDFs, candidate ingest endpoint, Naukri job-signal scraper rewrite).
- Wizmatch placements wired into the CRM deals/pipeline layer.

## Known issues / watch-outs

- `contacts` shares column names (`tenant_id`, `status`, `source`, `score`) with several
  Wizmatch tables → JOIN queries must alias filter columns or Postgres throws 42702.
- If the worker runs as a separate Railway service, it serves only a health probe, not the API →
  worker crons must call `WIZMATCH_API_BASE_URL` (public `web` URL), not `localhost`.
- Duplicated old demo routes now redirect to the relevant new demo pages. Local V2 demo routes
  `/wizmatch/command-center-new-demo`, `/wizmatch/contact-intelligence-new-demo`,
  `/wizmatch/client-discovery-new-demo`, `/wizmatch/candidate-intelligence-new-demo`, and
  `/wizmatch/analytics-new-demo` work without DB/login. New operating demo routes
  `/wizmatch/review-workbench-demo`, `/wizmatch/requirement-priority-new-demo`,
  `/wizmatch/guardrails-new-demo`, `/wizmatch/readiness-demo`, and
  `/wizmatch/local-demo-flow-demo` work without DB/login. Authenticated routes need a healthy
  local API/database and CRM auth token.
- Classic pages with unique operational workflows remain direct-access fallbacks, but are no
  longer in the Wizmatch sidebar: requirements, signals, candidate pool, domains, compliance,
  placements, and primes. Do not delete them until matching V2 workflows exist.
- Contact Intelligence persistence/API/UI are local-only until reviewed and migrated in the
  intended environment. Paid discovery is manual-only, preview-first, and disabled by default via
  `WIZMATCH_PAID_DISCOVERY_ENABLED=false`; Google fallback is disabled by default via
  `WIZMATCH_GOOGLE_FALLBACK_ENABLED=false`. Cost guard defaults are conservative:
  ₹5,000/month, ₹500/day, 20 tenant runs/day, 5 user runs/day, and provider daily caps. Confirmed
  blocked discovery attempts are audited as zero-cost `blocked_by_cap` rows.
- Applying `src/db/migrations/0021_contact_intelligence_phase2.sql` to any real database is still
  a separate environment decision; this session did not touch production DB state.
- Candidate Intelligence review now persists reviewer intent into
  `wizmatch_candidates.india_specific.candidateIntelligenceReview`; it still does not create
  submissions, send outreach, or change placement state.
- Candidate Profile Intake accepts up to 50 manually vetted profiles per request, defaults to
  dry-run preview, skips duplicate candidate records by CRM contact, and writes only confirmed
  imports. Operators should follow `docs/wizmatch-daily-operations.md` for the daily loop.
- Analytics / ROI and daily digest are read-only and deterministic. They degrade gracefully to
  zeroed optional metrics when newer Wizmatch tables/columns are missing in an environment; they
  do not create schema, write snapshots, send outreach, or call providers.
- Requirement Priority and Review Workbench are deterministic/manual-action layers. Requirement
  review-plan endpoints are planning-only; live workbench safe actions call existing approved
  endpoints and preserve manual review gates.
- The latest operating UI polish was verified against `/wizmatch/review-workbench-demo`,
  `/wizmatch/requirement-priority-new-demo`, `/wizmatch/guardrails-new-demo`,
  `/wizmatch/readiness-demo`, `/wizmatch/local-demo-flow-demo`, and `/wizmatch-demo`; module
  filtering, safe action feedback, requirement review-plan feedback, and readiness table/module
  displays work in demo mode.
- Phase 3 preview-first discovery tests cover Tier A eligibility, Tier B manual approval, disabled
  env, cooldown/caps, Apollo/Snov/Google fallback order, Reacher invalid handling, provider
  failures, max-3 candidate cap, dedupe, cost guard budget/provider/user caps, provider-env
  blocks, no-provider-without-token behavior, and route registration.

## How to rebuild context fast

`git branch --show-current` + `git status --short` → `git fetch origin` (pull `main` only if
intentionally on it with a clean tree) → read `.ai/CURRENT_TASK.md` → `npm run ai:brief` → read `AGENTS.md`.
