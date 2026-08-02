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
  // `fetchContactsAwaitingReview` queries `wizmatchContactCandidates` a SECOND
  // time with a different projection (candidateId/name/email/status) and a
  // different predicate (status in new|needs_review, no company filter). Same
  // mock-vacuity trap as the two policy queries above: returning `contactRows`
  // for both would make every confidence fixture double as a review-queue
  // fixture, so a dropped status predicate would stay green.
  contactReviewRows: [] as unknown[],
  contactReviewShouldFail: false,
  // `wizmatch_job_signals` has no Drizzle table object, so the signals queue
  // and the companies-without-policy disclosure go through `pool` directly.
  signalRows: [] as Record<string, unknown>[],
  signalsShouldFail: false,
  companiesWithoutPolicy: 0,
  companiesWithoutPolicyShouldFail: false,
}));

/**
 * PR 8A review fix — the chain used to DISCARD `.where()` entirely, so no test
 * could observe a dropped or wrong predicate on the brand-new
 * `fetchNarrowerNonOverridableBlockByCompany` query. Dropping
 * `eq(outreachEligibility,'blocked')` from it (so a merely-paused narrower row
 * falsely raised the non-overridable banner, or worse a dropped
 * `isNonOverridable` predicate did) left the whole suite green. This is the
 * project's recurring mock-vacuity class (PR 2 / PR 5 / PR 7 T-3). The
 * predicate is now captured so a test can assert on it.
 */
const capturedWhere: unknown[] = [];
/** Same reasoning as `capturedWhere`, for ORDER BY: the fetch order is a SAMPLING decision (it selects which rows the LIMIT returns at all), so dropping it must be observable. */
const capturedOrderBy: unknown[] = [];

function makeChain(rows: unknown[], captureKey?: string) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: (condition: unknown) => {
      if (captureKey) capturedWhere.push({ key: captureKey, condition });
      return chain;
    },
    orderBy: (...args: unknown[]) => {
      if (captureKey) capturedOrderBy.push({ key: captureKey, args });
      return chain;
    },
    limit: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown) => resolve(rows),
  };
  return chain;
}

/** A chain whose await REJECTS — proves a queue that failed is reported as unavailable rather than rendering as an empty (i.e. finished) queue. */
function makeFailingChain(message: string) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.reject(new Error(message)),
    then: (_resolve: unknown, reject: (e: unknown) => unknown) => reject(new Error(message)),
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
              ? makeChain(fixtures.companyRows, 'rootPolicies')
              : makeChain(fixtures.narrowerNonOverridableRows, 'narrowerNonOverridable');
          }
          if (table === actual.wizmatchCompanyDuplicates) return makeChain(fixtures.duplicateRows);
          if (table === actual.wizmatchContactCandidates) {
            if (!('candidateId' in projection)) return makeChain(fixtures.contactRows);
            return fixtures.contactReviewShouldFail
              ? makeFailingChain('contacts-to-review query failed')
              : makeChain(fixtures.contactReviewRows);
          }
          if (table === actual.wizmatchOutreachEnrolments) return makeChain(fixtures.enrolmentRows);
          return makeChain([]);
        },
      }),
    },
    // Routed by SQL text, not call order: `buildTodayQueues` issues both of
    // these and a positional mock would silently swap them.
    pool: {
      query: async (text: string) => {
        if (String(text).includes('wizmatch_job_signals')) {
          if (fixtures.signalsShouldFail) throw new Error('signals query failed');
          return { rows: fixtures.signalRows };
        }
        if (String(text).includes('NOT EXISTS')) {
          if (fixtures.companiesWithoutPolicyShouldFail) throw new Error('count failed');
          return { rows: [{ count: fixtures.companiesWithoutPolicy }] };
        }
        throw new Error(`unexpected pool query in test: ${String(text).slice(0, 80)}`);
      },
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
    policyCreatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  // The malformed-row case below installs a `vi.spyOn` on
  // `resolveCanonicalCompanyEligibilityBatch` that resolves ONLY `fine-1`.
  // Without this restore that spy leaks into every test declared after it —
  // which is invisible while those tests happen not to use companies, and
  // silently empties every company queue for any test added later.
  vi.restoreAllMocks();
  eligibilityByCompany.clear();
  fixtures.companyRows = [];
  fixtures.duplicateRows = [];
  fixtures.contactRows = [];
  fixtures.enrolmentRows = [];
  fixtures.narrowerNonOverridableRows = [];
  fixtures.contactReviewRows = [];
  fixtures.contactReviewShouldFail = false;
  fixtures.signalRows = [];
  fixtures.signalsShouldFail = false;
  fixtures.companiesWithoutPolicy = 0;
  fixtures.companiesWithoutPolicyShouldFail = false;
  capturedWhere.length = 0;
  capturedOrderBy.length = 0;
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
      { companyId: 'narrow-1', scopeType: 'region', scopeKey: 'region:india', blockClass: 'compliance' },
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
    fixtures.narrowerNonOverridableRows = [{ companyId: 'root-only-1', scopeType: 'entire_company', scopeKey: 'entire_company', blockClass: 'legal' }];
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

/**
 * Walks a Drizzle condition graph and collects every referenced column name.
 *
 * **The `table` key MUST be skipped.** Every column object carries a circular
 * `.table` back-reference to ALL of its sibling columns, so a naive walk
 * collects the entire table's column list and the assertion becomes vacuous —
 * removing a predicate outright still "passes". Verified empirically by a
 * control run: dropping `eq(outreachEligibility, 'blocked')` left this test
 * green until this skip was added. Same trap, and same fix, as `paramValues`
 * in `wizmatchPolicyService.test.ts`.
 */
function collectColumnNames(node: unknown, seen = new Set<unknown>(), out = new Set<string>()): string[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return [...out];
  seen.add(node);
  const record = node as Record<string, unknown>;
  // A Drizzle column carries both a `name` and a `columnType`; a bare object
  // with a `name` (e.g. a table) must not be mistaken for one.
  if (typeof record.name === 'string' && typeof record.columnType === 'string') out.add(record.name);
  for (const [key, value] of Object.entries(record)) {
    if (key === 'table') continue;
    if (Array.isArray(value)) value.forEach((v) => collectColumnNames(v, seen, out));
    else if (value && typeof value === 'object') collectColumnNames(value, seen, out);
  }
  return [...out];
}

// PR 8A REVIEW fix — the narrower-non-overridable query's WHERE clause is now
// observable, so dropping one of its predicates is detectable at runtime and
// not only by the compensating source-level regex.
describe('fetchNarrowerNonOverridableBlockByCompany — the predicate is actually applied', () => {
  it('filters on tenant, company set, not-superseded, blocked AND non-overridable', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'c1' })];
    eligibilityByCompany.set('c1', {
      decision: 'review', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    await buildTodayQueues('tenant-1');

    const captured = capturedWhere.filter((c) => (c as { key: string }).key === 'narrowerNonOverridable');
    expect(captured).toHaveLength(1);
    // Drizzle's condition graph is circular (every column points back at its
    // table), so walk it with a visited set and collect the `name` of anything
    // that looks like a column, rather than serialising.
    const referenced = collectColumnNames((captured[0] as { condition: unknown }).condition);
    for (const column of [
      'tenant_id',
      'company_id',
      'superseded_at',
      'outreach_eligibility',
      'is_non_overridable',
      // P8B-1 — the query is now scope-type aware, so the narrower-block scan
      // can tell an L1c company/BU/location freeze from an L4 signal or
      // requirement block instead of conflating them.
      'scope_type',
    ]) {
      expect(referenced, `predicate must reference ${column}`).toContain(column);
    }
  });
});

// P8B-1 (owner-ratified) — a PRD-005 §8.2 L4 signal/requirement block is
// reported, but never treated as a company-level freeze.
describe('buildTodayQueues — an L4 signal/requirement block does not freeze the company', () => {
  it('keeps a requirement-scoped block out of pausedOrBlocked and reports it as nonOverridableBlockKind', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'l4-req', outreachEligibility: 'eligible', isNonOverridable: false })];
    fixtures.contactRows = [{ companyId: 'l4-req', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } }];
    fixtures.narrowerNonOverridableRows = [
      {
        companyId: 'l4-req',
        scopeType: 'specific_requirement',
        scopeKey: 'specific_requirement:22222222-2222-4222-8222-222222222222',
        blockClass: 'compliance',
      },
    ];
    eligibilityByCompany.set('l4-req', {
      decision: 'allow', reasonCode: null, blockerCode: null,
      enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(0);
    expect(queues.readyToContact).toHaveLength(1);
    const item = queues.readyToContact[0];
    expect(item.isNonOverridable).toBe(false);
    expect(item.nonOverridableScopeKey).toBeNull();
    expect(item.nonOverridableBlockKind).toBe('requirement');
    expect(item.disabledReason).toMatch(/specific requirement is blocked/);
    expect(item.disabledReason).not.toMatch(/at any scope/);
  });

  it('reports a signal-scoped block as nonOverridableBlockKind "signal"', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'l4-sig', outreachEligibility: 'needs_review' })];
    fixtures.narrowerNonOverridableRows = [
      {
        companyId: 'l4-sig',
        scopeType: 'specific_signal',
        scopeKey: 'specific_signal:11111111-1111-4111-8111-111111111111',
        blockClass: 'legal',
      },
    ];
    eligibilityByCompany.set('l4-sig', {
      decision: 'review', reasonCode: null, blockerCode: null,
      enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(0);
    expect(queues.needsReview).toHaveLength(1);
    expect(queues.needsReview[0].nonOverridableBlockKind).toBe('signal');
    // The L4 block never fabricates a company-level block class.
    expect(queues.needsReview[0].blockClass).toBe('standard');
  });

  // CONTROL — unchanged before and after P8B-1.
  it('still freezes the company for a business_unit-scoped non-overridable block', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'l1c-bu', outreachEligibility: 'eligible', isNonOverridable: false })];
    fixtures.contactRows = [{ companyId: 'l1c-bu', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } }];
    fixtures.narrowerNonOverridableRows = [
      { companyId: 'l1c-bu', scopeType: 'business_unit', scopeKey: 'business_unit:gcc', blockClass: 'compliance' },
    ];
    eligibilityByCompany.set('l1c-bu', {
      decision: 'allow', reasonCode: null, blockerCode: null,
      enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].isNonOverridable).toBe(true);
    expect(queues.pausedOrBlocked[0].nonOverridableBlockKind).toBe('company_scope');
    expect(queues.pausedOrBlocked[0].nonOverridableScopeKey).toBe('business_unit:gcc');
  });

  // CONTROL — company scope always wins the display enum, even when an L4 block
  // is also active, because it is the one that actually disables actions.
  it('reports company_scope when a company-scope block co-exists with an L4 one', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'both-1', outreachEligibility: 'needs_review' })];
    fixtures.narrowerNonOverridableRows = [
      {
        companyId: 'both-1',
        scopeType: 'specific_signal',
        scopeKey: 'specific_signal:11111111-1111-4111-8111-111111111111',
        blockClass: 'legal',
      },
      { companyId: 'both-1', scopeType: 'location', scopeKey: 'location:pune', blockClass: 'compliance' },
    ];
    eligibilityByCompany.set('both-1', {
      decision: 'review', reasonCode: null, blockerCode: null,
      enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].nonOverridableBlockKind).toBe('company_scope');
    expect(queues.pausedOrBlocked[0].nonOverridableScopeKey).toBe('location:pune');
  });
});

// PR 8A REVIEW fix — a non-overridable block must surface regardless of the
// effective decision. In shadow, `effectiveDecision` follows the ROOT row, so
// an `eligible` root with a narrower non-overridable compliance block resolved
// to `allow` and landed in Ready to Contact with no warning whatsoever.
describe('buildTodayQueues — a narrower non-overridable block outranks an eligible root', () => {
  beforeEach(() => {
    fixtures.companyRows = [companyRow({ companyId: 'nonov-1', outreachEligibility: 'eligible', isNonOverridable: false })];
    fixtures.contactRows = [{ companyId: 'nonov-1', confidenceScore: 9, metadata: {} }];
    fixtures.narrowerNonOverridableRows = [
      { companyId: 'nonov-1', scopeType: 'region', scopeKey: 'region:india', blockClass: 'compliance' },
    ];
    eligibilityByCompany.set('nonov-1', {
      decision: 'allow', reasonCode: null, blockerCode: null,
      // Shadow: actsOnDecision false, so effectiveDecision follows the root row.
      enforcementMode: 'shadow', actsOnDecision: false,
      recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });
  });

  it('never places it in Ready to Contact', async () => {
    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(0);
    expect(queues.pausedOrBlocked).toHaveLength(1);
    expect(queues.pausedOrBlocked[0].isNonOverridable).toBe(true);
    expect(queues.pausedOrBlocked[0].nonOverridableScopeKey).toBe('region:india');
  });

  it('states the block in disabledReason even though the row reads allow', async () => {
    const queues = await buildTodayQueues('tenant-1');
    const item = queues.pausedOrBlocked[0];
    expect(item.effectiveDecision).toBe('allow');
    expect(item.disabledReason).toMatch(/non-overridable block at scope 'region:india'/);
    expect(item.disabledReason).toMatch(/must not be contacted/);
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

/** Collects every literal SQL fragment from a Drizzle `sql` template (StringChunk carries `value: string[]`). Skips `table` for the same circular-reference reason as `collectColumnNames`. */
function collectSqlText(node: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.value) && record.value.every((v) => typeof v === 'string')) {
    out.push(...(record.value as string[]));
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'table') continue;
    if (Array.isArray(value)) value.forEach((v) => collectSqlText(v, seen, out));
    else if (value && typeof value === 'object') collectSqlText(value, seen, out);
  }
  return out;
}

// The root-policy fetch ends in `LIMIT n`, so its ORDER BY decides WHICH
// companies are returned at all, not merely in what order they are shown. With
// `created_at DESC` alone the LIMIT sampled "the companies whose policy I
// edited most recently", and a company whose review date came due today could
// be absent from the response entirely — a defect no JS-side sort can repair,
// because the row was never fetched.
describe('buildTodayQueues — the root-policy fetch order (a sampling decision, not a display one)', () => {
  it('orders by review_date ASC NULLS LAST before created_at DESC', async () => {
    fixtures.companyRows = [companyRow({ companyId: 'c1' })];
    eligibilityByCompany.set('c1', { decision: 'review', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    await buildTodayQueues('tenant-1');

    const captured = capturedOrderBy.filter((c) => (c as { key: string }).key === 'rootPolicies');
    expect(captured).toHaveLength(1);
    const args = (captured[0] as { args: unknown[] }).args;
    const columns = collectColumnNames(args);
    expect(columns, 'the fetch must be ordered by review_date, or due work can fall outside the LIMIT').toContain('review_date');
    expect(columns, 'created_at must remain the tiebreak so existing ordering is preserved').toContain('created_at');
    expect(collectSqlText(args).join(' ').toLowerCase())
      .toMatch(/asc\s+nulls\s+last/);
  });
});

// Display order, applied AFTER the bucketing chain. These assertions are about
// which item comes FIRST inside a queue — never about which queue it lands in,
// which the chain alone decides.
describe('buildTodayQueues — per-queue display order', () => {
  const allow = (extra: Record<string, unknown> = {}) => ({
    decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false,
    recommendedRoute: 'standard_outreach', accountOwnerUserId: null, ...extra,
  });

  it('readyToContact leads with the longest-waiting row', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'new', outreachEligibility: 'eligible', policyCreatedAt: new Date('2026-06-01T00:00:00Z') }),
      companyRow({ companyId: 'old', outreachEligibility: 'eligible', policyCreatedAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    fixtures.contactRows = [
      { companyId: 'new', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } },
      { companyId: 'old', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } },
    ];
    for (const id of ['new', 'old']) eligibilityByCompany.set(id, allow());

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact.map((i) => i.companyId)).toEqual(['old', 'new']);
  });

  // Pins the invariant that makes a contact-confidence sort key on
  // readyToContact dead code: the only branch that pushes into this queue is
  // `contactConfidenceTier === 'high'`. If the chain is ever widened to admit
  // `medium`, this fails and the ordering comment must be revisited with it.
  it('every readyToContact row is high-confidence, so the queue is homogeneous by construction', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'hi', outreachEligibility: 'eligible' }),
      companyRow({ companyId: 'mid', outreachEligibility: 'eligible' }),
      companyRow({ companyId: 'none', outreachEligibility: 'eligible' }),
    ];
    fixtures.contactRows = [
      { companyId: 'hi', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } },
      { companyId: 'mid', confidenceScore: 6, metadata: { raw: { confidenceTier: 'medium' } } },
    ];
    for (const id of ['hi', 'mid', 'none']) eligibilityByCompany.set(id, allow());

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact.map((i) => i.companyId)).toEqual(['hi']);
    expect(queues.readyToContact.every((i) => i.contactConfidenceTier === 'high')).toBe(true);
    expect(queues.needsReview.map((i) => i.companyId).sort()).toEqual(['mid', 'none']);
  });

  it('needsReview leads with pending duplicates, then rows whose review date has arrived', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'plain' }),
      companyRow({ companyId: 'due', outreachEligibility: 'paused', reviewDate: '2020-01-01' }),
      companyRow({ companyId: 'dup' }),
    ];
    fixtures.duplicateRows = [{ id: 'duplicate-1', companyAId: 'dup', companyBId: 'other' }];
    eligibilityByCompany.set('plain', allow({ decision: 'review' }));
    eligibilityByCompany.set('dup', allow({ decision: 'review' }));
    eligibilityByCompany.set('due', {
      decision: 'deny', reasonCode: 'policy_paused_by_owner', blockerCode: null,
      enforcementMode: 'enforce', actsOnDecision: true, recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.needsReview.map((i) => i.companyId)).toEqual(['dup', 'due', 'plain']);
  });

  it('pausedOrBlocked leads with the soonest review date and puts undated rows last', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'undated', outreachEligibility: 'blocked', reviewDate: null }),
      companyRow({ companyId: 'far', outreachEligibility: 'blocked', reviewDate: '2099-12-31' }),
      companyRow({ companyId: 'near', outreachEligibility: 'blocked', reviewDate: '2027-01-01' }),
    ];
    for (const id of ['undated', 'far', 'near']) {
      eligibilityByCompany.set(id, {
        decision: 'deny', reasonCode: 'manual_block_by_operator', blockerCode: null,
        enforcementMode: 'enforce', actsOnDecision: true, recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
      });
    }

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.pausedOrBlocked.map((i) => i.companyId)).toEqual(['near', 'far', 'undated']);
  });

  it('routed leads with UNASSIGNED rows — an owned routed row has no primary action at all', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'owned', outreachEligibility: 'eligible' }),
      companyRow({ companyId: 'unowned', outreachEligibility: 'eligible' }),
    ];
    eligibilityByCompany.set('owned', allow({ recommendedRoute: 'account_owner', accountOwnerUserId: 'user-42' }));
    eligibilityByCompany.set('unowned', allow({ recommendedRoute: 'account_owner', accountOwnerUserId: null }));

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.routed.map((i) => i.companyId)).toEqual(['unowned', 'owned']);
  });

  it('the display sorts never move a row between queues (the bucketing chain still decides)', async () => {
    fixtures.companyRows = [
      companyRow({ companyId: 'ready', outreachEligibility: 'eligible', policyCreatedAt: new Date('2026-06-01T00:00:00Z') }),
      companyRow({ companyId: 'blocked', outreachEligibility: 'blocked', reviewDate: '2020-01-01' }),
    ];
    fixtures.contactRows = [{ companyId: 'ready', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } }];
    eligibilityByCompany.set('ready', allow());
    eligibilityByCompany.set('blocked', {
      decision: 'deny', reasonCode: 'manual_block_by_operator', blockerCode: null,
      enforcementMode: 'enforce', actsOnDecision: true, recommendedRoute: 'standard_outreach', accountOwnerUserId: null,
    });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact.map((i) => i.companyId)).toEqual(['ready']);
    expect(queues.pausedOrBlocked.map((i) => i.companyId)).toEqual(['blocked']);
  });
});

describe('buildTodayQueues — signals to qualify', () => {
  const signalRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'signal-1',
    job_title: 'Senior Java Engineer',
    company_id: 'company-9',
    status: 'scored',
    score: 8,
    location: 'Bengaluru',
    source: 'theirstack',
    days_open: 3,
    created_at: new Date('2026-07-20T00:00:00Z'),
    company_name: 'Acme Staffing',
    company_domain: 'acme.example',
    ...overrides,
  });

  it('surfaces awaiting-qualification signals with a `signal` kind and counts them', async () => {
    fixtures.signalRows = [signalRow()];

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.signalsToQualify).toHaveLength(1);
    expect(queues.signalsToQualify[0]).toMatchObject({
      kind: 'signal',
      signalId: 'signal-1',
      jobTitle: 'Senior Java Engineer',
      companyName: 'Acme Staffing',
      status: 'scored',
      score: 8,
    });
    expect(queues.counts.signalsToQualify).toBe(1);
  });

  it('queries only the statuses that still await a human decision', async () => {
    const { SIGNAL_AWAITING_QUALIFICATION_STATES } = await import('../modules/outreach/decisionWorkbench');
    expect([...SIGNAL_AWAITING_QUALIFICATION_STATES].sort()).toEqual(['enriched', 'new', 'scored']);
    // Terminal and in-flight states must never appear: a `dead`/`placed`
    // signal is decided, and a `sent`/`drafted` one is outreach in flight.
    for (const state of ['dead', 'placed', 'drafted', 'sent', 'matched', 'replied_positive']) {
      expect(SIGNAL_AWAITING_QUALIFICATION_STATES).not.toContain(state);
    }
  });

  it('reports a FAILED signals query as unavailable — an empty queue must never read as "nothing to qualify"', async () => {
    fixtures.signalsShouldFail = true;
    fixtures.companyRows = [companyRow({ companyId: 'c1' })];
    eligibilityByCompany.set('c1', { decision: 'review', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.signalsToQualify).toEqual([]);
    expect(queues.partial.signalsUnavailable).toBe(true);
    // ...and it does not take the other queues down with it.
    expect(queues.needsReview).toHaveLength(1);
  });

  it('flags truncation rather than silently dropping the overflow', async () => {
    fixtures.signalRows = [signalRow({ id: 's1' }), signalRow({ id: 's2' }), signalRow({ id: 's3' })];

    const queues = await buildTodayQueues('tenant-1', 2);
    expect(queues.signalsToQualify.map((i) => i.signalId)).toEqual(['s1', 's2']);
    expect(queues.partial.signalsTruncated).toBe(true);
  });
});

describe('buildTodayQueues — contacts to review', () => {
  const contactReviewRow = (overrides: Record<string, unknown> = {}) => ({
    candidateId: 'candidate-1',
    companyId: 'company-9',
    name: 'Priya Sharma',
    title: 'Head of Talent',
    email: 'priya@acme.example',
    status: 'needs_review',
    confidenceScore: 6,
    metadata: {},
    createdAt: new Date('2026-07-20T00:00:00Z'),
    companyName: 'Acme Staffing',
    ...overrides,
  });

  it('surfaces awaiting-review candidates with a `contact` kind and counts them', async () => {
    fixtures.contactReviewRows = [contactReviewRow()];

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.contactsToReview).toHaveLength(1);
    expect(queues.contactsToReview[0]).toMatchObject({
      kind: 'contact',
      candidateId: 'candidate-1',
      name: 'Priya Sharma',
      companyName: 'Acme Staffing',
      status: 'needs_review',
    });
    expect(queues.counts.contactsToReview).toBe(1);
  });

  // Same `metadata.raw` trap `fetchBestContactConfidenceByCompany` already
  // shipped once: a tier stored at the top level is NOT where the discovery
  // cascade writes it and must not be treated as authoritative.
  it('reads the stored confidence tier from metadata.raw, not from metadata', async () => {
    fixtures.contactReviewRows = [
      contactReviewRow({ candidateId: 'stored', confidenceScore: 6, metadata: { raw: { confidenceTier: 'high' } } }),
      contactReviewRow({ candidateId: 'wrong-level', confidenceScore: 6, metadata: { confidenceTier: 'high' } }),
    ];

    const queues = await buildTodayQueues('tenant-1');
    const byId = new Map(queues.contactsToReview.map((i) => [i.candidateId, i]));
    expect(byId.get('stored')!.confidenceTier).toBe('high');
    expect(byId.get('wrong-level')!.confidenceTier).toBe('medium');
  });

  it('only awaits-review statuses are queried', async () => {
    const { CONTACT_AWAITING_REVIEW_STATES } = await import('../modules/outreach/decisionWorkbench');
    expect([...CONTACT_AWAITING_REVIEW_STATES].sort()).toEqual(['needs_review', 'new']);
    for (const state of ['approved', 'rejected', 'do_not_contact', 'linked_to_crm']) {
      expect(CONTACT_AWAITING_REVIEW_STATES).not.toContain(state);
    }
  });

  it('reports a FAILED contacts query as unavailable — an empty queue must never read as "nothing to review"', async () => {
    fixtures.contactReviewShouldFail = true;
    fixtures.signalRows = [{
      id: 'signal-1', job_title: 'X', company_id: null, status: 'new', score: null,
      location: null, source: null, days_open: null, created_at: null, company_name: null, company_domain: null,
    }];

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.contactsToReview).toEqual([]);
    expect(queues.partial.contactsUnavailable).toBe(true);
    // ...and the sibling queue is unaffected.
    expect(queues.signalsToQualify).toHaveLength(1);
  });
});

// A company with NO root policy row never appears in Today at all — the
// company queues are built from an INNER JOIN on that row. Disclosed as a
// count rather than "fixed" by a LEFT JOIN, which would surface every such row
// as a server-side `policy_missing_root` failure dressed up as a work item.
describe('buildTodayQueues — companies excluded for having no root policy row', () => {
  it('discloses the count', async () => {
    fixtures.companiesWithoutPolicy = 7;
    const queues = await buildTodayQueues('tenant-1');
    expect(queues.partial.companiesWithoutPolicy).toBe(7);
  });

  it('reports zero as zero (nothing is hidden)', async () => {
    fixtures.companiesWithoutPolicy = 0;
    const queues = await buildTodayQueues('tenant-1');
    expect(queues.partial.companiesWithoutPolicy).toBe(0);
  });

  it('leaves the count UNDEFINED when it fails — an unknown is not a zero', async () => {
    fixtures.companiesWithoutPolicyShouldFail = true;
    const queues = await buildTodayQueues('tenant-1');
    expect(queues.partial.companiesWithoutPolicy).toBeUndefined();
  });

  it('a failed count never takes the queues down with it', async () => {
    fixtures.companiesWithoutPolicyShouldFail = true;
    fixtures.companyRows = [companyRow({ companyId: 'c1', outreachEligibility: 'eligible' })];
    fixtures.contactRows = [{ companyId: 'c1', confidenceScore: 9, metadata: { raw: { confidenceTier: 'high' } } }];
    eligibilityByCompany.set('c1', { decision: 'allow', reasonCode: null, blockerCode: null, enforcementMode: 'shadow', actsOnDecision: false });

    const queues = await buildTodayQueues('tenant-1');
    expect(queues.readyToContact).toHaveLength(1);
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
