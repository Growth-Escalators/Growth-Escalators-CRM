// The SiteAdapter contract — a vendor-neutral seam so one SEO system can drive
// three very different website platforms through one shape: a git-based
// custom-code site (source lives in a repo, deploy is a merge), WordPress
// (REST API), and Shopify (Admin API).
//
// This is an INDEPENDENT FOURTH COPY of the provider pattern established by
// src/modules/esign/providers/ and src/modules/outreach/providers/, not a
// generalisation of them. docs/decisions/ADR-007-outreach-provider-boundary.md
// explicitly rejects building one shared cross-domain "provider framework" for
// esign/outreach/discovery — "the three domains share a shape, not a
// contract" — and the same reasoning applies one domain further here. This
// module MUST NOT import anything from src/modules/outreach/ or
// src/modules/esign/: copying the proven small pattern is the point, not
// reusing its code or coupling its release cycle to this one.
//
// Scope of this PR: contract + capability model + structured errors + a mock
// provider (mock.provider.ts) + the factory (index.ts). No git/WordPress/
// Shopify vendor code, no credentials, no network call, no filesystem write.
// The three real providers are later work; SITE_PROVIDER_CAPABILITY_MATRIX
// below records their INTENDED capability profile now so that work has one
// documented source of truth to implement against — but only 'mock' has a
// concrete implementation, and only 'mock' is buildable through the factory,
// today (providers/index.ts).
//
// Callers MUST branch on `capabilities`, NEVER on `identity.name`. A future
// second implementation of the same platform (a faster WordPress client, a
// different git host) must be a drop-in replacement without any caller change
// — that is the entire reason this file exists.
//
// Error messages (SiteProviderError below) must never embed a credential,
// token, a URL with a token/signature embedded in it, or client PII — refer
// to a site id or change id instead.

/** The three website platforms this adapter is built to cover. */
export type SitePlatform = 'git' | 'wordpress' | 'shopify';

/**
 * Explicit, typed capabilities — never inferred from method existence or from
 * `identity.name`. `assertSiteProviderCapability` below is the single
 * enforcement point for callers that need to gate behaviour on a flag; an
 * absent/undefined/malformed flag is treated as `false` (fail closed) there.
 *
 * Unlike the outreach module's capability flags, the four core methods on
 * SiteProvider (stageChange/verifyChange/publishChange/fetchLiveSnapshot) are
 * NOT individually capability-gated — every platform implements all four.
 * These flags instead describe what a given call can and cannot DO: whether a
 * staged change gets a remote preview, whether a diff is available, which
 * on-page fields get written, and how publish is fulfilled.
 */
export interface SiteProviderCapabilities {
  /** Can create a provider-side unpublished object (a WP draft post, a Shopify unpublished product/page) with its own preview URL. */
  readonly stagesRemoteDraft: boolean;
  /** Can produce an exact pre-change-vs-post-change source diff (only meaningful when the "source" is a text tree, i.e. git). */
  readonly producesReviewableDiff: boolean;
  /** Can run a build/lint/link check against the staged change before it goes live. */
  readonly verifiesOffline: boolean;
  readonly createsPage: boolean;
  readonly updatesPage: boolean;
  readonly writesMetaTitle: boolean;
  readonly writesMetaDescription: boolean;
  /** WordPress needs a plugin (e.g. Yoast) for this; Shopify's canonical tag is theme-emitted, not adapter-written. */
  readonly writesCanonical: boolean;
  readonly writesStructuredData: boolean;
  /** Shopify needs a theme snippet installed for the adapter's output to actually render on-page. */
  readonly requiresThemeSnippet: boolean;
  readonly writesRedirects: boolean;
  readonly writesRobotsTxt: boolean;
  readonly writesSitemap: boolean;
  /** Publish is fulfilled by a live API call. Mutually exclusive with publishesViaMerge in every real profile below. */
  readonly publishesViaApi: boolean;
  /** Publish is fulfilled by a source-control merge, not an API call — see publishChange's doc comment for why. */
  readonly publishesViaMerge: boolean;
  /** A publish can be atomically undone (a git revert; not true of a live CMS/API write in V1). */
  readonly supportsAtomicRollback: boolean;
  /** Safe to retry publishChange with the same ApprovedSiteChange.publishRequestId. */
  readonly supportsIdempotentPublish: boolean;
}

/**
 * Reference only — the INTENDED capability profile for each real platform
 * adapter. None of the three is implemented yet; only 'mock' is (this PR),
 * and mock.provider.ts simulates one of these profiles at a time so tests can
 * exercise every branch this shape implies without a fourth mock class. This
 * is kept as the single documented source of truth so a real adapter and the
 * mock's simulation of it cannot drift into two different, hand-copied lists.
 *
 * `stagesRemoteDraft` and `producesReviewableDiff` are mutually exclusive by
 * construction below, and that split IS the git-vs-hosted-platform boundary:
 * a git repo has no server-side draft object to stage, but a plain-text diff
 * against the pre-change source is exact and cheap. A hosted CMS/e-commerce
 * platform can stage a real draft object with its own preview URL, but has no
 * equivalent of a source-level diff to show — there is no "source" to diff
 * against, only a rendered object.
 */
export const SITE_PROVIDER_CAPABILITY_MATRIX: Readonly<Record<SitePlatform, SiteProviderCapabilities>> = {
  git: Object.freeze({
    stagesRemoteDraft: false,
    producesReviewableDiff: true,
    verifiesOffline: true,
    createsPage: true,
    updatesPage: true,
    writesMetaTitle: true,
    writesMetaDescription: true,
    writesCanonical: true,
    writesStructuredData: true,
    requiresThemeSnippet: false,
    writesRedirects: true,
    writesRobotsTxt: true,
    writesSitemap: true,
    publishesViaApi: false,
    publishesViaMerge: true,
    supportsAtomicRollback: true,
    supportsIdempotentPublish: true,
  }),
  wordpress: Object.freeze({
    stagesRemoteDraft: true,
    producesReviewableDiff: false,
    verifiesOffline: false,
    createsPage: true,
    updatesPage: true,
    writesMetaTitle: true,
    writesMetaDescription: true,
    writesCanonical: false,
    writesStructuredData: true,
    requiresThemeSnippet: false,
    writesRedirects: false,
    writesRobotsTxt: false,
    writesSitemap: false,
    publishesViaApi: true,
    publishesViaMerge: false,
    supportsAtomicRollback: false,
    supportsIdempotentPublish: true,
  }),
  shopify: Object.freeze({
    stagesRemoteDraft: true,
    producesReviewableDiff: false,
    verifiesOffline: false,
    createsPage: true,
    updatesPage: true,
    writesMetaTitle: true,
    writesMetaDescription: true,
    writesCanonical: false,
    writesStructuredData: true,
    requiresThemeSnippet: true,
    writesRedirects: true,
    writesRobotsTxt: false,
    writesSitemap: false,
    publishesViaApi: true,
    publishesViaMerge: false,
    supportsAtomicRollback: false,
    supportsIdempotentPublish: true,
  }),
};

export interface SiteProviderIdentity {
  /** Stable provider name (e.g. 'mock', 'git', 'wordpress', 'shopify') — never a vendor request/response model. */
  readonly name: string;
  /** Adapter contract version (this module's version), not a vendor API version. */
  readonly version: string;
}

export type SiteProviderConfigStatus =
  | { readonly status: 'ready' }
  | { readonly status: 'not_configured'; readonly reason: string }
  | { readonly status: 'misconfigured'; readonly reason: string };

/**
 * A CRM-owned reference to one managed site. The rest of the codebase depends
 * ONLY on this shape — never on a vendor's own site/shop/repo model.
 */
export interface SiteRef {
  readonly id: string;
  readonly tenantId: string;
  readonly domain: string;
  readonly platform: SitePlatform;
  /**
   * Which `tenant_integrations.provider` row holds this site's credentials —
   * the value of `seo_sites.credential_provider`. A POINTER, never a secret.
   *
   * Absent from the first draft of this interface, which meant the registry
   * column was written by the admin and read by nobody: one adapter fell back
   * to `adapterConfig.credentialProvider`, another hardcoded its own platform
   * name, and a tenant with two WordPress integrations had no way to say which
   * one a given site uses. Adapters default to their platform name when this
   * is unset, so the common single-integration case needs no configuration.
   */
  readonly credentialProvider?: string | null;
  /**
   * Non-secret settings only, e.g. `{ repo: 'org/site', branch: 'main',
   * credentialRef: 'env:GIT_DEPLOY_KEY_ORG_SITE' }`. A `*Ref`-suffixed key is
   * a scheme-prefixed POINTER (the convention ADR-007 D-7 established for
   * reply mailboxes: `env:NAME` / `railway:NAME` / `vault:path`), resolved by
   * the provider at call time — never a literal secret value written here.
   * getConfigStatus() may check whether such a pointer is present; it must
   * never resolve it or echo what it points to.
   */
  readonly adapterConfig?: Record<string, unknown>;
}

/** The content/SEO fields a change may touch. Vendor-neutral — no WP/Shopify field names here. */
export interface SiteChangeInput {
  readonly changeId: string;
  readonly pageUrl: string;
  readonly isNewPage: boolean;
  readonly title?: string;
  readonly metaTitle?: string;
  readonly metaDescription?: string;
  readonly canonicalUrl?: string;
  readonly bodyHtml?: string;
  readonly structuredData?: Record<string, unknown>;
  /** Old URL(s) that should redirect to `pageUrl` once this change is live. */
  readonly redirectFrom?: readonly string[];
}

export interface SiteStageResult {
  /** Opaque provider-side handle: a git branch/commit, a WP draft post id, a Shopify draft object id. */
  readonly stagedRef: string;
  /** Present only when capabilities.stagesRemoteDraft. */
  readonly previewUrl?: string;
  /** Present only when capabilities.producesReviewableDiff. */
  readonly diff?: string;
  readonly createdAt: Date;
}

export type SiteVerifyIssueSeverity = 'blocking' | 'warning';

export interface SiteVerifyIssue {
  readonly severity: SiteVerifyIssueSeverity;
  readonly code: string;
  readonly message: string;
}

export interface SiteVerifyResult {
  /** False whenever any issue has severity 'blocking'. A caller must not publish when this is false. */
  readonly passed: boolean;
  readonly issues: readonly SiteVerifyIssue[];
  readonly verifiedAt: Date;
}

/**
 * A staged change that a human has approved for publish. The provider does
 * not re-derive approval — a caller constructs this only after its own
 * approval workflow has run, and `publishChange` treats a missing/blank
 * `approvedBy` as a hard stop (SiteProviderError code 'unauthorised_publish'),
 * never as an implicit approval.
 */
export interface ApprovedSiteChange {
  readonly stagedRef: string;
  readonly changeId: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
  /** Safe to retry publishChange with the same value when capabilities.supportsIdempotentPublish. */
  readonly publishRequestId: string;
  /**
   * The original change, carried forward so publish does not depend on the
   * staging process still being alive.
   *
   * This is not a convenience. Staging happens when a change is proposed;
   * publishing happens after a human approves, which is hours later and
   * routinely in a different process (this repo redeploys on every push to
   * main). An adapter that kept `redirectFrom` in an in-process Map at stage
   * time therefore finds that Map empty at publish time, and silently creates
   * no redirects for a change an operator approved — a failure with no error
   * and no log line. Passing the change through is what closes that.
   */
  readonly change?: SiteChangeInput;
}

export type SitePublishResult =
  | { readonly status: 'published'; readonly liveUrl: string; readonly externalRef: string }
  | {
      readonly status: 'handoff_required';
      readonly handoff: { readonly kind: 'git_merge'; readonly branch: string; readonly compareUrl: string };
    };

export interface SiteLiveSnapshot {
  readonly pageUrl: string;
  readonly fetchedAt: Date;
  readonly httpStatus: number;
  readonly title?: string;
  readonly metaTitle?: string;
  readonly metaDescription?: string;
  readonly canonicalUrl?: string;
  readonly bodyHtml?: string;
}

export interface SiteProvider {
  readonly identity: SiteProviderIdentity;
  readonly capabilities: SiteProviderCapabilities;

  /**
   * Health/configuration status for one site. Must never read or return a
   * secret value merely to report readiness — presence of a credential
   * pointer (SiteRef.adapterConfig) is enough. Takes `site` (unlike
   * outreach's process-wide, tenant-free getConfigStatus()) because a site
   * adapter's credentials are configured per site, not once per process.
   */
  getConfigStatus(site: SiteRef): SiteProviderConfigStatus;

  /** Create or update a provider-side staged version of `change`. Never publishes. */
  stageChange(site: SiteRef, change: SiteChangeInput): Promise<SiteStageResult>;

  /**
   * Run whatever pre-publish checks this provider can perform against a staged
   * change. Never publishes.
   *
   * `change` is optional only so a caller holding nothing but a stagedRef can
   * still ask for a re-verify. Callers that have it MUST pass it: several
   * checks (a canonical the platform cannot write, a redirect that has to be
   * validated, structured data staged without its theme snippet) are about
   * what was *requested*, and neither `SiteStageResult` nor the provider's own
   * memory reliably still holds that by the time verification runs.
   */
  verifyChange(site: SiteRef, staged: SiteStageResult, change?: SiteChangeInput): Promise<SiteVerifyResult>;

  /**
   * Publish an approved, staged change. Returns a union rather than always a
   * live URL: git-based sites are deliberately NEVER published by the server
   * itself. Railway's filesystem is ephemeral — nothing written to it
   * survives a redeploy — and holding a deploy key with push/merge rights
   * inside the API container is too large a blast radius for what this
   * module needs to do. A git provider therefore always returns
   * `handoff_required`; a human, or a separately-scoped CI job, performs the
   * actual merge. WordPress and Shopify publish directly via their APIs and
   * return `published`.
   */
  publishChange(site: SiteRef, approved: ApprovedSiteChange): Promise<SitePublishResult>;

  /** Read the current live state of one page, independent of any staged change. */
  fetchLiveSnapshot(site: SiteRef, pageUrl: string): Promise<SiteLiveSnapshot>;
}

// ---- structured, log-safe errors --------------------------------------------
//
// Messages must never embed a credential, token, a URL with a token/signature
// embedded in it, or client PII — refer to a site id or change id instead.

export type SiteProviderErrorCode =
  | 'unknown_provider'
  | 'unsupported_capability'
  | 'missing_configuration'
  | 'invalid_input'
  | 'duplicate_operation'
  | 'provider_unavailable'
  | 'provider_response_invalid'
  /** Publish was attempted without a recorded human approval — the hard-stop-before-publish invariant. */
  | 'unauthorised_publish';

export class SiteProviderError extends Error {
  readonly code: SiteProviderErrorCode;
  readonly provider: string;

  constructor(code: SiteProviderErrorCode, provider: string, message: string) {
    super(`[${provider}] ${code}: ${message}`);
    this.name = 'SiteProviderError';
    this.code = code;
    this.provider = provider;
  }
}

/**
 * The single enforcement point for capability checks. Fails closed on an
 * undefined/malformed capability value — there is no generic execute/request
 * escape hatch anywhere in this module, so any capability-gated behaviour a
 * caller wants must be reached through a named flag checked here.
 */
export function assertSiteProviderCapability(
  provider: SiteProvider,
  capability: keyof SiteProviderCapabilities,
): void {
  if (provider.capabilities[capability] !== true) {
    throw new SiteProviderError(
      'unsupported_capability',
      provider.identity.name,
      `capability "${capability}" is not supported`,
    );
  }
}

/** Throws unless the provider reports it is ready to use for this site. Never logs the config values themselves. */
export function assertSiteProviderReady(provider: SiteProvider, site: SiteRef): void {
  const status = provider.getConfigStatus(site);
  if (status.status !== 'ready') {
    throw new SiteProviderError('missing_configuration', provider.identity.name, status.reason);
  }
}
