// PRD-005 PR 7 §14 — regression tests for prepareCompaniesJob.
//
// Fails when any of the following is removed: the tenant_id predicate on any
// query, the per-tenant advisory lock, the preparationAllowed hard stop, the
// zero-spend boundary (no paid provider import), duplicate-does-not-block-prep,
// or the cold-start confidence gate (medium/low never auto-surfaced).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockPoolQuery = vi.fn();

vi.mock('../db', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

const state = vi.hoisted(() => ({
  lockAcquired: true,
  gateDecision: {
    decision: 'allow' as 'allow' | 'review' | 'deny',
    reasonCodes: ['policy_accepts_external_vendors'],
    effectiveLevel: 8,
    preparationAllowed: true,
    effective: {
      externalHiringPolicy: { value: 'accepts_external_vendors', scopeKey: 'entire_company', policyId: 'p1' },
      relationshipType: { value: 'new_prospect', scopeKey: 'entire_company', policyId: 'p1' },
      outreachEligibility: { value: 'eligible', scopeKey: 'entire_company', policyId: 'p1' },
    },
  },
  websitePatternSearchResult: [] as unknown[],
}));

const providerSpies = vi.hoisted(() => ({
  websitePatternSearch: vi.fn(async () => state.websitePatternSearchResult),
  apolloPeopleSearch: vi.fn(async () => []),
  snovDomainSearch: vi.fn(async () => []),
  googleFallbackSearch: vi.fn(async () => []),
  genericGuessSearch: vi.fn(async () => []),
  reacherVerify: vi.fn(async () => 'unknown' as const),
}));

vi.mock('../services/wizmatchContactDiscoveryProviders', () => ({
  createDefaultWizmatchContactDiscoveryProviders: () => providerSpies,
}));

vi.mock('../services/wizmatchSourcing', () => ({
  withWizmatchSourceLock: async (_tenantId: string, _key: string, run: () => Promise<unknown>) => {
    if (!state.lockAcquired) return null;
    return run();
  },
}));

vi.mock('../modules/outreach/outreachGate', () => ({
  evaluateWizmatchOutreachGate: vi.fn(async () => state.gateDecision),
}));

function dispatch(sql: string, params: unknown[]) {
  const text = sql.replace(/\s+/g, ' ').trim();
  if (text.startsWith('SELECT c.id, c.name, c.domain')) {
    expect(params[0]).toBe('tenant-1'); // tenant predicate on the batch-selection query
    return { rows: [{ id: 'company-1', name: 'Acme Inc', domain: 'acme.example.com' }], rowCount: 1 };
  }
  if (text.startsWith('INSERT INTO wizmatch_company_intelligence')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [], rowCount: 1 };
  }
  if (text.startsWith('SELECT 1 FROM wizmatch_company_duplicates')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [], rowCount: 0 };
  }
  if (text.startsWith('SELECT job_title, days_open, location, score')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [{ job_title: 'Senior Java Engineer', days_open: 12, location: 'Bengaluru', score: 80 }], rowCount: 1 };
  }
  if (text.startsWith('SELECT id, name, title, email, source, ranking_score, confidence_score, status, metadata FROM wizmatch_contact_candidates')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [], rowCount: 0 };
  }
  if (text.startsWith('SELECT LOWER(email) AS email')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [], rowCount: 0 };
  }
  if (text.startsWith('INSERT INTO wizmatch_contact_candidates')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [], rowCount: 0 };
  }
  if (text.startsWith('UPDATE wizmatch_company_intelligence')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [], rowCount: 1 };
  }
  if (text.startsWith('SELECT id, name, domain FROM wizmatch_companies')) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [{ id: 'company-1', name: 'Acme Inc', domain: 'acme.example.com' }], rowCount: 1 };
  }
  if (text.startsWith("SELECT metadata #> '{prep}'")) {
    expect(params[0]).toBe('tenant-1');
    return { rows: [{ prep: null }], rowCount: 1 };
  }
  throw new Error(`unexpected query: ${text}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => dispatch(sql, params));
  state.lockAcquired = true;
  state.gateDecision = {
    decision: 'allow',
    reasonCodes: ['policy_accepts_external_vendors'],
    effectiveLevel: 8,
    preparationAllowed: true,
    effective: {
      externalHiringPolicy: { value: 'accepts_external_vendors', scopeKey: 'entire_company', policyId: 'p1' },
      relationshipType: { value: 'new_prospect', scopeKey: 'entire_company', policyId: 'p1' },
      outreachEligibility: { value: 'eligible', scopeKey: 'entire_company', policyId: 'p1' },
    },
  };
  state.websitePatternSearchResult = [];
});

describe('prepareCompaniesJob — zero-spend boundary', () => {
  it('never imports a paid discovery/search path (static source check)', () => {
    const source = readFileSync(join(__dirname, '../modules/outreach/prepareCompanies.ts'), 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    for (const forbidden of ['Apollo', 'Snov', 'Serper', 'SearchAPI', 'searchPublicWeb', 'discoverFreePocsForSignal', 'callClaude', 'generateSignalDraftEmails']) {
      expect(importLines).not.toContain(forbidden);
    }
  });

  it('calls only the free websitePatternSearch rung, never a paid provider function, when a website is scraped', async () => {
    state.websitePatternSearchResult = [
      {
        name: 'Careers Inbox',
        title: 'Published TA inbox',
        email: 'careers@acme.example.com',
        source: 'website_manual_pattern',
        sourceUrl: 'https://acme.example.com',
        deliverabilityStatus: 'unverified',
        confidenceScore: 8,
        rankingScore: 20,
        costCents: 0,
        reasons: [],
        raw: { confidenceTier: 'high' },
      },
    ];
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(providerSpies.websitePatternSearch).toHaveBeenCalledTimes(1);
    expect(providerSpies.apolloPeopleSearch).not.toHaveBeenCalled();
    expect(providerSpies.snovDomainSearch).not.toHaveBeenCalled();
    expect(providerSpies.googleFallbackSearch).not.toHaveBeenCalled();
    expect(report.zeroSpend).toBe(true);
  });
});

describe('prepareCompaniesJob — lock and idempotency', () => {
  it('returns lockAcquired:false and does no work when the advisory lock is already held', async () => {
    state.lockAcquired = false;
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.lockAcquired).toBe(false);
    expect(report.attempted).toBe(0);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('overwrites the same jsonb prep field on every run rather than appending', async () => {
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    await prepareCompaniesJob('tenant-1');

    const updateCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE wizmatch_company_intelligence'));
    expect(updateCall).toBeDefined();
    expect(String(updateCall![0])).toContain("jsonb_set(COALESCE(metadata, '{}'::jsonb), '{prep}'");
  });
});

describe('prepareCompaniesJob — company-policy gate (hard stop)', () => {
  it('skips a company and writes nothing further when preparationAllowed is false', async () => {
    state.gateDecision = {
      decision: 'deny',
      reasonCodes: ['policy_no_external_agencies'],
      effectiveLevel: 1,
      preparationAllowed: false,
      effective: {
        externalHiringPolicy: { value: 'no_external_agencies', scopeKey: 'entire_company', policyId: 'p1' },
        relationshipType: { value: 'new_prospect', scopeKey: 'entire_company', policyId: 'p1' },
        outreachEligibility: { value: 'blocked', scopeKey: 'entire_company', policyId: 'p1' },
      },
    };
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.skipped).toBe(1);
    expect(report.results[0]).toMatchObject({ status: 'skipped', preparationAllowed: false, reasonCode: 'policy_no_external_agencies' });
    // No downstream writes (intelligence bootstrap, contact insert, prep-report UPDATE).
    const calledSql = mockPoolQuery.mock.calls.map(([sql]) => String(sql));
    expect(calledSql.some((s) => s.includes('INSERT INTO wizmatch_company_intelligence'))).toBe(false);
    expect(calledSql.some((s) => s.includes('UPDATE wizmatch_company_intelligence'))).toBe(false);
  });
});

describe('prepareCompaniesJob — duplicate containment does not block prep', () => {
  it('still prepares a company with a pending duplicate suspect', async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT 1 FROM wizmatch_company_duplicates')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].duplicateSuspected).toBe(true);
    expect(report.results[0].status).not.toBe('skipped');
  });
});

describe('prepareCompaniesJob — cold-start contact confidence gate', () => {
  it('never surfaces a low-confidence contact as the recommended candidate', async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT id, name, title, email, source, ranking_score, confidence_score, status, metadata FROM wizmatch_contact_candidates')) {
        return {
          rows: [{ id: 'cand-1', name: 'Jane Doe', title: 'Recruiter', email: 'jane@acme.example.com', source: 'internal_crm', ranking_score: 10, confidence_score: 1, status: 'needs_review', metadata: {} }],
          rowCount: 1,
        };
      }
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].contactConfidenceTier).toBe('low');
    expect(report.results[0].contactCandidateId).toBeNull();
    expect(report.results[0].status).toBe('review_required');
  });

  it('surfaces a high-confidence contact and marks the company prepared', async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT id, name, title, email, source, ranking_score, confidence_score, status, metadata FROM wizmatch_contact_candidates')) {
        return {
          rows: [{ id: 'cand-1', name: 'Jane Doe', title: 'Recruiter', email: 'jane@acme.example.com', source: 'internal_crm', ranking_score: 90, confidence_score: 10, status: 'needs_review', metadata: { confidenceTier: 'high' } }],
          rowCount: 1,
        };
      }
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].contactConfidenceTier).toBe('high');
    expect(report.results[0].contactCandidateId).toBe('cand-1');
    expect(report.results[0].status).toBe('prepared');
  });
});

describe('prepareCompaniesJob — campaign recommendation and draft', () => {
  it('derives the campaign recommendation from the resolved policy, not a hand-rolled rule', async () => {
    state.gateDecision = {
      decision: 'deny',
      reasonCodes: ['policy_msp_vms_only'],
      effectiveLevel: 6,
      preparationAllowed: true,
      effective: {
        externalHiringPolicy: { value: 'msp_vms_only', scopeKey: 'entire_company', policyId: 'p1' },
        relationshipType: { value: 'new_prospect', scopeKey: 'entire_company', policyId: 'p1' },
        outreachEligibility: { value: 'needs_review', scopeKey: 'entire_company', policyId: 'p1' },
      },
    };
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].campaignRecommendation).toMatchObject({
      decision: 'deny',
      route: 'msp_vms_research',
      allowedCampaignTypes: ['msp_vms'],
      allowedOutreachModes: ['research_only'],
    });
  });

  it('never fabricates a fact — hypotheses stay empty and verifiedFacts only lists what was actually found', async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT job_title, days_open, location, score')) return { rows: [], rowCount: 0 };
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].draft?.hypotheses).toEqual([]);
    expect(report.results[0].draft?.verifiedFacts).toEqual(['Company: Acme Inc']);
  });
});

describe('prepareCompaniesJob — per-company failure isolation', () => {
  it('reports a thrown error as failed without crashing the batch', async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('SELECT job_title, days_open, location, score')) throw new Error('db exploded');
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.failed).toBe(1);
    expect(report.results[0]).toMatchObject({ status: 'failed', error: 'db exploded' });
  });
});
