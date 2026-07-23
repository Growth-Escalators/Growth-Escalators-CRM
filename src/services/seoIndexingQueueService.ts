/**
 * SEO Indexing Queue — human-in-the-loop "Request Indexing" tracker.
 *
 * Context: Google's real Indexing API is restricted to Job Posting / Livestream
 * structured data — using it for ordinary pages violates Google's terms and can
 * get a property penalized. The only way to request indexing on a normal page is
 * the GSC web UI's URL Inspection tool ("Request Indexing"), which is a manual,
 * one-shot-per-URL click with a small daily quota (~10-12/day). There is nothing
 * here to automate away.
 *
 * So this module does NOT call any indexing API and does NOT drive a browser.
 * It only:
 *   1. Maintains a queue of candidate URLs (this table), populated by diffing the
 *      live sitemap against pages that already show up in GSC "top pages" (a proxy
 *      for "already indexed and getting impressions").
 *   2. Reminds Jatin on a weekly schedule (see the "SEO Indexing Reminder" cron in
 *      worker.ts) with a short, quota-respecting batch to go click through by hand.
 *   3. Lets him mark items requested/done via scripts/seo-indexing-queue.ts once
 *      he's actually done the clicking — or auto-marks them done the next time the
 *      queue is synced, once the URL starts showing up in GSC top pages.
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { SEO_INDEXING_SITEMAP_URL, SEO_INDEXING_WEEKLY_LIMIT } from '../config/constants';

// ---------------------------------------------------------------------------
// Bootstrap (ensure-hook table — see .claude/skills/ge-add-ensure-table)
// ---------------------------------------------------------------------------
export async function ensureSeoIndexingQueueTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_indexing_queue (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         uuid NOT NULL,
      url               text NOT NULL,
      reason            text NOT NULL,
      status            text NOT NULL DEFAULT 'pending',
      date_added        timestamp DEFAULT NOW(),
      last_reminded_at  timestamp,
      requested_at      timestamp,
      done_at           timestamp,
      created_at        timestamp DEFAULT NOW(),
      updated_at        timestamp DEFAULT NOW(),
      UNIQUE (tenant_id, url)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS seo_indexing_queue_tenant_idx ON seo_indexing_queue (tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS seo_indexing_queue_status_idx ON seo_indexing_queue (status)`);
  logger.info('[seo-indexing-queue] seo_indexing_queue table ready');
}

// ---------------------------------------------------------------------------
// URL normalization — so http/https, www/non-www, and trailing slash don't
// cause the same page to be treated as two different URLs when cross-
// referencing the sitemap against GSC's top-pages list.
// ---------------------------------------------------------------------------
export function normalizeUrlForCompare(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    let pathPart = u.pathname.replace(/\/+$/, ''); // strip trailing slash(es)
    return `${host}${pathPart}`.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Sitemap fetch — plain regex extraction, no XML dependency needed for a flat
// <urlset><url><loc>...</loc></url></urlset> sitemap (verified against the
// live growthescalators.com/sitemap.xml, which is a single flat file, not a
// sitemap index of sub-sitemaps).
// ---------------------------------------------------------------------------
export async function fetchSitemapUrls(sitemapUrl: string = SEO_INDEXING_SITEMAP_URL): Promise<string[]> {
  const res = await axios.get<string>(sitemapUrl, {
    timeout: 15000,
    responseType: 'text',
    headers: { 'User-Agent': 'GE-SEO-Indexing-Queue/1.0 (+https://growthescalators.com)' },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const xml = res.data;
  const urls: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const decoded = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    urls.push(decoded);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// "Already indexed" proxy — pages showing clicks/impressions in the last GSC
// pull (docs/seo/state/growthescalators.json, written by `npm run ge:seo`) are
// presumed already indexed. Anything in the sitemap that's NOT in that set is
// a candidate for the queue.
// ---------------------------------------------------------------------------
interface TopPagesState {
  urls: Set<string>;
  pulledAt: string | null;
}

const STATE_FILE_PATH = path.resolve(__dirname, '../../docs/seo/state/growthescalators.json');

export function loadTopPagesFromState(statePath: string = STATE_FILE_PATH): TopPagesState {
  try {
    if (!fs.existsSync(statePath)) {
      logger.warn(`[seo-indexing-queue] no state file at ${statePath} — run \`npm run ge:seo\` first. Skipping top-pages cross-reference this sync.`);
      return { urls: new Set(), pulledAt: null };
    }
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      pulledAt?: string;
      gsc?: { topPages?: Array<{ keys?: string[] }> };
    };
    const topPages = raw.gsc?.topPages ?? [];
    const urls = new Set<string>();
    for (const row of topPages) {
      const u = row.keys?.[0];
      if (u) urls.add(normalizeUrlForCompare(u));
    }
    return { urls, pulledAt: raw.pulledAt ?? null };
  } catch (e) {
    logger.warn(`[seo-indexing-queue] failed to read/parse state file: ${e instanceof Error ? e.message : String(e)}`);
    return { urls: new Set(), pulledAt: null };
  }
}

// ---------------------------------------------------------------------------
// Sync — the "populate the queue from something real" step. Idempotent: safe
// to run every week (or on demand). Never removes rows, only:
//   - inserts a new 'pending' row for a sitemap URL that isn't in top-pages and
//     isn't already tracked
//   - auto-flips an existing pending/requested row to 'done' once its URL shows
//     up in top-pages (i.e., it's now getting impressions — clearly indexed)
// ---------------------------------------------------------------------------
export interface SyncResult {
  totalSitemapUrls: number;
  inserted: number;
  autoCompleted: number;
  hasTopPagesData: boolean;
}

export async function syncIndexingQueueFromSitemap(
  sitemapUrl: string = SEO_INDEXING_SITEMAP_URL,
  statePath: string = STATE_FILE_PATH,
): Promise<SyncResult> {
  const tenantId = await resolveDefaultSeoTenantId();
  const sitemapUrls = await fetchSitemapUrls(sitemapUrl);
  const { urls: topPagesUrls, pulledAt } = loadTopPagesFromState(statePath);

  const existing = await pool.query(
    `SELECT id, url, status FROM seo_indexing_queue WHERE tenant_id = $1`,
    [tenantId],
  );
  const existingByNorm = new Map<string, { id: string; url: string; status: string }>();
  for (const row of existing.rows as Array<{ id: string; url: string; status: string }>) {
    existingByNorm.set(normalizeUrlForCompare(row.url), row);
  }

  let inserted = 0;
  let autoCompleted = 0;

  for (const rawUrl of sitemapUrls) {
    const norm = normalizeUrlForCompare(rawUrl);
    const isIndexedProxy = topPagesUrls.has(norm);
    const existingRow = existingByNorm.get(norm);

    if (existingRow) {
      if (isIndexedProxy && (existingRow.status === 'pending' || existingRow.status === 'requested')) {
        await pool.query(
          `UPDATE seo_indexing_queue SET status = 'done', done_at = NOW(), updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, existingRow.id],
        );
        autoCompleted++;
      }
      continue;
    }

    if (!isIndexedProxy) {
      const reason = pulledAt
        ? `Not showing in GSC top pages as of last SEO pull (${pulledAt.slice(0, 10)}) — likely not yet indexed.`
        : `Found in sitemap; no GSC top-pages data available yet (run \`npm run ge:seo\`) to confirm indexing status.`;
      const result = await pool.query(
        `INSERT INTO seo_indexing_queue (tenant_id, url, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, url) DO NOTHING
         RETURNING id`,
        [tenantId, rawUrl, reason],
      );
      if ((result.rowCount ?? 0) > 0) inserted++;
    }
    // else: in sitemap, already showing in top-pages, never tracked — already
    // indexed and getting impressions, nothing to queue.
  }

  logger.info(`[seo-indexing-queue] sync: ${sitemapUrls.length} sitemap URLs, ${inserted} newly queued, ${autoCompleted} auto-completed`);
  return {
    totalSitemapUrls: sitemapUrls.length,
    inserted,
    autoCompleted,
    hasTopPagesData: topPagesUrls.size > 0,
  };
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------
export interface IndexingQueueItem {
  id: string;
  url: string;
  reason: string;
  status: string;
  date_added: string;
  last_reminded_at: string | null;
  requested_at: string | null;
  done_at: string | null;
}

export async function getDueIndexingItems(limit: number = SEO_INDEXING_WEEKLY_LIMIT): Promise<IndexingQueueItem[]> {
  const tenantId = await resolveDefaultSeoTenantId();
  const result = await pool.query(
    `SELECT id, url, reason, status, date_added, last_reminded_at, requested_at, done_at
     FROM seo_indexing_queue
     WHERE tenant_id = $1 AND status IN ('pending', 'requested')
     ORDER BY date_added ASC
     LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows as IndexingQueueItem[];
}

export async function countPendingIndexingItems(): Promise<number> {
  const tenantId = await resolveDefaultSeoTenantId();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM seo_indexing_queue WHERE tenant_id = $1 AND status IN ('pending', 'requested')`,
    [tenantId],
  );
  return Number((result.rows[0] as { count: number }).count);
}

export async function listIndexingQueue(statusFilter?: string): Promise<IndexingQueueItem[]> {
  const tenantId = await resolveDefaultSeoTenantId();
  if (statusFilter) {
    const result = await pool.query(
      `SELECT id, url, reason, status, date_added, last_reminded_at, requested_at, done_at
       FROM seo_indexing_queue WHERE tenant_id = $1 AND status = $2 ORDER BY date_added ASC`,
      [tenantId, statusFilter],
    );
    return result.rows as IndexingQueueItem[];
  }
  const result = await pool.query(
    `SELECT id, url, reason, status, date_added, last_reminded_at, requested_at, done_at
     FROM seo_indexing_queue WHERE tenant_id = $1 ORDER BY status ASC, date_added ASC`,
    [tenantId],
  );
  return result.rows as IndexingQueueItem[];
}

export async function markIndexingReminded(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `UPDATE seo_indexing_queue SET last_reminded_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

// ---------------------------------------------------------------------------
// Manual status updates — driven by scripts/seo-indexing-queue.ts once Jatin
// has actually clicked "Request Indexing" (or Google confirms indexing) in the
// real GSC UI. This module never touches GSC itself.
// ---------------------------------------------------------------------------
export type IndexingMarkResult =
  | { outcome: 'not_found' }
  | { outcome: 'ambiguous'; matches: Array<{ id: string; url: string; status: string }> }
  | { outcome: 'updated'; url: string };

export async function markIndexingStatus(urlMatch: string, status: 'pending' | 'requested' | 'done'): Promise<IndexingMarkResult> {
  const tenantId = await resolveDefaultSeoTenantId();
  const matches = await pool.query(
    `SELECT id, url, status FROM seo_indexing_queue WHERE tenant_id = $1 AND url ILIKE $2`,
    [tenantId, `%${urlMatch}%`],
  );
  const rows = matches.rows as Array<{ id: string; url: string; status: string }>;
  if (rows.length === 0) return { outcome: 'not_found' };
  if (rows.length > 1) {
    const exact = rows.find((r) => normalizeUrlForCompare(r.url) === normalizeUrlForCompare(urlMatch));
    if (!exact) return { outcome: 'ambiguous', matches: rows };
    return updateOne(tenantId, exact, status);
  }
  return updateOne(tenantId, rows[0], status);
}

async function updateOne(tenantId: string, row: { id: string; url: string }, status: 'pending' | 'requested' | 'done'): Promise<IndexingMarkResult> {
  const setClauses: string[] = [`status = $3`, `updated_at = NOW()`];
  if (status === 'requested') setClauses.push(`requested_at = NOW()`);
  if (status === 'done') setClauses.push(`done_at = NOW()`);
  if (status === 'pending') setClauses.push(`requested_at = NULL`, `done_at = NULL`);
  await pool.query(
    `UPDATE seo_indexing_queue SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2`,
    [tenantId, row.id, status],
  );
  return { outcome: 'updated', url: row.url };
}

// ---------------------------------------------------------------------------
// Weekly reminder — called by the "SEO Indexing Reminder" worker cron
// (src/worker.ts). Syncs the queue from the live sitemap, then DMs Jatin a
// quota-respecting batch of due URLs. Sends nothing when the queue is empty —
// a "nothing to do" DM every week would just be noise.
// ---------------------------------------------------------------------------
export interface ReminderResult {
  sent: boolean;
  count: number;
  pendingTotal?: number;
  syncError?: string;
}

export async function sendIndexingReminderDigest(): Promise<ReminderResult> {
  let syncError: string | undefined;
  try {
    await syncIndexingQueueFromSitemap();
  } catch (e) {
    // Non-fatal — the sitemap fetch or state file can fail independently of the
    // reminder; still remind about whatever's already queued from prior syncs.
    syncError = e instanceof Error ? e.message : String(e);
    logger.warn(`[seo-indexing-queue] sitemap sync failed, reminding from existing queue only: ${syncError}`);
  }

  const due = await getDueIndexingItems(SEO_INDEXING_WEEKLY_LIMIT);
  if (due.length === 0) {
    logger.info('[seo-indexing-queue] no due URLs — skipping reminder DM');
    return { sent: false, count: 0, syncError };
  }

  const pendingTotal = await countPendingIndexingItems();
  const { sendSlackDM } = await import('./slackService');
  const { SLACK_JATIN } = await import('../config/constants');

  const lines: string[] = [
    `🔎 *GSC Indexing Requests Due* — ${due.length} URL${due.length !== 1 ? 's' : ''} this week`,
    '',
    '*How:* Google Search Console → URL Inspection → paste the URL → *Request Indexing*. One shot per URL, ~10-12/day quota — no need to rush through all of these today.',
    '',
  ];
  due.forEach((item, i) => {
    const added = new Date(item.date_added).toISOString().slice(0, 10);
    const statusNote = item.status === 'requested' ? ' _(already requested — check if it stuck)_' : '';
    lines.push(`${i + 1}. ${item.url}${statusNote}`);
    lines.push(`   _${item.reason}_ (queued ${added})`);
  });
  lines.push('');
  lines.push('*When you\'re done with a URL:*');
  lines.push('`npx tsx scripts/seo-indexing-queue.ts requested <url>` — right after you click Request Indexing');
  lines.push('`npx tsx scripts/seo-indexing-queue.ts done <url>` — once Google confirms it\'s indexed (or it auto-clears next sync if it starts showing up in GSC)');
  lines.push('');
  lines.push(`_${pendingTotal} URL${pendingTotal !== 1 ? 's' : ''} total still pending in the queue._`);

  await sendSlackDM(SLACK_JATIN, lines.join('\n'));
  await markIndexingReminded(due.map((d) => d.id));

  logger.info(`[seo-indexing-queue] reminder sent — ${due.length} URLs, ${pendingTotal} pending total`);
  return { sent: true, count: due.length, pendingTotal, syncError };
}
