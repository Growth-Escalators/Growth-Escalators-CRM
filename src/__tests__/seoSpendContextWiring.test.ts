// Proves the paused-site and plan-limit caps are actually ENFORCED, not merely
// implementable.
//
// `spendContext` is an optional field on GuardedSerperCallCtx — deliberately,
// so it could be rolled out call site by call site without breaking the four
// existing ones. The cost of that design is that "the resolver exists and is
// tested" and "the caps do anything" are two different statements, and only
// the second one matters to a tenant whose site is paused. When this file was
// written, the resolver was complete and NO call site passed it, so both caps
// were dead in production.
//
// This is a wiring test on purpose: a source-level assertion that every spend
// site threads the context, plus one end-to-end proof through a real service
// that a paused site does not spend.
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../services/slackService', () => ({ sendSlackMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../config/constants', () => ({ SLACK_SEO_CHANNEL: 'C_SEO_TEST' }));
vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-a'),
}));
vi.mock('../services/seoSiteRegistry', () => ({
  listSeoSiteDomains: vi.fn(),
  getSeoSiteByDomain: vi.fn(),
  getSeoSiteById: vi.fn(),
}));
vi.mock('../services/seoCostGuardUsage', () => ({
  fetchSeoCostGuardUsage: vi.fn(),
  recordSeoApiUsage: vi.fn().mockResolvedValue(undefined),
}));

import { getSeoSiteById, getSeoSiteByDomain, listSeoSiteDomains } from '../services/seoSiteRegistry';
import { fetchSeoCostGuardUsage, recordSeoApiUsage } from '../services/seoCostGuardUsage';
import { emptySeoCostGuardUsage } from '../services/seoCostGuard';
import { pool } from '../db/index';

const SERVICES_THAT_SPEND = [
  'src/services/rankTrackingService.ts',
  'src/services/seoBacklinkService.ts',
  'src/services/seoContentGapService.ts',
  'src/services/competitorContentService.ts',
];

describe('every Serper spend site threads the spend context', () => {
  it.each(SERVICES_THAT_SPEND)('%s builds a per-run resolver and passes it', (relPath) => {
    const source = readFileSync(join(__dirname, '..', '..', relPath), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // One resolver per RUN, not per call — the whole point of the caching.
    expect(source, `${relPath} must create a spend-context resolver`).toMatch(/createSeoSpendContextResolver\(/);
    // And it has to actually reach the guard.
    expect(source, `${relPath} must pass spendContext to the guard`).toMatch(/spendContext/);
  });

  it('the route that spends on demand threads it too', () => {
    const source = readFileSync(join(__dirname, '..', 'routes', 'seo.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).toMatch(/createSeoSpendContextResolver\(/);
    expect(source).toMatch(/spendContext/);
  });
});

describe('a paused site does not spend — end to end through a real service', () => {
  const originalKey = process.env.SERPER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERPER_API_KEY = 'test-key';
    vi.mocked(fetchSeoCostGuardUsage).mockResolvedValue(emptySeoCostGuardUsage());
    vi.mocked(listSeoSiteDomains).mockResolvedValue(['paused.example']);
    vi.mocked(getSeoSiteByDomain).mockResolvedValue({ id: 'site-paused' } as never);
    // The site the guard will look up: paused for billing.
    vi.mocked(getSeoSiteById).mockResolvedValue({ id: 'site-paused', status: 'paused' } as never);
    // Plan lookup + the keyword query the service runs.
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
  });

  it('never calls Serper for a paused site, and records no spend', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ keyword: 'test keyword', client_domain: 'paused.example', project_name: 'p' }],
      rowCount: 1,
    } as never);

    const { runRankChecks } = await import('../services/rankTrackingService');
    await runRankChecks('tenant-a');

    // The money assertion: the HTTP request never left.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recordSeoApiUsage).not.toHaveBeenCalled();

    if (originalKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = originalKey;
  });
});
