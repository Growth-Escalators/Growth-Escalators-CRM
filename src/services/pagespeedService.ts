import { pool } from '../db/index';
import logger from '../utils/logger';

// Fallback client list — used if client_knowledge_base is empty
const FALLBACK_CLIENTS = [
  { project: 'aarohaom', url: 'https://aarohaom.com' },
  { project: 'blackpanda', url: 'https://blackpandaenterprises.com' },
  { project: 'ageddentistry', url: 'https://ageddentistry.org' },
];

async function getClients(): Promise<Array<{ project: string; url: string }>> {
  try {
    const r = await pool.query(
      `SELECT project_name, 'https://' || (SELECT client_domain FROM seo_weekly_metrics WHERE project_name = kb.project_name LIMIT 1) AS url
       FROM client_knowledge_base kb
       WHERE project_name IS NOT NULL
       LIMIT 20`,
    );
    if (r.rows.length > 0) {
      return (r.rows as Array<{ project_name: string; url: string }>)
        .filter(row => row.url && row.url !== 'https://')
        .map(row => ({ project: row.project_name, url: row.url }));
    }
  } catch { /* fallback below */ }
  return FALLBACK_CLIENTS;
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

export async function runPageSpeedChecks(): Promise<{ checked: number; errors: number }> {
  let checked = 0, errors = 0;

  const clients = await getClients();
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
        `INSERT INTO site_health_metrics (project_name, pagespeed_mobile, pagespeed_desktop, lcp, fid, cls, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [client.project, mobileScore, desktopScore, lcp, fid, cls],
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
