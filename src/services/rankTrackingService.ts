import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { listSeoSiteDomains } from './seoSiteRegistry';
import { createSeoSiteIdResolver, guardedSerperCall } from './seoSerperGuard';

// ---------------------------------------------------------------------------
// Serper.dev API configuration
// ---------------------------------------------------------------------------
const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SerperOrganic {
  position: number;
  title: string;
  link: string;
  domain?: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  answerBox?: { domain?: string; link?: string };
}

interface KeywordToTrack {
  projectName: string;
  clientDomain: string;
  keyword: string;
}

// ---------------------------------------------------------------------------
// Get keywords to track — DB only, no hardcoded starter set.
//
// This used to fall back to STARTER_KEYWORDS: five seed keywords each for
// three specific, now-retired clients (scheduled for deletion), applied
// whenever keyword_rankings was empty. That's the same bug as the hardcoded
// CLIENT_DOMAINS arrays removed elsewhere in this pass: a brand-new tenant
// with an empty keyword_rankings table would have silently been seeded with
// a retired client's keywords instead of its own or none at all. It's
// removed outright here rather than gated behind "only if this tenant owns
// that domain" — there is no new tenant those specific keywords could ever
// legitimately apply to, they were one-off content for domains this repo no
// longer serves. A tenant's real keyword set now only ever comes from
// whatever discovery/seeding flow populates keyword_rankings for its
// registered sites; until that has run, rank tracking has nothing to do for
// that tenant, which is the correct (empty) answer.
// ---------------------------------------------------------------------------
async function getKeywordsToTrack(tenantId: string): Promise<KeywordToTrack[]> {
  try {
    const existing = await pool.query(`
      SELECT DISTINCT
        COALESCE(project_name, '') AS project_name,
        COALESCE(client_domain, project_name, '') AS client_domain,
        keyword
      FROM keyword_rankings
      WHERE keyword IS NOT NULL AND keyword != '' AND tenant_id = $1
      ORDER BY client_domain, keyword
    `, [tenantId]);

    // Deduplicate by keyword+domain
    const seen = new Set<string>();
    const keywords: KeywordToTrack[] = [];
    for (const row of existing.rows as Array<Record<string, string>>) {
      const key = `${row.client_domain}:${row.keyword}`;
      if (!seen.has(key)) {
        seen.add(key);
        keywords.push({
          projectName: row.project_name || row.client_domain,
          clientDomain: row.client_domain,
          keyword: row.keyword,
        });
      }
    }
    if (keywords.length === 0) {
      logger.info('[rank-tracking] no existing keywords to track for this tenant yet');
    } else {
      logger.info(`[rank-tracking] found ${keywords.length} existing keywords to track`);
    }
    return keywords;
  } catch (e) {
    logger.warn('[rank-tracking] could not fetch existing keywords:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Check rank for a single keyword via Serper.dev
// ---------------------------------------------------------------------------
async function checkSerperRank(
  keyword: string,
  targetDomain: string,
  tenantId: string,
  siteId: string | null,
): Promise<{ position: number | null; url: string | null; featuredSnippet: boolean }> {
  const empty = { position: null, url: null, featuredSnippet: false };
  if (!SERPER_API_KEY) {
    return empty;
  }

  // guardedSerperCall never throws (see seoSerperGuard.ts) — any error from
  // the fetch/parsing below (including a malformed URL from `new URL(...)`)
  // is caught inside it, spend is recorded once markSpent() has fired, and
  // it falls back to onBlocked() below — which is `empty`, matching what the
  // old bare try/catch here used to return on any failure.
  return guardedSerperCall(
    { tenantId, siteId, operation: 'rank_check', label: `rank-tracking "${keyword}" (${targetDomain})` },
    async (markSpent) => {
      const res = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: keyword, gl: 'in', hl: 'en', num: 100 }),
        signal: AbortSignal.timeout(15000),
      });
      markSpent(); // the request left — Serper bills this regardless of what happens next

      if (!res.ok) {
        logger.warn(`[rank-tracking] Serper API ${res.status} for "${keyword}"`);
        return empty;
      }

      const data = await res.json() as SerperResponse;
      const organics = data.organic ?? [];

      // Check featured snippet
      const featuredSnippet = data.answerBox?.domain === targetDomain;

      // Find target domain in organic results
      const cleanDomain = targetDomain.replace(/^www\./, '');
      for (const result of organics) {
        const resultDomain = (result.domain ?? new URL(result.link).hostname).replace(/^www\./, '');
        if (resultDomain === cleanDomain || resultDomain.endsWith(`.${cleanDomain}`)) {
          return {
            position: result.position,
            url: result.link,
            featuredSnippet,
          };
        }
      }

      // Domain not found in top 100
      return { position: null, url: null, featuredSnippet };
    },
    () => {
      logger.warn(`[rank-tracking] SEO Serper daily cap reached — skipping "${keyword}"`);
      return empty;
    },
  );
}

// ---------------------------------------------------------------------------
// Get previous position for a keyword
// ---------------------------------------------------------------------------
async function getPreviousPosition(tenantId: string, projectName: string, keyword: string): Promise<number | null> {
  try {
    const r = await pool.query(
      `SELECT current_position FROM keyword_rankings
       WHERE (project_name = $1 OR client_domain = $1) AND keyword = $2 AND tenant_id = $3
       ORDER BY recorded_date DESC LIMIT 1`,
      [projectName, keyword, tenantId],
    );
    const pos = (r.rows[0] as Record<string, string> | undefined)?.current_position;
    return pos != null ? Number(pos) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main: run rank checks for all tracked keywords
// ---------------------------------------------------------------------------
export async function runRankChecks(tenantId?: string): Promise<{ checked: number; errors: number }> {
  const tid = tenantId ?? await resolveDefaultSeoTenantId();

  if (!SERPER_API_KEY) {
    const msg = 'rank-tracking: SERPER_API_KEY not set on Railway worker — rank checks cannot run';
    logger.error(`[rank-tracking] ${msg}`);
    try {
      const { sendSlackMessage } = await import('./slackService');
      const { SLACK_SEO_CHANNEL } = await import('../config/constants');
      await sendSlackMessage(SLACK_SEO_CHANNEL, `⚠️ ${msg}`);
    } catch { /* slack non-critical */ }
    throw new Error(msg);
  }

  // Same zero-sites-zero-spend requirement as seoBacklinkService: a tenant
  // with no registered SEO sites makes zero paid Serper calls. This runs
  // after the API-key guard above (not before), so a genuinely missing key
  // still fails loudly and posts to Slack regardless of site registration —
  // that's an infra problem, not a per-tenant one.
  const domains = await listSeoSiteDomains(tid);
  if (domains.length === 0) {
    logger.warn(`[rank-tracking] tenant ${tid} has no registered SEO sites — skipping rank checks (zero paid API calls)`);
    return { checked: 0, errors: 0 };
  }

  let checked = 0;
  let errors = 0;
  const today = new Date().toISOString().split('T')[0];

  const keywords = await getKeywordsToTrack(tid);
  logger.info(`[rank-tracking] checking ${keywords.length} keywords via Serper.dev`);

  // Resolves a keyword's clientDomain to its seo_sites id, once per unique
  // domain for this whole run (not once per keyword) — see
  // createSeoSiteIdResolver's doc in seoSerperGuard.ts.
  const resolveSiteId = createSeoSiteIdResolver(tid);

  for (const kw of keywords) {
    try {
      const siteId = await resolveSiteId(kw.clientDomain);
      const { position, url, featuredSnippet } = await checkSerperRank(kw.keyword, kw.clientDomain, tid, siteId);
      const previousPosition = await getPreviousPosition(tid, kw.projectName, kw.keyword);
      const positionChange = (previousPosition != null && position != null)
        ? previousPosition - position
        : null;

      await pool.query(
        `INSERT INTO keyword_rankings
          (project_name, client_domain, keyword, current_position, previous_position,
           position_change, url_ranking, featured_snippet, recorded_date, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          kw.projectName,
          kw.clientDomain,
          kw.keyword,
          position,
          previousPosition,
          positionChange,
          url,
          featuredSnippet,
          today,
          tid,
        ],
      );

      const arrow = positionChange != null
        ? (positionChange > 0 ? `↑${positionChange}` : positionChange < 0 ? `↓${Math.abs(positionChange)}` : '→')
        : 'new';
      logger.info(`[rank-tracking] ${kw.clientDomain} | "${kw.keyword}" → pos ${position ?? 'not found'} (${arrow})`);
      checked++;

      // Rate limit: 1 second between API calls (Serper allows ~100/min on free plan)
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      logger.error(`[rank-tracking] error for "${kw.keyword}":`, e);
      errors++;
    }
  }

  logger.info(`[rank-tracking] complete — ${checked} checked, ${errors} errors`);
  return { checked, errors };
}
