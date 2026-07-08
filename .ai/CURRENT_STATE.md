# CURRENT_STATE.md — last-known-good snapshot

_Update this when the working state of the repo meaningfully changes. Keep it short and true._

## What works (baseline)

- CRM + API live on Railway. Repo-local docs describe a single Express + Socket.io + node-cron
  process (`DISABLE_BACKGROUND_JOBS=true` for API-only mode); production may run this split
  across separate `web` + `worker` Railway services if configured that way in the Railway UI —
  **verify actual topology before changing deployment/worker assumptions**, don't assume two services.
- `docs/PRODUCT_SYSTEM_BRIEF.md` is the canonical shareable product/system brief. Update it on
  meaningful runs when product scope, modules, routes, production data reality, deployment
  assumptions, or guardrails change.
- D2C landing on Vercel (`ecom.growthescalators.com`).
- `npm run build` and `npm test` pass on `main`.
- Facebook Lead Forms now have a safe ingestion path:
  `GET/POST /webhooks/meta-leads`, Meta signature verification using the raw request body,
  connected-page token lookup via `social_accounts`, CRM contact create/reuse via
  `findOrCreateContact`, `facebook_lead` / `meta_lead_form` tagging, `lastActivityAt` bumping,
  and Slack notifications to the existing BD/Sales channel. The Social Accounts page exposes
  webhook/config status and a protected page-subscribe action for `leadgen` webhooks.
- Growth Escalators and Wizmatch are now tenant-separated CRM profiles. Growth keeps the classic
  shared CRM routes, while Wizmatch has `/wizmatch/*` equivalents for Dashboard, Contacts,
  Pipeline, Tasks, Inbox, Billing, Finance, Email Templates, WhatsApp Templates, Lead Discovery,
  Outreach, AI Intelligence, Permissions, Audit, and Pipeline Settings. The same shared modules
  use the logged-in tenant token, so Growth data and Wizmatch data stay separated.
- CRM portal hardening now supports both classic string pipeline stages and Wizmatch object stages
  like `{ id, name, color }`. Shared admin pages coerce display/search values before calling string
  helpers, and the route error boundary resets on navigation instead of trapping the full SPA.
- Current branch pipeline follow-ups harden that stage model further: normalized stages now persist
  as `{ id, name, color, outcome }`, Pipeline Manager edits full stage objects without flattening
  Wizmatch metadata, deal closing and pipeline analytics consume normalized `outcome`, Wizmatch
  optional-schema fallbacks are allowlisted to known optional tables, and tenant resolution is
  path-first to avoid stale cross-tab localStorage redirects.
- Wizmatch operational-readiness prep now documents the migration-journal gap for skipped
  `0020`/`0021` Wizmatch SQL files, provides a read-only `npm run wizmatch:env-check` command,
  and keeps Dice/Naukri-style GitHub Actions scrapers manual-dispatch only until schedule approval.
- Local `main` integration on 2026-07-08 merged both pipeline-stage hardening and Wizmatch
  operational-readiness prep, then passed `npm run build`, `npm test` (27 files, 236 tests),
  `npm run admin:build`, and `git diff --check` before the live push.

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
  `/wizmatch` now lands on the Wizmatch Dashboard. The visible Wizmatch sidebar includes shared
  CRM modules plus the primary staffing operating/V2 pages: Review Workbench, Data Readiness,
  Client Discovery, Contact Intelligence, Candidate Intelligence, Requirement Priority,
  Guardrails, and Analytics. Duplicated old frontend routes still redirect to their new pages.
  Frontend route smoke on 2026-07-07 covered 26 mocked authenticated routes/redirects:
  all Wizmatch shared/staffing routes rendered, Wizmatch users redirected from `/contacts` to
  `/wizmatch/contacts`, `/` resolved to `/wizmatch/dashboard`, and Growth-only users visiting
  `/wizmatch/contacts` redirected to `/dashboard`. `/wizmatch/emails` and `/wizmatch/discover`
  now render inside the Wizmatch app shell. Shared internal links in global search, contact drawer,
  pipeline settings, and lead-discovery import success now resolve through product-aware paths.
  The operating frontend has module/priority
  filters, readiness strips, richer CRM-style action cards, guardrail/cost panels, preview links,
  Contact Intelligence discovery preview/run controls, budget/provider-env visibility, and
  requirement review-plan feedback. Candidate Intelligence V2 now includes the manual Candidate
  Profile Intake panel and authenticated `POST /api/wizmatch/candidate-intelligence/intake`
  endpoint for preview-first CSV/profile imports. Intake creates/reuses CRM contacts and Wizmatch
  candidate records only after explicit confirmation; it scores profiles deterministically and does
  not send outreach, submit candidates, call providers, or update placements.
  Paid discovery defaults off unless env-enabled and manually run after preview. Still no outreach
  sending, candidate auto-submission, worker/cron automation, package, or deployment changes.
  The new `/api/wizmatch/dashboard` endpoint powers the Wizmatch Dashboard with live tenant-scoped
  requirements, candidates, signals, contacts, placements, inbox, tasks, review, readiness, and
  guardrail summaries. `/api/wizmatch/intelligence` and
  `POST /api/wizmatch/intelligence/generate` provide manual Claude-powered staffing analysis
  over Wizmatch data only; they do not analyze Growth marketing/SEO/ads data and do not trigger
  outreach or submissions.
  Verification on 2026-07-08 IST found production Railway currently has only partial Wizmatch
  data: 192 GitHub-sourced contacts/candidates, 192 email channels, 1 bootstrap pipeline, and 3
  bootstrap domain-health rows. Production Wizmatch has 0 deals, messages/inbox rows, tasks,
  email templates, WhatsApp templates, billing clients, invoices, payments, companies, job
  signals, placements, suppression rows, and is missing the newer `wizmatch_requirements`,
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs`
  tables. That means existing production Wizmatch data is not pure dummy data, but it is not yet
  client-ready operating data.
  Portal hardening on 2026-07-08 IST also made Wizmatch dashboard/workbench/readiness/cost
  surfaces degrade to zeroed `needs_migration_check` readiness/cost data when optional/newer
  Wizmatch tables are absent, instead of surfacing a generic internal-server-error fallback.

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
- Production is also missing `src/db/migrations/0020_curvy_silverclaw.sql`
  (`wizmatch_requirements`) and `src/db/migrations/0021_contact_intelligence_phase2.sql`
  (`wizmatch_company_intelligence`, `wizmatch_contact_candidates`, `wizmatch_discovery_runs`).
  Local diagnosis on 2026-07-08 found the likely root cause: those SQL files exist on `origin/main`,
  but `src/db/migrations/meta/_journal.json` skips `0020_wizmatch_gin_indexes`,
  `0020_curvy_silverclaw`, and `0021_contact_intelligence_phase2`, then jumps to
  `0022_tenant_scoped_user_emails`. Drizzle's journal-based migrator should not be assumed to apply
  skipped SQL files automatically. Do not apply migrations without explicit approval. Until these
  tables exist in the target environment, live requirement intake, Contact Intelligence
  persistence, discovery-run audit/cost tracking, and richer Data Readiness/AI Intelligence cannot
  use real persisted operating data. The UI/API now explain this as readiness/cost fallback state
  where possible, but the underlying missing production data remains unresolved.
- GitHub Actions scraper workflows are intentionally manual-dispatch only in the readiness branch.
  They require `RAILWAY_INTERNAL_API_URL` and `INTERNAL_API_TOKEN` GitHub secrets and call the
  existing protected `POST /api/wizmatch/signals/ingest` endpoint. Do not enable schedules without
  explicit approval.
- To get real Wizmatch data flowing from the next business day without adding new automation:
  first get explicit approval for applying required migrations/deploying the branch, then load
  5-10 real requirements and 20-30 vetted candidate profiles manually, dispatch existing
  scraper/import flows only after secrets are confirmed, review Client Discovery and Contact
  Intelligence queues manually, and keep outreach/candidate submissions manual-only.
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
- Pipeline Stage Hardening Follow-ups were verified locally with `npm run build`, `npm test`,
  `npm run admin:build`, and `git diff --check`. Manual smoke against a real local/staging
  database and authenticated Growth/Wizmatch users is still pending.
- Combined live-push verification on 2026-07-08 passed locally before deployment: `npm run build`,
  `npm test` (27 files, 236 tests), `npm run admin:build`, and `git diff --check`.

## How to rebuild context fast

`git branch --show-current` + `git status --short` → `git fetch origin` (pull `main` only if
intentionally on it with a clean tree) → read `.ai/CURRENT_TASK.md` → `npm run ai:brief` → read `AGENTS.md`.
