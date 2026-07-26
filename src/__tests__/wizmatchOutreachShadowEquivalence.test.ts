import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PRD-005 §22.3 #10 — the shadow-vs-enforce equivalence harness. §16 rule 1
// requires shadow to evaluate the FULL L0-L8 ladder on every call, identically
// to enforce, and differ only in whether a would-block decision actually
// blocks (shouldBlock / assertWizmatchOutreachAllowed throwing). This harness
// makes that mechanically checkable: for a fixed fixture set, the decision
// returned by evaluateWizmatchOutreachGate must be byte-identical between the
// two modes except for the `enforcementMode` field itself. If a future change
// makes shadow short-circuit or diverge in its reasoning, this test catches it
// without needing a live readiness report.

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

import { evaluateWizmatchOutreachGate, assertWizmatchOutreachAllowed, OutreachBlockedError } from '../modules/outreach/outreachGate';
import type { OutreachGateContext } from '../modules/outreach/outreachGate';

const TENANT = 'tenant-1';
const COMPANY = 'company-1';

function rootPolicyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'policy-root-1',
    companyId: COMPANY,
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

const FIXTURES: Array<{ name: string; ctx: OutreachGateContext; setup: () => void }> = [
  {
    name: 'L0 missing root',
    ctx: { tenantId: TENANT, action: 'enrol', companyId: COMPANY },
    setup: () => { state.policyRows = []; },
  },
  {
    name: 'L1 non-overridable block',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow({ outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance', isPermanent: true, reasonCode: 'company_removal_request' })];
    },
  },
  {
    name: 'L2 overridable block',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow({ outreachEligibility: 'blocked', reasonCode: 'manual_block_by_operator' })];
    },
  },
  {
    name: 'L7 suppression union deny',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, contactId: 'contact-1', email: 'x@example.com', outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow()];
      state.suppressionRows = [{ reason: 'hard_bounce' }];
    },
  },
  {
    name: 'allow',
    ctx: { tenantId: TENANT, action: 'enrol', companyId: COMPANY },
    setup: () => { state.policyRows = [rootPolicyRow()]; },
  },
];

beforeEach(() => {
  state.policyRows = [];
  state.contactRows = [];
  state.suppressionRows = [];
  state.enrolmentRows = [];
});

describe('shadow-vs-enforce equivalence harness (§22.3 #10)', () => {
  for (const fixture of FIXTURES) {
    it(`"${fixture.name}" — shadow and enforce produce the identical decision, differing only in enforcementMode`, async () => {
      fixture.setup();
      delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
      const shadowDecision = await evaluateWizmatchOutreachGate(fixture.ctx);

      fixture.setup();
      process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
      const enforceDecision = await evaluateWizmatchOutreachGate(fixture.ctx);
      delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;

      const { enforcementMode: _shadowMode, ...shadowRest } = shadowDecision;
      const { enforcementMode: _enforceMode, ...enforceRest } = enforceDecision;
      expect(shadowRest).toEqual(enforceRest);
      expect(shadowDecision.enforcementMode).toBe('shadow');
      expect(enforceDecision.enforcementMode).toBe('enforce');
    });
  }

  it('only enforce mode actually blocks via assertWizmatchOutreachAllowed — shadow resolves instead of throwing', async () => {
    state.policyRows = [];
    delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
    const shadowResult = await assertWizmatchOutreachAllowed({ tenantId: TENANT, action: 'enrol', companyId: COMPANY });
    expect(shadowResult.decision).toBe('deny');

    state.policyRows = [];
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
    await expect(
      assertWizmatchOutreachAllowed({ tenantId: TENANT, action: 'enrol', companyId: COMPANY }),
    ).rejects.toBeInstanceOf(OutreachBlockedError);
    delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
  });

  afterEach(() => {
    delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
  });
});
