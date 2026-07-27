import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns', () => ({
  promises: {
    resolveMx: vi.fn(async () => []),
  },
}));

describe('emailExtractorService.findEmail', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not call Apollo or Snov when paid providers are disabled', async () => {
    process.env.APOLLO_API_KEY = 'apollo-test-key';
    process.env.SNOV_CLIENT_ID = 'snov-client';
    process.env.SNOV_CLIENT_SECRET = 'snov-secret';
    vi.resetModules();

    const mockFetch = vi.fn(async (url: string | URL | Request) => ({
      ok: false,
      headers: { get: () => 'text/html' },
      text: async () => '',
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', mockFetch);

    const { findEmail } = await import('../services/emailExtractorService');
    await findEmail('https://example.com', 'Asha', 'Rao', { allowPaidProviders: false });

    const calledUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes('api.apollo.io'))).toBe(false);
    expect(calledUrls.some((url) => url.includes('api.snov.io'))).toBe(false);
  });

  it('uses Apollo when paid providers are explicitly enabled', async () => {
    process.env.APOLLO_API_KEY = 'apollo-test-key';
    process.env.SNOV_CLIENT_ID = 'snov-client';
    process.env.SNOV_CLIENT_SECRET = 'snov-secret';
    vi.resetModules();

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes('api.apollo.io')) {
        return {
          ok: true,
          json: async () => ({
            people: [{ email: 'Hiring.Manager@Example.com', email_status: 'verified' }],
          }),
        };
      }
      return {
        ok: false,
        headers: { get: () => 'text/html' },
        text: async () => '',
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    const { findEmail } = await import('../services/emailExtractorService');
    const result = await findEmail('https://example.com', 'Hiring', 'Manager', { allowPaidProviders: true });

    expect(result).toEqual({
      email: 'hiring.manager@example.com',
      source: 'apollo',
      confidence: 'high',
    });
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('api.apollo.io'))).toBe(true);
  });
});

// PRD-005 §18.2 — the scrape surface WizMatch PR 7's preparation job depends on.
// `fetchPage` is module-private, so these drive it through `collectWebsiteEmails`.
// Before the PR 7 fix this helper passed `redirect: 'follow'`, so undici followed
// 30x hops with NO re-validation: a company website that a user controls could
// redirect the server-side scrape straight to cloud metadata. Deleting the
// re-validation loop or reverting to `redirect: 'follow'` must fail here.
describe('emailExtractorService.collectWebsiteEmails — SSRF redirect handling', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function res(init: { status?: number; location?: string; contentType?: string; body?: string }) {
    const status = init.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'location'
            ? (init.location ?? null)
            : name.toLowerCase() === 'content-type'
              ? (init.contentType ?? 'text/html')
              : null,
      },
      text: async () => init.body ?? '',
      json: async () => ({}),
    };
  }

  it('never follows a redirect to a private/metadata host', async () => {
    vi.resetModules();
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('169.254.169.254') || href.includes('localhost')) {
        return res({ body: 'secrets@internal.example' });
      }
      return res({ status: 302, location: 'http://169.254.169.254/latest/meta-data/' });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { collectWebsiteEmails } = await import('../services/emailExtractorService');
    const found = await collectWebsiteEmails('https://acme.example.com', ['/contact']);

    expect(found).toEqual([]);
    const requested = mockFetch.mock.calls.map(([u]) => String(u));
    expect(requested.some((u) => u.includes('169.254.169.254'))).toBe(false);
  });

  it('passes redirect: "manual" so the runtime cannot follow a hop unchecked', async () => {
    vi.resetModules();
    const mockFetch = vi.fn(async () => res({ body: '' }));
    vi.stubGlobal('fetch', mockFetch);

    const { collectWebsiteEmails } = await import('../services/emailExtractorService');
    await collectWebsiteEmails('https://acme.example.com', ['/contact']);

    expect(mockFetch).toHaveBeenCalled();
    for (const [, init] of mockFetch.mock.calls as unknown as Array<[unknown, { redirect?: string }]>) {
      expect(init.redirect).toBe('manual');
    }
  });

  it('abandons a redirect chain longer than the bound instead of looping', async () => {
    vi.resetModules();
    let hop = 0;
    const mockFetch = vi.fn(async () => {
      hop += 1;
      return res({ status: 302, location: `https://acme.example.com/hop-${hop}` });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { collectWebsiteEmails } = await import('../services/emailExtractorService');
    const found = await collectWebsiteEmails('https://acme.example.com', ['/contact']);

    expect(found).toEqual([]);
    // MAX_FETCH_REDIRECTS = 3 -> at most 4 attempts (initial + 3 hops) per path.
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('still reads a public page that redirects within the bound', async () => {
    vi.resetModules();
    const mockFetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/final')
        ? res({ body: 'Reach us at careers@acme.example.com' })
        : res({ status: 301, location: 'https://acme.example.com/final' }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const { collectWebsiteEmails } = await import('../services/emailExtractorService');
    const found = await collectWebsiteEmails('https://acme.example.com', ['/contact']);

    expect(found.map((f) => f.email)).toContain('careers@acme.example.com');
  });
});
