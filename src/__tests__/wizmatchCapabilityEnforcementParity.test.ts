// PR 8B integration test — owned by the orchestrating session, not either
// Stage B lane, because it spans both: the policy lane's real enforcement
// path (`decisionWorkbenchActions.ts`'s `applyCompanyEligibilityAction`, via
// `runTodayActions`) and the access lane's parallel, independently-computed
// prediction (`decisionWorkbenchCapabilities.ts`). Both encode the same four
// rules (company/scope non-overridable freeze, blocked+non-admin override,
// already-eligible idempotency, set_review_date dimension-completeness) as
// two separate implementations by design (see decisionWorkbenchCapabilities.ts's
// own header) — which means nothing stops them drifting apart except a test
// that runs both against the same fixture and asserts they agree. This is
// exactly the "two rule engines drift" failure class this repo has hit
// repeatedly (D-31 shadow/enforce, the routed-queue disabledReason gap) — the
// two Stage B agents that wrote these files independently both flagged the
// risk and asked for this cross-check at integration.
//
// The role-eligibility side of parity (single vs bulk allow-lists) is proven
// separately: `wizmatchTodayRoutes.test.ts` pins the real route's allow-list
// behaviourally, and `decisionWorkbenchCapabilities.ts`'s `ROLES_BY_CONTEXT`
// is a direct transcription of it, checked by its own suite. This file only
// covers the rules that live INSIDE `applyCompanyEligibilityAction` itself,
// which is where a predicted "enabled" and a real "throws" could otherwise
// silently disagree.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
  writeCompanyPolicy: [] as unknown[][],
}));

const state = vi.hoisted(() => ({
  rootRow: null as Record<string, unknown> | null,
  allActiveRows: [] as Record<string, unknown>[],
}));

vi.mock('../modules/outreach/policyService', () => {
  class PolicyValidationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  class PolicyOverrideRefusedError extends Error {}
  class PolicyStaleStateError extends Error {}
  return {
    PolicyValidationError,
    PolicyOverrideRefusedError,
    PolicyStaleStateError,
    writeCompanyPolicy: async (...args: unknown[]) => {
      calls.writeCompanyPolicy.push(args);
      return { id: 'policy-1' };
    },
    assignAccountOwner: async () => ({ id: 'ignored' }),
  };
});

vi.mock('../modules/outreach/duplicateService', () => {
  class DuplicateValidationError extends Error {}
  return {
    DuplicateValidationError,
    resolveDuplicate: async () => ({ id: 'ignored' }),
  };
});

vi.mock('../modules/outreach/policyResolver', async (importOriginal) => ({
  // Same rationale as decisionWorkbenchActions.test.ts: the scope-type
  // predicates are pure and are exactly what's under test — only the
  // DB-touching resolver is replaced.
  ...(await importOriginal<typeof import('../modules/outreach/policyResolver')>()),
  resolveEffectivePolicy: async () => ({
    rootRow: state.rootRow,
    allActiveRows: state.allActiveRows,
  }),
}));

import { runTodayActions } from '../modules/outreach/decisionWorkbenchActions';
import { computeTodayActionCapabilities } from '../modules/outreach/decisionWorkbenchCapabilities';
import type { DecisionWorkbenchCompanyItem } from '../modules/outreach/decisionWorkbench';

const actor = (role: string, userId = 'user-1') => ({ tenantId: 'tenant-1', userId, role });

/** Builds a minimal-but-complete item for the capability function from the same root row the mock resolver will serve. */
function itemFor(root: Record<string, unknown>, overrides: Partial<DecisionWorkbenchCompanyItem> = {}): DecisionWorkbenchCompanyItem {
  return {
    companyId: 'company-1',
    companyName: 'Test Co',
    companyDomain: null,
    canonicalDecision: 'allow',
    canonicalReasonCode: null,
    canonicalBlockerCode: null,
    effectiveDecision: 'allow',
    enforcementMode: 'shadow',
    requiresExplicitApproval: false,
    outreachEligibility: (root.outreachEligibility as string) ?? null,
    externalHiringPolicy: (root.externalHiringPolicy as string) ?? 'unknown',
    relationshipType: (root.relationshipType as string) ?? 'new_prospect',
    blockClass: (root.blockClass as string) ?? null,
    isNonOverridable: false,
    nonOverridableScopeKey: null,
    nonOverridableBlockKind: null,
    policyId: 'policy-0',
    policyReasonCode: (root.reasonCode as string) ?? 'policy_unknown_cold_start',
    reviewDate: null,
    reviewDateArrived: false,
    duplicatePending: false,
    duplicateId: null,
    contactConfidenceTier: null,
    routed: false,
    accountOwnerUserId: null,
    disabledReason: null,
    ...overrides,
  } as DecisionWorkbenchCompanyItem;
}

async function realOutcome(action: 'approve_queue' | 'resume' | 'skip' | 'pause' | 'set_review_date', role: string): Promise<'succeeded' | 'refused'> {
  const outcome = await runTodayActions(actor(role), {
    action,
    targets: [{ type: 'company', id: 'company-1' }],
    ...(action === 'set_review_date' ? { reviewDate: '2026-08-01' } : {}),
  } as Parameters<typeof runTodayActions>[1]);
  return outcome.results[0]?.ok ? 'succeeded' : 'refused';
}

function predicted(item: DecisionWorkbenchCompanyItem, action: 'approve_queue' | 'resume' | 'skip' | 'pause' | 'set_review_date', role: string): boolean {
  return computeTodayActionCapabilities(item, role, 'single')[action].enabled;
}

describe('capability prediction vs real enforcement — cross-lane parity (PR 8B integration)', () => {
  beforeEach(() => {
    state.rootRow = null;
    state.allActiveRows = [];
    calls.writeCompanyPolicy.length = 0;
  });

  it('company-scope (entire_company) non-overridable block: predicted disabled, real refused, for admin', async () => {
    const root = {
      id: 'policy-1', outreachEligibility: 'blocked', externalHiringPolicy: 'no_hire', relationshipType: 'new_prospect',
      isNonOverridable: true, blockClass: 'compliance', scopeType: 'entire_company', scopeKey: 'entire_company', reasonCode: 'company_removal_request',
    };
    state.rootRow = root;
    state.allActiveRows = [root];
    const item = itemFor(root, { isNonOverridable: true, nonOverridableScopeKey: 'entire_company', nonOverridableBlockKind: 'company_scope' });

    expect(predicted(item, 'approve_queue', 'admin')).toBe(false);
    expect(await realOutcome('approve_queue', 'admin')).toBe('refused');
  });

  it('region-scope non-overridable block: predicted disabled, real refused, for admin (control — company/scope still freezes)', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect', isNonOverridable: false, reasonCode: 'policy_unknown_cold_start' };
    const regionBlock = { outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance', scopeType: 'region', scopeKey: 'region:india' };
    state.rootRow = root;
    state.allActiveRows = [root, regionBlock];
    const item = itemFor(root, { isNonOverridable: true, nonOverridableScopeKey: 'region:india', nonOverridableBlockKind: 'company_scope' });

    expect(predicted(item, 'approve_queue', 'admin')).toBe(false);
    expect(await realOutcome('approve_queue', 'admin')).toBe('refused');
  });

  it('P8B-1 cross-check — specific_signal non-overridable block does NOT freeze company-level actions: predicted enabled, real succeeds, for admin', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect', isNonOverridable: false, reasonCode: 'policy_unknown_cold_start' };
    const signalBlock = { outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance', scopeType: 'specific_signal', scopeKey: 'specific_signal:11111111-1111-1111-1111-111111111111' };
    state.rootRow = root;
    state.allActiveRows = [root, signalBlock];
    // isNonOverridable stays false at the item level per the policy lane's design (only company_scope blocks flip it).
    const item = itemFor(root, { isNonOverridable: false, nonOverridableScopeKey: null, nonOverridableBlockKind: 'signal' });

    expect(predicted(item, 'approve_queue', 'admin')).toBe(true);
    expect(await realOutcome('approve_queue', 'admin')).toBe('succeeded');
  });

  it('blocked root + non-admin: predicted disabled ("requires admin"), real refused, for team_lead', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'blocked', externalHiringPolicy: 'no_hire', relationshipType: 'new_prospect', isNonOverridable: false, blockClass: 'standard', reasonCode: 'quality_block' };
    state.rootRow = root;
    state.allActiveRows = [root];
    const item = itemFor(root, {});

    expect(predicted(item, 'resume', 'team_lead')).toBe(false);
    expect(await realOutcome('resume', 'team_lead')).toBe('refused');
  });

  it('blocked root + admin: predicted enabled, real succeeds (admin may override a standard block)', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'blocked', externalHiringPolicy: 'no_hire', relationshipType: 'new_prospect', isNonOverridable: false, blockClass: 'standard', reasonCode: 'quality_block' };
    state.rootRow = root;
    state.allActiveRows = [root];
    const item = itemFor(root, {});

    expect(predicted(item, 'resume', 'admin')).toBe(true);
    expect(await realOutcome('resume', 'admin')).toBe('succeeded');
  });

  it('already-eligible: predicted disabled ("already recorded"), real refused, for admin', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'eligible', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect', isNonOverridable: false, reasonCode: 'policy_unknown_cold_start' };
    state.rootRow = root;
    state.allActiveRows = [root];
    const item = itemFor(root, {});

    expect(predicted(item, 'approve_queue', 'admin')).toBe(false);
    expect(await realOutcome('approve_queue', 'admin')).toBe('refused');
  });

  it('set_review_date with an unresolved dimension: predicted disabled, real refused, for admin', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'needs_review', externalHiringPolicy: null, relationshipType: 'new_prospect', isNonOverridable: false, reasonCode: 'policy_unknown_cold_start' };
    state.rootRow = root;
    state.allActiveRows = [root];
    const item = itemFor(root, { externalHiringPolicy: null });

    expect(predicted(item, 'set_review_date', 'admin')).toBe(false);
    expect(await realOutcome('set_review_date', 'admin')).toBe('refused');
  });

  it('set_review_date with every dimension resolved: predicted enabled, real succeeds, for admin', async () => {
    const root = { id: 'policy-1', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect', isNonOverridable: false, reasonCode: 'policy_unknown_cold_start' };
    state.rootRow = root;
    state.allActiveRows = [root];
    const item = itemFor(root, {});

    expect(predicted(item, 'set_review_date', 'admin')).toBe(true);
    expect(await realOutcome('set_review_date', 'admin')).toBe('succeeded');
  });
});
