// In-memory site provider. Used by unit/integration tests and by local dev
// (SITE_PROVIDER=mock). Deterministic and dependency-free: no fetch/http
// import anywhere in this file, no filesystem write, no env read, no
// credential of any kind. The `__*` helpers are test aids (control scenarios,
// inspect captured calls, switch simulated platform profile, reset state) and
// are NOT part of the SiteProvider interface — mirrors the convention in
// src/modules/outreach/providers/mock.provider.ts.
//
// One instance can simulate any of the three real platform profiles via
// __setProfile(), rather than needing three separate mock classes. This
// exists to make callers prove they branch on `capabilities`, never on
// `identity.name`: identity.name stays 'mock' across every profile switch,
// while capabilities — and therefore publishChange's behaviour (a live
// 'published' result vs a 'handoff_required' git result) — change underneath
// it. Profile is provider-wide, not per-site, matching how `capabilities` is
// a single object on the whole provider instance in the interface (a real
// adapter is built once per platform, not once per site of that platform).
//
// Per-site state — captured calls, the scenario, and the sequence counters
// used for deterministic ids — is keyed by `${tenantId}:${siteId}`, so two
// sites (or two tenants) driving the same mock instance in the same test
// process can never observe or influence each other's calls or ids.
// `configStatus` is deliberately NOT site-keyed: it models a provider-level
// (process-wide) configuration fact, the same simplification the outreach
// mock makes for getConfigStatus(). A real per-site config check is future
// work for a real adapter, not something this mock needs to prove.
import {
  SITE_PROVIDER_CAPABILITY_MATRIX,
  SiteProviderError,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SiteLiveSnapshot,
  type SitePlatform,
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

export type MockSiteScenario = 'success' | 'unsupported' | 'failure' | 'duplicate' | 'malformed_response';

export interface MockSiteCallRecord {
  readonly method: 'stageChange' | 'verifyChange' | 'publishChange' | 'fetchLiveSnapshot';
  /** `${tenantId}:${siteId}` — see file header. */
  readonly key: string;
  readonly at: Date;
  /** A safe, non-PII summary — never the raw change/snapshot body itself. */
  readonly summary: string;
}

export class MockSiteProvider implements SiteProvider {
  // Frozen, not just `readonly`: a stray `(provider.identity as any).name = 'x'`
  // in one caller must not be able to rename the shared singleton out from
  // under every other caller. `readonly` is erased at runtime; Object.freeze
  // is not.
  readonly identity: SiteProviderIdentity = Object.freeze({ name: 'mock', version: '1.0.0' });

  // Deliberately NOT `readonly` on the class (the interface's `readonly` is
  // still enforced against every SiteProvider-typed reference) — __setProfile
  // needs to reassign this to a new frozen snapshot when the simulated
  // profile changes. Defaults to 'wordpress': a plain API-publishing profile.
  capabilities: SiteProviderCapabilities = Object.freeze({ ...SITE_PROVIDER_CAPABILITY_MATRIX.wordpress });
  private profile: SitePlatform = 'wordpress';

  private readonly callsByKey = new Map<string, MockSiteCallRecord[]>();
  private readonly scenarioByKey = new Map<string, MockSiteScenario>();
  private readonly seqByKey = new Map<string, number>();
  private configStatus: SiteProviderConfigStatus = { status: 'ready' };

  getConfigStatus(_site: SiteRef): SiteProviderConfigStatus {
    return this.configStatus;
  }

  async stageChange(site: SiteRef, change: SiteChangeInput): Promise<SiteStageResult> {
    this.assertSiteRef(site);
    const key = this.keyFor(site);
    this.applyScenario(key, 'stageChange');
    this.validateChangeInput(change);

    const stagedRef = this.nextId(key, 'stage');
    const result: SiteStageResult = {
      stagedRef,
      previewUrl: this.capabilities.stagesRemoteDraft ? `https://mock-preview.invalid/${key}/${stagedRef}` : undefined,
      diff: this.capabilities.producesReviewableDiff ? buildMockDiff(change) : undefined,
      createdAt: new Date(),
    };
    this.recordCall(key, 'stageChange', `page=${change.pageUrl}`);
    return result;
  }

  async verifyChange(site: SiteRef, staged: SiteStageResult): Promise<SiteVerifyResult> {
    this.assertSiteRef(site);
    const key = this.keyFor(site);
    this.applyScenario(key, 'verifyChange');
    if (!staged.stagedRef || staged.stagedRef.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'staged.stagedRef is required');
    }

    const issues: SiteVerifyIssue[] = this.capabilities.verifiesOffline
      ? []
      : [
          {
            severity: 'warning',
            code: 'no_offline_verification',
            message: 'this profile cannot run offline build/lint checks before publish',
          },
        ];
    const result: SiteVerifyResult = { passed: true, issues, verifiedAt: new Date() };
    this.recordCall(key, 'verifyChange', `staged=${staged.stagedRef}`);
    return result;
  }

  async publishChange(site: SiteRef, approved: ApprovedSiteChange): Promise<SitePublishResult> {
    this.assertSiteRef(site);
    const key = this.keyFor(site);

    // Hard stop, checked BEFORE scenario simulation and unconditionally on
    // every call: an absent/blank approvedBy is never treated as implicit
    // approval, and no scenario setting can be used to bypass this check.
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

    this.applyScenario(key, 'publishChange');
    this.recordCall(key, 'publishChange', `staged=${approved.stagedRef}`);

    if (this.capabilities.publishesViaMerge && !this.capabilities.publishesViaApi) {
      return {
        status: 'handoff_required',
        handoff: {
          kind: 'git_merge',
          branch: `mock-site-change/${approved.stagedRef}`,
          compareUrl: `https://mock-git.invalid/${key}/compare/${approved.stagedRef}`,
        },
      };
    }

    return {
      status: 'published',
      liveUrl: `https://${site.domain}/mock-published/${approved.stagedRef}`,
      externalRef: this.nextId(key, 'publish'),
    };
  }

  async fetchLiveSnapshot(site: SiteRef, pageUrl: string): Promise<SiteLiveSnapshot> {
    this.assertSiteRef(site);
    const key = this.keyFor(site);
    this.applyScenario(key, 'fetchLiveSnapshot');
    if (!pageUrl || pageUrl.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'pageUrl is required');
    }

    this.recordCall(key, 'fetchLiveSnapshot', `page=${pageUrl}`);
    return { pageUrl, fetchedAt: new Date(), httpStatus: 200 };
  }

  // ---- test helpers (not part of the SiteProvider interface) ---------------

  /** Swaps the simulated platform's capability profile. See file header. */
  __setProfile(profile: SitePlatform): void {
    this.profile = profile;
    this.capabilities = Object.freeze({ ...SITE_PROVIDER_CAPABILITY_MATRIX[profile] });
  }

  __getProfile(): SitePlatform {
    return this.profile;
  }

  /** Controls the outcome of the next call(s) for one (tenantId, siteId) pair. Defaults to 'success'. */
  __setScenario(tenantId: string, siteId: string, scenario: MockSiteScenario): void {
    this.scenarioByKey.set(`${tenantId}:${siteId}`, scenario);
  }

  __setConfigStatus(status: SiteProviderConfigStatus): void {
    this.configStatus = status;
  }

  /** A defensive copy — callers cannot mutate captured history through the return value. */
  __getCalls(tenantId: string, siteId: string): MockSiteCallRecord[] {
    return [...(this.callsByKey.get(`${tenantId}:${siteId}`) ?? [])];
  }

  __reset(): void {
    this.callsByKey.clear();
    this.scenarioByKey.clear();
    this.seqByKey.clear();
    this.configStatus = { status: 'ready' };
    this.__setProfile('wordpress');
  }

  // ---- internals -------------------------------------------------------------

  /**
   * A blank tenantId or siteId would silently collapse every such caller into
   * one shared Map bucket, sharing scenarios, captured calls and id counters
   * across sites/tenants — the exact leak the composite keying exists to
   * prevent.
   */
  private assertSiteRef(site: SiteRef): void {
    if (typeof site.tenantId !== 'string' || site.tenantId.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'site.tenantId is required');
    }
    if (typeof site.id !== 'string' || site.id.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'site.id is required');
    }
  }

  private keyFor(site: SiteRef): string {
    return `${site.tenantId}:${site.id}`;
  }

  private validateChangeInput(change: SiteChangeInput): void {
    if (!change.changeId || change.changeId.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'change.changeId is required');
    }
    if (!change.pageUrl || change.pageUrl.trim().length === 0) {
      throw new SiteProviderError('invalid_input', this.identity.name, 'change.pageUrl is required');
    }
  }

  private applyScenario(key: string, method: MockSiteCallRecord['method']): void {
    const scenario = this.scenarioByKey.get(key) ?? 'success';
    if (scenario === 'success') return;
    if (scenario === 'unsupported') {
      throw new SiteProviderError('unsupported_capability', this.identity.name, `${method} scenario=unsupported`);
    }
    if (scenario === 'failure') {
      throw new SiteProviderError('provider_unavailable', this.identity.name, `${method} scenario=failure`);
    }
    if (scenario === 'duplicate') {
      throw new SiteProviderError('duplicate_operation', this.identity.name, `${method} scenario=duplicate`);
    }
    if (scenario === 'malformed_response') {
      throw new SiteProviderError(
        'provider_response_invalid',
        this.identity.name,
        `${method} scenario=malformed_response`,
      );
    }
  }

  private recordCall(key: string, method: MockSiteCallRecord['method'], summary: string): void {
    const list = this.callsByKey.get(key) ?? [];
    list.push({ method, key, at: new Date(), summary });
    this.callsByKey.set(key, list);
  }

  /** Sequential per-(kind, key) counter — deterministic within a site, isolated across sites/tenants. */
  private nextId(key: string, kind: 'stage' | 'publish'): string {
    const seqKey = `${kind}:${key}`;
    const next = (this.seqByKey.get(seqKey) ?? 0) + 1;
    this.seqByKey.set(seqKey, next);
    return `mock-${kind}-${key}-${next}`;
  }
}

function buildMockDiff(change: SiteChangeInput): string {
  const lines: string[] = [`--- a${change.pageUrl}`, `+++ b${change.pageUrl}`];
  if (change.metaTitle !== undefined) lines.push(`+meta_title: ${change.metaTitle}`);
  if (change.metaDescription !== undefined) lines.push(`+meta_description: ${change.metaDescription}`);
  if (change.canonicalUrl !== undefined) lines.push(`+canonical: ${change.canonicalUrl}`);
  return lines.join('\n');
}
