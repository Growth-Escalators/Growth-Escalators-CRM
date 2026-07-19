import { beforeEach, describe, expect, it, vi } from 'vitest';

// Contact Intelligence persistence/orchestration cluster extracted from
// src/routes/wizmatch.ts (finding M26) into src/services/wizmatchContactIntelligenceRepo.ts.
// These functions issue raw pool.query() SQL; we mock the pool and assert on the
// SQL shape + params rather than hitting a real Postgres instance.

const poolQuery = vi.fn();
vi.mock('../db/index', () => ({
  db: {},
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
    connect: vi.fn(),
  },
}));

import {
  buildContactIntelligenceResult,
  fetchInternalContactCandidates,
  fetchInternalContactCandidatesBatch,
  persistContactIntelligenceSnapshot,
  seedProspectCompany,
  type ContactIntelligenceCompanyRow,
} from '../services/wizmatchContactIntelligenceRepo';

beforeEach(() => {
  poolQuery.mockReset();
});

// A company row shaped for a clearly IT/tech, US-region, decently-scoring signal so
// qualifyCompanyForContactIntelligence doesn't hard-block it as non-tech/rejected —
// component scores need to clear the 'Reject' tier boundary for contactCandidates to
// survive the do-not-contact filter and appear in the result.
const companyRow: ContactIntelligenceCompanyRow = {
  company_id: 'co-1',
  company_name: 'Acme Tech',
  company_domain: 'acme.com',
  company_country: 'US',
  company_industry: 'Technology',
  is_prime: true,
  prime_msa_status: 'signed',
  h1b_sponsor_count: 5,
  signal_id: 'sig-1',
  job_title: 'Senior Software Engineer',
  keywords: ['java', 'spring boot'],
  location: 'Austin, TX',
  source: 'linkedin',
  signal_score: 8,
  days_open: 10,
  signal_status: 'scored',
  matched_candidate_count: 2,
  active_signal_count: 1,
  positive_reply_count: 1,
  negative_reply_count: 0,
  placement_count: 1,
  domain_status: 'healthy',
  suppressed_count: 0,
  active_duplicate_count: 0,
  signal_contact_ids: [],
};

const internalContactOverride = [
  {
    id: 'contact-1',
    name: 'Jane Doe',
    title: 'VP Engineering',
    email: 'jane@acme.com',
    phone: null,
    linkedinUrl: null,
    verified: true,
    doNotContact: false,
    source: 'referral',
    relationshipSignals: ['verified_email'],
  },
];

describe('buildContactIntelligenceResult', () => {
  it('calls through to qualifyCompanyForContactIntelligence and shapes the result', async () => {
    const result = await buildContactIntelligenceResult('tenant-1', companyRow, internalContactOverride);

    expect(result.companyId).toBe('co-1');
    expect(result.companyName).toBe('Acme Tech');
    expect(result.targetRegion).toBe('us');
    // A prime, MSA-signed, strong-signal, IT role should not be rejected.
    expect(result.qualificationTier).not.toBe('Reject');
    expect(result.latestSignal).toMatchObject({
      id: 'sig-1',
      jobTitle: 'Senior Software Engineer',
      score: 8,
      daysOpen: 10,
      matchedCandidateCount: 2,
    });
    expect(result.relationshipSummary).toMatchObject({
      knownContactCount: 1,
      positiveReplyCount: 1,
      placementCount: 1,
      activeSignalCount: 1,
    });
    expect(result.safetySummary).toMatchObject({
      domainStatus: 'healthy',
      suppressedCount: 0,
      activeDuplicateCount: 0,
    });
    // qualifyCompanyForContactIntelligence's own contract: a non-do-not-contact
    // internal contact survives into contactCandidates.
    expect(result.contactCandidates).toHaveLength(1);
    expect(result.contactCandidates[0]).toMatchObject({ id: 'contact-1', name: 'Jane Doe' });
  });

  it('fetches internal contacts itself when no override is passed', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'contact-2',
          name: 'Bob Manager',
          title: 'Director of Talent',
          do_not_contact: false,
          source: 'internal_crm',
          email: 'bob@acme.com',
          email_verified: true,
          phone: null,
          linkedin_url: null,
          from_signal: false,
          is_suppressed: false,
        },
      ],
    });

    const result = await buildContactIntelligenceResult('tenant-1', companyRow);

    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(String(poolQuery.mock.calls[0][0])).toContain('FROM contacts c');
    expect(result.contactCandidates.map((c) => c.id)).toContain('contact-2');
  });
});

describe('fetchInternalContactCandidates vs fetchInternalContactCandidatesBatch', () => {
  it('produce identical output for the same fixture data', async () => {
    const rawContactRow = {
      id: 'contact-3',
      name: 'Alex Lead',
      title: 'Engineering Manager',
      do_not_contact: false,
      source: 'internal_crm',
      email: 'alex@acme.com',
      email_verified: true,
      phone: '9199999999',
      linkedin_url: null,
      from_signal: true,
      is_suppressed: false,
    };

    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('CROSS JOIN LATERAL')) {
        return { rows: [{ __company_id: companyRow.company_id, ...rawContactRow }] };
      }
      return { rows: [rawContactRow] };
    });

    const single = await fetchInternalContactCandidates(
      'tenant-1',
      companyRow.company_name,
      companyRow.company_domain,
      companyRow.signal_contact_ids ?? [],
    );
    const batchMap = await fetchInternalContactCandidatesBatch('tenant-1', [companyRow]);
    const batch = batchMap.get(companyRow.company_id);

    expect(batch).toBeDefined();
    expect(batch).toEqual(single);
  });

  it('batch seeds every requested company with an empty list when it has no matches', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const batchMap = await fetchInternalContactCandidatesBatch('tenant-1', [companyRow]);
    expect(batchMap.get('co-1')).toEqual([]);
  });
});

describe('persistContactIntelligenceSnapshot', () => {
  it('upserts the company snapshot and inserts a deduped contact candidate row', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('JOIN latest_signals')) {
        return { rows: [companyRow] };
      }
      if (sql.includes('FROM contacts c')) {
        return {
          rows: [
            {
              id: 'contact-1',
              name: 'Jane Doe',
              title: 'VP Engineering',
              do_not_contact: false,
              source: 'referral',
              email: 'jane@acme.com',
              email_verified: true,
              phone: null,
              linkedin_url: null,
              from_signal: false,
              is_suppressed: false,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO wizmatch_company_intelligence')) {
        expect(sql).toContain('ON CONFLICT (tenant_id, company_id)');
        expect(params[0]).toBe('tenant-1');
        expect(params[1]).toBe('co-1');
        return { rows: [{ id: 'ci-1' }] };
      }
      if (sql.includes('INSERT INTO wizmatch_contact_candidates')) {
        expect(sql).toContain('WHERE NOT EXISTS');
        expect(params[0]).toBe('tenant-1');
        expect(params[1]).toBe('ci-1');
        expect(params[2]).toBe('co-1');
        expect(params[3]).toBe('contact-1'); // candidate.id (crm_contact_id)
        expect(params[4]).toBe('Jane Doe');
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO wizmatch_discovery_runs')) {
        return { rows: [] };
      }
      if (sql.includes('FROM wizmatch_company_intelligence')) {
        return { rows: [{ id: 'ci-1', qualification_tier: 'A', status: 'qualified', review_status: null }] };
      }
      if (sql.includes('FROM wizmatch_contact_candidates')) {
        return { rows: [] };
      }
      if (sql.includes('FROM wizmatch_discovery_runs')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await persistContactIntelligenceSnapshot('tenant-1', 'user-1', 'co-1');

    expect(result).not.toBeNull();
    const calls = poolQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((sql) => sql.includes('INSERT INTO wizmatch_company_intelligence'))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO wizmatch_contact_candidates'))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO wizmatch_discovery_runs'))).toBe(true);
  });

  it('returns null when the company has no signal rows', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN latest_signals')) return { rows: [] };
      return { rows: [] };
    });
    const result = await persistContactIntelligenceSnapshot('tenant-1', 'user-1', 'missing-co');
    expect(result).toBeNull();
  });
});

// In both tests below, the 'JOIN latest_signals' branch returns no rows, so the
// nested persistContactIntelligenceSnapshot call short-circuits to null — these
// tests focus on seedProspectCompany's own insert/update + signal logic, which is
// separate from the snapshot persistence already covered above.
describe('seedProspectCompany', () => {
  it('updates an existing company (case-insensitive name match) and reuses its id', async () => {
    poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT id FROM wizmatch_companies')) {
        return { rows: [{ id: 'co-existing' }] };
      }
      if (sql.startsWith('UPDATE wizmatch_companies')) {
        expect(params[params.length - 1]).toBe('co-existing');
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO wizmatch_job_signals')) {
        return { rows: [{ id: 'sig-new' }] };
      }
      if (sql.includes('JOIN latest_signals')) {
        return { rows: [] }; // short-circuit nested persistContactIntelligenceSnapshot
      }
      return { rows: [] };
    });

    const result = await seedProspectCompany({
      tenantId: 'tenant-1',
      userId: 'user-1',
      companyName: 'Existing Co',
      domain: 'existing.com',
      jobTitle: 'Backend Engineer',
      jobUrl: null,
      location: 'Remote',
      notes: null,
      targetRegion: 'us',
      industry: 'Software',
      employeeCount: 50,
      linkedinUrl: null,
      keywords: ['node'],
    });

    expect(result.companyId).toBe('co-existing');
    expect(result.companyExisted).toBe(true);
    expect(result.signalId).toBe('sig-new');
    expect(result.intelligenceItem).toBeNull();
    const calls = poolQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((sql) => sql.startsWith('UPDATE wizmatch_companies'))).toBe(true);
    expect(calls.some((sql) => sql.startsWith('INSERT INTO wizmatch_companies'))).toBe(false);
  });

  it('inserts a new company when no case-insensitive name match exists', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM wizmatch_companies')) {
        return { rows: [] }; // no existing company
      }
      if (sql.startsWith('INSERT INTO wizmatch_companies')) {
        return { rows: [{ id: 'co-new' }] };
      }
      if (sql.includes('INSERT INTO wizmatch_job_signals')) {
        return { rows: [{ id: 'sig-brand-new' }] };
      }
      if (sql.includes('JOIN latest_signals')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await seedProspectCompany({
      tenantId: 'tenant-1',
      userId: 'user-1',
      companyName: 'Brand New Co',
      domain: 'brandnew.com',
      jobTitle: 'Full Stack Engineer',
      jobUrl: null,
      location: 'Bengaluru',
      notes: null,
      targetRegion: 'india',
      industry: 'Software',
      employeeCount: 10,
      linkedinUrl: null,
      keywords: ['react'],
    });

    expect(result.companyId).toBe('co-new');
    expect(result.companyExisted).toBe(false);
    expect(result.signalId).toBe('sig-brand-new');
    const calls = poolQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((sql) => sql.startsWith('INSERT INTO wizmatch_companies'))).toBe(true);
    expect(calls.some((sql) => sql.startsWith('UPDATE wizmatch_companies'))).toBe(false);
  });
});
