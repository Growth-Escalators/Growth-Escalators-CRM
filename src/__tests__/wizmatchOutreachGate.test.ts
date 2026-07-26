import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Controllable in-memory fixtures for the mocked `db` query chain. Declared
// via vi.hoisted so the vi.mock factory below (hoisted above imports by
// vitest) can close over the same mutable object the tests adjust per-case.
const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  contactRows: [] as any[],
  suppressionRows: [] as any[],
  enrolmentRows: [] as any[],
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
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
});

// vitest hoists vi.mock() above this static import, so the module under test
// picks up the mocked '../db'.
import {
  evaluateWizmatchOutreachGate,
  assertWizmatchOutreachAllowed,
  resolveCompanyStatus,
  OutreachBlockedError,
} from '../modules/outreach/outreachGate';

function rootPolicyRow(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  };
}

const TENANT = 'tenant-1';
const COMPANY = 'company-1';

beforeEach(() => {
  state.policyRows = [];
  state.contactRows = [];
  state.suppressionRows = [];
  state.enrolmentRows = [];
});

describe('evaluateWizmatchOutreachGate — L0 missing root (C-2 regression)', () => {
  it('denies with policy_missing_root when no active entire_company row exists', async () => {
    state.policyRows = [];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('policy_missing_root');
    expect(decision.effectiveLevel).toBe(0);
    expect(decision.effective.outreachEligibility).toBeNull();
  });

  it('never falls back to a legacy status when the root row is missing (compatibility adapter)', async () => {
    state.policyRows = [];
    const result = await resolveCompanyStatus(TENANT, COMPANY);
    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('policy_missing_root');
  });
});

describe('evaluateWizmatchOutreachGate — L1 non-overridable company-wide block', () => {
  it('denies a company_removal_request block regardless of a narrower eligible row', async () => {
    state.policyRows = [
      rootPolicyRow({
        outreachEligibility: 'blocked',
        isNonOverridable: true,
        blockClass: 'compliance',
        isPermanent: true,
        reasonCode: 'company_removal_request',
      }),
    ];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('company_removal_request');
    expect(decision.isNonOverridable).toBe(true);
    expect(decision.blockClass).toBe('compliance');
    expect(decision.effectiveLevel).toBe(1);
    // company_removal_request stops preparation (§9.2, §8.9)
    expect(decision.preparationAllowed).toBe(false);
  });

  it('allows preparation for an ordinary hiring-policy allow decision', async () => {
    state.policyRows = [rootPolicyRow()];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('allow');
    expect(decision.preparationAllowed).toBe(true);
  });
});

describe('evaluateWizmatchOutreachGate — L1b relationship hard exclusion', () => {
  it('denies a competitor company', async () => {
    state.policyRows = [rootPolicyRow({ relationshipType: 'competitor' })];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('relationship_competitor');
  });

  it('denies an irrelevant company and stops preparation', async () => {
    state.policyRows = [rootPolicyRow({ relationshipType: 'irrelevant' })];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('relationship_irrelevant');
    expect(decision.preparationAllowed).toBe(false);
  });
});

describe('evaluateWizmatchOutreachGate — scoped inheritance (§8.1)', () => {
  it('a location pause leaves the company-wide relationship and hiring policy unchanged', async () => {
    state.policyRows = [
      rootPolicyRow({ relationshipType: 'existing_client' }),
      {
        id: 'policy-location-1',
        companyId: COMPANY,
        scopeType: 'location',
        scopeKey: 'location:bengaluru',
        outreachEligibility: 'paused',
        externalHiringPolicy: null,
        relationshipType: null,
        reasonCode: 'policy_paused_by_owner',
        blockClass: 'standard',
        isNonOverridable: false,
        isPermanent: false,
        evidenceKind: null,
        evidenceText: null,
        evidenceUrl: null,
        evidenceRef: null,
        source: 'human',
        actorUserId: null,
      },
    ];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      location: 'Bengaluru',
    });
    // existing_client routes to account_owner and denies cold outreach —
    // the important assertion is that inheritance supplied the location
    // pause for eligibility while relationshipType still resolved from root.
    expect(decision.effective.outreachEligibility?.scopeKey).toBe('location:bengaluru');
    expect(decision.effective.relationshipType?.value).toBe('existing_client');
    expect(decision.effective.relationshipType?.scopeKey).toBe('entire_company');
  });

  it('fails closed with scope_unresolvable when a location row exists but no location is in context (H-4)', async () => {
    state.policyRows = [
      rootPolicyRow(),
      {
        id: 'policy-location-2',
        companyId: COMPANY,
        scopeType: 'location',
        scopeKey: 'location:bengaluru',
        outreachEligibility: 'paused',
        externalHiringPolicy: null,
        relationshipType: null,
        reasonCode: 'policy_paused_by_owner',
        blockClass: 'standard',
        isNonOverridable: false,
        isPermanent: false,
        evidenceKind: null,
        evidenceText: null,
        evidenceUrl: null,
        evidenceRef: null,
        source: 'human',
        actorUserId: null,
      },
    ];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('scope_unresolvable');
  });
});

describe('evaluateWizmatchOutreachGate — L6 campaign compatibility', () => {
  it('msp_vms_only yields only msp_vms and never a fake staffing type', async () => {
    state.policyRows = [rootPolicyRow({ externalHiringPolicy: 'msp_vms_only' })];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      campaignType: 'contract',
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('campaign_type_not_permitted');
  });

  it('preferred_vendors_only permits only vendor_empanelment and is a review decision', async () => {
    state.policyRows = [rootPolicyRow({ externalHiringPolicy: 'preferred_vendors_only' })];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('review');
    expect(decision.allowedCampaignTypes).toEqual(['vendor_empanelment']);
  });
});

describe('evaluateWizmatchOutreachGate — L6b company cold-email lock (D-6)', () => {
  it('denies a second cold-email enrolment while a reply is live', async () => {
    state.policyRows = [rootPolicyRow()];
    state.enrolmentRows = [{ id: 'enrolment-1' }];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      outreachMode: 'cold_email',
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('company_cold_email_lock');
  });
});

describe('evaluateWizmatchOutreachGate — L7 suppression union (A-1 regression)', () => {
  it('denies when the exact email is on the suppression list', async () => {
    state.policyRows = [rootPolicyRow()];
    state.suppressionRows = [{ id: 'sup-1' }];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'send',
      companyId: COMPANY,
      email: 'Someone@Example.com',
    });
    expect(decision.decision).toBe('deny');
  });

  it('denies when the contact is marked do_not_contact via the generic CRM path', async () => {
    state.policyRows = [rootPolicyRow()];
    state.contactRows = [{ doNotContact: true }];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'send',
      companyId: COMPANY,
      contactId: 'contact-1',
    });
    expect(decision.decision).toBe('deny');
  });
});

describe('assertWizmatchOutreachAllowed', () => {
  const prevMode = process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
  afterEach(() => {
    if (prevMode === undefined) delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
    else process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = prevMode;
  });

  it('throws OutreachBlockedError carrying the PolicyDecision on deny when enforcementMode=enforce', async () => {
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
    state.policyRows = [];
    await expect(
      assertWizmatchOutreachAllowed({ tenantId: TENANT, action: 'enrol', companyId: COMPANY }),
    ).rejects.toBeInstanceOf(OutreachBlockedError);
  });

  it('does NOT throw on deny in shadow mode (§16 rule 1-2) — resolves with the deny decision instead', async () => {
    delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
    state.policyRows = [];
    const decision = await assertWizmatchOutreachAllowed({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('deny');
    expect(decision.enforcementMode).toBe('shadow');
  });

  it('resolves with the decision on allow', async () => {
    state.policyRows = [rootPolicyRow()];
    const decision = await assertWizmatchOutreachAllowed({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('allow');
  });
});

describe('evaluateWizmatchOutreachGate — fail-closed on error', () => {
  it('denies with policy_resolver_error when no companyId is supplied', async () => {
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol' });
    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toContain('policy_resolver_error');
  });
});
