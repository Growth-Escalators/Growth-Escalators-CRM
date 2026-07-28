// P8B-1 (owner-ratified) — PRD-005 §8.2 L4 for the requirement-priority path.
//
// `scoreRequirementPriorityWithPolicy` / `rankRequirementPriorityQueueWithPolicy`
// fold in the COMPANY-level canonical decision only. A block written against
// one specific requirement (`specific_requirement:<its own id>`) was therefore
// invisible to them: an explicitly-blocked requirement kept its raw score and
// kept being ranked, recommended and worked. §8.2 L4 says DENY for that
// requirement — not downweight.
//
// The real `fetchBlockedScopedIds` runs here (only `db` is mocked), so the
// tenant/scope predicate it builds is observable rather than assumed — dropping
// a predicate from it is detectable at runtime, not only by a source regex.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fixtures = vi.hoisted(() => ({
  /** Rows the mocked `wizmatch_company_policies` select resolves to. */
  policyRows: [] as Array<{ scopeKey: string }>,
}));

const capturedWhere: unknown[] = [];

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (condition: unknown) => {
      capturedWhere.push(condition);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown) => resolve(fixtures.policyRows),
  };
  return { ...actual, db: { select: () => chain } };
});

vi.mock('../modules/outreach/legacyEligibilityAdapter', async (importOriginal) => ({
  // `applyCanonicalEligibilityToPriorityResult` is a pure fold and stays real —
  // this suite must prove the L4 block survives it, not that it was skipped.
  ...(await importOriginal<typeof import('../modules/outreach/legacyEligibilityAdapter')>()),
  resolveCanonicalCompanyEligibility: async (tenantId: string, companyId: string) => ({
    tenantId, companyId, decision: 'allow', reasonCode: null, blockerCode: null,
    enforcementMode: 'shadow', actsOnDecision: false,
  }),
  resolveCanonicalCompanyEligibilityBatch: async (tenantId: string, companyIds: Array<string | null | undefined>) => {
    const map = new Map();
    for (const id of companyIds.filter((x): x is string => !!x)) {
      map.set(id, {
        tenantId, companyId: id, decision: 'allow', reasonCode: null, blockerCode: null,
        enforcementMode: 'shadow', actsOnDecision: false,
      });
    }
    return map;
  },
}));

import {
  scoreRequirementPriorityWithPolicy,
  rankRequirementPriorityQueueWithPolicy,
  REQUIREMENT_SCOPE_BLOCKER,
  type RequirementPriorityInput,
} from '../services/wizmatchRequirementPriority';

const BLOCKED_REQ = '33333333-3333-4333-8333-333333333333';
const OPEN_REQ = '44444444-4444-4444-8444-444444444444';

/** A requirement that scores well on its own merits, so "denied regardless of
 * its raw score" is actually being exercised. */
function requirement(id: string, overrides: Partial<RequirementPriorityInput> = {}): RequirementPriorityInput {
  return {
    id,
    title: 'Senior Java Engineer',
    companyId: 'company-1',
    companyName: 'Acme Inc',
    region: 'india',
    location: 'Bengaluru',
    workMode: 'hybrid',
    budgetMax: 3000000,
    priority: 'urgent',
    status: 'sheet_ready',
    requiredSkills: ['java', 'spring'],
    companyTier: 'A',
    contactApprovedCount: 2,
    ...overrides,
  } as RequirementPriorityInput;
}

function collectColumnNames(node: unknown, seen = new Set<unknown>(), out = new Set<string>()): string[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return [...out];
  seen.add(node);
  const record = node as Record<string, unknown>;
  if (typeof record.name === 'string' && typeof record.columnType === 'string') out.add(record.name);
  for (const [key, value] of Object.entries(record)) {
    if (key === 'table') continue;
    if (Array.isArray(value)) value.forEach((v) => collectColumnNames(v, seen, out));
    else if (value && typeof value === 'object') collectColumnNames(value, seen, out);
  }
  return [...out];
}

beforeEach(() => {
  fixtures.policyRows = [];
  capturedWhere.length = 0;
});

describe('scoreRequirementPriorityWithPolicy — a specific_requirement block denies that requirement', () => {
  it('scores the requirement well on its own merits when nothing blocks it (control)', async () => {
    const result = await scoreRequirementPriorityWithPolicy('tenant-1', requirement(OPEN_REQ));
    expect(result.priority).not.toBe('blocked');
    expect(result.score).toBeGreaterThanOrEqual(45);
    expect(result.blockers).not.toContain(REQUIREMENT_SCOPE_BLOCKER);
  });

  it('denies it regardless of that score once its own scope key is blocked', async () => {
    fixtures.policyRows = [{ scopeKey: `specific_requirement:${BLOCKED_REQ}` }];
    const result = await scoreRequirementPriorityWithPolicy('tenant-1', requirement(BLOCKED_REQ));
    expect(result.priority).toBe('blocked');
    expect(result.nextAction).toBe('blocked');
    expect(result.blockers).toContain(REQUIREMENT_SCOPE_BLOCKER);
    expect(result.score).toBeLessThan(45);
    expect(result.canonicalDecision).toBe('deny');
  });

  // CONTROL — a block written against a DIFFERENT requirement of the same
  // company must not spill onto this one. L4 is per-requirement, not per-company.
  it('leaves a sibling requirement of the same company untouched', async () => {
    fixtures.policyRows = [{ scopeKey: `specific_requirement:${BLOCKED_REQ}` }];
    const result = await scoreRequirementPriorityWithPolicy('tenant-1', requirement(OPEN_REQ));
    expect(result.priority).not.toBe('blocked');
    expect(result.blockers).not.toContain(REQUIREMENT_SCOPE_BLOCKER);
  });

  it('matches case-insensitively, since scope keys are stored lowercased', async () => {
    fixtures.policyRows = [{ scopeKey: `specific_requirement:${BLOCKED_REQ}` }];
    const result = await scoreRequirementPriorityWithPolicy('tenant-1', requirement(BLOCKED_REQ.toUpperCase()));
    expect(result.priority).toBe('blocked');
  });
});

describe('rankRequirementPriorityQueueWithPolicy — a blocked requirement is de-ranked, not just relabelled', () => {
  it('sorts the blocked requirement below an unblocked one that scored lower', async () => {
    fixtures.policyRows = [{ scopeKey: `specific_requirement:${BLOCKED_REQ}` }];
    const ranked = await rankRequirementPriorityQueueWithPolicy('tenant-1', [
      // The blocked one would otherwise outscore its sibling.
      requirement(BLOCKED_REQ),
      requirement(OPEN_REQ, { priority: 'low', companyTier: 'C', budgetMax: 0 }),
    ]);
    expect(ranked[0].id).toBe(OPEN_REQ);
    expect(ranked[1].id).toBe(BLOCKED_REQ);
    expect(ranked[1].priority).toBe('blocked');
    expect(ranked[0].blockers).not.toContain(REQUIREMENT_SCOPE_BLOCKER);
  });
});

describe('fetchBlockedScopedIds — the predicate is actually applied', () => {
  it('filters on tenant, the company set, not-superseded, scope type AND blocked eligibility', async () => {
    await scoreRequirementPriorityWithPolicy('tenant-1', requirement(OPEN_REQ));
    expect(capturedWhere).toHaveLength(1);
    const referenced = collectColumnNames(capturedWhere[0]);
    for (const column of ['tenant_id', 'company_id', 'superseded_at', 'scope_type', 'outreach_eligibility']) {
      expect(referenced, `predicate must reference ${column}`).toContain(column);
    }
  });

  it('binds the caller\'s tenant id, so another tenant\'s blocked requirement can never enter the set', async () => {
    await scoreRequirementPriorityWithPolicy('tenant-1', requirement(OPEN_REQ));
    const serialised = JSON.stringify(capturedWhere[0], (key, value) => (key === 'table' ? undefined : value));
    expect(serialised).toContain('tenant-1');
    expect(serialised).not.toContain('tenant-2');
  });

  it('never queries at all when the requirement has no company (nothing to scope a block to)', async () => {
    await scoreRequirementPriorityWithPolicy('tenant-1', requirement(OPEN_REQ, { companyId: null } as never));
    expect(capturedWhere).toHaveLength(0);
  });
});
