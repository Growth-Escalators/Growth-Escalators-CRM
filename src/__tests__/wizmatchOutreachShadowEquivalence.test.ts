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

/**
 * Every fixture pins the decision it is supposed to produce (`expect`), not only
 * that the two modes agree. Parity alone is vacuous: a regression that made the
 * ladder return the same WRONG answer in both modes — e.g. an early
 * `return allowDecision` inserted above L0 — would satisfy a parity-only
 * assertion in every fixture while destroying the gate.
 *
 * Coverage spans the whole ladder rather than only its ends, because §16 rule 1
 * is specifically "shadow evaluates the FULL L0-L8 ladder and never
 * short-circuits": a mode-conditional skip planted at L1b, L1c, L3, L5 or L6b is
 * only detectable by a fixture that actually reaches that rung.
 */
const FIXTURES: Array<{
  name: string;
  ctx: OutreachGateContext;
  setup: () => void;
  expect: { decision: 'allow' | 'review' | 'deny'; effectiveLevel: number; reasonCode?: string };
}> = [
  {
    name: 'L0 missing root',
    ctx: { tenantId: TENANT, action: 'enrol', companyId: COMPANY },
    setup: () => { state.policyRows = []; },
    expect: { decision: 'deny', effectiveLevel: 0, reasonCode: 'policy_missing_root' },
  },
  {
    name: 'L1 non-overridable block',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow({ outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance', isPermanent: true, reasonCode: 'company_removal_request' })];
    },
    expect: { decision: 'deny', effectiveLevel: 1, reasonCode: 'company_removal_request' },
  },
  {
    name: 'L1b relationship hard exclusion (competitor)',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => { state.policyRows = [rootPolicyRow({ relationshipType: 'competitor' })]; },
    expect: { decision: 'deny', effectiveLevel: 1, reasonCode: 'relationship_competitor' },
  },
  {
    name: 'L2 overridable block',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow({ outreachEligibility: 'blocked', reasonCode: 'manual_block_by_operator' })];
    },
    expect: { decision: 'deny', effectiveLevel: 2, reasonCode: 'manual_block_by_operator' },
  },
  {
    name: 'L5 paused by owner',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => { state.policyRows = [rootPolicyRow({ outreachEligibility: 'paused' })]; },
    expect: { decision: 'deny', effectiveLevel: 5, reasonCode: 'policy_paused_by_owner' },
  },
  {
    name: 'L6b company cold-email lock',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow()];
      state.enrolmentRows = [{ id: 'enrol-1' }];
    },
    expect: { decision: 'deny', effectiveLevel: 6, reasonCode: 'company_cold_email_lock' },
  },
  {
    name: 'L7 suppression union deny',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, contactId: 'contact-1', email: 'x@example.com', outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow()];
      state.suppressionRows = [{ reason: 'hard_bounce' }];
    },
    expect: { decision: 'deny', effectiveLevel: 7, reasonCode: 'email_hard_bounce' },
  },
  {
    name: 'L7 suppression union deny via contacts.do_not_contact grain',
    ctx: { tenantId: TENANT, action: 'send', companyId: COMPANY, contactId: 'contact-1', outreachMode: 'cold_email' },
    setup: () => {
      state.policyRows = [rootPolicyRow()];
      state.contactRows = [{ doNotContact: true }];
    },
    expect: { decision: 'deny', effectiveLevel: 7, reasonCode: 'email_unsubscribed' },
  },
  {
    name: 'allow',
    ctx: { tenantId: TENANT, action: 'enrol', companyId: COMPANY },
    setup: () => { state.policyRows = [rootPolicyRow()]; },
    expect: { decision: 'allow', effectiveLevel: 8 },
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

      // Anti-vacuity: parity is worthless unless each fixture genuinely reached
      // the rung it names. Without these, a change that collapsed every fixture
      // to the same decision would keep the whole suite green.
      expect(shadowDecision.decision).toBe(fixture.expect.decision);
      expect(shadowDecision.effectiveLevel).toBe(fixture.expect.effectiveLevel);
      if (fixture.expect.reasonCode) {
        expect(shadowDecision.reasonCodes).toContain(fixture.expect.reasonCode);
      }
    });
  }

  it('the fixture set genuinely spans distinct ladder rungs (anti-vacuity guard on the harness itself)', () => {
    const levels = new Set(FIXTURES.map((f) => f.expect.effectiveLevel));
    // L0, L1, L2, L5, L6, L7, L8 — if a future edit narrows the fixture set,
    // this fails rather than silently shrinking the ladder under test.
    expect(levels.size).toBeGreaterThanOrEqual(7);
    expect(FIXTURES.some((f) => f.expect.decision === 'allow')).toBe(true);
    expect(FIXTURES.filter((f) => f.expect.decision === 'deny').length).toBeGreaterThanOrEqual(7);
  });

  // §16 rule 3: "Any value other than the exact string `enforce` is treated as
  // `shadow` — unset, misspelled, empty, mixed-case. Fail safe, not fail open."
  // Pinned explicitly, because adding a `.trim()` or `.toLowerCase()` to
  // readEnforcementMode() would silently promote these to enforce and no other
  // test in the repo would notice.
  for (const nearMiss of ['ENFORCE', 'Enforce', 'enforce ', ' enforce', 'enforced', 'true', '1', '']) {
    it(`§16 rule 3 — WIZMATCH_POLICY_ENFORCEMENT_MODE=${JSON.stringify(nearMiss)} is treated as shadow and blocks nothing`, async () => {
      state.policyRows = [];
      process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = nearMiss;
      const decision = await evaluateWizmatchOutreachGate({ tenantId: TENANT, action: 'send', companyId: COMPANY });
      expect(decision.enforcementMode).toBe('shadow');
      expect(decision.decision).toBe('deny');
      // The would-block must NOT block: assert resolves rather than throwing.
      await expect(
        assertWizmatchOutreachAllowed({ tenantId: TENANT, action: 'send', companyId: COMPANY }),
      ).resolves.toMatchObject({ decision: 'deny' });
      delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
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
