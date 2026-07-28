// F-A — coverage for `wizmatchPilotOrMachineSync`
// (`src/middleware/wizmatchMachineSyncLane.ts`), the narrow read-only
// machine-sync exception mounted in place of `wizmatchPilotGate` on the
// `/api/wizmatch` -> `wizmatchRouter` chain in `src/index.ts`.
//
// Background: `wizmatchPilotGate` requires `req.user.role` to be pilot-
// eligible (`PILOT_ELIGIBLE_ROLES` in `wizmatchStaffingAccess.ts` — admin,
// team_lead, manager_ops, sales, staff) BEFORE the pilot roster is ever
// consulted. `viewer` — the documented machine/service role in this repo,
// and the role the Command Deck sync (`~/GE-Brain/scripts/crm-sync.mjs`,
// outside this repo) authenticates as — is not in that set, so it is
// unconditionally 403'd on every one of the 82 routes behind `wizmatchRouter`,
// including plain reads, and no roster configuration changes that. That's
// deliberate and correct for interactive `viewer` access, but it also broke
// the sync, which is GET-only and only ever calls eight routes.
//
// `wizmatchPilotOrMachineSync` grants a request through WITHOUT the pilot
// gate only when it is: GET, authenticated with a non-empty string
// `tenantId` and `id`, `role === 'viewer'`, and the path is an EXACT member
// of an 8-entry frozen allowlist mirroring crm-sync.mjs:49-56. Everything
// else falls through to the unchanged `wizmatchPilotGate`.
//
// `src/index.ts` cannot be safely imported in a unit test (module load starts
// a real HTTP listener and a real Postgres pool — see the same note in
// wizmatchIndexMountOrder.test.ts / wizmatchPilotGateOnOutreachRouter.test.ts,
// this repo's established convention). This file follows the same two
// techniques: (1) mounts the REAL `wizmatchPilotOrMachineSync` and the REAL
// `wizmatchRouter` on a bare express app, in the same relative order the
// fixed `src/index.ts` mount uses, and drives it over HTTP; (2) the raw SQL
// the 8 allowlisted GET handlers issue is exercised for real by mocking only
// `../db/index`'s `pool.query` (the wizmatchRequirementsFilters.test.ts /
// wizmatchRequirementDelete.test.ts convention) to return empty-but-valid
// result sets, so no real Postgres connection is required.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock('../db/index', () => ({
  db: {},
  pool: { connect: vi.fn(), query: poolQuery },
}));

import {
  WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST,
  isWizmatchMachineSyncRequest,
  wizmatchPilotOrMachineSync,
} from '../middleware/wizmatchMachineSyncLane';
import wizmatchRouter from '../routes/wizmatch';

// Source of truth for the allowlist: crm-sync.mjs:49-56 (outside this repo,
// reference only — not modified or imported here). Mirrored as a literal
// array so an accidental edit to the allowlist in the middleware is caught
// by requirement-12's exact-set assertion below rather than silently drifting.
const CRM_SYNC_EXPECTED_PATHS = [
  '/dashboard',
  '/command-center',
  '/candidate-intelligence/queue',
  '/client-discovery/queue',
  '/review-workbench',
  '/guardrails',
  '/placements',
  '/candidates',
];

const GATE_DENIED_BODY = { error: 'staffing_pilot_access_required' };

function machineUser(overrides: Partial<{ tenantId: string; id: string; role: string }> = {}) {
  return { tenantId: 'tenant-1', id: 'sync-account', role: 'viewer', ...overrides };
}

describe('WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST — exact-set contract (requirement 12)', () => {
  it('has exactly the eight crm-sync.mjs paths, no more, no fewer', () => {
    expect(WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST.length).toBe(8);
    expect(new Set(WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST)).toEqual(new Set(CRM_SYNC_EXPECTED_PATHS));
  });

  it('is frozen (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST)).toBe(true);
  });

  it('every allowlisted path corresponds to a real registered GET route on wizmatchRouter', () => {
    const stack = (wizmatchRouter as unknown as { stack: Array<{ route?: { path: string; methods?: Record<string, boolean> } }> }).stack;
    const registeredGetPaths = new Set(
      stack.filter((layer) => layer.route?.methods?.get).map((layer) => layer.route!.path),
    );
    for (const path of WIZMATCH_MACHINE_SYNC_GET_ALLOWLIST) {
      expect(registeredGetPaths.has(path), `expected wizmatchRouter to have GET ${path}`).toBe(true);
    }
  });
});

describe('isWizmatchMachineSyncRequest — unit-level path/method/identity matching', () => {
  function req(overrides: Partial<{ method: string; path: string; user: unknown }> = {}) {
    return { method: 'GET', path: '/dashboard', user: machineUser(), ...overrides } as any;
  }

  it('true for a GET on an allowlisted path from a tenant-scoped viewer', () => {
    expect(isWizmatchMachineSyncRequest(req())).toBe(true);
  });

  it('false when method is not GET', () => {
    expect(isWizmatchMachineSyncRequest(req({ method: 'POST' }))).toBe(false);
  });

  it('false when req.user is absent', () => {
    expect(isWizmatchMachineSyncRequest(req({ user: undefined }))).toBe(false);
  });

  // N-1 (final review) — HEAD and OPTIONS are blocked correctly today, purely
  // as a side effect of the `!== 'GET'` test, but nothing pinned it. Express
  // routes HEAD to GET handlers, so a future widening to
  // `!['GET','HEAD'].includes(req.method)` would look harmless and silently
  // hand the machine principal a second verb. These two rows make that red.
  it.each(['HEAD', 'OPTIONS'])('false for method %s on an allowlisted path', (method) => {
    expect(isWizmatchMachineSyncRequest(req({ method }))).toBe(false);
  });

  it('false when tenantId is missing/empty', () => {
    expect(isWizmatchMachineSyncRequest(req({ user: machineUser({ tenantId: '' }) }))).toBe(false);
    expect(isWizmatchMachineSyncRequest(req({ user: { id: 'sync-account', role: 'viewer' } }))).toBe(false);
  });

  it('false when id is missing/empty', () => {
    expect(isWizmatchMachineSyncRequest(req({ user: machineUser({ id: '' }) }))).toBe(false);
  });

  it('false when role is not viewer (including pilot-eligible roles)', () => {
    for (const role of ['admin', 'team_lead', 'manager_ops', 'sales', 'staff']) {
      expect(isWizmatchMachineSyncRequest(req({ user: machineUser({ role }) }))).toBe(false);
    }
  });

  // Path-matching edge cases (trailing slash / case / percent-encoding /
  // traversal) — exact equality only, per the design contract.
  it('false for a trailing-slash variant', () => {
    expect(isWizmatchMachineSyncRequest(req({ path: '/dashboard/' }))).toBe(false);
  });

  it('false for a case-varied variant', () => {
    expect(isWizmatchMachineSyncRequest(req({ path: '/Dashboard' }))).toBe(false);
  });

  it('false for a percent-encoded variant', () => {
    expect(isWizmatchMachineSyncRequest(req({ path: '/%64ashboard' }))).toBe(false);
  });

  it('false for a dot-segment traversal variant', () => {
    expect(isWizmatchMachineSyncRequest(req({ path: '/dashboard/../signals' }))).toBe(false);
  });

  it('false for a path outside the allowlist entirely', () => {
    expect(isWizmatchMachineSyncRequest(req({ path: '/signals' }))).toBe(false);
  });
});

describe('wizmatchPilotOrMachineSync + wizmatchRouter, mounted in the fixed index.ts relative order — behavioural', () => {
  let server: Server | null = null;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Empty-but-valid result set for every pool.query call across all 8
    // allowlisted handlers (and any non-allowlisted handler reached in these
    // tests) — these routes are dashboards/listings designed to handle a
    // tenant with no data yet, per wizmatchReadiness.ts / the optionalWizmatch*
        // helpers used throughout wizmatch.ts.
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(async () => {
    delete process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;
    delete process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS;
    if (server) {
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  async function startLane(user: Record<string, unknown> | undefined): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (user !== undefined) (req as unknown as { user: unknown }).user = user;
      next();
    });
    // Mirrors the FIXED src/index.ts relative order: requireAuth /
    // wizmatchRequireAdmin are not re-tested here (their own coverage lives
    // in auth.test.ts / rbac tests) — this exercises exactly the
    // wizmatchPilotOrMachineSync -> wizmatchRouter relationship the F-A fix
    // put in place.
    app.use('/api/wizmatch', wizmatchPilotOrMachineSync, wizmatchRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  async function getJson(baseUrl: string, path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json().catch(() => undefined);
    return { status: res.status, body };
  }

  // ---------------------------------------------------------------------
  // Requirement 1 + 11 — humans are entirely unaffected by the F-A change.
  // ---------------------------------------------------------------------
  describe('pilot-eligible human roles are unaffected (requirements 1, 11)', () => {
    const HUMAN_ROLES = ['admin', 'team_lead', 'manager_ops', 'sales', 'staff'];

    it.each(HUMAN_ROLES)('%s on the roster reaches the handler on GET /dashboard', async (role) => {
      process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'user-1';
      baseUrl = await startLane({ tenantId: 'tenant-1', id: 'user-1', role });
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/dashboard');
      expect(status).toBe(200);
      expect(body).not.toMatchObject(GATE_DENIED_BODY);
    });

    it.each(HUMAN_ROLES)('%s NOT on the roster still gets the pilot gate 403 on GET /dashboard', async (role) => {
      process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'someone-else';
      baseUrl = await startLane({ tenantId: 'tenant-1', id: 'user-1', role });
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/dashboard');
      expect(status).toBe(403);
      expect(body).toMatchObject(GATE_DENIED_BODY);
    });
  });

  // ---------------------------------------------------------------------
  // Requirement 2 + 3 — an ordinary (non-machine) viewer keeps getting 403
  // everywhere, exactly as wizmatchPilotGate already gave it.
  // ---------------------------------------------------------------------
  describe('an ordinary (non-roster) viewer cannot reach Workbench/Today/policy or arbitrary GETs (requirements 2, 3)', () => {
    // Rewritten by the final review. This previously asserted
    // `expect([200, 403]).toContain(status)` and discarded the body — an
    // assertion satisfied identically whether the code was correct or broken,
    // so it could never fail. Its name was wrong too: `/review-workbench` is
    // one of the eight ALLOWLISTED paths, so a machine-shaped viewer gets 200
    // there, not 403. The accept-either range had been widened to paper over
    // that mismatch.
    //
    // Split into the two deterministic claims it was reaching for:
    //   (a) the lane's decision does not depend on roster membership, and
    //   (b) the same viewer is still refused on a non-allowlisted read.
    // Requirement 2 proper — that a viewer cannot reach the Decision Workbench
    // or policy surfaces — is NOT provable here: those live in
    // wizmatchTodayRouter / wizmatchPolicyRouter, which self-gate with their
    // own `router.use(wizmatchPilotGate)` and are not behind this lane at all.
    // It is proven where it belongs, in wizmatchTodayRoutes.test.ts ("rejects
    // 'viewer' reading the queues") and wizmatchPolicyRoutes.test.ts ("rejects
    // 'viewer' on GET /companies/:id/policy").
    it('serves an allowlisted read to a machine viewer who is NOT on the roster — the lane is roster-independent', async () => {
      baseUrl = await startLane({ tenantId: 'tenant-1', id: 'viewer-1', role: 'viewer' });
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/review-workbench');
      expect(status).toBe(200);
      expect(body).not.toMatchObject(GATE_DENIED_BODY);
    });

    it('still refuses that same off-roster machine viewer on a non-allowlisted read', async () => {
      baseUrl = await startLane({ tenantId: 'tenant-1', id: 'viewer-1', role: 'viewer' });
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/review-workbench-does-not-exist');
      expect(status).toBe(403);
      expect(body).toMatchObject(GATE_DENIED_BODY);
    });

    it.each(['/signals', '/domains', '/suppression', '/analytics', '/env-check'])(
      '403s a normal viewer on a real, non-allowlisted GET (%s)',
      async (path) => {
        baseUrl = await startLane({ tenantId: 'tenant-1', id: 'viewer-1', role: 'viewer' });
        const { status, body } = await getJson(baseUrl, `/api/wizmatch${path}`);
        expect(status).toBe(403);
        expect(body).toMatchObject(GATE_DENIED_BODY);
      },
    );
  });

  // ---------------------------------------------------------------------
  // Requirement 4 — the machine principal reaches all eight allowlisted GETs.
  // ---------------------------------------------------------------------
  describe('the machine principal (tenant-scoped viewer) reaches every allowlisted GET (requirement 4)', () => {
    it.each(CRM_SYNC_EXPECTED_PATHS)('GET %s reaches the handler, not the gate 403', async (path) => {
      baseUrl = await startLane(machineUser());
      const { status, body } = await getJson(baseUrl, `/api/wizmatch${path}`);
      // /placements has its OWN pre-existing in-handler RBAC check
      // (`['admin','team_lead'].includes(req.user!.role)`) unrelated to the
      // pilot gate — a viewer legitimately 403s there too, but with a
      // DIFFERENT error code, proving it reached the handler rather than
      // being stopped by wizmatchPilotGate.
      if (path === '/placements') {
        expect(status).toBe(403);
        expect(body).not.toMatchObject(GATE_DENIED_BODY);
        expect((body as { error?: string })?.error).toBe('commercial_access_requires_lead');
        return;
      }
      expect(status).toBe(200);
      expect(body).not.toMatchObject(GATE_DENIED_BODY);
    });
  });

  // ---------------------------------------------------------------------
  // Requirement 5, 6 — the machine principal is GET-only, allowlist-only.
  // ---------------------------------------------------------------------
  describe('the machine principal cannot mutate or reach send/discovery/provider routes (requirements 5, 6)', () => {
    it('POST to an allowlisted PATH (/candidates) still 403s — GET-only, not path-only', async () => {
      baseUrl = await startLane(machineUser());
      const res = await fetch(`${baseUrl}/api/wizmatch/candidates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Test Candidate', email: 'test@example.com', skills: [] }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject(GATE_DENIED_BODY);
    });

    it('cannot call send (POST /signals/:id/send)', async () => {
      baseUrl = await startLane(machineUser());
      const res = await fetch(`${baseUrl}/api/wizmatch/signals/sig-1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ variant_message_id: 'msg-1' }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject(GATE_DENIED_BODY);
    });

    it('cannot call paid discovery (POST /contact-intelligence/companies/:companyId/discover)', async () => {
      baseUrl = await startLane(machineUser());
      const res = await fetch(`${baseUrl}/api/wizmatch/contact-intelligence/companies/company-1/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmPreview: true }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject(GATE_DENIED_BODY);
    });

    it('cannot invoke a sourcing provider (POST /sourcing/:provider/run)', async () => {
      baseUrl = await startLane(machineUser());
      const res = await fetch(`${baseUrl}/api/wizmatch/sourcing/github/run`, { method: 'POST' });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject(GATE_DENIED_BODY);
    });

    it('cannot trigger candidate source-now', async () => {
      baseUrl = await startLane(machineUser());
      const res = await fetch(`${baseUrl}/api/wizmatch/candidates/source-now`, { method: 'POST' });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject(GATE_DENIED_BODY);
    });
  });

  // ---------------------------------------------------------------------
  // Requirement 7 — no authentication, lane never engages.
  // ---------------------------------------------------------------------
  it('an unauthenticated request (no req.user) never engages the lane — 401', async () => {
    baseUrl = await startLane(undefined);
    const res = await fetch(`${baseUrl}/api/wizmatch/dashboard`);
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------
  // Requirement 8 — no tenant scoping, lane never engages.
  // ---------------------------------------------------------------------
  it('a viewer without tenantId never engages the lane — falls to the pilot gate 403', async () => {
    baseUrl = await startLane({ id: 'sync-account', role: 'viewer' });
    const { status, body } = await getJson(baseUrl, '/api/wizmatch/dashboard');
    expect(status).toBe(403);
    expect(body).toMatchObject(GATE_DENIED_BODY);
  });

  it('a viewer without id never engages the lane — falls to the pilot gate 403', async () => {
    baseUrl = await startLane({ tenantId: 'tenant-1', role: 'viewer' });
    const { status, body } = await getJson(baseUrl, '/api/wizmatch/dashboard');
    expect(status).toBe(403);
    expect(body).toMatchObject(GATE_DENIED_BODY);
  });

  // ---------------------------------------------------------------------
  // Requirement 9 — a ninth / non-allowlisted GET route is refused.
  // ---------------------------------------------------------------------
  it('a real GET route not in the allowlist is refused for the machine principal', async () => {
    baseUrl = await startLane(machineUser());
    const { status, body } = await getJson(baseUrl, '/api/wizmatch/signals');
    expect(status).toBe(403);
    expect(body).toMatchObject(GATE_DENIED_BODY);
  });

  // ---------------------------------------------------------------------
  // Requirement 10 — adding a human viewer to the roster does not expand
  // access beyond the eight GETs (proves the lane does not depend on / grant
  // via the roster, and the roster cannot be used to smuggle broader access).
  // ---------------------------------------------------------------------
  describe('a human viewer explicitly added to WIZMATCH_STAFFING_PILOT_USER_IDS gets ONLY the eight GETs (requirement 10)', () => {
    beforeEach(() => {
      process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'sync-account';
    });

    it('still reaches the eight allowlisted GETs (via the machine lane, not the roster)', async () => {
      baseUrl = await startLane(machineUser());
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/dashboard');
      expect(status).toBe(200);
      expect(body).not.toMatchObject(GATE_DENIED_BODY);
    });

    it('still 403s on a non-allowlisted GET despite roster membership', async () => {
      baseUrl = await startLane(machineUser());
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/signals');
      expect(status).toBe(403);
      expect(body).toMatchObject(GATE_DENIED_BODY);
    });

    it('still 403s on POST to an allowlisted path despite roster membership', async () => {
      baseUrl = await startLane(machineUser());
      const res = await fetch(`${baseUrl}/api/wizmatch/candidates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject(GATE_DENIED_BODY);
    });

    it('the pilot gate itself STILL denies this viewer directly (roleEligible is false for viewer regardless of roster) — proves PILOT_ELIGIBLE_ROLES was not touched', async () => {
      // Route the SAME rostered viewer through a non-allowlisted GET (so the
      // machine lane does not intercept it) to observe wizmatchPilotGate's
      // own verdict in isolation.
      baseUrl = await startLane(machineUser());
      const { status, body } = await getJson(baseUrl, '/api/wizmatch/env-check');
      expect(status).toBe(403);
      expect(body).toMatchObject(GATE_DENIED_BODY);
    });
  });

  // ---------------------------------------------------------------------
  // Tenant safety — the lane does not introduce any way to supply a tenant;
  // it only ever forwards to handlers that already derive tenantId from
  // req.user.tenantId. Prove a machine request with a tenant on the
  // query/body/header does not change which tenant's data is served (the
  // handler ignores it — it always reads req.user!.tenantId).
  // ---------------------------------------------------------------------
  it('a query/header-supplied tenant on an allowlisted route is ignored — pool.query only ever receives req.user.tenantId', async () => {
    baseUrl = await startLane(machineUser({ tenantId: 'real-tenant' }));
    await fetch(`${baseUrl}/api/wizmatch/dashboard?tenantId=attacker-tenant`, {
      headers: { 'x-tenant-id': 'attacker-tenant' },
    });
    // NON-VACUITY GUARD (added by the final review). Without this the test
    // below is trivially true: if the request never reaches the handler — e.g.
    // the lane stops engaging and the pilot gate 403s it — `mock.calls` is
    // empty, the loop body never runs, and the assertion passes while proving
    // nothing. Verified by mutation: removing '/dashboard' from the allowlist
    // left this test GREEN before these two assertions were added.
    const paramLists = poolQuery.mock.calls
      .map((call) => call[1])
      .filter((params): params is unknown[] => Array.isArray(params));
    expect(paramLists.length, 'the request must actually reach the handler and query the database').toBeGreaterThan(0);
    // The authenticated tenant must genuinely be the one queried, so this
    // cannot pass merely because no tenant value appears anywhere.
    expect(
      paramLists.some((params) => params.includes('real-tenant')),
      'at least one query must be parameterised with the authenticated tenant',
    ).toBe(true);

    // Every pool.query call made while building the dashboard snapshot must
    // have been parameterised with the authenticated tenant, never the
    // query-string/header value.
    for (const params of paramLists) {
      expect(params).not.toContain('attacker-tenant');
    }
  });
});
