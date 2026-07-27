// PRD-005 PR 6 §13 — buildTodayQueues bucketing logic.
//
// This suite mocks `resolveCanonicalCompanyEligibilityBatch`
// (`legacyEligibilityAdapter.ts`) directly, the same way `wizmatchCommandCenter.test.ts`
// does — the canonical resolver has its own dedicated tests
// (wizmatchOutreachGate*.test.ts); this file proves ONLY that
// buildTodayQueues buckets correctly given a canonical decision, folds in
// duplicate-pending/contact-confidence context correctly, and never lets one
// malformed row crash the whole response.
//
// DB access is mocked keyed on table identity (real schema Table objects via
// importOriginal, matching contactService.test.ts's idiom) — this suite does
// not re-verify tenant-predicate correctness of the underlying SQL (that is
// a straightforward `eq(table.tenantId, tenantId)` on every query, matching
// every other file in this module; see the source-level guard test below).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const eligibilityByCompany = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('../modules/outreach/legacyEligibilityAdapter', () => ({
  resolveCanonicalCompanyEligibilityBatch: async (tenantId: string, companyIds: Array<string | null | undefined>) => {
    const map = new Map();
    for (const id of new Set(companyIds.filter((x): x is string => !!x))) {
      map.set(id, eligibilityByCompany.get(id) ?? { tenantId, companyId: id, decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });
    }
    return map;
  },
}));

const fixtures = vi.hoisted(() => ({
  companyRows: [] as unknown[],
  duplicateRows: [] as unknown[],
  contactRows: [] as unknown[],
  enrolmentRows: [] as unknown[],
  // PR 8A hardening (task 3) — `fetchNarrowerNonOverridableBlockByCompany`
  // queries `wizmatchCompanyPolicies` a SECOND time with a DIFFERENT
  // projection (companyId/scopeKey/blockClass only) and different WHERE
  // conditions (blocked + non-overridable + not entire_company). A mock that
  // returned `companyRows` verbatim for this query too would falsely detect
  // a narrower non-overridable block on every fixture (mock vacuity — the
  // exact defect class flagged repeatedly in this project's PR reviews).
  // Empty by default; a test opts in explicitly.
  narrowerNonOverridableRows: [] as unknown[],
}));

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown) => resolve(rows),
  };
  return chain;
}

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return {
    ...actual,
    db: {
      // Captures the select projection so the two different queries against
      // `wizmatchCompanyPolicies` can be told apart by shape, rather than
      // both returning the same fixture array regardless of which ran.
      select: (projection: Record<string, unknown> = {}) => ({
        from: (table: unknown) => {
          if (table === actual.wizmatchCompanyPolicies) {
            return 'policyId' in projection
              ? makeChain(fixtures.companyRows)
              : makeChain(fixtures.narrowerNonOverridableRows);
          }
          if (table === actual.wizmatchCompanyDuplicates) return makeChain(fixtures.duplicateRows);
          if (table === actual.wizmatchContactCandidates) return makeChain(fixtures.contactRows);
          if (table === actual.wizmatchOutreachEnrolments) return makeChain(fixtures.enrolmentRows);
          return makeChain([]);
        },
      }),
    },
  };
});

import { buildTodayQueues, REPLY_NEEDS_ACTION_STATES } from '../modules/outreach/decisionWorkbench';

function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1',
    companyName: 'Acme Staffing',
    companyDomain: 'acme.example',
    accountOwnerUserId: null,
    policyId: 'policy-1',
    outreachEligibility: 'needs_review',
    externalHiringPolicy: 'unknown',
    relationshipType: 'new_prospect',
    blockClass: 'standard',
    isNonOverridable: false,
    reviewDate: null,
    policyReasonCode: 'policy_unknown_cold_start',
    policyScopeKey: 'entire_company',
    ...overrides,
  };
}

beforeEach(() => {
  eligibilityByCompany.clear();
  fixtures.companyRows = [];
  fixtures.duplicateRows = [];
  fixtures.contactRows = [];
  fixtures.enrolmentRows = [];
  fixtures.narrowerNonOverridableRows = [];
});

describe('buildTodayQueues — bucket assignment', () => {
  it('places an allow decision with a high-confidence contact in Ready to Contact', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'ready-1', outreachEligibility: 'eligible' })];
    fixtures.contactRows = [{ companyId: 'ready-1', confidenceScore: 9, metadata: {} }];
    eligibilityByCompany.set('ready-1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(1);
    expect(queues.readyToContact[0].companyId).toBe('ready-1');
    expect(queues.needsReview).toHaveLength(0);
    expect(queues.pausedOrBlocked).toHaveLength(0);
  });

  it('places an allow decision with only a low-confidence (or no) contact in Needs Review, never dropped', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'low-conf-1', outreachEligibility: 'eligible' })];
    // No contact rows at all — contactConfidenceTier is null.
    eligibilityByCompany.set('low-conf-1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].companyId).toBe('low-conf-1');
  });

  it('places a review decision in Needs Review regardless of contact confidence', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'review-1' })];
    fixtures.contactRows = [{ companyId: 'review-1', confidenceScore: 9, metadata: {} }];
    eligibilityByCompany.set('review-1', { decision: 'review', reasonCode: 'policy_unknown_cold_start', blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].requiresExplicitApproval).toBe(true);
  });

  it('places a deny decision in Paused or Blocked and carries isNonOverridable through', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'blocked-1', outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance' })];
    eligibilityByCompany.set('blocked-1', { decision: 'deny', reasonCode: 'company_removal_request', blockerCode: 'policy_company_removal_request', enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].isNonOverridable).toBe(true);
    expect(queues.pausedOrBlocked[0].disabledReason).toMatch(/non-overridable/i);
  });

  // PRD-005 §16 rule 2 + gate G3 + ADR-006 D-31. The gate ladder denies well
  // past the stored policy row (L5 duplicate, L6b company cold-email lock, L7
  // suppression), so a company can be `outreach_eligibility = 'eligible'` and
  // canonically DENIED at the same time. In shadow that must change nothing:
  // no hidden work item, no disabled action. Only `enforce` may act.
  const eligibleRow = { companyId: 'shadow-1', outreachEligibility: 'eligible' };
  const highConfidenceContact = { companyId: 'shadow-1', confidenceScore: 9, metadata: {} };
  const canonicalDeny = (actsOnDecision: boolean, enforcementMode: string) => ({
    decision: 'deny', reasonCode: 'company_cold_email_lock', blockerCode: 'policy_company_cold_email_lock',
    enforcementMode, actsOnDecision,
  });

  it('SHADOW: a canonically-denied but policy-eligible company stays in Ready to Contact, undisabled', async () => {
    fixtures.companyRows = [companyRow(eligibleRow)];
    fixtures.contactRows = [highConfidenceContact];
    eligibilityByCompany.set('shadow-1', canonicalDeny(false, 'shadow'));

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(0);
    expect(queues.readyToContact).toHaveLength(1);
    const item = queues.readyToContact[0];
    // Behavioural output follows the stored policy row...
    expect(item.effectiveDecision).toBe('allow');
    expect(item.disabledReason).toBeNull();
    expect(item.requiresExplicitApproval).toBe(false);
    // ...while the canonical decision is still disclosed for display (D-31).
    expect(item.canonicalDecision).toBe('deny');
    expect(item.canonicalBlockerCode).toBe('policy_company_cold_email_lock');
  });

  it('SHADOW: a canonical review never adds an approval requirement to a policy-eligible company', async () => {
    fixtures.companyRows = [companyRow(eligibleRow)];
    fixtures.contactRows = [highConfidenceContact];
    eligibilityByCompany.set('shadow-1', {
      decision: 'review', reasonCode: 'policy_unknown_cold_start', blockerCode: null,
      enforcementMode: 'shadow', actsOnDecision: false,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(1);
    expect(queues.readyToContact[0].requiresExplicitApproval).toBe(false);
    expect(queues.readyToContact[0].canonicalDecision).toBe('review');
  });

  it('ENFORCE: the same canonical deny DOES move the company to Paused or Blocked and disables it', async () => {
    fixtures.companyRows = [companyRow(eligibleRow)];
    fixtures.contactRows = [highConfidenceContact];
    eligibilityByCompany.set('shadow-1', canonicalDeny(true, 'enforce'));

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].effectiveDecision).toBe('deny');
    expect(queues.pausedOrBlocked[0].disabledReason).toMatch(/blocked by policy/i);
  });

  it('SHADOW: a policy-blocked company is still bucketed as blocked even when the resolver allows it', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'shadow-1', outreachEligibility: 'blocked' })];
    eligibilityByCompany.set('shadow-1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].effectiveDecision).toBe('deny');
  });

  it('SHADOW: a null/unknown outreachEligibility fails to Needs Review, never to Ready to Contact', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'shadow-1', outreachEligibility: null })];
    fixtures.contactRows = [highConfidenceContact];
    eligibilityByCompany.set('shadow-1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].effectiveDecision).toBe('review');
  });

  it('an allow decision with a pending duplicate goes to Needs Review, never Ready to Contact, and carries the duplicateId', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'dup-a' })];
    fixtures.contactRows = [{ companyId: 'dup-a', confidenceScore: 9, metadata: {} }];
    fixtures.duplicateRows = [{ id: 'duplicate-row-1', companyAId: 'dup-a', companyBId: 'dup-b' }];
    eligibilityByCompany.set('dup-a', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].duplicatePending).toBe(true);
    expect(queues.needsReview[0].duplicateId).toBe('duplicate-row-1');
  });

  // A pending duplicate is itself a gate-L5 deny, so under `enforce` the
  // duplicate branch was unreachable — duplicates were filed under Paused or
  // Blocked with a block affordance instead of Needs Review with Merge /
  // Confirm Separate. §13's precedence is blocked → duplicate → paused.
  it('ENFORCE: a duplicate-denied company goes to Needs Review, not Paused or Blocked', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'dup-enforced', outreachEligibility: 'eligible' })];
    fixtures.duplicateRows = [{ id: 'duplicate-row-2', companyAId: 'dup-enforced', companyBId: 'dup-other' }];
    eligibilityByCompany.set('dup-enforced', {
      decision: 'deny', reasonCode: 'company_duplicate_suspected', blockerCode: 'policy_company_duplicate_suspected',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(0);
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].duplicateId).toBe('duplicate-row-2');
  });

  it('ENFORCE: a genuinely BLOCKED company still outranks a pending duplicate', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'blocked-dup', outreachEligibility: 'blocked' })];
    fixtures.duplicateRows = [{ id: 'duplicate-row-3', companyAId: 'blocked-dup', companyBId: 'other' }];
    eligibilityByCompany.set('blocked-dup', {
      decision: 'deny', reasonCode: 'company_removal_request', blockerCode: 'policy_company_removal_request',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.needsReview).toHaveLength(0);
  });
});

// PR 8A hardening (task 3) — non-overridable at every scope.
describe('buildTodayQueues — non-overridable block at a narrower scope (ADR-006 D-17/L1c)', () => {
  it('disables every action and names the narrower scope, even though the root row itself is only a standard overridable block', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'narrow-1', outreachEligibility: 'blocked', isNonOverridable: false, blockClass: 'standard' }),
    ];
    fixtures.narrowerNonOverridableRows = [
      { companyId: 'narrow-1', scopeKey: 'region:india', blockClass: 'compliance' },
    ];
    eligibilityByCompany.set('narrow-1', {
      decision: 'deny', reasonCode: 'manual_block_by_operator', blockerCode: 'policy_manual_block_by_operator',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    const item = queues.pausedOrBlocked[0];
    expect(item.isNonOverridable).toBe(true);
    expect(item.nonOverridableScopeKey).toBe('region:india');
    expect(item.disabledReason).toMatch(/non-overridable block at scope 'region:india'/);
  });

  it('ignores a supersededAt/entire_company-scoped row from the narrower-block query (already surfaced via the root row)', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'root-only-1', outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'legal' })];
    // Simulates the root row itself appearing in a naive query result — must be skipped, not double-counted.
    fixtures.narrowerNonOverridableRows = [{ companyId: 'root-only-1', scopeKey: 'entire_company', blockClass: 'legal' }];
    eligibilityByCompany.set('root-only-1', {
      decision: 'deny', reasonCode: 'legal_notice', blockerCode: 'policy_legal_notice',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    const item = queues.pausedOrBlocked[0];
    expect(item.isNonOverridable).toBe(true);
    // Names the ROOT's own scope key (policyScopeKey), not the query artefact.
    expect(item.nonOverridableScopeKey).toBe('entire_company');
  });
});

// PR 8A hardening (task 7) — review-date resurfacing.
describe('buildTodayQueues — review-date resurfacing', () => {
  it('re-surfaces a paused company into Needs Review once its review_date has arrived', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'paused-due', outreachEligibility: 'paused', reviewDate: '2020-01-01' }),
    ];
    eligibilityByCompany.set('paused-due', {
      decision: 'deny', reasonCode: 'policy_paused_by_owner', blockerCode: 'policy_policy_paused_by_owner',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(0);
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].reviewDateArrived).toBe(true);
  });

  it('keeps a paused company with a FUTURE review_date in Paused or Blocked', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'paused-future', outreachEligibility: 'paused', reviewDate: '2099-01-01' }),
    ];
    eligibilityByCompany.set('paused-future', {
      decision: 'deny', reasonCode: 'policy_paused_by_owner', blockerCode: 'policy_policy_paused_by_owner',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.needsReview).toHaveLength(0);
    expect(queues.pausedOrBlocked[0].reviewDateArrived).toBe(false);
  });

  it('a BLOCKED company (not paused) never resurfaces just because its review_date has arrived', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'blocked-with-date', outreachEligibility: 'blocked', reviewDate: '2020-01-01' }),
    ];
    eligibilityByCompany.set('blocked-with-date', {
      decision: 'deny', reasonCode: 'manual_block_by_operator', blockerCode: 'policy_manual_block_by_operator',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.needsReview).toHaveLength(0);
  });

  it('a null review_date retains its settled meaning (no resurfacing signal at all)', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'blocked-no-date', outreachEligibility: 'blocked', reviewDate: null }),
    ];
    eligibilityByCompany.set('blocked-no-date', {
      decision: 'deny', reasonCode: 'manual_block_by_operator', blockerCode: 'policy_manual_block_by_operator',
      enforcementMode: 'enforce', actsOnDecision: true,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked[0].reviewDateArrived).toBe(false);
  });
});

// PR 8A hardening (task 8) — routed/assigned queue.
describe('buildTodayQueues — routed queue', () => {
  it('surfaces an existing_client company (account_owner route) in the routed queue, not Needs Review or Ready to Contact', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'routed-1', outreachEligibility: 'eligible', relationshipType: 'existing_client' }),
    ];
    eligibilityByCompany.set('routed-1', {
      decision: 'allow', reasonCode: 'relationship_existing_client', blockerCode: null,
      enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'account_owner', accountOwnerUserId: 'user-42',
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.routed).toHaveLength(1);
    expect(queues.needsReview).toHaveLength(0);
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.routed[0].accountOwnerUserId).toBe('user-42');
    expect(queues.routed[0].recommendedRoute).toBe('account_owner');
    expect(queues.counts.routed).toBe(1);
  });

  it('an ordinary standard_outreach company is never placed in the routed queue', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'not-routed-1', outreachEligibility: 'eligible' })];
    fixtures.contactRows = [{ companyId: 'not-routed-1', confidenceScore: 9, metadata: {} }];
    eligibilityByCompany.set('not-routed-1', {
      decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.routed).toHaveLength(0);
    expect(queues.readyToContact).toHaveLength(1);
  });

  it('a blocked company is never placed in the routed queue even if its recommendedRoute would otherwise qualify', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'blocked-routed', outreachEligibility: 'blocked', relationshipType: 'existing_client' }),
    ];
    eligibilityByCompany.set('blocked-routed', {
      decision: 'deny', reasonCode: 'company_removal_request', blockerCode: 'policy_company_removal_request',
      enforcementMode: 'enforce', actsOnDecision: true,
      recommendedRoute: 'account_owner', accountOwnerUserId: 'user-42',
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.routed).toHaveLength(0);
    expect(queues.pausedOrBlocked).toHaveLength(1);
  });

  // PR 8A REVIEW fix — a routed company has NO primary action in the UI
  // (`primaryActionFor` returns null once it has an owner), so it renders the
  // "No action available" affordance. Before this fix `disabledReasonFor`
  // returned null for exactly that state, so the affordance's
  // `aria-describedby` pointed at nothing and no user — sighted or not — was
  // told why.
  it('a routed company WITH an account owner carries an explicit disabledReason', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'routed-owned', outreachEligibility: 'eligible', relationshipType: 'existing_client' }),
    ];
    fixtures.contactRows = [{ companyId: 'routed-owned', confidenceScore: 9, metadata: {} }];
    eligibilityByCompany.set('routed-owned', {
      decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'account_owner', accountOwnerUserId: 'user-42',
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.routed).toHaveLength(1);
    expect(queues.routed[0].disabledReason).toBeTruthy();
    expect(queues.routed[0].disabledReason).toMatch(/routed to its account owner/);
  });

  it('a routed company with NO account owner is told to assign one', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'routed-unowned', outreachEligibility: 'eligible', relationshipType: 'existing_client' }),
    ];
    fixtures.contactRows = [{ companyId: 'routed-unowned', confidenceScore: 9, metadata: {} }];
    eligibilityByCompany.set('routed-unowned', {
      decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'msp_vms_research', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.routed).toHaveLength(1);
    expect(queues.routed[0].disabledReason).toMatch(/Assign an owner to proceed/);
  });

  it("`routed` is false on an item precedence sends elsewhere, so the flag never contradicts the queue it is in", async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'blocked-routed-2', outreachEligibility: 'blocked', relationshipType: 'existing_client' }),
    ];
    eligibilityByCompany.set('blocked-routed-2', {
      decision: 'deny', reasonCode: 'company_removal_request', blockerCode: 'policy_company_removal_request',
      enforcementMode: 'enforce', actsOnDecision: true,
      recommendedRoute: 'account_owner', accountOwnerUserId: 'user-42',
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].routed).toBe(false);
  });
});

describe('buildTodayQueues — bucket assignment (contact confidence)', () => {
  // `deriveConfidenceTier` reads `confidenceTier` off `metadata.raw`. Passing
  // `metadata` itself meant the cascade-computed tier was never found and every
  // row fell through to the numeric threshold.
  it('reads the stored confidence tier from metadata.raw, not from metadata', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'tiered-1', outreachEligibility: 'eligible' })];
    // Score 6 alone derives `medium`; the stored tier says `high` and must win.
    fixtures.contactRows = [{ companyId: 'tiered-1', confidenceScore: 6, metadata: { raw: { confidenceTier: 'high' } } }];
    eligibilityByCompany.set('tiered-1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(1);
    expect(queues.readyToContact[0].contactConfidenceTier).toBe('high');
  });

  it('does not treat a tier stored at the wrong level as authoritative', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'tiered-2', outreachEligibility: 'eligible' })];
    // `confidenceTier` at the TOP level is not where the cascade writes it, so
    // this must fall through to the numeric threshold (6 -> medium), not `high`.
    fixtures.contactRows = [{ companyId: 'tiered-2', confidenceScore: 6, metadata: { confidenceTier: 'high' } }];
    eligibilityByCompany.set('tiered-2', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.needsReview[0].contactConfidenceTier).toBe('medium');
  });

  it('never lets a company with no canonical entry crash the response — it is skipped and reported', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'orphan-1' }), companyRow({ companyId: 'fine-1', outreachEligibility: 'eligible' })];
    fixtures.contactRows = [{ companyId: 'fine-1', confidenceScore: 9, metadata: {} }];
    // Only 'fine-1' gets a canonical entry — 'orphan-1' is deliberately absent
    // from the mocked batch resolver's map, simulating a malformed/partial row.
    eligibilityByCompany.set('fine-1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });
    vi.spyOn(await import('../modules/outreach/legacyEligibilityAdapter'), 'resolveCanonicalCompanyEligibilityBatch')
      .mockImplementation(async () => new Map([['fine-1', { tenantId: 'tenant-1', companyId: 'fine-1', decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false }]]));

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.partial.skippedCompanyIds).toContain('orphan-1');
    expect(queues.readyToContact.map((i) => i.companyId)).toEqual(['fine-1']);
  });
});

describe('buildTodayQueues — Replies Needing Action', () => {
  it('only includes the five live-conversation states named in PRD-005 §13, never the pre-reply live states', () => {
    expect([...REPLY_NEEDS_ACTION_STATES].sort()).toEqual(
      ['awaiting_action', 'conversation_open', 'positive_reply', 'referral_received', 'replied'].sort(),
    );
    expect(REPLY_NEEDS_ACTION_STATES).not.toContain('queued');
    expect(REPLY_NEEDS_ACTION_STATES).not.toContain('exported');
    expect(REPLY_NEEDS_ACTION_STATES).not.toContain('sent');
  });

  it('surfaces enrolments from the mocked query as reply items', async () => {
    fixtures.enrolmentRows = [
      { enrolmentId: 'enrol-1', companyId: 'company-9', contactId: 'contact-1', state: 'awaiting_action', stateAt: new Date('2026-07-01T00:00:00Z'), companyName: 'Reply Co' },
    ];
    const queues = await buildTodayQueues('tenant-1');
    expect(queues.repliesNeedingAction).toHaveLength(1);
    expect(queues.repliesNeedingAction[0].companyName).toBe('Reply Co');
    expect(queues.counts.repliesNeedingAction).toBe(1);
  });
});

describe('decisionWorkbench.ts — tenant predicate guard (source-level)', () => {
  it('every db.select query in the module filters on tenantId', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'outreach', 'decisionWorkbench.ts'), 'utf8');
    const selectBlocks = source.split(/await db\s*\n\s*\.select\(/).slice(1);
    expect(selectBlocks.length).toBeGreaterThan(0);
    for (const block of selectBlocks) {
      // Each query's own .where(...) clause (up to the next .orderBy/.limit or
      // function end) must reference tenantId — catches a future edit that
      // drops the tenant predicate from one of these queries.
      expect(block.slice(0, 1600)).toMatch(/tenantId/);
    }
  });
});
