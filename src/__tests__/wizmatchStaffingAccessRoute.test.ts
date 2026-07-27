// Added by the final independent review of PR 8B. Two safety properties this
// branch's own remediation relies on had NO regression control at all —
// verified empirically, not assumed: each mutation below was applied to the
// real source, the whole targeted suite still passed, and the file was
// restored.
//
//   M-4 — reintroducing `return process.env.NODE_ENV !== 'production'` as the
//         fallback in `wizmatchStaffing.ts`'s OWN `isStaffingPhaseEnabled`
//         left the suite GREEN. The pre-existing test
//         (`wizmatchStaffingRoutes.test.ts`, "defaults every phase off in
//         production…") samples only NODE_ENV='production' — the single value
//         at which the fixed and the vulnerable implementations agree
//         (`'production' !== 'production'` is false, same as the fixed
//         unconditional false). Staging/development/test/unset — the values
//         the fallback actually leaks open — were never exercised.
//         `wizmatchStaffingAccess.ts`'s separate `phaseEnabled` copy IS
//         well covered (wizmatchStaffingAccess.test.ts's it.each matrix);
//         this file closes the same gap for the route-file duplicate.
//
//   M-2 — making `GET /staffing/access` honour a caller-supplied
//         `?userId=` subject left the suite GREEN. The route is the one
//         deliberate exception registered ABOVE the staffing pilot gate
//         (wizmatchStaffing.ts:44, gate at :51), and "it is safe because it is
//         current-caller-only" is the entire justification for that exception —
//         yet `wizmatchStaffingRoutes.test.ts` only asserted the route is
//         REGISTERED, and `wizmatchStaffingAccess.test.ts` only exercises
//         `resolveStaffingAccess` directly, never through the Express handler,
//         so neither can see a route-layer subject-injection bug.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import staffingRouter, { isStaffingPhaseEnabled } from '../routes/wizmatchStaffing';

interface AccessResponse {
  allowed: boolean;
  configured: boolean;
  role: string;
  phases: Record<string, boolean>;
  capabilities: Record<string, boolean>;
}

async function getAccess(url: string): Promise<AccessResponse> {
  return (await fetch(url)).json() as Promise<AccessResponse>;
}

describe('wizmatchStaffing.isStaffingPhaseEnabled — explicit flag only, no NODE_ENV branch (M-4)', () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const flagKeys = (['A', 'B', 'C'] as const).map((p) => `WIZMATCH_STAFFING_GATE_${p}_ENABLED`);

  beforeEach(() => {
    for (const key of flagKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of flagKeys) delete process.env[key];
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  // The load-bearing case: every NODE_ENV a misconfigured deploy could carry,
  // not just 'production'. A reintroduced `NODE_ENV !== 'production'` fallback
  // turns every non-'production' row red immediately.
  it.each(['production', 'staging', 'development', 'test', ''])(
    'defaults every phase OFF with NODE_ENV=%o and no flag configured',
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      for (const phase of ['A', 'B', 'C'] as const) {
        expect(isStaffingPhaseEnabled(phase), `phase ${phase} with NODE_ENV=${nodeEnv}`).toBe(false);
      }
    },
  );

  it('defaults every phase OFF when NODE_ENV is unset entirely', () => {
    delete process.env.NODE_ENV;
    for (const phase of ['A', 'B', 'C'] as const) {
      expect(isStaffingPhaseEnabled(phase), `phase ${phase}`).toBe(false);
    }
  });

  // Negative control — an explicit flag must still turn a phase on in every
  // runtime, so the assertions above cannot be satisfied by a hardcoded false.
  it.each(['production', 'staging', 'development', 'test', ''])(
    'honours an explicit enabling flag with NODE_ENV=%o',
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      process.env.WIZMATCH_STAFFING_GATE_B_ENABLED = 'true';
      expect(isStaffingPhaseEnabled('B')).toBe(true);
      // …and does not leak across phases.
      expect(isStaffingPhaseEnabled('A')).toBe(false);
      expect(isStaffingPhaseEnabled('C')).toBe(false);
    },
  );

  it('treats an explicit falsey flag as off', () => {
    process.env.NODE_ENV = 'development';
    for (const value of ['false', '0', 'no', 'off', '']) {
      process.env.WIZMATCH_STAFFING_GATE_A_ENABLED = value;
      expect(isStaffingPhaseEnabled('A'), `value ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

describe('GET /staffing/access — current-caller-only, the M-2 pilot-gate exception', () => {
  let server: Server | null = null;
  const savedRoster = process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;

  afterEach(async () => {
    if (savedRoster === undefined) delete process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;
    else process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = savedRoster;
    if (server) {
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  async function start(user: Record<string, unknown>): Promise<string> {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = user;
      next();
    });
    app.use('/api/wizmatch', staffingRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('ignores a caller-supplied ?userId — the answer is always about the authenticated caller', async () => {
    // 'rostered' is on the roster; 'outsider' is not. If the route honoured a
    // caller-supplied subject, the outsider could read the rostered user's
    // access answer (allowed: true) instead of their own (allowed: false).
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'rostered';
    const baseUrl = await start({ tenantId: 'tenant-1', id: 'outsider', role: 'team_lead' });

    const injected = await getAccess(`${baseUrl}/api/wizmatch/staffing/access?userId=rostered`);
    const plain = await getAccess(`${baseUrl}/api/wizmatch/staffing/access`);

    expect(injected.allowed).toBe(false);
    expect(injected).toEqual(plain);
  });

  it('ignores a caller-supplied ?role and ?tenantId too', async () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'rostered';
    const baseUrl = await start({ tenantId: 'tenant-1', id: 'rostered', role: 'staff' });

    const injected = await getAccess(
      `${baseUrl}/api/wizmatch/staffing/access?role=admin&tenantId=tenant-evil&userId=someone-else`,
    );

    // Role must remain the caller's own, so the capability map is the caller's.
    expect(injected.role).toBe('staff');
    expect(injected.capabilities.manageFinance).toBe(false);
    expect(injected.allowed).toBe(true);
  });

  // Positive control — the route really does answer, and really does vary with
  // the AUTHENTICATED caller, so the assertions above are not passing merely
  // because the endpoint returns a constant.
  it('varies with the authenticated caller, and never returns roster membership', async () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'rostered';

    let baseUrl = await start({ tenantId: 'tenant-1', id: 'rostered', role: 'admin' });
    const insider = await getAccess(`${baseUrl}/api/wizmatch/staffing/access`);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;

    baseUrl = await start({ tenantId: 'tenant-1', id: 'outsider', role: 'admin' });
    const outsider = await getAccess(`${baseUrl}/api/wizmatch/staffing/access`);

    expect(insider.allowed).toBe(true);
    expect(outsider.allowed).toBe(false);
    // No roster identifiers may leak through this pre-gate route.
    const serialised = JSON.stringify(insider) + JSON.stringify(outsider);
    expect(serialised).not.toContain('rostered');
  });

  it('401s an unauthenticated caller rather than answering about nobody', async () => {
    const app = express();
    app.use('/api/wizmatch', staffingRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    const baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const res = await fetch(`${baseUrl}/api/wizmatch/staffing/access`);
    expect(res.status).toBe(401);
  });
});
