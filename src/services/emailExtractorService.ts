import { promises as dns } from 'dns';
import logger from '../utils/logger';

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_REGEX = /[a-zA-Z0-9._%+\-]+\s*[\[\(]\s*at\s*[\]\)]\s*[a-zA-Z0-9.\-]+\s*[\[\(]\s*dot\s*[\]\)]\s*[a-zA-Z]{2,}/gi;
const CONTACT_PATHS = ['/contact', '/contact-us', '/get-in-touch', '/about', '/about-us', '/team', '/'];
const GENERIC_PREFIXES = ['noreply', 'no-reply', 'mailer', 'postmaster', 'abuse', 'webmaster', 'admin'];
const PREFERRED_PREFIXES = ['hello', 'hi', 'team', 'founder', 'ceo', 'director', 'md', 'owner', 'agency', 'contact', 'business', 'partner'];
const GUESS_PREFIXES = ['hello', 'info', 'contact', 'team', 'hi'];

export interface EmailResult {
  email: string;
  source: 'scraped' | 'guessed' | 'google';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Multi-strategy email finder. Tries in order:
 * 1. Website scraping (high confidence)
 * 2. MX-validated common prefix guessing (medium confidence)
 * 3. Google search (low confidence)
 */
export async function findEmail(websiteUrl: string): Promise<EmailResult | null> {
  const domain = extractDomain(websiteUrl);
  if (!domain) return null;

  // Strategy 1: Scrape website
  const scraped = await scrapeWebsite(websiteUrl);
  if (scraped) return { email: scraped, source: 'scraped', confidence: 'high' };

  // Strategy 2: MX-validated guessing
  const guessed = await guessEmail(domain);
  if (guessed) return { email: guessed, source: 'guessed', confidence: 'medium' };

  // Strategy 3: Google search
  const googled = await googleSearchEmail(domain);
  if (googled) return { email: googled, source: 'google', confidence: 'low' };

  return null;
}

// ---------------------------------------------------------------------------
// Strategy 1: Scrape website pages
// ---------------------------------------------------------------------------
async function scrapeWebsite(websiteUrl: string): Promise<string | null> {
  const baseUrl = normalizeUrl(websiteUrl);
  if (!baseUrl) return null;

  const allEmails: Array<{ email: string; preferred: boolean }> = [];
  const seen = new Set<string>();

  for (const path of CONTACT_PATHS) {
    try {
      const html = await fetchPage(baseUrl + path);
      if (!html) continue;

      const matches: string[] = [...(html.match(EMAIL_REGEX) ?? [])];
      const obfuscated = html.match(OBFUSCATED_REGEX) ?? [];
      for (const obs of obfuscated) {
        const cleaned = obs.replace(/\s*[\[\(]\s*at\s*[\]\)]\s*/gi, '@').replace(/\s*[\[\(]\s*dot\s*[\]\)]\s*/gi, '.');
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
          allEmails.push({ email, preferred: isPreferred });
        }
      }
      if (allEmails.some(e => e.preferred)) break;
    } catch { /* continue */ }
  }

  if (allEmails.length === 0) return null;
  allEmails.sort((a, b) => {
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;
    return 0;
  });
  return allEmails[0].email;
}

// ---------------------------------------------------------------------------
// Strategy 2: MX-validated common prefix guessing
// ---------------------------------------------------------------------------
async function guessEmail(domain: string): Promise<string | null> {
  try {
    const mx = await dns.resolveMx(domain).catch(() => []);
    if (mx.length === 0) return null; // Domain doesn't accept email

    // Domain has MX records — use best guess prefix
    for (const prefix of GUESS_PREFIXES) {
      return `${prefix}@${domain}`; // Return first — hello@ preferred
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategy 3: Google search for email
// ---------------------------------------------------------------------------
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
    // Accept any email found at the domain
    for (const raw of matches) {
      const email = raw.toLowerCase().trim();
      if (email.endsWith('@' + domain)) return email;
    }
  } catch { /* skip */ }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
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
