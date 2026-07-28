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

// P8B-1 (owner-ratified) — PRD-005 §8.2 L4. A `specific_signal` /
// `specific_requirement` block denies THAT signal or requirement only, at its
// own level, carrying its own real provenance. It is not an L1c company-scope
// freeze, and it is not the provenance-less deny the old `denyDecision(...)`
// path produced (isNonOverridable: false, blockClass: null, evidence: null).
describe('evaluateWizmatchOutreachGate — L4 signal/requirement restriction', () => {
  const SIGNAL_ID = '11111111-1111-4111-8111-111111111111';
  const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';

  function scopedBlockRow(overrides: Record<string, unknown> = {}) {
    return rootPolicyRow({
      id: 'policy-signal-1',
      scopeType: 'specific_signal',
      scopeKey: `specific_signal:${SIGNAL_ID}`,
      outreachEligibility: 'blocked',
      externalHiringPolicy: null,
      relationshipType: null,
      reasonCode: null,
      blockClass: 'legal',
      isNonOverridable: true,
      evidenceKind: 'legal_notice',
      evidenceText: 'Counsel instruction: this requisition is off-limits.',
      source: 'human',
      actorUserId: 'user-legal-1',
      ...overrides,
    });
  }

  it('carries the blocking row\'s real isNonOverridable/blockClass/evidence, not hardcoded nulls', async () => {
    state.policyRows = [rootPolicyRow(), scopedBlockRow()];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      signalId: SIGNAL_ID,
    });

    expect(decision.decision).toBe('deny');
    expect(decision.effectiveLevel).toBe(4);
    expect(decision.reasonCodes).toContain('signal_role_irrelevant');
    expect(decision.isNonOverridable).toBe(true);
    expect(decision.blockClass).toBe('legal');
    expect(decision.evidence).toMatchObject({
      kind: 'legal_notice',
      text: 'Counsel instruction: this requisition is off-limits.',
      source: 'human',
      actorUserId: 'user-legal-1',
    });
    // Provenance names the signal scope, not the company root.
    expect(decision.effective.outreachEligibility?.scopeKey).toBe(`specific_signal:${SIGNAL_ID}`);
  });

  it('reports the row\'s own reason code when it has one', async () => {
    state.policyRows = [rootPolicyRow(), scopedBlockRow({ reasonCode: 'company_removal_request' })];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      signalId: SIGNAL_ID,
    });
    expect(decision.effectiveLevel).toBe(4);
    expect(decision.reasonCodes).toEqual(['company_removal_request']);
  });

  it('applies to a requirement-scoped block the same way', async () => {
    state.policyRows = [
      rootPolicyRow(),
      scopedBlockRow({
        id: 'policy-req-1',
        scopeType: 'specific_requirement',
        scopeKey: `specific_requirement:${REQUIREMENT_ID}`,
      }),
    ];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      requirementId: REQUIREMENT_ID,
    });
    expect(decision.decision).toBe('deny');
    expect(decision.effectiveLevel).toBe(4);
    expect(decision.isNonOverridable).toBe(true);
  });

  // The company itself is untouched: an evaluation that does NOT name the
  // blocked signal still resolves normally. This is the whole point of L4.
  it('never denies the company when the request does not name the blocked signal', async () => {
    state.policyRows = [rootPolicyRow(), scopedBlockRow()];
    const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(decision.decision).toBe('allow');
    expect(decision.isNonOverridable).toBe(false);
  });

  // CONTROL — a region-scoped non-overridable block is still L1c, and is still
  // a company-scope freeze regardless of which signal the request names.
  it('still denies at L1c for a region-scoped non-overridable block', async () => {
    state.policyRows = [
      rootPolicyRow(),
      scopedBlockRow({ id: 'policy-region-1', scopeType: 'region', scopeKey: 'region:india' }),
    ];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      region: 'india',
    });
    expect(decision.decision).toBe('deny');
    expect(decision.effectiveLevel).toBe(1);
    expect(decision.isNonOverridable).toBe(true);
  });
});

// H-4 (code review, revoked-PR-8B remediation) — the L1c scan at
// outreachGate.ts ~line 476 must scan `effective.allActiveRows`, not
// `effective.applicableRows`. `applicableRows` is filtered to only the rows
// matching THIS request's resolved scope-key candidates
// (policyResolver.buildCandidateScopeKeys), so a non-overridable block that
// exists but does not match the request's own resolved scope was silently
// invisible to the old scan — a fail-OPEN. `decisionWorkbenchActions.ts`
// never had this bug (it always scanned `allActiveRows`); this proves
// `outreachGate.ts` now matches it, at the exact call site, not only via a
// DB-layer CHECK constraint.
describe('evaluateWizmatchOutreachGate — H-4 fail-closed on non-applicable non-overridable block', () => {
  it('denies at L1c even when the block\'s scope does not match this request\'s resolved context', async () => {
    // Non-overridable region:india block exists, but THIS request resolves
    // region:us — buildCandidateScopeKeys would never include 'region:india'
    // in its candidate list, so `applicableRows` never contains this row.
    // `allActiveRows` always does. The old code (scanning `applicableRows`)
    // fell through this row entirely and reached a terminal `allow` at L8;
    // the fixed code (scanning `allActiveRows`) must still deny at L1c.
    state.policyRows = [
      rootPolicyRow(),
      rootPolicyRow({
        id: 'policy-region-india-1',
        scopeType: 'region',
        scopeKey: 'region:india',
        outreachEligibility: 'blocked',
        externalHiringPolicy: null,
        relationshipType: null,
        reasonCode: 'company_removal_request',
        blockClass: 'compliance',
        isNonOverridable: true,
        isPermanent: true,
        evidenceKind: 'human_text',
        evidenceText: 'Legal instructed removal for the India entity.',
      }),
    ];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      region: 'us', // deliberately NOT 'india' — resolved, but non-matching
    });
    expect(decision.decision).toBe('deny');
    expect(decision.effectiveLevel).toBe(1);
    expect(decision.isNonOverridable).toBe(true);
    expect(decision.reasonCodes).toContain('company_removal_request');
  });

  // CONTROL — an OVERRIDABLE narrower block that does not match the request's
  // resolved scope must NOT be swept in by this fix; only non-overridable
  // company-or-scope-freezing rows are in scope for L1c.
  it('does not deny at L1c for a non-matching, merely-overridable narrower block', async () => {
    state.policyRows = [
      rootPolicyRow(),
      rootPolicyRow({
        id: 'policy-region-india-2',
        scopeType: 'region',
        scopeKey: 'region:india',
        outreachEligibility: 'blocked',
        externalHiringPolicy: null,
        relationshipType: null,
        reasonCode: 'manual_block_by_operator',
        blockClass: 'standard',
        isNonOverridable: false,
        isPermanent: false,
      }),
    ];
    const decision = await evaluateWizmatchOutreachGate({
      tenantId: TENANT,
      action: 'enrol',
      companyId: COMPANY,
      region: 'us',
    });
    expect(decision.decision).toBe('allow');
  });
});
