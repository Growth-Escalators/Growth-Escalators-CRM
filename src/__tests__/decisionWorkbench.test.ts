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
      select: () => ({
        from: (table: unknown) => {
          if (table === actual.wizmatchCompanyPolicies) return makeChain(fixtures.companyRows);
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
