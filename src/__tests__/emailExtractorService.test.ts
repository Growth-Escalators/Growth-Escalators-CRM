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
