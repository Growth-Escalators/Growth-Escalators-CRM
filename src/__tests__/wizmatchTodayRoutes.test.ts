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
}));

vi.mock('../modules/outreach/decisionWorkbench', () => ({
  buildTodayQueues: async (...args: unknown[]) => {
    calls.buildTodayQueues.push(args);
    return { readyToContact: [], needsReview: [], repliesNeedingAction: [], pausedOrBlocked: [], counts: {}, partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] } };
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
  process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED = 'true';
});

afterEach(async () => {
  delete process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED;
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
