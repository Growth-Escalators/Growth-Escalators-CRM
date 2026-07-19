import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

// ---------------------------------------------------------------------------
// Serper.dev API configuration
// ---------------------------------------------------------------------------
const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_API_KEY = process.env.SERPER_API_KEY;

// Client → domain mapping (fallback if DB is empty)
const CLIENT_DOMAINS: Record<string, string> = {
  aarohaom: 'aarohaom.com',
  blackpanda: 'blackpandaenterprises.com',
  ageddentistry: 'ageddentistry.org',
};

// Starter keywords per client (used only when keyword_rankings is empty)
const STARTER_KEYWORDS: Record<string, string[]> = {
  'aarohaom.com': [
    'ayurvedic treatment', 'ayurvedic wellness', 'aaroha om',
    'natural healing jaipur', 'ayurveda products online',
  ],
  'blackpandaenterprises.com': [
    'india market entry', 'gcc consulting india', 'healthcare ai india',
    'business consulting jaipur', 'black panda enterprises',
  ],
  'ageddentistry.org': [
    'geriatric dentistry', 'aged dentistry association', 'dental care elderly india',
    'dentistry for seniors', 'aged dental association',
  ],
};

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
// Get keywords to track (from DB or starter set)
// ---------------------------------------------------------------------------
async function getKeywordsToTrack(tenantId: string): Promise<KeywordToTrack[]> {
  try {
    // First: check if we have existing keywords in the DB
    const existing = await pool.query(`
      SELECT DISTINCT
        COALESCE(project_name, '') AS project_name,
        COALESCE(client_domain, project_name, '') AS client_domain,
        keyword
      FROM keyword_rankings
      WHERE keyword IS NOT NULL AND keyword != '' AND tenant_id = $1
      ORDER BY client_domain, keyword
    `, [tenantId]);

    if (existing.rows.length > 0) {
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
      logger.info(`[rank-tracking] found ${keywords.length} existing keywords to track`);
      return keywords;
    }
  } catch (e) {
    logger.warn('[rank-tracking] could not fetch existing keywords:', e);
  }

  // Fallback: use starter keywords
  logger.info('[rank-tracking] no existing keywords, using starter set');
  const keywords: KeywordToTrack[] = [];
  for (const [domain, kws] of Object.entries(STARTER_KEYWORDS)) {
    const projectName = Object.entries(CLIENT_DOMAINS).find(([, d]) => d === domain)?.[0] ?? domain;
    for (const keyword of kws) {
      keywords.push({ projectName, clientDomain: domain, keyword });
    }
  }
  return keywords;
}

// ---------------------------------------------------------------------------
// Check rank for a single keyword via Serper.dev
// ---------------------------------------------------------------------------
async function checkSerperRank(
  keyword: string,
  targetDomain: string,
): Promise<{ position: number | null; url: string | null; featuredSnippet: boolean }> {
  if (!SERPER_API_KEY) {
    return { position: null, url: null, featuredSnippet: false };
  }

  try {
    const res = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: keyword, gl: 'in', hl: 'en', num: 100 }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logger.warn(`[rank-tracking] Serper API ${res.status} for "${keyword}"`);
      return { position: null, url: null, featuredSnippet: false };
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
  } catch (e) {
    logger.warn(`[rank-tracking] Serper error for "${keyword}":`, e instanceof Error ? e.message : String(e));
    return { position: null, url: null, featuredSnippet: false };
  }
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
export async function runRankChecks(): Promise<{ checked: number; errors: number }> {
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

  let checked = 0;
  let errors = 0;
  const today = new Date().toISOString().split('T')[0];
  const tenantId = await resolveDefaultSeoTenantId();

  const keywords = await getKeywordsToTrack(tenantId);
  logger.info(`[rank-tracking] checking ${keywords.length} keywords via Serper.dev`);

  for (const kw of keywords) {
    try {
      const { position, url, featuredSnippet } = await checkSerperRank(kw.keyword, kw.clientDomain);
      const previousPosition = await getPreviousPosition(tenantId, kw.projectName, kw.keyword);
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
          tenantId,
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
