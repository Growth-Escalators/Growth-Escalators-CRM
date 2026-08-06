# SEO Platform — Day-2 Operations

Reference for running, monitoring, and debugging the SEO platform once it is
live. Not a getting-started guide — this assumes the platform is already on
and focuses on "how do I tell what's happening" and "how do I fix it."

Every fact below was checked against the code in this repo at the time of
writing (see file paths inline). Where the code itself was mid-change during
that check, this is called out explicitly rather than guessed at — see
"Known gaps" at the end.

## How the platform runs, in one paragraph

SEO is a per-tenant add-on (`tenants` × `seo` feature flag, see
`src/services/tenantFeatures.ts`'s `PLAN_DEFAULTS` — today only
`growth-escalators` has it on). Every SEO cron lives in `src/worker.ts` between
the `SEO CRON BLOCK` / `END SEO CRON BLOCK` markers and loops over every
SEO-enabled tenant via `forEachSeoTenant()` (`src/services/seoTenantContext.ts`),
isolating one tenant's failure from the rest. `resolveDefaultSeoTenantId()` is
the single-tenant fallback still used by a handful of manual-trigger call
sites — it **throws** the moment a second tenant has `seo: true`, by design
(it refuses to guess whose data a no-tenant-arg call means). A site is tracked
by registering a row in `seo_sites` (`src/services/seoSiteRegistry.ts`,
`/api/seo-sites`); nothing downstream — GSC/GA4 pulls, drift sweep, rank
tracking, the cost guard's per-site caps — sees a site that isn't registered
there.

## Crons

All schedules are IST; the UTC cron expression is in `src/worker.ts`.

| Cron name (exact string — grep this) | Schedule | Service | Writes | Gate |
|---|---|---|---|---|
| `SEO Weekly Email` | Thu 10:30 | `seoWeeklyEmailService.sendSEOWeeklyEmail` | (reads only; Brevo email) | `isPaused('seo')` + `AUTOMATED_EMAILS_ENABLED==='true'` (checked inside the service) + GE-only-recipient guard |
| `SEO GSC Pull` | Mon 8:15 | `seoSearchConsoleService.runSeoSearchConsolePull` | `seo_weekly_metrics` (totals), `keyword_rankings` (query rows), `seo_page_metrics` (page rows) | `isPaused('seo')` |
| `SEO GA4 Pull` | Mon 8:45 | `seoAnalyticsService.runSeoAnalyticsPull` | `seo_weekly_metrics` (`total_sessions`/`ga4_sessions` only, merges into the GSC pull's row) | `isPaused('seo')` |
| `PageSpeed Monitor` | Sun 7:30 | `pagespeedService.runPageSpeedChecks` | `site_health_metrics` | `isPaused('seo')` |
| `Rank Tracking` | Tue 9:00 | `rankTrackingService.runRankChecks` | `keyword_rankings` | none (re-enabled 2026-07; no `isPaused` check on this one) |
| `SEO Drift Sweep` | daily 7:30 | `siteDriftService.runSeoDriftSweep` | `seo_site_snapshots`; updates `site_changes.verified_live_at` | `isPaused('seo')` |
| `SEO Alert Triggers` | daily 9:00 | `seoAlertService.runSeoAlertChecks` | `seo_alerts_log` | `isPaused('seo')` |
| `SEO Backlink Monitor` | Fri 9:00 | `seoBacklinkService.runBacklinkCheck` | `backlink_data` | none |
| `SEO Content Decay` | Mon 9:00 | `seoContentDecayService.runContentDecayDetection` | `seo_opportunities`, `seo_content_calendar` | none |
| `SEO Weekly Digest` | Fri 17:00 | `seoDigestService.sendWeeklyOpportunityDigest` | updates `seo_opportunities.outcome`; posts Slack | whole `cron.schedule(...)` wrapped in `if (SEO_DIGEST_SLACK_ENABLED)` (default OFF) + `isPaused('seo')` + GE-only-recipient guard |
| `SEO Indexing Reminder` | Fri 12:30 | `seoIndexingQueueService.sendIndexingReminderDigest` | `seo_indexing_queue` | `isPaused('seo')` |
| `Competitor Content Analysis` | 1st & 15th, 9:00 | `competitorContentService.runCompetitorContentAnalysis` | `content_gap_analysis` | `isPaused('seo')` |
| `SEO Content Gap Analysis` | 15th, 10:00 | `seoContentGapService.runContentGapAnalysis` | `content_gap_analysis`, `seo_opportunities`, `seo_content_calendar` | none |

**How to tell a cron ran.** Every cron above except `SEO Weekly Email` and
`SEO Indexing Reminder` writes one `seo_workflow_logs` row **per tenant** via
the `seoTenantSweep()` wrapper (`src/worker.ts`), with a real `workflow_id`
string (`seo-gsc-pull`, `seo-ga4-pull`, `seo-drift-sweep`,
`seo-content-gap-analysis`, `competitor-content-analysis`, or the legacy n8n
ids kept for the crons that predate this rewrite —
`z21W6MDWBF0dukkT`/PageSpeed, `BwO187curjMMA60i`/Rank Tracking,
`5FVX2kEjuD7vWD0e`/Alert Triggers, `19R3BStSY2S1N9H1`/Backlink Monitor,
`Ss2Bfps5lXBWUUs4`/Content Decay, `M4rbRZL5jh0jJHku`/Weekly Digest). Query it
directly:
```sql
SELECT tenant_id, status, started_at, finished_at, records_processed, error_message
FROM seo_workflow_logs
WHERE workflow_id = '<workflow_id from the table above>'
ORDER BY created_at DESC LIMIT 10;
```
`SEO Weekly Email` and `SEO Indexing Reminder` write no row at all — the only
signal for those two is the Railway worker process log line
(`[CRON] <name> (tenant <id>): ...`).

**Do not trust `GET /api/seo-workflows/status` (`checkWorkflowHealth()` in
`seoWorkflowHealthService.ts`) as the complete picture.** Its `SEO_WORKFLOWS`
array is the old 12-entry n8n list and does not include
`seo-drift-sweep`, `seo-gsc-pull`, `seo-ga4-pull`,
`seo-content-gap-analysis`, or `competitor-content-analysis` — those crons run
and log correctly, they just don't render as their own row on that endpoint.
It also lists GSC+GA4 as one workflow (`YXmClFSKZB9DMkyu`, "GSC + GA4 Data
Pull") even though they are now two separate crons with their own
`workflow_id`s; its health for that row comes from a direct `seo_weekly_metrics`
query, not from either cron's log rows, so it stays roughly accurate but won't
tell you which of the two actually ran.

## Environment variables

### Kill switches / feature gates

| Var | Default | Effect |
|---|---|---|
| `seo` tenant feature flag | off, per tenant (`tenantFeatures.ts`) | Whether a tenant's crons/routes run at all — not an env var, a DB-backed flag |
| `PAUSED_FEATURES.seo` (code constant, `src/config/featureFlags.ts`) | `false` (not paused) | One flip pauses every `isPaused('seo')`-gated cron in the table above at once |
| `SEO_DIGEST_SLACK_ENABLED` | unset (OFF) | Gates the entire `SEO Weekly Digest` cron registration |
| `AUTOMATED_EMAILS_ENABLED` | unset (OFF, must equal `'true'`) | Gates `sendSEOWeeklyEmail` — checked inside the service, not just the cron |
| `SLACK_NOTIFICATIONS_PAUSED` | unset (OFF) | Global Slack kill switch — also silences drift alerts |

### Site adapter / publish path

| Var | Default | Effect |
|---|---|---|
| `SITE_ADAPTER_ENABLED` | `false` | Must be `true` or every `getSiteProvider()` call throws `missing_configuration` — the whole publish path is off by default |
| `SITE_PROVIDER` | unset (throws if `SITE_ADAPTER_ENABLED` is true and this isn't set) | `'platform'` (real per-platform adapters) or `'mock'` — a platform name is rejected outright |

### GSC / GA4 (shared OAuth client, `seoSearchConsoleService.ts` / `seoAnalyticsService.ts`)

| Var | Notes |
|---|---|
| `GOOGLE_SEO_OAUTH_REFRESH_TOKEN`, `GOOGLE_SEO_OAUTH_CLIENT_ID`, `GOOGLE_SEO_OAUTH_CLIENT_SECRET` | Primary auth path. Per `docs/go-live/OWNER_ACTION_LIST.md`, this trio is a **different client and was NOT part of the leaked-credentials incident** — do not rotate it "to be safe"; doing so breaks the pull until the refresh token is re-minted. |
| `GOOGLE_OAUTH_CREDS_FILE` | Local-dev fallback file path, default `~/.ge-seo/oauth_credentials.json` — never present on the Railway worker |
| `GOOGLE_SA_KEY_PATH` / `GOOGLE_SA_KEY_JSON` | Service-account fallback if the OAuth trio above is absent |
| `GCP_OAUTH_CLIENT_SECRET` | A **separate** credential (not read by these two files) — this is the one from the leaked-credentials incident that actually needs rotating |

### Serper / content generation

| Var | Used by |
|---|---|
| `SERPER_API_KEY` | `rankTrackingService`, `seoBacklinkService`, `seoContentGapService`, `competitorContentService` — all four route the actual HTTP call through `guardedSerperCall` (`seoSerperGuard.ts`), but check this key first since a missing key short-circuits before the guard is ever reached |
| `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY` | `programmaticSeoService.ts` (content generation), `competitorContentService.ts` (competitor content analysis) |

### Programmatic WordPress publishing (separate from the WordPress `SiteProvider` adapter below)

| Var | Notes |
|---|---|
| `WP_AGEDDENTISTRY_URL` | Default `https://ageddentistry.org` |
| `WP_AGEDDENTISTRY_USER`, `WP_AGEDDENTISTRY_PASS` (or `WP_AGEDDENTISTRY_PASSWORD`) | `programmaticSeoService.publishToWordPress()` reads these directly from `process.env` — **not** the encrypted `tenant_integrations` store. Per `OWNER_ACTION_LIST.md`: update these Railway vars on rotation, never delete them — deleting stops publishing with no error. |

### Indexing queue / misc

| Var | Default |
|---|---|
| `SEO_INDEXING_SITEMAP_URL` | `https://growthescalators.com/sitemap.xml` |
| `SEO_INDEXING_WEEKLY_LIMIT` | `10` |
| `SLACK_SEO_CHANNEL` | `C09TUDJPS2X` |

### Cost guard (`src/services/seoCostGuard.ts`)

| Var | Default | Caps |
|---|---|---|
| `SEO_COST_CURRENCY` | `INR` | display currency only |
| `SEO_MONTHLY_BUDGET_CENTS` | `200000` | total spend/month |
| `SEO_DAILY_BUDGET_CENTS` | `20000` | total spend/day |
| `SEO_MAX_SERPER_CALLS_PER_TENANT_DAY` | `50` | tenant-wide Serper calls/day |
| `SEO_MAX_SERPER_CALLS_PER_SITE_DAY` | `20` | per-site Serper calls/day (plan `limits.seoSerperCallsPerSiteDay` overrides) |
| `SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY` | `100` | tenant-wide PageSpeed calls/day |
| `SEO_MAX_GSC_CALLS_PER_TENANT_DAY` | `200` | tenant-wide GSC calls/day |
| `SEO_MAX_GA4_CALLS_PER_TENANT_DAY` | `200` | tenant-wide GA4 calls/day — **enforced in `evaluateSeoCostGuard`, but `seoAnalyticsService.ts` doesn't call the guard yet, so this cap is currently a no-op in practice** (see Known gaps) |
| `SEO_MAX_PUBLISHES_PER_SITE_DAY` | `3` | per-site publishes/day (plan `limits.seoPublishesPerSiteDay` overrides) |
| `SEO_SERPER_COST_CENTS` | `100` | cost per Serper call |
| `SEO_PAGESPEED_COST_CENTS` | `0` | PageSpeed Insights is a free Google API |
| `SEO_LLM_COST_CENTS` | `500` | cost per LLM call |
| `SEO_SERPER_DAILY_CAP` | `50` | **legacy, dead** — the old global in-memory cap in `seoWorkflowHealthService.ts` (`checkAndIncrementSeoSerperCap`); zero callers remain, all four Serper sites moved to the guard above |

## Cost guard block codes

`evaluateSeoCostGuard()` returns exactly one of these on a block (first match
wins, in this order):

| `blockCode` | HTTP | Trigger | Raise the ceiling via |
|---|---|---|---|
| `site_paused` | 503 | `seo_sites.status !== 'active'` for the target site — **only checked when the caller passes a `spendContext`** (built with `createSeoSpendContextResolver`); not every call site does | `UPDATE seo_sites SET status='active' ...` |
| `provider_config_missing` | 503 | Caller-supplied `providerEnv.missing` list is non-empty | Fix the named credential — the guard itself never fetches or checks this |
| `monthly_budget_exhausted` | 402 | month-to-date spend + this call's estimate > cap | `SEO_MONTHLY_BUDGET_CENTS` |
| `daily_budget_exhausted` | 402 | day-to-date spend + estimate > cap | `SEO_DAILY_BUDGET_CENTS` |
| `tenant_daily_serper_cap_exhausted` | 429 | tenant's Serper calls today + estimate > cap | `SEO_MAX_SERPER_CALLS_PER_TENANT_DAY` |
| `site_daily_serper_cap_exhausted` | 429 | site's Serper calls today + estimate > cap | `SEO_MAX_SERPER_CALLS_PER_SITE_DAY` or plan `limits.seoSerperCallsPerSiteDay` |
| `tenant_daily_pagespeed_cap_exhausted` | 429 | tenant's PageSpeed calls today + estimate > cap | `SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY` |
| `tenant_daily_gsc_cap_exhausted` | 429 | tenant's GSC calls today + estimate > cap | `SEO_MAX_GSC_CALLS_PER_TENANT_DAY` |
| `tenant_daily_ga4_cap_exhausted` | 429 | tenant's GA4 calls today + estimate > cap | `SEO_MAX_GA4_CALLS_PER_TENANT_DAY` — not reachable today, see above |
| `site_daily_publish_cap_exhausted` | 429 | site's publishes today + estimate > cap | `SEO_MAX_PUBLISHES_PER_SITE_DAY` or plan `limits.seoPublishesPerSiteDay` |

Money is tracked in integer cents in `seo_api_usage.cost_cents`, never a
float. Day/month boundaries are computed in **IST** (fixed +5:30 offset), not
UTC or the process's local time — see `seoCostGuardUsage.ts`'s `istDayStart`/
`istMonthStart` — so a cap resets at IST midnight regardless of what timezone
the Railway container reports.

## Tables

| Table | Holds | Written by | Read by |
|---|---|---|---|
| `seo_sites` | The tenant-isolation registry — one row per tracked site | `seoSiteRegistry.ts` (admin CRUD via `/api/seo-sites`) | almost everything |
| `seo_api_usage` | Append-only spend ledger (one row per billable call) | `recordSeoApiUsage` (`seoCostGuardUsage.ts`), via `guardSeoSpend` / `guardedSerperCall` | `fetchSeoCostGuardUsage` (the guard's own usage fetch) |
| `seo_workflow_logs` | One row per tenant per cron run (mostly) | `logSeoWorkflowRun`, called from `seoTenantSweep()` and the manual-trigger routes | `checkWorkflowHealth()`, `GET /api/seo-workflows/logs` |
| `seo_weekly_metrics` | Domain-level weekly GSC/GA4 rollup (clicks, impressions, position, ctr, sessions) — one row per (site, week) | GSC pull (totals) + GA4 pull (sessions, merges into the GSC row via UPDATE-then-INSERT) | `seoWeeklyEmailService`, `seoDigestService`, `routes/seo.ts` client detail |
| `keyword_rankings` | Per-query rank history | GSC pull (query-dimension rows) + `rankTrackingService` (Serper) | `seoAlertService`, `seoDigestService`, `seoContentDecayService`, `competitorContentService`, several routes |
| `seo_page_metrics` | Per-URL GSC clicks/impressions/position/ctr, one row per (site, url, day) | GSC pull's page-dimension query (`persistGscPageRow`, upserts on `(tenant_id, site_id, recorded_date, page_url)`) | **Intended reader is the drift sweep's third URL source — see Known gaps; not actually queried by `collectCandidateUrls()` as of this writing** |
| `site_health_metrics` | PageSpeed/CWV per site | `pagespeedService.runPageSpeedChecks` | `seoAlertService`, `routes/seo.ts` overview |
| `seo_alerts_log` | Alert triggers (rank drops, health issues) | `seoAlertService.runSeoAlertChecks` | `seoDigestService`, admin routes |
| `seo_opportunities` | Content-decay / content-gap / lost-ranking opportunities, with outcome tracking | `seoContentDecayService`, `seoContentGapService`; `seoDigestService` updates `outcome`/`outcome_measured_at` | `seoDigestService`, `routes/seoWorkflows.ts` stats |
| `seo_content_calendar` | Editorial calendar entries, can link back to an opportunity | `seoContentDecayService`, `seoContentGapService`, admin CRUD in `routes/seo.ts` | admin UI |
| `backlink_data` | Backlink inventory | `seoBacklinkService.runBacklinkCheck` | admin routes |
| `content_gap_analysis` | Competitor/keyword content gaps | `seoContentGapService`, `competitorContentService` | admin routes |
| `client_pages` | Page inventory (not a metrics time series) | `programmaticSeoService` (WordPress publish flow) | `siteDriftService.collectCandidateUrls` (source #1), content-briefs route |
| `client_knowledge_base` | Brand voice / positioning inputs for content generation | admin/seed | `seoContentGapService`, `pagespeedService`, `programmaticSeoService` |
| `site_changes` | The approval/publish state machine for live-site edits | **only** `siteChangeService.ts` | `siteDriftService` (attribution match, read-only), approvals UI |
| `seo_site_snapshots` | Append-only per-URL crawl history + drift classification | `siteDriftService.runSeoDriftSweep` | drift/admin views |
| `seo_indexing_queue` | Manual "Request Indexing" tracker (no schema.ts entry — raw-SQL ensure-hook table) | `seoIndexingQueueService.ts` | same file, `SEO Indexing Reminder` cron |
| `brand_mentions` | Brand-mention discovery | **no writer anywhere in the app** | **no reader anywhere in the app** — dead table, per its own schema.ts comment |

## Routes

All four mount behind `requireAuth` + `requireTenantFeature('seo')`
(`src/index.ts`):

| Mount | File | Purpose |
|---|---|---|
| `/api/seo` | `src/routes/seo.ts` | Overview/client/keyword/alert reads; legacy `workflows`/`trigger/:workflowId` (n8n-shaped, see Known gaps); programmatic WordPress page generation (WordPress-target-ownership gated, see `assertOwnsWordPressTarget`); content briefs/calendar CRUD |
| `/api/seo-workflows` | `src/routes/seoWorkflows.ts` | `status` (health dashboard), `trigger/:path`, `trigger-all`, `run/:service`, `logs`, and several `*-stats`/`data-health` reads |
| `/api/seo-sites` | `src/routes/seoSites.ts` | CRUD on the `seo_sites` registry; write ops are admin-only; create enforces plan `limits.seoSites` |
| `/api/seo-changes` | `src/routes/siteChanges.ts` | `site_changes` lifecycle: list/get/create/stage/verify/approve/reject/publish/retry-publish/handoff-complete/preview |

`POST /api/seo/generate-local-pages`, `/regenerate-pages`, and
`/publish-pending-pages` publish to a WordPress site resolved from the global
`WP_AGEDDENTISTRY_*` env vars, not per-tenant — `assertOwnsWordPressTarget()`
is a fail-closed gate so a reseller tenant can't draft/publish onto GE's own
WordPress site; it 409s if the caller's tenant doesn't own that domain in
`seo_sites`.

## The publish path (site providers)

Behind `SITE_ADAPTER_ENABLED=true` + `SITE_PROVIDER=platform` (both off by
default — see env vars above), `src/modules/site/providers/` resolves one
adapter per `seo_sites.platform` (`git` → `GitSiteProvider`, `wordpress` →
`WordPressSiteProvider`, `shopify` → `ShopifySiteProvider`). `getConfigStatus()`
on the resolved provider — not a network call — tells you what's missing per
site:

| Platform | Config source | Publishes via |
|---|---|---|
| `git` | `adapterConfig.repo` + `adapterConfig.branch` (`adapterConfig.host` optional, defaults `github.com`) | **Never** — always returns `handoff_required`; a human/CI merges the branch. Railway's filesystem is ephemeral and this container holds no push credential. |
| `wordpress` | `adapterConfig.baseUrl` | Live API call (`publishesViaApi`) |
| `shopify` | `site.domain` (+ `adapterConfig.themeSnippetInstalled` must be `true` for structured-data writes to actually render — otherwise `getConfigStatus` reports `misconfigured: theme_snippet_missing`) | Live API call (`publishesViaApi`) |

`publishApprovedChange()` in `siteChangeService.ts` is the **only** function
in the codebase allowed to call a provider's `publishChange`. It asserts
`status === 'approved'` with a non-null `approved_by`/`approved_at` and
`verify_passed !== false` before doing anything — backed independently by the
`site_changes_approved_requires_approver` DB CHECK constraint. A refusal here
(`unauthorised_publish`, HTTP 403) is the system working correctly, not a bug.

## Diagnosis recipes

**Which tenants have SEO on, and what sites do they have registered?**
```sql
-- tenants.seo isn't a literal column; if unsure, grep getActiveTenantsWithFeature('seo') in tenantFeatures.ts
SELECT s.tenant_id, s.label, s.domain, s.platform, s.status, s.gsc_property, s.ga4_property_id
FROM seo_sites s
ORDER BY s.tenant_id, s.created_at DESC;
```

**Did a cron run for a tenant recently?**
```sql
SELECT tenant_id, status, started_at, records_processed, error_message
FROM seo_workflow_logs
WHERE workflow_id = 'seo-drift-sweep'   -- swap in the workflow_id from the crons table
ORDER BY created_at DESC LIMIT 10;
```

**Is a tenant near a cost-guard cap today?**
```sql
SELECT provider, SUM(calls) AS calls, SUM(cost_cents) AS cost_cents
FROM seo_api_usage
WHERE tenant_id = '<tenant-id>'
  AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date  -- IST day boundary, matches istDayStart()
GROUP BY provider;
```

**GSC/GA4 pull failing — auth, quota, or transient?**
```bash
railway logs --service <worker-service> | grep -E "GscApiError|Ga4ApiError"
```
`kind: 'auth'` → refresh token/client needs re-authorization (401/403).
`kind: 'quota'` → 429, will clear on its own. `kind: 'transient'` → 5xx,
Google-side, safe to retry.

**Has a page's drift baseline ever been recorded, and what's the latest classification?**
```sql
SELECT fetched_at, http_status, content_hash, drift_kind, drift_severity, alerted_at
FROM seo_site_snapshots
WHERE tenant_id = '<tenant-id>' AND site_id = '<site-id>' AND page_url = '<url>'
ORDER BY fetched_at DESC LIMIT 5;
```
No rows at all means the sweep has never checked this URL — confirm it's
actually in `collectCandidateUrls()`'s source set (`client_pages` +
recently-published `site_changes`; see Known gaps for the third source).

**What's sitting in the approval queue?**
```sql
SELECT id, site_id, change_kind, page_url, status, created_at
FROM site_changes
WHERE tenant_id = '<tenant-id>' AND status = 'awaiting_approval'
ORDER BY created_at ASC;
```

**Is the site adapter even on, and is one site configured for it?**
```bash
curl -s https://<api-host>/api/seo-sites/<site-id> -H "Authorization: Bearer <token>" | jq .site.adapterConfig
```
Then check `SITE_ADAPTER_ENABLED`/`SITE_PROVIDER` on the worker/web service —
`getSiteProvider()` throws before ever looking at `adapterConfig` if either is
wrong.

**Manual health check:**
```bash
curl -s https://<api-host>/api/seo-workflows/status -H "Authorization: Bearer <token>" | jq .summary
```
Remember this omits several current crons — see the crons table's note.

## Known gaps

Stated plainly rather than hidden — verified against the code, not assumed:

- **`SEO_MAX_GA4_CALLS_PER_TENANT_DAY` is enforced in `evaluateSeoCostGuard`
  but not reachable in practice.** `seoAnalyticsService.ts` (the GA4 puller)
  does not import or call `guardSeoSpend` — the cap, block code, and usage
  columns all exist end-to-end (`seoCostGuard.ts`, `seoCostGuardUsage.ts`),
  but the one call site that would trigger it doesn't call the guard yet.
- **The drift sweep's third URL source is half-wired.**
  `siteDriftService.ts`'s file header now describes `seo_page_metrics`
  (top-impression pages) as the sweep's third candidate-URL source alongside
  `client_pages` and `site_changes`. The GSC pull does write that table
  (`persistGscPageRow`, `seoSearchConsoleService.ts`). But
  `collectCandidateUrls()`'s actual query body still only reads `client_pages`
  and `site_changes` — it does not select from `seo_page_metrics`. Trust the
  function body over the comment until this is closed.
- **Manual-trigger routes don't thread `tenantId`.** `POST
  /api/seo/trigger/:workflowId`, `POST /api/seo-workflows/trigger/:path`,
  `/trigger-all`, and `/run/:service` all call their underlying service
  functions with zero arguments, so every one of them falls back to
  `resolveDefaultSeoTenantId()` — which resolves only to the single default
  SEO tenant today and will throw once a second tenant has `seo: true`. The
  equivalent cron-path C2 issue was fixed for `POST
  /api/seo/competitor-brief`; these four manual-trigger endpoints still have
  it.
- **`seoWorkflowHealthService.ts`'s `SEO_WORKFLOWS` array is stale.** It's
  the original 12-entry n8n list and doesn't include the newer
  `workflow_id`s (`seo-drift-sweep`, `seo-gsc-pull`, `seo-ga4-pull`,
  `seo-content-gap-analysis`, `competitor-content-analysis`) — those crons
  run and log to `seo_workflow_logs` correctly, they just don't appear as
  their own row in `checkWorkflowHealth()`'s output.
- **`keyword_rankings` has no clicks/impressions/ctr columns** — GSC
  query-dimension rows persisted there only carry position, not the volume
  behind it.
- **`brand_mentions` has zero writers and zero readers anywhere in the app**
  (per its own schema.ts comment) — a fully inert table.
- **`seo_indexing_queue` has no `schema.ts` entry** — it's created only via
  `ensureSeoIndexingQueueTable()`'s raw SQL in `seoIndexingQueueService.ts`.
- **`GOOGLE_SEO_OAUTH_*` is not the leaked credential set; `GCP_OAUTH_CLIENT_SECRET`
  is.** Rotating the wrong one either does nothing for the actual exposure or
  breaks the GSC/GA4 pull needlessly — see `OWNER_ACTION_LIST.md`.
- **`WP_AGEDDENTISTRY_*` are read directly from `process.env`,** not the
  encrypted `tenant_integrations` store — `programmaticSeoService.ts` is the
  only reader. Deleting them (rather than updating in place) silently stops
  WordPress publishing with no error surfaced anywhere.
- **The retired-client data purge is deferred, not done.** aarohaom.com,
  blackpandaenterprises.com, ageddentistry.org still have rows in every SEO
  table. Plan + dry-run-by-default script: `docs/go-live/SEO_CLIENT_DATA_PURGE_PLAN.md`
  and `scripts/seo-client-purge.ts`.
