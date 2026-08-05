// Shopify Admin REST implementation of SiteProvider. Talks to the real
// Shopify API — no mock behaviour lives here (that's mock.provider.ts).
//
// TWO GAPS IN THE SHARED INTERFACE THIS FILE WORKS AROUND (site-provider.
// interface.ts is not this file's to edit — flagged upstream, not patched
// here):
//   1. SiteRef carries no credential-pointer field (the seo_sites DB row has
//      `credential_provider`, but the adapter-facing SiteRef shape does not
//      expose it). Every site therefore resolves credentials through the
//      fixed `tenant_integrations.provider` key 'shopify' — see
//      requireCredentials() below.
//   2. Neither SiteStageResult nor ApprovedSiteChange carries the original
//      SiteChangeInput forward. Two things this adapter must still know at
//      verify/publish time — whether a (never-written, since writesCanonical
//      is false) canonicalUrl was requested, whether structuredData was
//      staged, and which redirectFrom URLs to create at publish — have
//      nowhere else to live. `stagedMemory` below is a small in-process Map
//      keyed by stagedRef, populated by stageChange and read by
//      verifyChange/publishChange. This works for the same-process
//      stage-then-publish flow this repo drives today; it does NOT survive a
//      process restart or a publish handled by a different provider
//      instance. If that ever becomes a real requirement, the fix is to add
//      the missing fields to the shared interface, not to grow this map into
//      a database.
//
// Credential hygiene: the access token is read from getDecryptedCredentials
// and used only as a request header value. It is never interpolated into a
// URL, a log line, or a SiteProviderError message — see AGENTS.md.
import logger from '../../../utils/logger';
import { getDecryptedCredentials } from '../../../services/tenantIntegrationsService';
import { assertSafeSiteUrl, fetchLivePageSnapshot } from '../liveSnapshot';
import {
  SITE_PROVIDER_CAPABILITY_MATRIX,
  SiteProviderError,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SiteLiveSnapshot,
  type SitePublishResult,
  type SiteProvider,
  type SiteProviderCapabilities,
  type SiteProviderConfigStatus,
  type SiteProviderIdentity,
  type SiteRef,
  type SiteStageResult,
  type SiteVerifyIssue,
  type SiteVerifyResult,
} from './site-provider.interface';

/**
 * Pinned Shopify Admin REST API version. Shopify retires versions on a
 * rolling ~1 year cadence; calling an unpinned "latest" path is a silent
 * breaking change waiting for whichever quarter Shopify retires whatever
 * happened to be current. Bump this deliberately, in its own reviewed
 * change — never as a side effect of an unrelated edit.
 */
const SHOPIFY_API_VERSION = '2024-10';

const REQUEST_TIMEOUT_MS = 15_000;

/** Hard cap on how much of a Shopify error body is ever embedded in a thrown message or log line. */
const MAX_ERROR_BODY_CHARS = 300;

// `global.title_tag` / `global.description_tag` are Shopify's native page-SEO
// fields — every Online Store 2.0 theme renders them into <title> and
// <meta name=description> with no snippet required. This is what makes
// writesMetaTitle/writesMetaDescription safe to claim unconditionally, unlike
// writesStructuredData below.
const SEO_METAFIELD_NAMESPACE = 'global';
const SEO_TITLE_TAG_KEY = 'title_tag';
const SEO_DESCRIPTION_TAG_KEY = 'description_tag';

// Custom metafield the theme snippet (site.adapterConfig.themeSnippetInstalled)
// must read and emit as JSON-LD for structured data to actually reach the
// rendered page — see requiresThemeSnippet on the shopify capability row.
const STRUCTURED_DATA_NAMESPACE = 'growth_escalators_seo';
const STRUCTURED_DATA_KEY = 'structured_data';

export interface ShopifyCredentials {
  /** Either the bare `*.myshopify.com` handle or the full myshopify hostname. */
  readonly shop: string;
  readonly accessToken: string;
}

export interface ShopifySiteProviderOptions {
  /** Injected for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests so a unit test never touches the DB or credentialEncryption. Defaults to getDecryptedCredentials. */
  readonly loadCredentials?: (tenantId: string, provider: string) => Promise<ShopifyCredentials | null>;
}

/** See the file-header GAP note — everything this adapter still needs to know at verify/publish time that the shared interface has no field for. */
interface StagedChangeMemory {
  readonly pageUrl: string;
  readonly canonicalUrlSupplied: boolean;
  readonly structuredDataSupplied: boolean;
  readonly redirectFrom: readonly string[];
}

interface ShopifyHttpResult {
  readonly status: number;
  readonly json: unknown;
}

export class ShopifySiteProvider implements SiteProvider {
  // Frozen for the same reason mock.provider.ts freezes these: a stray
  // mutation through one caller's reference must not rename/reshape the
  // instance every other caller shares.
  readonly identity: SiteProviderIdentity = Object.freeze({ name: 'shopify', version: '1.0.0' });
  readonly capabilities: SiteProviderCapabilities = Object.freeze({ ...SITE_PROVIDER_CAPABILITY_MATRIX.shopify });

  private readonly fetchImpl: typeof fetch;
  private readonly loadCredentialsImpl: (tenantId: string, provider: string) => Promise<ShopifyCredentials | null>;
  private readonly stagedMemory = new Map<string, StagedChangeMemory>();

  constructor(options: ShopifySiteProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.loadCredentialsImpl =
      options.loadCredentials ?? ((tenantId, provider) => getDecryptedCredentials<ShopifyCredentials>(tenantId, provider));
  }

  /**
   * Synchronous by interface — cannot call getDecryptedCredentials (a DB
   * read + decrypt) from here, deliberately: getConfigStatus must be cheap
   * enough to call in a list view over every registered site. SiteRef also
   * carries no credential-pointer field (file-header GAP 1), so the only
   * thing this method can check without network/DB I/O is `site.domain`
   * (needed to resolve which shop we would even be targeting) and
   * `site.adapterConfig` (non-secret, already in memory on the caller's
   * SiteRef). A genuinely missing/invalid credential only surfaces later,
   * when stageChange/publishChange actually call getDecryptedCredentials and
   * get back null.
   */
  getConfigStatus(site: SiteRef): SiteProviderConfigStatus {
    if (!site.domain || site.domain.trim().length === 0) {
      return { status: 'not_configured', reason: 'site.domain is required to resolve the Shopify shop' };
    }

    // requiresThemeSnippet is a static per-PLATFORM fact (true for every
    // shopify site); whether THIS site's theme actually has the snippet
    // installed is per-site config, so it is read from adapterConfig here,
    // not baked into `capabilities`. Without the snippet,
    // writesStructuredData's output lands in a metafield nothing on the
    // storefront reads — configured, but functionally inert, which is why
    // this is its own 'misconfigured' status rather than silently 'ready'.
    if (this.capabilities.requiresThemeSnippet && site.adapterConfig?.themeSnippetInstalled !== true) {
      return { status: 'misconfigured', reason: 'theme_snippet_missing' };
    }

    return { status: 'ready' };
  }

  async stageChange(site: SiteRef, change: SiteChangeInput): Promise<SiteStageResult> {
    this.assertSiteRef(site);
    this.validateChangeInput(change);
    const { shop, accessToken } = await this.requireCredentials(site);

    const handle = derivePageHandle(change.pageUrl);
    if (!handle) {
      throw new SiteProviderError('invalid_input', this.identity.name, `change.pageUrl "${change.pageUrl}" has no path segment to use as a Shopify page handle`);
    }

    let pageId: string;
    if (change.isNewPage) {
      const created = await this.call(shop, accessToken, 'POST', 'pages.json', {
        page: { title: change.title ?? change.pageUrl, body_html: change.bodyHtml ?? '', handle, published: false },
      });
      if (created.status !== 201) this.throwForStatus(created.status, 'pages.json', created.json);
      pageId = extractPageId(created.json, this.identity.name);
    } else {
      // No "get page by id to update" input exists on SiteChangeInput either
      // — pageUrl's trailing segment doubles as the Shopify page handle, and
      // pages.json?handle= is the lookup Shopify's REST API offers for it.
      const existingId = await this.findPageIdByHandle(shop, accessToken, handle);
      if (!existingId) {
        throw new SiteProviderError('invalid_input', this.identity.name, `no shopify page found for handle "${handle}" — cannot stage an update`);
      }
      pageId = existingId;
      const updated = await this.call(shop, accessToken, 'PUT', `pages/${pageId}.json`, {
        page: { id: Number(pageId), title: change.title, body_html: change.bodyHtml, published: false },
      });
      if (updated.status !== 200) this.throwForStatus(updated.status, `pages/${pageId}.json`, updated.json);
    }

    if (change.metaTitle !== undefined) {
      await this.writeMetafield(shop, accessToken, pageId, SEO_METAFIELD_NAMESPACE, SEO_TITLE_TAG_KEY, change.metaTitle);
    }
    if (change.metaDescription !== undefined) {
      await this.writeMetafield(shop, accessToken, pageId, SEO_METAFIELD_NAMESPACE, SEO_DESCRIPTION_TAG_KEY, change.metaDescription);
    }
    if (change.structuredData !== undefined) {
      // Written unconditionally, regardless of themeSnippetInstalled: the
      // data really is staged on Shopify's side either way, and withholding
      // the write would make a later verify-after-installing-the-snippet
      // pass have nothing to diff against. Whether it RENDERS depends on the
      // snippet — that gap is reported as a verifyChange warning, not by
      // silently skipping the write here.
      await this.writeMetafield(
        shop, accessToken, pageId, STRUCTURED_DATA_NAMESPACE, STRUCTURED_DATA_KEY, JSON.stringify(change.structuredData), 'json',
      );
    }

    this.stagedMemory.set(pageId, {
      pageUrl: change.pageUrl,
      canonicalUrlSupplied: change.canonicalUrl !== undefined,
      structuredDataSupplied: change.structuredData !== undefined,
      redirectFrom: change.redirectFrom ?? [],
    });

    return {
      stagedRef: pageId,
      // Shopify has no public preview URL for an unpublished page — it 404s
      // on the storefront until published. The admin deep-link is the only
      // stable pre-publish "preview" Shopify offers; it requires staff auth,
      // same as clicking through from the Pages list in admin.
      previewUrl: `https://${shop}/admin/pages/${pageId}`,
      diff: undefined,
      createdAt: new Date(),
    };
  }

  async verifyChange(site: SiteRef, staged: SiteStageResult): Promise<SiteVerifyResult> {
    this.assertSiteRef(site);
    if (!staged.stagedRef || staged.stagedRef.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'staged.stagedRef is required');
    }
    const { shop, accessToken } = await this.requireCredentials(site);

    // verifiesOffline is false — there is no build/lint step to run against
    // a hosted page. The honest statement is "we did not check", not silence.
    const issues: SiteVerifyIssue[] = [
      { severity: 'warning', code: 'no_offline_verification', message: 'this provider cannot run offline build/lint checks before publish' },
    ];

    const res = await this.call(shop, accessToken, 'GET', `pages/${staged.stagedRef}.json`);
    if (res.status === 404) {
      issues.push({
        severity: 'blocking',
        code: 'staged_page_not_found',
        message: `staged page ${staged.stagedRef} no longer exists on shopify`,
      });
    } else {
      if (res.status !== 200) this.throwForStatus(res.status, `pages/${staged.stagedRef}.json`, res.json);
      const page = extractPage(res.json, this.identity.name);
      if (page.published_at) {
        issues.push({
          severity: 'blocking',
          code: 'staged_page_already_published',
          message: `staged page ${staged.stagedRef} is already live — the staged/verify/publish pipeline's precondition (still a draft) does not hold`,
        });
      }

      const memory = this.stagedMemory.get(staged.stagedRef);
      if (memory?.canonicalUrlSupplied) {
        issues.push({
          severity: 'warning',
          code: 'canonical_not_writable',
          message: 'writesCanonical is false for shopify (canonical is theme-emitted) — the supplied canonicalUrl was not written anywhere',
        });
      }
      const themeSnippetInstalled = site.adapterConfig?.themeSnippetInstalled === true;
      if (memory?.structuredDataSupplied && !themeSnippetInstalled) {
        issues.push({
          severity: 'warning',
          code: 'theme_snippet_missing',
          message: 'structured data was staged to a metafield but the theme snippet is not installed — it will not render on-page',
        });
      }
    }

    return { passed: !issues.some((i) => i.severity === 'blocking'), issues, verifiedAt: new Date() };
  }

  async publishChange(site: SiteRef, approved: ApprovedSiteChange): Promise<SitePublishResult> {
    this.assertSiteRef(site);

    // Unconditional, before any network call — the hard-stop-before-publish
    // invariant. No scenario, flag, or credential state can bypass this.
    if (!approved.approvedBy || approved.approvedBy.trim().length === 0) {
      throw new SiteProviderError(
        'unauthorised_publish',
        this.identity.name,
        `change ${approved.stagedRef || '(no stagedRef)'} has no approvedBy — refusing to publish`,
      );
    }
    if (!approved.stagedRef || approved.stagedRef.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'approved.stagedRef is required');
    }

    const { shop, accessToken } = await this.requireCredentials(site);
    const pageId = approved.stagedRef;

    // supportsIdempotentPublish: read first so a retried publishRequestId
    // against an already-published page is a no-op read, never a second write.
    const existing = await this.call(shop, accessToken, 'GET', `pages/${pageId}.json`);
    if (existing.status === 404) {
      throw new SiteProviderError('invalid_input', this.identity.name, `staged page ${pageId} no longer exists on shopify`);
    }
    if (existing.status !== 200) this.throwForStatus(existing.status, `pages/${pageId}.json`, existing.json);
    const page = extractPage(existing.json, this.identity.name);

    if (page.published_at) {
      this.stagedMemory.delete(pageId);
      return { status: 'published', liveUrl: `https://${site.domain}/pages/${page.handle}`, externalRef: pageId };
    }

    const updated = await this.call(shop, accessToken, 'PUT', `pages/${pageId}.json`, { page: { id: Number(pageId), published: true } });
    if (updated.status !== 200) this.throwForStatus(updated.status, `pages/${pageId}.json`, updated.json);
    const updatedPage = extractPage(updated.json, this.identity.name);
    const liveUrl = `https://${site.domain}/pages/${updatedPage.handle}`;

    // Redirects have no draft state on Shopify — creating one while the
    // target page was still unpublished would send live traffic at a 404 the
    // instant the redirect took effect (redirects apply immediately; publish
    // is what was staged). So they are created here, after the page write
    // above succeeds, never in stageChange.
    const memory = this.stagedMemory.get(pageId);
    for (const fromUrl of memory?.redirectFrom ?? []) {
      try {
        const redirectRes = await this.call(shop, accessToken, 'POST', 'redirects.json', {
          redirect: { path: toPath(fromUrl), target: `/pages/${updatedPage.handle}` },
        });
        if (redirectRes.status !== 201) {
          // The publish already happened and must not be rolled back for a
          // redirect failure — reported honestly as a structured warning
          // rather than swallowed (a silent failure here just means a stale
          // URL 404s with nobody knowing to go fix it) or thrown (throwing
          // would misreport a successful publish as a failed one).
          logger.warn('[shopify.provider] redirect creation failed after publish', { siteId: site.id, pageId, status: redirectRes.status });
        }
      } catch (e) {
        logger.warn('[shopify.provider] redirect creation threw after publish', { siteId: site.id, pageId, error: e instanceof Error ? e.message : String(e) });
      }
    }

    this.stagedMemory.delete(pageId);
    return { status: 'published', liveUrl, externalRef: pageId };
  }

  async fetchLiveSnapshot(site: SiteRef, pageUrl: string): Promise<SiteLiveSnapshot> {
    this.assertSiteRef(site);
    return fetchLivePageSnapshot(pageUrl, { providerName: this.identity.name, fetchImpl: this.fetchImpl });
  }

  // ---- internals -------------------------------------------------------------

  private assertSiteRef(site: SiteRef): void {
    if (typeof site.tenantId !== 'string' || site.tenantId.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'site.tenantId is required');
    }
    if (typeof site.id !== 'string' || site.id.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'site.id is required');
    }
  }

  private validateChangeInput(change: SiteChangeInput): void {
    if (!change.changeId || change.changeId.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'change.changeId is required');
    }
    if (!change.pageUrl || change.pageUrl.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'change.pageUrl is required');
    }
  }

  /** See file-header GAP 1 — 'shopify' is the fixed tenant_integrations.provider key every site resolves through. */
  private async requireCredentials(site: SiteRef): Promise<ShopifyCredentials> {
    const creds = await this.loadCredentialsImpl(site.tenantId, 'shopify');
    if (!creds || !creds.shop || !creds.accessToken) {
      throw new SiteProviderError('missing_configuration', this.identity.name, `no shopify credentials configured for site ${site.id}`);
    }
    return creds;
  }

  private shopApiUrl(shop: string, path: string): URL {
    const host = shop.includes('.') ? shop : `${shop}.myshopify.com`;
    return assertSafeSiteUrl(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/${path}`, this.identity.name);
  }

  private async call(shop: string, accessToken: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<ShopifyHttpResult> {
    const url = this.shopApiUrl(shop, path);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Never logged, never embedded in a URL — header value only.
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      // Covers both a transport failure and AbortSignal.timeout firing.
      throw new SiteProviderError('provider_unavailable', this.identity.name, `shopify request failed for ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }

    const text = await res.text();
    if (text.length === 0) return { status: res.status, json: null };
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      throw new SiteProviderError('provider_response_invalid', this.identity.name, `shopify returned non-JSON response for ${path} (status ${res.status})`);
    }
  }

  private async writeMetafield(
    shop: string, accessToken: string, pageId: string, namespace: string, key: string, value: string,
    type: 'single_line_text_field' | 'json' = 'single_line_text_field',
  ): Promise<void> {
    const res = await this.call(shop, accessToken, 'POST', `pages/${pageId}/metafields.json`, { metafield: { namespace, key, value, type } });
    if (res.status !== 200 && res.status !== 201) this.throwForStatus(res.status, `pages/${pageId}/metafields.json`, res.json);
  }

  private async findPageIdByHandle(shop: string, accessToken: string, handle: string): Promise<string | null> {
    const res = await this.call(shop, accessToken, 'GET', `pages.json?handle=${encodeURIComponent(handle)}`);
    if (res.status !== 200) this.throwForStatus(res.status, 'pages.json', res.json);
    const pages = extractPagesArray(res.json, this.identity.name);
    const first = pages[0];
    return first ? String(first.id) : null;
  }

  /** Maps a non-2xx Shopify response onto the SiteProviderError union honestly. Never called for a status this method's caller already handled inline (e.g. a meaningful 404). */
  private throwForStatus(status: number, path: string, json: unknown): never {
    if (status === 401 || status === 403) {
      throw new SiteProviderError('missing_configuration', this.identity.name, `shopify rejected credentials for ${path} (status ${status})`);
    }
    if (status === 429) {
      // Shopify's leaky-bucket rate limiter (Retry-After / the
      // X-Shopify-Shop-Api-Call-Limit header). No retry loop here on
      // purpose: a blind retry inside a single synchronous adapter call
      // risks compounding a rate-limit storm across every concurrent caller
      // hitting this shop. Retry/backoff belongs one layer up (a queue or
      // cron), where it can be coordinated across all callers, not
      // reinvented per-call here.
      throw new SiteProviderError('provider_unavailable', this.identity.name, `shopify rate-limited ${path} (429 — respect Retry-After; no retry attempted)`);
    }
    if (status >= 500) {
      throw new SiteProviderError('provider_unavailable', this.identity.name, `shopify server error for ${path} (status ${status})`);
    }
    if (status >= 400) {
      throw new SiteProviderError('invalid_input', this.identity.name, `shopify rejected the request for ${path} (status ${status}): ${truncateVendorBody(json)}`);
    }
    throw new SiteProviderError('provider_response_invalid', this.identity.name, `shopify returned unexpected status ${status} for ${path}: ${truncateVendorBody(json)}`);
  }
}

function truncateVendorBody(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = '[unserialisable response body]';
  }
  return text.length > MAX_ERROR_BODY_CHARS ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}…(truncated)` : text;
}

/** Last non-empty path segment of pageUrl, lowercased — doubles as the Shopify page handle. */
function derivePageHandle(pageUrl: string): string {
  const withoutOrigin = pageUrl.trim().replace(/^https?:\/\/[^/]+/i, '');
  const segments = withoutOrigin.split('/').filter((s) => s.length > 0);
  return (segments[segments.length - 1] ?? '').toLowerCase();
}

function toPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
}

interface ShopifyPageShape {
  readonly id: string;
  readonly handle: string;
  readonly published_at: unknown;
}

function extractPage(json: unknown, providerName: string): ShopifyPageShape {
  const page = (json as { page?: Record<string, unknown> } | null)?.page;
  if (!page || (typeof page.id !== 'number' && typeof page.id !== 'string') || typeof page.handle !== 'string') {
    throw new SiteProviderError('provider_response_invalid', providerName, 'shopify page response missing page.id/page.handle');
  }
  return { id: String(page.id), handle: page.handle, published_at: page.published_at };
}

function extractPageId(json: unknown, providerName: string): string {
  return extractPage(json, providerName).id;
}

function extractPagesArray(json: unknown, providerName: string): ReadonlyArray<{ id: unknown }> {
  const pages = (json as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) {
    throw new SiteProviderError('provider_response_invalid', providerName, 'shopify pages response missing pages array');
  }
  return pages as ReadonlyArray<{ id: unknown }>;
}
