import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cost-safe POC search: role-targeted query builder + the read-only dry-run
// (previewFreePocSearch) which shows the query + remaining SearchAPI allowance +
// cooldown/cost estimate WITHOUT calling any provider (it only reads the DB via
// the mocked pool — a real provider call would hit the network and fail here).

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock('../db/index', () => ({ db: {}, pool: { query: poolQuery, connect: vi.fn() } }));

import { buildPocSearchQuery, normalizePocRoles, POC_ROLES } from '../services/wizmatchSearchApi';
import { previewFreePocSearch } from '../services/wizmatchSourcing';

const ORIGINAL_ALL_ROLES = '("Acme") ("talent acquisition" OR recruiter OR "people operations" OR "hiring manager" OR "delivery manager" OR procurement OR "vendor management") (site:linkedin.com/in OR site:acme.com)';

describe('buildPocSearchQuery — role targeting', () => {
  it('default (no roles) reproduces the original all-roles query exactly', () => {
    expect(buildPocSearchQuery('Acme', 'acme.com')).toBe(ORIGINAL_ALL_ROLES);
    expect(buildPocSearchQuery('Acme', 'acme.com', POC_ROLES)).toBe(ORIGINAL_ALL_ROLES);
  });

  it('narrows the OR-terms to the selected roles only', () => {
    expect(buildPocSearchQuery('Acme', null, ['talent_acquisition']))
      .toBe('("Acme") ("talent acquisition" OR recruiter) (site:linkedin.com/in)');
    const vendorHm = buildPocSearchQuery('Acme', null, ['hiring_delivery_manager', 'vendor_procurement']);
    expect(vendorHm).toContain('"hiring manager" OR "delivery manager" OR procurement OR "vendor management"');
    expect(vendorHm).not.toContain('talent acquisition');
  });

  it('normalizePocRoles drops unknown roles and falls back to all', () => {
    expect(normalizePocRoles(['talent_acquisition', 'bogus'])).toEqual(['talent_acquisition']);
    expect(normalizePocRoles([])).toEqual(POC_ROLES);
    expect(normalizePocRoles(undefined)).toEqual(POC_ROLES);
    expect(normalizePocRoles('nope')).toEqual(POC_ROLES);
  });
});

describe('previewFreePocSearch — read-only dry-run', () => {
  const signalRow = { rows: [{ id: 'sig-1', company_id: 'co-1', company_name: 'Acme', domain: 'acme.com' }] };

  beforeEach(() => { poolQuery.mockReset(); process.env.SEARCHAPI_API_KEY = 'test-key'; });

  function install({ internal = 0, cooldown = false, daily = 1, monthly = 4 }) {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM wizmatch_job_signals')) return signalRow;
      if (sql.includes('FROM wizmatch_company_contacts')) return { rows: [{ count: internal }] };
      if (sql.includes("provider='poc_discovery'") && sql.includes('created_at>NOW()')) return { rows: cooldown ? [{ ok: 1 }] : [] };
      if (sql.includes('AS daily')) return { rows: [{ daily, monthly }] }; // getSearchApiRunUsage
      return { rows: [] };
    });
  }

  it('returns the role-targeted query + allowance and estimates 1 credit when a search would run', async () => {
    install({ internal: 0, cooldown: false, daily: 1 });
    const out = await previewFreePocSearch('t', 'sig-1', ['talent_acquisition']);
    expect(out.query).toBe('("Acme") ("talent acquisition" OR recruiter) (site:linkedin.com/in OR site:acme.com)');
    expect(out.internalContactsExist).toBe(false);
    expect(out.inCooldown).toBe(false);
    expect(out.estimatedSearchApiCredits).toBe(1);
    expect(out.searchApiUsage).toMatchObject({ daily: 1, dailyLimit: 5, dailyRemaining: 4, monthlyLimit: 80 });
  });

  it('estimates 0 credits when the company already has internal contacts (reused free)', async () => {
    install({ internal: 3 });
    const out = await previewFreePocSearch('t', 'sig-1');
    expect(out.internalContactsExist).toBe(true);
    expect(out.estimatedSearchApiCredits).toBe(0);
  });

  it('estimates 0 credits inside the 30-day per-company cooldown', async () => {
    install({ internal: 0, cooldown: true });
    const out = await previewFreePocSearch('t', 'sig-1');
    expect(out.inCooldown).toBe(true);
    expect(out.estimatedSearchApiCredits).toBe(0);
  });
});
