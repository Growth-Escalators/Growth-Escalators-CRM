import { beforeEach, describe, expect, it, vi } from 'vitest';

// Per this repo's vi.mock hoisting trap (factories hoist to the top of the
// file in source order, so a factory with a baked-in value gets silently
// reused/overwritten across every it() block — see seoCostGuardUsage.test.ts's
// header comment): keep every factory value-free, forwarding only to these
// outer vi.fn()s, and configure behaviour per test with
// .mockResolvedValueOnce()/.mockRejectedValueOnce() instead.
const mockPoolQuery = vi.fn();
vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
}));

const mockFetchUsage = vi.fn();
const mockRecordUsage = vi.fn();
vi.mock('../services/seoCostGuardUsage', () => ({
  fetchSeoCostGuardUsage: (...args: unknown[]) => mockFetchUsage(...args),
  recordSeoApiUsage: (...args: unknown[]) => mockRecordUsage(...args),
}));

const mockGetSeoSiteByDomain = vi.fn();
const mockGetSeoSiteById = vi.fn();
vi.mock('../services/seoSiteRegistry', () => ({
  getSeoSiteByDomain: (...args: unknown[]) => mockGetSeoSiteByDomain(...args),
  getSeoSiteById: (...args: unknown[]) => mockGetSeoSiteById(...args),
}));

const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: (...args: unknown[]) => mockLoggerWarn(...args), error: (...args: unknown[]) => mockLoggerError(...args) },
}));

import { emptySeoCostGuardUsage, getSeoCostGuardConfig, type SeoCostGuardUsage } from '../services/seoCostGuard';
import { createSeoSiteIdResolver, createSeoSpendContextResolver, guardedSerperCall } from '../services/seoSerperGuard';

function baseCtx(overrides: Partial<{ tenantId: string; siteId: string | null; operation: string; label: string }> = {}) {
  return { tenantId: 'tenant-1', siteId: 'site-1', operation: 'rank_check', label: 'test-label', ...overrides };
}

// Forces evaluateSeoCostGuard to block on 'daily_budget_exhausted' regardless
// of whatever SEO_DAILY_BUDGET_CENTS happens to be in this test environment —
// deterministic without needing to stub process.env or pass a config override
// (guardedSerperCall's signature, fixed by the brief, doesn't accept one).
function blockingUsage(): SeoCostGuardUsage {
  return { ...emptySeoCostGuardUsage(), dayCostCents: Number.MAX_SAFE_INTEGER };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordUsage.mockResolvedValue(undefined);
});

describe('guardedSerperCall', () => {
  it('runs the call and records usage when the guard allows it and the call marks itself spent', async () => {
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    // A real call site calls markSpent() the instant fetch() resolves — see
    // seoSerperGuard.ts's module doc. Simulated here since there's no real fetch.
    const run = vi.fn(async (markSpent: () => void) => { markSpent(); return 'serper-result'; });
    const onBlocked = vi.fn().mockReturnValue('blocked-fallback');

    const result = await guardedSerperCall(baseCtx(), run, onBlocked);

    expect(result).toBe('serper-result');
    expect(run).toHaveBeenCalledOnce();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(mockRecordUsage).toHaveBeenCalledOnce();
    const recorded = mockRecordUsage.mock.calls[0][0];
    expect(recorded).toMatchObject({ tenantId: 'tenant-1', siteId: 'site-1', provider: 'serper', operation: 'rank_check', calls: 1 });
  });

  it('does NOT record usage when the call succeeds without ever calling markSpent()', async () => {
    // Guards against a hypothetical call site that resolves without ever
    // hitting the network — nothing was spent, so nothing should be billed.
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const run = vi.fn(async () => 'no-network-needed');

    const result = await guardedSerperCall(baseCtx(), run, () => 'fallback');

    expect(result).toBe('no-network-needed');
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('does not run the call and returns onBlocked() when the guard blocks it', async () => {
    mockFetchUsage.mockResolvedValueOnce(blockingUsage());
    const run = vi.fn();
    const onBlocked = vi.fn().mockReturnValue('blocked-fallback');

    const result = await guardedSerperCall(baseCtx(), run, onBlocked);

    expect(result).toBe('blocked-fallback');
    expect(run).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledOnce();
    // A blocked call spends nothing.
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('logs the blockCode when a call is blocked', async () => {
    mockFetchUsage.mockResolvedValueOnce(blockingUsage());

    await guardedSerperCall(baseCtx({ label: 'blocked-keyword' }), vi.fn(), () => null);

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    const [meta, message] = mockLoggerWarn.mock.calls[0];
    expect(meta).toMatchObject({ blockCode: 'daily_budget_exhausted', tenantId: 'tenant-1' });
    expect(message).toContain('daily_budget_exhausted');
    expect(message).toContain('blocked-keyword');
  });

  it('fails closed (does not run) when the guard itself errors evaluating usage', async () => {
    mockFetchUsage.mockRejectedValueOnce(new Error('connection terminated'));
    const run = vi.fn();
    const onBlocked = vi.fn().mockReturnValue('fallback-on-guard-error');

    const result = await guardedSerperCall(baseCtx(), run, onBlocked);

    expect(result).toBe('fallback-on-guard-error');
    expect(run).not.toHaveBeenCalled();
    expect(mockRecordUsage).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  it('records usage when run() throws AFTER calling markSpent() (e.g. res.json() failing), and never lets the throw escape', async () => {
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const run = vi.fn(async (markSpent: () => void) => {
      markSpent(); // simulates fetch() having already resolved
      throw new Error('unexpected parse failure');
    });
    const onBlocked = vi.fn().mockReturnValue('fallback-after-throw');

    await expect(guardedSerperCall(baseCtx(), run, onBlocked)).resolves.toBe('fallback-after-throw');

    // The request had already gone out (markSpent() fired) before the throw,
    // so Serper was billed regardless of what failed afterwards — see
    // seoSerperGuard.ts's module doc, first design note.
    expect(mockRecordUsage).toHaveBeenCalledOnce();
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it('does NOT record usage when run() throws BEFORE calling markSpent() (e.g. bad input, never reached fetch())', async () => {
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const run = vi.fn(async () => {
      throw new Error('failed building the request — fetch() was never reached');
    });
    const onBlocked = vi.fn().mockReturnValue('fallback-after-throw');

    await expect(guardedSerperCall(baseCtx(), run, onBlocked)).resolves.toBe('fallback-after-throw');

    // No request ever left, so nothing was spent — recording here would be a
    // pure overcount with no spend behind it.
    expect(mockRecordUsage).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it('never throws even when recordSeoApiUsage itself rejects', async () => {
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    mockRecordUsage.mockRejectedValueOnce(new Error('should not happen, but guard must not propagate it'));
    const run = vi.fn(async (markSpent: () => void) => { markSpent(); return 'ok'; });

    // recordSeoApiUsage is documented to never reject in production, but this
    // pins guardedSerperCall's own "never throws" contract independently of
    // that upstream guarantee. Because recordSpend() is awaited unguarded
    // after a successful run(), a still-rejecting recordSeoApiUsage here
    // would surface as an unhandled rejection from guardedSerperCall itself
    // if that contract were ever broken.
    await expect(guardedSerperCall(baseCtx(), run, () => 'fallback')).resolves.toBe('ok');
  });
});

describe('createSeoSiteIdResolver', () => {
  it('resolves a domain to a site id once and reuses the cached value on repeated lookups', async () => {
    mockGetSeoSiteByDomain.mockResolvedValueOnce({ id: 'site-abc' });
    const resolve = createSeoSiteIdResolver('tenant-1');

    const first = await resolve('example.com');
    const second = await resolve('example.com');
    const third = await resolve('example.com');

    expect(first).toBe('site-abc');
    expect(second).toBe('site-abc');
    expect(third).toBe('site-abc');
    // One DB read for three lookups of the same domain within one run — the
    // whole point of the cache (see this function's doc in seoSerperGuard.ts).
    expect(mockGetSeoSiteByDomain).toHaveBeenCalledOnce();
    expect(mockGetSeoSiteByDomain).toHaveBeenCalledWith('tenant-1', 'example.com');
  });

  it('caches a null result too, so an unregistered/invalid domain is not re-looked-up either', async () => {
    mockGetSeoSiteByDomain.mockResolvedValueOnce(null);
    const resolve = createSeoSiteIdResolver('tenant-1');

    expect(await resolve('unregistered.com')).toBeNull();
    expect(await resolve('unregistered.com')).toBeNull();
    expect(mockGetSeoSiteByDomain).toHaveBeenCalledOnce();
  });

  it('caches null when the lookup itself throws (e.g. a project-name domain with no dot)', async () => {
    mockGetSeoSiteByDomain.mockRejectedValueOnce(new Error('invalid_domain'));
    const resolve = createSeoSiteIdResolver('tenant-1');

    expect(await resolve('not-a-domain')).toBeNull();
    expect(await resolve('not-a-domain')).toBeNull();
    expect(mockGetSeoSiteByDomain).toHaveBeenCalledOnce();
  });

  it('does not cross-contaminate lookups for different domains, and each independent resolver keeps its own cache', async () => {
    mockGetSeoSiteByDomain.mockImplementation((_tenantId: string, domain: string) =>
      Promise.resolve(domain === 'a.com' ? { id: 'site-a' } : { id: 'site-b' }));

    const resolveForRun1 = createSeoSiteIdResolver('tenant-1');
    expect(await resolveForRun1('a.com')).toBe('site-a');
    expect(await resolveForRun1('b.com')).toBe('site-b');
    expect(await resolveForRun1('a.com')).toBe('site-a');
    expect(mockGetSeoSiteByDomain).toHaveBeenCalledTimes(2);

    // A fresh resolver (a new run) does not inherit the previous run's cache.
    const resolveForRun2 = createSeoSiteIdResolver('tenant-1');
    await resolveForRun2('a.com');
    expect(mockGetSeoSiteByDomain).toHaveBeenCalledTimes(3);
  });
});

describe('createSeoSpendContextResolver', () => {
  it('blocks with site_paused and never runs the call when the site is paused', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // no active subscription
    mockGetSeoSiteById.mockResolvedValueOnce({ id: 'site-1', status: 'paused' });
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn();

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked-fallback');

    expect(result).toBe('blocked-fallback');
    expect(run).not.toHaveBeenCalled();
    const [meta] = mockLoggerWarn.mock.calls[0];
    expect(meta).toMatchObject({ blockCode: 'site_paused' });
  });

  it('blocks with site_paused and never runs the call when the site is archived', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockGetSeoSiteById.mockResolvedValueOnce({ id: 'site-1', status: 'archived' });
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn();

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked-fallback');

    expect(result).toBe('blocked-fallback');
    expect(run).not.toHaveBeenCalled();
    const [meta] = mockLoggerWarn.mock.calls[0];
    expect(meta).toMatchObject({ blockCode: 'site_paused' });
  });

  it('does not block, and runs the call, when the site is active', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockGetSeoSiteById.mockResolvedValueOnce({ id: 'site-1', status: 'active' });
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn(async (markSpent: () => void) => { markSpent(); return 'ok'; });

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked-fallback');

    expect(result).toBe('ok');
    expect(run).toHaveBeenCalledOnce();
  });

  it('treats a failed site-status lookup as paused (fail safe, not open) and never runs the call', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockGetSeoSiteById.mockRejectedValueOnce(new Error('connection terminated'));
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn();

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked-fallback');

    expect(result).toBe('blocked-fallback');
    expect(run).not.toHaveBeenCalled();
    const [meta] = mockLoggerWarn.mock.calls[0];
    expect(meta).toMatchObject({ blockCode: 'site_paused' });
  });

  it('treats a missing site row (no row for this tenant/site id) as paused', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mockGetSeoSiteById.mockResolvedValueOnce(null);
    mockFetchUsage.mockResolvedValueOnce(emptySeoCostGuardUsage());
    const spendContext = createSeoSpendContextResolver('tenant-1');

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, vi.fn(), () => 'blocked-fallback');

    expect(result).toBe('blocked-fallback');
  });

  it('enforces a plan limit that is lower than the env default', async () => {
    const config = getSeoCostGuardConfig();
    // Sanity check the fixture actually exercises an override, not a
    // coincidence: 1 must be below whatever the env default happens to be.
    expect(config.maxSerperCallsPerSiteDay).toBeGreaterThan(1);

    mockPoolQuery.mockResolvedValueOnce({ rows: [{ limits: { seoSerperCallsPerSiteDay: 1 } }] });
    mockGetSeoSiteById.mockResolvedValueOnce({ id: 'site-1', status: 'active' });
    mockFetchUsage.mockResolvedValueOnce({ ...emptySeoCostGuardUsage(), siteDaySerperCalls: 1 });
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn();

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked-by-plan');

    expect(result).toBe('blocked-by-plan');
    expect(run).not.toHaveBeenCalled();
    const [meta] = mockLoggerWarn.mock.calls[0];
    expect(meta).toMatchObject({ blockCode: 'site_daily_serper_cap_exhausted' });
  });

  it('applies a plan limit that is higher than the env default', async () => {
    const config = getSeoCostGuardConfig();
    const usageAboveEnvDefault = config.maxSerperCallsPerSiteDay + 5;

    mockPoolQuery.mockResolvedValueOnce({ rows: [{ limits: { seoSerperCallsPerSiteDay: usageAboveEnvDefault + 10 } }] });
    mockGetSeoSiteById.mockResolvedValueOnce({ id: 'site-1', status: 'active' });
    mockFetchUsage.mockResolvedValueOnce({ ...emptySeoCostGuardUsage(), siteDaySerperCalls: usageAboveEnvDefault });
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn(async (markSpent: () => void) => { markSpent(); return 'ok'; });

    // Usage is already above the env default cap — without the plan override
    // taking effect this would block; the point of this test is that it doesn't.
    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked');

    expect(result).toBe('ok');
    expect(run).toHaveBeenCalledOnce();
  });

  it('falls back to env-default caps — never unlimited — when the plan lookup fails', async () => {
    const config = getSeoCostGuardConfig();
    mockPoolQuery.mockRejectedValueOnce(new Error('connection terminated'));
    mockGetSeoSiteById.mockResolvedValueOnce({ id: 'site-1', status: 'active' });
    // Usage sits exactly at the env default cap: a broken plan lookup must
    // still enforce that default, not fall through to "no limit".
    mockFetchUsage.mockResolvedValueOnce({ ...emptySeoCostGuardUsage(), siteDaySerperCalls: config.maxSerperCallsPerSiteDay });
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn();

    const result = await guardedSerperCall({ ...baseCtx(), spendContext }, run, () => 'blocked-by-default-cap');

    expect(result).toBe('blocked-by-default-cap');
    expect(run).not.toHaveBeenCalled();
    const [meta] = mockLoggerWarn.mock.calls[0];
    expect(meta).toMatchObject({ blockCode: 'site_daily_serper_cap_exhausted' });
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.stringContaining('plan-limits lookup failed'),
    );
  });

  it('runs exactly one plan-limits DB query per run, no matter how many calls share the resolver', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ limits: {} }] });
    mockGetSeoSiteById.mockResolvedValue({ id: 'some-site', status: 'active' });
    mockFetchUsage.mockResolvedValue(emptySeoCostGuardUsage());
    const spendContext = createSeoSpendContextResolver('tenant-1');
    const run = vi.fn(async (markSpent: () => void) => { markSpent(); return 'ok'; });

    await guardedSerperCall({ ...baseCtx(), siteId: 'site-1', spendContext }, run, () => 'blocked');
    await guardedSerperCall({ ...baseCtx(), siteId: 'site-2', spendContext }, run, () => 'blocked');
    await guardedSerperCall({ ...baseCtx(), siteId: 'site-1', spendContext }, run, () => 'blocked');

    // One plan query total across three calls — the whole point of the cache.
    expect(mockPoolQuery).toHaveBeenCalledOnce();
    // Site status IS re-checked per distinct site id (it can change mid-run),
    // but the repeated site-1 call hits the per-site-id cache: two reads for
    // two distinct ids, not three.
    expect(mockGetSeoSiteById).toHaveBeenCalledTimes(2);
  });
});
