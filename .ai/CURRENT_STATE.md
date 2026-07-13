# CURRENT_STATE.md — last-known-good snapshot

_Update this when the working state of the repo meaningfully changes. Keep it short and true._

## 2026-07-13 snapshot (current)

- **Deployed baseline for this worktree:** rebased `origin/main` at `b05ac01`; branch
  `codex/wizmatch-phase0-trust`. No branch change has been pushed, deployed, sent, spent, migrated,
  or written to production.
- **Local Phase 0 candidate bundle:**
  - D-1 canonical Contact Intelligence now combines company/contact review, manual add, CRM linking,
    Pipeline handoff, read-only discovery preview, explicit cost acknowledgement, and confirmed
    manual discovery. Authenticated API failure shows an honest empty/error/Retry state, not demo
    companies. No real provider run was executed and Apollo/Snov/env/budgets remain unchanged.
  - D-2 requirement parsing delegates FormData to canonical tenant-aware `apiFetch`; validation and
    request failures render separately and request errors offer Retry.
  - D-9/D-10/D-11 classify linked hiring contacts consistently, search CRM contacts by full name or
    tenant-scoped channel, and keep non-executable blocker outcomes out of the action queue while
    retaining them in the Safety Center.
  - D-12/D-14/D-20/D-21/D-23 correct misleading handoff copy, empty-state guidance, unrelated task
    helper copy, dashboard work order, and raw CRM-link identifiers.
  - Authenticated failure states are honest across the core pages; Pipeline recovers with Retry;
    demo routes are development-only; current admin build is mandatory; login preserves Wizmatch;
    role scoring rejects known false positives and keeps company evidence separate; manual seeds are
    deterministically scored; queue totals and readiness semantics are truthful; AI is bounded.
  - Full local verification passed: TypeScript build, **38 Vitest files / 318 tests**, admin
    production build, **10/10** mocked Chromium paths, production-bundle demo-route absence, and
    `git diff --check`, all without external provider or production calls.
- **Local Phase 1 Gate A bundle:**
  - Six additive tenant-scoped tables model company-contact relationships and roles, requirement
    attribution, assignments, append-only staffing events and shared-task links. Requirements gain
    additive attribution/stage/SLA/activity/next-action fields while legacy status remains.
  - Transactional APIs power Company, Hiring Contact and Requirement 360 plus My Work. Every write
    validates tenant ownership and records the business mutation and staffing event together.
  - Admin pages require company selection, show Person A→SAP versus Person B→Java, manage source/
    team/next action/stage, and expose recruiter work without widening legacy send/spend routes.
  - Generated migration `0025_cynical_brother_voodoo.sql` contains no destructive statement and
    applied cleanly over an `origin/main` schema in a disposable local Postgres database.
  - Verification: **40 Vitest files / 325 tests**, backend/admin builds, **14/14 Playwright** paths,
    authenticated scratch HTTP workflow, relationship uniqueness/history checks and `git diff --check`.
- **Persistent context:** PRD 004 direction and ADR-004 Gate A are approved for local phased
  implementation. Migration apply, production data, push/deploy and Gate B/C schema work remain
  separately gated in the owner-input file.
- **Deep local QA:** the complete source route matrix (57 Wizmatch routes) mounted without an
  ErrorBoundary crash under mocked APIs; all 17 redirects and 29 unauthenticated auth boundaries
  resolved. The visible browser walked all 10 primary demo modules and exercised prospect intake,
  candidate preview/import, workbench actions/filters, requirement planning, discovery preview,
  blocked states, refresh controls, product selection, and password-recovery navigation. Builds,
  304 tests, and 5 authenticated mocked Chromium paths passed again.
- **Remaining gated/external work:** D-17/D-22/D-24/D-25 require storage, schema or commercial
  model work; D-18 needs live Dice/TheirStack evidence. Phase 0 code/release validation is locally
  green. Gate B canonical skills/matching is the next proposed product phase after Gate A rollout.
- **Security:** plaintext credential values were removed from the current versions of the handoff,
  operator docs, playbook, and onboarding script; the script now requires secure environment
  injection and does not print the value. The credential remains exposed in Git history and has not
  been rotated. Rotation and any history rewrite require separate explicit approval.
- **Original dirty workspace:** preserved at `/Users/jatinagrawal/repo-comparison/v2`. This clean
  worktree intentionally excludes its unrelated package/SEO/n8n/seed and guarded-file WIP.
- Git remote now points at the canonical `Growth-Escalators/Growth-Escalators-CRM` (repo was renamed
  from `growth-escalators-backend-v2`; same owner, Railway auto-deploy unaffected). No more "repository moved" push warnings.
- **`npm run db:generate` works normally again** (was emitting destructive migrations from a drifted
  snapshot baseline; fixed in PR #42 by adding `meta/0024_snapshot.json`). Deploy still auto-runs
  `node dist/scripts/migrate.js && node dist/index.js`, so keep migrations additive/idempotent.
- Wizmatch client-acquisition funnel is substantially built out: Review Workbench, Client Discovery,
  Signals, Contact Intelligence, Requirement Priority + Requirements (filters/edit drawer/find-candidates/
  tier-weighted priority), Candidates (filters/pagination/experience), Source Candidates (on-demand),
  Placements, Analytics, AI Intelligence (row-level context), and a consolidated `/wizmatch/system`
  diagnostics page. Contact drawer shows full candidate/client-lead/company detail.
- Dated dataflow reference: `docs/wizmatch/DATAFLOW.md` (corrected through 2026-07-13 for schema
  authority, in-process signal scoring, topology uncertainty, and supply/demand separation).
  Re-verify it before production-sensitive work. Client-funnel test plan:
  `docs/wizmatch/CLIENT_FUNNEL_TEST_PLAN.md`.
- **Not yet done:** real Wizmatch data still needs loading before client-facing use (scrapers return 0;
  use manual intake / Source Candidates). Sending stays gated (`WIZMATCH_SENDING_ENABLED`).

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
- Live deploy on 2026-07-08 IST pushed `main` commit `7951c28` and Railway `web` deployment
  `9a253c24-f400-4c33-ae88-2ddc35000bbd` reached `SUCCESS`. Live checks after deploy:
  `https://api.growthescalators.com/health` responded with database `ok` and status `degraded`
  only because `lastWebhook` was stale from 2026-06-29; `https://crm.growthescalators.com`
  returned HTTP 200.

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
- `fix/wizmatch-cost-safety` resolves the two P0 cost-safety audit items locally: the generic
  `findEmail` cascade defaults Apollo/Snov off unless explicitly opted in, Wizmatch signal
  enrichment passes the free-only option, and domain-health checks now warn on SPF/DMARC failure or
  low reply rate. If all non-paused domains are degraded, the worker posts an actionable
  `WIZMATCH_SYSTEM_CHANNEL` alert once per 24 hours via an append-only `events` marker while
  preserving the mailer's fallback-to-all sending behavior.
- **RESOLVED 2026-07-09**: the missing-migration gap diagnosed on 2026-07-08 was fixed. Root cause
  confirmed: `0020_wizmatch_gin_indexes`, `0020_curvy_silverclaw`, and
  `0021_contact_intelligence_phase2` SQL files existed on `main` but were never listed in
  `src/db/migrations/meta/_journal.json`, so Drizzle's journal-based migrator silently never
  applied them across every prior deploy. Fix: three journal entries appended with `when`
  timestamps greater than the already-applied `0022` entry (Drizzle only compares each entry's
  `when` against the single most-recent applied migration's `created_at`, not per-migration hash
  presence, so timestamps had to sort after `0022` regardless of array position). Verified locally
  (build/test/admin-build/diff-check), pushed as commit `0f313ba` with explicit human approval,
  Railway deploy `e23a4c03` reached `SUCCESS`, and `/wizmatch/readiness` confirmed all 4 tables now
  exist (`ready`/`needs data`, 0 missing, score 40 → 81). `wizmatch_requirements`,
  `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs` are
  now live schema in production, currently empty (0 rows) and ready for real data.
- **2026-07-09**: `WIZMATCH_PHYSICAL_ADDRESS`, `WIZMATCH_LEADS_CHANNEL`, `WIZMATCH_DAILY_CHANNEL`,
  and `WIZMATCH_SYSTEM_CHANNEL` are now set on Railway (all three channel vars point at the
  existing BD/Sales Slack channel to start; can be split into separate channels later with no code
  change). Authenticated smoke check of `/api/wizmatch/readiness`, `/client-discovery/queue`,
  `/candidate-intelligence/queue`, and `/review-workbench` confirmed all 4 return 200 post-deploy.
- **Scraper CI crash fixed, but scrapers still return 0 rows**: `wizmatch-dice.yml` and
  `wizmatch-jobspy.yml` previously crashed with `MODULE_NOT_FOUND` on every manual dispatch because
  `npx playwright install --with-deps chromium` never installed the `playwright` npm package
  itself. Fixed by pinning `npm install --no-save playwright@1.59.1` (matching the version already
  locked via `@playwright/test`) — both workflows now complete successfully. However, both still
  return 0 job signals: Dice.com and Naukri.com's live search-result page markup no longer matches
  the `page.evaluate()` CSS selectors in these workflows. This is a separate, unresolved issue —
  the scrapers are not currently a usable real-data source until someone inspects the live DOM of
  both sites and rewrites the selectors.
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
- Post-deploy Railway env readiness check showed all required Wizmatch env vars present and one
  recommended Wizmatch env var missing: `WIZMATCH_PHYSICAL_ADDRESS`. Optional Slack channels are
  also missing: `WIZMATCH_LEADS_CHANNEL`, `WIZMATCH_DAILY_CHANNEL`, and
  `WIZMATCH_SYSTEM_CHANNEL`. GitHub Actions secrets still need human confirmation:
  `RAILWAY_INTERNAL_API_URL` and `INTERNAL_API_TOKEN`.
- Direct read-only table/count verification could not be completed from local Codex because
  Railway injected only the internal Postgres hostname (`postgres.railway.internal`) and no
  `DATABASE_PUBLIC_URL`; run the `psql` checks in Railway shell next.
- Railway boot logs after deploy showed existing Wizmatch worker crons scheduled in-process
  because `WIZMATCH_TENANT_ID` is set. This was not newly added by the readiness work, but it is
  live operating behavior to keep in mind before loading real data or enabling scraper schedules.
- Railway boot logs still warn about legacy/automation env aliases:
  `SNOVIO_API_KEY`, `SALESHANDY_API_KEY`, `SALESHANDY_SEQUENCE_ID`, and
  `PURELYMAIL_PASS_1..6`. The new readiness checker sees the newer Snov and
  `PURELYMAIL_SMTP_*` variables present, so review whether the warnings are legacy alias noise or
  truly needed for active flows.

## How to rebuild context fast

`git branch --show-current` + `git status --short` → `git fetch origin` (pull `main` only if
intentionally on it with a clean tree) → read `.ai/CURRENT_TASK.md` → `npm run ai:brief` → read `AGENTS.md`.
