import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { listSeoSiteDomains } from './seoSiteRegistry';

async function getClients(tenantId: string): Promise<Array<{ project: string; url: string }>> {
  try {
    // Real client_knowledge_base data, joined against seo_weekly_metrics for the
    // domain when we've actually recorded one. The old fallback here used to
    // guess a domain from the project name with a 3-way ILIKE ladder — that was
    // the exact hardcoding this tenant-scoping pass exists to remove, since it
    // silently pointed every unmatched project at one of three GE-only domains
    // regardless of which tenant it belonged to. If there's no recorded domain,
    // we fall through to the site registry below instead of guessing.
    const r = await pool.query(`
      SELECT project_name,
        (SELECT 'https://' || client_domain FROM seo_weekly_metrics WHERE project_name = kb.project_name AND client_domain IS NOT NULL AND tenant_id = $1 LIMIT 1) AS url
      FROM client_knowledge_base kb
      WHERE project_name IS NOT NULL AND tenant_id = $1
      LIMIT 20
    `, [tenantId]);
    if (r.rows.length > 0) {
      const clients = (r.rows as Array<{ project_name: string; url: string | null }>)
        .filter((row): row is { project_name: string; url: string } => !!row.url && row.url !== 'https://')
        .map(row => ({ project: row.project_name, url: row.url }));
      if (clients.length > 0) return clients;
    }
  } catch { /* fall through to the registry below */ }

  // No usable rows in client_knowledge_base/seo_weekly_metrics — fall back to
  // this tenant's registered SEO sites. An empty registry means this tenant
  // genuinely has no sites registered; that is the correct answer, not a
  // reason to reach for a hardcoded array of someone else's domains.
  const domains = await listSeoSiteDomains(tenantId);
  if (domains.length === 0) {
    logger.warn(`[pagespeed] tenant ${tenantId} has no registered SEO sites — nothing to check`);
    return [];
  }
  return domains.map(domain => ({ project: domain, url: `https://${domain}` }));
}

interface PageSpeedResult {
  project: string;
  mobileScore: number;
  desktopScore: number;
  lcp: number;
  fid: number;
  cls: number;
}

async function fetchScore(url: string, strategy: 'mobile' | 'desktop'): Promise<Record<string, unknown> | null> {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) { logger.warn(`[pagespeed] ${strategy} ${url}: HTTP ${res.status}`); return null; }
    return await res.json() as Record<string, unknown>;
  } catch (e) {
    logger.warn(`[pagespeed] ${strategy} ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function runPageSpeedChecks(tenantId?: string): Promise<{ checked: number; errors: number }> {
  let checked = 0, errors = 0;
  const tid = tenantId ?? await resolveDefaultSeoTenantId();

  const clients = await getClients(tid);
  for (const client of clients) {
    try {
      const [mobileData, desktopData] = await Promise.all([
        fetchScore(client.url, 'mobile'),
        fetchScore(client.url, 'desktop'),
      ]);

      const mobileResult = mobileData?.lighthouseResult as Record<string, unknown> | undefined;
      const desktopResult = desktopData?.lighthouseResult as Record<string, unknown> | undefined;

      const mobileScore = Math.round(((mobileResult?.categories as Record<string, Record<string, number>> | undefined)?.performance?.score ?? 0) * 100);
      const desktopScore = Math.round(((desktopResult?.categories as Record<string, Record<string, number>> | undefined)?.performance?.score ?? 0) * 100);

      const audits = mobileResult?.audits as Record<string, Record<string, number>> | undefined;
      const lcp = parseFloat(((audits?.['largest-contentful-paint']?.numericValue ?? 0) / 1000).toFixed(2));
      const fid = parseFloat((audits?.['max-potential-fid']?.numericValue ?? 0).toFixed(2));
      const cls = parseFloat((audits?.['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3));

      await pool.query(
        `INSERT INTO site_health_metrics (project_name, pagespeed_mobile, pagespeed_desktop, lcp, fid, cls, checked_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
        [client.project, mobileScore, desktopScore, lcp, fid, cls, tid],
      );

      logger.info(`[pagespeed] ${client.project}: mobile=${mobileScore} desktop=${desktopScore} lcp=${lcp}s`);
      checked++;

      // Rate limit: 2 seconds between clients
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      logger.error(`[pagespeed] ${client.project} failed:`, e instanceof Error ? e.message : String(e));
      errors++;
    }
  }

  return { checked, errors };
}
