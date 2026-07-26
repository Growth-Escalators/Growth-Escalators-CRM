// PRD-005 §8.6, §8.7, §8.9, §8.10 — contract tests for the outreach gate's
// terminal decision assembly, added by the PR 2 Opus review.
//
// The existing wizmatchOutreachGate.test.ts mock ignores `.where()` entirely,
// so it structurally cannot detect a wrong or missing query predicate. The mock
// here captures the predicate, which is what makes the suppression-normalisation
// assertion below able to fail.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  contactRows: [] as any[],
  suppressionRows: [] as any[],
  enrolmentRows: [] as any[],
  companyRows: [] as any[],
  duplicateRows: [] as any[],
  capturedWhere: new Map<unknown, unknown>(),
}));

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            state.capturedWhere.set(table, condition);
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

import { evaluateWizmatchOutreachGate } from '../modules/outreach/outreachGate';
import { wizmatchCompanyDuplicates, wizmatchSuppressionList } from '../db/schema';
import type { PolicyDecision, PolicyDecisionFields } from '../modules/outreach/policyTypes';

/** Collects every literal SQL fragment out of a drizzle condition tree. */
function sqlFragments(node: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  if (seen.has(node as object)) return [];
  seen.add(node as object);

  const out: string[] = [];
  for (const value of Object.values(node as Record<string, unknown>)) {
    out.push(...sqlFragments(value, seen));
  }
  return out;
}

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

const ctx = { tenantId: 'tenant-1', action: 'enrol' as const, companyId: 'company-1' };

beforeEach(() => {
  state.policyRows = [rootPolicy()];
  state.contactRows = [];
  state.suppressionRows = [];
  state.enrolmentRows = [];
  state.companyRows = [];
  state.duplicateRows = [];
  state.capturedWhere = new Map();
});

describe('L5 — duplicate suspects cannot enter active outreach (§8.8)', () => {
  it('denies while a duplicate is pending, but still permits preparation', async () => {
    state.duplicateRows = [{ detectionRule: 'domain' }];

    const decision = await evaluateWizmatchOutreachGate({ ...ctx, action: 'queue' });

    expect(decision.decision).toBe('deny');
    expect(decision.effectiveLevel).toBe(5);
    expect(decision.reasonCodes).toEqual(['duplicate_suspected_domain']);
    // §8.8: free preparation still runs while the pair is under review.
    expect(decision.preparationAllowed).toBe(true);
  });

  it('blocks export as well as queue', async () => {
    state.duplicateRows = [{ detectionRule: 'normalised_name' }];

    const decision = await evaluateWizmatchOutreachGate({ ...ctx, action: 'export' });

    expect(decision.decision).toBe('deny');
    expect(decision.reasonCodes).toEqual(['duplicate_suspected_name']);
  });

  it('checks both sides of the pair, not only company_a_id', async () => {
    // Pairs are stored ordered (company_a_id < company_b_id), so a company that
    // is only ever the "b" side would never be blocked by a one-sided lookup.
    await evaluateWizmatchOutreachGate(ctx);

    const condition = state.capturedWhere.get(wizmatchCompanyDuplicates);
    expect(condition).toBeDefined();
    expect(sqlFragments(condition).join('')).toContain(' or ');
  });

  it('does not block when the duplicate is already resolved', async () => {
    // The resolution filter is part of the query, so an empty result set is
    // what a resolved pair looks like to the gate.
    state.duplicateRows = [];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('allow');
  });
});

describe('§8.6 — "restricted is not uniformly denied"', () => {
  it('msp_vms_only denies but still reports the msp_vms research route it permits', async () => {
    state.policyRows = [rootPolicy({ externalHiringPolicy: 'msp_vms_only' })];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('deny');
    expect(decision.recommendedRoute).toBe('msp_vms_research');
    // Zeroing these would make §8.6's own table unreachable to the batch API.
    expect(decision.allowedCampaignTypes).toEqual(['msp_vms']);
    expect(decision.allowedOutreachModes).toEqual(['research_only']);
    expect(decision.reasonCodes).toEqual(['policy_msp_vms_only']);
  });

  it('direct_hiring_only denies cold outreach but still permits research_only', async () => {
    state.policyRows = [rootPolicy({ externalHiringPolicy: 'direct_hiring_only' })];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('deny');
    expect(decision.allowedOutreachModes).toEqual(['research_only']);
    expect(decision.allowedOutreachModes).not.toContain('cold_email');
  });

  it('no_external_agencies is the one hiring policy that permits nothing at all', async () => {
    state.policyRows = [rootPolicy({ externalHiringPolicy: 'no_external_agencies' })];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('deny');
    expect(decision.allowedOutreachModes).toEqual([]);
    expect(decision.allowedCampaignTypes).toEqual([]);
    expect(decision.preparationAllowed).toBe(false);
  });
});

describe('§8.7 — relationship routing', () => {
  it('existing_client denies cold outreach, keeps account_managed and names the account owner', async () => {
    state.policyRows = [rootPolicy({ relationshipType: 'existing_client' })];
    state.companyRows = [{ accountOwnerUserId: 'user-42' }];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('deny');
    expect(decision.recommendedRoute).toBe('account_owner');
    expect(decision.allowedOutreachModes).toEqual(['account_managed']);
    expect(decision.accountOwnerUserId).toBe('user-42');
    expect(decision.reasonCodes).toEqual(['relationship_existing_client']);
  });

  it('falls back to a null account owner rather than failing when none is assigned', async () => {
    state.policyRows = [rootPolicy({ relationshipType: 'existing_client' })];
    state.companyRows = [{ accountOwnerUserId: null }];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.accountOwnerUserId).toBeNull();
    expect(decision.recommendedRoute).toBe('account_owner');
  });

  it('former_client contributes the reengagement campaign type', async () => {
    state.policyRows = [rootPolicy({ relationshipType: 'former_client' })];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('review');
    expect(decision.allowedCampaignTypes).toContain('reengagement');
    expect(decision.reasonCodes).toEqual(['relationship_former_client']);
  });

  it('a permissive relationship never restores preparation the hiring policy removed', async () => {
    // no_external_agencies stops prep; existing_client alone would allow it.
    state.policyRows = [
      rootPolicy({ externalHiringPolicy: 'no_external_agencies', relationshipType: 'existing_client' }),
    ];
    state.companyRows = [{ accountOwnerUserId: null }];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.preparationAllowed).toBe(false);
  });
});

describe('§8.9 — reason codes name the real cause', () => {
  it('a preferred_vendors_only review is not reported as a cold-start unknown', async () => {
    state.policyRows = [rootPolicy({ externalHiringPolicy: 'preferred_vendors_only' })];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.decision).toBe('review');
    expect(decision.reasonCodes).toEqual(['policy_preferred_vendors_only']);
    expect(decision.requiresExplicitApproval).toBe(true);
  });

  it('an unknown hiring policy is the only one reported as policy_unknown_cold_start', async () => {
    state.policyRows = [rootPolicy({ externalHiringPolicy: 'unknown' })];

    const decision = await evaluateWizmatchOutreachGate(ctx);

    expect(decision.reasonCodes).toEqual(['policy_unknown_cold_start']);
  });
});

describe('L1c — non-overridable block at a narrower scope (§8.2)', () => {
  it('derives preparationAllowed from the taxonomy, not a hardcoded true', async () => {
    state.policyRows = [
      rootPolicy(),
      rootPolicy({
        id: 'policy-loc-1',
        scopeType: 'location',
        scopeKey: 'location:bengaluru',
        outreachEligibility: 'blocked',
        isNonOverridable: true,
        isPermanent: true,
        blockClass: 'compliance',
        // A company removal request scoped to one location still stops
        // preparation — continuing to enrich it is continued PII processing.
        reasonCode: 'company_removal_request',
        externalHiringPolicy: null,
        relationshipType: null,
      }),
    ];

    const decision = await evaluateWizmatchOutreachGate({ ...ctx, location: 'Bengaluru' });

    expect(decision.decision).toBe('deny');
    expect(decision.isNonOverridable).toBe(true);
    expect(decision.blockClass).toBe('compliance');
    expect(decision.preparationAllowed).toBe(false);
  });
});

describe('§8.10 — suppression union normalisation', () => {
  it('lowercases the stored column, not only the query input', async () => {
    await evaluateWizmatchOutreachGate({ ...ctx, email: 'Someone@Example.com' });

    const condition = state.capturedWhere.get(wizmatchSuppressionList);
    expect(condition).toBeDefined();
    // A row written by any path that bypasses normalizeChannelValue can carry
    // mixed case; without lower() on the column it would never match.
    expect(sqlFragments(condition).join('')).toContain('lower(');
  });

  it('reports a do_not_contact contact as an unsubscribe, never as a hard bounce', async () => {
    state.contactRows = [{ doNotContact: true }];

    const decision = await evaluateWizmatchOutreachGate({ ...ctx, contactId: 'contact-1' });

    expect(decision.decision).toBe('deny');
    expect(decision.effectiveLevel).toBe(7);
    // §8.5: an unsubscribe is a stated preference, a bounce is a channel fact.
    expect(decision.reasonCodes).toEqual(['email_unsubscribed']);
  });

  it('maps a suppression row to its own reason, not a blanket hard bounce', async () => {
    state.suppressionRows = [{ reason: 'spam_complaint' }];

    const decision = await evaluateWizmatchOutreachGate({ ...ctx, email: 'a@b.com' });

    expect(decision.reasonCodes).toEqual(['email_spam_complaint']);
  });

  it('still reports a genuine hard bounce as one', async () => {
    state.suppressionRows = [{ reason: 'hard_bounce' }];

    const decision = await evaluateWizmatchOutreachGate({ ...ctx, email: 'a@b.com' });

    expect(decision.reasonCodes).toEqual(['email_hard_bounce']);
  });
});

describe('§8.10 rule 3 — PolicyDecision is unforgeable', () => {
  it('cannot be constructed outside the gate module', () => {
    // Checked by tsc during `npm run build` (tsconfig includes src/**/*). The
    // brand key is a module-private `unique symbol`, so this object literal —
    // complete in every other respect — cannot satisfy PolicyDecision. If the
    // brand ever regresses to a plain string field this line compiles and tsc
    // fails with "Unused '@ts-expect-error' directive".
    // `__brand` is deliberately present: this is the exact object that DID
    // satisfy PolicyDecision under the previous string-field brand, so the
    // assertion below discriminates between the two designs rather than
    // passing either way.
    const fields: PolicyDecisionFields & { __brand: 'WizmatchPolicyDecision' } = {
      __brand: 'WizmatchPolicyDecision',
      decision: 'allow',
      recommendedRoute: 'standard_outreach',
      allowedCampaignTypes: [],
      allowedOutreachModes: [],
      reasonCodes: [],
      effectiveLevel: 8,
      effective: { outreachEligibility: null, externalHiringPolicy: null, relationshipType: null },
      blockClass: null,
      isNonOverridable: false,
      preparationAllowed: true,
      requiresExplicitApproval: false,
      accountOwnerUserId: null,
      evidence: null,
      enforcementMode: 'shadow',
    };

    // @ts-expect-error — the brand key is a module-private unique symbol, so no
    // object assembled outside policyTypes.ts can satisfy PolicyDecision.
    const forged: PolicyDecision = fields;

    expect(forged.decision).toBe('allow');
  });
});
