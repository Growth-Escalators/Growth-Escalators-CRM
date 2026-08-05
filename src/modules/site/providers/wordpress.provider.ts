// WordPress SiteProvider — talks to a tenant's self-hosted/managed WordPress
// site over its own REST API (`/wp-json/wp/v2/pages`), authenticated with a
// WP "application password" (https://wordpress.org/documentation/article/application-passwords/),
// never the account password.
//
// ============================================================================
// SECURITY — DELIBERATELY UNREACHABLE FROM THE LEAKED AGeD CREDENTIALS
// ============================================================================
// The legacy path (src/services/programmaticSeoService.ts `publishToWordPress`)
// authenticates via WP_AGEDDENTISTRY_URL / WP_AGEDDENTISTRY_USER /
// WP_AGEDDENTISTRY_PASS(_WORD). Those application-password values are KNOWN
// LEAKED and pending rotation. This module MUST NOT — and does not — read any
// `WP_*` environment variable anywhere, for any reason: no fallback base URL,
// no default credential, not even for local dev. `src/__tests__/
// siteProviderWordPress.test.ts` asserts this by regex-scanning this file's
// own source, as a permanent guard against the leaked vars creeping back in.
//
// Credentials come from EXACTLY ONE place: `getDecryptedCredentials(tenantId,
// site.credentialProvider-equivalent)` (see CREDENTIAL RESOLUTION below).
// Absent/unusable credentials fail closed with `missing_configuration` —
// never a silent fallback to some other credential source.
//
// This adapter stays gated off in practice regardless: `getSiteProvider()`
// (./index.ts) only ever constructs it when `SITE_ADAPTER_ENABLED=true` and
// `SITE_PROVIDER=wordpress` are both set, which is not done anywhere today.
// It stays that way until the AGeD credential rotation lands — see the
// SECRETS-ROTATION checklist referenced from AGENTS.md's guardrail table.
//
// No credential, token, or PII value is ever written into a comment, a log
// line, or a thrown SiteProviderError message anywhere in this file — only
// non-secret identifiers (site id, tenant id, WP post id/slug, HTTP status).
//
// ============================================================================
// DEVIATIONS FROM THE ORIGINAL BRIEF (flagged per that brief's own request —
// "I make factual errors in these briefs, flag them rather than forcing them
// to fit")
// ============================================================================
// 1. CREDENTIAL RESOLUTION — RESOLVED, note kept for the history. When this
//    adapter was written, `SiteRef` had no `credentialProvider` field, so it
//    read `adapterConfig.credentialProvider` instead. `SiteRef` now carries
//    the field (it maps straight from `seo_sites.credential_provider`), and
//    the adapterConfig fallback has been REMOVED — not merely superseded. It
//    was unreachable code that looked like a feature:
//    `seoSiteRegistry.assertNoSecretKeys()` rejects any adapterConfig key
//    matching /pass|secret|token|key|credential|auth/i with a 400 and has done
//    since the registry's first commit, and the registry is the only writer of
//    that column — so no row could ever have held it. See
//    `resolveCredentialProviderName`.
// 2. VERIFY-TIME CAPABILITY WARNINGS. The brief asks `verifyChange` to warn
//    when a staged change supplied a `canonicalUrl`/`redirectFrom` this
//    platform cannot write (writesCanonical/writesRedirects are both false).
//    But `verifyChange(site, staged)` receives only a `SiteStageResult` —
//    never the original `SiteChangeInput` — so there is nothing to inspect at
//    verify time. This adapter therefore has `stageChange` record which
//    capability-violating fields it dropped, in an in-process
//    `Map<string, readonly SiteVerifyIssue[]>` keyed by
//    `tenantId:siteId:stagedRef` (see `droppedFieldsByStagedRef`), and
//    `verifyChange` re-surfaces them from that map. This is intentionally
//    NOT persisted anywhere — it is lost on process restart, and grows for
//    the life of the process (a stagedRef's entry is never evicted). Both are
//    accepted V1 limitations, not oversights: a process restart between stage
//    and verify is rare enough in the human-approval workflow this module
//    serves, and a real fix (persisting alongside the staged change row) is
//    schema-adjacent work outside this file's scope.
// 3. UPDATE-PATH POST ID RESOLUTION. `SiteChangeInput` carries no WordPress
//    post id field, so an update (`change.isNewPage === false`) resolves the
//    existing post by slug via `GET /wp-json/wp/v2/pages?slug=...&status=any`
//    — the brief explicitly offered this as one of two options. `status=any`
//    is required so an already-staged draft (not yet published) is still
//    found.
// 4. META-TITLE / META-DESCRIPTION / STRUCTURED-DATA FIELD MAPPING. The
//    wordpress row in SITE_PROVIDER_CAPABILITY_MATRIX declares
//    writesMetaTitle/writesMetaDescription/writesStructuredData all TRUE, but
//    WP core has no native field for any of the three — every real WP site
//    that has them relies on an SEO plugin (Yoast, RankMath, ...) registering
//    its own post-meta keys, and neither the brief nor SiteRef pins which
//    plugin a given tenant runs. Absent that information, this writes the
//    Yoast key convention (`_yoast_wpseo_title` / `_yoast_wpseo_metadesc`) as
//    a best-effort default — see `buildPagePayload`. WordPress silently
//    ignores post-meta keys nothing has `register_post_meta`'d, so on a site
//    without Yoast this degrades to a harmless no-op rather than an error.
//    Flagging this as an assumption to confirm, not a documented contract.
import { getDecryptedCredentials } from '../../../services/tenantIntegrationsService';
import { isSafeFetchUrl } from '../../../utils/ssrfGuard';
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

const DEFAULT_TIMEOUT_MS = 15_000;

/** Cap on the stage-time fallback Map — see droppedFieldsByStagedRef. */
const MAX_DROPPED_FIELD_ENTRIES = 500;

/**
 * The warnings for fields a caller asked for that this platform cannot write.
 *
 * Pure, and shared by stageChange (which records them as a fallback) and
 * verifyChange (which recomputes them from the caller's change). One function
 * rather than two copies, because the two paths disagreeing would mean an
 * operator saw a different set of caveats depending on whether verification
 * happened to run in the same process as staging.
 */
function computeUnwritableFieldIssues(
  capabilities: SiteProviderCapabilities,
  change: SiteChangeInput,
): SiteVerifyIssue[] {
  const dropped: SiteVerifyIssue[] = [];
  if (!capabilities.writesCanonical && change.canonicalUrl !== undefined) {
    dropped.push({
      severity: 'warning',
      code: 'canonical_not_writable',
      message: 'wordpress cannot write a canonical URL without an SEO plugin (Yoast/RankMath) — canonicalUrl was not applied',
    });
  }
  if (!capabilities.writesRedirects && change.redirectFrom !== undefined && change.redirectFrom.length > 0) {
    dropped.push({
      severity: 'warning',
      code: 'redirects_not_writable',
      message: 'wordpress cannot write redirects without a redirect plugin — redirectFrom was not applied',
    });
  }
  return dropped;
}

/**
 * Decrypted shape of the `tenant_integrations` payload this adapter expects
 * for whichever provider name it resolves (see DEVIATION 1 above). An
 * "application password", not the WordPress account password.
 */
export interface WordPressCredentials {
  readonly username: string;
  readonly applicationPassword: string;
}

function isWordPressCredentials(value: unknown): value is WordPressCredentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.username === 'string' && v.username.trim().length > 0 &&
    typeof v.applicationPassword === 'string' && v.applicationPassword.trim().length > 0
  );
}

/** The subset of a WP `wp/v2/pages` REST object this adapter actually reads. */
interface WpPageResponse {
  readonly id: number;
  readonly status: string;
  readonly link: string;
  readonly slug: string;
  readonly preview_link?: string;
}

function isWpPageResponse(value: unknown): value is WpPageResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'number' && typeof v.status === 'string' && typeof v.link === 'string' && typeof v.slug === 'string';
}

/**
 * WordPress pages are addressed by their OWN slug, not a full path.
 * `SiteChangeInput.pageUrl` is a path like `/services/dental-implants`, so
 * this takes the last non-empty path segment. Nested WP page hierarchies
 * (parent/child slugs) are out of scope for this adapter — every page it
 * writes is addressed by its own flat slug.
 */
function derivePageSlug(pageUrl: string): string {
  const withoutQueryOrHash = (pageUrl ?? '').split(/[?#]/)[0] ?? '';
  const segments = withoutQueryOrHash.split('/').filter((s) => s.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

function endpoint(baseUrl: URL, path: string): string {
  const base = baseUrl.toString().replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

/** Constructor injection points — see class doc. Both default to the real thing; tests always override both. */
export interface WordPressSiteProviderDeps {
  readonly fetchImpl?: typeof fetch;
  readonly loadCredentials?: typeof getDecryptedCredentials;
}

export class WordPressSiteProvider implements SiteProvider {
  readonly identity: SiteProviderIdentity = Object.freeze({ name: 'wordpress', version: '1.0.0' });
  readonly capabilities: SiteProviderCapabilities = Object.freeze({ ...SITE_PROVIDER_CAPABILITY_MATRIX.wordpress });

  private readonly fetchImpl: typeof fetch;
  private readonly loadCredentials: typeof getDecryptedCredentials;

  // See DEVIATION 2 above. Keyed by `${tenantId}:${siteId}:${stagedRef}` so
  // no two sites/tenants can ever read each other's warnings — same
  // isolation rule mock.provider.ts uses for its own per-site state.
  // Fallback only — see DEVIATION 2. Bounded because an unbounded Map keyed by
  // a per-change ref grows for the life of the process; a long-running worker
  // staging changes all day would leak steadily.
  private readonly droppedFieldsByStagedRef = new Map<string, readonly SiteVerifyIssue[]>();

  constructor(deps: WordPressSiteProviderDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.loadCredentials = deps.loadCredentials ?? getDecryptedCredentials;
  }

  /**
   * SYNCHRONOUS by interface — and that is a feature, not a limitation: it
   * makes it structurally impossible for a readiness check to decrypt (or
   * otherwise resolve) a credential merely by being called. This checks only
   * that the required POINTERS are present and that the configured base URL
   * is not an SSRF target — never whether the credentials actually
   * authenticate, which only stageChange/verifyChange/publishChange (async,
   * DB- and network-touching) can determine.
   */
  getConfigStatus(site: SiteRef): SiteProviderConfigStatus {
    const baseUrl = this.getBaseUrlConfig(site);
    if (!baseUrl) {
      return { status: 'not_configured', reason: 'adapterConfig.baseUrl is not set for this WordPress site' };
    }
    if (!isSafeFetchUrl(baseUrl)) {
      return { status: 'misconfigured', reason: `adapterConfig.baseUrl is not a safe http(s) URL: ${baseUrl}` };
    }
    // A blank (rather than absent) pointer is a misconfiguration worth naming:
    // absent means "use the default", blank means somebody meant to set it and
    // saved an empty box.
    if (typeof site.credentialProvider === 'string' && site.credentialProvider.trim().length === 0) {
      return { status: 'misconfigured', reason: 'credentialProvider is set but empty' };
    }
    return { status: 'ready' };
  }

  async stageChange(site: SiteRef, change: SiteChangeInput): Promise<SiteStageResult> {
    this.assertSiteRef(site);
    this.validateChangeInput(change);
    const baseUrl = this.resolveBaseUrl(site);
    const credentials = await this.loadWordPressCredentials(site);

    const slug = derivePageSlug(change.pageUrl);
    const payload = this.buildPagePayload(change, slug);

    let page: WpPageResponse;
    if (change.isNewPage) {
      const { json } = await this.wpFetch(site, credentials, 'POST', endpoint(baseUrl, 'wp-json/wp/v2/pages'), payload);
      if (!isWpPageResponse(json)) {
        throw new SiteProviderError(
          'provider_response_invalid',
          this.identity.name,
          `wordpress returned an unexpected page shape creating change=${change.changeId}`,
        );
      }
      page = json;
    } else {
      // See DEVIATION 3 above.
      const existingId = await this.findPageIdBySlug(site, credentials, baseUrl, slug);
      if (existingId === null) {
        throw new SiteProviderError(
          'invalid_input',
          this.identity.name,
          `change.isNewPage is false but no wordpress page with slug "${slug}" exists to update (change=${change.changeId})`,
        );
      }
      const { json } = await this.wpFetch(
        site, credentials, 'POST', endpoint(baseUrl, `wp-json/wp/v2/pages/${existingId}`), payload,
      );
      if (!isWpPageResponse(json)) {
        throw new SiteProviderError(
          'provider_response_invalid',
          this.identity.name,
          `wordpress returned an unexpected page shape updating change=${change.changeId}`,
        );
      }
      page = json;
    }

    const stagedRef = String(page.id);
    // previewUrl is REQUIRED here (never undefined): capabilities.stagesRemoteDraft
    // is true for wordpress. Prefer WP's own preview_link when present; the
    // `?preview=true` query param is WP's documented fallback for a draft's link.
    const previewUrl = page.preview_link ?? `${page.link}${page.link.includes('?') ? '&' : '?'}preview=true`;

    this.recordDroppedFields(site, stagedRef, change);

    return { stagedRef, previewUrl, diff: undefined, createdAt: new Date() };
  }

  async verifyChange(site: SiteRef, staged: SiteStageResult, change?: SiteChangeInput): Promise<SiteVerifyResult> {
    this.assertSiteRef(site);
    if (!staged.stagedRef || staged.stagedRef.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'staged.stagedRef is required');
    }

    const issues: SiteVerifyIssue[] = [
      // verifiesOffline is false for wordpress — there is no WP-side
      // build/lint/link check this adapter can run before publish.
      {
        severity: 'warning',
        code: 'no_offline_verification',
        message: 'wordpress cannot run offline build/lint checks before publish',
      },
    ];

    // Recomputed from the caller's change when one is supplied, and only read
    // from stage-time memory otherwise. Verification usually runs in a
    // different process from staging, where that Map is empty — deriving these
    // warnings from it alone meant they silently vanished exactly when an
    // operator was about to approve the change.
    const dropped = change
      ? computeUnwritableFieldIssues(this.capabilities, change)
      : (this.droppedFieldsByStagedRef.get(this.stagedKey(site, staged.stagedRef)) ?? []);
    issues.push(...dropped);

    const baseUrl = this.resolveBaseUrl(site);
    const credentials = await this.loadWordPressCredentials(site);
    const url = endpoint(baseUrl, `wp-json/wp/v2/pages/${encodeURIComponent(staged.stagedRef)}?context=edit`);

    try {
      const { json } = await this.wpFetch(site, credentials, 'GET', url);
      if (!isWpPageResponse(json)) {
        throw new SiteProviderError(
          'provider_response_invalid',
          this.identity.name,
          `wordpress returned an unexpected page shape re-reading staged=${staged.stagedRef}`,
        );
      }
      if (json.status === 'publish') {
        issues.push({
          severity: 'blocking',
          code: 'staged_ref_already_published',
          message: `staged ref ${staged.stagedRef} is already live on wordpress`,
        });
      } else if (json.status !== 'draft') {
        issues.push({
          severity: 'warning',
          code: 'staged_ref_unexpected_status',
          message: `staged ref ${staged.stagedRef} has unexpected wordpress status "${json.status}"`,
        });
      }
    } catch (e) {
      // A staged ref that 404s (wpFetch maps 404 -> invalid_input) has
      // vanished server-side since staging — a blocking verify issue, not a
      // thrown error, per the brief: verifyChange reports, it does not throw
      // for a condition it exists to detect.
      if (e instanceof SiteProviderError && e.code === 'invalid_input') {
        issues.push({
          severity: 'blocking',
          code: 'staged_ref_not_found',
          message: `staged ref ${staged.stagedRef} no longer exists on wordpress`,
        });
      } else {
        throw e;
      }
    }

    const passed = !issues.some((i) => i.severity === 'blocking');
    return { passed, issues, verifiedAt: new Date() };
  }

  async publishChange(site: SiteRef, approved: ApprovedSiteChange): Promise<SitePublishResult> {
    this.assertSiteRef(site);

    // Hard stop, checked BEFORE any credential lookup or network call and
    // unconditionally on every call — an absent/blank approvedBy is never
    // treated as implicit approval, matching MockSiteProvider's contract.
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

    const baseUrl = this.resolveBaseUrl(site);
    const credentials = await this.loadWordPressCredentials(site);
    const readUrl = endpoint(baseUrl, `wp-json/wp/v2/pages/${encodeURIComponent(approved.stagedRef)}?context=edit`);

    // supportsIdempotentPublish is true: WordPress has no publish-idempotency
    // key of its own, so a retried publishChange call for the same
    // publishRequestId must not re-fire the write. Reading current status
    // first and short-circuiting on already-'publish' is how that's honoured.
    const { json: current } = await this.wpFetch(site, credentials, 'GET', readUrl);
    if (!isWpPageResponse(current)) {
      throw new SiteProviderError(
        'provider_response_invalid',
        this.identity.name,
        `wordpress returned an unexpected page shape reading staged=${approved.stagedRef}`,
      );
    }
    if (current.status === 'publish') {
      return { status: 'published', liveUrl: current.link, externalRef: String(current.id) };
    }

    const writeUrl = endpoint(baseUrl, `wp-json/wp/v2/pages/${encodeURIComponent(approved.stagedRef)}`);
    const { json: published } = await this.wpFetch(site, credentials, 'POST', writeUrl, { status: 'publish' });
    if (!isWpPageResponse(published)) {
      throw new SiteProviderError(
        'provider_response_invalid',
        this.identity.name,
        `wordpress returned an unexpected page shape publishing staged=${approved.stagedRef}`,
      );
    }
    // Never handoff_required here — WordPress always publishes via a direct
    // API call (publishesViaApi: true, publishesViaMerge: false).
    return { status: 'published', liveUrl: published.link, externalRef: String(published.id) };
  }

  async fetchLiveSnapshot(site: SiteRef, pageUrl: string): Promise<SiteLiveSnapshot> {
    this.assertSiteRef(site);
    // Shared across all three platforms — see liveSnapshot.ts's file header
    // for why this is not hand-rolled per adapter. `pageUrl` here is the live
    // page's own URL, independent of `site.adapterConfig.baseUrl`.
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

  private getBaseUrlConfig(site: SiteRef): string | undefined {
    const value = site.adapterConfig?.baseUrl;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }


  /** See DEVIATION 1 above. */
  /**
   * Resolves which `tenant_integrations` row holds this site's credentials.
   *
   * `site.credentialProvider` (the `seo_sites.credential_provider` column) is
   * the only source. An earlier version of this method also fell back to
   * `adapterConfig.credentialProvider`, on the reasoning that this adapter had
   * shipped reading it there and existing rows must keep working. That
   * reasoning was wrong, and the fallback was dead code that looked like a
   * feature: `seoSiteRegistry.assertNoSecretKeys()` rejects any adapterConfig
   * key matching /pass|secret|token|key|credential|auth/i with a 400, and it
   * has done so since the registry's first commit — so no row has ever been
   * able to hold that key, and the registry is the only writer of the column.
   *
   * Removed rather than left in, because the failure mode of keeping it is
   * that someone debugging a credential problem sets
   * `adapterConfig.credentialProvider`, gets an unexplained 400, and has no
   * way to tell that the path they were aiming at never existed.
   */
  private resolveCredentialProviderName(site: SiteRef): string {
    const fromRef = typeof site.credentialProvider === 'string' ? site.credentialProvider.trim() : '';
    return fromRef.length > 0 ? fromRef : 'wordpress';
  }

  /** Re-validated on every call, not cached from getConfigStatus — adapterConfig is admin-editable and could change between a readiness check and a call. */
  private resolveBaseUrl(site: SiteRef): URL {
    const raw = this.getBaseUrlConfig(site);
    if (!raw) {
      throw new SiteProviderError(
        'missing_configuration',
        this.identity.name,
        `adapterConfig.baseUrl is not set for site=${site.id}`,
      );
    }
    return assertSafeSiteUrl(raw, this.identity.name);
  }

  private async loadWordPressCredentials(site: SiteRef): Promise<WordPressCredentials> {
    const providerName = this.resolveCredentialProviderName(site);
    const credentials = await this.loadCredentials<WordPressCredentials>(site.tenantId, providerName);
    if (!credentials || !isWordPressCredentials(credentials)) {
      throw new SiteProviderError(
        'missing_configuration',
        this.identity.name,
        `no usable wordpress credentials for tenant=${site.tenantId} site=${site.id} (integration "${providerName}")`,
      );
    }
    return credentials;
  }

  private authHeader(credentials: WordPressCredentials): string {
    return `Basic ${Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString('base64')}`;
  }

  /**
   * One authenticated WP REST call. Maps transport/HTTP outcomes onto the
   * SiteProviderError union (see file header for the full table): timeout or
   * a network failure -> provider_unavailable; 401/403 -> missing_configuration
   * (the credentials on file don't authenticate); 5xx -> provider_unavailable;
   * any other 4xx (400, 404, 405, 422, ...) -> invalid_input, which covers the
   * brief's "404 on a staged ref" case and is a reasonable default for the
   * rest, since WordPress's own 4xx codes all mean "the request as sent was
   * not acceptable". Never includes the raw response body in a thrown message
   * — only the HTTP status and non-secret identifiers the caller already
   * knows (site id, staged ref) — so there is nothing here that needs
   * truncating.
   */
  private async wpFetch(
    site: SiteRef,
    credentials: WordPressCredentials,
    method: 'GET' | 'POST',
    url: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        headers: {
          Authorization: this.authHeader(credentials),
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SiteProviderError(
        'provider_unavailable',
        this.identity.name,
        `wordpress request failed for site=${site.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new SiteProviderError(
        'missing_configuration',
        this.identity.name,
        `wordpress rejected credentials for site=${site.id} (HTTP ${res.status})`,
      );
    }
    if (res.status >= 500) {
      throw new SiteProviderError(
        'provider_unavailable',
        this.identity.name,
        `wordpress returned HTTP ${res.status} for site=${site.id}`,
      );
    }
    if (res.status >= 400) {
      throw new SiteProviderError(
        'invalid_input',
        this.identity.name,
        `wordpress returned HTTP ${res.status} for site=${site.id}`,
      );
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SiteProviderError(
        'provider_response_invalid',
        this.identity.name,
        `wordpress returned a non-JSON body for site=${site.id} (HTTP ${res.status})`,
      );
    }
    return { status: res.status, json };
  }

  private async findPageIdBySlug(
    site: SiteRef,
    credentials: WordPressCredentials,
    baseUrl: URL,
    slug: string,
  ): Promise<number | null> {
    const url = new URL(endpoint(baseUrl, 'wp-json/wp/v2/pages'));
    url.searchParams.set('slug', slug);
    // 'any' so an already-staged (not yet published) draft is still found.
    url.searchParams.set('status', 'any');
    const { json } = await this.wpFetch(site, credentials, 'GET', url.toString());
    if (!Array.isArray(json)) {
      throw new SiteProviderError(
        'provider_response_invalid',
        this.identity.name,
        `wordpress returned a non-array page list for site=${site.id}`,
      );
    }
    const match = json.find((item) => isWpPageResponse(item)) as WpPageResponse | undefined;
    return match ? match.id : null;
  }

  private buildPagePayload(change: SiteChangeInput, slug: string): Record<string, unknown> {
    const payload: Record<string, unknown> = { status: 'draft' };
    if (slug) payload.slug = slug;
    if (change.title !== undefined) payload.title = change.title;
    if (change.bodyHtml !== undefined) payload.content = change.bodyHtml;

    // See DEVIATION 4 above — best-effort Yoast-convention meta keys, a
    // harmless no-op on a site without Yoast.
    const meta: Record<string, unknown> = {};
    if (change.metaTitle !== undefined) meta._yoast_wpseo_title = change.metaTitle;
    if (change.metaDescription !== undefined) meta._yoast_wpseo_metadesc = change.metaDescription;
    if (change.structuredData !== undefined) meta._ge_structured_data = JSON.stringify(change.structuredData);
    if (Object.keys(meta).length > 0) payload.meta = meta;

    return payload;
  }

  private stagedKey(site: SiteRef, stagedRef: string): string {
    return `${site.tenantId}:${site.id}:${stagedRef}`;
  }

  /** Records, for later pickup by verifyChange, which fields this platform cannot write and therefore silently dropped. See DEVIATION 2 above. */
  private recordDroppedFields(site: SiteRef, stagedRef: string, change: SiteChangeInput): void {
    const dropped = computeUnwritableFieldIssues(this.capabilities, change);
    const key = this.stagedKey(site, stagedRef);
    if (this.droppedFieldsByStagedRef.size >= MAX_DROPPED_FIELD_ENTRIES && !this.droppedFieldsByStagedRef.has(key)) {
      const oldest = this.droppedFieldsByStagedRef.keys().next().value;
      if (oldest !== undefined) this.droppedFieldsByStagedRef.delete(oldest);
    }
    if (dropped.length > 0) this.droppedFieldsByStagedRef.set(key, dropped);
    else this.droppedFieldsByStagedRef.delete(key);
  }
}
