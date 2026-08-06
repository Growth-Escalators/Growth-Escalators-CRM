/**
 * The daily drift sweep: detects a client editing a live page behind the
 * agency's back, or a page silently going noindex/404/losing structured data.
 *
 * This is the differentiator the whole SEO product is sold on (see
 * seoDriftClassifier.ts's docblock) — an agency's recurring failure is not
 * "we didn't do the work", it's "we did the work, and something silently
 * undid it, and nobody noticed for three months." This file is the thing
 * that notices.
 *
 * DIVISION OF LABOUR (deliberately kept this way — don't re-derive any of it
 * here):
 *   - `seoDriftClassifier.ts` decides what a hash-changed page MEANS. Pure,
 *     no I/O. This file's only job is to feed it the right two snapshots.
 *   - `liveSnapshot.ts` fetches a page and extracts the comparable surface,
 *     SSRF-guarded on every redirect hop.
 *   - `siteChangeService.ts` owns the approval/publish state machine; this
 *     file only ever calls its read (`getMostRecentPublishedChange`-style
 *     query, done here directly since it's a plain read) and
 *     `markSiteChangeVerifiedLive`, never anything that mutates `status`.
 *
 * COST DISCIPLINE — the hash-compare-first rule. The overwhelming majority
 * of (site, url) pairs on any given day are unchanged. `classifySeoDrift` is
 * a nontrivial function to reason correctness about and is meant to run on
 * the rare hash-changed case only — see its own docblock. This file must
 * never call it on every URL "just to be safe"; that defeats the point.
 *
 * ALERT-ONCE. `seo_site_snapshots.alerted_at` is the persisted record of "we
 * already told someone", but the mechanism that actually keeps a stagnant
 * drift quiet is simpler and lives above that column: a new snapshot row (and
 * therefore a new classify+alert decision) is only ever written when the
 * page's content hash differs from the MOST RECENT snapshot on file. A page
 * that drifted once and has not changed since compares equal to its own
 * post-drift snapshot on every later sweep and takes the cheap "nothing to
 * do" path — no new row, no repeat alert. `alerted_at` records that the one
 * alert went out; it does not gate a second one that this mechanism already
 * prevents.
 *
 * NO GSC PER-URL TABLE TODAY. The brief for this sweep calls for a third URL
 * source — "top ~50 GSC URLs by impressions" — to catch pages the agency
 * never touched. No such table exists in this repo: `seo_weekly_metrics` is
 * a DOMAIN-level weekly rollup (`total_impressions` per client_domain per
 * week), not per-page. Inventing one is a schema change, out of scope for a
 * services-only lane. This source is skipped; `client_pages` (inventory) and
 * recently-published `site_changes` (need confirming) are what's used. See
 * the Phase 5 handoff for the follow-up.
 */
import { fetchLivePageSnapshot, type LivePageSnapshot, type SeoElements } from '../modules/site/liveSnapshot';
import {
  classifySeoDrift,
  shouldAlertOnDrift,
  type SeoDriftMatch,
  type SeoDriftResult,
} from './seoDriftClassifier';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { listSeoSites, type SeoSite } from './seoSiteRegistry';
import { markSiteChangeVerifiedLive } from './siteChangeService';
import { sendSlackMessage } from './slackService';
import { SLACK_SEO_CHANNEL } from '../config/constants';
import { pool } from '../db/index';
import logger from '../utils/logger';

export interface SeoDriftSweepSummary {
  sites: number;
  urls: number;
  drifts: number;
  alerts: number;
  errors: number;
}

export interface RunSeoDriftSweepOptions {
  /** Injected for tests — defaults to global fetch, mirroring FetchLiveSnapshotOptions.fetchImpl. */
  fetchImpl?: typeof fetch;
}

/**
 * Per-site cap on how many URLs one sweep will check. A silent cap reads as
 * "we checked everything" when it didn't, so truncation is logged loudly
 * (see the site loop below) rather than swallowed.
 */
const MAX_URLS_PER_SITE = 200;

/**
 * How far back to look for a "recently published, needs confirming" change
 * when building the candidate URL set. Deliberately wider than the
 * classifier's own DRIFT_ATTRIBUTION_WINDOW_MS (48h): this only decides which
 * URLs get CHECKED at all, not whether a match attributes — a sweep that
 * missed a day or two for an unrelated reason should still pick the URL back
 * up rather than losing it entirely.
 */
const RECENT_PUBLISHED_CHANGE_WINDOW_DAYS = 7;

const PROVIDER_NAME = 'seo-drift-sweep';

/**
 * Runs the drift sweep for one tenant. Optional-tenantId convention, matching
 * every other SEO service in this repo (seoAlertService.ts,
 * seoContentDecayService.ts, ...): falls back to the single default SEO
 * tenant when not supplied. This function is deliberately single-tenant per
 * call — the per-tenant fan-out with per-tenant failure isolation
 * (forEachSeoTenant, see seoTenantContext.ts) belongs in the cron wiring that
 * calls this once per tenant, exactly as it does for every other SEO cron
 * (see worker.ts's seoTenantSweep wrapper). This function still isolates
 * failures internally at the site and URL level within its own tenant — see
 * the loop below — which is the part of "one failure can't skip everyone
 * behind it" that is actually this file's responsibility.
 */
export async function runSeoDriftSweep(
  tenantId?: string,
  opts: RunSeoDriftSweepOptions = {},
): Promise<SeoDriftSweepSummary> {
  const tid = tenantId ?? await resolveDefaultSeoTenantId();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const summary: SeoDriftSweepSummary = { sites: 0, urls: 0, drifts: 0, alerts: 0, errors: 0 };

  const sites = (await listSeoSites(tid)).filter((s) => s.status === 'active');

  for (const site of sites) {
    summary.sites += 1;

    let urls: string[];
    try {
      urls = await collectCandidateUrls(tid, site.id);
    } catch (e) {
      summary.errors += 1;
      logger.error(`[seo-drift] failed to collect candidate URLs for site ${site.id} (${site.domain}): ${safeErrorText(e)}`);
      continue; // one site's failure must not abort the tenant
    }

    const capped = urls.slice(0, MAX_URLS_PER_SITE);
    if (urls.length > capped.length) {
      logger.warn(
        `[seo-drift] site ${site.id} (${site.domain}): ${urls.length} candidate URLs truncated to ${MAX_URLS_PER_SITE} — not every page was checked this sweep`,
      );
    }

    for (const url of capped) {
      summary.urls += 1;
      try {
        const outcome = await sweepOneUrl(tid, site, url, fetchImpl);
        if (outcome.drifted) summary.drifts += 1;
        if (outcome.alerted) summary.alerts += 1;
      } catch (e) {
        summary.errors += 1;
        logger.error(`[seo-drift] sweep failed for site ${site.id} url ${url}: ${safeErrorText(e)}`);
        // one URL's failure must not abort the site
      }
    }
  }

  logger.info(
    `[seo-drift] tenant ${tid}: ${summary.sites} site(s), ${summary.urls} url(s), ${summary.drifts} drift(s), ${summary.alerts} alert(s), ${summary.errors} error(s)`,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// Per-URL sweep
// ---------------------------------------------------------------------------

async function sweepOneUrl(
  tenantId: string,
  site: SeoSite,
  pageUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ drifted: boolean; alerted: boolean }> {
  const previous = await getLatestSnapshot(tenantId, site.id, pageUrl);

  const live = await fetchLivePageSnapshot(pageUrl, { providerName: PROVIDER_NAME, fetchImpl });

  // THE cheap path. A first sighting (no previous row) always proceeds — a
  // 404 is meaningful even with nothing to diff against, see
  // classifySeoDrift's own first branch. Once a previous snapshot exists, an
  // unchanged hash is the overwhelmingly common case and must stay a single
  // string comparison: no classify call, no write.
  if (previous !== null && previous.contentHash === live.contentHash) {
    return { drifted: false, alerted: false };
  }

  const matchedChangeRow = await getMostRecentPublishedChange(tenantId, site.id, pageUrl);
  const matchedChange: SeoDriftMatch | null = matchedChangeRow
    ? { changeId: matchedChangeRow.id, publishedAt: matchedChangeRow.publishedAt }
    : null;

  const result = classifySeoDrift({
    previous: previous?.elements ?? null,
    previousHttpStatus: previous?.httpStatus ?? null,
    current: live.elements,
    currentHttpStatus: live.httpStatus,
    matchedChange,
    now: new Date(),
  });

  // Written whether or not `result` is non-null: this row is what every
  // future sweep of this URL compares against, and a hash-changed-but-not-
  // meaningful case (classifySeoDrift returning null on a first sighting with
  // a 200) still needs a baseline on file.
  const snapshotId = await insertSnapshot(tenantId, site.id, pageUrl, live, result);

  if (result === null) return { drifted: false, alerted: false };

  if (result.kind === 'verified_live' && result.matchedChangeId) {
    // verified_live_at — not published_at — is what starts the
    // observation-window clock outcome scoring reads. Idempotent: a no-op if
    // already set (see markSiteChangeVerifiedLive's WHERE clause).
    await markSiteChangeVerifiedLive(tenantId, result.matchedChangeId, live.fetchedAt);
  }

  let alerted = false;
  if (shouldAlertOnDrift(result)) {
    const sent = await sendSlackMessage(SLACK_SEO_CHANNEL, formatDriftAlert(site, pageUrl, result));
    if (sent) {
      await markSnapshotAlerted(tenantId, snapshotId);
      alerted = true;
    }
    // A failed send is not retried from here — the next sweep will only
    // re-classify (and re-attempt the alert) if the page changes again. A
    // stuck "should have alerted but didn't" page fails visibly some other
    // way (the client asking why rankings stalled), which is the exact
    // failure mode this feature exists to catch in the first place.
  }

  return { drifted: true, alerted };
}

function formatDriftAlert(site: SeoSite, pageUrl: string, result: SeoDriftResult): string {
  // `result.summary` is documented by seoDriftClassifier.ts as safe for
  // Slack — one line, never page content. Never add page content here.
  const icon = result.severity === 'critical' ? '🚨' : '⚠️';
  return `${icon} SEO drift on *${site.label}* (${site.domain})\n${pageUrl}\n*${result.kind}* (${result.severity}) — ${result.summary}`;
}

// ---------------------------------------------------------------------------
// URL sourcing
// ---------------------------------------------------------------------------

/**
 * Builds the set of URLs to check for one site: the page inventory, plus our
 * own recently-published changes (so classifySeoDrift can attribute a change
 * to us inside its 48h window). A third source — top GSC URLs by impressions,
 * which would catch pages the agency never touched at all — is deliberately
 * skipped; see the file header for why.
 */
async function collectCandidateUrls(tenantId: string, siteId: string): Promise<string[]> {
  const urls = new Set<string>();

  const pagesQ = await pool.query(
    `SELECT DISTINCT page_url FROM client_pages
      WHERE tenant_id = $1 AND site_id = $2 AND page_url IS NOT NULL AND page_url <> ''`,
    [tenantId, siteId],
  );
  for (const row of pagesQ.rows as Array<{ page_url: string }>) urls.add(row.page_url);

  const changesQ = await pool.query(
    `SELECT DISTINCT page_url FROM site_changes
      WHERE tenant_id = $1 AND site_id = $2 AND status = 'published'
        AND page_url IS NOT NULL
        AND published_at >= NOW() - make_interval(days => $3)`,
    [tenantId, siteId, RECENT_PUBLISHED_CHANGE_WINDOW_DAYS],
  );
  for (const row of changesQ.rows as Array<{ page_url: string }>) urls.add(row.page_url);

  return [...urls];
}

// ---------------------------------------------------------------------------
// seo_site_snapshots reads/writes
// ---------------------------------------------------------------------------

interface LatestSnapshotRow {
  contentHash: string;
  httpStatus: number;
  elements: SeoElements;
}

async function getLatestSnapshot(tenantId: string, siteId: string, pageUrl: string): Promise<LatestSnapshotRow | null> {
  const { rows } = await pool.query(
    `SELECT content_hash, http_status, elements
       FROM seo_site_snapshots
      WHERE tenant_id = $1 AND site_id = $2 AND page_url = $3
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [tenantId, siteId, pageUrl],
  );
  const row = rows[0] as { content_hash: string; http_status: number; elements: SeoElements } | undefined;
  if (!row) return null;
  return {
    contentHash: row.content_hash,
    httpStatus: Number(row.http_status),
    elements: row.elements,
  };
}

async function insertSnapshot(
  tenantId: string,
  siteId: string,
  pageUrl: string,
  live: LivePageSnapshot,
  result: SeoDriftResult | null,
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO seo_site_snapshots
       (tenant_id, site_id, page_url, fetched_at, http_status, content_hash, elements,
        drift_kind, drift_severity, changed_fields, matched_change_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::text[], $11)
     RETURNING id`,
    [
      tenantId,
      siteId,
      pageUrl,
      live.fetchedAt,
      live.httpStatus,
      live.contentHash,
      JSON.stringify(live.elements),
      result?.kind ?? null,
      result?.severity ?? null,
      result?.changedFields ?? [],
      result?.matchedChangeId ?? null,
    ],
  );
  return (rows[0] as { id: string }).id;
}

async function markSnapshotAlerted(tenantId: string, snapshotId: string): Promise<void> {
  await pool.query(
    `UPDATE seo_site_snapshots SET alerted_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, snapshotId],
  );
}

// ---------------------------------------------------------------------------
// site_changes read (attribution match — NOT a status transition; the only
// site_changes write in this file is the call to markSiteChangeVerifiedLive
// above, which siteChangeService.ts owns)
// ---------------------------------------------------------------------------

interface MatchedChangeRow {
  id: string;
  publishedAt: Date;
}

async function getMostRecentPublishedChange(
  tenantId: string,
  siteId: string,
  pageUrl: string,
): Promise<MatchedChangeRow | null> {
  const { rows } = await pool.query(
    `SELECT id, published_at FROM site_changes
      WHERE tenant_id = $1 AND site_id = $2 AND page_url = $3
        AND status = 'published' AND published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT 1`,
    [tenantId, siteId, pageUrl],
  );
  const row = rows[0] as { id: string; published_at: Date } | undefined;
  if (!row) return null;
  return { id: row.id, publishedAt: new Date(row.published_at) };
}

/**
 * An error string safe to log — never the raw provider/DB error verbatim, on
 * the same reasoning as siteChangeService.ts's safeErrorText: truncated and
 * single-line, never page content or a credential.
 */
function safeErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500);
}
