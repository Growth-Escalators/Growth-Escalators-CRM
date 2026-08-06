// Phase 4's stated exit criterion: the per-site Serper cap surfaces as a 429
// with `site_daily_serper_cap_exhausted` on a route.
//
// The cron guard deliberately does NOT do this — it skips the capped keyword
// and lets the sweep continue, because a sweep that aborted on the first
// capped keyword would be worse than a partial one. A route is the opposite
// case: an operator clicked a button and is owed a real answer rather than an
// empty result list they cannot interpret. Both behaviours are correct; this
// file pins the route half.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/seoCostGuardUsage', () => ({
  fetchSeoCostGuardUsage: vi.fn(),
  recordSeoApiUsage: vi.fn(),
}));

vi.mock('../services/seoSiteRegistry', () => ({
  getSeoSiteByDomain: vi.fn(),
  normaliseDomain: (d: string) => d,
  listSeoSiteDomains: vi.fn(),
}));

import { fetchSeoCostGuardUsage } from '../services/seoCostGuardUsage';
import { emptySeoCostGuardUsage } from '../services/seoCostGuard';
import { evaluateSeoSpend } from '../services/seoSerperGuard';

const TENANT = 'tenant-1';
const SITE = 'site-1';

describe('evaluateSeoSpend — the route pre-flight', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a call when nothing has been spent', async () => {
    vi.mocked(fetchSeoCostGuardUsage).mockResolvedValue(emptySeoCostGuardUsage());
    const evaluation = await evaluateSeoSpend({
      tenantId: TENANT, siteId: SITE, operation: 'serper_search', label: 'competitor-brief',
    });
    expect(evaluation?.allowed).toBe(true);
    expect(evaluation?.httpStatus).toBe(200);
  });

  it('reports 429 site_daily_serper_cap_exhausted once the per-site cap is spent', async () => {
    vi.mocked(fetchSeoCostGuardUsage).mockResolvedValue({
      ...emptySeoCostGuardUsage(),
      // Far beyond any configured per-site daily cap.
      siteDaySerperCalls: 100_000,
    });
    const evaluation = await evaluateSeoSpend({
      tenantId: TENANT, siteId: SITE, operation: 'serper_search', label: 'competitor-brief',
    });
    expect(evaluation?.allowed).toBe(false);
    expect(evaluation?.httpStatus).toBe(429);
    expect(evaluation?.blockCode).toBe('site_daily_serper_cap_exhausted');
    // The reason has to be reportable — an operator seeing a bare 429 with no
    // explanation cannot tell a cap from an outage.
    expect(evaluation?.blockReasons.join(' ')).toMatch(/serper/i);
  });

  it('fails CLOSED when the guard itself cannot be evaluated', async () => {
    // A broken guard must not become an open door. The route treats null as a
    // refusal; this pins that the guard returns null rather than throwing or,
    // worse, an allow.
    vi.mocked(fetchSeoCostGuardUsage).mockRejectedValue(new Error('db down'));
    const evaluation = await evaluateSeoSpend({
      tenantId: TENANT, siteId: SITE, operation: 'serper_search', label: 'competitor-brief',
    });
    expect(evaluation).toBeNull();
  });

  it('still applies tenant-wide caps when the domain has no registered site', async () => {
    vi.mocked(fetchSeoCostGuardUsage).mockResolvedValue({
      ...emptySeoCostGuardUsage(),
      tenantDaySerperCalls: 100_000,
    });
    const evaluation = await evaluateSeoSpend({
      tenantId: TENANT, siteId: null, operation: 'serper_search', label: 'competitor-brief',
    });
    expect(evaluation?.allowed).toBe(false);
    expect(evaluation?.blockCode).toBe('tenant_daily_serper_cap_exhausted');
  });
});
