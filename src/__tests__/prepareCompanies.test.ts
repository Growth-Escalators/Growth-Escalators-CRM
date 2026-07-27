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

/** Runtime SQL text captured the last time the fetchBestSignal query ran —
 * used to assert against the actual executed statement rather than raw
 * source text, which a doc comment can also satisfy (see the test below). */
let capturedSignalQuery = '';

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
  /** Open signals on file for the company, highest score first after sorting. */
  signalRows: [] as Array<{ id: string; job_title: string; days_open: number | null; location: string | null; score: number | null }>,
  /** Signal ids carrying an active `specific_signal:<id>` blocked policy row (PRD-005 §8.2 L4). */
  blockedSignalIds: [] as string[],
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

/** A statement is tenant-safe if it FILTERS on `tenant_id = $1` (reads/writes)
 * or WRITES `tenant_id` as its first inserted column (inserts). Asserting only
 * `params[0] === 'tenant-1'` is vacuous: deleting `WHERE c.tenant_id = $1`
 * while leaving the bound parameter in place turns a query cross-tenant and
 * every such test still passes — the PR 2 / PR 5 mock-vacuity finding. */
function assertTenantScoped(text: string) {
  const filtersOnTenant = /tenant_id = \$1/.test(text);
  const insertsTenantFirst = /^INSERT INTO \w+\s*\(\s*tenant_id\b/i.test(text);
  expect(
    filtersOnTenant || insertsTenantFirst,
    `statement is neither tenant-filtered nor tenant-inserting: ${text}`,
  ).toBe(true);
}

function dispatch(sql: string, params: unknown[]) {
  const text = sql.replace(/\s+/g, ' ').trim();
  assertTenantScoped(text);
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
  if (/^SELECT s\.id, s\.job_title/.test(text)) {
    expect(params[0]).toBe('tenant-1');
    capturedSignalQuery = text;
    // P8B-1 — a faithful (small) interpreter of the ONE predicate under test,
    // rather than returning the fixture verbatim. Returning it verbatim would
    // make the blocked-signal exclusion untestable: deleting the NOT EXISTS
    // clause from the statement would leave the suite green, which is this
    // project's recurring mock-vacuity defect class.
    const excludesBlockedSignals =
      /NOT EXISTS/.test(text)
      && /wizmatch_company_policies/.test(text)
      && /p\.tenant_id\s*=\s*s\.tenant_id/.test(text)
      && /scope_type = 'specific_signal'/.test(text)
      && /outreach_eligibility = 'blocked'/.test(text)
      && /superseded_at IS NULL/.test(text);
    const eligible = excludesBlockedSignals
      ? state.signalRows.filter((s) => !state.blockedSignalIds.includes(s.id))
      : state.signalRows;
    const ordered = [...eligible].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return { rows: ordered.slice(0, 1), rowCount: Math.min(ordered.length, 1) };
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
    return {
      rows: [
        {
          id: 'cand-web-1',
          name: 'Talent Acquisition (inbox)',
          title: 'Published Talent Acquisition inbox',
          email: 'careers@acme.example.com',
          source: 'website_manual_pattern',
          ranking_score: 20,
          confidence_score: 8,
          status: 'needs_review',
          metadata: JSON.parse(String(params[10])),
        },
      ],
      rowCount: 1,
    };
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

/** Make `fetchBestExistingCandidate` return one row, leaving every other
 * statement on the shared tenant-asserting dispatcher. */
function withExistingContact(overrides: Record<string, unknown>) {
  mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT id, name, title, email, source, ranking_score, confidence_score, status, metadata FROM wizmatch_contact_candidates')) {
      expect(params[0]).toBe('tenant-1');
      return {
        rows: [
          {
            id: 'cand-1',
            name: 'Jane Doe',
            title: 'Recruiter',
            email: 'jane@acme.example.com',
            source: 'internal_crm',
            ranking_score: 10,
            confidence_score: 1,
            status: 'needs_review',
            metadata: {},
            ...overrides,
          },
        ],
        rowCount: 1,
      };
    }
    return dispatch(sql, params);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedSignalQuery = '';
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
  state.signalRows = [
    { id: 'signal-top', job_title: 'Senior Java Engineer', days_open: 12, location: 'Bengaluru', score: 80 },
  ];
  state.blockedSignalIds = [];
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

describe('prepareCompaniesJob — discovered-contact write shape', () => {
  beforeEach(() => {
    state.websitePatternSearchResult = [
      {
        name: 'Talent Acquisition (inbox)',
        title: 'Published Talent Acquisition inbox',
        email: 'careers@acme.example.com',
        source: 'website_manual_pattern',
        sourceUrl: 'https://acme.example.com',
        deliverabilityStatus: 'unverified',
        confidenceScore: 8,
        rankingScore: 20,
        costCents: 0,
        reasons: ['Published Talent Acquisition inbox scraped from the company website.'],
        raw: { confidenceTier: 'high', team: 'Talent Acquisition' },
      },
    ];
  });

  it('nests provider grades under metadata.raw — the envelope every other reader expects', async () => {
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    await prepareCompaniesJob('tenant-1');

    const insert = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wizmatch_contact_candidates'));
    expect(insert).toBeDefined();
    const metadata = JSON.parse(String(insert![1][10]));
    // Regression guard: writing `raw` at the top level strips confidenceTier /
    // roleCategory / team / mxProvider from mapPersistedCandidate and the workbench.
    expect(metadata.raw).toMatchObject({ confidenceTier: 'high', team: 'Talent Acquisition' });
    expect(metadata.confidenceTier).toBeUndefined();
    expect(metadata.reasons).toEqual(['Published Talent Acquisition inbox scraped from the company website.']);
  });

  it('dedups in one statement (WHERE NOT EXISTS) and links the company_intelligence row', async () => {
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    await prepareCompaniesJob('tenant-1');

    const insert = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wizmatch_contact_candidates'));
    const sql = String(insert![0]).replace(/\s+/g, ' ');
    // `wizmatch_contact_candidates` has no unique index, so a bare ON CONFLICT
    // can never fire and a read-then-write races poc_discovery on the same table.
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).not.toContain('ON CONFLICT');
    expect(sql).toContain('company_intelligence_id');
    expect(sql).toContain('existing.tenant_id = $1');
  });

  it('records a scraped contact as website_scrape only — never also as internal_crm', async () => {
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    const kinds = report.results[0].provenance.map((p) => p.kind);
    expect(kinds).toContain('website_scrape');
    expect(kinds).not.toContain('internal_crm');
  });

  it('never greets a published role inbox by "first name" or asserts it as a person', async () => {
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    const draft = report.results[0].draft!;
    expect(draft.body.startsWith('Hi,')).toBe(true);
    expect(draft.body).not.toContain('Hi Talent');
    expect(draft.verifiedFacts.some((f) => f.startsWith('Contact name'))).toBe(false);
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

    const calledSql = mockPoolQuery.mock.calls.map(([sql]) => String(sql));
    // No intelligence row is BOOTSTRAPPED for a denied company — being denied
    // must not create an intelligence record as a side effect.
    expect(calledSql.some((s) => s.includes('INSERT INTO wizmatch_company_intelligence'))).toBe(false);
    // No contact discovery, no contact write.
    expect(calledSql.some((s) => s.includes('INSERT INTO wizmatch_contact_candidates'))).toBe(false);
    expect(providerSpies.websitePatternSearch).not.toHaveBeenCalled();
    // No prep REPORT is written. The one permitted write is the attempt stamp,
    // which records only that the company was considered — no draft, no
    // campaign recommendation, no contact, no policy claim. Without it a
    // permanently denied company refills every batch forever and starves the
    // rest of the tenant's backlog.
    const intelligenceWrites = mockPoolQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE wizmatch_company_intelligence'),
    );
    expect(intelligenceWrites).toHaveLength(1);
    const stampSql = String(intelligenceWrites[0][0]).replace(/\s+/g, ' ');
    expect(stampSql).toContain('lastAttemptedAt');
    expect(stampSql).toContain('lastAttemptStatus');
    expect(stampSql).not.toContain("'{prep}', $3::jsonb");
    expect(intelligenceWrites[0][1]).toEqual(['tenant-1', 'company-1', expect.any(String), 'skipped']);
  });

  it('stamps the attempt so a denied company ages out of the batch selector', async () => {
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
    await prepareCompaniesJob('tenant-1');

    const selectSql = String(
      mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM wizmatch_companies c'))![0],
    ).replace(/\s+/g, ' ');
    // The selector must consider the last ATTEMPT, not only the last success —
    // otherwise skipped/failed companies never age out.
    expect(selectSql).toContain('lastAttemptedAt');
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
    withExistingContact({});
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].contactConfidenceTier).toBe('low');
    expect(report.results[0].contactCandidateId).toBeNull();
    expect(report.results[0].status).toBe('review_required');
  });

  it('surfaces a high-confidence contact and marks the company prepared', async () => {
    withExistingContact({ ranking_score: 90, confidence_score: 10, metadata: { raw: { confidenceTier: 'high' } } });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].contactConfidenceTier).toBe('high');
    expect(report.results[0].contactCandidateId).toBe('cand-1');
    expect(report.results[0].status).toBe('prepared');
  });

  it('reads the grader verdict from metadata.raw, not the top level (PR 6 H-4)', async () => {
    // Explicitly graded `low` with a numeric score that WOULD grade `high` if the
    // envelope were read wrongly. Passing the whole `metadata` column makes
    // `raw?.confidenceTier` undefined and silently promotes this contact.
    withExistingContact({ confidence_score: 10, metadata: { raw: { confidenceTier: 'low' } } });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].contactConfidenceTier).toBe('low');
    expect(report.results[0].contactCandidateId).toBeNull();
    expect(report.results[0].status).toBe('review_required');
  });

  it('routes a medium-confidence contact to review, never to prepared (§7/§13)', async () => {
    withExistingContact({ confidence_score: 6, metadata: { raw: {} } });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].contactConfidenceTier).toBe('medium');
    expect(report.results[0].contactCandidateId).toBe('cand-1');
    // §13: Ready to Contact requires a HIGH-confidence contact. Medium is Needs Review.
    expect(report.results[0].status).toBe('review_required');
  });
});

describe('prepareCompaniesJob — a policy-denied company is never reported prepared', () => {
  it('demotes a deny that still permits preparation to review_required', async () => {
    // `policy_paused_by_owner` is prepAllowed:true in the §9 taxonomy, so the
    // gate returns decision:'deny' WITH preparationAllowed:true. Prep must run,
    // but the company must not be presented as ready to contact.
    state.gateDecision = {
      decision: 'deny',
      reasonCodes: ['policy_paused_by_owner'],
      effectiveLevel: 5,
      preparationAllowed: true,
      effective: {
        externalHiringPolicy: { value: 'accepts_external_vendors', scopeKey: 'entire_company', policyId: 'p1' },
        relationshipType: { value: 'new_prospect', scopeKey: 'entire_company', policyId: 'p1' },
        outreachEligibility: { value: 'paused', scopeKey: 'entire_company', policyId: 'p1' },
      },
    };
    withExistingContact({ ranking_score: 90, confidence_score: 10, metadata: { raw: { confidenceTier: 'high' } } });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.results[0].preparationAllowed).toBe(true);
    expect(report.results[0].decision).toBe('deny');
    expect(report.results[0].status).toBe('review_required');
    expect(report.prepared).toBe(0);
  });
});

describe('prepareCompaniesJob — report honesty', () => {
  it('counts a scraped company even when that company later fails', async () => {
    state.websitePatternSearchResult = [];
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('UPDATE wizmatch_company_intelligence')) throw new Error('db exploded after the scrape');
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.failed).toBe(1);
    // The scrape budget was spent before the failure — reporting 0 would
    // understate the run's real outbound-HTTP surface.
    expect(report.results[0].fetched.website).toBe(true);
    expect(report.websiteScrapedCompanies).toBe(1);
  });

  it('reports failed (not prepared) when the prep report UPDATE writes no row', async () => {
    mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text.startsWith('UPDATE wizmatch_company_intelligence')) return { rows: [], rowCount: 0 };
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.prepared).toBe(0);
    expect(report.results[0].status).toBe('failed');
    expect(report.results[0].error).toContain('not persisted');
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
      if (/^SELECT s\.id, s\.job_title/.test(text)) return { rows: [], rowCount: 0 };
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
      if (/^SELECT s\.id, s\.job_title/.test(text)) throw new Error('db exploded');
      return dispatch(sql, params);
    });
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');

    expect(report.failed).toBe(1);
    expect(report.results[0]).toMatchObject({ status: 'failed', error: 'db exploded' });
  });
});

// P8B-1 (owner-ratified) — PRD-005 §8.2 L4 requirement #5: no blocked signal
// may be used to justify readiness, a campaign recommendation, a
// personalisation claim or a route recommendation. `fetchBestSignal`'s output
// feeds `buildDeterministicDraft` and the persisted prep report the workbench
// displays, so this is where that leak actually closes.
describe('prepareCompaniesJob — a blocked signal never drives the draft or the report', () => {
  beforeEach(() => {
    state.signalRows = [
      { id: 'signal-blocked', job_title: 'Head of Legal Hiring', days_open: 3, location: 'Mumbai', score: 95 },
      { id: 'signal-open', job_title: 'Senior Java Engineer', days_open: 12, location: 'Bengaluru', score: 40 },
    ];
  });

  it('falls through to the next-best eligible signal when the top-scoring one is blocked', async () => {
    state.blockedSignalIds = ['signal-blocked'];
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');
    const draft = report.results[0].draft;
    expect(draft?.subject).toContain('Senior Java Engineer');
    expect(draft?.subject).not.toContain('Head of Legal Hiring');
    expect(draft?.body).not.toContain('Head of Legal Hiring');
    expect(draft?.verifiedFacts).toContain('Open role: Senior Java Engineer');
    expect(draft?.verifiedFacts.join(' ')).not.toContain('Head of Legal Hiring');
  });

  it('produces a signal-free draft when every open signal is blocked', async () => {
    state.blockedSignalIds = ['signal-blocked', 'signal-open'];
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');
    const draft = report.results[0].draft;
    expect(draft?.subject).toBe('Quick note for Acme Inc');
    expect(draft?.verifiedFacts.some((f) => f.startsWith('Open role:'))).toBe(false);
  });

  // CONTROL — with no blocked signal, the highest-scoring one still wins.
  it('still selects the highest-scoring signal when none is blocked', async () => {
    state.blockedSignalIds = [];
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    const report = await prepareCompaniesJob('tenant-1');
    expect(report.results[0].draft?.subject).toContain('Head of Legal Hiring');
  });

  it('scopes the exclusion subquery to the same tenant as the signal it guards', async () => {
    // Asserts against the actual runtime SQL text executed by the query
    // interception mock (captured in `dispatch` above), not `readFileSync`
    // over the source file. A `readFileSync` + `toContain` assertion is
    // satisfied by prose in a doc comment above the query (see the
    // `fetchBestSignal` comment block) just as readily as by the real SQL,
    // so it never actually proves the executed statement is tenant-scoped.
    // A JS/SQL comment cannot appear inside a template literal's
    // interpolated runtime value the way it can in raw source text, so this
    // assertion is structurally immune to doc-comment satisfaction.
    state.blockedSignalIds = ['signal-blocked'];
    const { prepareCompaniesJob } = await import('../modules/outreach/prepareCompanies');
    await prepareCompaniesJob('tenant-1');

    expect(capturedSignalQuery).toContain('p.tenant_id = s.tenant_id');
    expect(capturedSignalQuery).toContain('p.company_id = s.company_id');
  });
});
