import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

import {
  SITE_PROVIDER_CAPABILITY_MATRIX,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SiteRef,
} from '../modules/site/providers/site-provider.interface';
import {
  WordPressSiteProvider,
  type WordPressCredentials,
  type WordPressSiteProviderDeps,
} from '../modules/site/providers/wordpress.provider';

// No network, no database, no real credentials anywhere in this file — every
// test injects a fake fetchImpl and/or a fake loadCredentials via the
// constructor. Fixture below is a placeholder shape, never a real secret.
const FAKE_CREDENTIALS: WordPressCredentials = { username: 'ge-bot', applicationPassword: 'not-a-real-app-password' };

function siteRef(overrides: Partial<SiteRef> = {}): SiteRef {
  return {
    id: 'site-1',
    tenantId: 'tenant-a',
    domain: 'example.com',
    platform: 'wordpress',
    adapterConfig: { baseUrl: 'https://example.com' },
    ...overrides,
  };
}

function change(overrides: Partial<SiteChangeInput> = {}): SiteChangeInput {
  return {
    changeId: 'change-1',
    pageUrl: '/blog/example',
    isNewPage: true,
    title: 'Example title',
    metaTitle: 'Example meta title',
    metaDescription: 'Example meta description',
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function wpPage(overrides: Partial<{ id: number; status: string; link: string; slug: string; preview_link: string }> = {}) {
  return { id: 7, status: 'draft', link: 'https://example.com/example/', slug: 'example', ...overrides };
}

/** Builds a provider with sane defaults (credentials resolve, fetch is unset/overridable) for tests that only care about one axis. */
function makeProvider(opts: {
  fetchImpl?: typeof fetch;
  loadCredentialsResult?: WordPressCredentials | null;
  loadCredentials?: WordPressSiteProviderDeps['loadCredentials'];
}): { provider: WordPressSiteProvider; fetchImpl: ReturnType<typeof vi.fn>; loadCredentials: ReturnType<typeof vi.fn> } {
  const fetchImpl = (opts.fetchImpl ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>;
  const loadCredentials = (opts.loadCredentials
    ?? vi.fn(async () => (opts.loadCredentialsResult === undefined ? FAKE_CREDENTIALS : opts.loadCredentialsResult))
  ) as unknown as ReturnType<typeof vi.fn>;
  const provider = new WordPressSiteProvider({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    loadCredentials: loadCredentials as unknown as WordPressSiteProviderDeps['loadCredentials'],
  });
  return { provider, fetchImpl, loadCredentials };
}

describe('WordPressSiteProvider — identity and capabilities', () => {
  it('matches the wordpress row in SITE_PROVIDER_CAPABILITY_MATRIX exactly, and both are frozen', () => {
    const provider = new WordPressSiteProvider();
    expect(provider.identity).toEqual({ name: 'wordpress', version: '1.0.0' });
    expect(provider.capabilities).toEqual(SITE_PROVIDER_CAPABILITY_MATRIX.wordpress);
    expect(Object.isFrozen(provider.identity)).toBe(true);
    expect(Object.isFrozen(provider.capabilities)).toBe(true);
  });
});

describe('WordPressSiteProvider — getConfigStatus (sync, never resolves credentials)', () => {
  it('never calls the credential loader', () => {
    const { provider, loadCredentials } = makeProvider({});
    const status = provider.getConfigStatus(siteRef());
    expect(status).toEqual({ status: 'ready' });
    expect(loadCredentials).not.toHaveBeenCalled();
  });

  it('reports not_configured when adapterConfig.baseUrl is absent', () => {
    const { provider } = makeProvider({});
    const status = provider.getConfigStatus(siteRef({ adapterConfig: {} }));
    expect(status.status).toBe('not_configured');
  });

  it('reports misconfigured for an SSRF-unsafe baseUrl', () => {
    const { provider } = makeProvider({});
    const status = provider.getConfigStatus(siteRef({ adapterConfig: { baseUrl: 'http://169.254.169.254/' } }));
    expect(status.status).toBe('misconfigured');
  });

  it('reports misconfigured for an explicitly-blank credentialProvider pointer', () => {
    // Reads the top-level SiteRef field, not adapterConfig. The adapterConfig
    // path this test used to exercise was unreachable in production:
    // seoSiteRegistry.assertNoSecretKeys() 400s any adapterConfig key matching
    // /credential/i, and has since the registry's first commit.
    const { provider } = makeProvider({});
    const status = provider.getConfigStatus(
      siteRef({ credentialProvider: '   ', adapterConfig: { baseUrl: 'https://example.com' } }),
    );
    expect(status.status).toBe('misconfigured');
  });

  it('ignores a credentialProvider smuggled into adapterConfig', () => {
    // Belt-and-braces on the removal: even if such a row somehow existed, the
    // adapter must not honour it — there is exactly one pointer now.
    const { provider } = makeProvider({});
    const status = provider.getConfigStatus(
      siteRef({ adapterConfig: { baseUrl: 'https://example.com', credentialProvider: '   ' } }),
    );
    expect(status).toEqual({ status: 'ready' });
  });

  it('is ready with a safe baseUrl and no credentialProvider override (defaults apply later, at call time)', () => {
    const { provider } = makeProvider({});
    expect(provider.getConfigStatus(siteRef())).toEqual({ status: 'ready' });
  });
});

describe('WordPressSiteProvider — credential resolution', () => {
  it('fails closed with missing_configuration when no credentials are on file, and never calls fetch', async () => {
    const { provider, fetchImpl } = makeProvider({ loadCredentialsResult: null });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed with missing_configuration when the stored payload is not a usable credential shape', async () => {
    const { provider } = makeProvider({ loadCredentialsResult: { username: '', applicationPassword: '' } as WordPressCredentials });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });

  it('resolves the credential provider name from site.credentialProvider, defaulting to "wordpress"', async () => {
    const loadCredentials = vi.fn(async () => FAKE_CREDENTIALS);
    const { provider } = makeProvider({
      loadCredentials: loadCredentials as unknown as WordPressSiteProviderDeps['loadCredentials'],
      fetchImpl: (async () => jsonResponse(201, wpPage())) as unknown as typeof fetch,
    });
    await provider.stageChange(siteRef(), change());
    expect(loadCredentials).toHaveBeenCalledWith('tenant-a', 'wordpress');

    loadCredentials.mockClear();
    await provider.stageChange(
      siteRef({ credentialProvider: 'wordpress-client-x', adapterConfig: { baseUrl: 'https://example.com' } }),
      change(),
    );
    expect(loadCredentials).toHaveBeenCalledWith('tenant-a', 'wordpress-client-x');
  });
});

describe('WordPressSiteProvider — stageChange', () => {
  it('creates a new page as a draft (never publish) and returns a previewUrl with diff undefined', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain('/wp-json/wp/v2/pages');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.status).toBe('draft');
      expect(body.slug).toBe('example');
      return jsonResponse(201, wpPage({ id: 42, link: 'https://example.com/example/' }));
    });
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await provider.stageChange(siteRef(), change());
    expect(result.stagedRef).toBe('42');
    expect(result.diff).toBeUndefined();
    expect(result.previewUrl).toBe('https://example.com/example/?preview=true');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('prefers a wordpress-supplied preview_link over the constructed ?preview=true fallback', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, wpPage({ preview_link: 'https://example.com/?page_id=42&preview=true&token=abc' })),
    );
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.stageChange(siteRef(), change());
    expect(result.previewUrl).toBe('https://example.com/?page_id=42&preview=true&token=abc');
  });

  it('resolves an existing page by slug (status=any) before updating, and rejects when none is found', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === undefined || init.method === 'GET') {
        expect(String(url)).toContain('slug=example');
        expect(String(url)).toContain('status=any');
        return jsonResponse(200, [wpPage({ id: 9 })]);
      }
      expect(String(url)).toContain('/wp-json/wp/v2/pages/9');
      return jsonResponse(200, wpPage({ id: 9 }));
    });
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.stageChange(siteRef(), change({ isNewPage: false }));
    expect(result.stagedRef).toBe('9');
  });

  it('fails closed with invalid_input when updating a page whose slug cannot be found', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change({ isNewPage: false }))).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('rejects a change missing changeId or pageUrl as invalid_input, before any fetch', async () => {
    const { provider, fetchImpl } = makeProvider({});
    await expect(provider.stageChange(siteRef(), change({ changeId: '' }))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(provider.stageChange(siteRef(), change({ pageUrl: '' }))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('WordPressSiteProvider — capability warnings for fields this platform cannot write', () => {
  it('a supplied canonicalUrl surfaces a writesCanonical warning on the FOLLOWING verifyChange call', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse(201, wpPage()) : jsonResponse(200, wpPage()),
    );
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const staged = await provider.stageChange(siteRef(), change({ canonicalUrl: 'https://example.com/canonical' }));
    const verified = await provider.verifyChange(siteRef(), staged);

    expect(verified.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'canonical_not_writable' }),
    );
    expect(verified.passed).toBe(true); // a warning alone never blocks
  });

  it('a supplied redirectFrom surfaces a writesRedirects warning; omitting canonicalUrl/redirectFrom surfaces neither', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse(201, wpPage()) : jsonResponse(200, wpPage()),
    );
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const withRedirect = await provider.stageChange(siteRef(), change({ redirectFrom: ['/old-url'] }));
    const verifiedWithRedirect = await provider.verifyChange(siteRef(), withRedirect);
    expect(verifiedWithRedirect.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'redirects_not_writable' }),
    );

    const plain = await provider.stageChange(siteRef(), change());
    const verifiedPlain = await provider.verifyChange(siteRef(), plain);
    expect(verifiedPlain.issues.some((i) => i.code === 'canonical_not_writable' || i.code === 'redirects_not_writable')).toBe(
      false,
    );
  });
});

describe('WordPressSiteProvider — verifyChange', () => {
  it('always includes the no_offline_verification warning (verifiesOffline is false)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, wpPage()));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.verifyChange(siteRef(), { stagedRef: '7', createdAt: new Date() });
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'no_offline_verification' }));
  });

  it('flags a vanished (404) staged ref as blocking, and passed becomes false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { code: 'rest_post_invalid_id' }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.verifyChange(siteRef(), { stagedRef: '999', createdAt: new Date() });
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'blocking', code: 'staged_ref_not_found' }));
  });

  it('flags an already-published staged ref as blocking, and passed becomes false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, wpPage({ status: 'publish' })));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.verifyChange(siteRef(), { stagedRef: '7', createdAt: new Date() });
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'blocking', code: 'staged_ref_already_published' }),
    );
  });

  it('passes (no blocking issues) for a healthy draft with no capability conflicts', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, wpPage({ status: 'draft' })));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.verifyChange(siteRef(), { stagedRef: '7', createdAt: new Date() });
    expect(result.passed).toBe(true);
    expect(result.issues.every((i) => i.severity !== 'blocking')).toBe(true);
  });

  it('rejects a blank stagedRef as invalid_input, before any fetch', async () => {
    const { provider, fetchImpl } = makeProvider({});
    await expect(provider.verifyChange(siteRef(), { stagedRef: '   ', createdAt: new Date() })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('WordPressSiteProvider — publishChange', () => {
  it('refuses to publish without a recorded approver, for both empty and whitespace-only approvedBy — and makes zero fetch calls', async () => {
    const { provider, fetchImpl, loadCredentials } = makeProvider({});
    await expect(provider.publishChange(siteRef(), approvedChange('7', { approvedBy: '' }))).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    await expect(provider.publishChange(siteRef(), approvedChange('7', { approvedBy: '   ' }))).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    // The hard-stop invariant: no network call and no credential lookup happened.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadCredentials).not.toHaveBeenCalled();
  });

  it('rejects a blank stagedRef as invalid_input', async () => {
    const { provider, fetchImpl } = makeProvider({});
    await expect(provider.publishChange(siteRef(), approvedChange('   '))).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('publishes a draft: reads current status, then writes status=publish, and returns published/liveUrl/externalRef', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        expect(init?.method).toBe('GET');
        return jsonResponse(200, wpPage({ status: 'draft' }));
      }
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.status).toBe('publish');
      return jsonResponse(200, wpPage({ status: 'publish', link: 'https://example.com/example/' }));
    });
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await provider.publishChange(siteRef(), approvedChange('7'));
    expect(result).toEqual({ status: 'published', liveUrl: 'https://example.com/example/', externalRef: '7' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('is idempotent: an already-published post is read but never re-written', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return jsonResponse(200, wpPage({ status: 'publish', link: 'https://example.com/example/' }));
    });
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await provider.publishChange(siteRef(), approvedChange('7'));
    expect(result).toEqual({ status: 'published', liveUrl: 'https://example.com/example/', externalRef: '7' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the read — no write
  });

  it('never returns handoff_required — wordpress always publishes via a direct API call', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'GET' ? jsonResponse(200, wpPage({ status: 'draft' })) : jsonResponse(200, wpPage({ status: 'publish' })),
    );
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.publishChange(siteRef(), approvedChange('7'));
    expect(result.status).toBe('published');
  });
});

describe('WordPressSiteProvider — HTTP error mapping (never a bare Error)', () => {
  it('maps 401 to missing_configuration', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });

  it('maps 403 to missing_configuration', async () => {
    const fetchImpl = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });

  it('maps a 5xx to provider_unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 502 }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('maps a transport failure (fetch throws) to provider_unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('maps a malformed 2xx body (unexpected shape) to provider_response_invalid', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { unexpected: 'shape' }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_response_invalid' });
  });

  it('maps a non-JSON 2xx body to provider_response_invalid', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_response_invalid' });
  });

  it('never embeds the raw response body in a thrown error message', async () => {
    const fetchImpl = vi.fn(async () => new Response('super-secret-token-should-never-leak', { status: 500 }));
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    try {
      await provider.stageChange(siteRef(), change());
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-token-should-never-leak');
    }
  });
});

describe('WordPressSiteProvider — fetchLiveSnapshot', () => {
  it('delegates to the shared live-page reader with providerName "wordpress" and the injected fetchImpl', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<html><head><title>Example</title></head><body>hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const snapshot = await provider.fetchLiveSnapshot(siteRef(), 'https://example.com/example/');
    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.metaTitle).toBe('Example');
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe('WordPressSiteProvider — tenant/site isolation of in-process verify-warning state', () => {
  it('a canonicalUrl warning recorded for one site does not leak onto another site sharing the same stagedRef id', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse(201, wpPage({ id: 5 })) : jsonResponse(200, wpPage({ id: 5 })),
    );
    const { provider } = makeProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const siteA = siteRef({ tenantId: 'tenant-a', id: 'site-1' });
    const siteB = siteRef({ tenantId: 'tenant-b', id: 'site-1' }); // same site id, different tenant

    const stagedA = await provider.stageChange(siteA, change({ canonicalUrl: 'https://a.example.com/x' }));
    const stagedB = await provider.stageChange(siteB, change()); // no canonicalUrl

    const verifiedA = await provider.verifyChange(siteA, stagedA);
    const verifiedB = await provider.verifyChange(siteB, stagedB);

    expect(verifiedA.issues.some((i) => i.code === 'canonical_not_writable')).toBe(true);
    expect(verifiedB.issues.some((i) => i.code === 'canonical_not_writable')).toBe(false);
  });
});

describe('WordPressSiteProvider — source hygiene', () => {
  it('never references a WP_ prefixed environment variable — permanent guard against the leaked AGeD credentials creeping back in', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'modules', 'site', 'providers', 'wordpress.provider.ts'),
      'utf8',
    );
    // This checks for an actual environment-variable ACCESS, not any mention
    // of the string "WP_" — the file's own header comments legitimately NAME
    // the leaked variables (WP_AGEDDENTISTRY_URL/USER/PASS) as prose, to
    // explain why they must never be read.
    expect(source).not.toMatch(/process\.env(\.|\[)['"`]?WP_/);
    // Stronger guarantee, and the real invariant this adapter relies on:
    // it never reads process.env at all. Every piece of its configuration
    // comes from SiteRef.adapterConfig or the decrypted tenant_integrations
    // credential, so there is structurally nothing here for a leaked WP_*
    // var (or any other env var) to hook into.
    expect(source).not.toMatch(/process\.env/);
  });
});
