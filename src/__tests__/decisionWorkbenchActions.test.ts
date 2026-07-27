// PRD-005 PR 6 §12 "Decision workbench" — POST /api/wizmatch/today/actions
// orchestration. This suite mocks the underlying write services
// (policyService, duplicateService, policyResolver) at the function level so
// it exercises ONLY decisionWorkbenchActions.ts's own logic: whole-request
// validation, per-target dispatch, and "never silently partial-succeed".
// Those underlying services already have their own dedicated test suites
// (wizmatchPolicyService.test.ts, duplicateService tests) proving the write
// path itself is tenant-safe and supersession-correct — this file does not
// re-prove that, it proves the workbench calls them correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
  writeCompanyPolicy: [] as unknown[][],
  assignAccountOwner: [] as unknown[][],
  resolveDuplicate: [] as unknown[][],
}));

const state = vi.hoisted(() => ({
  rootRow: { outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' } as Record<string, unknown> | null,
  writeShouldThrow: null as Error | null,
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
      if (state.writeShouldThrow) throw state.writeShouldThrow;
      return { id: 'policy-1' };
    },
    assignAccountOwner: async (...args: unknown[]) => {
      calls.assignAccountOwner.push(args);
      return { companyId: args[1], ownerUserId: args[2] };
    },
  };
});

vi.mock('../modules/outreach/duplicateService', () => {
  class DuplicateValidationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    DuplicateValidationError,
    resolveDuplicate: async (...args: unknown[]) => {
      calls.resolveDuplicate.push(args);
      if (args[1] === 'stale-duplicate') throw new DuplicateValidationError('Already resolved.', 'already_resolved');
      return { id: args[1] };
    },
  };
});

vi.mock('../modules/outreach/policyResolver', async (importOriginal) => ({
  // The scope-type predicates are pure functions with no DB access and are the
  // very thing under test here — mocking them would make every assertion below
  // vacuous. Only the DB-touching resolver is replaced.
  ...(await importOriginal<typeof import('../modules/outreach/policyResolver')>()),
  resolveEffectivePolicy: async () => ({
    rootRow: state.rootRow,
    // PR 8A hardening — the action layer now scans ALL active rows (not only
    // the root) for a narrower non-overridable block (ADR-006 D-17/L1c). The
    // default fixture has no narrower rows, so this is just the root itself.
    allActiveRows: state.rootRow ? [state.rootRow] : [],
  }),
}));

import { runTodayActions, TodayActionValidationError } from '../modules/outreach/decisionWorkbenchActions';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };

beforeEach(() => {
  vi.restoreAllMocks();
  calls.writeCompanyPolicy.length = 0;
  calls.assignAccountOwner.length = 0;
  calls.resolveDuplicate.length = 0;
  state.rootRow = { outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' };
  state.writeShouldThrow = null;
});

describe('runTodayActions — whole-request validation (reject mixed/invalid selections)', () => {
  it('rejects an empty targets array', async () => {
    await expect(runTodayActions(actor, { action: 'approve_queue', targets: [] })).rejects.toBeInstanceOf(TodayActionValidationError);
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });

  it('rejects a "merge" request whose targets are company-typed, not duplicate-typed', async () => {
    await expect(
      runTodayActions(actor, { action: 'merge', targets: [{ type: 'company', id: 'company-1' }] }),
    ).rejects.toMatchObject({ code: 'mixed_invalid_targets' });
    expect(calls.resolveDuplicate).toHaveLength(0);
  });

  it('rejects block/reject with no evidence', async () => {
    await expect(
      runTodayActions(actor, { action: 'block', targets: [{ type: 'company', id: 'company-1' }], reasonCode: 'manual_block_by_operator' }),
    ).rejects.toMatchObject({ code: 'evidence_required' });
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });

  it('rejects pause with no reviewDate', async () => {
    await expect(
      runTodayActions(actor, { action: 'pause', targets: [{ type: 'company', id: 'company-1' }] }),
    ).rejects.toMatchObject({ code: 'review_date_required' });
  });

  it('rejects assign_owner with no ownerUserId', async () => {
    await expect(
      runTodayActions(actor, { action: 'assign_owner', targets: [{ type: 'company', id: 'company-1' }] }),
    ).rejects.toMatchObject({ code: 'owner_user_id_required' });
  });
});

describe('runTodayActions — per-target results (never silently partial-succeed)', () => {
  it('reports one success and one failure independently for a mixed-outcome batch', async () => {
    // company-2 has no root policy row (structurally the L0 case) — its
    // write must fail without preventing company-1 from succeeding.
    let call = 0;
    vi.spyOn(await import('../modules/outreach/policyResolver'), 'resolveEffectivePolicy').mockImplementation(async () => {
      call += 1;
      const rootRow = call === 1 ? state.rootRow : null;
      return { rootRow, allActiveRows: rootRow ? [rootRow] : [] } as never;
    });

    const outcome = await runTodayActions(actor, {
      action: 'approve_queue',
      targets: [
        { type: 'company', id: 'company-1' },
        { type: 'company', id: 'company-2' },
      ],
    });

    expect(outcome.requested).toBe(2);
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
    const byId = Object.fromEntries(outcome.results.map((r) => [r.id, r]));
    expect(byId['company-1'].ok).toBe(true);
    expect(byId['company-2'].ok).toBe(false);
    expect(byId['company-2'].code).toBe('policy_missing_root');
  });

  it('surfaces a PolicyOverrideRefusedError as a per-target failure, not a thrown/aborted request', async () => {
    const { PolicyOverrideRefusedError } = await import('../modules/outreach/policyService');
    state.writeShouldThrow = new PolicyOverrideRefusedError('Predecessor is non-overridable.');

    const outcome = await runTodayActions(actor, {
      action: 'approve_queue',
      targets: [{ type: 'company', id: 'company-1' }],
    });

    expect(outcome.succeeded).toBe(0);
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('override_refused');
  });

  it('rejects a stale (already-resolved) duplicate per-target without aborting the batch', async () => {
    const outcome = await runTodayActions(actor, {
      action: 'confirm_separate',
      targets: [
        { type: 'duplicate', id: 'dup-1' },
        { type: 'duplicate', id: 'stale-duplicate' },
      ],
    });

    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
    const byId = Object.fromEntries(outcome.results.map((r) => [r.id, r]));
    expect(byId['dup-1'].ok).toBe(true);
    expect(byId['stale-duplicate'].code).toBe('already_resolved');
  });
});

// PRD-005 §4 distinguishes "write a policy row (approve/pause/block/reclassify)"
// (team_lead) from "Admin override of a `standard` block" (admin) by the
// PREDECESSOR state, which the route cannot see. Before this gate a team_lead
// could one-click "Approve & Queue" a blocked company to `eligible` with no
// evidence, because writeCompanyPolicy only refuses non-overridable rows — while
// the queues endpoint told the operator "Reclassify requires an admin".
describe('runTodayActions — overriding a block requires admin (PRD-005 §4)', () => {
  const blockedRoot = { outreachEligibility: 'blocked', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect', isPermanent: true, blockClass: 'standard' };

  it('refuses a team_lead approve_queue against a BLOCKED company, per-target, with no write', async () => {
    state.rootRow = { ...blockedRoot };
    const outcome = await runTodayActions(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'team_lead' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('requires_admin_override');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });

  it('allows an admin to do the same', async () => {
    state.rootRow = { ...blockedRoot };
    const outcome = await runTodayActions(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'admin' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.succeeded).toBe(1);
    expect(calls.writeCompanyPolicy).toHaveLength(1);
  });

  it('still lets a team_lead act on a NON-blocked company', async () => {
    state.rootRow = { outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' };
    const outcome = await runTodayActions(
      { tenantId: 'tenant-1', userId: 'user-1', role: 'team_lead' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.succeeded).toBe(1);
  });
});

describe('runTodayActions — the predecessor row is preserved, not rebuilt from the request', () => {
  it('carries isPermanent, blockClass and evidence forward on set_review_date', async () => {
    state.rootRow = {
      outreachEligibility: 'blocked',
      externalHiringPolicy: 'unknown',
      relationshipType: 'new_prospect',
      isPermanent: true,
      blockClass: 'compliance',
      reasonCode: 'company_removal_request',
      evidenceKind: 'human_text',
      evidenceText: 'Legal asked us to stop.',
    };
    await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'set_review_date', targets: [{ type: 'company', id: 'company-1' }], reviewDate: '2026-09-01' },
    );
    const [, , input] = calls.writeCompanyPolicy[0] as [unknown, unknown, Record<string, unknown>];
    // Without this, writeCompanyPolicy's defaults silently downgraded a
    // permanent compliance block to a temporary standard one and dropped its
    // evidence — on an action as innocuous as setting a review date.
    expect(input.isPermanent).toBe(true);
    expect(input.blockClass).toBe('compliance');
    expect(input.evidenceText).toBe('Legal asked us to stop.');
    expect(input.outreachEligibility).toBe('blocked');
    // PR 8A hardening — set_review_date must never swap in the generic
    // manual_reclassified default; the predecessor's own reasonCode drives
    // `isPreparationAllowed` at the next gate evaluation and must survive
    // exactly, or a compliance block's preparation-stop silently lifts.
    expect(input.reasonCode).toBe('company_removal_request');
  });

  it('refuses set_review_date fail-closed when the root row is missing a required dimension', async () => {
    state.rootRow = {
      outreachEligibility: 'needs_review',
      externalHiringPolicy: 'unknown',
      relationshipType: 'new_prospect',
      // reasonCode deliberately absent — set_review_date must refuse rather
      // than invent one.
    };
    const outcome = await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'set_review_date', targets: [{ type: 'company', id: 'company-1' }], reviewDate: '2026-09-01' },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('policy_dimension_unresolved');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });
});

describe('runTodayActions — action -> write mapping', () => {
  it('approve_queue carries forward the existing externalHiringPolicy/relationshipType unchanged', async () => {
    state.rootRow = { outreachEligibility: 'needs_review', externalHiringPolicy: 'accepts_external_vendors', relationshipType: 'existing_prospect' };
    await runTodayActions(actor, { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] });
    const [, , input] = calls.writeCompanyPolicy[0] as [unknown, unknown, Record<string, unknown>];
    expect(input.outreachEligibility).toBe('eligible');
    expect(input.externalHiringPolicy).toBe('accepts_external_vendors');
    expect(input.relationshipType).toBe('existing_prospect');
    expect(input.scopeType).toBe('entire_company');
  });

  it('assign_owner never fetches a root policy row (owner assignment is policy-independent)', async () => {
    const resolver = await import('../modules/outreach/policyResolver');
    const spy = vi.spyOn(resolver, 'resolveEffectivePolicy');
    await runTodayActions(actor, { action: 'assign_owner', targets: [{ type: 'company', id: 'company-1' }], ownerUserId: 'user-9' });
    expect(spy).not.toHaveBeenCalled();
    expect(calls.assignAccountOwner).toHaveLength(1);
    expect(calls.assignAccountOwner[0][1]).toBe('company-1');
    expect(calls.assignAccountOwner[0][2]).toBe('user-9');
  });

  it('block requires evidence and writes outreachEligibility=blocked', async () => {
    await runTodayActions(actor, {
      action: 'block',
      targets: [{ type: 'company', id: 'company-1' }],
      reasonCode: 'manual_block_by_operator',
      evidenceKind: 'human_text',
      evidenceText: 'Company asked to stop being contacted.',
    });
    const [, , input] = calls.writeCompanyPolicy[0] as [unknown, unknown, Record<string, unknown>];
    expect(input.outreachEligibility).toBe('blocked');
    expect(input.evidenceText).toBe('Company asked to stop being contacted.');
  });

  it('merge resolves the duplicate with resolution=merged', async () => {
    await runTodayActions(actor, { action: 'merge', targets: [{ type: 'duplicate', id: 'dup-1' }], reasonCode: 'manual_reclassified' });
    const [, , input] = calls.resolveDuplicate[0] as [unknown, unknown, Record<string, unknown>];
    expect(input.resolution).toBe('merged');
  });
});

// PR 8A hardening — approval provenance (task 1): approve_queue requires a
// real actor and must not be silently re-appliable.
describe('runTodayActions — approval provenance and idempotency', () => {
  it('rejects approve_queue with no authenticated actor userId', async () => {
    const outcome = await runTodayActions(
      { tenantId: 'tenant-1' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('actor_required');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });

  it('safely rejects a repeat approve_queue on an already-eligible company instead of re-writing', async () => {
    state.rootRow = { outreachEligibility: 'eligible', externalHiringPolicy: 'accepts_external_vendors', relationshipType: 'new_prospect' };
    const outcome = await runTodayActions(actor, { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] });
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('already_approved');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });
});

// PR 8A hardening (task 3) — a non-overridable block at ANY active scope must
// refuse every unblocking action, for every role including admin.
describe('runTodayActions — non-overridable block at any scope (ADR-006 D-17/L1c)', () => {
  it('refuses approve_queue when a NARROWER row (not the root) is non-overridable-blocked, even for admin', async () => {
    state.rootRow = { id: 'policy-root', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' };
    vi.spyOn(await import('../modules/outreach/policyResolver'), 'resolveEffectivePolicy').mockResolvedValue({
      rootRow: state.rootRow,
      allActiveRows: [
        state.rootRow,
        {
          id: 'policy-region-india',
          scopeKey: 'region:india',
          outreachEligibility: 'blocked',
          isNonOverridable: true,
          blockClass: 'compliance',
        },
      ],
    } as never);

    const outcome = await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('non_overridable_block_at_scope');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });
});

// P8B-1 (owner-ratified) — a PRD-005 §8.2 L4 block denies only the affected
// signal/requirement. It must NOT freeze the company's own review, preparation,
// assignment, review-date or policy actions, and must never silently become a
// permanent company-wide block. The §8.2 L1c company/BU/location case is
// unchanged and is the control below.
describe('runTodayActions — an L4 signal/requirement block does not freeze company-level actions', () => {
  async function mockActiveRows(rows: unknown[]) {
    state.rootRow = {
      id: 'policy-root',
      scopeType: 'entire_company',
      scopeKey: 'entire_company',
      outreachEligibility: 'needs_review',
      externalHiringPolicy: 'unknown',
      relationshipType: 'new_prospect',
    };
    vi.spyOn(await import('../modules/outreach/policyResolver'), 'resolveEffectivePolicy').mockResolvedValue({
      rootRow: state.rootRow,
      allActiveRows: [state.rootRow, ...rows],
    } as never);
  }

  const signalBlock = {
    id: 'policy-signal-1',
    scopeType: 'specific_signal',
    scopeKey: 'specific_signal:11111111-1111-4111-8111-111111111111',
    outreachEligibility: 'blocked',
    isNonOverridable: true,
    blockClass: 'compliance',
  };

  const requirementBlock = {
    id: 'policy-req-1',
    scopeType: 'specific_requirement',
    scopeKey: 'specific_requirement:22222222-2222-4222-8222-222222222222',
    outreachEligibility: 'blocked',
    isNonOverridable: true,
    blockClass: 'compliance',
  };

  it('allows approve_queue as admin when the only non-overridable block is scoped to one signal', async () => {
    await mockActiveRows([signalBlock]);
    const outcome = await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.results[0].error).toBeUndefined();
    expect(outcome.succeeded).toBe(1);
    expect(calls.writeCompanyPolicy).toHaveLength(1);
  });

  it('allows pause/resume/skip too — an L4 block freezes no company-level action', async () => {
    for (const action of ['resume', 'skip'] as const) {
      calls.writeCompanyPolicy.length = 0;
      await mockActiveRows([requirementBlock]);
      const outcome = await runTodayActions(
        { ...actor, role: 'admin' },
        { action, targets: [{ type: 'company', id: 'company-1' }] },
      );
      expect(outcome.results[0].error, `action '${action}' must not be frozen by an L4 block`).toBeUndefined();
      expect(outcome.succeeded).toBe(1);
    }
  });

  // CONTROL — must fail identically before and after the P8B-1 fix. Proves the
  // guard was narrowed by scope type only, not loosened generally.
  it('still refuses approve_queue for a region-scoped non-overridable block, even for admin', async () => {
    await mockActiveRows([
      {
        id: 'policy-region-india',
        scopeType: 'region',
        scopeKey: 'region:india',
        outreachEligibility: 'blocked',
        isNonOverridable: true,
        blockClass: 'compliance',
      },
    ]);
    const outcome = await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('non_overridable_block_at_scope');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });

  // CONTROL — a company/BU-scoped block co-existing with an L4 one still wins.
  it('refuses when a business_unit block co-exists with the signal block', async () => {
    await mockActiveRows([
      signalBlock,
      {
        id: 'policy-bu-1',
        scopeType: 'business_unit',
        scopeKey: 'business_unit:gcc',
        outreachEligibility: 'blocked',
        isNonOverridable: true,
        blockClass: 'legal',
      },
    ]);
    const outcome = await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('non_overridable_block_at_scope');
  });

  // Fail-closed: a row whose scope type could not be read is NOT assumed to be
  // signal-scoped. Unknown provenance freezes the company action, per P8B-1's
  // "never silently allow" clause.
  it('still refuses when the blocking row carries no readable scope type', async () => {
    await mockActiveRows([
      { id: 'policy-unknown', scopeKey: 'region:india', outreachEligibility: 'blocked', isNonOverridable: true, blockClass: 'compliance' },
    ]);
    const outcome = await runTodayActions(
      { ...actor, role: 'admin' },
      { action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] },
    );
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('non_overridable_block_at_scope');
  });
});

// PR 8A hardening (task 5) — stale-state protection.
describe('runTodayActions — stale-state protection', () => {
  it('rejects an action whose expectedPolicyId does not match the current root policy id', async () => {
    state.rootRow = { id: 'policy-current', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' };
    const outcome = await runTodayActions(actor, {
      action: 'approve_queue',
      targets: [{ type: 'company', id: 'company-1' }],
      expectedPolicyId: 'policy-stale',
    });
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0].code).toBe('stale_policy_state');
    expect(calls.writeCompanyPolicy).toHaveLength(0);
  });

  it('allows the action when expectedPolicyId matches the current root policy id', async () => {
    state.rootRow = { id: 'policy-current', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' };
    const outcome = await runTodayActions(actor, {
      action: 'approve_queue',
      targets: [{ type: 'company', id: 'company-1' }],
      expectedPolicyId: 'policy-current',
    });
    expect(outcome.succeeded).toBe(1);
  });

  it('does not require expectedPolicyId — omitting it preserves the existing re-validation behaviour', async () => {
    state.rootRow = { id: 'policy-current', outreachEligibility: 'needs_review', externalHiringPolicy: 'unknown', relationshipType: 'new_prospect' };
    const outcome = await runTodayActions(actor, {
      action: 'approve_queue',
      targets: [{ type: 'company', id: 'company-1' }],
    });
    expect(outcome.succeeded).toBe(1);
  });
});
