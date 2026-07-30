// QA run 2026-07-30 — regression guard for failure-matrix finding M-1
// ("F-A machine-sync lane unreachable; Command Deck sync broken").
//
// WHY THIS FILE EXISTS, given `wizmatchMachineSyncLane.test.ts` already has 55
// passing tests: those test the PREDICATE (`isWizmatchMachineSyncRequest`) and
// the wrapper in isolation. They pass while the feature is completely broken,
// because the defect is not in the predicate — it is in where the predicate is
// MOUNTED relative to three other routers in `src/index.ts`.
//
// The defect: `wizmatchPolicy.ts:59`, `wizmatchToday.ts:48` and
// `wizmatchPrepare.ts:37` each call `router.use(wizmatchPilotGate)` with NO
// path argument. Under `app.use('/api/wizmatch', ...)` an unpathed `router.use`
// matches EVERY path beneath the shared prefix — not only the paths that router
// actually defines. Those three routers are mounted at `src/index.ts:353/354/358`,
// ahead of the machine-sync lane at `:418`. So a `viewer` GET for `/dashboard`
// — a path none of the three routers serves — is 403'd by the first router's
// pilot gate and never reaches `wizmatchPilotOrMachineSync`.
//
// `viewer` can never satisfy that gate: `PILOT_ELIGIBLE_ROLES`
// (`wizmatchStaffingAccess.ts:13`) omits it, and `pilotAllowed = roleEligible &&
// (...)` (`:48`) so no roster configuration admits it in any runtime.
//
// LOAD-BEARING PRECONDITION — the flags must be ON. `featureGate` runs BEFORE
// the pilot gate in all three routers and calls `next('router')` when its flag
// is off, which exits the router and skips the pilot gate entirely. With the
// flags off (the local default) the lane appears to work. That is precisely why
// this went unnoticed: it reproduces only in the flag-on configuration the live
// pilot runs. Every test below therefore sets the three flags explicitly.
//
// This suite mounts the REAL routers in the REAL `src/index.ts` order with a
// stubbed `requireAuth` (the real one needs a JWT + Postgres) and a stubbed
// downstream `wizmatchRouter` (importing the real one boots a Postgres pool) —
// the same convention `wizmatchIndexMountOrder.test.ts` established.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { requireRole } from '../middleware/rbac';
import {
  wizmatchPilotOrMachineSync,
  WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST,
} from '../middleware/wizmatchMachineSyncLane';

// The service layer is irrelevant to the mount/gate contract — mock it so
// importing the REAL routers never touches a DB.
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

type Actor = { id: string; tenantId: string; role: string };

const VIEWER: Actor = { id: 'machine-viewer-1', tenantId: 'tenant-1', role: 'viewer' };
const NON_ROSTER_ADMIN: Actor = { id: 'admin-not-on-roster', tenantId: 'tenant-1', role: 'admin' };

describe('machine-sync lane reachability through the real /api/wizmatch mount chain (M-1)', () => {
  let server: Server | null = null;

  beforeEach(() => {
    // The flag-on configuration the live pilot runs. Without these the three
    // routers short-circuit via next('router') and the defect cannot reproduce.
    process.env.WIZMATCH_COMPANY_POLICY_ENABLED = 'true';
    process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED = 'true';
    process.env.WIZMATCH_AUTO_PREP_ENABLED = 'true';
    // Deliberately NOT setting WIZMATCH_STAFFING_PILOT_ALL_USERS / _USER_IDS.
    // A `viewer` is rejected on role-eligibility before the roster is consulted,
    // so the roster is irrelevant to the viewer cases — and leaving it unset
    // keeps the non-roster-admin case (below) honest.
  });

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

  // Mirrors src/index.ts:328 (wizmatchRequireStaffing), :353/:354/:358 (the
  // three internally-gated routers) and :418 (the admin-gated router behind
  // wizmatchPilotOrMachineSync).
  async function startRealMountChain(actor: Actor): Promise<string> {
    vi.resetModules();
    const { default: wizmatchPolicyRouter } = await import('../routes/wizmatchPolicy');
    const { default: wizmatchTodayRouter } = await import('../routes/wizmatchToday');
    const { default: wizmatchPrepareRouter } = await import('../routes/wizmatchPrepare');

    const app = express();
    app.use(express.json());

    // Stands in for the real `requireAuth`, which needs a signed JWT and a
    // Postgres round-trip for the token_version check. Everything downstream
    // reads only `req.user`, so this is a faithful stub for the mount contract.
    const fakeRequireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: Actor }).user = actor;
      // The real requireAuth also enforces viewer read-only (auth.ts:98).
      if (actor.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        res.status(403).json({ error: 'forbidden', message: 'viewer role is read-only' });
        return;
      }
      next();
    };

    const wizmatchRequireStaffing = requireRole('admin', 'team_lead', 'manager_ops', 'sales', 'staff', 'viewer');
    const wizmatchRequireAdmin = requireRole('admin', 'team_lead', 'viewer');

    app.use('/api/wizmatch', fakeRequireAuth, wizmatchRequireStaffing, wizmatchPolicyRouter);
    app.use('/api/wizmatch', fakeRequireAuth, wizmatchRequireStaffing, wizmatchTodayRouter);
    app.use('/api/wizmatch', fakeRequireAuth, wizmatchRequireStaffing, wizmatchPrepareRouter);

    // Stub for the real 82-route wizmatchRouter. Registers every allowlisted
    // GET path so a request that reaches here is unambiguously served.
    const downstream = express.Router();
    for (const p of WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST) {
      downstream.get(p, (_req, res) => { res.json({ servedBy: 'wizmatchRouter', path: p }); });
    }
    downstream.post('/dashboard', (_req, res) => { res.json({ servedBy: 'wizmatchRouter', wrote: true }); });
    downstream.get('/signals', (_req, res) => { res.json({ servedBy: 'wizmatchRouter', path: '/signals' }); });
    app.use('/api/wizmatch', fakeRequireAuth, wizmatchRequireAdmin, wizmatchPilotOrMachineSync, downstream);

    app.use((_req, res) => { res.status(404).json({ error: 'route not found' }); });

    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  // THE DEFECT. Before the fix every one of these 8 returns 403
  // `staffing_pilot_access_required` instead of 200.
  it('admits a machine viewer GET on all 8 allowlisted paths with the pilot flags ON', async () => {
    const baseUrl = await startRealMountChain(VIEWER);
    const results: Record<string, number> = {};
    for (const p of WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST) {
      results[p] = (await fetch(`${baseUrl}/api/wizmatch${p}`)).status;
    }
    // Asserted as a whole object so a failure reports every broken path at once.
    expect(results).toEqual(
      Object.fromEntries(WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST.map((p) => [p, 200])),
    );
  });

  // HONESTY GUARD (added after the Playwright lane tested this against the REAL
  // router). The test above proves the MOUNT CHAIN admits all 8 paths — but it
  // mounts a stub downstream router, so it cannot see gates inside the real
  // `wizmatchRouter`. Against the real router only 7 of 8 actually return 200:
  // `GET /placements` has its own `['admin','team_lead']` check at
  // `wizmatch.ts:3352`, downstream of the gate this fix repaired, so a `viewer`
  // is still 403'd there. That is failure-matrix L-2 — pre-existing, deliberate,
  // and feeding no cockpit tile.
  //
  // This test exists so the 8/8 assertion above can never be read as "the sync
  // fully works". It pins the real router's own role check, so if L-2 is ever
  // resolved this goes red and the claim gets updated deliberately rather than
  // drifting.
  it('documents that /placements is still 403 for a viewer via its OWN role check (L-2)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'wizmatch.ts'), 'utf8');
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const placements = bare.indexOf("router.get('/placements'");
    expect(placements, "the /placements route moved — re-verify the machine-sync lane's real coverage").toBeGreaterThan(-1);
    const handler = bare.slice(placements, placements + 400);
    // A viewer is not in this list, hence 403 despite the lane admitting it.
    expect(handler).toMatch(/\['admin',\s*'team_lead'\]\.includes\(req\.user!\.role\)/);
    expect(handler).toMatch(/commercial_access_requires_lead/);
  });

  it('serves those paths from the downstream wizmatchRouter, not from a flagged router', async () => {
    const baseUrl = await startRealMountChain(VIEWER);
    const res = await fetch(`${baseUrl}/api/wizmatch/dashboard`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servedBy: 'wizmatchRouter', path: '/dashboard' });
  });

  // --- Guards proving the fix does not widen access ------------------------

  it('still refuses a machine viewer on a GET path outside the allowlist', async () => {
    const baseUrl = await startRealMountChain(VIEWER);
    const res = await fetch(`${baseUrl}/api/wizmatch/signals`);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('staffing_pilot_access_required');
  });

  it('still refuses a machine viewer on a non-GET method against an allowlisted path', async () => {
    const baseUrl = await startRealMountChain(VIEWER);
    const res = await fetch(`${baseUrl}/api/wizmatch/dashboard`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('still refuses a viewer on the flagged pilot surfaces themselves', async () => {
    const baseUrl = await startRealMountChain(VIEWER);
    expect((await fetch(`${baseUrl}/api/wizmatch/today/queues`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/wizmatch/companies/c1/policy`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/wizmatch/companies/c1/prepare/status`)).status).toBe(403);
  });

  // The pilot gate must still fail closed for humans. A non-roster admin is
  // pilot-eligible by ROLE but absent from the roster, so `allowed` is false.
  it('still refuses a non-roster admin on an allowlisted path (lane is viewer-only)', async () => {
    const baseUrl = await startRealMountChain(NON_ROSTER_ADMIN);
    const res = await fetch(`${baseUrl}/api/wizmatch/dashboard`);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('staffing_pilot_access_required');
  });

  it('still refuses a non-roster admin on the flagged pilot surfaces', async () => {
    const baseUrl = await startRealMountChain(NON_ROSTER_ADMIN);
    expect((await fetch(`${baseUrl}/api/wizmatch/today/queues`)).status).toBe(403);
  });

  // Documents the reason the defect hid: with the flags OFF, featureGate's
  // next('router') skips each router's pilot gate, so the lane already worked.
  it('worked even before the fix when the flags were OFF — documents why this hid', async () => {
    delete process.env.WIZMATCH_COMPANY_POLICY_ENABLED;
    delete process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED;
    delete process.env.WIZMATCH_AUTO_PREP_ENABLED;
    const baseUrl = await startRealMountChain(VIEWER);
    expect((await fetch(`${baseUrl}/api/wizmatch/dashboard`)).status).toBe(200);
  });
});
