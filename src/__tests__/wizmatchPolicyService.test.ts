// PRD-005 PR 4 — policy read/write service tests.
//
// Follows the predicate-capture mock idiom from wizmatchOutreachGateContract.test.ts
// (NOT the discard-the-`.where()` pattern in wizmatchOutreachGate.test.ts /
// wizmatchLinkage.test.ts — see docs/reviews/wizmatch-outbound-pr3-opus-review.md
// finding M-5/L-6). `.where()` predicates are captured per table so a test can
// assert on tenant scoping and the active-row filter, not just on a canned
// return value.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  companyRows: [] as any[],
  usersRows: [] as any[],
  /** H-10 fixtures: the scope-ref rows the company-agreement invariant reads. */
  signalRows: [] as any[],
  requirementRows: [] as any[],
  policyEventInserts: [] as any[],
  staffingEventInserts: [] as any[],
  auditLogCalls: [] as any[],
  capturedWhere: new Map<string, unknown[]>(),
  nextId: 1,
}));

function makeThenable<T>(getValue: () => T) {
  const obj: any = {
    then: (resolve: any, reject: any) => Promise.resolve(getValue()).then(resolve, reject),
    orderBy: () => obj,
  };
  return obj;
}

/** Extracts only the drizzle `Param` (bound-value) leaves from a condition
 * tree, so the mock can actually filter by the real query values instead of
 * discarding the predicate (the M-5/L-6 class of bug the PR3 review flagged).
 * Deliberately NOT a generic string-leaf walk: every column object carries a
 * circular `.table` back-reference to ALL sibling columns, so a naive walk
 * also picks up unrelated columns' `.default` values (e.g. a `resolution`
 * column's `'pending'` default leaking into a query that never touches that
 * column) — verified empirically. Skipping the `table` key and matching only
 * on the `Param` constructor avoids that pollution. */
function paramValues(node: unknown, seen = new WeakSet<object>()): string[] {
  if (node === null || typeof node !== 'object') return [];
  if (seen.has(node as object)) return [];
  seen.add(node as object);
  const out: string[] = [];
  const ctorName = (node as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === 'Param' && typeof (node as { value?: unknown }).value === 'string') {
    out.push((node as { value: string }).value);
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'table') continue;
    out.push(...paramValues(value, seen));
  }
  return out;
}

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');

  function captureWhere(tableName: string, condition: unknown) {
    const list = state.capturedWhere.get(tableName) ?? [];
    list.push(condition);
    state.capturedWhere.set(tableName, list);
  }

  const dbLike: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          if (table === actualSchema.wizmatchCompanyPolicies) {
            captureWhere('wizmatchCompanyPolicies', condition);
            const values = new Set(paramValues(condition));
            return makeThenable(() =>
              state.policyRows.filter(
                (r) => r.supersededAt == null && values.has(r.tenantId) && values.has(r.companyId) && values.has(r.scopeKey),
              ),
            );
          }
          if (table === actualSchema.wizmatchCompanies) {
            captureWhere('wizmatchCompanies', condition);
            const values = new Set(paramValues(condition));
            return makeThenable(() => state.companyRows.filter((r) => values.has(r.tenantId) && values.has(r.id)));
          }
          if (table === actualSchema.users) {
            captureWhere('users', condition);
            const values = new Set(paramValues(condition));
            return makeThenable(() => state.usersRows.filter((r) => values.has(r.id) && values.has(r.tenantId)));
          }
          if (table === actualSchema.wizmatchCompanyPolicyEvents) {
            captureWhere('wizmatchCompanyPolicyEvents', condition);
            return makeThenable(() => state.policyEventInserts);
          }
          if (table === actualSchema.wizmatchJobSignals) {
            captureWhere('wizmatchJobSignals', condition);
            const values = new Set(paramValues(condition));
            return makeThenable(() => state.signalRows.filter((r) => values.has(r.tenantId) && values.has(r.id)));
          }
          if (table === actualSchema.wizmatchRequirements) {
            captureWhere('wizmatchRequirements', condition);
            const values = new Set(paramValues(condition));
            return makeThenable(() => state.requirementRows.filter((r) => values.has(r.tenantId) && values.has(r.id)));
          }
          return makeThenable(() => []);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: any) => {
        if (table === actualSchema.wizmatchCompanyPolicies) {
          const row = { id: `policy-${state.nextId++}`, supersededAt: null, supersededByPolicyId: null, ...vals };
          const inserted = makeThenable(() => [row]);
          inserted.returning = () => makeThenable(() => {
            // Enforce the real §10.1 partial unique index
            // `wizmatch_company_policies_active_scope_uniq` ON
            // (tenant_id, company_id, scope_key) WHERE superseded_at IS NULL.
            // A unique INDEX is non-deferrable, so Postgres rejects the second
            // active row at INSERT time, not at COMMIT. Without this the mock
            // accepts an insert-before-supersede ordering that cannot work
            // against a real database.
            const conflict = state.policyRows.find(
              (r) =>
                r.supersededAt == null &&
                r.tenantId === row.tenantId &&
                r.companyId === row.companyId &&
                r.scopeKey === row.scopeKey,
            );
            if (conflict) {
              const violation: any = new Error(
                'duplicate key value violates unique constraint "wizmatch_company_policies_active_scope_uniq"',
              );
              violation.code = '23505';
              throw violation;
            }
            state.policyRows.push(row);
            return [row];
          });
          return inserted;
        }
        if (table === actualSchema.wizmatchCompanyPolicyEvents) {
          state.policyEventInserts.push(vals);
          return makeThenable(() => []);
        }
        if (table === actualSchema.wizmatchStaffingEvents) {
          state.staffingEventInserts.push(vals);
          return makeThenable(() => []);
        }
        return makeThenable(() => []);
      },
    }),
    update: (table: unknown) => ({
      set: (vals: any) => ({
        where: (condition: unknown) => {
          const values = new Set(paramValues(condition));
          if (table === actualSchema.wizmatchCompanyPolicies) {
            captureWhere('updateWizmatchCompanyPolicies', condition);
            state.policyRows = state.policyRows.map((r) =>
              values.has(r.tenantId) && values.has(r.id) ? { ...r, ...vals } : r,
            );
          }
          if (table === actualSchema.wizmatchCompanies) {
            captureWhere('updateWizmatchCompanies', condition);
            state.companyRows = state.companyRows.map((r) =>
              values.has(r.tenantId) && values.has(r.id) ? { ...r, ...vals } : r,
            );
          }
          return makeThenable(() => []);
        },
      }),
    }),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(dbLike),
  };

  return { ...actualSchema, db: dbLike };
});

import {
  writeCompanyPolicy,
  writeCompanyPolicyOverride,
  assignAccountOwner,
  bulkWriteCompanyPolicy,
  PolicyValidationError,
  PolicyOverrideRefusedError,
  PolicyStaleStateError,
} from '../modules/outreach/policyService';

vi.mock('../services/auditLogger', () => ({
  auditLog: (...args: any[]) => {
    state.auditLogCalls.push(args);
    return Promise.resolve();
  },
}));

const actor = { tenantId: 'tenant-1', userId: 'user-1' };

beforeEach(() => {
  state.policyRows = [];
  state.companyRows = [{ id: 'company-1', tenantId: 'tenant-1', accountOwnerUserId: null }];
  state.usersRows = [];
  state.signalRows = [];
  state.requirementRows = [];
  state.policyEventInserts = [];
  state.staffingEventInserts = [];
  state.auditLogCalls = [];
  state.capturedWhere = new Map();
  state.nextId = 1;
});

describe('writeCompanyPolicy — evidence and inheritance validation', () => {
  it('rejects an entire_company row missing a dimension', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        // externalHiringPolicy / relationshipType missing
        reasonCode: 'manual_reclassified',
      } as any),
    ).rejects.toBeInstanceOf(PolicyValidationError);
  });

  it('rejects a scoped row that overrides no dimension', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'location',
        scopeRefLabel: 'bengaluru',
        reasonCode: 'policy_location_restricted',
      } as any),
    ).rejects.toMatchObject({ code: 'scoped_requires_one_dimension' });
  });

  it('rejects a non-overridable block with no evidence', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'blocked',
        externalHiringPolicy: 'no_external_agencies',
        relationshipType: 'irrelevant',
        isNonOverridable: true,
        reasonCode: 'company_removal_request',
      } as any),
    ).rejects.toMatchObject({ code: 'evidence_required' });
  });

  it('rejects a compliance block that is overridable', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'blocked',
        externalHiringPolicy: 'no_external_agencies',
        relationshipType: 'irrelevant',
        blockClass: 'compliance',
        isNonOverridable: false,
        evidenceKind: 'human_text',
        evidenceText: 'removal request',
        reasonCode: 'company_removal_request',
      } as any),
    ).rejects.toMatchObject({ code: 'block_class_requires_non_overridable' });
  });

  it('rejects a paused row with no reviewDate', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'paused',
        externalHiringPolicy: 'unknown',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_paused_by_owner',
      } as any),
    ).rejects.toMatchObject({ code: 'paused_requires_review_date' });
  });

  // PR 8A hardening — reasonCode had no taxonomy check at all; an unknown or
  // malformed value was stored as free text, and defeated `isPreparationAllowed`'s
  // now-fixed fail-closed default by presenting a code it had never seen.
  it('rejects a reasonCode that is not in the ratified §9 taxonomy', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        externalHiringPolicy: 'accepts_external_vendors',
        relationshipType: 'new_prospect',
        reasonCode: 'not_a_real_taxonomy_code',
      } as any),
    ).rejects.toMatchObject({ code: 'unknown_reason_code' });
  });

  it('accepts a valid root row and writes exactly one policy event', async () => {
    const row = await writeCompanyPolicy(actor, 'company-1', {
      scopeType: 'entire_company',
      outreachEligibility: 'eligible',
      externalHiringPolicy: 'accepts_external_vendors',
      relationshipType: 'new_prospect',
      reasonCode: 'policy_accepts_external_vendors',
      evidenceKind: 'human_text',
      evidenceText: 'confirmed on call',
    });
    expect(row.scopeKey).toBe('entire_company');
    expect(state.policyEventInserts).toHaveLength(1);
    expect(state.policyEventInserts[0].previousPolicyId).toBeNull();
  });
});

describe('writeCompanyPolicy — supersession', () => {
  it('supersedes the prior active row at the same scope_key and links it via supersededByPolicyId', async () => {
    const first = await writeCompanyPolicy(actor, 'company-1', {
      scopeType: 'entire_company',
      outreachEligibility: 'needs_review',
      externalHiringPolicy: 'unknown',
      relationshipType: 'new_prospect',
      reasonCode: 'policy_unknown_cold_start',
    });
    expect(state.policyRows).toHaveLength(1);

    const second = await writeCompanyPolicy(actor, 'company-1', {
      scopeType: 'entire_company',
      outreachEligibility: 'eligible',
      externalHiringPolicy: 'accepts_external_vendors',
      relationshipType: 'new_prospect',
      reasonCode: 'policy_accepts_external_vendors',
      evidenceKind: 'human_text',
      evidenceText: 'confirmed',
    });

    expect(second.id).not.toBe(first.id);
    expect(state.policyEventInserts).toHaveLength(2);
    expect(state.policyEventInserts[1].previousPolicyId).toBe(first.id);

    // The predecessor must actually be superseded and linked forward. Without
    // these three assertions the test passed even with the supersession UPDATE
    // deleted entirely, leaving two rows active at one scope_key.
    const predecessor = state.policyRows.find((r) => r.id === first.id);
    expect(predecessor.supersededAt).toBeInstanceOf(Date);
    expect(predecessor.supersededByPolicyId).toBe(second.id);
    expect(state.policyRows.filter((r) => r.supersededAt == null)).toHaveLength(1);
  });

  // PR 8A hardening (task 5) — stale-state protection, checked inside the
  // SAME transaction that reads the predecessor, not against a caller's
  // earlier, separate read.
  describe('expectedPolicyId precondition', () => {
    it('rejects a write whose expectedPolicyId does not match the current active row at this scope', async () => {
      const first = await writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'needs_review',
        externalHiringPolicy: 'unknown',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_unknown_cold_start',
      });
      expect(first.id).toBeTruthy();

      await expect(
        writeCompanyPolicy(actor, 'company-1', {
          scopeType: 'entire_company',
          outreachEligibility: 'eligible',
          externalHiringPolicy: 'accepts_external_vendors',
          relationshipType: 'new_prospect',
          reasonCode: 'policy_accepts_external_vendors',
          evidenceKind: 'human_text',
          evidenceText: 'confirmed',
          expectedPolicyId: 'a-different-policy-id',
        }),
      ).rejects.toBeInstanceOf(PolicyStaleStateError);
      // No new row and no supersession — the stale write must never partially apply.
      expect(state.policyRows.filter((r) => r.supersededAt == null)).toHaveLength(1);
    });

    it('accepts a write whose expectedPolicyId matches the current active row', async () => {
      const first = await writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'needs_review',
        externalHiringPolicy: 'unknown',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_unknown_cold_start',
      });

      const second = await writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        externalHiringPolicy: 'accepts_external_vendors',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_accepts_external_vendors',
        evidenceKind: 'human_text',
        evidenceText: 'confirmed',
        expectedPolicyId: first.id,
      });
      expect(second.id).not.toBe(first.id);
    });

    it('rejects a write against a scope that expected no active row (expectedPolicyId: null) but one now exists', async () => {
      await writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'needs_review',
        externalHiringPolicy: 'unknown',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_unknown_cold_start',
      });

      await expect(
        writeCompanyPolicy(actor, 'company-1', {
          scopeType: 'entire_company',
          outreachEligibility: 'eligible',
          externalHiringPolicy: 'accepts_external_vendors',
          relationshipType: 'new_prospect',
          reasonCode: 'policy_accepts_external_vendors',
          expectedPolicyId: null,
        }),
      ).rejects.toBeInstanceOf(PolicyStaleStateError);
    });

    it('omitting expectedPolicyId preserves the existing unconditional-supersede behaviour', async () => {
      await writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'needs_review',
        externalHiringPolicy: 'unknown',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_unknown_cold_start',
      });
      const second = await writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        externalHiringPolicy: 'accepts_external_vendors',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_accepts_external_vendors',
      });
      expect(second.id).toBeTruthy();
    });
  });

  it('refuses to supersede a predecessor with isNonOverridable = true, even via the override path', async () => {
    state.policyRows.push({
      id: 'policy-locked',
      tenantId: 'tenant-1',
      companyId: 'company-1',
      scopeType: 'entire_company',
      scopeKey: 'entire_company',
      isNonOverridable: true,
      blockClass: 'compliance',
      supersededAt: null,
    });

    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        externalHiringPolicy: 'accepts_external_vendors',
        relationshipType: 'new_prospect',
        reasonCode: 'policy_accepts_external_vendors',
      } as any),
    ).rejects.toBeInstanceOf(PolicyOverrideRefusedError);

    await expect(
      writeCompanyPolicyOverride(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        externalHiringPolicy: 'accepts_external_vendors',
        relationshipType: 'new_prospect',
        evidenceKind: 'human_text',
        evidenceText: 'admin says so',
      } as any),
    ).rejects.toBeInstanceOf(PolicyOverrideRefusedError);
  });
});

describe('writeCompanyPolicyOverride', () => {
  it('requires evidence even when the row is neither permanent nor non-overridable', async () => {
    await expect(
      writeCompanyPolicyOverride(actor, 'company-1', {
        scopeType: 'entire_company',
        outreachEligibility: 'eligible',
        externalHiringPolicy: 'accepts_external_vendors',
        relationshipType: 'new_prospect',
      } as any),
    ).rejects.toMatchObject({ code: 'evidence_required' });
  });

  it('forces reasonCode = manual_admin_override regardless of caller input', async () => {
    const row = await writeCompanyPolicyOverride(actor, 'company-1', {
      scopeType: 'entire_company',
      outreachEligibility: 'eligible',
      externalHiringPolicy: 'accepts_external_vendors',
      relationshipType: 'new_prospect',
      evidenceKind: 'human_text',
      evidenceText: 'owner approved',
    } as any);
    expect(row.reasonCode).toBe('manual_admin_override');
  });
});

describe('assignAccountOwner', () => {
  it('rejects a cross-tenant owner (composite-tenancy validation)', async () => {
    state.usersRows = []; // no user row matches (tenantId, ownerUserId)
    await expect(assignAccountOwner(actor, 'company-1', 'user-from-another-tenant')).rejects.toMatchObject({
      code: 'owner_cross_tenant',
    });
  });

  it('writes BOTH required events on a successful assignment: wizmatch_staffing_events and the audit log', async () => {
    state.usersRows = [{ id: 'owner-1', tenantId: 'tenant-1' }];
    const result = await assignAccountOwner(actor, 'company-1', 'owner-1');
    expect(result.ownerUserId).toBe('owner-1');
    expect(state.staffingEventInserts).toHaveLength(1);
    expect(state.staffingEventInserts[0].eventType).toBe('company_owner_changed');
    expect(state.auditLogCalls).toHaveLength(1);
    expect(state.auditLogCalls[0][0]).toMatchObject({ action: 'wizmatch_company_owner_changed', entityId: 'company-1' });
  });

  it('rejects a company not found in this tenant', async () => {
    state.companyRows = [];
    await expect(assignAccountOwner(actor, 'missing-company', null)).rejects.toMatchObject({ code: 'company_not_found' });
  });
});

describe('bulkWriteCompanyPolicy — count-first, partial-failure reporting', () => {
  it('reports success and failure per company without one failure discarding the rest', async () => {
    const input = {
      scopeType: 'entire_company' as const,
      outreachEligibility: 'blocked' as const,
      externalHiringPolicy: 'no_external_agencies' as const,
      relationshipType: 'irrelevant' as const,
      isNonOverridable: true,
      blockClass: 'compliance' as const,
      evidenceKind: 'human_text' as const,
      evidenceText: 'bulk removal request',
      reasonCode: 'company_removal_request',
    };
    // company-locked already has a non-overridable root row -> its write must fail
    // while company-1 (no existing row) succeeds.
    state.policyRows.push({
      id: 'policy-locked',
      tenantId: 'tenant-1',
      companyId: 'company-locked',
      scopeType: 'entire_company',
      scopeKey: 'entire_company',
      isNonOverridable: true,
      blockClass: 'compliance',
      supersededAt: null,
    });

    const result = await bulkWriteCompanyPolicy(actor, { companyIds: ['company-1', 'company-locked'], input });

    expect(result.requested).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.companyId === 'company-1')?.ok).toBe(true);
    expect(result.results.find((r) => r.companyId === 'company-locked')?.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H-8 / D-37, H-9, H-10 — the 2026-07-26 independent re-review found that all
// three had a code fix but ZERO regression tests, despite the fix pass
// claiming "H-2 through H-14 are each fixed with a dedicated regression test".
// Deleting any of the three guards left the suite green. These close that gap;
// each one fails if its guard is removed from policyService.ts.
// ---------------------------------------------------------------------------

function validRootInput(overrides: Record<string, unknown> = {}) {
  return {
    scopeType: 'entire_company',
    outreachEligibility: 'eligible',
    externalHiringPolicy: 'accepts_external_vendors',
    relationshipType: 'new_prospect',
    reasonCode: 'policy_accepts_external_vendors',
    evidenceKind: 'human_text',
    evidenceText: 'confirmed on call',
    ...overrides,
  } as any;
}

describe('H-8 / D-37 — every policy enum dimension fails CLOSED on an unknown value', () => {
  // Before this fix only hiring-policy/relationship threw; an out-of-vocabulary
  // `outreachEligibility` such as 'Blocked' fell through every literal equality
  // comparison in the gate and reached the terminal `allow` — a fail-OPEN block.
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['outreachEligibility', { outreachEligibility: 'Blocked' }, 'unknown_outreach_eligibility'],
    ['externalHiringPolicy', { externalHiringPolicy: 'no_agencies_pls' }, 'unknown_external_hiring_policy'],
    ['relationshipType', { relationshipType: 'friend_of_the_ceo' }, 'unknown_relationship_type'],
    ['blockClass', { blockClass: 'urgent' }, 'unknown_block_class'],
    ['evidenceKind', { evidenceKind: 'a_hunch' }, 'unknown_evidence_kind'],
  ];

  for (const [dimension, override, code] of cases) {
    it(`rejects an out-of-vocabulary ${dimension} instead of accepting it`, async () => {
      await expect(writeCompanyPolicy(actor, 'company-1', validRootInput(override))).rejects.toMatchObject({ code });
      expect(state.policyRows).toHaveLength(0);
    });
  }

  it('a casing variant of a real value is rejected, not silently coerced', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', validRootInput({ outreachEligibility: 'ELIGIBLE' })),
    ).rejects.toMatchObject({ code: 'unknown_outreach_eligibility' });
  });

  it('still accepts every value in each real vocabulary', async () => {
    for (const eligibility of ['eligible', 'needs_review', 'paused']) {
      state.policyRows = [];
      state.policyEventInserts = [];
      const row = await writeCompanyPolicy(
        actor,
        'company-1',
        validRootInput({
          outreachEligibility: eligibility,
          ...(eligibility === 'paused' ? { reviewDate: '2026-12-01' } : {}),
        }),
      );
      expect(row.outreachEligibility).toBe(eligibility);
    }
  });
});

describe('H-9 — evidence_url is SSRF-scrubbed before it is persisted', () => {
  const unsafe = [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/internal',
    'http://localhost/admin',
    'http://10.0.0.5/secret',
    'http://192.168.1.1/router',
  ];

  for (const url of unsafe) {
    it(`rejects ${url}`, async () => {
      await expect(
        writeCompanyPolicy(actor, 'company-1', validRootInput({ evidenceKind: 'source_url', evidenceUrl: url })),
      ).rejects.toMatchObject({ code: 'unsafe_evidence_url' });
      expect(state.policyRows).toHaveLength(0);
    });
  }

  it('accepts an ordinary public evidence URL and persists it verbatim', async () => {
    const row = await writeCompanyPolicy(
      actor,
      'company-1',
      validRootInput({ evidenceKind: 'source_url', evidenceUrl: 'https://careers.example.com/vendor-policy' }),
    );
    expect(row.evidenceUrl).toBe('https://careers.example.com/vendor-policy');
  });

  it('the scrub also covers the admin-override path, not just the plain write', async () => {
    state.policyRows = [
      {
        id: 'policy-existing',
        tenantId: 'tenant-1',
        companyId: 'company-1',
        scopeType: 'entire_company',
        scopeKey: 'entire_company',
        outreachEligibility: 'blocked',
        externalHiringPolicy: 'no_external_agencies',
        relationshipType: 'irrelevant',
        blockClass: 'standard',
        isNonOverridable: false,
        isPermanent: false,
        supersededAt: null,
      },
    ];
    await expect(
      writeCompanyPolicyOverride(
        { ...actor, role: 'admin' } as any,
        'company-1',
        validRootInput({
          evidenceKind: 'source_url',
          evidenceUrl: 'http://169.254.169.254/latest/meta-data/',
          reasonCode: 'manual_admin_override',
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsafe_evidence_url' });
  });
});

describe('H-10 — a scoped policy cannot be written against the wrong company', () => {
  it('rejects a specific_signal scope whose signal belongs to another company', async () => {
    state.signalRows = [{ id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-1', companyId: 'company-other' }];
    await expect(
      writeCompanyPolicy(
        actor,
        'company-1',
        validRootInput({ scopeType: 'specific_signal', signalId: '11111111-1111-4111-8111-111111111111', outreachEligibility: 'blocked' }),
      ),
    ).rejects.toMatchObject({ code: 'signal_company_mismatch' });
    expect(state.policyRows).toHaveLength(0);
  });

  it('rejects a specific_requirement scope whose requirement belongs to another company', async () => {
    state.requirementRows = [{ id: '33333333-3333-4333-8333-333333333333', tenantId: 'tenant-1', companyId: 'company-other' }];
    await expect(
      writeCompanyPolicy(
        actor,
        'company-1',
        validRootInput({ scopeType: 'specific_requirement', requirementId: '33333333-3333-4333-8333-333333333333', outreachEligibility: 'blocked' }),
      ),
    ).rejects.toMatchObject({ code: 'requirement_company_mismatch' });
  });

  it('fails CLOSED when the referenced signal does not exist at all', async () => {
    state.signalRows = [];
    await expect(
      writeCompanyPolicy(
        actor,
        'company-1',
        validRootInput({ scopeType: 'specific_signal', signalId: '22222222-2222-4222-8222-222222222222', outreachEligibility: 'blocked' }),
      ),
    ).rejects.toMatchObject({ code: 'signal_company_mismatch' });
  });

  it("fails CLOSED when the signal exists under a DIFFERENT tenant (the lookup is tenant-scoped)", async () => {
    state.signalRows = [{ id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-other', companyId: 'company-1' }];
    await expect(
      writeCompanyPolicy(
        actor,
        'company-1',
        validRootInput({ scopeType: 'specific_signal', signalId: '11111111-1111-4111-8111-111111111111', outreachEligibility: 'blocked' }),
      ),
    ).rejects.toMatchObject({ code: 'signal_company_mismatch' });
  });

  it('accepts a specific_signal scope whose signal genuinely belongs to the company', async () => {
    state.signalRows = [{ id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-1', companyId: 'company-1' }];
    const row = await writeCompanyPolicy(
      actor,
      'company-1',
      validRootInput({ scopeType: 'specific_signal', signalId: '11111111-1111-4111-8111-111111111111', outreachEligibility: 'blocked' }),
    );
    expect(row.scopeKey).toBe('specific_signal:11111111-1111-4111-8111-111111111111');
  });
});
