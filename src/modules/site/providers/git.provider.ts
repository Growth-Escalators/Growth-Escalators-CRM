// Git-backed site provider — a PROPOSAL RECORDER, not a git client.
//
// THE DEFINING CONSTRAINT: the server never runs git. Railway's filesystem is
// ephemeral (nothing written to it survives a redeploy), and holding a
// deploy key with push/merge rights inside the API container is too large a
// blast radius for what this module needs to do. Consequently this file MUST
// NOT: shell out (no child_process), invoke a git binary, write to the
// filesystem, clone a repository, or hold/resolve any repo credential.
// Everything below either reasons about SiteChangeInput/SiteRef in memory or
// makes a plain HTTP GET of the *live* page through the shared
// fetchLivePageSnapshot() — never the source repo.
//
// Because this provider holds no push/merge credential, `getConfigStatus`
// never needs one either: "ready" here means only "we know which repo/branch
// a human should merge into", never "we can write to it ourselves". And
// `publishChange` never returns `'published'` — it always hands off to a
// human (or a separately-scoped CI job) via a `git_merge` handoff. See the
// doc comment on SiteProvider.publishChange in site-provider.interface.ts;
// that is the permanent design here, not a stub waiting for a future git
// client.
//
// Because there is no source checkout to diff against, `stageChange` diffs
// the SEO SURFACE instead: the current live page (fetched read-only via
// fetchLivePageSnapshot, shared with every provider) vs. the fields this
// change would set. That is an approximation of a real source diff, not one
// — a human still reviews the actual file change in the PR the handoff
// points at — but it is enough for an approver to sanity-check *intent*
// before a merge request ever gets opened.
import { fetchLivePageSnapshot } from '../liveSnapshot';
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

/** `adapterConfig.host` default when a site row does not set one — the overwhelmingly common case. */
const DEFAULT_GIT_HOST = 'github.com';

/**
 * Bound on how many staged inputs one provider instance remembers at once
 * (see the file-header note on `stagedInputsByKey`). This provider is built
 * once per process (providers/index.ts's per-platform singleton) and lives
 * for the process lifetime, so without a cap a long-running process that
 * stages many changes would grow this map without bound. 500 is generous
 * against realistic concurrent-in-review volume for one platform.
 */
const MAX_STAGED_INPUTS = 500;

/** The subset of a resolved SiteChangeInput needed to diff against a live page. */
interface LiveFieldsForDiff {
  readonly metaTitle?: string;
  readonly metaDescription?: string;
  readonly canonicalUrl?: string;
  /** SiteLiveSnapshot.title IS the extracted <h1> text — see fetchLivePageSnapshot's return mapping. */
  readonly h1?: string;
  readonly jsonLdTypes: readonly string[];
}

interface ResolvedGitConfig {
  readonly repo: string;
  readonly branch: string;
  readonly host: string;
}

export class GitSiteProvider implements SiteProvider {
  // Frozen, not just `readonly` — see mock.provider.ts's identical note: a
  // stray write through one caller's reference must not rename/mutate the
  // shared singleton out from under every other caller.
  readonly identity: SiteProviderIdentity = Object.freeze({ name: 'git', version: '1.0.0' });
  readonly capabilities: SiteProviderCapabilities = Object.freeze({ ...SITE_PROVIDER_CAPABILITY_MATRIX.git });

  /**
   * `${tenantId}:${siteId}:${stagedRef}` -> the SiteChangeInput that produced
   * that stagedRef. verifyChange has nothing else to check against — there is
   * no server-side draft object and no checkout — so this is the provider's
   * only memory of "what did stageChange actually propose". Bounded and
   * insertion-ordered (see rememberStagedInput) so an unbounded number of
   * staged-but-never-verified changes cannot leak memory.
   */
  private readonly stagedInputsByKey = new Map<string, SiteChangeInput>();

  /** Injected in tests for a fake fetch; defaults to global fetch like FetchLiveSnapshotOptions.fetchImpl. */
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getConfigStatus(site: SiteRef): SiteProviderConfigStatus {
    const cfg = this.resolveAdapterConfig(site);
    if (!cfg) {
      return {
        status: 'not_configured',
        reason: 'adapterConfig.repo and adapterConfig.branch are required (adapterConfig.host is optional, defaults to github.com)',
      };
    }
    return { status: 'ready' };
  }

  /** Records a deterministic proposal — never a real git object. See file header. */
  async stageChange(site: SiteRef, change: SiteChangeInput): Promise<SiteStageResult> {
    this.assertSiteRef(site);
    this.validateChangeInput(change);

    // Deterministic and derived only from changeId, so re-staging the same
    // change (e.g. after an edit) always proposes the same branch name
    // instead of accumulating a new one per attempt. This is a NAME a human
    // will create when they act on the handoff — publishChange never
    // creates it, and nothing in this provider asserts it exists.
    const stagedRef = `seo-change/${sanitizeBranchSegment(change.changeId)}`;
    const diff = await this.buildDiff(site, change);

    this.rememberStagedInput(this.stagedInputKey(site, stagedRef), change);

    return {
      stagedRef,
      // stagesRemoteDraft is false for this platform (see the capability
      // matrix) — a git repo has no server-side draft object to hand back a
      // preview URL for.
      previewUrl: undefined,
      diff,
      createdAt: new Date(),
    };
  }

  /** verifiesOffline is true for this platform, so these are real structural checks, not a placeholder warning. */
  async verifyChange(site: SiteRef, staged: SiteStageResult): Promise<SiteVerifyResult> {
    this.assertSiteRef(site);

    const change = this.stagedInputsByKey.get(this.stagedInputKey(site, staged.stagedRef));
    if (!change) {
      // Not a throw: an unrecognised stagedRef (never staged here, staged
      // against a different site, or evicted by the cap) is a legitimate,
      // reportable verify outcome — "you must stage before you can verify"
      // — not a programming error in the caller.
      return {
        passed: false,
        issues: [
          {
            severity: 'blocking',
            code: 'unknown_staged_ref',
            message: `no staged input recorded for stagedRef "${staged.stagedRef}" — call stageChange first`,
          },
        ],
        verifiedAt: new Date(),
      };
    }

    const issues = this.buildVerifyIssues(site, change);
    return {
      passed: !issues.some((issue) => issue.severity === 'blocking'),
      issues,
      verifiedAt: new Date(),
    };
  }

  async publishChange(site: SiteRef, approved: ApprovedSiteChange): Promise<SitePublishResult> {
    // FIRST, unconditionally, before touching `site`, before any map lookup,
    // before anything else: a missing/blank approvedBy is never implicit
    // approval, and no code path below this line may run before it passes.
    if (!approved.approvedBy || approved.approvedBy.trim().length === 0) {
      throw new SiteProviderError(
        'unauthorised_publish',
        'git',
        `change ${approved.stagedRef || '(no stagedRef)'} has no approvedBy — refusing to publish`,
      );
    }

    this.assertSiteRef(site);
    if (!approved.stagedRef || approved.stagedRef.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'approved.stagedRef is required');
    }

    const cfg = this.resolveAdapterConfig(site);
    if (!cfg) {
      throw new SiteProviderError(
        'missing_configuration',
        this.identity.name,
        'adapterConfig.repo and adapterConfig.branch are required to build a compare URL',
      );
    }

    // ALWAYS handoff_required, even for a fully approved change — this is
    // not a limitation to be lifted once a "real" git client exists. The
    // server holds no push/merge credential by design (file header), so
    // there is no code path that could ever return 'published' here.
    return {
      status: 'handoff_required',
      handoff: {
        kind: 'git_merge',
        // The staged proposal branch IS approved.stagedRef — stageChange
        // constructed it that way specifically so publishChange never has
        // to invent or look up a second name for the same thing.
        branch: approved.stagedRef,
        compareUrl: buildCompareUrl(cfg.host, cfg.repo, cfg.branch, approved.stagedRef),
      },
    };
  }

  /** Delegates entirely to the shared live-page reader — see liveSnapshot.ts. Nothing git-specific about reading a rendered page. */
  async fetchLiveSnapshot(site: SiteRef, pageUrl: string): Promise<SiteLiveSnapshot> {
    this.assertSiteRef(site);
    return fetchLivePageSnapshot(pageUrl, {
      providerName: this.identity.name,
      fetchImpl: this.fetchImpl,
    });
  }

  // ---- internals -------------------------------------------------------------

  /** Mirrors mock.provider.ts's assertSiteRef — a blank tenantId/siteId would silently collapse every caller into one staged-input bucket. */
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

  private stagedInputKey(site: SiteRef, stagedRef: string): string {
    return `${site.tenantId}:${site.id}:${stagedRef}`;
  }

  /** Insertion-ordered eviction: Map preserves insertion order, so the first key is always the oldest. */
  private rememberStagedInput(key: string, change: SiteChangeInput): void {
    if (this.stagedInputsByKey.size >= MAX_STAGED_INPUTS && !this.stagedInputsByKey.has(key)) {
      const oldestKey = this.stagedInputsByKey.keys().next().value;
      if (oldestKey !== undefined) this.stagedInputsByKey.delete(oldestKey);
    }
    // Delete-then-set moves a re-staged key to the most-recently-inserted
    // position, so repeatedly re-staging the same change keeps it "warm"
    // rather than making it the next eviction candidate.
    this.stagedInputsByKey.delete(key);
    // Defensive copy: the caller's array must not be mutable out from under
    // a later verifyChange call through the reference they originally passed in.
    this.stagedInputsByKey.set(
      key,
      Object.freeze({
        ...change,
        redirectFrom: change.redirectFrom ? Object.freeze([...change.redirectFrom]) : undefined,
      }),
    );
  }

  private resolveAdapterConfig(site: SiteRef): ResolvedGitConfig | null {
    const cfg = site.adapterConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    const repo = cfg.repo;
    const branch = cfg.branch;
    const host = cfg.host;
    if (typeof repo !== 'string' || repo.trim().length === 0) return null;
    if (typeof branch !== 'string' || branch.trim().length === 0) return null;
    if (host !== undefined && (typeof host !== 'string' || host.trim().length === 0)) return null;
    // No credentialRef is read or required here — see file header. A git
    // handoff needs to know WHERE to point a human, never how to write there.
    return {
      repo: repo.trim(),
      branch: branch.trim(),
      host: typeof host === 'string' ? host.trim() : DEFAULT_GIT_HOST,
    };
  }

  /**
   * Builds the reviewable unified diff stageChange returns. Only fields the
   * caller actually SET on `change` get a hunk — a field left undefined
   * means "this change does not touch it", not "delete the live value", so
   * it must never appear as a spurious removal.
   */
  private async buildDiff(site: SiteRef, change: SiteChangeInput): Promise<string> {
    let before: LiveFieldsForDiff | undefined;
    let degradedNote: string | undefined;

    if (!change.isNewPage) {
      try {
        // change.pageUrl is conventionally a site-relative path (see
        // mock.provider.ts's buildMockDiff and the `a${pageUrl}` diff
        // header below) — resolve it against the site's own domain so
        // fetchLivePageSnapshot gets the absolute URL it requires. If
        // change.pageUrl is already absolute, the URL constructor's base
        // argument is simply ignored.
        const absoluteUrl = new URL(change.pageUrl, `https://${site.domain}`).toString();
        const snapshot = await fetchLivePageSnapshot(absoluteUrl, {
          providerName: this.identity.name,
          fetchImpl: this.fetchImpl,
        });
        before = {
          metaTitle: snapshot.metaTitle,
          metaDescription: snapshot.metaDescription,
          canonicalUrl: snapshot.canonicalUrl,
          h1: snapshot.title,
          jsonLdTypes: snapshot.elements.jsonLdTypes,
        };
      } catch {
        // Staging must never fail merely because the live page couldn't be
        // read (not deployed yet, transient network blip, robots block) —
        // degrade to an additions-only diff instead of surfacing a fetch
        // error as a staging failure. Noted in the diff itself (as a
        // comment line) so a reviewer knows the "before" side is missing,
        // not that the page has no prior content.
        degradedNote = 'live snapshot unavailable for this page — diff below shows additions only';
      }
    }

    const newJsonLdTypes = extractStructuredDataTypes(change.structuredData);
    const fields: ReadonlyArray<{ readonly name: string; readonly oldValue?: string; readonly newValue?: string }> = [
      { name: 'meta_title', oldValue: before?.metaTitle, newValue: change.metaTitle },
      { name: 'meta_description', oldValue: before?.metaDescription, newValue: change.metaDescription },
      { name: 'canonical', oldValue: before?.canonicalUrl, newValue: change.canonicalUrl },
      { name: 'h1', oldValue: before?.h1, newValue: change.title },
      {
        name: 'structured_data_types',
        oldValue: before ? before.jsonLdTypes.join(',') : undefined,
        newValue: change.structuredData !== undefined ? newJsonLdTypes.join(',') : undefined,
      },
    ];

    const lines: string[] = [];
    if (degradedNote) lines.push(`# ${degradedNote}`);
    lines.push(`--- a${change.pageUrl}`, `+++ b${change.pageUrl}`);
    for (const field of fields) {
      if (field.newValue === undefined) continue; // not part of this change
      if (field.oldValue === field.newValue) continue; // no actual change
      lines.push(`@@ ${field.name} @@`);
      if (field.oldValue !== undefined) lines.push(`-${field.oldValue}`);
      lines.push(`+${field.newValue}`);
    }
    return lines.join('\n');
  }

  /**
   * Every check here is something answerable from `change` + `site` alone —
   * no checkout, no build, no network beyond what buildDiff already did.
   */
  private buildVerifyIssues(site: SiteRef, change: SiteChangeInput): SiteVerifyIssue[] {
    const issues: SiteVerifyIssue[] = [];

    // -- meta title -----------------------------------------------------------
    // A brand-new page with no title is a real defect (nothing to show in a
    // SERP); an existing page's change that simply doesn't touch metaTitle
    // is not — that distinction is exactly what isNewPage encodes.
    if (change.isNewPage && (!change.metaTitle || change.metaTitle.trim().length === 0)) {
      issues.push({ severity: 'blocking', code: 'meta_title_missing', message: 'a new page must set metaTitle' });
    } else if (change.metaTitle !== undefined && change.metaTitle.length > 60) {
      issues.push({
        severity: 'warning',
        code: 'meta_title_too_long',
        message: `metaTitle is ${change.metaTitle.length} characters (recommended limit 60)`,
      });
    }

    // -- meta description -------------------------------------------------------
    if (change.metaDescription !== undefined && change.metaDescription.length > 160) {
      issues.push({
        severity: 'warning',
        code: 'meta_description_too_long',
        message: `metaDescription is ${change.metaDescription.length} characters (recommended limit 160)`,
      });
    }

    // -- canonical ------------------------------------------------------------
    if (change.canonicalUrl !== undefined) {
      const parsed = safeParseUrl(change.canonicalUrl);
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        issues.push({
          severity: 'blocking',
          code: 'canonical_invalid_url',
          message: 'canonicalUrl must be an absolute http(s) URL',
        });
      } else if (normaliseHost(parsed.hostname) !== normaliseHost(site.domain)) {
        issues.push({
          severity: 'blocking',
          code: 'canonical_off_domain',
          message: `canonicalUrl host "${parsed.hostname}" is not the site's own domain "${site.domain}"`,
        });
      }
    }

    // -- redirectFrom ----------------------------------------------------------
    if (change.redirectFrom !== undefined) {
      for (const entry of change.redirectFrom) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          issues.push({
            severity: 'blocking',
            code: 'redirect_from_invalid',
            message: 'redirectFrom entries must be non-empty strings',
          });
          continue;
        }
        if (entry.startsWith('/')) continue; // same-origin relative path — always fine
        const parsed = safeParseUrl(entry);
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
          issues.push({
            severity: 'blocking',
            code: 'redirect_from_invalid',
            message: `redirectFrom entry "${entry}" is neither a relative path nor an absolute http(s) URL`,
          });
          continue;
        }
        if (normaliseHost(parsed.hostname) !== normaliseHost(site.domain)) {
          issues.push({
            severity: 'blocking',
            code: 'redirect_from_off_origin',
            message: `redirectFrom entry "${entry}" is not on the site's own domain`,
          });
        }
      }
    }

    // -- bodyHtml -------------------------------------------------------------
    // No sanitiser lives in this module (see liveSnapshot.ts's own no-parser
    // rationale) — a raw substring check is cheap, cannot be bypassed by
    // anything short of avoiding the literal tag, and errs toward blocking.
    if (change.bodyHtml !== undefined && /<script/i.test(change.bodyHtml)) {
      issues.push({
        severity: 'blocking',
        code: 'body_html_contains_script',
        message: 'bodyHtml must not contain a <script> tag',
      });
    }

    // -- structuredData ---------------------------------------------------------
    if (change.structuredData !== undefined) {
      let serialisable = true;
      try {
        JSON.stringify(change.structuredData);
      } catch {
        serialisable = false;
      }
      if (!serialisable) {
        issues.push({
          severity: 'warning',
          code: 'structured_data_not_serialisable',
          message: 'structuredData could not be JSON-serialised',
        });
      } else if (!hasTopLevelType(change.structuredData)) {
        issues.push({
          severity: 'warning',
          code: 'structured_data_missing_type',
          message: 'structuredData has no "@type"',
        });
      }
    }

    return issues;
  }
}

// ---------------------------------------------------------------------------
// module-level helpers (pure — no I/O, no env, safe to unit test directly)
// ---------------------------------------------------------------------------

/**
 * Git branch names disallow spaces, `~^:?*[`, consecutive slashes, and a
 * handful of other sequences. changeId is caller-supplied (ultimately from
 * the CRM's own change-request rows), so this is defence in depth rather
 * than an expected path — but a stagedRef is surfaced to a human as a
 * literal branch name, and silently building an invalid one would produce a
 * compareUrl nobody could act on.
 */
function sanitizeBranchSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/** GitHub-style three-dot compare link. Not fetched or validated server-side — it is only ever opened by a human. */
function buildCompareUrl(host: string, repo: string, baseBranch: string, proposalBranch: string): string {
  return `https://${host}/${repo}/compare/${encodeBranchForUrl(baseBranch)}...${encodeBranchForUrl(proposalBranch)}`;
}

/**
 * Git branch names are themselves slash-delimited namespaces — this
 * provider's own stagedRef is `seo-change/<changeId>` — and GitHub's compare
 * route accepts a literal `/` inside a ref name. A blind `encodeURIComponent`
 * would turn that into `%2F` and silently produce a link that does not
 * resolve to the intended compare page, so each segment is encoded on its
 * own and the separating slashes are kept literal.
 */
function encodeBranchForUrl(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function hasTopLevelType(data: Record<string, unknown>): boolean {
  const type = data['@type'];
  if (typeof type === 'string') return type.trim().length > 0;
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && t.trim().length > 0);
  return false;
}

function addType(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.trim().length > 0) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim().length > 0) into.add(item);
    }
  }
}

/**
 * Sorted, de-duplicated `@type` values from a SiteChangeInput.structuredData
 * object — the "new" side of the structured-data-types diff hunk. Only looks
 * at the top level plus `@graph` (a single change input is one JSON-LD
 * object or graph, never the array-of-blocks a rendered page can contain),
 * which is why this is not a reuse of liveSnapshot.ts's own (unexported,
 * page-HTML-oriented) collector.
 */
function extractStructuredDataTypes(data: Record<string, unknown> | undefined): string[] {
  if (data === undefined) return [];
  const types = new Set<string>();
  addType(data['@type'], types);
  const graph = data['@graph'];
  if (Array.isArray(graph)) {
    for (const entry of graph) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        addType((entry as Record<string, unknown>)['@type'], types);
      }
    }
  }
  return [...types].sort();
}
