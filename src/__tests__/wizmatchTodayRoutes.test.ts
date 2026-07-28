// PRD-005 PR 6 §4/§12 — route-level contract for src/routes/wizmatchToday.ts.
// Mirrors wizmatchPolicyRoutes.test.ts's convention: mount the REAL router on
// a REAL express app, mock only the service layer and RBAC, and assert on
// path/role/flag behaviour end to end.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const calls = vi.hoisted(() => ({
  buildTodayQueues: [] as unknown[][],
  runTodayActions: [] as unknown[][],
}));

const state = vi.hoisted(() => ({
  runTodayActionsResult: { requested: 1, succeeded: 1, failed: 0, results: [{ type: 'company', id: 'company-1', ok: true }] } as Record<string, unknown>,
  runTodayActionsShouldThrow: null as Error | null,
  // M-5 — overridable per test so the capability-wiring test (below) can seed
  // a real item shape without every other test in this file having to know
  // about it. `undefined` falls back to the original empty-queues default.
  buildTodayQueuesResult: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../modules/outreach/decisionWorkbench', () => ({
  buildTodayQueues: async (...args: unknown[]) => {
    calls.buildTodayQueues.push(args);
    return state.buildTodayQueuesResult ?? { readyToContact: [], needsReview: [], repliesNeedingAction: [], pausedOrBlocked: [], counts: {}, partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] } };
  },
}));

vi.mock('../modules/outreach/decisionWorkbenchActions', () => {
  class TodayActionValidationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    TodayActionValidationError,
    runTodayActions: async (...args: unknown[]) => {
      calls.runTodayActions.push(args);
      if (state.runTodayActionsShouldThrow) throw state.runTodayActionsShouldThrow;
      return state.runTodayActionsResult;
    },
  };
});

let server: Server;
let baseUrl: string;

async function startServer(role = 'admin') {
  const { default: router } = await import('../routes/wizmatchToday');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { tenantId: 'tenant-1', id: 'user-1', role };
    next();
  });
  app.use('/api/wizmatch', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.resetModules();
  calls.buildTodayQueues.length = 0;
  calls.runTodayActions.length = 0;
  state.runTodayActionsShouldThrow = null;
  state.runTodayActionsResult = { requested: 1, succeeded: 1, failed: 0, results: [{ type: 'company', id: 'company-1', ok: true }] };
  state.buildTodayQueuesResult = undefined;
  process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED = 'true';
  // P8B-3 — pilot admission is fail-closed in every runtime, so a roster is a
  // precondition for reaching any route in this file. Satisfied here so these
  // cases keep testing the flag/role/path behaviour they were written for
  // rather than incidentally re-testing the pilot gate (which has its own
  // coverage, below and in wizmatchPilotGate.test.ts).
  process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS = 'true';
});

afterEach(async () => {
  delete process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED;
  delete process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('wizmatchToday router — feature flag', () => {
  it('404s every route when WIZMATCH_DECISION_WORKBENCH_ENABLED is not exactly "true"', async () => {
    process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED = 'TRUE';
    await startServer();

    const getRes = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
    expect(getRes.status).toBe(404);

    const postRes = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [{ type: 'company', id: 'c1' }] }),
    });
    expect(postRes.status).toBe(404);
    expect(calls.buildTodayQueues).toHaveLength(0);
  });
});

describe('wizmatchToday router — GET /today/queues (staff+ read)', () => {
  it('a staff role can read the queues', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
    expect(res.status).toBe(200);
    expect(calls.buildTodayQueues).toHaveLength(1);
    expect(calls.buildTodayQueues[0][0]).toBe('tenant-1');
  });
});

// PR 8A hardening (task 2/10) — pilot roster enforcement (PRD-005 §4). Both
// routes in this router carry no pilot-roster check of their own beyond the
// shared middleware — this proves it actually runs here.
describe('wizmatchToday router — pilot roster enforcement', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { default: router } = await import('../routes/wizmatchToday');
    const app = express();
    app.use(express.json());
    app.use('/api/wizmatch', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
    expect(res.status).toBe(401);
    expect(calls.buildTodayQueues).toHaveLength(0);
  });

  it("rejects 'viewer' reading the queues — pilot roster gate, not the role list, is what stops it", async () => {
    await startServer('viewer');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
    expect(res.status).toBe(403);
    expect(calls.buildTodayQueues).toHaveLength(0);
  });

  it.each(['admin', 'team_lead', 'manager_ops', 'sales', 'staff'])('allows pilot-eligible role %s to read queues', async (role) => {
    await startServer(role);
    const res = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
    expect(res.status).toBe(200);
  });

  // P8B-3 — asserted across every NODE_ENV a misconfigured deploy could carry,
  // not only 'production'. The suite-wide `WIZMATCH_STAFFING_PILOT_ALL_USERS`
  // is removed inside each case so "no roster configured" is literally true.
  it.each(['production', 'staging', 'development', 'test'])(
    'fails closed with NODE_ENV=%s and no pilot roster configured, even for admin',
    async (nodeEnv) => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = nodeEnv;
      delete process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS;
      try {
        await startServer('admin');
        const res = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
        expect(res.status).toBe(403);
        expect(calls.buildTodayQueues).toHaveLength(0);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    },
  );

  it('production with a roster configured: a listed user passes, an unlisted one does not', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalRoster = process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;
    process.env.NODE_ENV = 'production';
    delete process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS;
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'someone-else';
    try {
      await startServer('team_lead'); // startServer always uses id: 'user-1'
      const unlistedRes = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
      expect(unlistedRes.status).toBe(403);

      process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'user-1';
      const listedRes = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
      expect(listedRes.status).toBe(200);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalRoster === undefined) delete process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;
      else process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = originalRoster;
    }
  });
});

describe('wizmatchToday router — POST /today/actions role gating (PRD-005 §4)', () => {
  it('rejects a staff role on a single-target action (requires team_lead+)', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] }),
    });
    expect(res.status).toBe(403);
    expect(calls.runTodayActions).toHaveLength(0);
  });

  it('allows a team_lead role on a single-target action', async () => {
    await startServer('team_lead');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] }),
    });
    expect(res.status).toBe(200);
    expect(calls.runTodayActions).toHaveLength(1);
  });

  it('rejects a team_lead role on a multi-target ("bulk") action — bulk requires admin', async () => {
    await startServer('team_lead');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }, { type: 'company', id: 'company-2' }] }),
    });
    expect(res.status).toBe(403);
    expect(calls.runTodayActions).toHaveLength(0);
  });

  it('allows an admin role on a multi-target ("bulk") action', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }, { type: 'company', id: 'company-2' }] }),
    });
    expect(res.status).toBe(200);
    expect(calls.runTodayActions).toHaveLength(1);
  });

  it('returns 400 with the validation error code when the action layer rejects the whole request', async () => {
    const { TodayActionValidationError } = await import('../modules/outreach/decisionWorkbenchActions');
    state.runTodayActionsShouldThrow = new TodayActionValidationError('targets must be a non-empty array.', 'targets_required');
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('targets_required');
  });

  it('returns the per-target outcome body on success', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve_queue', targets: [{ type: 'company', id: 'company-1' }] }),
    });
    const body = (await res.json()) as { requested: number; succeeded: number; failed: number; results: Array<{ id: string; ok: boolean }> };
    expect(body).toMatchObject({ requested: 1, succeeded: 1, failed: 0 });
    expect(body.results[0]).toMatchObject({ id: 'company-1', ok: true });
  });
});

// M-5 — missing capability-wiring regression coverage. Before this test, no
// assertion in this file (or anywhere) proved `attachCapabilities` in
// wizmatchToday.ts actually threads `req.user?.role` into
// `computeTodayActionCapabilities`/`computeBulkCapability` rather than
// dropping it or hardcoding a role. A seeded item with a `blocked` root row is
// used because that state is exactly where `capabilityFor`
// (decisionWorkbenchCapabilities.ts) branches on role — `outreachEligibility
// === 'blocked'` denies every unblocking action for a non-admin but allows it
// for admin — so the two roles' responses are provably different, not just
// coincidentally different superficial strings.
describe('wizmatchToday router — GET /today/queues capabilities/bulkCapability wiring (M-5)', () => {
  const blockedCompanyItem = {
    companyId: 'company-1',
    companyName: 'Acme Corp',
    companyDomain: 'acme.test',
    accountOwnerUserId: null,
    canonicalDecision: 'deny',
    canonicalReasonCode: 'manual_block_by_operator',
    canonicalBlockerCode: null,
    effectiveDecision: 'deny',
    enforcementMode: 'enforce',
    requiresExplicitApproval: false,
    policyId: 'policy-1',
    outreachEligibility: 'blocked',
    externalHiringPolicy: 'unknown',
    relationshipType: 'new_prospect',
    blockClass: 'standard',
    isNonOverridable: false,
    nonOverridableScopeKey: null,
    nonOverridableBlockKind: null,
    reviewDate: null,
    reviewDateArrived: false,
    policyReasonCode: 'manual_block_by_operator',
    policyScopeKey: 'entire_company',
    contactConfidenceTier: 'high',
    duplicatePending: false,
    duplicateId: null,
    routed: false,
    recommendedRoute: 'none',
    disabledReason: null,
  };

  it("attaches capabilities/bulkCapability that actually differ by the CALLER'S role, proving the role parameter is wired through", async () => {
    state.buildTodayQueuesResult = {
      readyToContact: [blockedCompanyItem],
      needsReview: [],
      repliesNeedingAction: [],
      pausedOrBlocked: [],
      counts: {},
      partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
    };

    await startServer('staff');
    const staffBody = (await (await fetch(`${baseUrl}/api/wizmatch/today/queues`)).json()) as {
      readyToContact: Array<{ capabilities: Record<string, { enabled: boolean; reason: string | null }> }>;
      bulkCapability: { enabled: boolean; reason: string | null };
    };
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await startServer('admin');
    const adminBody = (await (await fetch(`${baseUrl}/api/wizmatch/today/queues`)).json()) as typeof staffBody;

    // staff is outside the single-context role allow-list — every action is
    // denied for the role-check reason.
    expect(staffBody.readyToContact[0].capabilities.approve_queue).toMatchObject({
      enabled: false,
      reason: 'This action requires team_lead or admin.',
    });
    // admin passes the role check, and admin (unlike a non-admin) may
    // override a `blocked` root row — the exact branch that makes this a real
    // role-behaviour difference, not a cosmetic one.
    expect(adminBody.readyToContact[0].capabilities.approve_queue).toEqual({ enabled: true, reason: null });

    // bulkCapability is present on both responses and is role-appropriate
    // (admin-only, per ROLES_BY_CONTEXT.bulk in decisionWorkbenchCapabilities.ts).
    expect(staffBody.bulkCapability).toMatchObject({ enabled: false });
    expect(adminBody.bulkCapability).toEqual({ enabled: true, reason: null });
  });
});
