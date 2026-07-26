// PRD-005 §8.8, §12 — duplicate review/resolve service tests. Predicate
// capture, not discard (see wizmatchPolicyService.test.ts header for why).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  duplicateRows: [] as any[],
  companyRows: [] as any[],
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
            state.duplicateRows = state.duplicateRows.map((r) =>
              values.has(r.tenantId) && values.has(r.id) ? { ...r, ...vals } : r,
            );
            const updated = state.duplicateRows.find((r) => values.has(r.tenantId) && values.has(r.id));
            return { returning: () => makeThenable(() => (updated ? [updated] : [])) };
          }
          return { returning: () => makeThenable(() => []) };
        },
      }),
    }),
  };
  return { ...actualSchema, db: dbLike };
});

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
    const updated = await resolveDuplicate(actor, 'dup-1', { resolution: 'confirmed_separate', reasonCode: 'legal_suffix_variant' });
    expect(updated.resolution).toBe('confirmed_separate');
    expect(updated.resolvedBy).toBe('user-1');
    expect(updated.resolvedAt).toBeInstanceOf(Date);
  });

  it('refuses to re-resolve an already-resolved pair (idempotency, not silent overwrite)', async () => {
    await resolveDuplicate(actor, 'dup-1', { resolution: 'merged', reasonCode: 'same_entity' });
    await expect(resolveDuplicate(actor, 'dup-1', { resolution: 'confirmed_separate', reasonCode: 'oops' })).rejects.toMatchObject(
      { code: 'already_resolved' },
    );
  });

  it('rejects an invalid resolution value', async () => {
    await expect(
      resolveDuplicate(actor, 'dup-1', { resolution: 'deleted' as any, reasonCode: 'x' }),
    ).rejects.toBeInstanceOf(DuplicateValidationError);
  });

  it('rejects a duplicate id from another tenant', async () => {
    await expect(
      resolveDuplicate({ tenantId: 'tenant-2', userId: 'user-9' }, 'dup-1', { resolution: 'merged', reasonCode: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
