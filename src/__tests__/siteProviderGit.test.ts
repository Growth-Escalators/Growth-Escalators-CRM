import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitSiteProvider } from '../modules/site/providers/git.provider';
import {
  SITE_PROVIDER_CAPABILITY_MATRIX,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SiteRef,
} from '../modules/site/providers/site-provider.interface';

function siteRef(overrides: Partial<SiteRef> = {}): SiteRef {
  return {
    id: 'site-1',
    tenantId: 'tenant-a',
    domain: 'example.com',
    platform: 'git',
    adapterConfig: { repo: 'growth-escalators/example-site', branch: 'main' },
    ...overrides,
  };
}

function change(overrides: Partial<SiteChangeInput> = {}): SiteChangeInput {
  return {
    changeId: 'change-1',
    pageUrl: '/blog/example',
    isNewPage: true,
    metaTitle: 'A Perfectly Reasonable Title',
    metaDescription: 'A perfectly reasonable meta description under the limit.',
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

/** A minimal fake Response — no `.body` stream, so liveSnapshot.ts's readCapped falls back to `.text()`. */
function htmlResponse(html: string, status = 200): Response {
  return {
    status,
    headers: { get: () => null },
    body: undefined,
    text: async () => html,
  } as unknown as Response;
}

const OLD_PAGE_HTML = `<!doctype html><html><head>
  <title>Old Title</title>
  <meta name="description" content="Old description text.">
  <link rel="canonical" href="https://example.com/blog/example">
</head><body><h1>Old H1</h1></body></html>`;

describe('GitSiteProvider — capability profile', () => {
  it('matches the git row of SITE_PROVIDER_CAPABILITY_MATRIX and never publishes via API', () => {
    const provider = new GitSiteProvider();
    expect(provider.identity.name).toBe('git');
    expect(provider.capabilities).toEqual(SITE_PROVIDER_CAPABILITY_MATRIX.git);
    expect(provider.capabilities.stagesRemoteDraft).toBe(false);
    expect(provider.capabilities.producesReviewableDiff).toBe(true);
    expect(provider.capabilities.publishesViaApi).toBe(false);
    expect(provider.capabilities.publishesViaMerge).toBe(true);
  });

  it('freezes identity and capabilities against mutation', () => {
    const provider = new GitSiteProvider();
    expect(Object.isFrozen(provider.identity)).toBe(true);
    expect(Object.isFrozen(provider.capabilities)).toBe(true);
  });
});

describe('GitSiteProvider — getConfigStatus', () => {
  it('is ready when adapterConfig has repo and branch', () => {
    const provider = new GitSiteProvider();
    expect(provider.getConfigStatus(siteRef())).toEqual({ status: 'ready' });
  });

  it('is not_configured when adapterConfig is missing or incomplete, and never echoes a credential', () => {
    const provider = new GitSiteProvider();
    const missing = provider.getConfigStatus(siteRef({ adapterConfig: undefined }));
    expect(missing.status).toBe('not_configured');
    const partial = provider.getConfigStatus(siteRef({ adapterConfig: { repo: 'org/site' } }));
    expect(partial.status).toBe('not_configured');
    // A credentialRef pointer may ride alongside repo/branch (see SiteRef's
    // doc comment) but must never appear in the status result.
    const withPointer = provider.getConfigStatus(
      siteRef({ adapterConfig: { repo: 'org/site', branch: 'main', credentialRef: 'env:SOME_TOKEN' } }),
    );
    expect(JSON.stringify(withPointer)).not.toContain('SOME_TOKEN');
  });
});

describe('GitSiteProvider — stageChange', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let provider: GitSiteProvider;

  beforeEach(() => {
    fetchImpl = vi.fn(async () => htmlResponse(OLD_PAGE_HTML));
    provider = new GitSiteProvider(fetchImpl as unknown as typeof fetch);
  });

  it('never sets previewUrl (stagesRemoteDraft is false) and always sets a diff (producesReviewableDiff is true)', async () => {
    const result = await provider.stageChange(
      siteRef(),
      change({ isNewPage: false, canonicalUrl: 'https://example.com/blog/example-new', title: 'New H1' }),
    );
    expect(result.previewUrl).toBeUndefined();
    expect(result.diff).toBeDefined();
    expect(typeof result.diff).toBe('string');
  });

  it('produces a real old-vs-new unified diff of the SEO surface for an existing page', async () => {
    const result = await provider.stageChange(
      siteRef(),
      change({
        isNewPage: false,
        metaTitle: 'New Title',
        metaDescription: 'New description text.',
        canonicalUrl: 'https://example.com/blog/example-new',
        title: 'New H1',
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.com/blog/example');

    const diff = result.diff ?? '';
    expect(diff).toContain('--- a/blog/example');
    expect(diff).toContain('+++ b/blog/example');
    expect(diff).toContain('@@ meta_title @@');
    expect(diff).toContain('-Old Title');
    expect(diff).toContain('+New Title');
    expect(diff).toContain('@@ meta_description @@');
    expect(diff).toContain('-Old description text.');
    expect(diff).toContain('+New description text.');
    expect(diff).toContain('@@ canonical @@');
    expect(diff).toContain('-https://example.com/blog/example');
    expect(diff).toContain('+https://example.com/blog/example-new');
    expect(diff).toContain('@@ h1 @@');
    expect(diff).toContain('-Old H1');
    expect(diff).toContain('+New H1');
  });

  it('does not include a hunk for a field the change never set, even when the live page has a value', async () => {
    // Only metaTitle is set; metaDescription/canonical/title are explicitly
    // left undefined (overriding the change() fixture's own defaults) so
    // this proves "not part of the change" rather than "happens to match".
    const result = await provider.stageChange(
      siteRef(),
      change({ isNewPage: false, metaTitle: 'New Title Only', metaDescription: undefined }),
    );
    const diff = result.diff ?? '';
    expect(diff).toContain('@@ meta_title @@');
    expect(diff).not.toContain('meta_description');
    expect(diff).not.toContain('@@ canonical @@');
    expect(diff).not.toContain('@@ h1 @@');
  });

  it('a new page never fetches the live page and produces an additions-only diff', async () => {
    const result = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, metaTitle: 'Brand New Title', title: 'Brand New H1' }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    const diff = result.diff ?? '';
    expect(diff).toContain('+Brand New Title');
    expect(diff).toContain('+Brand New H1');
    expect(diff).not.toContain('-Brand');
    expect(diff).not.toContain('# ');
  });

  it('a live-fetch failure does not fail staging — it degrades to an additions-only diff with a noted comment line', async () => {
    fetchImpl.mockImplementation(async () => {
      throw new Error('simulated network failure');
    });
    const result = await provider.stageChange(
      siteRef(),
      change({ isNewPage: false, metaTitle: 'Recovered Title' }),
    );
    expect(result.diff).toBeDefined();
    const diff = result.diff ?? '';
    expect(diff.startsWith('#')).toBe(true);
    expect(diff).toContain('live snapshot unavailable');
    expect(diff).toContain('+Recovered Title');
    // No hunk removal line (a line starting with a lone '-', as opposed to
    // the '---'/'+++' unified-diff file headers, which legitimately start
    // with hyphens) — every field is a pure addition since there is no "old" side.
    const removalLines = diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---'));
    expect(removalLines).toEqual([]);
  });

  it('produces a deterministic stagedRef derived from changeId, stable across repeated staging', async () => {
    const first = await provider.stageChange(siteRef(), change({ isNewPage: true }));
    const second = await provider.stageChange(siteRef(), change({ isNewPage: true }));
    expect(first.stagedRef).toBe(second.stagedRef);
    expect(first.stagedRef).toBe('seo-change/change-1');
  });

  it('never touches the global fetch, only the injected fetchImpl', async () => {
    const globalFetchSpy = vi.fn();
    vi.stubGlobal('fetch', globalFetchSpy);
    try {
      await provider.stageChange(siteRef(), change({ isNewPage: false }));
      expect(globalFetchSpy).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GitSiteProvider — verifyChange', () => {
  let provider: GitSiteProvider;
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Every verify fixture below uses isNewPage: true so stageChange never
    // attempts a live fetch — verifyChange only ever reasons about the
    // staged input, never the network.
    fetchImpl = vi.fn(async () => {
      throw new Error('verifyChange fixtures must never need a live fetch');
    });
    provider = new GitSiteProvider(fetchImpl as unknown as typeof fetch);
  });

  it('returns a single unknown_staged_ref blocking issue (not a throw) for a stagedRef that was never staged', async () => {
    const result = await provider.verifyChange(siteRef(), {
      stagedRef: 'seo-change/never-staged',
      createdAt: new Date(),
    });
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: 'blocking', code: 'unknown_staged_ref' }),
    ]);
  });

  it('flags a missing metaTitle on a new page as blocking (meta_title_missing)', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true, metaTitle: undefined }));
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'blocking', code: 'meta_title_missing' }));
  });

  it('warns (not blocks) on a metaTitle over 60 characters', async () => {
    const longTitle = 'x'.repeat(61);
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true, metaTitle: longTitle }));
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'meta_title_too_long' }));
    expect(result.passed).toBe(true);
  });

  it('warns (not blocks) on a metaDescription over 160 characters', async () => {
    const longDescription = 'x'.repeat(161);
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, metaDescription: longDescription }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'meta_description_too_long' }),
    );
    expect(result.passed).toBe(true);
  });

  it('blocks a canonicalUrl that is not an absolute http(s) URL', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true, canonicalUrl: '/relative/path' }));
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'blocking', code: 'canonical_invalid_url' }));
  });

  it('blocks a canonicalUrl on a different domain from the site', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, canonicalUrl: 'https://not-my-domain.com/blog/example' }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'blocking', code: 'canonical_off_domain' }));
  });

  it('accepts a same-domain (including www-prefixed) canonicalUrl', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, canonicalUrl: 'https://www.example.com/blog/example' }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues.filter((i) => i.code.startsWith('canonical'))).toEqual([]);
  });

  it('accepts a same-origin relative redirectFrom path', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true, redirectFrom: ['/old-path'] }));
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues.filter((i) => i.code.startsWith('redirect_from'))).toEqual([]);
  });

  it('blocks a redirectFrom entry on a different origin', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, redirectFrom: ['https://someone-elses-site.com/old-path'] }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'blocking', code: 'redirect_from_off_origin' }),
    );
  });

  it('blocks a malformed (non-path, non-URL) redirectFrom entry', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true, redirectFrom: ['not a url'] }));
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'blocking', code: 'redirect_from_invalid' }));
  });

  it('blocks bodyHtml containing a <script> tag', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, bodyHtml: '<p>hi</p><script>alert(1)</script>' }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'blocking', code: 'body_html_contains_script' }),
    );
  });

  it('allows bodyHtml with no script tag', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true, bodyHtml: '<p>all clear</p>' }));
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues.filter((i) => i.code === 'body_html_contains_script')).toEqual([]);
  });

  it('warns (not blocks) when structuredData has no @type', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, structuredData: { name: 'Example' } }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'structured_data_missing_type' }),
    );
    expect(result.passed).toBe(true);
  });

  it('warns (not blocks) when structuredData cannot be JSON-serialised', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, structuredData: { '@type': 'Article', bad: BigInt(5) } as Record<string, unknown> }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'structured_data_not_serialisable' }),
    );
    expect(result.passed).toBe(true);
  });

  it('accepts well-formed structuredData with an @type and raises no structured-data issue', async () => {
    const staged = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, structuredData: { '@type': 'Article', headline: 'Example' } }),
    );
    const result = await provider.verifyChange(siteRef(), staged);
    expect(result.issues.filter((i) => i.code.startsWith('structured_data'))).toEqual([]);
  });

  it('passed is false iff at least one blocking issue is present — warnings alone still pass', async () => {
    const warningOnly = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, metaTitle: 'x'.repeat(70) }),
    );
    const warningResult = await provider.verifyChange(siteRef(), warningOnly);
    expect(warningResult.issues.length).toBeGreaterThan(0);
    expect(warningResult.passed).toBe(true);

    const blocking = await provider.stageChange(
      siteRef(),
      change({ isNewPage: true, metaTitle: undefined }),
    );
    const blockingResult = await provider.verifyChange(siteRef(), blocking);
    expect(blockingResult.passed).toBe(false);
  });

  it('makes no network call — verify reasons only about the staged input', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true }));
    await provider.verifyChange(siteRef(), staged);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GitSiteProvider — publishChange', () => {
  let provider: GitSiteProvider;
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn(async () => {
      throw new Error('publishChange must never touch fetch');
    });
    provider = new GitSiteProvider(fetchImpl as unknown as typeof fetch);
  });

  it('throws unauthorised_publish (with the right code) when approvedBy is absent, BEFORE any site/config/fetch work', async () => {
    // adapterConfig is deliberately absent — if the approvedBy check did not
    // run first, this call would instead fail with missing_configuration
    // (or attempt to touch the staged-input map / fetch). Getting
    // unauthorised_publish back proves the ordering.
    const site = siteRef({ adapterConfig: undefined, tenantId: '', id: '' });
    await expect(
      provider.publishChange(site, approvedChange('seo-change/change-1', { approvedBy: '' })),
    ).rejects.toMatchObject({ code: 'unauthorised_publish' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws unauthorised_publish for a whitespace-only approvedBy', async () => {
    await expect(
      provider.publishChange(siteRef(), approvedChange('seo-change/change-1', { approvedBy: '   ' })),
    ).rejects.toMatchObject({ code: 'unauthorised_publish' });
  });

  it('always returns handoff_required — never published — even for a fully approved change', async () => {
    const staged = await provider.stageChange(siteRef(), change({ isNewPage: true }));
    const result = await provider.publishChange(siteRef(), approvedChange(staged.stagedRef));
    expect(result.status).toBe('handoff_required');
    if (result.status !== 'handoff_required') throw new Error('unreachable');
    expect(result.handoff.kind).toBe('git_merge');
    expect(result.handoff.branch).toBe(staged.stagedRef);
    expect(result.handoff.compareUrl).toContain('growth-escalators/example-site');
    expect(result.handoff.compareUrl).toContain('main');
    // The branch is slash-delimited (seo-change/<changeId>) and must stay
    // literal in the URL — a blind encodeURIComponent would turn it into
    // %2F and break the link a human is meant to click.
    expect(result.handoff.compareUrl).toContain(`...${staged.stagedRef}`);
  });

  it('defaults the compare host to github.com when adapterConfig.host is not set', async () => {
    const result = await provider.publishChange(
      siteRef({ adapterConfig: { repo: 'org/site', branch: 'main' } }),
      approvedChange('seo-change/change-1'),
    );
    if (result.status !== 'handoff_required') throw new Error('unreachable');
    expect(result.handoff.compareUrl.startsWith('https://github.com/')).toBe(true);
  });

  it('rejects a blank stagedRef as invalid_input', async () => {
    await expect(provider.publishChange(siteRef(), approvedChange('   '))).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('fails closed with missing_configuration when adapterConfig lacks repo/branch', async () => {
    await expect(
      provider.publishChange(siteRef({ adapterConfig: undefined }), approvedChange('seo-change/change-1')),
    ).rejects.toMatchObject({ code: 'missing_configuration' });
  });
});

describe('GitSiteProvider — fetchLiveSnapshot', () => {
  it('delegates to the shared live snapshot reader', async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(OLD_PAGE_HTML));
    const provider = new GitSiteProvider(fetchImpl as unknown as typeof fetch);
    const snapshot = await provider.fetchLiveSnapshot(siteRef(), 'https://example.com/blog/example');
    expect(snapshot.metaTitle).toBe('Old Title');
    expect(snapshot.canonicalUrl).toBe('https://example.com/blog/example');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an SSRF-unsafe URL (cloud metadata) without ever invoking fetchImpl', async () => {
    const fetchImpl = vi.fn();
    const provider = new GitSiteProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.fetchLiveSnapshot(siteRef(), 'http://169.254.169.254/')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
