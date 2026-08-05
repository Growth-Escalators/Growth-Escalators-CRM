import { describe, it, expect, vi, beforeEach } from 'vitest';

// Seat-limit enforcement (src/services/seatLimits.ts). `plans.limits` is a
// free-form jsonb bag nothing has ever read before this — extractSeatLimit's
// tests pin exactly which key names are honoured and what "no cap
// configured" degrades to (never invents a default).
const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: { select: (...args: unknown[]) => mockSelect(...args) },
    pool: { query: vi.fn() },
    plans: schema.plans,
    subscriptions: schema.subscriptions,
    users: schema.users,
  };
});

import { extractSeatLimit, resolveTenantSeatLimit, countActiveTenantUsers } from '../services/seatLimits';

// Same generic chainable-mock shape as tenantIsolationIDOR.test.ts /
// permissionsMeIsPlatformSuperadmin.test.ts.
function resultChain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractSeatLimit — pure', () => {
  it('returns null for null/undefined/non-object limits', () => {
    expect(extractSeatLimit(null)).toBeNull();
    expect(extractSeatLimit(undefined)).toBeNull();
    expect(extractSeatLimit('not an object')).toBeNull();
    expect(extractSeatLimit([1, 2, 3])).toBeNull();
  });

  it('returns null for an empty bag — never invents a default cap', () => {
    expect(extractSeatLimit({})).toBeNull();
  });

  it('reads the canonical maxUsers key', () => {
    expect(extractSeatLimit({ maxUsers: 5 })).toBe(5);
  });

  it('falls back to the schema-comment\'s illustrative "seats" key when maxUsers is absent', () => {
    expect(extractSeatLimit({ seats: 3 })).toBe(3);
  });

  it('prefers maxUsers over seats when both are present', () => {
    expect(extractSeatLimit({ maxUsers: 10, seats: 3 })).toBe(10);
  });

  it('ignores non-numeric or non-positive values rather than treating them as a cap of 0', () => {
    expect(extractSeatLimit({ maxUsers: 0 })).toBeNull();
    expect(extractSeatLimit({ maxUsers: -1 })).toBeNull();
    expect(extractSeatLimit({ maxUsers: 'five' })).toBeNull();
  });
});

describe('resolveTenantSeatLimit', () => {
  it('is null (unlimited) when the tenant has no active subscription', async () => {
    mockSelect.mockReturnValueOnce(resultChain([])); // no active subscription row
    expect(await resolveTenantSeatLimit(TENANT_A)).toBeNull();
  });

  it("is null when the active subscription's plan row is missing (defensive)", async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ planId: 'plan-1' }]));
    mockSelect.mockReturnValueOnce(resultChain([])); // plan lookup misses
    expect(await resolveTenantSeatLimit(TENANT_A)).toBeNull();
  });

  it('returns the plan\'s maxUsers cap when an active subscription exists', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ planId: 'plan-1' }]));
    mockSelect.mockReturnValueOnce(resultChain([{ limits: { maxUsers: 5 } }]));
    expect(await resolveTenantSeatLimit(TENANT_A)).toBe(5);
  });

  it('is null when the plan has limits but none set a cap (never a default)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ planId: 'plan-1' }]));
    mockSelect.mockReturnValueOnce(resultChain([{ limits: {} }]));
    expect(await resolveTenantSeatLimit(TENANT_A)).toBeNull();
  });
});

describe('countActiveTenantUsers', () => {
  it('counts the rows the query returns', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]));
    expect(await countActiveTenantUsers(TENANT_A)).toBe(3);
  });

  it('is 0 for a tenant with no active users', async () => {
    mockSelect.mockReturnValueOnce(resultChain([]));
    expect(await countActiveTenantUsers(TENANT_A)).toBe(0);
  });
});
