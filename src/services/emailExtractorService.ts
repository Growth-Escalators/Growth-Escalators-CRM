/**
 * emailExtractorService.ts
 * Multi-step email enrichment cascade — zero Hunter dependency.
 *
 * Strategy order (stops at first hit):
 *   1. Website scraping (self-hosted, unlimited)
 *   2. Apollo.io People Search (free tier: 50 searches/month)
 *   3. Snov.io Domain Search   (free tier: 50 credits/month)
 *   4. MX-validated prefix guessing (self-hosted, unlimited)
 *   5. Reacher SMTP verification  (self-hosted, unlimited) — validates guesses
 *   6. Google SERP scrape         (self-hosted, unlimited)
 *
 * Env vars:
 *   APOLLO_API_KEY        — Apollo.io API key (optional, falls through if missing)
 *   SNOV_CLIENT_ID        — Snov.io OAuth client ID (optional)
 *   SNOV_CLIENT_SECRET    — Snov.io OAuth client secret (optional)
 *   REACHER_BASE_URL      — Self-hosted Reacher instance URL (optional)
 */

import { promises as dns } from 'dns';
import logger from '../utils/logger';

// ─── Config ───────────────────────────────────────────────────────────────────

const APOLLO_API_KEY       = process.env.APOLLO_API_KEY ?? '';
const SNOV_CLIENT_ID       = process.env.SNOV_CLIENT_ID ?? '';
const SNOV_CLIENT_SECRET   = process.env.SNOV_CLIENT_SECRET ?? '';
const REACHER_BASE_URL     = process.env.REACHER_BASE_URL ?? '';

const EMAIL_REGEX      = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_REGEX = /[a-zA-Z0-9._%+\-]+\s*[\[\(]\s*at\s*[\]\)]\s*[a-zA-Z0-9.\-]+\s*[\[\(]\s*dot\s*[\]\)]\s*[a-zA-Z]{2,}/gi;
const CONTACT_PATHS    = ['/contact', '/contact-us', '/get-in-touch', '/about', '/about-us', '/team', '/'];
const GENERIC_PREFIXES = ['noreply', 'no-reply', 'mailer', 'postmaster', 'abuse', 'webmaster', 'admin'];
const PREFERRED_PREFIXES = ['hello', 'hi', 'team', 'founder', 'ceo', 'director', 'md', 'owner', 'agency', 'contact', 'business', 'partner'];
const GUESS_PREFIXES   = ['hello', 'info', 'contact', 'team', 'hi'];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailResult {
  email: string;
  source: 'scraped' | 'apollo' | 'snov' | 'guessed' | 'reacher-verified' | 'google';
  confidence: 'high' | 'medium' | 'low';
}

export interface FindEmailOptions {
  allowPaidProviders?: boolean;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Multi-strategy email finder. Tries all strategies in order,
 * stopping at the first successful result.
 *
 * @param websiteUrl  Full URL or domain of the target company website
 * @param firstName   Optional first name for Apollo people search
 * @param lastName    Optional last name for Apollo people search
 * @param opts        Paid providers are opt-in; omitted/false keeps the cascade free.
 */
export async function findEmail(
  websiteUrl: string,
  firstName?: string,
  lastName?: string,
  opts: FindEmailOptions = {},
): Promise<EmailResult | null> {
  const domain = extractDomain(websiteUrl);
  if (!domain) return null;
  const allowPaidProviders = opts.allowPaidProviders === true;

  // ── Step 1: Scrape website ─────────────────────────────────────────────────
  const scraped = await scrapeWebsite(websiteUrl);
  if (scraped) {
    logger.debug({ domain, email: scraped }, '[emailExtractor] step1 scrape hit');
    return { email: scraped, source: 'scraped', confidence: 'high' };
  }

  // ── Step 2: Apollo.io ──────────────────────────────────────────────────────
  if (allowPaidProviders && APOLLO_API_KEY && APOLLO_API_KEY !== 'REPLACE_WITH_APOLLO_API_KEY') {
    const apollo = await apolloSearch(domain, firstName, lastName);
    if (apollo) {
      logger.debug({ domain, email: apollo }, '[emailExtractor] step2 apollo hit');
      return { email: apollo, source: 'apollo', confidence: 'high' };
    }
  }

  // ── Step 3: Snov.io ────────────────────────────────────────────────────────
  if (allowPaidProviders && SNOV_CLIENT_ID && SNOV_CLIENT_ID !== 'REPLACE_WITH_SNOV_CLIENT_ID') {
    const snov = await snovSearch(domain);
    if (snov) {
      logger.debug({ domain, email: snov }, '[emailExtractor] step3 snov hit');
      return { email: snov, source: 'snov', confidence: 'high' };
    }
  }

  // ── Step 4: MX-validated prefix + personal-pattern guessing ───────────────
  // Builds candidates in priority order: personal patterns (higher reply
  // likelihood) first, role aliases (hello@, info@, ...) as fallback.
  const candidates = await guessEmailCandidates(domain, firstName, lastName);

  if (candidates.length > 0) {
    // ── Step 5: Reacher SMTP verification (one attempt per candidate) ─────
    if (REACHER_BASE_URL && REACHER_BASE_URL !== 'REPLACE_WITH_REACHER_URL') {
      for (const candidate of candidates) {
        const verified = await reacherVerify(candidate);
        if (verified) {
          logger.debug({ domain, email: candidate }, '[emailExtractor] step5 reacher-verified');
          return { email: candidate, source: 'reacher-verified', confidence: 'medium' };
        }
      }
      // All candidates rejected — fall through to Google
    } else {
      // No Reacher configured — return first candidate (personal > role)
      const guessed = candidates[0];
      logger.debug({ domain, email: guessed }, '[emailExtractor] step4 guessed (no reacher)');
      return { email: guessed, source: 'guessed', confidence: 'medium' };
    }
  }

  // ── Step 6: Google SERP scrape ─────────────────────────────────────────────
  const googled = await googleSearchEmail(domain);
  if (googled) {
    logger.debug({ domain, email: googled }, '[emailExtractor] step6 google hit');
    return { email: googled, source: 'google', confidence: 'low' };
  }

  logger.debug({ domain }, '[emailExtractor] all strategies exhausted — no email found');
  return null;
}

// ─── Step 2: Apollo.io ────────────────────────────────────────────────────────

async function apolloSearch(
  domain: string,
  firstName?: string,
  lastName?: string,
): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      api_key: APOLLO_API_KEY,
      q_organization_domains: domain,
      page: 1,
      per_page: 5,
      // Request email reveal
      reveal_personal_emails: false,
    };
    if (firstName) body.q_person_name = [firstName, lastName].filter(Boolean).join(' ');

    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      logger.debug({ status: res.status }, '[emailExtractor] apollo non-200');
      return null;
    }

    const data = (await res.json()) as {
      people?: Array<{ email?: string; email_status?: string }>;
    };

    const people = data.people ?? [];
    // Prefer verified/guessed emails over catch-all
    for (const person of people) {
      if (person.email && person.email_status !== 'invalid') {
        return person.email.toLowerCase();
      }
    }
  } catch (err) {
    logger.debug({ err }, '[emailExtractor] apollo error');
  }
  return null;
}

// ─── Step 3: Snov.io ──────────────────────────────────────────────────────────

let _snovToken: { token: string; expiresAt: number } | null = null;

async function getSnovToken(): Promise<string | null> {
  if (_snovToken && Date.now() < _snovToken.expiresAt - 60_000) return _snovToken.token;
  try {
    const res = await fetch('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: SNOV_CLIENT_ID,
        client_secret: SNOV_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    _snovToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return _snovToken.token;
  } catch {
    return null;
  }
}

async function snovSearch(domain: string): Promise<string | null> {
  try {
    const token = await getSnovToken();
    if (!token) return null;

    const res = await fetch('https://api.snov.io/v1/get-emails-from-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, url: `https://${domain}` }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { emails?: Array<{ email: string; emailStatus?: string }> };

    const emails = data.emails ?? [];
    for (const e of emails) {
      if (e.email && e.emailStatus !== 'Invalid') {
        const prefix = e.email.split('@')[0].toLowerCase();
        if (!GENERIC_PREFIXES.some(g => prefix === g)) {
          return e.email.toLowerCase();
        }
      }
    }
    // Fall back to any email in the list
    if (emails[0]?.email) return emails[0].email.toLowerCase();
  } catch (err) {
    logger.debug({ err }, '[emailExtractor] snov error');
  }
  return null;
}

// ─── Step 5: Reacher SMTP verification ───────────────────────────────────────

async function reacherVerify(email: string): Promise<boolean> {
  try {
    const res = await fetch(`${REACHER_BASE_URL}/v0/check_email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      is_reachable?: 'safe' | 'risky' | 'invalid' | 'unknown';
    };
    // Accept safe or risky (risky = catch-all / uncertain SMTP)
    return data.is_reachable === 'safe' || data.is_reachable === 'risky';
  } catch (err) {
    logger.debug({ err }, '[emailExtractor] reacher error — skipping SMTP check');
    return false;
  }
}

// ─── Step 1: Scrape website ───────────────────────────────────────────────────

export interface ScrapedWebsiteEmail {
  email: string;
  preferred: boolean;
  generic: boolean;
}

/**
 * Collects and classifies ALL emails published on a company's own contact/careers/
 * team pages. Returns them ranked (preferred first). Exported so the Wizmatch
 * contact-discovery cascade can reuse it — a published email needs no SMTP
 * verification because the company put it there to be contacted.
 */
export async function collectWebsiteEmails(websiteUrl: string, paths: string[] = CONTACT_PATHS): Promise<ScrapedWebsiteEmail[]> {
  const baseUrl = normalizeUrl(websiteUrl);
  if (!baseUrl) return [];

  const allEmails: ScrapedWebsiteEmail[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    try {
      const html = await fetchPage(baseUrl + path);
      if (!html) continue;

      const matches: string[] = [...(html.match(EMAIL_REGEX) ?? [])];
      const obfuscated = html.match(OBFUSCATED_REGEX) ?? [];
      for (const obs of obfuscated) {
        const cleaned = obs
          .replace(/\s*[\[\(]\s*at\s*[\]\)]\s*/gi, '@')
          .replace(/\s*[\[\(]\s*dot\s*[\]\)]\s*/gi, '.');
        if (cleaned.match(EMAIL_REGEX)) matches.push(cleaned);
      }

      for (const raw of matches) {
        const email = raw.toLowerCase().trim();
        if (/\.(png|jpg|jpeg|gif|svg|css|js|webp)$/i.test(email)) continue;
        if (email.length > 60) continue;
        if (seen.has(email)) continue;
        seen.add(email);

        const prefix = email.split('@')[0];
        const isGeneric = GENERIC_PREFIXES.some(g => prefix === g);
        const isPreferred = PREFERRED_PREFIXES.some(p => prefix.startsWith(p));
        if (!isGeneric || allEmails.length === 0) {
          allEmails.push({ email, preferred: isPreferred, generic: isGeneric });
        }
      }
      if (allEmails.some(e => e.preferred)) break;
    } catch { /* continue */ }
  }

  allEmails.sort((a, b) => {
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;
    return 0;
  });
  return allEmails;
}

async function scrapeWebsite(websiteUrl: string): Promise<string | null> {
  const emails = await collectWebsiteEmails(websiteUrl);
  return emails.length > 0 ? emails[0].email : null;
}

// ─── Step 4: MX-validated prefix + personal-pattern guessing ─────────────────

/**
 * Builds ranked email candidates for a domain. Personal patterns (firstname@,
 * first.last@, etc.) come first — industry benchmarks show 35-50% of agency
 * emails are findable via personal patterns when firstName is known.
 * Role aliases (hello@, info@, ...) are appended as fallback.
 *
 * Returns empty array if domain has no MX records.
 */
export async function guessEmailCandidates(
  domain: string,
  firstName?: string | null,
  lastName?: string | null,
): Promise<string[]> {
  try {
    const mx = await dns.resolveMx(domain).catch(() => []);
    if (mx.length === 0) return [];

    const prefixes: string[] = [];

    const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const first = firstName ? clean(firstName) : '';
    const last = lastName ? clean(lastName) : '';

    if (first) {
      prefixes.push(first);
      if (last) {
        prefixes.push(`${first}.${last}`);
        prefixes.push(`${first}${last}`);
        prefixes.push(`${first[0]}.${last}`);
        prefixes.push(`${first}.${last[0]}`);
        prefixes.push(`${first}_${last}`);
      }
    }

    for (const p of GUESS_PREFIXES) {
      if (!prefixes.includes(p)) prefixes.push(p);
    }

    return prefixes.map(p => `${p}@${domain}`);
  } catch {
    return [];
  }
}

// ─── Step 6: Google SERP scrape ───────────────────────────────────────────────

async function googleSearchEmail(domain: string): Promise<string | null> {
  try {
    const url = `https://www.google.com/search?q=email+site:${encodeURIComponent(domain)}&num=5`;
    const html = await fetchPage(url);
    if (!html) return null;

    const matches = html.match(EMAIL_REGEX) ?? [];
    for (const raw of matches) {
      const email = raw.toLowerCase().trim();
      if (email.endsWith('@' + domain) || email.includes(domain.split('.')[0])) {
        if (!GENERIC_PREFIXES.some(g => email.startsWith(g + '@'))) {
          return email;
        }
      }
    }
    for (const raw of matches) {
      const email = raw.toLowerCase().trim();
      if (email.endsWith('@' + domain)) return email;
    }
  } catch { /* skip */ }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return (await res.text()).slice(0, 200_000);
  } catch { return null; }
}

function normalizeUrl(url: string): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith('http')) u = 'https://' + u;
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch { return null; }
}

function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith('http')) u = 'https://' + u;
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    const m = url.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
    return m ? m[1] : null;
  }
}
