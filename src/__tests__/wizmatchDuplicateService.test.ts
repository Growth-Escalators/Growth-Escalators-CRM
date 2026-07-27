// PRD-005 §8.8, §12 — duplicate review/resolve service tests. Predicate
// capture, not discard (see wizmatchPolicyService.test.ts header for why).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  duplicateRows: [] as any[],
  companyRows: [] as any[],
  staffingEventInserts: [] as any[],
  auditLogCalls: [] as any[],
}));

function makeThenable<T>(getValue: () => T) {
  return {
    then: (resolve: any, reject: any) => Promise.resolve(getValue()).then(resolve, reject),
    orderBy: () => makeThenable(getValue),
  };
}

/** Extracts only the drizzle `Param` (bound-value) leaves from a condition
 * tree — NOT every string reachable in the object graph, which would also
 * pick up column defaults/constraint names via each column's circular
 * `.table` back-reference (verified empirically: a plain string-leaf walk
 * picks up sibling columns' `.default` values, e.g. `resolution`'s
 * `'pending'` default, even when the query never filters on that column). */
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
    if (key === 'table') continue; // avoids recursing into sibling-column metadata
    out.push(...paramValues(value, seen));
  }
  return out;
}

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  const dbLike: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          const values = new Set(paramValues(condition));
          const RESOLUTIONS = new Set(['pending', 'merged', 'confirmed_separate']);
          if (table === actualSchema.wizmatchCompanyDuplicates) {
            return makeThenable(() =>
              state.duplicateRows.filter((r) => {
                if (!values.has(r.tenantId)) return false;
                // If the query names a specific duplicate id, it must match.
                const idLiterals = [...values].filter((v) => v.startsWith('dup-'));
                if (idLiterals.length > 0 && !idLiterals.includes(r.id)) return false;
                // If the query names a resolution filter, it must match.
                const resolutionLiteral = [...values].find((v) => RESOLUTIONS.has(v));
                if (resolutionLiteral && r.resolution !== resolutionLiteral) return false;
                return true;
              }),
            );
          }
          if (table === actualSchema.wizmatchCompanies) {
            return makeThenable(() => state.companyRows.filter((r) => values.has(r.tenantId)));
          }
          return makeThenable(() => []);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: any) => ({
        where: (condition: unknown) => {
          const values = new Set(paramValues(condition));
          if (table === actualSchema.wizmatchCompanyDuplicates) {
            const RESOLUTIONS = new Set(['pending', 'merged', 'confirmed_separate']);
            const matches = state.duplicateRows.filter((r) => {
              if (!values.has(r.tenantId) || !values.has(r.id)) return false;
              // H-14 regression: the UPDATE itself now carries a
              // `resolution = 'pending'` predicate — if the row has already
              // moved off 'pending', this WHERE must not match it, closing
              // the race the review flagged.
              const resolutionLiteral = [...values].find((v) => RESOLUTIONS.has(v));
              if (resolutionLiteral && r.resolution !== resolutionLiteral) return false;
              return true;
            });
            state.duplicateRows = state.duplicateRows.map((r) =>
              matches.some((m) => m.id === r.id) ? { ...r, ...vals } : r,
            );
            const updated = state.duplicateRows.find((r) => matches.some((m) => m.id === r.id));
            return { returning: () => makeThenable(() => (updated ? [updated] : [])) };
          }
          return { returning: () => makeThenable(() => []) };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: any) => {
        if (table === actualSchema.wizmatchStaffingEvents) state.staffingEventInserts.push(vals);
        return makeThenable(() => undefined);
      },
    }),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(dbLike),
  };
  return { ...actualSchema, db: dbLike };
});

vi.mock('../services/auditLogger', () => ({
  auditLog: (...args: any[]) => {
    state.auditLogCalls.push(args);
    return Promise.resolve();
  },
}));

import { listDuplicates, resolveDuplicate, DuplicateValidationError } from '../modules/outreach/duplicateService';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };

beforeEach(() => {
  state.duplicateRows = [
    {
      id: 'dup-1',
      tenantId: 'tenant-1',
      companyAId: 'company-a',
      companyBId: 'company-b',
      similarity: null,
      detectionRule: 'domain',
      resolution: 'pending',
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date(),
    },
  ];
  state.companyRows = [
    { id: 'company-a', tenantId: 'tenant-1', name: 'Acme Inc', domain: 'acme.com' },
    { id: 'company-b', tenantId: 'tenant-1', name: 'Acme Incorporated', domain: 'acme.com' },
  ];
  state.staffingEventInserts = [];
  state.auditLogCalls = [];
});

describe('listDuplicates', () => {
  it('returns the side-by-side company shape for a pending pair', async () => {
    const rows = await listDuplicates('tenant-1', 'pending');
    expect(rows).toHaveLength(1);
    expect(rows[0].companyA.name).toBe('Acme Inc');
    expect(rows[0].companyB.name).toBe('Acme Incorporated');
    expect(rows[0].resolution).toBe('pending');
  });
});

describe('resolveDuplicate', () => {
  it('resolves a pending pair as confirmed_separate, recording resolvedBy/resolvedAt', async () => {
    const updated = await resolveDuplicate(actor, 'dup-1', { resolution: 'confirmed_separate', reasonCode: 'duplicate_confirmed_separate' });
    expect(updated.resolution).toBe('confirmed_separate');
    expect(updated.resolvedBy).toBe('user-1');
    expect(updated.resolvedAt).toBeInstanceOf(Date);
  });

  it('refuses to re-resolve an already-resolved pair (idempotency, not silent overwrite)', async () => {
    await resolveDuplicate(actor, 'dup-1', { resolution: 'merged', reasonCode: 'duplicate_merged' });
    await expect(resolveDuplicate(actor, 'dup-1', { resolution: 'confirmed_separate', reasonCode: 'duplicate_confirmed_separate' })).rejects.toMatchObject(
      { code: 'already_resolved' },
    );
  });

  it('rejects an invalid resolution value', async () => {
    await expect(
      resolveDuplicate(actor, 'dup-1', { resolution: 'deleted' as any, reasonCode: 'duplicate_merged' }),
    ).rejects.toBeInstanceOf(DuplicateValidationError);
  });

  it('rejects a duplicate id from another tenant', async () => {
    await expect(
      resolveDuplicate({ tenantId: 'tenant-2', userId: 'user-9' }, 'dup-1', { resolution: 'merged', reasonCode: 'duplicate_merged' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects an unrecognised reasonCode not in the ratified §9 taxonomy', async () => {
    await expect(
      resolveDuplicate(actor, 'dup-1', { resolution: 'merged', reasonCode: 'not_a_real_code' }),
    ).rejects.toMatchObject({ code: 'unknown_reason_code' });
  });

  // PR 8A REVIEW fix — a duplicate resolution is a permanent human decision
  // and must carry an identifiable actor, exactly as a policy write now does.
  it('refuses a resolution with no actor userId, before any write', async () => {
    await expect(
      resolveDuplicate({ tenantId: 'tenant-1' }, 'dup-1', { resolution: 'merged', reasonCode: 'duplicate_merged' }),
    ).rejects.toMatchObject({ code: 'actor_required' });
    expect(state.staffingEventInserts).toHaveLength(0);
  });

  // H-14 regression: resolveDuplicate used to discard reasonCode/evidence and
  // write no audit or event row at all.
  it('persists reasonCode/evidence in a staffing event and an audit_events row', async () => {
    await resolveDuplicate(actor, 'dup-1', {
      resolution: 'merged',
      reasonCode: 'duplicate_merged',
      evidence: 'Same registered address and GSTIN.',
    });

    expect(state.staffingEventInserts).toHaveLength(1);
    expect(state.staffingEventInserts[0]).toMatchObject({
      eventType: 'company_duplicate_resolved',
      payload: expect.objectContaining({
        duplicateId: 'dup-1',
        resolution: 'merged',
        reasonCode: 'duplicate_merged',
        evidence: 'Same registered address and GSTIN.',
      }),
    });

    expect(state.auditLogCalls).toHaveLength(1);
    expect(state.auditLogCalls[0][0]).toMatchObject({
      action: 'wizmatch_company_duplicate_resolved',
      entityId: 'dup-1',
      newValues: expect.objectContaining({ resolution: 'merged', reasonCode: 'duplicate_merged' }),
    });
  });

  it('rejects a resolve with no reasonCode', async () => {
    await expect(
      resolveDuplicate(actor, 'dup-1', { resolution: 'merged', reasonCode: '' }),
    ).rejects.toMatchObject({ code: 'reason_code_required' });
  });
});
