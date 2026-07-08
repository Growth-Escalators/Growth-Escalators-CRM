# Wizmatch Operational Readiness Guide

Last updated: 2026-07-08 IST

## Purpose

This guide explains what must be checked before turning Wizmatch into a live operating workflow on
Railway. It replaces the older deployment checklist that assumed all Wizmatch migrations and
scraper workflows were already live.

This is a readiness guide, not an approval to run migrations, deploy `main`, send outreach, or
submit candidates automatically.

## Current Status

| Area | Current state | Operator action |
|---|---|---|
| Backend/API | Wizmatch routes and manual review workflows exist in the repo. | Deploy only after the migration gap is reviewed. |
| Frontend | Wizmatch CRM/shared routes and operating pages exist. | Smoke authenticated pages after deploy. |
| Database schema | Source schema defines 10 `wizmatch_*` tables. | Production currently needs a migration/table check before use. |
| Missing production tables | Known missing/optional tables are `wizmatch_requirements`, `wizmatch_company_intelligence`, `wizmatch_contact_candidates`, and `wizmatch_discovery_runs`. | Apply only after explicit DB approval. |
| Tests | Latest local run passed: 26 files, 229 tests. | Re-run before any production deploy. |
| Scraper workflows | Dice/Naukri ingest workflows are manual-dispatch only. | Enable schedules only after separate approval. |
| Outreach/submission automation | Not enabled by this guide. | Keep outreach and candidate submission manual-gated. |

## Load-Bearing Guardrails

- Do not run `npm run db:migrate` against production without explicit approval.
- Do not push to `main` unless you intend to trigger a Railway deploy.
- Do not enable GitHub Actions schedules until the schedule is separately approved.
- Do not set or print real secret values in docs, logs, or screenshots.
- Do not auto-send outreach.
- Do not auto-submit candidates.
- Paid contact discovery remains manual, preview-first, and guarded by caps.

## Migration Readiness

Read the current diagnosis in [`docs/wizmatch-operational-readiness.md`](wizmatch-operational-readiness.md).

The short version: the SQL files for the newer Wizmatch tables exist in `src/db/migrations/`, but
the Drizzle migration journal on `origin/main` does not list every Wizmatch SQL file. Since
`src/scripts/migrate.ts` uses Drizzle's journal-based migrator, do not assume the next Railway
deploy will apply skipped files automatically.

Before applying anything to production, a human should confirm:

```bash
git fetch origin
git show origin/main:src/db/migrations/meta/_journal.json
ls src/db/migrations/0020_*.sql src/db/migrations/0021_*.sql src/db/migrations/0022_*.sql
```

Then verify production table reality without changing data:

```bash
psql "$DATABASE_URL" -c "\dt wizmatch*"
psql "$DATABASE_URL" -c "select * from drizzle.__drizzle_migrations order by created_at desc limit 10;"
```

Only after approval, apply the chosen migration repair path. If the journal is repaired and tested,
the normal Railway start command can run:

```bash
node dist/scripts/migrate.js && node dist/index.js
```

If a database owner decides to apply the existing SQL files manually, use an explicit transaction
plan and `ON_ERROR_STOP=1`; do not run this casually:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0020_wizmatch_gin_indexes.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0020_curvy_silverclaw.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/migrations/0021_contact_intelligence_phase2.sql
```

## Seed Script

The seed script creates the Wizmatch tenant, admin user, placement pipeline, follow-up sequence,
and initial domain-health rows.

Run it only against the intended database:

```bash
npx tsx src/scripts/seedWizmatch.ts
```

Save the printed `WIZMATCH_TENANT_ID` and set it in Railway after verifying the tenant was created
in the correct environment.

## Environment Variables

Run the read-only readiness check locally or in a Railway shell:

```bash
npm run wizmatch:env-check
```

The command prints only presence/absence and source key names. It never prints secret values.

### Required

| Key | Notes |
|---|---|
| `WIZMATCH_TENANT_ID` | Tenant UUID from `src/scripts/seedWizmatch.ts`. |
| `WIZMATCH_INTERNAL_TOKEN` | Internal backend token for cron/CI ingest routes. `OUTREACH_INTERNAL_SECRET` remains a backend fallback. |
| `WIZMATCH_UNSUBSCRIBE_HMAC_SECRET` | HMAC secret for unsubscribe links. |

### Recommended

| Key | Notes |
|---|---|
| `WIZMATCH_ANTHROPIC_API_KEY` | Wizmatch-specific Claude key. `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` are accepted fallbacks. |
| `GITHUB_TOKEN` | GitHub candidate mining rate limit. |
| `SERPAPI_API_KEY` | X-Ray/Google candidate sourcing. |
| `APOLLO_API_KEY` | Approved primary paid contact discovery provider. |
| `SNOV_CLIENT_ID` / `SNOV_CLIENT_SECRET` | Approved secondary contact discovery provider. Legacy aliases are supported by code. |
| `REACHER_BASE_URL` | Email verification endpoint. |
| `PURELYMAIL_SMTP_HOST` / `PURELYMAIL_SMTP_PORT` | Purelymail SMTP settings. |
| `PURELYMAIL_SMTP_USER_1..6` / `PURELYMAIL_SMTP_PASS_1..6` | Sender inbox credentials. |
| `WIZMATCH_PHYSICAL_ADDRESS` | Required for compliant email footers before any outreach is sent. |

### Optional

| Key | Notes |
|---|---|
| `SERPER_API_KEY` | Google fallback for Contact Intelligence, only if `WIZMATCH_GOOGLE_FALLBACK_ENABLED=true`. |
| `WIZMATCH_LEADS_CHANNEL` | Slack alerts for priority signals/replies. |
| `WIZMATCH_DAILY_CHANNEL` | Slack daily summaries. |
| `WIZMATCH_SYSTEM_CHANNEL` | Slack guardrail/system alerts. |
| `WIZMATCH_JOBSPY_QUERIES` | JSON array of scraper query strings. |
| `WIZMATCH_WARMUP_CONTACTS` | Comma-separated friendly inboxes for warmup flows. |

The approved Contact Intelligence order is Apollo -> Snov -> Reacher/manual website checks ->
optional Google fallback. Do not add another enrichment vendor without a later approved decision.

## GitHub Actions Scraper Workflows

The repository contains these ingest-only workflows:

| Workflow | Current trigger | Writes |
|---|---|---|
| `.github/workflows/wizmatch-dice.yml` | Manual dispatch only | `wizmatch_job_signals`, `wizmatch_companies` through `/api/wizmatch/signals/ingest` |
| `.github/workflows/wizmatch-jobspy.yml` | Manual dispatch only | `wizmatch_job_signals`, `wizmatch_companies` through `/api/wizmatch/signals/ingest` |

They require GitHub Actions secrets:

| Secret | Value |
|---|---|
| `RAILWAY_INTERNAL_API_URL` | API base URL, for example `https://api.growthescalators.com`. |
| `INTERNAL_API_TOKEN` | Same secret value as the backend's `WIZMATCH_INTERNAL_TOKEN`. |

Do not enable workflow schedules until explicitly approved. Manual dispatch is the safe default for
operator-controlled data loading.

## Manual Smoke After Deploy

After the approved deploy and DB readiness checks:

1. Log in to `https://crm.growthescalators.com` with a Wizmatch user.
2. Open `/wizmatch/dashboard` and confirm readiness cards load without server errors.
3. Open `/wizmatch/readiness` and confirm table presence/counts match the production DB check.
4. Open `/wizmatch/requirements` or the current requirement workflow and create a small manual test requirement only if this is an approved environment.
5. Run a manual scraper workflow from GitHub Actions and confirm new job signals appear in `/wizmatch/signals` or the current signals surface.
6. Review Contact Intelligence manually. Do not approve outreach unless the operator has reviewed the contact, suppression, domain health, and message.

## Troubleshooting

### Wizmatch pages show empty or fallback data

Check the readiness page and production tables. Missing `wizmatch_requirements`,
`wizmatch_company_intelligence`, `wizmatch_contact_candidates`, or `wizmatch_discovery_runs` will
force newer operating pages into fallback/readiness mode.

### Manual workflow cannot ingest signals

Confirm the GitHub Actions secrets are set:

```text
RAILWAY_INTERNAL_API_URL
INTERNAL_API_TOKEN
```

Then confirm Railway has the matching backend token:

```text
WIZMATCH_INTERNAL_TOKEN
```

The ingest endpoint is `POST /api/wizmatch/signals/ingest` and is protected by the existing
internal token middleware.

### Email or Contact Intelligence provider paths do not run

Run:

```bash
npm run wizmatch:env-check
```

Then set only the missing provider variables you intentionally want enabled. Paid discovery should
remain disabled unless the manual preview/cost guard flow is explicitly being used.
