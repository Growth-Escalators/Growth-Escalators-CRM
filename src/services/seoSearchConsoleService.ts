/**
 * Importable, per-tenant Google Search Console pull — the GSC half of the fix
 * for `scripts/ge-seo-pull.ts` + the 'GE SEO Pull' cron (src/worker.ts). That
 * cron spawns the script as an `npx tsx` subprocess and the script writes
 * `docs/seo/state/growthescalators.{json,md}` to the container's local disk.
 * On Railway that disk is ephemeral (wiped on every deploy/restart), so the
 * data never survives to be read, there is no history, and it is hardcoded to
 * one property (`growthescalators.com`) so a second tenant can never use it.
 * This file fixes all three for the GSC side: importable (no subprocess),
 * persisted to Postgres (no filesystem writes at all), per-tenant/per-site via
 * `seo_sites.gsc_property` (src/services/seoSiteRegistry.ts).
 *
 * A separate lane owns the GA4 half, deliberately as a separate module — so a
 * GA4 outage (a different Google API, different quota, different failure
 * modes) can never take GSC data down with it.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE DATA GOES — and where it deliberately does NOT go.
 *
 * This lane may not add a migration (schema.ts and src/db/migrations/ are
 * guarded paths owned by whoever is wiring the rest of this phase). So the
 * pull is split across exactly the columns that already exist and already
 * mean what GSC's response would say:
 *
 *  - Site-level totals (clicks, impressions, ctr, avg position) →
 *    `seo_weekly_metrics`. This table's own migration-era comment says it
 *    exists for "GSC/GA4 weekly rollups" and its columns
 *    (total_clicks/total_impressions/avg_position/avg_ctr/week_start) are an
 *    exact shape match. It already has zero writers anywhere in this
 *    codebase (grepped before writing this) despite three readers
 *    (seoWeeklyEmailService.ts, seoDigestService.ts, routes/seoWorkflows.ts)
 *    — this is that table's first writer. Every insert is a fresh row (no
 *    upsert), which is what turns a single-pull snapshot into real history —
 *    the second bug this whole effort exists to fix.
 *
 *  - Query-dimension rows (query text + position) → `keyword_rankings`, the
 *    same table rankTrackingService.ts (Serper-based rank checks) already
 *    writes to. `keyword` is genuinely the GSC query string, `current_position`
 *    is genuinely GSC's average position for it — a real fit, not a forced one.
 *    previous_position/position_change are computed the same way
 *    rankTrackingService.ts does (diff against this keyword's last recorded
 *    row), which the column names already imply.
 *
 *  - Page-dimension rows (page URL + its own clicks/impressions/position,
 *    independent of any one query) → `seo_page_metrics`. This table did not
 *    exist when this file's page-dimension gap was first documented — at the
 *    time, `keyword_rankings.keyword` (NOT NULL — a page URL is not a
 *    keyword) and `client_pages` (a page INVENTORY table, not a metrics time
 *    series, with no safe unique key to upsert against — duplicates exist in
 *    prod, see that table's own comment) were the only two candidates and
 *    neither was honest. A migration since added `seo_page_metrics`
 *    specifically to close this gap, keyed on
 *    (tenant_id, site_id, recorded_date, page_url) with a unique index this
 *    file's UPSERT relies on — a cron that fires twice for the same day
 *    updates one row rather than creating a second one. This is also the
 *    drift sweep's third URL source ("top ~50 GSC URLs by impressions") that
 *    `siteDriftService.ts` needed and previously had no table to read from;
 *    see that file's own header.
 *
 *      SAME GAP, SMALLER (still open): `keyword_rankings` has no
 *      clicks/impressions/ctr columns, so the query-dimension rows this file
 *      persists there only carry position, not the click/impression volume
 *      behind it. Adding those three columns would let a future migration
 *      capture full query-level performance, not just rank.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL SAFETY. The GSC OAuth refresh token + client secret
 * (GOOGLE_SEO_OAUTH_REFRESH_TOKEN / _CLIENT_ID / _CLIENT_SECRET) are part of a
 * live secret-exposure incident (see the credential-hygiene rules in
 * AGENTS.md) — treated with MORE care here, not less. Rules enforced in this
 * file:
 *   - No env var value is ever interpolated into a thrown Error, a log line,
 *     or anything passed to `logger`. `redactCredentials()` strips any of the
 *     three secret values out of a raw error message before it is used
 *     anywhere, on the theory that a defensive scrub costs nothing and a
 *     missed leak costs a lot.
 *   - Errors are never logged as the raw caught object (which — for gaxios,
 *     the HTTP client googleapis uses under the hood — can carry the full
 *     request, including the Authorization header, on `.config`). Only
 *     `.message`, redacted, ever leaves this file.
 *   - `getGscAuth()`'s own thrown message (env unconfigured) names variables,
 *     never values, matching `scripts/ge-seo-pull.ts`'s existing convention.
 *
 * ---------------------------------------------------------------------------
 * GOOGLE API ERRORS. Classified into `GscApiError.kind` so a caller (or this
 * file's own per-site loop) can tell "your refresh token is dead, someone
 * needs to re-auth" (401/403 → 'auth') apart from "you're over quota, this
 * will work again later" (429 → 'quota') apart from "Google had a bad moment,
 * retry" (5xx → 'transient'). See `classifyGscStatus`.
 *
 * ---------------------------------------------------------------------------
 * TESTABILITY. `runSeoSearchConsolePull` takes an optional injected GSC
 * client (`deps.client`) that satisfies `SeoSearchConsoleClient` — a minimal
 * structural subset of `google.searchconsole({version:'v1'}).searchanalytics`.
 * Tests supply a fake; production falls back to building a real one from
 * `getGscAuth()`. No test ever touches Google or needs real credentials.
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { listSeoSites, type SeoSite } from './seoSiteRegistry';
import { guardSeoSpend, SeoCostGuardBlockedError } from './seoCostGuardUsage';

// ---------------------------------------------------------------------------
// Injected-client surface — see module doc's TESTABILITY note.
// ---------------------------------------------------------------------------
export interface SeoSearchConsoleRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface SeoSearchConsoleClient {
  searchanalytics: {
    query(args: {
      siteUrl: string;
      requestBody: {
        startDate: string;
        endDate: string;
        dimensions?: string[];
        rowLimit?: number;
      };
    }): Promise<{ data: { rows?: SeoSearchConsoleRow[] } }>;
  };
}

export interface RunSeoSearchConsolePullDeps {
  client?: SeoSearchConsoleClient;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Typed, classified Google API errors (never carry a credential value — see
// module doc's CREDENTIAL SAFETY note).
// ---------------------------------------------------------------------------
export type GscErrorKind = 'auth' | 'quota' | 'transient' | 'unknown';

export class GscApiError extends Error {
  readonly kind: GscErrorKind;
  readonly status: number | null;
  constructor(kind: GscErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'GscApiError';
    this.kind = kind;
    this.status = status;
  }
}

// Strips any configured GSC secret value out of a string before it is ever
// logged or thrown. Applied unconditionally (not just on auth-classified
// errors) — a transient/unknown error could still, in principle, echo back
// request details, and a blanket scrub is cheap insurance either way.
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
// the failure path (a thrown GaxiosError has `.status`/`.code`; some errors
// only carry it on `.response.status`) — check all three rather than assume one.
function extractStatus(err: unknown): number | null {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null | undefined;
  if (!e || typeof e !== 'object') return null;
  for (const candidate of [e.code, e.status, e.response?.status]) {
    const n = typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function classifyGscStatus(status: number | null): GscErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status !== null && status >= 500) return 'transient';
  return 'unknown';
}

function toGscApiError(err: unknown): GscApiError {
  const status = extractStatus(err);
  const kind = classifyGscStatus(status);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const label = kind === 'auth'
    ? 'GSC auth error — refresh token/client likely needs re-authorization'
    : kind === 'quota'
      ? 'GSC quota exceeded — retry later'
      : kind === 'transient'
        ? 'GSC transient error — Google-side issue, safe to retry'
        : 'GSC error';
  const suffix = status !== null ? ` (HTTP ${status})` : '';
  return new GscApiError(kind, status, `${label}${suffix}: ${redactCredentials(rawMessage)}`);
}

// ---------------------------------------------------------------------------
// Auth — mirrors scripts/ge-seo-pull.ts's getAuth() (same three-tier
// priority, same env var names) so behaviour never silently diverges from
// the tool this replaces. Duplicated rather than imported: that file is a
// standalone CLI script, not a module meant to be imported from.
// ---------------------------------------------------------------------------
function credsFilePath(): string {
  return process.env.GOOGLE_OAUTH_CREDS_FILE || path.join(os.homedir(), '.ge-seo', 'oauth_credentials.json');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- googleapis' auth union type is not worth fighting here; mirrors the untyped original.
function getGscAuth(): any {
  const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
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
    '[seoSearchConsoleService] No GSC auth configured — set GOOGLE_SEO_OAUTH_REFRESH_TOKEN '
    + '(+ GOOGLE_SEO_OAUTH_CLIENT_ID/SECRET), or GOOGLE_SA_KEY_PATH/GOOGLE_SA_KEY_JSON',
  );
}

function buildDefaultGscClient(): SeoSearchConsoleClient {
  return google.searchconsole({ version: 'v1', auth: getGscAuth() }) as unknown as SeoSearchConsoleClient;
}

// ---------------------------------------------------------------------------
// Date window — 28 trailing days ending yesterday, matching
// scripts/ge-seo-pull.ts's DAYS=28 (GSC data lags a couple of days; "yesterday"
// is the freshest reliable endpoint). `isoDaysAgo` is copied verbatim from
// that script (local-time date math, then sliced to a UTC-format date
// string) rather than "fixed" to explicit UTC arithmetic, so this service's
// date boundaries never silently diverge from the tool it replaces. On a
// UTC-clocked container (Railway) the local/UTC distinction is a no-op anyway.
// ---------------------------------------------------------------------------
const GSC_WINDOW_DAYS = 28;

/**
 * Monday of the week containing `now`, as an ISO date string.
 *
 * `week_start` is a WEEK LABEL, not the query window's start — see the call
 * site for why conflating the two silently empties both readers of this table.
 */
function isoWeekStart(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // getUTCDay(): 0 = Sunday. Shift so Monday is the week's first day.
  const dayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOffset);
  return d.toISOString().slice(0, 10);
}
const GSC_QUERY_ROW_LIMIT = 25; // matches the script's topQueries rowLimit
const GSC_PAGE_ROW_LIMIT = 50; // "top ~50 GSC URLs by impressions" — see siteDriftService.ts's third URL source

// GSC returns page URLs verbatim, with no length cap of its own. This file's
// unique index (tenant_id, site_id, recorded_date, page_url) has a real
// btree row-size limit, and one absurd URL hitting it would abort the whole
// site's page-row batch — so a row this long is skipped and logged instead
// of attempted.
const GSC_PAGE_URL_MAX_LENGTH = 2000;

function isoDaysAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function gscDateRange(now: Date): { startDate: string; endDate: string } {
  return { startDate: isoDaysAgo(GSC_WINDOW_DAYS, now), endDate: isoDaysAgo(1, now) };
}

// ---------------------------------------------------------------------------
// Raw GSC call — classifies any failure into a GscApiError before it escapes.
// ---------------------------------------------------------------------------
async function queryGscOnce(
  client: SeoSearchConsoleClient,
  gscProperty: string,
  range: { startDate: string; endDate: string },
  dimensions: string[] | undefined,
  rowLimit: number | undefined,
): Promise<SeoSearchConsoleRow[]> {
  try {
    const res = await client.searchanalytics.query({
      siteUrl: gscProperty,
      requestBody: {
        ...range,
        ...(dimensions ? { dimensions } : {}),
        ...(rowLimit ? { rowLimit } : {}),
      },
    });
    return res.data.rows ?? [];
  } catch (err) {
    throw toGscApiError(err);
  }
}

// ---------------------------------------------------------------------------
// Persistence — see module doc's WHERE THE DATA GOES section for why these
// two tables and not the others.
// ---------------------------------------------------------------------------
async function getPreviousGscPosition(
  tenantId: string,
  siteId: string,
  keyword: string,
  beforeDate: string,
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT current_position FROM keyword_rankings
     WHERE tenant_id = $1 AND site_id = $2 AND keyword = $3 AND recorded_date < $4
     ORDER BY recorded_date DESC LIMIT 1`,
    [tenantId, siteId, keyword, beforeDate],
  );
  const pos = (rows[0] as { current_position?: string } | undefined)?.current_position;
  return pos != null ? Number(pos) : null;
}

async function persistGscTotals(params: {
  tenantId: string;
  siteId: string;
  domain: string;
  label: string;
  weekStart: string;
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number | null;
  avgCtr: number | null;
}): Promise<void> {
  // UPDATE-then-INSERT, not a blind INSERT.
  //
  // GSC and GA4 are separate crons writing the same (site, week) row of
  // seo_weekly_metrics — GSC owns clicks/impressions/position/ctr, GA4 owns
  // sessions. A blind INSERT from each produces TWO rows for the same week,
  // and all three readers of this table pick one via
  // `ORDER BY week_start DESC LIMIT 1`. Whichever row loses that pick reads as
  // zeros: a week with real traffic reported as no traffic.
  //
  // seoAnalyticsService.ts already merges this direction (GA4 folding into an
  // existing GSC row). This is the other half — without it the merge only
  // worked when GSC happened to run first, which is true of the current
  // schedule and would stop being true the moment either cron moved.
  //
  // Only GSC's own columns are touched here; sessions are never overwritten,
  // exactly as GA4 never overwrites these.
  const updated = await pool.query(
    `UPDATE seo_weekly_metrics
        SET total_clicks = $4, total_impressions = $5, avg_position = $6, avg_ctr = $7,
            project_name = $8, client_domain = $9, client_name = $8
      WHERE tenant_id = $1 AND site_id = $2 AND week_start = $3
      RETURNING id`,
    [
      params.tenantId,
      params.siteId,
      params.weekStart,
      params.totalClicks,
      params.totalImpressions,
      params.avgPosition,
      params.avgCtr,
      params.label,
      params.domain,
    ],
  );
  if ((updated.rowCount ?? 0) > 0) return;

  await pool.query(
    `INSERT INTO seo_weekly_metrics
       (tenant_id, site_id, project_name, client_domain, client_name,
        week_start, week_start_date, total_clicks, total_impressions, avg_position, avg_ctr)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10)`,
    [
      params.tenantId,
      params.siteId,
      params.label,
      params.domain,
      params.label,
      params.weekStart,
      params.totalClicks,
      params.totalImpressions,
      params.avgPosition,
      params.avgCtr,
    ],
  );
}

async function persistGscKeywordRow(params: {
  tenantId: string;
  siteId: string;
  domain: string;
  label: string;
  keyword: string;
  currentPosition: number | null;
  recordedDate: string;
}): Promise<void> {
  // Mirrors rankTrackingService.ts's previous/positionChange convention
  // (previousPosition - currentPosition, so positive = improved rank) — but
  // scoped by site_id rather than a domain-string match, which this call has
  // on hand directly and is the more precise key (see seoSiteRegistry.ts's
  // module doc on why site_id exists at all).
  const previousPosition = await getPreviousGscPosition(params.tenantId, params.siteId, params.keyword, params.recordedDate);
  const positionChange = (previousPosition != null && params.currentPosition != null)
    ? previousPosition - params.currentPosition
    : null;

  await pool.query(
    `INSERT INTO keyword_rankings
       (tenant_id, site_id, project_name, client_domain, keyword,
        current_position, previous_position, position_change, recorded_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      params.tenantId,
      params.siteId,
      params.label,
      params.domain,
      params.keyword,
      params.currentPosition,
      previousPosition,
      positionChange,
      params.recordedDate,
    ],
  );
}

async function persistGscPageRow(params: {
  tenantId: string;
  siteId: string;
  pageUrl: string;
  recordedDate: string;
  clicks: number;
  impressions: number;
  avgPosition: number | null;
  avgCtr: number | null;
}): Promise<void> {
  // INSERT ... ON CONFLICT DO UPDATE, not a blind INSERT — the cron can fire
  // twice for the same day (retry, manual kick) and must not double-count or
  // leave two competing rows for one (site, url, day). The conflict target
  // matches seo_page_metrics_site_url_date_unique exactly (see schema.ts).
  await pool.query(
    `INSERT INTO seo_page_metrics
       (tenant_id, site_id, page_url, recorded_date, clicks, impressions, avg_position, avg_ctr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, site_id, recorded_date, page_url)
     DO UPDATE SET clicks = EXCLUDED.clicks,
                   impressions = EXCLUDED.impressions,
                   avg_position = EXCLUDED.avg_position,
                   avg_ctr = EXCLUDED.avg_ctr`,
    [
      params.tenantId,
      params.siteId,
      params.pageUrl,
      params.recordedDate,
      params.clicks,
      params.impressions,
      params.avgPosition,
      params.avgCtr,
    ],
  );
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------
export async function runSeoSearchConsolePull(
  tenantId?: string,
  deps: RunSeoSearchConsolePullDeps = {},
): Promise<{ sites: number; rows: number; errors: number }> {
  const tid = tenantId ?? await resolveDefaultSeoTenantId();
  const now = deps.now ?? new Date();
  // buildDefaultGscClient() throws (env names only, no values — see
  // getGscAuth()) if NO auth method is configured at all. That's a
  // process-wide precondition, not a per-site one, so it's checked once here
  // rather than inside the per-site loop below — every site would fail
  // identically, and repeating the same failure per site would just be noise.
  const client = deps.client ?? buildDefaultGscClient();

  const allSites = await listSeoSites(tid);
  const activeSites = allSites.filter((s: SeoSite) => s.status === 'active');
  const range = gscDateRange(now);

  let sites = 0;
  let rows = 0;
  let errors = 0;

  for (const site of activeSites) {
    if (!site.gscProperty) {
      logger.info(`[seoSearchConsoleService] site ${site.id} (${site.domain}) has no gscProperty configured — skipping`);
      continue;
    }
    sites += 1;

    try {
      // guardSeoSpend records usage AFTER run() succeeds (see
      // seoCostGuardUsage.ts's own doc) — correct here because run() below
      // does ONLY the three GSC calls (no DB writes), so "run() succeeded"
      // and "3 GSC calls actually happened" are the same event. The DB
      // persistence happens afterwards, outside the guard, so a DB failure
      // can't cause an under-recorded GSC quota (the calls genuinely
      // happened whether or not the subsequent writes succeed).
      //
      // The page-dimension call is deliberately wrapped in its OWN try/catch
      // inside run() rather than left to throw like the other two: a failure
      // there must not discard the totals/query data that already succeeded
      // above it in the same closure, and must not make guardSeoSpend skip
      // recording that 3 calls were actually attempted (see pageQueryError
      // handling below).
      //
      // providerEnv.missing is always [] here — same reasoning
      // seoSerperGuard.ts documents for its own call sites: the one
      // process-wide precondition (no auth configured at all) is already
      // checked once above via buildDefaultGscClient(), so by the time any
      // site reaches this guard, auth is known to be present.
      const { result } = await guardSeoSpend({
        tenantId: tid,
        siteId: site.id,
        operation: 'gsc_pull',
        // ga4Calls: 0 — this file never calls GA4, but SeoCostGuardEstimatedCalls
        // gained a required ga4Calls field alongside a sibling lane's GA4 guard
        // wiring (see seoAnalyticsService.ts's own "COST GUARD" doc note); every
        // estimate literal needs the field regardless of whether it ever pulls
        // GA4 itself.
        estimate: { serperCalls: 0, pagespeedCalls: 0, llmCalls: 0, gscCalls: 3, ga4Calls: 0, publishes: 0 },
        providerEnv: { missing: [] },
        now,
        run: async () => {
          const totalsRows = await queryGscOnce(client, site.gscProperty as string, range, undefined, undefined);
          const queryRows = await queryGscOnce(client, site.gscProperty as string, range, ['query'], GSC_QUERY_ROW_LIMIT);
          let pageRows: SeoSearchConsoleRow[] = [];
          let pageQueryError: unknown = null;
          try {
            pageRows = await queryGscOnce(client, site.gscProperty as string, range, ['page'], GSC_PAGE_ROW_LIMIT);
          } catch (err) {
            pageQueryError = err;
          }
          return { totalsRows, queryRows, pageRows, pageQueryError };
        },
      });

      const totals = result.totalsRows[0];
      await persistGscTotals({
        tenantId: tid,
        siteId: site.id,
        domain: site.domain,
        label: site.label,
        // NOT range.startDate. The GSC query window is 28 days (a longer window
        // gives a stabler average position), but `week_start` labels WHICH WEEK
        // this row reports — and both readers depend on that reading:
        //
        //   seoWeeklyEmailService: WHERE week_start >= CURRENT_DATE - 14
        //     — a 28-day-ago window start is never inside 14 days, so every
        //       row would be filtered out and the weekly email would stay
        //       empty even though the table finally has a writer.
        //   seoDigestService: JOINs last_week.week_start_date =
        //     this_week.week_start_date - INTERVAL '7 days'
        //     — window starts drift by however long the gap between runs was,
        //       so a single missed run silently breaks the week-over-week
        //       comparison until the next one.
        //
        // Anchoring to the Monday of the run's own week fixes both: rows are
        // exactly 7 days apart regardless of when the cron actually fired, and
        // they land inside the email's recency filter.
        // `now`, not `new Date()` — this function threads an injectable clock
        // through everything else, and a hardcoded real clock here made this one
        // field non-deterministic in any test that injects a different date.
        weekStart: isoWeekStart(now),
        totalClicks: Math.round(totals?.clicks ?? 0),
        totalImpressions: Math.round(totals?.impressions ?? 0),
        avgPosition: totals?.position ?? null,
        avgCtr: totals?.ctr ?? null,
      });
      rows += 1;

      for (const row of result.queryRows) {
        const keyword = row.keys?.[0];
        if (!keyword) continue; // defensive — GSC's own contract is keys[0] present for a dimensioned row
        await persistGscKeywordRow({
          tenantId: tid,
          siteId: site.id,
          domain: site.domain,
          label: site.label,
          keyword,
          currentPosition: row.position ?? null,
          recordedDate: range.endDate,
        });
        rows += 1;
      }

      // Page-dimension rows → seo_page_metrics (see module doc's WHERE THE
      // DATA GOES section). A failure on the page call above is reported
      // here, not thrown — the totals + query rows already persisted above
      // must survive it, exactly as one site's failure must never abort the
      // sweep for the next site.
      let pageSummary: string;
      if (result.pageQueryError) {
        errors += 1;
        const pErr = result.pageQueryError;
        if (pErr instanceof GscApiError) {
          logger.error(`[seoSearchConsoleService] ${site.domain} — page-dimension pull failed (${pErr.kind}): ${pErr.message}`);
        } else {
          const message = pErr instanceof Error ? pErr.message : String(pErr);
          logger.error(`[seoSearchConsoleService] ${site.domain} — page-dimension pull unexpected failure: ${redactCredentials(message)}`);
        }
        pageSummary = 'page pull failed';
      } else {
        let pageRowsPersisted = 0;
        let pageRowsSkipped = 0;
        for (const row of result.pageRows) {
          const pageUrl = row.keys?.[0];
          if (!pageUrl) continue; // defensive — GSC's own contract is keys[0] present for a dimensioned row
          if (pageUrl.length > GSC_PAGE_URL_MAX_LENGTH) {
            // Logged, not silently dropped — the unique index this UPSERT
            // relies on has a real btree row-size limit, and one absurd URL
            // hitting it would otherwise abort the whole site's page batch.
            pageRowsSkipped += 1;
            logger.warn(
              `[seoSearchConsoleService] ${site.domain} — skipping page_url over ${GSC_PAGE_URL_MAX_LENGTH} chars (length ${pageUrl.length}): ${pageUrl.slice(0, 200)}…`,
            );
            continue;
          }
          await persistGscPageRow({
            tenantId: tid,
            siteId: site.id,
            pageUrl,
            recordedDate: range.endDate,
            clicks: Math.round(row.clicks ?? 0),
            impressions: Math.round(row.impressions ?? 0),
            avgPosition: row.position ?? null,
            avgCtr: row.ctr ?? null,
          });
          rows += 1;
          pageRowsPersisted += 1;
        }
        pageSummary = `${pageRowsPersisted} pages${pageRowsSkipped > 0 ? ` (${pageRowsSkipped} skipped — over ${GSC_PAGE_URL_MAX_LENGTH} chars)` : ''}`;
      }

      logger.info(`[seoSearchConsoleService] ${site.domain} — pulled totals + ${result.queryRows.length} queries + ${pageSummary} (${range.startDate} to ${range.endDate})`);
    } catch (err) {
      errors += 1;
      // One site's failure must never abort the sweep — logged and counted,
      // then the loop continues to the next site.
      if (err instanceof SeoCostGuardBlockedError) {
        logger.warn(`[seoSearchConsoleService] ${site.domain} — blocked by SEO cost guard: ${err.evaluation.blockCode}`);
      } else if (err instanceof GscApiError) {
        logger.error(`[seoSearchConsoleService] ${site.domain} — ${err.kind}: ${err.message}`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[seoSearchConsoleService] ${site.domain} — unexpected failure: ${redactCredentials(message)}`);
      }
    }
  }

  return { sites, rows, errors };
}
