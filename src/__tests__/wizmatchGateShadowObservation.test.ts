// PRD-005 §16 rule 2 / §21.1, D-34 (owner-ratified 2026-07-26) — `shouldBlock`
// must persist a tenant-safe, idempotent, queryable shadow would-block
// observation to `audit_events` (migration 0010, already applied), not only
// log it to the console. This is a regression test for that: before this
// fix, `shouldBlock` only called `console.warn`, so the readiness report's
// "shadow would-have-blocked" number was a live snapshot with nothing
// persisted to consume across the whole shadow period.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existingAuditRows: [] as any[],
  auditInserts: [] as any[],
}));

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => Promise.resolve(table === actualSchema.auditEvents ? state.existingAuditRows : []),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (vals: any) => {
          if (table === actualSchema.auditEvents) state.auditInserts.push(vals);
          return Promise.resolve(undefined);
        },
      }),
    },
  };
});

import { shouldBlock } from '../modules/outreach/outreachGate';
import type { PolicyDecision } from '../modules/outreach/policyTypes';

function fakeDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    decision: 'deny',
    recommendedRoute: 'none',
    allowedCampaignTypes: [],
    allowedOutreachModes: [],
    reasonCodes: ['policy_missing_root'],
    effectiveLevel: 0,
    effective: { outreachEligibility: null, externalHiringPolicy: null, relationshipType: null },
    blockClass: null,
    isNonOverridable: false,
    preparationAllowed: false,
    requiresExplicitApproval: false,
    accountOwnerUserId: null,
    evidence: null,
    enforcementMode: 'shadow',
    ...overrides,
  } as unknown as PolicyDecision;
}

const ctx = { tenantId: 'tenant-1', action: 'enrol' as const, companyId: 'company-1' };

/** Lets the fire-and-forget promise inside shouldBlock settle before assertions. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  state.existingAuditRows = [];
  state.auditInserts = [];
});

describe('D-34 — shouldBlock persists a shadow observation', () => {
  it('inserts an audit_events row for a shadow would-block', async () => {
    const decision = fakeDecision();
    const blocked = shouldBlock(ctx, decision);
    expect(blocked).toBe(false); // shadow never blocks
    await flushMicrotasks();

    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0]).toMatchObject({
      tenantId: 'tenant-1',
      action: 'wizmatch_gate_denied_shadow',
      resourceType: 'wizmatch_company',
      resourceId: 'company-1',
    });
    expect(state.auditInserts[0].metadata).toMatchObject({ reasonCode: 'policy_missing_root' });
  });

  it('is idempotent — an existing row for the same fact means no second insert', async () => {
    state.existingAuditRows = [{ id: 'existing-row' }];
    shouldBlock(ctx, fakeDecision());
    await flushMicrotasks();
    expect(state.auditInserts).toHaveLength(0);
  });

  it('does not persist anything in enforce mode (only shadow observes)', async () => {
    shouldBlock(ctx, fakeDecision({ enforcementMode: 'enforce' } as any));
    await flushMicrotasks();
    expect(state.auditInserts).toHaveLength(0);
  });

  it('does not persist an allow decision', async () => {
    shouldBlock(ctx, fakeDecision({ decision: 'allow', reasonCodes: [] } as any));
    await flushMicrotasks();
    expect(state.auditInserts).toHaveLength(0);
  });
});
