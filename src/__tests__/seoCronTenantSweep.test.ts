import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// The C2 regression guard.
//
// resolveDefaultSeoTenantId() THROWS the moment a second active tenant has
// `seo: true` — getSingleActiveTenantWithFeature deliberately refuses to guess
// which tenant owns the data. That throw is correct and stays.
//
// The danger is a cron reaching it. Every SEO cron used to, which meant
// enabling the SEO add-on for one reseller would have killed every SEO cron for
// EVERY tenant, Growth Escalators' own included — selling the feature would
// have broken the feature, with no code change to point at as the cause.
//
// Two things are asserted here:
//   1. forEachSeoTenant actually sweeps every tenant and isolates failures, so
//      one tenant's bad credential does not skip everyone behind it.
//   2. worker.ts's SEO cron block never calls resolveDefaultSeoTenantId. This
//      is a source-level assertion on purpose: importing worker.ts would boot
//      every cron in the process, and the failure mode being guarded is
//      literally "someone adds a call back in".
// ---------------------------------------------------------------------------

describe('forEachSeoTenant', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('runs the body once per SEO-enabled tenant', async () => {
    vi.doMock('../services/tenantFeatures', () => ({
      getActiveTenantsWithFeature: vi.fn().mockResolvedValue([
        { id: 'tenant-a', slug: 'growth-escalators' },
        { id: 'tenant-b', slug: 'reseller-pilot' },
      ]),
      getSingleActiveTenantWithFeature: vi.fn(),
    }));

    const { forEachSeoTenant } = await import('../services/seoTenantContext');
    const seen: string[] = [];
    const sweep = await forEachSeoTenant('Test Cron', async (tenantId) => {
      seen.push(tenantId);
      return { checked: 1 };
    });

    expect(seen).toEqual(['tenant-a', 'tenant-b']);
    expect(sweep.succeeded).toBe(2);
    expect(sweep.failed).toBe(0);
  });

  it('isolates a failing tenant so later tenants still run', async () => {
    vi.doMock('../services/tenantFeatures', () => ({
      getActiveTenantsWithFeature: vi.fn().mockResolvedValue([
        { id: 'tenant-a', slug: 'a' },
        { id: 'tenant-b', slug: 'b' },
        { id: 'tenant-c', slug: 'c' },
      ]),
      getSingleActiveTenantWithFeature: vi.fn(),
    }));

    const { forEachSeoTenant } = await import('../services/seoTenantContext');
    const seen: string[] = [];
    const sweep = await forEachSeoTenant('Test Cron', async (tenantId) => {
      seen.push(tenantId);
      if (tenantId === 'tenant-a') throw new Error('expired google token');
      return { ok: true };
    });

    // The whole point: tenant-a blowing up must not skip b and c.
    expect(seen).toEqual(['tenant-a', 'tenant-b', 'tenant-c']);
    expect(sweep.succeeded).toBe(2);
    expect(sweep.failed).toBe(1);
    const failure = sweep.results.find((r) => !r.ok);
    expect(failure && !failure.ok && failure.error.message).toBe('expired google token');
  });

  it('does not throw when no tenant has the feature — it reports an empty sweep', async () => {
    vi.doMock('../services/tenantFeatures', () => ({
      getActiveTenantsWithFeature: vi.fn().mockResolvedValue([]),
      getSingleActiveTenantWithFeature: vi.fn(),
    }));

    const { forEachSeoTenant } = await import('../services/seoTenantContext');
    const body = vi.fn();
    const sweep = await forEachSeoTenant('Test Cron', body);

    expect(body).not.toHaveBeenCalled();
    expect(sweep.results).toEqual([]);
    expect(sweep.succeeded).toBe(0);
    expect(sweep.failed).toBe(0);
  });

  it('never calls the single-tenant resolver — that is the whole point', async () => {
    const getSingleActiveTenantWithFeature = vi.fn().mockRejectedValue(
      new Error('ambiguous tenant resolution — this must never be reached from a cron'),
    );
    vi.doMock('../services/tenantFeatures', () => ({
      getActiveTenantsWithFeature: vi.fn().mockResolvedValue([{ id: 'tenant-a', slug: 'a' }]),
      getSingleActiveTenantWithFeature,
    }));

    const { forEachSeoTenant } = await import('../services/seoTenantContext');
    await forEachSeoTenant('Test Cron', async () => ({ ok: true }));

    expect(getSingleActiveTenantWithFeature).not.toHaveBeenCalled();
  });
});

describe('worker.ts SEO cron block', () => {
  // Read as source rather than imported: importing worker.ts schedules every
  // cron in the repo as a side effect.
  const workerSource = readFileSync(join(__dirname, '..', 'worker.ts'), 'utf8');

  // The SEO block is delimited by its banner comment and ends at the Directory
  // Scrapers cron, which is the first non-SEO cron after it.
  const blockStart = workerSource.indexOf('// SEO CRON BLOCK');
  const blockEnd = workerSource.indexOf("safeCron('Directory Scrapers'");
  const seoBlock = workerSource.slice(blockStart, blockEnd);

  // Comments in this block necessarily NAME resolveDefaultSeoTenantId — the
  // banner explains at length why nothing may call it. Strip comments before
  // scanning so the guard matches actual code, not the documentation of the
  // rule it enforces.
  const seoBlockCode = seoBlock
    .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
    .replace(/^\s*\/\/.*$/gm, '')      // whole-line comments
    .replace(/\/\/.*$/gm, '');         // trailing comments

  it('has a recognisable SEO cron block (guards the slice above)', () => {
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
  });

  it('never calls resolveDefaultSeoTenantId', () => {
    // This is THE regression guard. A call here means the next tenant to buy
    // the SEO add-on breaks this cron for everyone, GE included.
    const callSites = seoBlockCode.match(/resolveDefaultSeoTenantId\s*\(/g) ?? [];
    expect(callSites).toEqual([]);
  });

  it('routes every SEO cron through a per-tenant sweep', () => {
    // Each SEO cron body must reach tenants via seoTenantSweep or
    // forEachSeoTenant. If someone adds a cron that calls a service with no
    // tenant argument, this count stops matching the number of safeCron calls.
    const seoCrons = seoBlockCode.match(/safeCron\('/g) ?? [];
    const sweeps = seoBlockCode.match(/seoTenantSweep\(|forEachSeoTenant\(/g) ?? [];

    // 'GE SEO Pull' is deliberately excluded: it shells out to a standalone CLI
    // script for one specific GE property and resolves no tenant at all, so it
    // cannot hit the ambiguity throw. Phase 5 replaces it with a real service.
    const exemptCrons = 1;
    expect(seoCrons.length - exemptCrons).toBeLessThanOrEqual(sweeps.length);
  });

  it('still guards the paid-API crons behind the seo pause flag or a sweep', () => {
    // Serper-calling crons must not fan out across tenants without the pause
    // switch still working — a runaway sweep is a spend incident.
    expect(seoBlock).toContain("isPaused('seo')");
  });
});
