// Shared live-page reader for every SiteProvider, and the SEO-element
// extractor the drift sweep is built on.
//
// WHY THIS IS SHARED AND NOT PER-PROVIDER. `fetchLiveSnapshot()` means the
// same thing on all three platforms: fetch the rendered page over HTTP and
// read what a crawler would see. Nothing about that is git- or WordPress- or
// Shopify-specific, and three hand-copied HTML readers would drift — the drift
// sweep compares snapshots taken across platforms against each other over
// time, so one provider extracting `<title>` slightly differently from another
// would surface as a fake "unexpected_edit". One implementation, one set of
// rules.
//
// SSRF. Site domains are admin-supplied per tenant (seo_sites.domain,
// adapterConfig.baseUrl), so every URL reaching this module is attacker-
// influenced from the server's point of view: a reseller admin who can create
// a site row can name any host they like. Two guards, both mandatory:
//   1. `isSafeFetchUrl()` (src/utils/ssrfGuard.ts) on the initial URL.
//   2. `redirect: 'manual'` plus the SAME check on every hop. Following
//      redirects automatically would let a public host bounce the request onto
//      169.254.169.254 or a *.railway.internal service — the guard on the
//      first URL alone buys nothing.
// DNS rebinding stays a residual risk, as ssrfGuard.ts documents.
//
// No new dependency. There is no HTML parser in this repo (no cheerio, no
// jsdom) and this is not the change that adds one — a bounded regex reader
// over a size-capped body is enough for the ~8 fields the drift sweep needs,
// and it cannot execute anything it reads. Every pattern below is anchored and
// non-backtracking-prone, and the body is truncated before matching, so a
// hostile page cannot turn extraction into a CPU denial of service.
import { createHash } from 'crypto';
import { isSafeFetchUrl } from '../../utils/ssrfGuard';
import { SiteProviderError, type SiteLiveSnapshot } from './providers/site-provider.interface';

/** Hard cap on how much of a response body is ever read into memory or matched against. */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2 MB
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECT_HOPS = 3;

/**
 * The on-page SEO surface, extracted from rendered HTML.
 *
 * This is the unit the drift sweep diffs and the approval UI's "before/after"
 * table renders — deliberately a small, stable, comparable set of scalars
 * rather than the HTML itself. Storing full HTML per page per day would be
 * ~80 KB/row against ~400 B/row for this; at three sites that is the
 * difference between a few MB/year and ~17 GB/year.
 *
 * Every field is `null` when absent rather than omitted, so two snapshots
 * always have the same shape and "field removed" is distinguishable from
 * "field never extracted".
 */
export interface SeoElements {
  /** The `<title>` element — what shows in the SERP, not the on-page heading. */
  readonly metaTitle: string | null;
  readonly metaDescription: string | null;
  readonly canonicalUrl: string | null;
  /** `<meta name="robots">` content, lowercased. `noindex` appearing here is the highest-severity drift signal. */
  readonly robots: string | null;
  /** First `<h1>`'s text — the on-page heading, distinct from metaTitle. */
  readonly h1: string | null;
  /** More than one h1 is an SEO smell worth surfacing; zero on a content page usually means a broken template. */
  readonly h1Count: number;
  /** `@type` values found in JSON-LD blocks, sorted + de-duplicated. Losing one is a rich-result regression. */
  readonly jsonLdTypes: readonly string[];
  readonly wordCount: number;
  readonly internalLinkCount: number;
  readonly externalLinkCount: number;
}

export const EMPTY_SEO_ELEMENTS: SeoElements = Object.freeze({
  metaTitle: null,
  metaDescription: null,
  canonicalUrl: null,
  robots: null,
  h1: null,
  h1Count: 0,
  jsonLdTypes: Object.freeze([]) as readonly string[],
  wordCount: 0,
  internalLinkCount: 0,
  externalLinkCount: 0,
});

/** What `fetchLivePageSnapshot` returns: a SiteLiveSnapshot plus the extracted comparison surface. */
export interface LivePageSnapshot extends SiteLiveSnapshot {
  readonly elements: SeoElements;
  /** sha256 of the extracted elements — the cheap "did anything change" check the drift sweep runs first. */
  readonly contentHash: string;
  /** Final URL after following redirects, when it differs from the requested one. */
  readonly finalUrl?: string;
}

export interface FetchLiveSnapshotOptions {
  /** Provider name used in thrown SiteProviderErrors. */
  readonly providerName: string;
  readonly timeoutMs?: number;
  /**
   * Keep the (truncated) HTML on the returned snapshot. Default false — the
   * snapshot table must never store full HTML, so only callers that need the
   * body in-process for a one-off (e.g. rendering an approval preview) ask
   * for it.
   */
  readonly keepBodyHtml?: boolean;
  /** Injected for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// extraction (pure — no I/O, no env, safe to unit test with a string)
// ---------------------------------------------------------------------------

const TITLE_RE = /<title[^>]*>([\s\S]{0,2000}?)<\/title>/i;
const H1_RE = /<h1[^>]*>([\s\S]{0,2000}?)<\/h1>/gi;
const META_RE = /<meta\s+([^>]{0,1000}?)>/gi;
const LINK_TAG_RE = /<link\s+([^>]{0,1000}?)>/gi;
const ATTR_RE = /([a-zA-Z-]{1,40})\s*=\s*("([^"]{0,2000})"|'([^']{0,2000})'|([^\s"'>]{1,2000}))/g;
const JSONLD_RE = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]{0,200000}?)<\/script>/gi;
const ANCHOR_HREF_RE = /<a\s[^>]{0,1000}?href\s*=\s*("([^"]{0,2000})"|'([^']{0,2000})'|([^\s"'>]{1,2000}))/gi;
const SCRIPT_STYLE_RE = /<(script|style|noscript|template)[^>]*>[\s\S]{0,200000}?<\/\1>/gi;
const TAG_RE = /<[^>]{0,2000}>/g;

function attrs(fragment: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(fragment)) !== null) {
    const name = m[1].toLowerCase();
    out[name] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

/**
 * Decodes only the five predefined XML entities plus numeric references.
 * Deliberately not a full HTML entity table: these values are compared and
 * displayed, never re-inserted into a page, so an unresolved `&hellip;`
 * compares equal to itself and is harmless — whereas a hand-rolled 2,000-entry
 * table is a maintenance liability that would itself drift.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    // `&amp;` last: decoding it first would turn `&amp;lt;` into `<`.
    .replace(/&amp;/gi, '&');
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function clean(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text.length === 0 ? null : text.slice(0, 1000);
}

/** Collects every `@type` in a JSON-LD value, including nested graphs and arrays. */
function collectJsonLdTypes(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) collectJsonLdTypes(item, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') into.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === 'string') into.add(t);
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'about', 'hasPart']) {
    if (key in record) collectJsonLdTypes(record[key], into, depth + 1);
  }
}

/**
 * Extracts the comparison surface from rendered HTML.
 *
 * `pageUrl` is used only to classify links as internal vs external. A malformed
 * or missing pageUrl degrades link classification to "everything is external"
 * rather than throwing — extraction must never be the thing that fails a sweep.
 */
export function extractSeoElements(html: string, pageUrl?: string): SeoElements {
  if (typeof html !== 'string' || html.length === 0) return EMPTY_SEO_ELEMENTS;
  const source = html.length > MAX_SNAPSHOT_BYTES ? html.slice(0, MAX_SNAPSHOT_BYTES) : html;

  const metaTitle = clean(TITLE_RE.exec(source)?.[1]);

  let metaDescription: string | null = null;
  let robots: string | null = null;
  META_RE.lastIndex = 0;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = META_RE.exec(source)) !== null) {
    const a = attrs(metaMatch[1]);
    const name = (a.name ?? a.property ?? '').toLowerCase();
    if (name === 'description' && metaDescription === null) metaDescription = clean(a.content);
    // `<meta name="robots">` wins over a bot-specific one; only take googlebot
    // if no generic directive was present, matching how Google resolves them.
    if (name === 'robots') robots = clean(a.content)?.toLowerCase() ?? null;
    else if (name === 'googlebot' && robots === null) robots = clean(a.content)?.toLowerCase() ?? null;
  }

  let canonicalUrl: string | null = null;
  LINK_TAG_RE.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = LINK_TAG_RE.exec(source)) !== null) {
    const a = attrs(linkMatch[1]);
    if ((a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
      canonicalUrl = clean(a.href);
      break;
    }
  }

  let h1: string | null = null;
  let h1Count = 0;
  H1_RE.lastIndex = 0;
  let h1Match: RegExpExecArray | null;
  while ((h1Match = H1_RE.exec(source)) !== null) {
    h1Count += 1;
    if (h1 === null) h1 = clean(h1Match[1].replace(TAG_RE, ' '));
  }

  const typeSet = new Set<string>();
  JSONLD_RE.lastIndex = 0;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = JSONLD_RE.exec(source)) !== null) {
    try {
      collectJsonLdTypes(JSON.parse(ldMatch[1]), typeSet);
    } catch {
      // Invalid JSON-LD is common in the wild and is not this function's
      // problem to report — a page with broken structured data simply
      // contributes no types.
    }
  }

  const text = source
    .replace(SCRIPT_STYLE_RE, ' ')
    .replace(TAG_RE, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  let host: string | null = null;
  if (pageUrl) {
    try {
      host = new URL(pageUrl).host.toLowerCase().replace(/^www\./, '');
    } catch {
      host = null;
    }
  }
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  ANCHOR_HREF_RE.lastIndex = 0;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = ANCHOR_HREF_RE.exec(source)) !== null) {
    const href = (anchorMatch[2] ?? anchorMatch[3] ?? anchorMatch[4] ?? '').trim();
    if (href.length === 0 || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      let linkHost: string | null = null;
      try {
        linkHost = new URL(href.startsWith('//') ? `https:${href}` : href).host.toLowerCase().replace(/^www\./, '');
      } catch {
        linkHost = null;
      }
      if (host !== null && linkHost === host) internalLinkCount += 1;
      else externalLinkCount += 1;
    } else {
      internalLinkCount += 1;
    }
  }

  return {
    metaTitle,
    metaDescription,
    canonicalUrl,
    robots,
    h1,
    h1Count,
    jsonLdTypes: [...typeSet].sort(),
    wordCount,
    internalLinkCount,
    externalLinkCount,
  };
}

/**
 * Stable hash of the extracted elements.
 *
 * Key ordering is fixed by an explicit array rather than `JSON.stringify(obj)`
 * so that adding a field to SeoElements in future does not silently rehash
 * every historical row into "changed" — a new field appended to the list
 * changes the hash exactly once, deliberately, at the migration that adds it.
 */
export function hashSeoElements(elements: SeoElements): string {
  const canonical = [
    elements.metaTitle ?? '',
    elements.metaDescription ?? '',
    elements.canonicalUrl ?? '',
    elements.robots ?? '',
    elements.h1 ?? '',
    String(elements.h1Count),
    [...elements.jsonLdTypes].sort().join(','),
    String(elements.wordCount),
    String(elements.internalLinkCount),
    String(elements.externalLinkCount),
  ].join(' ');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Field-level diff of two snapshots. `null` on either side is a real value ("absent"), not a skip. */
export function diffSeoElements(
  before: SeoElements,
  after: SeoElements,
): Array<{ field: keyof SeoElements; before: string; after: string }> {
  const fields: Array<keyof SeoElements> = [
    'metaTitle',
    'metaDescription',
    'canonicalUrl',
    'robots',
    'h1',
    'h1Count',
    'jsonLdTypes',
    'wordCount',
    'internalLinkCount',
    'externalLinkCount',
  ];
  const render = (value: SeoElements[keyof SeoElements]): string => {
    if (value === null) return '';
    if (Array.isArray(value)) return [...value].sort().join(',');
    return String(value);
  };
  const out: Array<{ field: keyof SeoElements; before: string; after: string }> = [];
  for (const field of fields) {
    const b = render(before[field]);
    const a = render(after[field]);
    if (b !== a) out.push({ field, before: b, after: a });
  }
  return out;
}

// ---------------------------------------------------------------------------
// fetch (impure)
// ---------------------------------------------------------------------------

/** Throws SiteProviderError('invalid_input') for anything the SSRF guard rejects. */
export function assertSafeSiteUrl(rawUrl: string, providerName: string): URL {
  if (!isSafeFetchUrl(rawUrl)) {
    // The URL itself is echoed deliberately: it is operator-supplied
    // configuration, not a credential, and without it the error is
    // undiagnosable. Callers must still never pass a URL carrying a token.
    throw new SiteProviderError('invalid_input', providerName, `refusing to fetch unsafe url: ${rawUrl}`);
  }
  return new URL(rawUrl);
}

/** Reads at most `MAX_SNAPSHOT_BYTES` from a response body, then abandons the rest. */
async function readCapped(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return await res.text().then((t) => t.slice(0, MAX_SNAPSHOT_BYTES));

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_SNAPSHOT_BYTES) break;
    }
  } finally {
    // Releases the socket even when we bailed out early on the size cap.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_SNAPSHOT_BYTES).toString('utf8');
}

/**
 * Fetches one live page and extracts its SEO elements.
 *
 * Redirects are followed MANUALLY (max 3 hops) so the SSRF guard runs against
 * every hop, not just the first — see the file header. A non-2xx terminal
 * response is returned, not thrown: `httpStatus: 404` is a legitimate,
 * meaningful drift signal (`page_gone`), and the caller decides what it means.
 * Only a transport failure, an unsafe URL, or a redirect loop throws.
 */
export async function fetchLivePageSnapshot(
  pageUrl: string,
  opts: FetchLiveSnapshotOptions,
): Promise<LivePageSnapshot> {
  const { providerName, timeoutMs = DEFAULT_TIMEOUT_MS, keepBodyHtml = false, fetchImpl = fetch } = opts;

  let current = assertSafeSiteUrl(pageUrl, providerName).toString();
  let res: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    let hopRes: Response;
    try {
      hopRes = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          // Identifies the crawler honestly. A site owner who wants to block
          // us must be able to, and a UA that impersonates a browser would
          // make that impossible.
          'User-Agent': 'GrowthEscalatorsSEO/1.0 (+https://growthescalators.com/bot)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (e) {
      throw new SiteProviderError(
        'provider_unavailable',
        providerName,
        `fetch failed for ${current}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const location = hopRes.status >= 300 && hopRes.status < 400 ? hopRes.headers.get('location') : null;
    if (!location) {
      res = hopRes;
      break;
    }
    if (hop === MAX_REDIRECT_HOPS) {
      throw new SiteProviderError(
        'provider_unavailable',
        providerName,
        `too many redirects (${MAX_REDIRECT_HOPS}) starting from ${pageUrl}`,
      );
    }
    // Re-check the hop target. This is the whole reason redirect:'manual' is used.
    current = assertSafeSiteUrl(new URL(location, current).toString(), providerName).toString();
  }

  if (!res) {
    throw new SiteProviderError('provider_unavailable', providerName, `no response for ${pageUrl}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const isHtml = contentType.length === 0 || /html|xml/i.test(contentType);
  const html = isHtml ? await readCapped(res) : '';
  const elements = extractSeoElements(html, current);

  return {
    pageUrl,
    finalUrl: current !== pageUrl ? current : undefined,
    fetchedAt: new Date(),
    httpStatus: res.status,
    title: elements.h1 ?? undefined,
    metaTitle: elements.metaTitle ?? undefined,
    metaDescription: elements.metaDescription ?? undefined,
    canonicalUrl: elements.canonicalUrl ?? undefined,
    bodyHtml: keepBodyHtml ? html : undefined,
    elements,
    contentHash: hashSeoElements(elements),
  };
}
