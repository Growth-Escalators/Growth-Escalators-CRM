// PRD-005 PR 5/6 review finding M-1 — regression guard.
//
// `wizmatchPolicyRoutes.test.ts` and `wizmatchTodayRoutes.test.ts` prove each
// router's OWN role gates in isolation, mounted on a bare express app. They
// cannot see the defect M-1 actually was: in the real `src/index.ts`, the
// admin/team_lead/viewer-only `wizmatchRequireAdmin` gate ran as `app.use`
// middleware for the WHOLE `/api/wizmatch` prefix, ahead of the policy and
// (now) decision-workbench routers — so a staff-tier request for e.g.
// `/companies/:id/policy` or `/today/queues` was 403'd before it ever reached
// a router that would have allowed it, regardless of what that router's own
// role gate said.
//
// `src/index.ts` itself cannot be safely imported in a unit test — module
// load starts a real HTTP listener and a real Postgres pool. This is
// therefore a source-level ordering guard, the same convention this repo
// already uses for other registration-order invariants
// (`wizmatchCompanyBootstrapCoverage.test.ts`, `wizmatchLegacyEligibilityGuard.test.ts`):
// it reads the actual file and asserts the real statement order, so a future
// edit that re-introduces the M-1 ordering is caught mechanically rather than
// depending on a reviewer re-reading the mount block.

import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// The service layer is irrelevant to the mount-order/feature-gate contract —
// mock it so importing the REAL routers never touches a DB.
vi.mock('../modules/outreach/decisionWorkbench', () => ({ buildTodayQueues: async () => ({}) }));
vi.mock('../modules/outreach/decisionWorkbenchActions', () => ({
  TodayActionValidationError: class extends Error {},
  runTodayActions: async () => ({ requested: 0, succeeded: 0, failed: 0, results: [] }),
}));
vi.mock('../modules/outreach/policyService', () => ({
  PolicyValidationError: class extends Error {},
  PolicyOverrideRefusedError: class extends Error {},
  getCompanyPolicyView: async () => ({}),
  writeCompanyPolicy: async () => ({}),
  writeCompanyPolicyOverride: async () => ({}),
  assignAccountOwner: async () => ({}),
  bulkWriteCompanyPolicy: async () => ({}),
  listCompaniesByPolicy: async () => ({}),
}));
vi.mock('../modules/outreach/duplicateService', () => ({
  DuplicateValidationError: class extends Error {},
  listDuplicates: async () => ({}),
  resolveDuplicate: async () => ({}),
}));
vi.mock('../modules/outreach/policyReadiness', () => ({ getWizmatchPolicyReadiness: async () => ({}) }));
vi.mock('../modules/outreach/prepareCompanies', () => ({
  prepareSingleCompany: async () => ({ ok: true, result: { companyId: 'c1', status: 'prepared' } }),
  getPrepStatus: async () => ({ lastPreparedAt: '2026-07-27T00:00:00.000Z' }),
}));

const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');

function firstIndexOf(needle: string): number {
  const idx = source.indexOf(needle);
  expect(idx, `expected to find "${needle}" in src/index.ts`).toBeGreaterThan(-1);
  return idx;
}

describe('src/index.ts — /api/wizmatch mount order (M-1)', () => {
  it('mounts wizmatchPolicyRouter BEFORE the wizmatchRequireAdmin-gated wizmatchRouter', () => {
    const policyMount = firstIndexOf("wizmatchRequireStaffing, wizmatchPolicyRouter)");
    const adminGatedMount = firstIndexOf("requireAuth, wizmatchRequireAdmin, wizmatchRouter)");
    expect(policyMount).toBeLessThan(adminGatedMount);
  });

  it('mounts wizmatchTodayRouter BEFORE the wizmatchRequireAdmin-gated wizmatchRouter', () => {
    const todayMount = firstIndexOf("wizmatchRequireStaffing, wizmatchTodayRouter)");
    const adminGatedMount = firstIndexOf("requireAuth, wizmatchRequireAdmin, wizmatchRouter)");
    expect(todayMount).toBeLessThan(adminGatedMount);
  });

  // PR 7: the prep router is the third router in this block and carries the
  // same M-1 exposure. `wizmatchPrepareRoutes.test.ts` proves its own
  // `next('router')` fallthrough on a bare app, which cannot see a future edit
  // that moves this mount below the admin-gated one in the real index.ts.
  it('mounts wizmatchPrepareRouter BEFORE the wizmatchRequireAdmin-gated wizmatchRouter', () => {
    const prepareMount = firstIndexOf("wizmatchRequireStaffing, wizmatchPrepareRouter)");
    const adminGatedMount = firstIndexOf("requireAuth, wizmatchRequireAdmin, wizmatchRouter)");
    expect(prepareMount).toBeLessThan(adminGatedMount);
  });

  it('gates all three new-order mounts on requireAuth + wizmatchRequireStaffing (staff+), not wizmatchRequireAdmin', () => {
    expect(source).toMatch(/app\.use\('\/api\/wizmatch', requireAuth, wizmatchRequireStaffing, wizmatchPolicyRouter\)/);
    expect(source).toMatch(/app\.use\('\/api\/wizmatch', requireAuth, wizmatchRequireStaffing, wizmatchTodayRouter\)/);
    expect(source).toMatch(/app\.use\('\/api\/wizmatch', requireAuth, wizmatchRequireStaffing, wizmatchPrepareRouter\)/);
  });
});

// The ordering guard above proves the M-1 fix is in place. It cannot see the
// defect that ordering fix INTRODUCED: both flagged routers gate their whole
// surface with `router.use(...)`, which matches every path under the shared
// `/api/wizmatch` prefix. While they were mounted last, an inline 404 there was
// a harmless terminal 404; mounted FIRST, an inline 404 swallowed every request
// bound for `wizmatchRouter` (82 routes) whenever either flag was off — the
// shipped default. This suite mounts the REAL routers in the REAL order and
// asserts a downstream route still resolves.
describe('/api/wizmatch feature gates — off must hide the router, not the prefix', () => {
  let server: Server | null = null;

  afterEach(async () => {
    delete process.env.WIZMATCH_COMPANY_POLICY_ENABLED;
    delete process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED;
    delete process.env.WIZMATCH_AUTO_PREP_ENABLED;
    if (server) {
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  async function startRealMountOrder(): Promise<string> {
    vi.resetModules();
    const { default: wizmatchPolicyRouter } = await import('../routes/wizmatchPolicy');
    const { default: wizmatchTodayRouter } = await import('../routes/wizmatchToday');
    const { default: wizmatchPrepareRouter } = await import('../routes/wizmatchPrepare');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = { tenantId: 'tenant-1', id: 'user-1', role: 'admin' };
      next();
    });
    // Exactly the src/index.ts order: both flagged routers, then the
    // admin-gated catch-all router (stubbed here — importing the real one
    // boots a Postgres pool).
    app.use('/api/wizmatch', wizmatchPolicyRouter);
    app.use('/api/wizmatch', wizmatchTodayRouter);
    app.use('/api/wizmatch', wizmatchPrepareRouter);
    const downstream = express.Router();
    downstream.get('/dashboard', (_req, res) => { res.json({ servedBy: 'wizmatchRouter' }); });
    app.use('/api/wizmatch', downstream);
    app.use((_req, res) => { res.status(404).json({ error: 'route not found' }); });

    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('a downstream wizmatchRouter route still resolves when BOTH flags are off (the shipped default)', async () => {
    const baseUrl = await startRealMountOrder();
    const res = await fetch(`${baseUrl}/api/wizmatch/dashboard`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servedBy: 'wizmatchRouter' });
  });

  it('the flagged surfaces themselves still 404 when their flag is off', async () => {
    const baseUrl = await startRealMountOrder();
    expect((await fetch(`${baseUrl}/api/wizmatch/today/queues`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/wizmatch/companies/c1/policy`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/wizmatch/companies/c1/prepare/status`)).status).toBe(404);
  });

  it('the prep router with its flag OFF does not swallow the downstream router (C-1 class)', async () => {
    const baseUrl = await startRealMountOrder();
    const res = await fetch(`${baseUrl}/api/wizmatch/dashboard`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servedBy: 'wizmatchRouter' });
  });

  it('turning the prep flag on serves prep without hiding the downstream router', async () => {
    process.env.WIZMATCH_AUTO_PREP_ENABLED = 'true';
    const baseUrl = await startRealMountOrder();
    expect((await fetch(`${baseUrl}/api/wizmatch/companies/c1/prepare/status`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/wizmatch/dashboard`)).status).toBe(200);
  });

  it('turning one flag on serves that surface without hiding the downstream router', async () => {
    process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED = 'true';
    const baseUrl = await startRealMountOrder();
    expect((await fetch(`${baseUrl}/api/wizmatch/today/queues`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/wizmatch/dashboard`)).status).toBe(200);
    // The other flag is still off, so its surface stays hidden.
    expect((await fetch(`${baseUrl}/api/wizmatch/companies/c1/policy`)).status).toBe(404);
  });
});
