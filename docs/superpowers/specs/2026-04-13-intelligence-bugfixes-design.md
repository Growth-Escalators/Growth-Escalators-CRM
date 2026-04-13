# Intelligence Page Bug Fixes — Design Spec

**Date:** 2026-04-13
**Author:** Jatin Agrawal + Claude Code
**Status:** Draft

---

## Problem Statement

The Intelligence page has 3 visual bugs and 1 data gap identified from production screenshots:
1. Score Trend chart shows raw ISO timestamps instead of formatted dates
2. System Health cron table shows phantom job names from before our rename fix
3. SEO workflows show "never run" because new cron triggers haven't fired yet
4. Low scores (2/100) are a downstream effect of empty data, not a code bug

## Scope

3 code fixes + 1 data trigger. No new features, no schema changes.

## Out of Scope
- Low intelligence scores (data-driven, fixes itself when data flows)
- Sidebar caching (browser-side issue, hard refresh resolves)
- Meta Ad zero spend (requires campaign activation in Meta Business Manager)

---

## Design

### Fix 1: Score Trend Chart Date Formatting

**File:** `admin/src/pages/IntelligencePage.jsx:370`

**Current (broken):**
```jsx
{String(d.report_date??'').slice(5)}
```
Produces: `-31T00:00:00.000Z`

**Fixed:**
```jsx
{d.report_date ? new Date(d.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
```
Produces: `13 Apr`

### Fix 2: Filter Phantom Cron Names from System Health

**File:** `src/services/systemHealthMonitor.ts:249-253`

**Current (shows ALL job names ever logged):**
```sql
SELECT DISTINCT ON (job_name) job_name, status, started_at, completed_at, duration_ms, records_processed
FROM cron_job_logs
ORDER BY job_name, started_at DESC
```

**Fixed (only shows names in CRON_WINDOWS):**
```sql
SELECT DISTINCT ON (job_name) job_name, status, started_at, completed_at, duration_ms, records_processed
FROM cron_job_logs
WHERE job_name = ANY($1)
ORDER BY job_name, started_at DESC
```
Pass `Object.keys(CRON_WINDOWS)` as the parameter.

### Fix 3: Startup Cleanup of Old Cron Names

**File:** `src/services/systemHealthMonitor.ts` (add to `ensureCronJobLogsTable`)

Add a cleanup query that deletes rows with obsolete job names:
```sql
DELETE FROM cron_job_logs
WHERE job_name IN ('Blocker Alerts (morning)', 'Blocker Alerts (evening)', 'Daily ROAS Report')
```

This runs once at startup. Idempotent — safe to run multiple times.

### Fix 4: Trigger SEO Workflows

**No code change** — use the existing `POST /api/seo-workflows/trigger-all` endpoint to fire all SEO workflows and populate data.

---

## Files to Modify

| File | Change |
|---|---|
| `admin/src/pages/IntelligencePage.jsx` | Fix date formatting on line 370 |
| `src/services/systemHealthMonitor.ts` | Filter cron query + add startup cleanup |

## Verification

- `npm run build` — 0 errors
- `npm test` — 72+ tests passing
- Score Trend chart shows "13 Apr" format dates
- System Health cron table no longer shows "Blocker Alerts (morning/evening)" or "Daily ROAS Report"
- After trigger-all: SEO workflows show as running/completed
