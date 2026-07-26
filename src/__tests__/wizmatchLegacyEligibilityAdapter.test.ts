// PRD-005 §11.3 / §5.2 C-2, ADR-006 D-13 — PR 5 contract tests.
//
// Proves the migrated legacy callers agree with the canonical resolver
// (`resolveCompanyStatus` / `evaluateWizmatchOutreachGate`,
// src/modules/outreach/outreachGate.ts) rather than merely calling it: for
// the SAME canonical decision, every migrated caller's output must encode
// the same fact. Reuses the drizzle `db.select().from().where()` mock idiom
// from wizmatchOutreachGateContract.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  contactRows: [] as any[],
  suppressionRows: [] as any[],
  enrolmentRows: [] as any[],
  companyRows: [] as any[],
  duplicateRows: [] as any[],
}));

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === actualSchema.wizmatchCompanyPolicies) return Promise.resolve(state.policyRows);
            if (table === actualSchema.contacts) return Promise.resolve(state.contactRows);
            if (table === actualSchema.wizmatchSuppressionList) return Promise.resolve(state.suppressionRows);
            if (table === actualSchema.wizmatchOutreachEnrolments) return Promise.resolve(state.enrolmentRows);
            if (table === actualSchema.wizmatchCompanies) return Promise.resolve(state.companyRows);
            if (table === actualSchema.wizmatchCompanyDuplicates) return Promise.resolve(state.duplicateRows);
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
});

import { resolveCompanyStatus } from '../modules/outreach/outreachGate';
import {
  resolveCanonicalCompanyEligibility,
  applyCanonicalEligibilityToContactIntelligence,
} from '../modules/outreach/legacyEligibilityAdapter';
import {
  scoreClientDiscoveryOpportunityWithPolicy,
  type ClientDiscoveryInput,
} from '../services/wizmatchClientDiscovery';
import {
  scoreRequirementPriorityWithPolicy,
  type RequirementPriorityInput,
} from '../services/wizmatchRequirementPriority';
import { qualifyCompanyForContactIntelligence } from '../services/wizmatchContactIntelligence';

function rootPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-root-1',
    companyId: 'company-1',
    scopeType: 'entire_company',
    scopeKey: 'entire_company',
    outreachEligibility: 'eligible',
    externalHiringPolicy: 'accepts_external_vendors',
    relationshipType: 'new_prospect',
    reasonCode: 'policy_accepts_external_vendors',
    blockClass: 'standard',
    isNonOverridable: false,
    isPermanent: false,
    evidenceKind: 'human_text',
    evidenceText: 'test',
    evidenceUrl: null,
    evidenceRef: null,
    source: 'human',
    actorUserId: null,
    supersededAt: null,
    ...overrides,
  };
}

const TENANT_ID = 'tenant-1';
const COMPANY_ID = 'company-1';

const clientDiscoveryInput: ClientDiscoveryInput = {
  id: 'signal-1',
  jobTitle: 'Senior Java Developer',
  companyId: COMPANY_ID,
  companyName: 'Bengaluru Systems',
  companyIndustry: 'IT staffing',
  location: 'Bangalore, India',
  signalScore: 9,
  matchedCandidateCount: 4,
};

const requirementPriorityInput: RequirementPriorityInput = {
  id: 'req-1',
  title: 'Java Backend Developer',
  companyId: COMPANY_ID,
  companyName: 'Bengaluru Systems',
  requiredSkills: ['java', 'spring'],
  region: 'india',
  priority: 'urgent',
  status: 'sheet_ready',
};

function contactIntelligenceResult() {
  return qualifyCompanyForContactIntelligence({
    company: { id: COMPANY_ID, name: 'Bengaluru Systems', domain: 'bengaluru.example' },
    signal: { jobTitle: 'Senior Java Developer', keywords: ['java'], score: 9, daysOpen: 8 },
    candidateSupply: { matchedCandidateCount: 3 },
    relationships: { knownContactCount: 1 },
    safety: { domainStatus: 'healthy' },
    internalContacts: [],
  });
}

beforeEach(() => {
  state.policyRows = [rootPolicy()];
  state.contactRows = [];
  state.suppressionRows = [];
  state.enrolmentRows = [];
  state.companyRows = [];
  state.duplicateRows = [];
});

describe('canonical resolver agreement — missing root policy (L0 deny)', () => {
  beforeEach(() => {
    state.policyRows = [];
  });

  it('resolveCompanyStatus denies with policy_missing_root', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('deny');
    expect(status.reasonCode).toBe('policy_missing_root');
  });

  it('client discovery agrees: forces blocked with a policy_ blocker', async () => {
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_policy_missing_root');
  });

  it('requirement priority agrees: forces blocked with a policy_ blocker', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_policy_missing_root');
  });

  it('contact intelligence agrees: forces discovery_blocked with a policy_ hard block', async () => {
    const canonical = await resolveCanonicalCompanyEligibility(TENANT_ID, COMPANY_ID);
    const result = applyCanonicalEligibilityToContactIntelligence(contactIntelligenceResult(), canonical);
    expect(result.companyStatus).toBe('discovery_blocked');
    expect(result.hardBlocks).toContain('policy_policy_missing_root');
  });
});

describe('canonical resolver agreement — non-overridable entire-company block (L1 deny)', () => {
  beforeEach(() => {
    state.policyRows = [rootPolicy({
      outreachEligibility: 'blocked',
      isNonOverridable: true,
      blockClass: 'compliance',
      reasonCode: 'company_removal_request',
    })];
  });

  it('resolveCompanyStatus denies with the company-removal reason code', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('deny');
    expect(status.reasonCode).toBe('company_removal_request');
  });

  it('client discovery agrees even though local scoring would allow', async () => {
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_company_removal_request');
  });

  it('requirement priority agrees even though local scoring would allow', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('policy_company_removal_request');
  });

  it('contact intelligence agrees even though local scoring would allow', async () => {
    const canonical = await resolveCanonicalCompanyEligibility(TENANT_ID, COMPANY_ID);
    const result = applyCanonicalEligibilityToContactIntelligence(contactIntelligenceResult(), canonical);
    expect(result.companyStatus).toBe('discovery_blocked');
    expect(result.hardBlocks).toContain('policy_company_removal_request');
  });
});

describe('canonical resolver agreement — needs_review (REVIEW) never lets local scoring promote past watch', () => {
  beforeEach(() => {
    state.policyRows = [rootPolicy({ outreachEligibility: 'needs_review' })];
  });

  it('resolveCompanyStatus returns review', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('review');
  });

  it('client discovery caps a locally-hot result to watch', async () => {
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, clientDiscoveryInput);
    expect(['hot', 'warm']).not.toContain(result.priority);
  });

  it('requirement priority caps a locally-hot result to watch', async () => {
    const result = await scoreRequirementPriorityWithPolicy(TENANT_ID, requirementPriorityInput);
    expect(['hot', 'warm']).not.toContain(result.priority);
  });

  it('contact intelligence downgrades a ready_for_discovery status to needs_review', () => {
    const canonical: Awaited<ReturnType<typeof resolveCanonicalCompanyEligibility>> = {
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      decision: 'review',
      reasonCode: 'policy_review_required',
      blockerCode: null,
    };
    const result = applyCanonicalEligibilityToContactIntelligence(
      { ...contactIntelligenceResult(), companyStatus: 'ready_for_discovery', hardBlocks: [] },
      canonical,
    );
    expect(result.companyStatus).toBe('needs_review');
  });
});

describe('canonical resolver agreement — allow never overrides a local hard block', () => {
  it('a canonical allow does not clear the client-discovery non_tech_signal blocker', async () => {
    const status = await resolveCompanyStatus(TENANT_ID, COMPANY_ID);
    expect(status.decision).toBe('allow');
    const result = await scoreClientDiscoveryOpportunityWithPolicy(TENANT_ID, {
      ...clientDiscoveryInput,
      jobTitle: 'Payroll Executive',
      companyIndustry: 'HRMS payroll attendance',
    });
    expect(result.priority).toBe('blocked');
    expect(result.blockers).toContain('non_tech_signal');
    expect(result.blockers).not.toContain('policy_policy_accepts_external_vendors');
  });
});
