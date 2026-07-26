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
        reasonCode: 'test',
      } as any),
    ).rejects.toBeInstanceOf(PolicyValidationError);
  });

  it('rejects a scoped row that overrides no dimension', async () => {
    await expect(
      writeCompanyPolicy(actor, 'company-1', {
        scopeType: 'location',
        scopeRefLabel: 'bengaluru',
        reasonCode: 'test',
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
        reasonCode: 'test',
      } as any),
    ).rejects.toMatchObject({ code: 'paused_requires_review_date' });
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
        reasonCode: 'test',
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
