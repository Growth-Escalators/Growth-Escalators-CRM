import { describe, expect, it, vi } from 'vitest';

import { ShopifySiteProvider, type ShopifyCredentials } from '../modules/site/providers/shopify.provider';
import {
  SITE_PROVIDER_CAPABILITY_MATRIX,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SiteRef,
} from '../modules/site/providers/site-provider.interface';

// ---------------------------------------------------------------------------
// Test doubles. No network, no database, no real credentials anywhere below —
// every fetch call is served from an in-memory queue and every credential
// load is an injected fake. Mirrors the style of siteProvider.test.ts.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

interface QueuedResponse {
  readonly status: number;
  readonly json?: unknown;
}

function makeFetch(queue: QueuedResponse[]): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  // `RequestInfo` is not in this project's TS lib set — Parameters<typeof fetch>
  // takes the input type straight from the ambient fetch declaration instead,
  // so it stays correct whichever lib is configured.
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const next = queue.shift();
    if (!next) throw new Error(`no queued response for ${method} ${url}`);
    const text = next.json === undefined ? '' : JSON.stringify(next.json);
    return { status: next.status, text: async () => text } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const CREDS: ShopifyCredentials = { shop: 'example-store.myshopify.com', accessToken: 'shpat_test_token' };

function makeProvider(queue: QueuedResponse[], creds: ShopifyCredentials | null = CREDS) {
  const { fetchImpl, calls } = makeFetch(queue);
  const loadCredentials = vi.fn(async () => creds);
  const provider = new ShopifySiteProvider({ fetchImpl, loadCredentials });
  return { provider, calls, loadCredentials, fetchImpl };
}

function siteRef(overrides: Partial<SiteRef> = {}): SiteRef {
  return {
    id: 'site-1',
    tenantId: 'tenant-a',
    domain: 'example-store.com',
    platform: 'shopify',
    adapterConfig: { themeSnippetInstalled: true },
    ...overrides,
  };
}

function change(overrides: Partial<SiteChangeInput> = {}): SiteChangeInput {
  return {
    changeId: 'change-1',
    pageUrl: '/pages/about-us',
    isNewPage: true,
    ...overrides,
  };
}

function approved(stagedRef: string, overrides: Partial<ApprovedSiteChange> = {}): ApprovedSiteChange {
  return {
    stagedRef,
    changeId: 'change-1',
    approvedBy: 'jatin@growthescalators.com',
    approvedAt: new Date('2026-08-05T00:00:00.000Z'),
    publishRequestId: 'req-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('ShopifySiteProvider — identity + capability profile', () => {
  it('capabilities match the shopify row in SITE_PROVIDER_CAPABILITY_MATRIX exactly', () => {
    const { provider } = makeProvider([]);
    expect(provider.capabilities).toEqual(SITE_PROVIDER_CAPABILITY_MATRIX.shopify);
    expect(provider.identity).toEqual({ name: 'shopify', version: '1.0.0' });
  });

  it('capabilities and identity are frozen', () => {
    const { provider } = makeProvider([]);
    expect(Object.isFrozen(provider.capabilities)).toBe(true);
    expect(Object.isFrozen(provider.identity)).toBe(true);
  });
});

describe('ShopifySiteProvider — getConfigStatus', () => {
  it('never calls the credential loader — must stay synchronous-safe', () => {
    const { provider, loadCredentials } = makeProvider([]);
    provider.getConfigStatus(siteRef());
    expect(loadCredentials).not.toHaveBeenCalled();
  });

  it('is ready when domain is present and the theme snippet is installed', () => {
    const { provider } = makeProvider([]);
    expect(provider.getConfigStatus(siteRef())).toEqual({ status: 'ready' });
  });

  it('is not_configured when site.domain is missing', () => {
    const { provider } = makeProvider([]);
    expect(provider.getConfigStatus(siteRef({ domain: '' }))).toEqual({
      status: 'not_configured',
      reason: 'site.domain is required to resolve the Shopify shop',
    });
  });

  it('is misconfigured with theme_snippet_missing when adapterConfig.themeSnippetInstalled is not true', () => {
    const { provider } = makeProvider([]);
    expect(provider.getConfigStatus(siteRef({ adapterConfig: {} }))).toEqual({
      status: 'misconfigured',
      reason: 'theme_snippet_missing',
    });
    expect(provider.getConfigStatus(siteRef({ adapterConfig: { themeSnippetInstalled: false } }))).toEqual({
      status: 'misconfigured',
      reason: 'theme_snippet_missing',
    });
  });
});

describe('ShopifySiteProvider — credentials', () => {
  it('throws missing_configuration when no credentials are configured for the tenant', async () => {
    const { provider } = makeProvider([], null);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });

  it('throws missing_configuration when the credential row is missing shop or accessToken', async () => {
    const { provider } = makeProvider([], { shop: '', accessToken: 'token' } as ShopifyCredentials);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });
});

describe('ShopifySiteProvider — stageChange', () => {
  it('creates an unpublished page and returns a previewUrl with diff always undefined', async () => {
    const { provider, calls } = makeProvider([
      { status: 201, json: { page: { id: 111, handle: 'about-us', published_at: null } } }, // create page
      { status: 201, json: { metafield: {} } }, // title_tag metafield
    ]);
    const result = await provider.stageChange(siteRef(), change({ metaTitle: 'About us' }));

    expect(result.stagedRef).toBe('111');
    expect(result.previewUrl).toBe('https://example-store.myshopify.com/admin/pages/111');
    expect(result.diff).toBeUndefined();

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/pages.json');
    expect((calls[0].body as { page: { published: boolean } }).page.published).toBe(false);
  });

  it('writes metaTitle/metaDescription as global.title_tag/description_tag metafields', async () => {
    const { provider, calls } = makeProvider([
      { status: 201, json: { page: { id: 112, handle: 'about-us', published_at: null } } },
      { status: 201, json: { metafield: {} } },
      { status: 201, json: { metafield: {} } },
    ]);
    await provider.stageChange(siteRef(), change({ metaTitle: 'About us', metaDescription: 'Our story' }));

    const titleCall = calls[1];
    const descCall = calls[2];
    expect((titleCall.body as { metafield: { namespace: string; key: string; value: string } }).metafield).toMatchObject({
      namespace: 'global', key: 'title_tag', value: 'About us',
    });
    expect((descCall.body as { metafield: { namespace: string; key: string; value: string } }).metafield).toMatchObject({
      namespace: 'global', key: 'description_tag', value: 'Our story',
    });
  });

  it('looks up the existing page by handle for an update (isNewPage: false)', async () => {
    const { provider, calls } = makeProvider([
      { status: 200, json: { pages: [{ id: 888 }] } }, // lookup by handle
      { status: 200, json: { page: { id: 888, handle: 'about-us', published_at: null } } }, // update
    ]);
    const result = await provider.stageChange(siteRef(), change({ isNewPage: false }));

    expect(result.stagedRef).toBe('888');
    expect(calls[0].url).toContain('pages.json?handle=about-us');
    expect(calls[1].method).toBe('PUT');
  });

  it('rejects an update with invalid_input when no page matches the handle', async () => {
    const { provider } = makeProvider([{ status: 200, json: { pages: [] } }]);
    await expect(provider.stageChange(siteRef(), change({ isNewPage: false }))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects a pageUrl with no path segment before making any request', async () => {
    const { provider, fetchImpl } = makeProvider([]);
    await expect(provider.stageChange(siteRef(), change({ pageUrl: '/' }))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopifySiteProvider — verifyChange', () => {
  it('always includes no_offline_verification, since verifiesOffline is false', async () => {
    const { provider } = makeProvider([{ status: 200, json: { page: { id: 200, handle: 'about-us', published_at: null } } }]);
    const verify = await provider.verifyChange(siteRef(), { stagedRef: '200', createdAt: new Date() });
    expect(verify.issues.some((i) => i.code === 'no_offline_verification' && i.severity === 'warning')).toBe(true);
  });

  it('flags a vanished staged page as blocking', async () => {
    const { provider } = makeProvider([{ status: 404, json: { errors: 'Not Found' } }]);
    const verify = await provider.verifyChange(siteRef(), { stagedRef: '999', createdAt: new Date() });
    expect(verify.passed).toBe(false);
    expect(verify.issues.some((i) => i.code === 'staged_page_not_found' && i.severity === 'blocking')).toBe(true);
  });

  it('flags an already-published staged page as blocking', async () => {
    const { provider } = makeProvider([
      { status: 200, json: { page: { id: 444, handle: 'about-us', published_at: '2026-08-01T00:00:00Z' } } },
    ]);
    const verify = await provider.verifyChange(siteRef(), { stagedRef: '444', createdAt: new Date() });
    expect(verify.passed).toBe(false);
    expect(verify.issues.some((i) => i.code === 'staged_page_already_published' && i.severity === 'blocking')).toBe(true);
  });

  it('a supplied canonicalUrl produces a warning, since writesCanonical is false for shopify', async () => {
    const { provider } = makeProvider([
      { status: 201, json: { page: { id: 222, handle: 'about-us', published_at: null } } }, // stage create
      { status: 200, json: { page: { id: 222, handle: 'about-us', published_at: null } } }, // verify GET
    ]);
    const staged = await provider.stageChange(siteRef(), change({ canonicalUrl: 'https://example-store.com/about-us' }));
    const verify = await provider.verifyChange(siteRef(), staged);
    expect(verify.issues.some((i) => i.code === 'canonical_not_writable' && i.severity === 'warning')).toBe(true);
    expect(verify.passed).toBe(true); // warning-only, not blocking
  });

  it('does not warn about canonicalUrl when none was supplied', async () => {
    const { provider } = makeProvider([
      { status: 201, json: { page: { id: 223, handle: 'about-us', published_at: null } } },
      { status: 200, json: { page: { id: 223, handle: 'about-us', published_at: null } } },
    ]);
    const staged = await provider.stageChange(siteRef(), change());
    const verify = await provider.verifyChange(siteRef(), staged);
    expect(verify.issues.some((i) => i.code === 'canonical_not_writable')).toBe(false);
  });

  it('structured data staged without the theme snippet produces a warning', async () => {
    const noSnippetSite = siteRef({ adapterConfig: { themeSnippetInstalled: false } });
    const { provider } = makeProvider([
      { status: 201, json: { page: { id: 333, handle: 'about-us', published_at: null } } }, // create
      { status: 201, json: { metafield: {} } }, // structured data write
      { status: 200, json: { page: { id: 333, handle: 'about-us', published_at: null } } }, // verify GET
    ]);
    const staged = await provider.stageChange(noSnippetSite, change({ structuredData: { '@type': 'Organization' } }));
    const verify = await provider.verifyChange(noSnippetSite, staged);
    expect(verify.issues.some((i) => i.code === 'theme_snippet_missing' && i.severity === 'warning')).toBe(true);
  });

  it('does not warn about the snippet when structured data was staged and the snippet IS installed', async () => {
    const { provider } = makeProvider([
      { status: 201, json: { page: { id: 334, handle: 'about-us', published_at: null } } },
      { status: 201, json: { metafield: {} } },
      { status: 200, json: { page: { id: 334, handle: 'about-us', published_at: null } } },
    ]);
    const staged = await provider.stageChange(siteRef(), change({ structuredData: { '@type': 'Organization' } }));
    const verify = await provider.verifyChange(siteRef(), staged);
    expect(verify.issues.some((i) => i.code === 'theme_snippet_missing')).toBe(false);
  });
});

describe('ShopifySiteProvider — publishChange', () => {
  it('refuses to publish without a recorded approver and makes zero fetch calls', async () => {
    const { provider, fetchImpl } = makeProvider([]);
    await expect(provider.publishChange(siteRef(), approved('111', { approvedBy: '' }))).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    await expect(provider.publishChange(siteRef(), approved('111', { approvedBy: '   ' }))).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a blank stagedRef as invalid_input before any fetch call', async () => {
    const { provider, fetchImpl } = makeProvider([]);
    await expect(provider.publishChange(siteRef(), approved('   '))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not re-write an already-published page (idempotent publish)', async () => {
    const { provider, calls } = makeProvider([
      { status: 200, json: { page: { id: 555, handle: 'about-us', published_at: '2026-08-01T00:00:00Z' } } },
    ]);
    const result = await provider.publishChange(siteRef(), approved('555'));
    expect(result).toEqual({ status: 'published', liveUrl: 'https://example-store.com/pages/about-us', externalRef: '555' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });

  it('publishes an unpublished page by setting published: true', async () => {
    const { provider, calls } = makeProvider([
      { status: 200, json: { page: { id: 556, handle: 'about-us', published_at: null } } },
      { status: 200, json: { page: { id: 556, handle: 'about-us', published_at: '2026-08-05T00:00:00Z' } } },
    ]);
    const result = await provider.publishChange(siteRef(), approved('556'));
    expect(result).toEqual({ status: 'published', liveUrl: 'https://example-store.com/pages/about-us', externalRef: '556' });
    expect(calls[1].method).toBe('PUT');
    expect((calls[1].body as { page: { published: boolean } }).page.published).toBe(true);
  });

  it('creates redirects at publish time, never at stage time', async () => {
    const { provider, calls } = makeProvider([
      { status: 201, json: { page: { id: 666, handle: 'new-page', published_at: null } } }, // stage create
      { status: 200, json: { page: { id: 666, handle: 'new-page', published_at: null } } }, // publish GET
      { status: 200, json: { page: { id: 666, handle: 'new-page', published_at: '2026-08-05T00:00:00Z' } } }, // publish PUT
      { status: 201, json: { redirect: {} } }, // redirect create
    ]);
    const staged = await provider.stageChange(siteRef(), change({ pageUrl: '/pages/new-page', redirectFrom: ['/old-page'] }));
    expect(calls.some((c) => c.url.includes('redirects.json'))).toBe(false);

    const result = await provider.publishChange(siteRef(), approved(staged.stagedRef));
    expect(result.status).toBe('published');
    const redirectCall = calls.find((c) => c.url.includes('redirects.json'));
    expect(redirectCall?.method).toBe('POST');
    expect((redirectCall?.body as { redirect: { path: string; target: string } }).redirect).toEqual({
      path: '/old-page', target: '/pages/new-page',
    });
  });

  it('a failing redirect does not fail the publish', async () => {
    const { provider } = makeProvider([
      { status: 201, json: { page: { id: 777, handle: 'new-page-2', published_at: null } } },
      { status: 200, json: { page: { id: 777, handle: 'new-page-2', published_at: null } } },
      { status: 200, json: { page: { id: 777, handle: 'new-page-2', published_at: '2026-08-05T00:00:00Z' } } },
      { status: 422, json: { errors: 'invalid redirect' } },
    ]);
    const staged = await provider.stageChange(siteRef(), change({ pageUrl: '/pages/new-page-2', redirectFrom: ['/old-page-2'] }));
    const result = await provider.publishChange(siteRef(), approved(staged.stagedRef));
    expect(result.status).toBe('published');
  });

  it('a redirect create that throws (network failure) does not fail the publish either', async () => {
    const { provider, fetchImpl } = makeProvider([
      { status: 201, json: { page: { id: 778, handle: 'new-page-3', published_at: null } } },
      { status: 200, json: { page: { id: 778, handle: 'new-page-3', published_at: null } } },
      { status: 200, json: { page: { id: 778, handle: 'new-page-3', published_at: '2026-08-05T00:00:00Z' } } },
    ]);
    const staged = await provider.stageChange(siteRef(), change({ pageUrl: '/pages/new-page-3', redirectFrom: ['/old-page-3'] }));
    // Exhausted queue means the 4th call (the redirect) throws "no queued response" — publish must still succeed.
    const result = await provider.publishChange(siteRef(), approved(staged.stagedRef));
    expect(result.status).toBe('published');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('maps a 404 on the staged ref to invalid_input', async () => {
    const { provider } = makeProvider([{ status: 404, json: {} }]);
    await expect(provider.publishChange(siteRef(), approved('gone'))).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('ShopifySiteProvider — HTTP error mapping', () => {
  it('maps 401 to missing_configuration', async () => {
    const { provider } = makeProvider([{ status: 401, json: { errors: 'Unauthorized' } }]);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });

  it('maps 403 to missing_configuration', async () => {
    const { provider } = makeProvider([{ status: 403, json: { errors: 'Forbidden' } }]);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'missing_configuration' });
  });

  it('maps 429 to provider_unavailable and does not retry', async () => {
    const { provider, calls } = makeProvider([{ status: 429, json: { errors: 'Too Many Requests' } }]);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(calls).toHaveLength(1);
  });

  it('maps a 5xx to provider_unavailable', async () => {
    const { provider } = makeProvider([{ status: 502, json: { errors: 'Bad Gateway' } }]);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('maps a transport failure (e.g. timeout) to provider_unavailable', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new Error('The operation was aborted due to timeout');
    });
    const provider = new ShopifySiteProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadCredentials: vi.fn(async () => CREDS),
    });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('maps an unexpected 2xx shape to provider_response_invalid', async () => {
    const { provider } = makeProvider([{ status: 201, json: { not_a_page: true } }]);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_response_invalid' });
  });

  it('maps a non-JSON response body to provider_response_invalid', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => ({ status: 201, text: async () => '<html>not json</html>' } as unknown as Response));
    const provider = new ShopifySiteProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loadCredentials: vi.fn(async () => CREDS),
    });
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'provider_response_invalid' });
  });

  it('maps a generic 4xx to invalid_input', async () => {
    const { provider } = makeProvider([{ status: 422, json: { errors: 'Unprocessable' } }]);
    await expect(provider.stageChange(siteRef(), change())).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('ShopifySiteProvider — fetchLiveSnapshot', () => {
  it('delegates to the shared liveSnapshot reader with providerName=shopify', async () => {
    const html = '<html><head><title>About</title></head><body><h1>About</h1></body></html>';
    const fetchImpl = vi.fn(async (): Promise<Response> => ({
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
      body: undefined,
      text: async () => html,
    } as unknown as Response));
    const provider = new ShopifySiteProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, loadCredentials: vi.fn() });

    const snapshot = await provider.fetchLiveSnapshot(siteRef(), 'https://example-store.com/pages/about-us');
    expect(snapshot.pageUrl).toBe('https://example-store.com/pages/about-us');
    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.metaTitle).toBe('About');
  });

  it('rejects an unsafe URL rather than fetching it', async () => {
    const { provider, fetchImpl } = makeProvider([]);
    await expect(provider.fetchLiveSnapshot(siteRef(), 'http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopifySiteProvider — SiteRef validation', () => {
  it('refuses a blank tenantId or siteId before making any request', async () => {
    const { provider, fetchImpl } = makeProvider([]);
    await expect(provider.stageChange(siteRef({ tenantId: '' }), change())).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(provider.stageChange(siteRef({ id: '   ' }), change())).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a change missing changeId or pageUrl as invalid_input', async () => {
    const { provider, fetchImpl } = makeProvider([]);
    await expect(provider.stageChange(siteRef(), change({ changeId: '' }))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(provider.stageChange(siteRef(), change({ pageUrl: '' }))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
