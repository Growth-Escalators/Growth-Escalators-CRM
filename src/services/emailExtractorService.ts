import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Free email extraction from agency websites via HTTP scraping
// No API keys needed — just fetches HTML and extracts emails via regex
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_REGEX = /[a-zA-Z0-9._%+\-]+\s*[\[\(]\s*at\s*[\]\)]\s*[a-zA-Z0-9.\-]+\s*[\[\(]\s*dot\s*[\]\)]\s*[a-zA-Z]{2,}/gi;

// Paths to check in priority order
const CONTACT_PATHS = ['/contact', '/contact-us', '/get-in-touch', '/about', '/about-us', '/team', '/'];

// Generic emails to deprioritize (still use as fallback)
const GENERIC_PREFIXES = ['noreply', 'no-reply', 'mailer', 'postmaster', 'abuse', 'webmaster', 'admin'];
// Preferred prefixes (likely a real person or decision maker)
const PREFERRED_PREFIXES = ['hello', 'hi', 'team', 'founder', 'ceo', 'director', 'md', 'owner', 'agency', 'contact', 'business', 'partner'];

export interface ExtractedEmail {
  email: string;
  source: string; // which path it was found on
  preferred: boolean;
}

/**
 * Extract the best email from an agency website.
 * Visits contact/about pages, scrapes emails from HTML.
 */
export async function extractEmailFromWebsite(websiteUrl: string): Promise<ExtractedEmail | null> {
  const baseUrl = normalizeUrl(websiteUrl);
  if (!baseUrl) return null;

  const allEmails: ExtractedEmail[] = [];
  const seenEmails = new Set<string>();

  for (const path of CONTACT_PATHS) {
    try {
      const url = baseUrl + path;
      const html = await fetchPage(url);
      if (!html) continue;

      // Extract standard emails
      const matches: string[] = [...(html.match(EMAIL_REGEX) ?? [])];

      // Extract obfuscated emails: "name [at] domain [dot] com"
      const obfuscated = html.match(OBFUSCATED_REGEX) ?? [];
      for (const obs of obfuscated) {
        const cleaned = obs.replace(/\s*[\[\(]\s*at\s*[\]\)]\s*/gi, '@').replace(/\s*[\[\(]\s*dot\s*[\]\)]\s*/gi, '.');
        if (cleaned.match(EMAIL_REGEX)) matches.push(cleaned);
      }

      for (const raw of matches) {
        const email = raw.toLowerCase().trim();

        // Skip image files, CSS, JS
        if (/\.(png|jpg|jpeg|gif|svg|css|js|webp)$/i.test(email)) continue;
        // Skip extremely long "emails" (likely parsing artifacts)
        if (email.length > 60) continue;

        if (seenEmails.has(email)) continue;
        seenEmails.add(email);

        const prefix = email.split('@')[0];
        const isGeneric = GENERIC_PREFIXES.some(g => prefix === g);
        const isPreferred = PREFERRED_PREFIXES.some(p => prefix.startsWith(p));

        if (!isGeneric || allEmails.length === 0) {
          allEmails.push({ email, source: path, preferred: isPreferred });
        }
      }

      // If we found a preferred email, stop searching
      if (allEmails.some(e => e.preferred)) break;
    } catch {
      // Page fetch failed — continue to next path
    }
  }

  if (allEmails.length === 0) return null;

  // Sort: preferred first, then non-generic, then by path order
  allEmails.sort((a, b) => {
    if (a.preferred && !b.preferred) return -1;
    if (!a.preferred && b.preferred) return 1;
    const aGeneric = GENERIC_PREFIXES.some(g => a.email.split('@')[0] === g);
    const bGeneric = GENERIC_PREFIXES.some(g => b.email.split('@')[0] === g);
    if (!aGeneric && bGeneric) return -1;
    if (aGeneric && !bGeneric) return 1;
    return 0;
  });

  return allEmails[0];
}

// ---------------------------------------------------------------------------
// HTTP fetch with timeout, redirect following, user agent
// ---------------------------------------------------------------------------
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GEOutreach/1.0; +https://growthescalators.com)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;

    const text = await res.text();
    // Only process first 200KB to avoid huge pages
    return text.slice(0, 200_000);
  } catch {
    return null;
  }
}

function normalizeUrl(url: string): string | null {
  if (!url) return null;
  try {
    let u = url.trim();
    if (!u.startsWith('http')) u = 'https://' + u;
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return null;
  }
}
