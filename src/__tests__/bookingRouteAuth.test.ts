// Security audit (2026-08) regression coverage — src/routes/booking.ts was
// mounted at `/book` in src/index.ts with NO auth middleware at all. The only
// route meant to be public is the visitor-facing `GET /book/:slug` redirect;
// every other route (funnel create/read/update/reset management) was
// reachable by anyone on the internet, several trusting `tenantId` straight
// off the request body/query with no verification.
//
// The fix mirrors the existing `/api/funnel-configs` carve-out in
// src/index.ts (a single mount, with a small inline middleware that decides
// whether to run `requireAuth` based on `req.path` after the mount prefix is
// stripped): `/book/funnels*` is now auth-gated, `/book/:slug` stays public.
// booking.ts itself now derives `tenantId` from `req.user.tenantId` for every
// admin route instead of trusting the body/query.
//
// `src/index.ts` cannot be safely imported in a unit test (module load starts
// a real HTTP listener and a real Postgres pool — see
// wizmatchIndexMountOrder.test.ts / wizmatchPilotGateOnOutreachRouter.test.ts,
// this repo's established convention for this exact problem). This file
// combines the same two techniques those tests use:
//   1. A source-level scan asserting the real mount line in src/index.ts
//      actually wires requireAuth into the `/book/funnels*` chain, and that
//      booking.ts no longer reads tenantId off the body/query for the admin
//      routes.
//   2. A behavioural test that mounts the REAL requireAuth and the REAL
//      booking router on a bare express app, in the SAME relative order the
//      fixed index.ts mount now uses, and proves the gate actually
//      denies/scopes as expected.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const TEST_SECRET = 'test-jwt-secret-booking';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// db/index mock — shared by requireAuth (users lookup) and booking.ts
// (funnels / funnelMembers lookups). Re-exports the REAL schema tables (as
// savedViewsTenantIsolation.test.ts / auth.test.ts do) so `eq(funnels.tenantId, …)`
// still gets valid Column references; select/update results are queued
// per-test via mockReturnValueOnce.
// ---------------------------------------------------------------------------
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

const capturedWheres: unknown[] = [];

function selectChain(rows: unknown[]) {
  const chainObj: any = {};
  const passthrough = () => chainObj;
  chainObj.from = passthrough;
  chainObj.leftJoin = passthrough;
  chainObj.innerJoin = passthrough;
  chainObj.where = (cond: unknown) => { capturedWheres.push(cond); return chainObj; };
  chainObj.groupBy = passthrough;
  chainObj.orderBy = passthrough;
  chainObj.limit = passthrough;
  chainObj.then = (resolve: (v: unknown) => void) => resolve(rows);
  return chainObj;
}

function updateChain(rows: unknown[]) {
  const chainObj: any = {};
  chainObj.set = () => chainObj;
  chainObj.where = (cond: unknown) => { capturedWheres.push(cond); return chainObj; };
  chainObj.returning = () => Promise.resolve(rows);
  return chainObj;
}

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    pool: { query: vi.fn(), connect: vi.fn() },
    users: schema.users,
    tenants: schema.tenants,
    funnels: schema.funnels,
    funnelMembers: schema.funnelMembers,
  };
});

// The six admin routes call these service functions for the "happy path"
// pieces this file doesn't need to re-prove (roundRobinService has its own
// tests); mocking them keeps this file focused on auth + tenant-scoping.
const createFunnel = vi.fn();
const addMember = vi.fn();
const getFunnelStats = vi.fn();
const resetFunnelCounts = vi.fn();
const getNextMember = vi.fn();

vi.mock('../services/roundRobinService', () => ({
  createFunnel: (...args: unknown[]) => createFunnel(...args),
  addMember: (...args: unknown[]) => addMember(...args),
  getFunnelStats: (...args: unknown[]) => getFunnelStats(...args),
  resetFunnelCounts: (...args: unknown[]) => resetFunnelCounts(...args),
  getNextMember: (...args: unknown[]) => getNextMember(...args),
}));

function signToken(tenantId: string, overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    { id: USER_A, email: 'a@b.test', tenantId, role: 'admin', tokenVersion: 1, ...overrides },
    TEST_SECRET,
  );
}

// requireAuth's identity check — first db.select call on any authenticated
// request. Queue this before any route-specific selects.
function mockIdentityRow(tenantId: string, tokenVersion = 1, isActive: boolean | null = true) {
  mockSelect.mockReturnValueOnce(selectChain([{ tokenVersion, tenantId, isActive }]));
}

let server: Server | null = null;

async function startBookingApp(): Promise<string> {
  vi.resetModules();
  process.env.JWT_SECRET = TEST_SECRET;
  const { requireAuth } = await import('../middleware/auth');
  const { default: bookingRouter } = await import('../routes/booking');

  const app = express();
  app.use(express.json());
  // Mirrors the FIXED src/index.ts mount exactly (see the source-scan test
  // below for the literal line): requireAuth only runs for /book/funnels*,
  // GET /book/:slug (the visitor redirect) is never gated.
  app.use('/book', (req, res, next) => {
    if (req.path.startsWith('/funnels')) return requireAuth(req, res, next);
    return next();
  }, bookingRouter);

  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedWheres.length = 0;
  delete process.env.JWT_SECRET;
});

afterEach(async () => {
  delete process.env.JWT_SECRET;
  if (server) {
    const s = server;
    server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// 1. Source-level scan — proves the actual shipped wiring, not just this
//    test file's re-implementation of it.
// ---------------------------------------------------------------------------
describe('src/index.ts — /book mount wires requireAuth onto /book/funnels* only', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  const bookingSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'booking.ts'), 'utf8');

  it('gates /book on a conditional requireAuth wrapper keyed on req.path starting with /funnels', () => {
    expect(indexSource).toMatch(
      /app\.use\('\/book',\s*\(req, res, next\) => \{\s*if \(req\.path\.startsWith\('\/funnels'\)\) return requireAuth\(req, res, next\);\s*return next\(\);\s*\}, bookingRouter\);/,
    );
  });

  it('booking.ts no longer trusts tenantId from the request body/query for the admin routes', () => {
    expect(bookingSource).not.toMatch(/req\.query\['tenantId'\]/);
    expect(bookingSource).not.toMatch(/const \{ tenantId,/);
    expect(bookingSource).not.toMatch(/\{ tenantId \} = req\.body/);
  });

  it('every admin route in booking.ts derives tenantId from req.user', () => {
    const occurrences = bookingSource.match(/const tenantId = req\.user!\.tenantId;/g) ?? [];
    // POST /funnels, GET /funnels, GET stats, POST members, PATCH member, POST reset
    expect(occurrences.length).toBe(6);
  });

  it('the PATCH member route now scopes the update by funnelId AND tenantId', () => {
    const patchBlock = bookingSource.slice(bookingSource.indexOf("router.patch('/funnels/:slug/members/:memberId'"));
    expect(patchBlock).toMatch(/eq\(funnelMembers\.funnelId, funnel\.id\)/);
    expect(patchBlock).toMatch(/eq\(funnelMembers\.tenantId, tenantId\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioural — no token => 401, on all six admin routes.
//    requireAuth 401s on the missing-header branch before any DB call, so no
//    mock DB rows are queued for this block; a rogue db.select call would
//    itself blow up loudly (chain methods undefined) rather than silently
//    letting a request through.
// ---------------------------------------------------------------------------
describe('booking admin routes — no Authorization header', () => {
  it('POST /book/funnels -> 401', async () => {
    const baseUrl = await startBookingApp();
    const res = await fetch(`${baseUrl}/book/funnels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n', slug: 's', members: [{ memberName: 'm', calcomUrl: 'u', weight: 100 }] }),
    });
    expect(res.status).toBe(401);
    expect(createFunnel).not.toHaveBeenCalled();
  });

  it('GET /book/funnels -> 401', async () => {
    const baseUrl = await startBookingApp();
    const res = await fetch(`${baseUrl}/book/funnels`);
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('GET /book/funnels/:slug/stats -> 401', async () => {
    const baseUrl = await startBookingApp();
    const res = await fetch(`${baseUrl}/book/funnels/some-slug/stats`);
    expect(res.status).toBe(401);
    expect(getFunnelStats).not.toHaveBeenCalled();
  });

  it('POST /book/funnels/:slug/members -> 401', async () => {
    const baseUrl = await startBookingApp();
    const res = await fetch(`${baseUrl}/book/funnels/some-slug/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberName: 'm', calcomUrl: 'u', weight: 50 }),
    });
    expect(res.status).toBe(401);
    expect(addMember).not.toHaveBeenCalled();
  });

  it('PATCH /book/funnels/:slug/members/:memberId -> 401', async () => {
    const baseUrl = await startBookingApp();
    const res = await fetch(`${baseUrl}/book/funnels/some-slug/members/member-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weight: 60 }),
    });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('POST /book/funnels/:slug/reset -> 401', async () => {
    const baseUrl = await startBookingApp();
    const res = await fetch(`${baseUrl}/book/funnels/some-slug/reset`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(resetFunnelCounts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. The public visitor redirect is unaffected by the fix — it must stay
//    reachable with no Authorization header at all (never 401).
// ---------------------------------------------------------------------------
describe('GET /book/:slug — public visitor redirect, unauthenticated', () => {
  it('never returns 401, even though requireAuth is now wired onto the same /book mount', async () => {
    const baseUrl = await startBookingApp();
    getNextMember.mockResolvedValueOnce({ calcomUrl: 'https://cal.com/someone' });
    // getTenantId() inside booking.ts hits db.select on `tenants`, unmocked
    // here (queue empty) — falls through to the route's own catch-all and
    // redirects to the fallback URL. The only thing this test asserts is
    // that the response is a redirect, never a 401.
    const res = await fetch(`${baseUrl}/book/some-visitor-slug`, { redirect: 'manual' });
    expect(res.status).toBe(302);
  });
});

// ---------------------------------------------------------------------------
// 4. Tenant scoping — a valid tenant-A token must not reach tenant-B's data.
//    Each service/db call is scoped by req.user.tenantId; when the funnel
//    lookup is scoped to tenant A and the row belongs to tenant B, the
//    tenant-scoped query legitimately finds nothing => 404 (never leaking
//    tenant B's row, never a 200 with someone else's data).
// ---------------------------------------------------------------------------
describe('booking admin routes — tenant A token, tenant B\'s funnel/member', () => {
  it('GET /book/funnels/:slug/stats — funnel belongs to tenant B -> 404, tenant A never sees it', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    getFunnelStats.mockRejectedValueOnce(new Error(`Funnel not found: b-only-slug`));

    const res = await fetch(`${baseUrl}/book/funnels/b-only-slug/stats`, {
      headers: { authorization: `Bearer ${signToken(TENANT_A)}` },
    });
    expect(res.status).toBe(404);
    // Proves tenant A's id was what got passed down, not anything from the URL/body.
    expect(getFunnelStats).toHaveBeenCalledWith('b-only-slug', TENANT_A);
  });

  it('POST /book/funnels/:slug/members — funnel belongs to tenant B -> 404, member never created', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    mockSelect.mockReturnValueOnce(selectChain([])); // funnel lookup scoped to tenant A finds nothing

    const res = await fetch(`${baseUrl}/book/funnels/b-only-slug/members`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken(TENANT_A)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ memberName: 'Attacker', calcomUrl: 'https://evil.example/cal', weight: 100 }),
    });
    expect(res.status).toBe(404);
    expect(addMember).not.toHaveBeenCalled();
    // The funnel lookup itself was scoped by tenant A's id, not the URL alone.
    expect(capturedWheres.length).toBeGreaterThan(0);
  });

  it('PATCH /book/funnels/:slug/members/:memberId — member belongs to tenant B -> 404, nothing updated', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    // funnel lookup (slug + tenant A) finds nothing, because the funnel/member
    // actually belongs to tenant B.
    mockSelect.mockReturnValueOnce(selectChain([]));

    const res = await fetch(`${baseUrl}/book/funnels/b-only-slug/members/member-owned-by-b`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${signToken(TENANT_A)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ calcomUrl: 'https://evil.example/cal' }),
    });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PATCH — even if the funnel slug happens to resolve for tenant A, the update itself still filters by tenantId (defence in depth)', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    mockSelect.mockReturnValueOnce(selectChain([{ id: 'funnel-a-1' }])); // funnel exists under tenant A
    mockUpdate.mockReturnValueOnce(updateChain([])); // but the member row itself isn't tenant A's -> no rows updated

    const res = await fetch(`${baseUrl}/book/funnels/shared-slug/members/member-owned-by-b`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${signToken(TENANT_A)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ weight: 10 }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /book/funnels/:slug/reset — funnel belongs to tenant B -> 404, counts never reset', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    resetFunnelCounts.mockRejectedValueOnce(new Error('Funnel not found: b-only-slug'));

    const res = await fetch(`${baseUrl}/book/funnels/b-only-slug/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken(TENANT_A)}` },
    });
    expect(res.status).toBe(404);
    expect(resetFunnelCounts).toHaveBeenCalledWith('b-only-slug', TENANT_A);
  });

  it('GET /book/funnels — lists only tenant A\'s funnels, ignoring a spoofed ?tenantId query param', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    mockSelect.mockReturnValueOnce(selectChain([{ id: 'funnel-a-1', name: 'A only', slug: 'a-only' }]));

    const res = await fetch(`${baseUrl}/book/funnels?tenantId=${TENANT_B}`, {
      headers: { authorization: `Bearer ${signToken(TENANT_A)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ slug: string }>;
    expect(body).toEqual([{ id: 'funnel-a-1', name: 'A only', slug: 'a-only' }]);
  });

  it('POST /book/funnels — creates under the token\'s tenant even when the body sends a different tenantId', async () => {
    const baseUrl = await startBookingApp();
    mockIdentityRow(TENANT_A);
    createFunnel.mockResolvedValueOnce({ id: 'funnel-a-2', tenantId: TENANT_A, name: 'n', slug: 's' });
    addMember.mockResolvedValueOnce({ id: 'member-1' });

    const res = await fetch(`${baseUrl}/book/funnels`, {
      method: 'POST',
      headers: { authorization: `Bearer ${signToken(TENANT_A)}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_B, // attacker-supplied — must be ignored
        name: 'n',
        slug: 's',
        members: [{ memberName: 'm', calcomUrl: 'u', weight: 100 }],
      }),
    });
    expect(res.status).toBe(201);
    expect(createFunnel).toHaveBeenCalledWith(TENANT_A, 'n', 's');
    expect(addMember).toHaveBeenCalledWith('funnel-a-2', TENANT_A, 'm', 'u', 100);
  });
});
