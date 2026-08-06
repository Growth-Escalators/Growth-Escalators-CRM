# Debugging the SEO system

The SEO system is native TypeScript, not n8n. It is multi-tenant (any tenant
with the `seo` tenant feature can run it) and multi-platform (a registered
site's content is published through a git, WordPress, or Shopify adapter).
There is no n8n instance to check any more — if you've been pointed at an
n8n workflow ID (`WF-SEO-*`) for this, you're looking at
[`docs/archive/n8n-workflows-seo/`](../archive/n8n-workflows-seo/README.md),
which is archived history, not something that runs. This doc is the live
system.

If you're new to this codebase: read `src/services/seoTenantContext.ts` and
`src/services/siteChangeService.ts` first. Nearly every confusing SEO bug
traces back to one of the two invariants those files enforce.

## The two invariants everything else sits on top of

### 1. A cron must never resolve "the" SEO tenant

`resolveDefaultSeoTenantId()` (`src/services/seoTenantContext.ts`) picks a
single tenant and **throws the moment a second active tenant has `seo: true`**
— it deliberately refuses to guess which tenant owns the data it's about to
touch. That's correct for a request handler that only ever serves one
authenticated tenant. It is **never** correct for a cron: a cron that calls it
stops working for *every* tenant, including Growth Escalators' own, the day
the SEO add-on is sold to a second agency.

Crons instead use `forEachSeoTenant(label, fn)`, which loops
`getSeoTenantIds()` and isolates each tenant's failures so one tenant's
expired Google token can't skip every tenant scheduled after it. This is
pinned by a source-level test —
`src/__tests__/seoCronTenantSweep.test.ts` asserts that nothing in the SEO
cron block of `src/worker.ts` calls `resolveDefaultSeoTenantId()`. If you're
adding a new SEO cron, follow the existing pattern
(`seoTenantSweep(...)`, defined right above the cron block in `worker.ts`
around line 1235) — don't call a service with no tenant argument and let it
fall back internally.

**Symptom if this breaks:** every SEO cron/report/health check that used to
work suddenly errors for GE too, right after a new tenant gets the `seo`
feature turned on. Check whatever changed for a raw call to
`resolveDefaultSeoTenantId()` outside a single-tenant request handler.

### 2. Nothing publishes to a client's live site without a recorded human approval

Enforced at three independent layers on purpose — a bug in any one of them
would otherwise mean the system silently edits a client's live website with
nobody's consent:

1. **The database.** Migration `0048`'s
   `site_changes_approved_requires_approver` CHECK constraint rejects any
   `site_changes` row sitting in `approved`/`publishing`/`published`/
   `handoff_required`/`publish_failed` without both `approved_by` and
   `approved_at` set.
2. **`src/services/siteChangeService.ts`.** `publishApprovedChange()` is the
   **only** function in the codebase allowed to call
   `provider.publishChange()`, and it calls `assertSiteChangeApproved()`
   first, unconditionally. If you're tempted to add a second call site for
   `provider.publishChange()` — don't; route through
   `publishApprovedChange()` instead.
3. **Each platform adapter** (`src/modules/site/providers/{git,wordpress,shopify}.provider.ts`)
   re-checks `approved.approvedBy` before its first network call and throws
   `SiteProviderError('unauthorised_publish', ...)` if it's missing.

**If a publish "isn't working," this is usually working correctly.** Check
the change's `status` via `GET /api/seo-changes/:id` — publish is legal only
from `approved` (see `nextSiteChangeStatus` / `SITE_CHANGE_STATUSES` in
`siteChangeService.ts` for the full transition table: `proposed → staged →
awaiting_approval → approved → publishing → published`, with
`verification_failed` and `publish_failed` as recoverable side branches and
`rejected`/`superseded` as terminal). A `403 unauthorised_publish` from
`POST /api/seo-changes/:id/publish` means exactly what it says: nobody
approved this change, or its `verify_passed` is `false`.

A `publish_failed` change retries via `retry_publish`
(`POST /api/seo-changes/:id/retry-publish`), which moves it back to
`approved` — not straight back to `publishing` — so the retry re-enters
through the same approval assertion. The original `approved_by`/`approved_at`
survive the round trip.

Two publish attempts on the same change are additionally serialised by a
Postgres advisory lock (`withSiteChangeLock`, keyed on
`site-change-publish:<changeId>`). If a client sees `409 publish_in_progress`,
another process (or a double-click) is already publishing that exact change —
this is not a bug, don't retry-loop it from code.

## Whether the site adapters can even run right now

`SITE_ADAPTER_ENABLED` (checked in `src/modules/site/providers/index.ts`,
`getSiteProvider()`) **defaults to `false`**. Until it's explicitly set to
`true` in the environment, every call to `getSiteProvider()` throws
`missing_configuration` — so today, in production, the git/WordPress/Shopify
adapters are unreachable by construction, not by accident. If someone reports
"staging a change does nothing" or "verify always fails," check this env var
before anything else.

When it is enabled, `SITE_PROVIDER` must be exactly `'platform'` (each site
uses its own real adapter, chosen by the site's registered `platform` column)
or `'mock'` (every platform uses the in-memory mock, for a lower environment).
Naming a specific platform (`SITE_PROVIDER=wordpress`) is rejected outright —
that would silently route git and Shopify sites through the WordPress
adapter too, which is exactly the cross-wiring the per-platform singleton Map
in `providers/index.ts` exists to prevent.

## The spend/cost guard

`src/services/seoCostGuard.ts` is a pure evaluator (`evaluateSeoCostGuard`) —
no I/O, fully unit-testable — that a caller feeds current usage into and gets
back an allow/block decision. It replaced a single global in-memory Serper
counter (`checkAndIncrementSeoSerperCap` in `seoWorkflowHealthService.ts`,
default cap 50/day) that could not survive going multi-tenant: one shared
counter let tenants starve each other and reset on every deploy/restart.
`checkAndIncrementSeoSerperCap` is still in the file but has **zero callers**
today — it's left in place only because a few comments elsewhere still
mention it; don't be misled into thinking it's still the active cap.

It can block for nine distinct reasons (`SeoCostGuardBlockCode`), not a
small fixed set — check `evaluation.blockCode` / `evaluation.blockReasons`
rather than assuming which one fired:

- `monthly_budget_exhausted` / `daily_budget_exhausted` — the cents-based spend caps
- `tenant_daily_serper_cap_exhausted` / `site_daily_serper_cap_exhausted`
- `tenant_daily_pagespeed_cap_exhausted`
- `tenant_daily_gsc_cap_exhausted`
- `site_daily_publish_cap_exhausted`
- `provider_config_missing` — an env-configured API key/credential is missing
- `site_paused` — the site itself is paused (billing, abuse, operator request)

The wrapper actually used at every Serper call site is
`guardedSerperCall` (`src/services/seoSerperGuard.ts`) — it fetches usage,
evaluates, and records spend around an opaque `run()`, and **never throws**:
any internal failure (a DB error evaluating the cap, `run()` itself throwing)
resolves to `onBlocked()`. This is deliberate fail-closed behaviour for
unattended cron paths, not a bug — a broken guard degrades to "this one call
was skipped," never to "spend without limit" and never to "take the whole
cron run down." The four call sites are `rankTrackingService.ts`,
`seoBacklinkService.ts`, `seoContentGapService.ts`, and
`competitorContentService.ts`.

Routes get a different entry point: `evaluateSeoSpend()` in the same file
pre-flights the guard without running anything, so a route handler
(`POST /api/seo/competitor-brief` is the current example) can hand the
operator a real HTTP status and block code instead of silently absorbing the
refusal the way a cron does.

Config comes from env, read once via `getSeoCostGuardConfig(env)`:
`SEO_MONTHLY_BUDGET_CENTS` (default 200000), `SEO_DAILY_BUDGET_CENTS`
(20000), `SEO_MAX_SERPER_CALLS_PER_TENANT_DAY` (50),
`SEO_MAX_SERPER_CALLS_PER_SITE_DAY` (20),
`SEO_MAX_PAGESPEED_CALLS_PER_TENANT_DAY` (100),
`SEO_MAX_GSC_CALLS_PER_TENANT_DAY` (200), `SEO_MAX_PUBLISHES_PER_SITE_DAY`
(3), plus per-provider cost-per-call envs (`SEO_SERPER_COST_CENTS`,
`SEO_PAGESPEED_COST_CENTS`, `SEO_LLM_COST_CENTS`). A plan's `limits` jsonb
(`subscriptions` → `plans.limits`) can override the per-site Serper and
publish caps without a code change.

## Site registry and tenant isolation

`src/services/seoSiteRegistry.ts` owns the `seo_sites` table — the
tenant-isolation boundary for the whole multi-site SEO module. **Every query
in that file binds `tenant_id`.** If you're adding a query against
`seo_sites` or any of the nine SEO tables with an FK to it
(`backlink_data`, `client_knowledge_base`, `client_pages`,
`keyword_rankings`, `seo_alerts_log`, `seo_content_calendar`,
`seo_opportunities`, `seo_weekly_metrics`, `site_health_metrics`) and it
doesn't bind `tenant_id`, that's a cross-tenant leak, not a style nit —
several were found and fixed exactly that way during the multi-tenant
migration (see the Phase 1–2 entries in `.ai/HANDOFF_LOG.md`).

Domains are normalised via `normaliseDomain()` in that file — lowercase,
trim, strip scheme (this also strips GSC's `sc-domain:` prefix), take
everything before the first `/`, strip a leading `www.`, strip a trailing
dot. If a domain doesn't normalise to something containing a `.`, it's
rejected as looking like a project name, not a domain (`invalid_domain`,
400). `adapter_config` on a site is validated to reject any key that looks
secret-shaped (`/pass|secret|token|key|credential|auth/i`) —
`adapter_config_secret_rejected`, 400 — because that column is plaintext
jsonb; real credentials belong in `tenant_integrations`, encrypted, pointed
at by `credential_provider`.

Sites are soft-deleted only (`archiveSeoSite` sets `status = 'archived'`) —
never a hard `DELETE`, because of those nine FK-linked tables.

## The cron schedule (all times IST unless noted; `src/worker.ts`, the SEO
## cron block starts around line 1197)

| Cron | Schedule | Service |
|---|---|---|
| SEO Drift Sweep | Daily 7:30 AM | `siteDriftService.runSeoDriftSweep` |
| SEO Alert Triggers | Daily 9:00 AM | `seoAlertService.runSeoAlertChecks` |
| SEO GSC Pull | Mondays 8:15 AM | `seoSearchConsoleService.runSeoSearchConsolePull` |
| SEO Content Decay | Mondays 9:00 AM | `seoContentDecayService.runContentDecayDetection` |
| Rank Tracking | Tuesdays 9:00 AM | `rankTrackingService.runRankChecks` |
| SEO Weekly Email | Thursdays 10:30 AM | `seoWeeklyEmailService.sendSEOWeeklyEmail` |
| SEO Backlink Monitor | Fridays 9:00 AM | `seoBacklinkService.runBacklinkCheck` |
| SEO Weekly Digest | Fridays 5:00 PM (gated off by default, `SEO_DIGEST_SLACK_ENABLED`) | `seoDigestService.sendWeeklyOpportunityDigest` |
| SEO Indexing Reminder | Fridays 12:30 PM | `seoIndexingQueueService.sendIndexingReminderDigest` |
| PageSpeed Monitor | Sundays 7:30 AM | `pagespeedService.runPageSpeedChecks` |
| Competitor Content Analysis | 1st & 15th of month, 9:00 AM | `competitorContentService.runCompetitorContentAnalysis` |
| SEO Content Gap Analysis | 15th of month, 10:00 AM | `seoContentGapService.runContentGapAnalysis` |

The drift sweep runs *before* the other daily/weekly crons deliberately —
rank tracking and content decay both reason about pages assumed to be live
and unchanged, so running drift detection first means they work against a
set whose drift is already known.

Every cron above (except SEO Indexing Reminder, which never had one) writes
a `seo_workflow_logs` row per tenant via `logSeoWorkflowRun` — that's what
the System Health page and `GET /api/seo-workflows/logs` read. If a cron ran
but nothing shows up in the logs, that's the write path to check.

**`GE SEO Pull` no longer exists** — it was replaced by `SEO GSC Pull` above.
The old job spawned `npx tsx scripts/ge-seo-pull.ts` as a subprocess and
wrote to Railway's ephemeral filesystem, so the data was routinely gone
before anyone read it, and it was hardcoded to one property. If you see `GE
SEO Pull` referenced anywhere (an old alert, an old dashboard bookmark),
it's stale — the script itself (`scripts/ge-seo-pull.ts`) is still present
and still works as a manual CLI (`npm run ge:seo`), but the cron doesn't
call it any more.

`isPaused('seo')` (checked at the top of most of these cron bodies) is the
kill switch — see `src/services/featureFlags.ts` if a cron appears
scheduled (it logs at boot either way) but never actually runs its body.

## System Health page

`src/services/systemHealthMonitor.ts`'s `checkSeo()` reports the SEO
subsystem card. Like the cron block, it does **not** call
`resolveDefaultSeoTenantId()` — it loops `getSeoTenantIds()` directly and
reports worst-of across tenants, naming the offending tenant, specifically
so a second tenant getting the `seo` feature can't pin the card to WARNING
forever. If `isPaused('seo')` is set, the card reports `PAUSED` and is
excluded from the overall health score average (not scored as unhealthy).

Per-cron overdue detection reads `CRON_WINDOWS` — a `Record<string, number>`
of cron name → expected-cadence-in-minutes — **in
`systemHealthMonitor.ts`, not `seoWorkflowHealthService.ts`** (easy to look
in the wrong file). The map key must match the human-readable name passed
as the first argument to `safeCron(...)`/`seoTenantSweep(...)` in
`worker.ts` exactly, or that cron silently never appears as tracked. A
cron that's genuinely not currently scheduled (paused via a comment block,
gated behind a flag with `false` default) is deliberately left out of
`CRON_WINDOWS` — the comment above the map says why: the page should show
what's actually running, and a registered-but-never-logged job doesn't
appear anyway (the query joins against `cron_job_logs`).

## The API surface

All four routers are mounted in `src/index.ts` behind both `requireAuth` and
`requireTenantFeature('seo')` — a tenant without the `seo` feature gets a 403
before reaching any handler:

- `/api/seo` (`src/routes/seo.ts`) — overview, per-client GSC data,
  keywords, alerts, workflow triggers, local-page generation,
  content-gap/backlink reads, content-brief generation,
  `/competitor-brief` (spend-guarded), content calendar CRUD.
- `/api/seo-workflows` (`src/routes/seoWorkflows.ts`) — workflow status,
  manual trigger, `/logs`, per-service stats (`content-decay-stats`,
  `rank-tracking-stats`, `backlinks-stats`, `digest-stats`), `/data-health`,
  `/trigger-all`, `/run/:service`.
- `/api/seo-sites` (`src/routes/seoSites.ts`) — CRUD over the `seo_sites`
  registry. List/get are open to any authenticated tenant member; create/
  update/delete are admin-only.
- `/api/seo-changes` (`src/routes/siteChanges.ts`) — the approval-queue
  lifecycle: list/get (any member), create/stage/verify (any member —
  neither touches a live site), approve/reject/publish/retry-publish/
  handoff-complete (admin-only, enforced independently of the
  `capabilities`-based UI gating), and `/preview` (any member, best-effort
  live "before" fetch that degrades to `null` rather than failing the
  request if the client's site is unreachable).

Every `site_changes` row returned by `siteChanges.ts` carries a
backend-computed `capabilities` object (`src/services/siteChangeCapabilities.ts`,
`toSiteChangeDTO`) — the admin UI reads that to decide which buttons to show
and must never re-derive it client-side. If the UI is offering an action the
API then 409/403s, the bug is almost always that some other code path built
the DTO by hand instead of going through `toSiteChangeDTO`.

Approve/reject/handoff-complete require a `version` field in the body —
optimistic concurrency (`site_changes.version`, bumped on every transition).
A stale `version` returns `409 version_conflict`: the UI's view of the row is
out of date, not a bug in the request.

Error mapping worth knowing when reading a response body: `SiteChangeError`
codes map to stable HTTP statuses in `SITE_CHANGE_ERROR_STATUS`
(`siteChanges.ts`) — `not_found` → 404, `invalid_transition`/
`version_conflict`/`site_not_ready` → 409, `invalid_input`/
`unsupported_platform` → 400. `SiteProviderError` codes map similarly;
`unauthorised_publish` is hardcoded to 403, never 500 — a 500 there would
look like a bug instead of the system correctly refusing an unapproved
publish. Any error that isn't one of these two typed classes is logged in
full server-side and returned to the client as a generic
`500 internal_error` — the raw provider/DB error text never reaches the
response body (see `safeLogText` / `redactSecrets.ts` for why: a vendor
error can echo back a signed URL or a header).

## Admin UI

`admin/src/pages/SEOPage.jsx` is the main SEO dashboard.
`admin/src/pages/SeoApprovalsPage.jsx` is the approval-queue UI on top of
`/api/seo-changes`, with three preview tiers chosen by the change's
`capabilities` (never by platform name) — `admin/src/components/seo/SeoChangeDiff.jsx`
renders the diff. `admin/src/components/seo/SiteRegistryPanel.jsx` is the
site CRUD UI on top of `/api/seo-sites`, including WordPress/Shopify
credential entry (which writes to `tenant_integrations`, not
`adapter_config`).

Nav visibility (`admin/src/components/navEntries.js`) gates SEO on
`tenantFeatures.seo !== false` — deliberately `!== false`, not `=== true`:
tenant features load asynchronously, and an unresolved fetch must default to
*showing* the nav item rather than hiding it.

## Drift sweep specifics

`src/services/siteDriftService.ts` — daily, per tenant, hash-compare-first:
the overwhelming majority of `(site, url)` pairs on any given day are
unchanged, and an unchanged content hash short-circuits to "nothing to do"
with a single string comparison, never calling the classifier
(`seoDriftClassifier.ts`) or writing a row. Candidate URLs per site come
from two sources — `client_pages` (inventory) and `site_changes` published
in the last 7 days (so the classifier's 48h attribution window has
something to match against) — capped at 200 URLs/site/sweep
(`MAX_URLS_PER_SITE`), with truncation logged loudly rather than silently
dropped. **A third planned source — top ~50 GSC URLs by impressions, to
catch pages the agency never touched at all — is not implemented.** No
per-page GSC table exists in this schema (`seo_weekly_metrics` is a
domain-level weekly rollup); building one is a schema change and was
explicitly deferred rather than invented ad hoc.

Alerts post to `SLACK_SEO_CHANNEL` (env override, defaults to a fixed
channel ID). "Alert-once" is enforced by the hash-compare-first mechanism
itself, not by a separate cooldown: a page that drifted once and hasn't
changed since compares equal to its own post-drift snapshot on every later
sweep and takes the cheap path — no new row, no repeat alert.
`seo_site_snapshots.alerted_at` records that the alert went out; it doesn't
gate a second one, because the hash comparison already prevents that.

A drift classified as `verified_live` against a matched, previously-approved
change calls `markSiteChangeVerifiedLive()` — this, not `published_at`, is
what starts the observation-window clock that outcome scoring reads. A
publish that silently failed to render must never be scored as if it
shipped.

## Useful commands

```bash
npm test                              # full suite — SEO tests are src/__tests__/seo*.test.ts
npx vitest run seoCronTenantSweep     # the "no cron calls resolveDefaultSeoTenantId" guard
npx vitest run seoTenantIsolation     # cross-tenant leak regression tests
npx vitest run siteChangeService      # the approval/publish state machine + "sole caller" check
npm run lint:tenant-scoping           # scripts/lint-tenant-scoping.ts — flags queries missing tenant_id
npm run ge:seo                        # scripts/ge-seo-pull.ts — manual one-off GSC/GA4 pull, NOT the cron
```

`GET /api/seo-workflows/data-health` and `GET /api/seo-workflows/logs` are
the fastest way to check "did the crons actually run and what did they see"
without touching Postgres directly.

## Things that look broken but usually aren't

- **A publish attempt getting refused.** See "the human-approval hard stop"
  above — check `status`/`approved_by`/`approved_at`/`verify_passed` on the
  change before assuming a bug.
- **Site adapters throwing `missing_configuration`.** Check
  `SITE_ADAPTER_ENABLED` first — it's `false` by default in every
  environment until explicitly turned on.
- **A tenant getting 403 on any `/api/seo*` route.** Check
  `requireTenantFeature('seo')` — that tenant's `tenantFeatures.seo` is
  probably `false`, which is the correct default for
  `reseller_pilot`/`client_basic`/`wizmatch_internal` plans.
- **SEO Weekly Email / SEO Weekly Digest silently skipping a non-GE
  tenant.** Both post to fixed GE destinations (a hardcoded Slack channel,
  a hardcoded email address) that aren't per-tenant yet —
  `seoNotificationTenantAllowed()` in `worker.ts` deliberately skips any
  tenant that isn't GE's own rather than delivering their data into GE's
  Slack/inbox. This is intentional, not a defect, until per-tenant
  recipients exist.
- **A Serper-backed cron logging "cap reached" for a paused site.** Check
  `evaluation.blockCode`, not just the log line — several call sites used
  to log a generic "SEO Serper daily cap reached" message for every block
  reason including `site_paused`; guessing a cause from a stale log message
  is worse than checking the actual code.
