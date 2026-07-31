import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMx = vi.fn(async (_domain: string) => [] as Array<{ exchange: string; priority: number }>);

vi.mock('dns', () => ({
  promises: {
    resolveMx: (domain: string) => resolveMx(domain),
    resolveTxt: vi.fn(async () => []),
  },
}));

const recordEmailVerificationSuccess = vi.fn();
const recordEmailVerificationFailure = vi.fn(async (..._args: unknown[]) => {});

vi.mock('../services/wizmatchEmailVerificationHealth', () => ({
  recordEmailVerificationSuccess: (...args: unknown[]) => recordEmailVerificationSuccess(...args),
  recordEmailVerificationFailure: (...args: unknown[]) => recordEmailVerificationFailure(...args),
}));

import {
  classifyMxProvider,
  detectCatchAll,
  getConfiguredEmailVerificationProviders,
  createDefaultWizmatchContactDiscoveryProviders,
} from '../services/wizmatchContactDiscoveryProviders';

describe('classifyMxProvider', () => {
  afterEach(() => {
    resolveMx.mockReset();
    resolveMx.mockResolvedValue([]);
  });

  it('detects Google Workspace domains', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'aspmx.l.google.com', priority: 1 }]);
    expect(await classifyMxProvider('acme.in')).toBe('google');
  });

  it('detects Microsoft 365 domains', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'acme-in.mail.protection.outlook.com', priority: 0 }]);
    expect(await classifyMxProvider('acme.in')).toBe('microsoft');
  });

  it('classifies self-hosted/other domains as other', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mail.acme.in', priority: 10 }]);
    expect(await classifyMxProvider('acme.in')).toBe('other');
  });

  it('returns none when the domain has no MX records', async () => {
    resolveMx.mockResolvedValue([]);
    expect(await classifyMxProvider('acme.in')).toBe('none');
  });
});

describe('getConfiguredEmailVerificationProviders', () => {
  it('prefers reacher, then millionverifier, when both are configured', () => {
    expect(getConfiguredEmailVerificationProviders({
      REACHER_BASE_URL: 'https://reacher.example',
      MILLIONVERIFIER_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv)).toEqual(['reacher', 'millionverifier']);
  });

  it('returns only millionverifier when Reacher is unset', () => {
    expect(getConfiguredEmailVerificationProviders({
      MILLIONVERIFIER_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv)).toEqual(['millionverifier']);
  });

  it('returns only reacher when MillionVerifier is unset', () => {
    expect(getConfiguredEmailVerificationProviders({
      REACHER_BASE_URL: 'https://reacher.example',
    } as NodeJS.ProcessEnv)).toEqual(['reacher']);
  });

  it('returns an empty list when neither is configured', () => {
    expect(getConfiguredEmailVerificationProviders({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('detectCatchAll', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when no verification provider is configured', async () => {
    delete process.env.REACHER_BASE_URL;
    delete process.env.MILLIONVERIFIER_API_KEY;
    const reacher = vi.fn(async () => 'verified' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBeNull();
    expect(reacher).not.toHaveBeenCalled();
  });

  it('flags catch-all when a random non-existent address verifies as deliverable', async () => {
    process.env.REACHER_BASE_URL = 'https://reacher.example';
    delete process.env.MILLIONVERIFIER_API_KEY;
    const reacher = vi.fn(async () => 'verified' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBe(true);
    expect(reacher).toHaveBeenCalledTimes(1);
  });

  it('returns false when a random address is rejected (not catch-all)', async () => {
    process.env.REACHER_BASE_URL = 'https://reacher.example';
    const reacher = vi.fn(async () => 'invalid' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBe(false);
  });

  it('returns null (undetermined) when the verifier cannot tell', async () => {
    process.env.REACHER_BASE_URL = 'https://reacher.example';
    const reacher = vi.fn(async () => 'unknown' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBeNull();
  });

  it('still runs the probe when only MillionVerifier is configured (no Reacher)', async () => {
    delete process.env.REACHER_BASE_URL;
    process.env.MILLIONVERIFIER_API_KEY = 'test-key';
    const reacher = vi.fn(async () => 'verified' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBe(true);
    expect(reacher).toHaveBeenCalledTimes(1);
  });
});

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };

function fakeResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('email verification provider dispatch (reacherVerify)', () => {
  const originalEnv = { ...process.env };
  let providers: ReturnType<typeof createDefaultWizmatchContactDiscoveryProviders>;

  beforeEach(() => {
    recordEmailVerificationSuccess.mockClear();
    recordEmailVerificationFailure.mockClear();
    providers = createDefaultWizmatchContactDiscoveryProviders();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('never marks anything verified and logs a loud failure when no provider is configured', async () => {
    delete process.env.REACHER_BASE_URL;
    delete process.env.MILLIONVERIFIER_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await providers.reacherVerify('jane@acme.com');

    expect(result).toBe('unknown');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recordEmailVerificationFailure).toHaveBeenCalledTimes(1);
    expect(recordEmailVerificationFailure).toHaveBeenCalledWith('unconfigured', expect.any(String));
  });

  describe('MillionVerifier (sole configured provider)', () => {
    beforeEach(() => {
      delete process.env.REACHER_BASE_URL;
      process.env.MILLIONVERIFIER_API_KEY = 'test-key';
    });

    it('never calls the real MillionVerifier API — fetch is always stubbed in this suite', () => {
      // Documents the constraint enforced by every test below: each one stubs
      // global.fetch before calling reacherVerify, so no real HTTP call (and no
      // verification credit) is ever spent by this test file.
      expect(true).toBe(true);
    });

    it('maps result=ok (quality=good) to verified', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'ok', quality: 'good' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('verified');
      expect(recordEmailVerificationSuccess).toHaveBeenCalledWith('millionverifier');
      expect(recordEmailVerificationFailure).not.toHaveBeenCalled();
    });

    it('maps result=ok with quality omitted to verified', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'ok' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('verified');
    });

    it('does NOT verify result=ok when quality is not good (fails closed)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'ok', quality: 'risky' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
    });

    it('maps result=invalid to invalid', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'invalid', quality: 'bad' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('invalid');
      expect(recordEmailVerificationSuccess).toHaveBeenCalledWith('millionverifier');
    });

    it('maps result=disposable to invalid (never a usable hiring contact)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'disposable', quality: 'bad' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('invalid');
    });

    it('maps result=catch_all to unknown', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'catch_all', quality: 'risky' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
      expect(recordEmailVerificationSuccess).toHaveBeenCalledWith('millionverifier');
    });

    it('maps result=unknown to unknown', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'unknown', quality: 'risky' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
    });

    it('maps result=error to unknown without treating it as an infra failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'error' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
      expect(recordEmailVerificationSuccess).toHaveBeenCalledWith('millionverifier');
      expect(recordEmailVerificationFailure).not.toHaveBeenCalled();
    });

    it('maps an unrecognised result value to unknown (fails closed)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ result: 'some_future_value' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
    });

    it('a 200 response carrying an error field (bad key / no credits) -> unknown + loud failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({ error: 'invalid api key' })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('millionverifier', expect.stringContaining('invalid api key'));
      expect(recordEmailVerificationSuccess).not.toHaveBeenCalled();
    });

    it('non-200 status -> unknown + loud failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => fakeResponse({}, 500)));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('millionverifier', expect.stringContaining('500'));
    });

    it('timeout/network error -> unknown + loud failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('request timed out'); }));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('millionverifier', expect.stringContaining('timed out'));
    });

    it('malformed JSON response -> unknown + loud failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
        text: async () => 'not json',
      })));
      expect(await providers.reacherVerify('jane@acme.com')).toBe('unknown');
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('millionverifier', expect.any(String));
      expect(recordEmailVerificationSuccess).not.toHaveBeenCalled();
    });
  });

  describe('provider fallback — Reacher configured but broken', () => {
    beforeEach(() => {
      process.env.REACHER_BASE_URL = 'https://reacher.example';
      process.env.MILLIONVERIFIER_API_KEY = 'test-key';
    });

    it('falls through to MillionVerifier when Reacher errors', async () => {
      const fetchSpy = vi.fn()
        .mockImplementationOnce(async () => { throw new Error('Application not found'); }) // dead Reacher (404)
        .mockImplementationOnce(async () => fakeResponse({ result: 'ok', quality: 'good' })); // MillionVerifier
      vi.stubGlobal('fetch', fetchSpy);

      const result = await providers.reacherVerify('jane@acme.com');

      expect(result).toBe('verified');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('reacher', expect.stringContaining('Application not found'));
      expect(recordEmailVerificationSuccess).toHaveBeenCalledWith('millionverifier');
    });

    it('never calls MillionVerifier when Reacher succeeds (no wasted paid credit)', async () => {
      const fetchSpy = vi.fn(async () => fakeResponse({ is_reachable: 'safe' }));
      vi.stubGlobal('fetch', fetchSpy);

      const result = await providers.reacherVerify('jane@acme.com');

      expect(result).toBe('verified');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(recordEmailVerificationSuccess).toHaveBeenCalledWith('reacher');
      expect(recordEmailVerificationFailure).not.toHaveBeenCalled();
    });

    it('returns unknown and records both failures when both providers are broken', async () => {
      const fetchSpy = vi.fn()
        .mockImplementationOnce(async () => { throw new Error('reacher down'); })
        .mockImplementationOnce(async () => fakeResponse({}, 503));
      vi.stubGlobal('fetch', fetchSpy);

      const result = await providers.reacherVerify('jane@acme.com');

      expect(result).toBe('unknown');
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('reacher', expect.stringContaining('reacher down'));
      expect(recordEmailVerificationFailure).toHaveBeenCalledWith('millionverifier', expect.stringContaining('503'));
      expect(recordEmailVerificationSuccess).not.toHaveBeenCalled();
    });
  });
});
