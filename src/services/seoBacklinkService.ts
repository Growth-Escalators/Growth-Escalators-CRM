import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { listSeoSiteDomains } from './seoSiteRegistry';
import {
  createSeoSiteIdResolver,
  createSeoSpendContextResolver,
  guardedSerperCall,
  type SeoSpendContextResolver,
} from './seoSerperGuard';

/**
 * Backend-native backlink monitoring.
 * Replaces n8n workflow mtrig-seo08 (Backlink Monitor).
 *
 * Uses Serper.dev to search for backlinks to client domains.
 * Not as comprehensive as Ahrefs/SEMrush but zero cost and good enough
 * for detecting new mentions and links.
 */

const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  domain?: string;
}

export async function runBacklinkCheck(tenantId?: string): Promise<{ found: number; errors: number }> {
  const tid = tenantId ?? await resolveDefaultSeoTenantId();

  // Domains come from the per-tenant site registry now, not the hardcoded
  // three-domain array this used to have — see seoTenantContext.ts's docblock.
  // Checked before the API-key guard below: a tenant with no registered sites
  // must make zero paid Serper calls, and it shouldn't trip a "SERPER_API_KEY
  // missing" Slack alert either just because it hasn't onboarded a site yet.
  const domains = await listSeoSiteDomains(tid);
  if (domains.length === 0) {
    logger.warn(`[backlinks] tenant ${tid} has no registered SEO sites — skipping backlink check (zero paid API calls)`);
    return { found: 0, errors: 0 };
  }

  if (!SERPER_API_KEY) {
    const msg = 'backlinks: SERPER_API_KEY not set on Railway worker — backlink monitor cannot run';
    logger.error(`[backlinks] ${msg}`);
    try {
      const { sendSlackMessage } = await import('./slackService');
      const { SLACK_SEO_CHANNEL } = await import('../config/constants');
      await sendSlackMessage(SLACK_SEO_CHANNEL, `⚠️ ${msg}`);
    } catch { /* slack non-critical */ }
    throw new Error(msg);
  }

  let found = 0;
  let errors = 0;

  // Resolves each domain to its seo_sites id once per run — domains here are
  // already a deduplicated list from listSeoSiteDomains, so this never
  // actually re-resolves the same domain twice, but reuses the shared
  // resolver from seoSerperGuard.ts for consistency with the other three
  // guarded call sites.
  const resolveSiteId = createSeoSiteIdResolver(tid);
  // See rankTrackingService for why this is per-run, not per-call.
  const resolveSpendContext = createSeoSpendContextResolver(tid);

  for (const domain of domains) {
    try {
      const siteId = await resolveSiteId(domain);

      // undefined = the guard blocked this call (daily cap reached) — skip,
      // not counted as an error. null = the Serper call itself ran but
      // failed (non-OK response or a network error) — counted as an error,
      // matching this loop's behaviour before this guard existed.
      const results = await guardedSerperCall<SerperResult[] | null | undefined>(
        { tenantId: tid, siteId, spendContext: resolveSpendContext, operation: 'backlink_search', label: `backlinks ${domain}` },
        async (markSpent) => {
          try {
            // Search for pages linking to this domain (excluding the domain itself)
            const query = `link:${domain} -site:${domain}`;
            const res = await fetch(SERPER_API_URL, {
              method: 'POST',
              headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: query, gl: 'in', hl: 'en', num: 30 }),
              signal: AbortSignal.timeout(15000),
            });
            markSpent(); // the request left — record it even if the response is non-OK or parsing below fails

            if (!res.ok) {
              logger.warn(`[backlinks] Serper API ${res.status} for ${domain}`);
              return null;
            }

            const data = await res.json() as { organic?: SerperResult[] };
            return data.organic ?? [];
          } catch (e) {
            logger.warn(`[backlinks] Serper error for ${domain}:`, e instanceof Error ? e.message : String(e));
            return null;
          }
        },
        () => {
          // Neutral on purpose: the guard blocks for several reasons (daily cap,
          // per-site cap, paused site, plan limit) and logs the precise one
          // itself. Naming a cause here would be a guess, and it was a wrong
          // one — this line claimed "daily cap reached" for a paused site.
          logger.warn(`[backlinks] skipped by the SEO spend guard — ${domain} (reason logged above)`);
          return undefined;
        },
      );

      if (results === undefined) continue;
      if (results === null) { errors++; continue; }

      for (const result of results) {
        const sourceDomain = result.domain ?? new URL(result.link).hostname;

        // Deduplicate: skip if we already have this source_url
        const existing = await pool.query(
          `SELECT id FROM backlink_data
           WHERE project_name = $1
             AND source_url = $2
             AND tenant_id = $3
           LIMIT 1`,
          [domain, result.link, tid],
        );
        if ((existing.rows as unknown[]).length > 0) continue;

        await pool.query(
          `INSERT INTO backlink_data
            (project_name, source_url, target_url, anchor_text, link_type, first_seen, status, tenant_id)
           VALUES ($1, $2, $3, $4, 'dofollow', CURRENT_DATE, 'active', $5)`,
          [domain, result.link, `https://${domain}`, result.title || sourceDomain, tid],
        );
        found++;
      }

      logger.info(`[backlinks] ${domain}: found ${results.length} results, ${found} new`);

      // Rate limit
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      logger.error({ err: e, domain }, '[backlinks] processing failed');
      errors++;
    }
  }

  // Also check for lost backlinks (mark as lost if not seen in >30 days)
  try {
    const lost = await pool.query(`
      UPDATE backlink_data SET status = 'lost'
      WHERE status = 'active' AND last_seen < NOW() - INTERVAL '30 days' AND tenant_id = $1
      RETURNING id
    `, [tid]);
    if (lost.rowCount && lost.rowCount > 0) {
      logger.info(`[backlinks] marked ${lost.rowCount} backlinks as lost`);
    }
  } catch { /* non-critical */ }

  logger.info(`[backlinks] complete — ${found} new backlinks, ${errors} errors`);
  return { found, errors };
}
