/**
 * websiteCacheService.ts
 * 30-day cache for scraped homepage snippets used by icebreaker generation.
 * Cuts Claude-prompt noise (one fetch per company, not per retry) and
 * protects against transient fetch failures on retry passes.
 */

import https from 'https';
import http from 'http';
import { pool } from '../db/index';
import logger from '../utils/logger';

const FALLBACK_PATHS = ['/about', '/services', '/work', '/about-us'];
const CACHE_TTL_DAYS = 30;

export async function ensureWebsiteCacheTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_website_cache (
      domain      VARCHAR(300) PRIMARY KEY,
      snippet     TEXT,
      vertical    VARCHAR(50),
      cached_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith('http')) u = 'https://' + u;
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function fetchRaw(fullUrl: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    try {
      const u = new URL(fullUrl);
      const client = u.protocol === 'http:' ? http : https;
      const req = client.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthEscalators/1.0)' },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : `${u.protocol}//${u.hostname}${res.headers.location}`;
          res.destroy();
          resolve(fetchRaw(next, timeoutMs));
          return;
        }
        let body = '';
        res.on('data', (c: string) => { body += c; if (body.length > 120_000) res.destroy(); });
        res.on('end', () => resolve(body));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
      req.end();
    } catch { resolve(''); }
  });
}

/**
 * Pulls the semantically-meaningful parts of the page (meta description,
 * og:title, h1, first h2) rather than whatever happens to be in the first
 * 600 bytes of body text — nav/footer boilerplate makes bad icebreakers.
 */
function extractSignal(html: string): string {
  if (!html) return '';
  const parts: string[] = [];

  const metaDesc = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (metaDesc?.[1]) parts.push(metaDesc[1].trim());

  const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (ogDesc?.[1]) parts.push(ogDesc[1].trim());

  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogTitle?.[1]) parts.push(ogTitle[1].trim());

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) parts.push(h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2?.[1]) parts.push(h2[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

  return parts
    .filter(s => s && s.length > 2)
    .join(' — ')
    .slice(0, 800);
}

/**
 * Heuristic vertical detection for the Claude icebreaker prompt.
 * Returns 'ecommerce' | 'SaaS' | 'D2C' | 'B2B' | '' — '' means no strong signal.
 */
function detectVertical(html: string): string {
  const lc = html.toLowerCase();
  if (/\b(d2c|direct-to-consumer|direct to consumer)\b/.test(lc)) return 'D2C';
  if (/\b(ecommerce|e-commerce|shopify|klaviyo|dtc)\b/.test(lc)) return 'ecommerce';
  if (/\b(saas|b2b software|platform)\b/.test(lc)) return 'SaaS';
  if (/\b(b2b|business[- ]to[- ]business)\b/.test(lc)) return 'B2B';
  return '';
}

export interface WebsiteSnippet {
  snippet: string;
  vertical: string;
}

/**
 * Returns cached snippet + vertical for a URL, scraping with fallback paths if
 * the cache is empty or expired. Cache hits are returned in ~1ms; cache misses
 * do up to 4 page fetches (homepage + /about + /services + /work) until we
 * have at least 100 chars of useful content.
 */
export async function getWebsiteSnippet(websiteUrl: string | null | undefined): Promise<WebsiteSnippet> {
  if (!websiteUrl) return { snippet: '', vertical: '' };
  const domain = extractDomain(websiteUrl);
  if (!domain) return { snippet: '', vertical: '' };

  try {
    const cached = await pool.query(
      `SELECT snippet, vertical FROM outreach_website_cache
         WHERE domain = $1 AND cached_at > NOW() - INTERVAL '${CACHE_TTL_DAYS} days'
         LIMIT 1`,
      [domain],
    );
    if (cached.rows[0]?.snippet) {
      return { snippet: cached.rows[0].snippet, vertical: cached.rows[0].vertical ?? '' };
    }
  } catch (err) {
    logger.debug({ err, domain }, '[websiteCache] read failed');
  }

  const base = `https://${domain}`;
  const paths = ['/', ...FALLBACK_PATHS];
  let snippet = '';
  let vertical = '';

  for (const p of paths) {
    const html = await fetchRaw(base + p);
    if (!html) continue;
    const sig = extractSignal(html);
    const v = detectVertical(html);
    if (sig.length > snippet.length) snippet = sig;
    if (!vertical && v) vertical = v;
    if (snippet.length >= 100) break;
  }

  try {
    await pool.query(
      `INSERT INTO outreach_website_cache (domain, snippet, vertical, cached_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (domain) DO UPDATE SET snippet = EXCLUDED.snippet, vertical = EXCLUDED.vertical, cached_at = NOW()`,
      [domain, snippet, vertical || null],
    );
  } catch (err) {
    logger.debug({ err, domain }, '[websiteCache] write failed');
  }

  return { snippet, vertical };
}
