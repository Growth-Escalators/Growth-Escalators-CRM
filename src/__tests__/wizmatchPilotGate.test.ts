// PR 8A hardening (task 2/10) — unit + route-level coverage for the pilot
// roster middleware (`src/middleware/wizmatchPilotGate.ts`) applied to the
// three pilot surfaces: wizmatchPolicy.ts, wizmatchToday.ts, wizmatchPrepare.ts.
//
// Proves:
//   - unauthenticated -> 401
//   - a role outside PILOT_ELIGIBLE_ROLES (viewer) -> 403, even for a READ
//     route that carries no additional role gate of its own (read permission
//     must not imply pilot access, and vice versa)
//   - staff/sales/manager_ops/team_lead/admin -> STILL rejected while the
//     roster is unconfigured (P8B-3: admission is fail-closed in every
//     runtime, not only production — an eligible role is necessary but never
//     sufficient)
//   - in production with NO roster configured -> fail closed for every role,
//     including admin (no role receives access "merely because" the roster
//     check is skipped)
//   - in production with a roster configured, a listed user of an eligible
//     role passes; an unlisted user of the same role is rejected

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wizmatchPilotGate } from '../middleware/wizmatchPilotGate';

function mockReqRes(user?: Record<string, unknown>) {
  const req = { user } as unknown as Parameters<typeof wizmatchPilotGate>[0];
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = () => {
    next.called = true;
  };
  next.called = false;
  return { req, res: res as unknown as Parameters<typeof wizmatchPilotGate>[1], resState: res, next };
}

/** Invokes the gate and returns the outcome AFTER it ran — never destructure the mock's mutable fields before calling. */
function invoke(user?: Record<string, unknown>) {
  const { req, res, resState, next } = mockReqRes(user);
  wizmatchPilotGate(req, res, next);
  return { statusCode: resState.statusCode, body: resState.body, nextCalled: next.called };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;
  delete process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('wizmatchPilotGate — unauthenticated', () => {
  it('rejects with 401 when req.user is absent', () => {
    const { statusCode, nextCalled } = invoke(undefined);
    expect(statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });
});

describe('wizmatchPilotGate — role matrix (roster unconfigured, NODE_ENV unset)', () => {
  const eligibleRoles = ['admin', 'team_lead', 'manager_ops', 'sales', 'staff'];
  for (const role of eligibleRoles) {
    it(`rejects role '${role}' while the roster is unconfigured — no permissive non-production default`, () => {
      const { statusCode, nextCalled } = invoke({ tenantId: 'tenant-1', id: 'user-1', role });
      expect(nextCalled).toBe(false);
      expect(statusCode).toBe(403);
    });

    it(`allows role '${role}' once the roster names the user`, () => {
      process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'user-1';
      const { nextCalled } = invoke({ tenantId: 'tenant-1', id: 'user-1', role });
      expect(nextCalled).toBe(true);
    });
  }

  // Rostered so the ONLY remaining reason to reject is the role itself —
  // otherwise the unconfigured roster would reject these regardless and the
  // assertion would say nothing about the role allow-list.
  it("rejects 'viewer' — not a pilot-eligible role, even when named on the roster", () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'viewer-1';
    const { statusCode, nextCalled } = invoke({ tenantId: 'tenant-1', id: 'viewer-1', role: 'viewer' });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
  });

  it('rejects an unrecognised role — fails closed, not open, on an unknown value', () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'user-1';
    const { statusCode, nextCalled } = invoke({ tenantId: 'tenant-1', id: 'user-1', role: 'nonexistent_role' });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
  });
});

describe('wizmatchPilotGate — production, roster absent (fail closed)', () => {
  it('rejects an admin when the roster is unconfigured in production', () => {
    process.env.NODE_ENV = 'production';
    const { statusCode, nextCalled } = invoke({ tenantId: 'tenant-1', id: 'admin-1', role: 'admin' });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
  });

  it('rejects every eligible role in production with no roster configured', () => {
    process.env.NODE_ENV = 'production';
    for (const role of ['admin', 'team_lead', 'manager_ops', 'sales', 'staff']) {
      const { nextCalled } = invoke({ tenantId: 'tenant-1', id: `${role}-1`, role });
      expect(nextCalled, `role ${role} should be rejected`).toBe(false);
    }
  });
});

describe('wizmatchPilotGate — production, roster configured', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'pilot-user-1,pilot-user-2';
  });

  it('allows a listed user id with an eligible role', () => {
    const { nextCalled } = invoke({ tenantId: 'tenant-1', id: 'pilot-user-1', role: 'team_lead' });
    expect(nextCalled).toBe(true);
  });

  it('rejects an UNLISTED user id even with an eligible role', () => {
    const { statusCode, nextCalled } = invoke({ tenantId: 'tenant-1', id: 'not-in-roster', role: 'team_lead' });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
  });

  it("rejects a listed user id whose role is not pilot-eligible ('viewer')", () => {
    const { nextCalled } = invoke({ tenantId: 'tenant-1', id: 'pilot-user-1', role: 'viewer' });
    expect(nextCalled).toBe(false);
  });
});
