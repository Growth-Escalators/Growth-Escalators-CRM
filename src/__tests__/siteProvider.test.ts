import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertSiteProviderCapability,
  assertSiteProviderReady,
  SiteProviderError,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SitePublishResult,
  type SiteProvider,
  type SiteRef,
} from '../modules/site/providers/site-provider.interface';
import { MockSiteProvider, type MockSiteScenario } from '../modules/site/providers/mock.provider';
import {
  getSiteProvider,
  listKnownSiteProviders,
  listSelectableSiteProviderValues,
  resetSiteProvider,
  setSiteProvider,
} from '../modules/site/providers';

function siteRef(overrides: Partial<SiteRef> = {}): SiteRef {
  return {
    id: 'site-1',
    tenantId: 'tenant-a',
    domain: 'example.com',
    platform: 'wordpress',
    ...overrides,
  };
}

function change(overrides: Partial<SiteChangeInput> = {}): SiteChangeInput {
  return {
    changeId: 'change-1',
    pageUrl: '/blog/example',
    isNewPage: true,
    metaTitle: 'Example title',
    metaDescription: 'Example description',
    ...overrides,
  };
}

function approvedChange(stagedRef: string, overrides: Partial<ApprovedSiteChange> = {}): ApprovedSiteChange {
  return {
    stagedRef,
    changeId: 'change-1',
    approvedBy: 'jatin@growthescalators.com',
    approvedAt: new Date('2026-08-05T00:00:00.000Z'),
    publishRequestId: 'req-1',
    ...overrides,
  };
}

describe('MockSiteProvider — capability profile + determinism contract', () => {
  let provider: MockSiteProvider;
  beforeEach(() => {
    provider = new MockSiteProvider();
  });

  it('defaults to the wordpress profile', () => {
    expect(provider.__getProfile()).toBe('wordpress');
    expect(provider.capabilities.stagesRemoteDraft).toBe(true);
    expect(provider.capabilities.producesReviewableDiff).toBe(false);
  });

  it('identity.name never changes across a profile switch — callers must branch on capabilities, not name', () => {
    expect(provider.identity.name).toBe('mock');
    provider.__setProfile('git');
    expect(provider.identity.name).toBe('mock');
    expect(provider.capabilities.producesReviewableDiff).toBe(true);
    expect(provider.capabilities.stagesRemoteDraft).toBe(false);
  });

  it('is ready by default with no configuration required', () => {
    expect(provider.getConfigStatus(siteRef())).toEqual({ status: 'ready' });
    expect(() => assertSiteProviderReady(provider, siteRef())).not.toThrow();
  });

  it('capabilities and identity are frozen against runtime mutation of the shared singleton', () => {
    expect(Object.isFrozen(provider.capabilities)).toBe(true);
    expect(Object.isFrozen(provider.identity)).toBe(true);
    expect(() => {
      (provider.capabilities as { publishesViaApi: boolean }).publishesViaApi = false;
    }).toThrow(TypeError);
    expect(provider.capabilities.publishesViaApi).toBe(true);
  });

  it('stageChange returns a previewUrl only when stagesRemoteDraft, and a diff only when producesReviewableDiff', async () => {
    const wpResult = await provider.stageChange(siteRef(), change());
    expect(wpResult.previewUrl).toBeDefined();
    expect(wpResult.diff).toBeUndefined();

    provider.__setProfile('git');
    const gitResult = await provider.stageChange(siteRef(), change());
    expect(gitResult.previewUrl).toBeUndefined();
    expect(gitResult.diff).toBeDefined();
    expect(gitResult.diff).toContain('--- a/blog/example');
  });

  it('produces deterministic staged ids across repeated calls after reset', async () => {
    const first = await provider.stageChange(siteRef(), change());
    provider.__reset();
    const second = await provider.stageChange(siteRef(), change());
    expect(second.stagedRef).toBe(first.stagedRef);
    expect(first.stagedRef).toBe('mock-stage-tenant-a:site-1-1');
  });

  it('verifyChange reports a warning issue only when verifiesOffline is false, and always passes in the mock', async () => {
    const staged = await provider.stageChange(siteRef(), change());
    const wpVerify = await provider.verifyChange(siteRef(), staged);
    expect(wpVerify.passed).toBe(true);
    expect(wpVerify.issues).toHaveLength(1);
    expect(wpVerify.issues[0].code).toBe('no_offline_verification');

    provider.__setProfile('git');
    const gitStaged = await provider.stageChange(siteRef(), change());
    const gitVerify = await provider.verifyChange(siteRef(), gitStaged);
    expect(gitVerify.issues).toEqual([]);
  });

  it('publishChange returns published for an API-publishing profile and handoff_required for a merge-publishing profile', async () => {
    const staged = await provider.stageChange(siteRef(), change());
    const published = await provider.publishChange(siteRef(), approvedChange(staged.stagedRef));
    expect(published).toMatchObject({
      status: 'published',
      liveUrl: `https://example.com/mock-published/${staged.stagedRef}`,
    });

    provider.__setProfile('git');
    const gitStaged = await provider.stageChange(siteRef(), change());
    const handoff = await provider.publishChange(siteRef(), approvedChange(gitStaged.stagedRef));
    expect(handoff).toMatchObject({
      status: 'handoff_required',
      handoff: { kind: 'git_merge', branch: `mock-site-change/${gitStaged.stagedRef}` },
    });
  });

  it('publishChange refuses to publish without a recorded approver, regardless of scenario', async () => {
    const staged = await provider.stageChange(siteRef(), change());
    await expect(
      provider.publishChange(siteRef(), approvedChange(staged.stagedRef, { approvedBy: '' })),
    ).rejects.toMatchObject({ code: 'unauthorised_publish' });
    await expect(
      provider.publishChange(siteRef(), approvedChange(staged.stagedRef, { approvedBy: '   ' })),
    ).rejects.toMatchObject({ code: 'unauthorised_publish' });
    // neither rejected attempt performed any work
    expect(provider.__getCalls('tenant-a', 'site-1').filter((c) => c.method === 'publishChange')).toEqual([]);
  });

  it('publishChange rejects a blank stagedRef as invalid_input', async () => {
    await expect(provider.publishChange(siteRef(), approvedChange('   '))).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('fetchLiveSnapshot returns a snapshot and rejects a blank pageUrl', async () => {
    const snapshot = await provider.fetchLiveSnapshot(siteRef(), '/blog/example');
    expect(snapshot).toMatchObject({ pageUrl: '/blog/example', httpStatus: 200 });
    await expect(provider.fetchLiveSnapshot(siteRef(), '')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it.each([
    ['unsupported', 'unsupported_capability'],
    ['failure', 'provider_unavailable'],
    ['duplicate', 'duplicate_operation'],
    ['malformed_response', 'provider_response_invalid'],
  ])('scenario=%s fails closed as %s and performs no work', async (scenario: string, code: string) => {
    provider.__setScenario('tenant-a', 'site-1', scenario as MockSiteScenario);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code });
    expect(provider.__getCalls('tenant-a', 'site-1')).toEqual([]);

    provider.__setScenario('tenant-a', 'site-1', 'success');
    const result = await provider.stageChange(siteRef(), change());
    // counter untouched by the failed attempt — the first successful call still gets id 1
    expect(result.stagedRef).toBe('mock-stage-tenant-a:site-1-1');
  });

  it('a scenario set for one site does not affect another (no cross-site leakage)', async () => {
    provider.__setScenario('tenant-a', 'site-1', 'failure');
    await expect(provider.stageChange(siteRef({ id: 'site-1' }), change())).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    await expect(provider.stageChange(siteRef({ id: 'site-2' }), change())).resolves.toBeTruthy();
  });

  it('captured calls and deterministic ids never leak across tenants/sites', async () => {
    await provider.stageChange(siteRef({ tenantId: 'tenant-a', id: 'site-1' }), change());
    await provider.stageChange(siteRef({ tenantId: 'tenant-b', id: 'site-1' }), change());
    const aCalls = provider.__getCalls('tenant-a', 'site-1');
    const bCalls = provider.__getCalls('tenant-b', 'site-1');
    expect(aCalls).toHaveLength(1);
    expect(bCalls).toHaveLength(1);
    expect(aCalls[0].key).toBe('tenant-a:site-1');
    expect(bCalls[0].key).toBe('tenant-b:site-1');
  });

  it('refuses a blank tenantId or siteId rather than collapsing every caller into one bucket', async () => {
    await expect(provider.stageChange(siteRef({ tenantId: '' }), change())).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(provider.stageChange(siteRef({ id: '   ' }), change())).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('rejects a change missing changeId or pageUrl as invalid_input', async () => {
    await expect(provider.stageChange(siteRef(), change({ changeId: '' }))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(provider.stageChange(siteRef(), change({ pageUrl: '' }))).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('missing configuration is never treated as ready', () => {
    provider.__setConfigStatus({ status: 'not_configured', reason: 'no credentialRef set' });
    expect(() => assertSiteProviderReady(provider, siteRef())).toThrow(SiteProviderError);
    try {
      assertSiteProviderReady(provider, siteRef());
    } catch (err) {
      expect((err as SiteProviderError).code).toBe('missing_configuration');
    }
  });

  it('__reset clears calls, scenarios, id counters, config status and profile', async () => {
    provider.__setProfile('git');
    provider.__setScenario('tenant-a', 'site-1', 'failure');
    provider.__setConfigStatus({ status: 'misconfigured', reason: 'simulated' });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({
      code: 'provider_unavailable',
    });

    provider.__reset();

    expect(provider.__getProfile()).toBe('wordpress');
    expect(provider.getConfigStatus(siteRef())).toEqual({ status: 'ready' });
    const result = await provider.stageChange(siteRef(), change());
    expect(result.stagedRef).toBe('mock-stage-tenant-a:site-1-1');
  });

  it('makes no network call of any kind across the full lifecycle', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const staged = await provider.stageChange(siteRef(), change());
      await provider.verifyChange(siteRef(), staged);
      await provider.publishChange(siteRef(), approvedChange(staged.stagedRef));
      await provider.fetchLiveSnapshot(siteRef(), '/blog/example');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('assertSiteProviderCapability — fails closed on any non-true value', () => {
  it('throws when the capability is explicitly false', () => {
    const provider = new MockSiteProvider();
    expect(() => assertSiteProviderCapability(provider, 'producesReviewableDiff')).toThrow(SiteProviderError);
  });

  it('throws for a malformed/unknown capability key rather than treating it as granted', () => {
    const provider = new MockSiteProvider();
    // Cast bypasses the type system the way a bug (typo, dynamic string) would at runtime.
    expect(() => assertSiteProviderCapability(provider, 'notARealCapability' as never)).toThrow(SiteProviderError);
  });

  it('does not throw when the capability is explicitly true', () => {
    const provider = new MockSiteProvider();
    expect(() => assertSiteProviderCapability(provider, 'publishesViaApi')).not.toThrow();
  });

  it('reports the unsupported_capability code', () => {
    const provider = new MockSiteProvider();
    try {
      assertSiteProviderCapability(provider, 'producesReviewableDiff');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as SiteProviderError).code).toBe('unsupported_capability');
    }
  });
});

describe('site provider factory/registry', () => {
  const ORIGINAL_ENABLED = process.env.SITE_ADAPTER_ENABLED;
  const ORIGINAL_PROVIDER = process.env.SITE_PROVIDER;

  beforeEach(() => {
    resetSiteProvider();
    delete process.env.SITE_ADAPTER_ENABLED;
    delete process.env.SITE_PROVIDER;
  });

  afterEach(() => {
    resetSiteProvider();
    if (ORIGINAL_ENABLED === undefined) delete process.env.SITE_ADAPTER_ENABLED;
    else process.env.SITE_ADAPTER_ENABLED = ORIGINAL_ENABLED;
    if (ORIGINAL_PROVIDER === undefined) delete process.env.SITE_PROVIDER;
    else process.env.SITE_PROVIDER = ORIGINAL_PROVIDER;
  });

  it('lists only providers that actually have a builder', () => {
    expect(listKnownSiteProviders()).toEqual(['mock', 'git', 'wordpress', 'shopify']);
  });

  it('never selects a live/real provider merely because the adapter module was imported', () => {
    // Import-time only — no env set, no call made. Having a builder registered
    // is not the same as having one constructed: with both env gates unset,
    // every platform must still refuse to hand back an adapter.
    for (const platform of ['git', 'wordpress', 'shopify'] as const) {
      expect(() => getSiteProvider(platform)).toThrow(SiteProviderError);
    }
  });

  it('refuses to let SITE_PROVIDER name a platform adapter', () => {
    // `SITE_PROVIDER=wordpress` would route git and Shopify sites through the
    // WordPress adapter too — the cross-wiring the per-platform Map exists to
    // prevent, reintroduced through the env. Rejected explicitly.
    process.env.SITE_ADAPTER_ENABLED = 'true';
    for (const name of ['git', 'wordpress', 'shopify']) {
      process.env.SITE_PROVIDER = name;
      resetSiteProvider();
      try {
        getSiteProvider('git');
        throw new Error(`expected SITE_PROVIDER=${name} to be rejected`);
      } catch (err) {
        expect(err).toBeInstanceOf(SiteProviderError);
        expect((err as SiteProviderError).code).toBe('unknown_provider');
      }
    }
  });

  it('gives each platform its own real adapter under SITE_PROVIDER=platform', () => {
    process.env.SITE_ADAPTER_ENABLED = 'true';
    process.env.SITE_PROVIDER = 'platform';
    expect(getSiteProvider('git').identity.name).toBe('git');
    expect(getSiteProvider('wordpress').identity.name).toBe('wordpress');
    expect(getSiteProvider('shopify').identity.name).toBe('shopify');
  });

  it('exposes the selectable values so docs and tests cannot drift from the implementation', () => {
    expect(listSelectableSiteProviderValues()).toEqual(['platform', 'mock']);
  });

  it('fails closed with missing_configuration when SITE_ADAPTER_ENABLED is unset', () => {
    process.env.SITE_PROVIDER = 'mock';
    expect(() => getSiteProvider('wordpress')).toThrow(SiteProviderError);
    try {
      getSiteProvider('wordpress');
    } catch (err) {
      expect((err as SiteProviderError).code).toBe('missing_configuration');
    }
  });

  it('fails closed with unknown_provider when enabled but SITE_PROVIDER is unset', () => {
    process.env.SITE_ADAPTER_ENABLED = 'true';
    expect(() => getSiteProvider('wordpress')).toThrow(SiteProviderError);
    try {
      getSiteProvider('wordpress');
    } catch (err) {
      expect((err as SiteProviderError).code).toBe('unknown_provider');
    }
  });

  it('fails closed — never falls back to mock or any other provider — for an unrecognised name', () => {
    process.env.SITE_ADAPTER_ENABLED = 'true';
    process.env.SITE_PROVIDER = 'totally-unknown-cms';
    expect(() => getSiteProvider('wordpress')).toThrow(SiteProviderError);
    try {
      getSiteProvider('wordpress');
    } catch (err) {
      expect((err as SiteProviderError).code).toBe('unknown_provider');
      expect((err as SiteProviderError).provider).toBe('totally-unknown-cms');
    }
  });

  it('builds the mock provider when enabled and SITE_PROVIDER=mock, case-insensitively', () => {
    process.env.SITE_ADAPTER_ENABLED = 'true';
    process.env.SITE_PROVIDER = 'MOCK';
    expect(getSiteProvider('wordpress').identity.name).toBe('mock');
  });

  it('keeps one independent singleton per platform', () => {
    process.env.SITE_ADAPTER_ENABLED = 'true';
    process.env.SITE_PROVIDER = 'mock';
    const wp = getSiteProvider('wordpress');
    const git = getSiteProvider('git');
    expect(wp).not.toBe(git);
    expect(getSiteProvider('wordpress')).toBe(wp);
    expect(getSiteProvider('git')).toBe(git);
  });

  it('setSiteProvider/resetSiteProvider are effective per-platform DI hooks', () => {
    const injected = new MockSiteProvider();
    setSiteProvider('shopify', injected);
    expect(getSiteProvider('shopify')).toBe(injected);

    resetSiteProvider('shopify');
    expect(() => getSiteProvider('shopify')).toThrow(SiteProviderError);
  });

  it('resetSiteProvider() with no platform argument clears every platform at once', () => {
    setSiteProvider('git', new MockSiteProvider());
    setSiteProvider('wordpress', new MockSiteProvider());
    resetSiteProvider();
    expect(() => getSiteProvider('git')).toThrow(SiteProviderError);
    expect(() => getSiteProvider('wordpress')).toThrow(SiteProviderError);
  });

  it('resetting one platform does not affect another', () => {
    const gitInjected = new MockSiteProvider();
    const wpInjected = new MockSiteProvider();
    setSiteProvider('git', gitInjected);
    setSiteProvider('wordpress', wpInjected);
    resetSiteProvider('git');
    expect(() => getSiteProvider('git')).toThrow(SiteProviderError);
    expect(getSiteProvider('wordpress')).toBe(wpInjected);
  });
});

/** A caller written only against the SiteProvider interface — proves the seam holds. */
async function driveFullLifecycle(provider: SiteProvider, site: SiteRef): Promise<SitePublishResult> {
  const staged = await provider.stageChange(site, change());
  const verified = await provider.verifyChange(site, staged);
  if (!verified.passed) throw new Error('verification failed');
  return provider.publishChange(site, approvedChange(staged.stagedRef));
}

describe('ADR-007-style seam proof (required per Lane C spec)', () => {
  afterEach(() => {
    resetSiteProvider();
  });

  it('swapping in the mock via setSiteProvider() changes no caller', async () => {
    const injected = new MockSiteProvider();
    setSiteProvider('wordpress', injected);
    const result = await driveFullLifecycle(getSiteProvider('wordpress'), siteRef({ platform: 'wordpress' }));
    expect(result.status).toBe('published');
    expect(getSiteProvider('wordpress')).toBe(injected);
  });
});
