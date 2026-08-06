/**
 * Importable, per-tenant GA4 pull — the GA4 half of the fix for
 * `scripts/ge-seo-pull.ts` + the 'GE SEO Pull' cron (src/worker.ts). See
 * `seoSearchConsoleService.ts`'s module doc for the shared backstory
 * (ephemeral filesystem writes, single-property hardcoding, no history).
 * This file fixes the GA4 side the same three ways: importable (no
 * subprocess), persisted to Postgres (no filesystem writes at all),
 * per-tenant/per-site via `seo_sites.ga4_property_id`
 * (src/services/seoSiteRegistry.ts).
 *
 * GA4 is deliberately a SEPARATE module from the GSC pull, not a shared
 * "pull both" entry point — in the legacy `scripts/ge-seo-pull.ts` a single
 * job pulled Search Console AND GA4 and wrote both at the end, so a GA4
 * failure (a different Google API, different quota, different failure
 * modes) discarded the Search Console data that had already been fetched
 * successfully. Two independent modules means a GA4 outage can never take
 * GSC data down with it, and vice versa.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE DATA GOES — and where it deliberately does NOT go.
 *
 * This lane may not add a migration (schema.ts and src/db/migrations/ are
 * guarded paths). `seo_weekly_metrics` already has `total_sessions` and
 * `ga4_sessions` columns (migration 0035's own comment calls the table "GSC/GA4
 * weekly rollups" — GA4 was always meant to land here, it just never had a
 * writer). Only GA4's session TOTAL has an honest destination:
 *
 *  - Total sessions (28-day window) → `seo_weekly_metrics.total_sessions` AND
 *    `.ga4_sessions` (both set to the same value — the table has two
 *    identically-typed/defaulted columns and nothing in this codebase
 *    distinguishes their meaning; `intelligenceDataCollector.ts` reads
 *    `ga4_sessions` specifically, so that one MUST be populated, and
 *    `total_sessions` is populated alongside it so a future reader that
 *    picks either name gets the same answer).
 *
 *  - Users, conversions, bounce rate, engagement rate, channel breakdown, AI
 *    referrer detection (all present in the legacy script's `pullGA4`) →
 *    NOWHERE. `seo_weekly_metrics` has no columns for any of them, and
 *    (matching `seoSearchConsoleService.ts`'s own reasoning for why it skips
 *    GSC's page-dimension query) this service does not call GA4 for them at
 *    all — not spending API/quota calls on data with nowhere to land. The
 *    legacy script's channel/AI-referrer breakdown is real product value,
 *    genuinely lost here, not an oversight:
 *      COLUMNS THAT WOULD FIX THIS (for whoever owns the next migration):
 *      `total_sessions`/`ga4_sessions` only carry the property-wide total.
 *      A `ga4_channel_sessions` table (id, tenant_id, site_id, week_start,
 *      channel, sessions) would let a future migration capture the
 *      per-channel breakdown and AI-referrer detection the legacy script
 *      already computes today, mirroring `keyword_rankings`' per-dimension
 *      shape.
 *
 *  - CROSS-PROVIDER ROW COLLISION (read this before changing the write
 *    below). `seoSearchConsoleService.ts`'s `persistGscTotals` does a fresh
 *    INSERT every run, never an upsert — fine when GSC is the only writer,
 *    because repeated GSC-only rows for one week are redundant but not
 *    misleading. It stops being fine the moment a SECOND provider
 *    (this file) also inserts a row for the same (tenant_id, site_id,
 *    week_start): three existing readers each assume ONE row per
 *    site+week and pick it with `ORDER BY week_start[_date] DESC LIMIT 1`
 *    or `weeks[0]` after grouping (`seoWeeklyEmailService.ts`,
 *    `seoDigestService.ts`'s trend query, `intelligenceDataCollector.ts`).
 *    A blind GA4 INSERT would create a second row with real sessions but
 *    zero clicks/impressions, and which of the two rows a reader's
 *    LIMIT-1/weeks[0] picks for "this week" is unspecified (no unique
 *    constraint, no ORDER BY tiebreaker) — whichever row loses that pick has
 *    its numbers silently read as zero. That is a real collision, not a
 *    hypothetical one, and overwriting the GSC row's clicks/impressions to
 *    "fix" it would be worse (destroying real GSC data instead of just
 *    duplicating a row).
 *
 *    This file's write (`persistGa4Sessions` below) avoids it WITHOUT an
 *    upsert-capable unique constraint (none exists — not something this
 *    lane may add) by doing an `UPDATE ... WHERE tenant_id/site_id/week_start
 *    RETURNING id` first, touching ONLY the two session columns, and only
 *    falling back to INSERT when zero rows matched. If a GSC row for this
 *    week already exists, this UPDATE folds sessions into it — no second row,
 *    no touched clicks/impressions/avg_position/avg_ctr.
 *
 *    THE FIX IS ONE-DIRECTIONAL — DISCLOSING RATHER THAN HIDING THIS: it only
 *    prevents the collision when GSC has already run for this (site, week)
 *    by the time GA4 runs. If GA4 runs FIRST in a given week (inserts a
 *    sessions-only row) and GSC runs SECOND, `persistGscTotals`'s own blind
 *    INSERT (unchanged — this lane may not edit that file) still creates a
 *    SECOND row rather than merging into this one, and the collision
 *    reappears in the opposite direction. Closing it fully needs
 *    `persistGscTotals` to adopt the same UPDATE-then-INSERT shape — flagging
 *    for whoever owns that file rather than editing it.
 *
 *    Also not closed: two runs landing in the exact same instant (this
 *    file's cron and a hypothetical concurrent re-run) could both see zero
 *    rows matched and both INSERT — the UPDATE-then-INSERT sequence isn't
 *    wrapped in `withSeoSiteLock` (seoCostGuardUsage.ts) the way some other
 *    guarded SEO writes are. Left out deliberately to keep this file's
 *    tests aligned with `seoSearchConsoleService.ts`'s own (which doesn't
 *    lock its writes either) rather than to claim the race can't happen;
 *    wrapping the merge in `withSeoSiteLock(tenantId, site.id, 'weekly-metrics')`
 *    would close it if two SEO crons ever end up scheduled to fire at the
 *    same instant.
 *
 * ---------------------------------------------------------------------------
 * COST GUARD — DELIBERATELY NOT WIRED, FLAGGING RATHER THAN FAKING IT.
 * `seoSearchConsoleService.ts` wraps its Google calls in `guardSeoSpend`
 * (seoCostGuardUsage.ts), estimating `gscCalls` on `SeoCostGuardEstimatedCalls`
 * so a tenant's daily GSC call count is tracked and capped. That type has NO
 * `ga4Calls` field (only `serperCalls`/`pagespeedCalls`/`llmCalls`/`gscCalls`/
 * `publishes` — see seoCostGuard.ts, not one of this lane's two files).
 * Reusing `gscCalls` to smuggle GA4 usage through would corrupt
 * `tenantDayGscCalls`/`maxGscCallsPerTenantDay` (a real GSC-specific cap) with
 * unrelated GA4 traffic, and would mislabel the `seo_api_usage` row's
 * `provider` as `'gsc'` for a call that never touched Search Console. Calling
 * `guardSeoSpend` with an all-zero estimate just to "match the pattern" would
 * add a DB round trip that gates nothing (no field, no cap, no recorded
 * usage) — ceremony, not protection. So this file calls the GA4 API directly,
 * uncounted by the cost guard. REAL GAP, for whoever owns `seoCostGuard.ts`:
 * add a `ga4Calls` field to `SeoCostGuardEstimatedCalls`/`SeoCostGuardUsage`
 * and a `tenant_day_ga4_calls` sum to `fetchSeoCostGuardUsage`'s query
 * (seoCostGuardUsage.ts), mirroring the existing `gsc` column exactly; then
 * this file's per-site loop can wrap its call in `guardSeoSpend` the same way
 * the GSC sibling does.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL SAFETY. GA4 uses the SAME OAuth client as the GSC pull
 * (GOOGLE_SEO_OAUTH_REFRESH_TOKEN / _CLIENT_ID / _CLIENT_SECRET — part of a
 * live secret-exposure incident, see AGENTS.md's credential-hygiene rules),
 * just with the `analytics.readonly` scope instead of `webmasters.readonly`.
 * Same rules as the GSC sibling, enforced identically here:
 *   - No env var value is ever interpolated into a thrown Error, a log line,
 *     or anything passed to `logger`. `redactCredentials()` strips any of the
 *     four secret values out of a raw error message before it is used
 *     anywhere.
 *   - Errors are never logged as the raw caught object (gaxios errors can
 *     carry the full request, including the Authorization header, on
 *     `.config`). Only `.message`, redacted, ever leaves this file.
 *   - `getGa4Auth()`'s own thrown message (env unconfigured) names variables,
 *     never values.
 * `redactCredentials`/the auth-building code is DUPLICATED from
 * `seoSearchConsoleService.ts` rather than imported — that file's helpers are
 * not exported (same reasoning that file gives for duplicating
 * `scripts/ge-seo-pull.ts`'s `getAuth()`: nothing here is meant to be
 * imported from, and this lane may not add exports to that file anyway).
 *
 * ---------------------------------------------------------------------------
 * GOOGLE API ERRORS. Classified into `Ga4ApiError.kind`, same taxonomy as the
 * GSC sibling's `GscApiError.kind`: 401/403 → 'auth' (refresh token/client
 * needs re-authorization), 429 → 'quota', 5xx → 'transient', anything else →
 * 'unknown'. See `classifyGa4Status`.
 *
 * ---------------------------------------------------------------------------
 * TESTABILITY. `runSeoAnalyticsPull` takes an optional injected GA4 client
 * (`deps.client`) that satisfies `SeoAnalyticsClient` — a minimal structural
 * subset of `google.analyticsdata({version:'v1beta'}).properties`. Tests
 * supply a fake; production falls back to building a real one from
 * `getGa4Auth()`. No test ever touches Google or needs real credentials.
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { listSeoSites, type SeoSite } from './seoSiteRegistry';

// ---------------------------------------------------------------------------
// Injected-client surface — see module doc's TESTABILITY note.
// ---------------------------------------------------------------------------
export interface SeoAnalyticsRow {
  metricValues?: Array<{ value?: string }>;
}

export interface SeoAnalyticsClient {
  properties: {
    runReport(args: {
      property: string;
      requestBody: {
        dateRanges: Array<{ startDate: string; endDate: string }>;
        metrics: Array<{ name: string }>;
      };
    }): Promise<{ data: { rows?: SeoAnalyticsRow[] } }>;
  };
}

export interface RunSeoAnalyticsPullDeps {
  client?: SeoAnalyticsClient;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Typed, classified Google API errors (never carry a credential value — see
// module doc's CREDENTIAL SAFETY note).
// ---------------------------------------------------------------------------
export type Ga4ErrorKind = 'auth' | 'quota' | 'transient' | 'unknown';

export class Ga4ApiError extends Error {
  readonly kind: Ga4ErrorKind;
  readonly status: number | null;
  constructor(kind: Ga4ErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'Ga4ApiError';
    this.kind = kind;
    this.status = status;
  }
}

// Strips any configured GA4/GSC secret value out of a string before it is
// ever logged or thrown. Same secret set as seoSearchConsoleService.ts's
// redactCredentials (same OAuth client) — duplicated, not imported, since
// that function isn't exported. Applied unconditionally, same reasoning as
// the sibling: cheap insurance against any error, not just auth-classified
// ones, echoing request details back.
function redactCredentials(message: string): string {
  const secrets = [
    process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN,
    process.env.GOOGLE_SEO_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_SEO_OAUTH_CLIENT_ID,
    process.env.GOOGLE_SA_KEY_JSON,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  let out = message;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

// googleapis/gaxios surface the HTTP status in different places depending on
// the failure path — check all three rather than assume one. Duplicated
// verbatim from seoSearchConsoleService.ts's extractStatus (not exported).
function extractStatus(err: unknown): number | null {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null | undefined;
  if (!e || typeof e !== 'object') return null;
  for (const candidate of [e.code, e.status, e.response?.status]) {
    const n = typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function classifyGa4Status(status: number | null): Ga4ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status !== null && status >= 500) return 'transient';
  return 'unknown';
}

function toGa4ApiError(err: unknown): Ga4ApiError {
  const status = extractStatus(err);
  const kind = classifyGa4Status(status);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const label = kind === 'auth'
    ? 'GA4 auth error — refresh token/client likely needs re-authorization'
    : kind === 'quota'
      ? 'GA4 quota exceeded — retry later'
      : kind === 'transient'
        ? 'GA4 transient error — Google-side issue, safe to retry'
        : 'GA4 error';
  const suffix = status !== null ? ` (HTTP ${status})` : '';
  return new Ga4ApiError(kind, status, `${label}${suffix}: ${redactCredentials(rawMessage)}`);
}

// ---------------------------------------------------------------------------
// Auth — mirrors seoSearchConsoleService.ts's getGscAuth() (same three-tier
// priority, same env var names — same OAuth client, different scope) so
// behaviour never silently diverges from the sibling. Duplicated rather than
// imported: that function isn't exported, and this lane may not add exports
// to that file.
// ---------------------------------------------------------------------------
function credsFilePath(): string {
  return process.env.GOOGLE_OAUTH_CREDS_FILE || path.join(os.homedir(), '.ge-seo', 'oauth_credentials.json');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- googleapis' auth union type is not worth fighting here; mirrors the sibling.
function getGa4Auth(): any {
  const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
  if (
    process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN
    && process.env.GOOGLE_SEO_OAUTH_CLIENT_ID
    && process.env.GOOGLE_SEO_OAUTH_CLIENT_SECRET
  ) {
    const oauth = new google.auth.OAuth2(process.env.GOOGLE_SEO_OAUTH_CLIENT_ID, process.env.GOOGLE_SEO_OAUTH_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN });
    return oauth;
  }
  // Local-dev convenience fallback only — the Railway worker container never
  // has this file, so in production this existsSync() check is a fast no-op
  // that falls through to the service-account branch below (or throws).
  const credsFile = credsFilePath();
  if (fs.existsSync(credsFile)) {
    const c = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    const oauth = new google.auth.OAuth2(c.client_id, c.client_secret);
    oauth.setCredentials({ refresh_token: c.refresh_token });
    return oauth;
  }
  if (process.env.GOOGLE_SA_KEY_PATH) return new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_SA_KEY_PATH, scopes });
  if (process.env.GOOGLE_SA_KEY_JSON) return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SA_KEY_JSON), scopes });
  throw new Error(
    '[seoAnalyticsService] No GA4 auth configured — set GOOGLE_SEO_OAUTH_REFRESH_TOKEN '
    + '(+ GOOGLE_SEO_OAUTH_CLIENT_ID/SECRET), or GOOGLE_SA_KEY_PATH/GOOGLE_SA_KEY_JSON',
  );
}

function buildDefaultGa4Client(): SeoAnalyticsClient {
  return google.analyticsdata({ version: 'v1beta', auth: getGa4Auth() }) as unknown as SeoAnalyticsClient;
}

// ---------------------------------------------------------------------------
// Date window — 28 trailing days ending yesterday, matching
// scripts/ge-seo-pull.ts's DAYS=28 and seoSearchConsoleService.ts's
// GSC_WINDOW_DAYS, so both providers describe the same trailing period for
// "this week's" snapshot. Explicit ISO dates (not the legacy script's
// relative `'28daysAgo'`/`'yesterday'` strings) for the same reason the GSC
// sibling uses them: deterministic against an injected `now` in tests — the
// GA4 Data API accepts either format.
// ---------------------------------------------------------------------------
const GA4_WINDOW_DAYS = 28;

/**
 * Monday of the week containing `now`, as an ISO date string. Copied
 * verbatim from seoSearchConsoleService.ts's (unexported) isoWeekStart —
 * MUST stay byte-identical, because this file's UPDATE-then-INSERT merge
 * (see module doc) only finds the GSC sibling's row when both files compute
 * the same Monday for the same `now`. `week_start` is a WEEK LABEL, not the
 * query window's start — see that file's own long comment on why (both
 * readers of this table break on the window start instead).
 */
function isoWeekStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // getUTCDay(): 0 = Sunday. Shift so Monday is the week's first day.
  const dayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOffset);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function ga4DateRange(now: Date): { startDate: string; endDate: string } {
  return { startDate: isoDaysAgo(GA4_WINDOW_DAYS, now), endDate: isoDaysAgo(1, now) };
}

// ---------------------------------------------------------------------------
// Raw GA4 call — classifies any failure into a Ga4ApiError before it
// escapes. Dimensionless (no `dimensions` in the request body) so GA4
// returns exactly one aggregate row for the whole property — mirrors
// queryGscOnce's totals call (no `dimensions` passed) in the GSC sibling.
// ---------------------------------------------------------------------------
async function queryGa4SessionsOnce(
  client: SeoAnalyticsClient,
  ga4PropertyId: string,
  range: { startDate: string; endDate: string },
): Promise<number> {
  try {
    const res = await client.properties.runReport({
      property: `properties/${ga4PropertyId}`,
      requestBody: {
        dateRanges: [range],
        metrics: [{ name: 'sessions' }],
      },
    });
    const raw = res.data.rows?.[0]?.metricValues?.[0]?.value;
    const sessions = raw != null ? Number(raw) : 0;
    return Number.isFinite(sessions) ? sessions : 0;
  } catch (err) {
    throw toGa4ApiError(err);
  }
}

// ---------------------------------------------------------------------------
// Persistence — see module doc's WHERE THE DATA GOES section for the
// UPDATE-then-INSERT merge and its one-directional-fix caveat.
// ---------------------------------------------------------------------------
async function persistGa4Sessions(params: {
  tenantId: string;
  siteId: string;
  domain: string;
  label: string;
  weekStart: string;
  sessions: number;
}): Promise<void> {
  // Touches ONLY the two session columns — never clicks/impressions/
  // avg_position/avg_ctr, so a GSC row already sitting at this (site, week)
  // keeps exactly the totals that pull wrote. Matches every row this WHERE
  // matches (if GSC's own no-upsert INSERT already duplicated rows for this
  // week, all of them get the same session count rather than one at random).
  const updated = await pool.query(
    `UPDATE seo_weekly_metrics
       SET total_sessions = $1, ga4_sessions = $1
     WHERE tenant_id = $2 AND site_id = $3 AND week_start = $4
     RETURNING id`,
    [params.sessions, params.tenantId, params.siteId, params.weekStart],
  );
  if ((updated.rowCount ?? 0) > 0) return;

  // No existing row for this (site, week) — GSC hasn't pulled this week (or
  // this site has no gscProperty at all). Insert a fresh row carrying only
  // the session columns; clicks/impressions/avg_position/avg_ctr fall back
  // to this table's own column defaults (0/0/null/null) until a GSC pull
  // lands — see module doc's "FIX IS ONE-DIRECTIONAL" note for why a later
  // GSC pull for this same week won't merge into this row today.
  await pool.query(
    `INSERT INTO seo_weekly_metrics
       (tenant_id, site_id, project_name, client_domain, client_name,
        week_start, week_start_date, total_sessions, ga4_sessions)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)`,
    [params.tenantId, params.siteId, params.label, params.domain, params.label, params.weekStart, params.sessions],
  );
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------
export async function runSeoAnalyticsPull(
  tenantId?: string,
  deps: RunSeoAnalyticsPullDeps = {},
): Promise<{ sites: number; rows: number; errors: number }> {
  const tid = tenantId ?? await resolveDefaultSeoTenantId();
  const now = deps.now ?? new Date();
  // buildDefaultGa4Client() throws (env names only, no values — see
  // getGa4Auth()) if NO auth method is configured at all. That's a
  // process-wide precondition, not a per-site one, so it's checked once here
  // rather than inside the per-site loop below — every site would fail
  // identically, and repeating the same failure per site would just be noise.
  const client = deps.client ?? buildDefaultGa4Client();

  const allSites = await listSeoSites(tid);
  const activeSites = allSites.filter((s: SeoSite) => s.status === 'active');
  const range = ga4DateRange(now);
  const weekStart = isoWeekStart(now);

  let sites = 0;
  let rows = 0;
  let errors = 0;

  for (const site of activeSites) {
    if (!site.ga4PropertyId) {
      logger.info(`[seoAnalyticsService] site ${site.id} (${site.domain}) has no ga4PropertyId configured — skipping`);
      continue;
    }
    sites += 1;

    try {
      const sessions = await queryGa4SessionsOnce(client, site.ga4PropertyId, range);
      await persistGa4Sessions({
        tenantId: tid,
        siteId: site.id,
        domain: site.domain,
        label: site.label,
        weekStart,
        sessions,
      });
      rows += 1;

      logger.info(`[seoAnalyticsService] ${site.domain} — pulled ${sessions} sessions (${range.startDate} to ${range.endDate})`);
    } catch (err) {
      errors += 1;
      // One site's failure must never abort the sweep — logged and counted,
      // then the loop continues to the next site.
      if (err instanceof Ga4ApiError) {
        logger.error(`[seoAnalyticsService] ${site.domain} — ${err.kind}: ${err.message}`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[seoAnalyticsService] ${site.domain} — unexpected failure: ${redactCredentials(message)}`);
      }
    }
  }

  return { sites, rows, errors };
}
