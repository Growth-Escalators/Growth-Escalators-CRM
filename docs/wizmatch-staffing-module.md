# Wizmatch Staffing Module

US + India IT-staffing outbound module integrated into the Growth Escalators CRM.

## Architecture Overview

Wizmatch runs as a **new tenant** inside the existing CRM, adding a full staffing pipeline:

```
Signal (job posting) → Score ($0 TS) → Enrich (email waterfall) → Match ($0 SQL+TS)
  → Draft (Sonnet on-demand) → Review (admin UI) → manually approved send path
  → Reply (IMAP poll) → Classify (Haiku) → Placement (pipeline)
```

### Cost Guardrails
- **Scoring**: Pure TypeScript ($0) — PRD §5.1 rubric
- **Matching**: SQL `&&` array overlap + TS rules ($0) — PRD §5.2
- **Drafting**: Claude Sonnet on-demand only (when SDR clicks "Generate")
- **Reply classification**: Reuses existing `classifyReplyWithAI` (Haiku)
- **Scraping**: Heavy browser scrapers (Dice/Naukri-style job-signal ingestion) run in **GitHub Actions**, not Railway

## Schema (10 tables in source; production readiness must be checked)

All tables prefixed `wizmatch_*`, UUID PKs, tenant-scoped.

| Table | Purpose |
|---|---|
| `wizmatch_companies` | Target companies (with ATS type, H-1B count, prime status) |
| `wizmatch_job_signals` | Job postings captured from scrapers |
| `wizmatch_candidates` | Candidate bench (skills, visa, rate, availability) |
| `wizmatch_placements` | Placement tracking (margin, contract dates, RTR) |
| `wizmatch_domain_health` | Sending domain health (SPF/DKIM/DMARC, bounce/reply rates) |
| `wizmatch_suppression_list` | CAN-SPAM compliance (unsubscribes, bounces) |
| `wizmatch_requirements` | Requirement intake and requirement-sheet metadata |
| `wizmatch_company_intelligence` | Company qualification/review state |
| `wizmatch_contact_candidates` | Manual-reviewed decision-maker/contact candidates |
| `wizmatch_discovery_runs` | Discovery audit/cost run records |

GIN indexes on `skills` and `keywords` arrays for efficient `&&` overlap queries.

## API Routes

All under `/api/wizmatch/*`, mounted with `requireAuth`.

### Signals
- `GET /signals` — List with filters (status, min_score, source, company_id)
- `GET /signals/:id` — Full detail with matched candidates + drafts
- `POST /signals/ingest` — **Internal** — batch ingest from scrapers
- `POST /signals/:id/score` — **Internal** — deterministic TS scorer
- `POST /signals/:id/enrich` — **Internal** — email enrichment waterfall
- `POST /signals/:id/match` — **Internal** — SQL+TS candidate matching
- `POST /signals/:id/draft` — Sonnet email drafts (3 variants)
- `POST /signals/:id/send` — Manual approved send path via multi-domain mailer + sequence enrolment

### Candidates
- `GET /candidates` — List with filters (skill, visa, availability, source)
- `POST /candidates` — Create candidate (creates contact via `findOrCreateContact`)
- `GET /candidates/:id` — Detail
- `PUT /candidates/:id` — Update

### Placements
- `GET /placements` — List
- `POST /placements` — Create (computes margin/perm fee, creates deal)
- `PUT /placements/:id` — Status update

### Primes
- `GET /primes` — List prime companies with active placements + margin
- `POST /primes` — Mark company as prime

### Domains
- `GET /domains` — Domain health status
- `POST /domains/:id/pause` / `POST /domains/:id/resume`

### Compliance
- `GET /suppression` — Suppression list
- `POST /suppression` — Add to suppression
- `GET /unsubscribe` — **Public** HMAC-verified unsubscribe page

### Analytics
- `GET /digest` — Daily stats
- `GET /analytics` — Domain performance, pipeline value, source breakdown

## Cron Jobs (in `src/worker.ts`)

| Schedule | Job | Cost |
|---|---|---|
| `*/30 * * * *` | Signal scoring (cap 50/run) | $0 |
| `0 * * * *` | Enrichment (cap 20/run) | API calls only |
| `0 */2 * * *` | Candidate matching (cap 30/run) | $0 |
| `0 * * * *` | Domain health monitor (DNS) | $0 |
| `0 */6 * * *` | Domain warmup emails | SMTP only |
| `30 12 * * 1-6` | Daily digest (6 PM IST) | $0 |

## GitHub Actions (off-box scrapers)

| Workflow | Schedule | Source |
|---|---|---|
| `wizmatch-jobspy.yml` | Manual dispatch only until schedule approval | Naukri-style India job signals (Playwright) |
| `wizmatch-dice.yml` | Manual dispatch only until schedule approval | Dice job signals (Playwright) |

All workflows POST to `/api/wizmatch/signals/ingest` with the `x-internal-secret` header. GitHub
Actions stores that value as `INTERNAL_API_TOKEN`; Railway must have the same value in
`WIZMATCH_INTERNAL_TOKEN` or the documented backend fallback.

## Admin Pages (8)

| Route | Page |
|---|---|
| `/wizmatch/signals` | Job Signals Dashboard (filterable table + detail drawer) |
| `/wizmatch/candidates` | Candidate Pool (table + add form) |
| `/wizmatch/queue` | Outreach Review Queue (card layout, generate+send) |
| `/wizmatch/domains` | Domain Health (cards, pause/resume) |
| `/wizmatch/compliance` | Compliance Log (suppression list) |
| `/wizmatch/placements` | Placements Pipeline (drag-drop kanban) |
| `/wizmatch/primes` | Primes Management (table with MSA status) |
| `/wizmatch/analytics` | Analytics Dashboard (KPIs, domain perf, pipeline) |

## Setup Instructions

### 1. Run migration
```bash
npm run db:migrate  # on staging with DATABASE_URL set
```

Before doing this against production, read `docs/wizmatch-operational-readiness.md`. The current
repo has SQL files that are not all represented in Drizzle's migration journal, so a normal
deploy/migrate must be reviewed before relying on it.

### 2. Apply GIN indexes
The `0020_wizmatch_gin_indexes.sql` migration replaces btree indexes on array columns with GIN for `&&` operator support.

### 3. Seed tenant
```bash
npx tsx src/scripts/seedWizmatch.ts
```
Capture the `WIZMATCH_TENANT_ID` from the output and add it to `.env` / Railway.

### 4. Configure env vars
```env
WIZMATCH_TENANT_ID=<from seed>
WIZMATCH_INTERNAL_TOKEN=<openssl rand -hex 32>
WIZMATCH_UNSUBSCRIBE_HMAC_SECRET=<openssl rand -hex 32>
WIZMATCH_PHYSICAL_ADDRESS="Wizmatch LLC, Newark, DE, USA"
WIZMATCH_LEADS_CHANNEL=<Slack channel ID>
WIZMATCH_DAILY_CHANNEL=<Slack channel ID>
WIZMATCH_SYSTEM_CHANNEL=<Slack channel ID>
PURELYMAIL_SMTP_HOST=smtp.purelymail.com
PURELYMAIL_SMTP_PORT=587
PURELYMAIL_SMTP_USER_1=archit@getwizmatch.com
PURELYMAIL_SMTP_PASS_1=...
# ... 5 more inbox pairs
WIZMATCH_WARMUP_CONTACTS=archit@wizmatch.com,jatin@wizmatch.com
```

### 5. Set GitHub Actions secrets
- `RAILWAY_INTERNAL_API_URL` — API URL (e.g., `https://api.growthescalators.com`)
- `INTERNAL_API_TOKEN` — same secret value as backend `WIZMATCH_INTERNAL_TOKEN`
- `WIZMATCH_JOBSPY_QUERIES` — JSON array of search queries

### 6. Configure DNS for sending domains
Set up SPF, DKIM, and DMARC on all 3 domains per Purelymail's instructions.

## Files Created/Modified

### New files
- `src/db/migrations/0019_silly_zodiak.sql` — original 6 table migration (drizzle-kit generated)
- `src/db/migrations/0020_wizmatch_gin_indexes.sql` — GIN index fix for array columns
- `src/middleware/internalAuth.ts` — `requireInternalToken` middleware
- `src/services/claudeService.ts` — Claude API helper (raw fetch)
- `src/services/wizmatchScoring.ts` — Deterministic signal scorer
- `src/services/wizmatchMatching.ts` — SQL+TS candidate matcher
- `src/services/multiDomainMailer.ts` — Purelymail multi-domain sender
- `src/routes/wizmatch.ts` — Main API router (all endpoints)
- `src/scripts/seedWizmatch.ts` — Tenant/user/pipeline/sequence/domain seed
- `src/__tests__/wizmatch.test.ts` — 17 unit tests
- `admin/src/pages/Wizmatch*.jsx` — 8 admin pages
- `.github/workflows/wizmatch-*.yml` — manual-dispatch scraper workflows

### Modified files
- `src/db/schema.ts` — Added 6 `wizmatch_*` table definitions
- `src/db/index.ts` — Re-exported new tables (+ fixed missing outbound exports)
- `src/config/constants.ts` — Added Wizmatch constants
- `src/index.ts` — Mounted `/api/wizmatch` router
- `src/worker.ts` — Added 6 Wizmatch cron jobs
- `admin/src/App.jsx` — Registered 8 Wizmatch routes
- `admin/src/components/navEntries.js` — Added Wizmatch section + `canWizmatch` flag
- `package.json` — Added `nodemailer` + `@types/nodemailer`
