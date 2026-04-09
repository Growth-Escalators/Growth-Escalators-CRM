/**
 * shlinkService.ts
 * Wraps the Shlink REST API for short link creation, stats retrieval,
 * and campaign / outreach tracking.
 *
 * Shlink instance: https://shlink-production-eb84.up.railway.app
 * Env vars required:
 *   SHLINK_BASE_URL — base URL of the Shlink instance
 *   SHLINK_API_KEY  — INITIAL_API_KEY set at deploy time
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import logger from '../utils/logger';

const SHLINK_BASE_URL = process.env.SHLINK_BASE_URL ?? 'https://shlink-production-eb84.up.railway.app';
const SHLINK_API_KEY  = process.env.SHLINK_API_KEY  ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateLinkOptions {
  /** Full destination URL */
  longUrl: string;
  /** Optional human-readable slug, e.g. "aaroha-promo-may" */
  customSlug?: string;
  /** UTM / metadata tags to attach */
  tags?: string[];
  /** Title shown in Shlink dashboard */
  title?: string;
  /** Expiry datetime (ISO 8601) */
  validUntil?: string;
  /** Max allowed clicks (0 = unlimited) */
  maxVisits?: number;
}

export interface ShortLink {
  shortCode: string;
  shortUrl: string;
  longUrl: string;
  tags: string[];
  title?: string;
  createdAt: string;
  visitsSummary?: { total: number; nonBots: number; bots: number };
}

export interface LinkStats {
  shortCode: string;
  shortUrl: string;
  longUrl: string;
  visitsSummary: { total: number; nonBots: number; bots: number };
  tags: string[];
  title?: string;
  createdAt: string;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function shlinkRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!SHLINK_API_KEY) {
      reject(new Error('SHLINK_API_KEY env var is not set'));
      return;
    }
    const parsed = new URL(SHLINK_BASE_URL + path);
    const lib = parsed.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;

    const opts: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'X-Api-Key': SHLINK_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = lib.request(opts, res => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Shlink API error ${res.statusCode}: ${parsed?.detail ?? raw.slice(0, 200)}`));
          } else {
            resolve(parsed as T);
          }
        } catch {
          reject(new Error(`Shlink non-JSON response (${res.statusCode}): ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a short link.
 * Returns the full ShortLink object including shortUrl.
 */
export async function createShortLink(opts: CreateLinkOptions): Promise<ShortLink> {
  const payload: Record<string, unknown> = {
    longUrl: opts.longUrl,
    tags: opts.tags ?? [],
    ...(opts.customSlug  ? { customSlug: opts.customSlug }  : {}),
    ...(opts.title       ? { title: opts.title }            : {}),
    ...(opts.validUntil  ? { validUntil: opts.validUntil }  : {}),
    ...(opts.maxVisits   ? { maxVisits: opts.maxVisits }    : {}),
  };

  logger.info({ longUrl: opts.longUrl, customSlug: opts.customSlug }, '[shlink] creating short link');

  const result = await shlinkRequest<ShortLink>('POST', '/rest/v3/short-urls', payload);

  logger.info({ shortCode: result.shortCode, shortUrl: result.shortUrl }, '[shlink] short link created');
  return result;
}

/**
 * Get visit stats for a short link by its short code.
 */
export async function getLinkStats(shortCode: string): Promise<LinkStats> {
  logger.info({ shortCode }, '[shlink] fetching link stats');

  const result = await shlinkRequest<LinkStats>('GET', `/rest/v3/short-urls/${encodeURIComponent(shortCode)}`);
  return result;
}

/**
 * Create a tracked outreach link with consistent tagging.
 * Used when sending cold email / WhatsApp sequences so clicks are attributed
 * to the correct lead and campaign.
 *
 * @param destinationUrl  The real landing page URL
 * @param campaign        Campaign name, e.g. "d2c-strategy-may26"
 * @param leadId          CRM lead ID for attribution
 * @param channel         "email" | "whatsapp" | "linkedin"
 */
export async function createOutreachLink(
  destinationUrl: string,
  campaign: string,
  leadId: string,
  channel: 'email' | 'whatsapp' | 'linkedin' = 'email',
): Promise<ShortLink> {
  // Build slug: <channel>-<leadId>-<timestamp-base36>
  const ts = Date.now().toString(36);
  const slug = `${channel}-${leadId}-${ts}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50);

  return createShortLink({
    longUrl: destinationUrl,
    customSlug: slug,
    tags: ['outreach', channel, campaign],
    title: `[${channel.toUpperCase()}] ${campaign} — lead ${leadId}`,
  });
}

/**
 * List all short links, optionally filtered by tag.
 */
export async function listLinks(tag?: string): Promise<ShortLink[]> {
  const qs = tag ? `?tags[]=${encodeURIComponent(tag)}` : '';
  const result = await shlinkRequest<{ shortUrls: { data: ShortLink[] } }>('GET', `/rest/v3/short-urls${qs}`);
  return result.shortUrls?.data ?? [];
}
