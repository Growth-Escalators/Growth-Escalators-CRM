import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Security-audit regression suite. Four confirmed, exploitable cross-tenant
// IDOR bugs (any authenticated user of ANY tenant could read/write another
// tenant's data by GUID or by supplying a body-level tenantId):
//
//   1. POST /api/messages            — tenantId came from req.body, not the session.
//   2. POST /api/sequences           — same: tenantId came from req.body.
//      POST /api/sequences/enrol     — enrolContact()'s contact lookup had no
//                                       tenant filter at all.
//   3. DELETE /api/sequences/enrolments/:id — cancelEnrolment() had no tenant
//                                       predicate whatsoever.
//   4. GET/PUT/DELETE /api/permissions/users/:userId — looked up/mutated the
//                                       target user by :userId alone.
//
// There is no test Postgres in this repo (see savedViewsTenantIsolation.test.ts,
// outboundTenantIsolation.test.ts), so — matching that established convention —
// these tests mock the `db` module and invoke the real route handlers/service
// functions directly, asserting on (a) the HTTP-visible outcome (403/404, no
// data returned, no mutation performed) and (b) for query-shaped predicates,
// the REAL compiled SQL (via PgDialect.sqlToQuery) so an assertion cannot pass
// against a predicate that silently omits the tenant filter.

// `permissions.ts` runs `db.execute(...)` at module top level (an idempotent
// ensure-column ALTER) — since static imports execute before any of this
// file's own top-level statements, the mock fns must exist before that import
// runs, hence `vi.hoisted` rather than a plain `const` (which would still be
// in its TDZ when `../routes/permissions` is loaded below).
const { mockSelect, mockInsert, mockUpdate, mockDelete, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockExecute: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      execute: (...args: unknown[]) => mockExecute(...args),
    },
    pool: { query: vi.fn(), connect: vi.fn() },
    messages: schema.messages,
    contactChannels: schema.contactChannels,
    sequences: schema.sequences,
    sequenceEnrolments: schema.sequenceEnrolments,
    contacts: schema.contacts,
    users: schema.users,
    userPermissions: schema.userPermissions,
  };
});

// enrolContact's WizMatch-linkage gate is out of scope for this suite —
// stub it out so every contact resolves as "not WizMatch-linked" and the
// gate branch is never exercised.
vi.mock('../modules/outreach/wizmatchLinkage', () => ({
  resolveWizmatchLinkage: vi.fn().mockResolvedValue(null),
}));
vi.mock('../modules/outreach/outreachGate', () => ({
  evaluateWizmatchOutreachGate: vi.fn(),
  shouldBlock: vi.fn().mockReturnValue(false),
}));

// sequences.ts now runs every route through requirePerm(...), which (via
// getEffectivePermissions) issues its own db.select() before the handler
// ever runs. This suite is about tenant-scoping/IDOR, not the separate
// permission gate (that's covered by sequencesPermissions.test.ts) — grant
// every permission unconditionally so the requirePerm check never consumes
// one of this file's queued mockSelect.mockReturnValueOnce(...) values
// (which are ordered to match each test's OWN handler-level queries) and
// always calls next() like a real granted request would.
vi.mock('../services/permissionResolver', async () => {
  const { ALL_PERMISSIONS } = await import('../config/permissions');
  return {
    getEffectivePermissions: async () => new Set(ALL_PERMISSIONS),
  };
});

import messagesRouter from '../routes/messages';
import sequencesRouter from '../routes/sequences';
import permissionsRouter from '../routes/permissions';
import { cancelEnrolment } from '../services/sequenceService';

const dialect = new PgDialect();

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONTACT_B = '33333333-3333-4333-8333-333333333333';
const ENROLMENT_B = '44444444-4444-4444-8444-444444444444';
const VALID_UUID = '55555555-5555-4555-8555-555555555555';

// ---------------------------------------------------------------------------
// Generic Drizzle-chain mock. Every chainable method returns the same object;
// `.returning()` resolves explicitly (insert/update/delete), and the chain
// itself is thenable so a bare `await db.select()...limit(n)` also resolves —
// whichever method the real code calls last "finishes" the query.
// ---------------------------------------------------------------------------
function resultChain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: () => c,
    orderBy: () => c,
    groupBy: () => c,
    limit: () => c,
    values: (vals: unknown) => { capturedValues.push(vals); return c; },
    set: (vals: unknown) => { capturedSets.push(vals); return c; },
    where: (cond: unknown) => { capturedWheres.push(cond); return c; },
    returning: () => Promise.resolve(rows),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

let capturedWheres: unknown[] = [];
let capturedValues: unknown[] = [];
let capturedSets: unknown[] = [];

function compiledParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as Parameters<PgDialect['sqlToQuery']>[0]).params;
}
function compiledSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as Parameters<PgDialect['sqlToQuery']>[0]).sql;
}

function makeReqRes(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req: Record<string, unknown> = {
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke(router: any, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, req: unknown, res: unknown) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    await item.handle(req, res, (err?: unknown) => { if (err) throw err; });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedWheres = [];
  capturedValues = [];
  capturedSets = [];
  mockExecute.mockResolvedValue({ rows: [] });
});

// ===========================================================================
// Bug 1 — POST /api/messages ignored the authenticated tenant
// ===========================================================================
describe('POST /messages — tenantId is the callers own, never the body', () => {
  it('stamps the authenticated tenantId even when the body tries to set another one', async () => {
    mockInsert.mockReturnValueOnce(resultChain([{ id: 'msg-1', tenantId: TENANT_A }]));

    const { req, res, statusFn } = makeReqRes({
      user: { id: USER_A, tenantId: TENANT_A },
      body: {
        tenantId: TENANT_B, // attacker-supplied — must be ignored
        contactId: CONTACT_B,
        channel: 'whatsapp',
        direction: 'outbound',
        content: 'hello',
      },
    });
    await invoke(messagesRouter, 'post', '/', req, res);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect((capturedValues[0] as { tenantId: string }).tenantId).toBe(TENANT_A);
    expect((capturedValues[0] as { tenantId: string }).tenantId).not.toBe(TENANT_B);
    expect(statusFn).not.toHaveBeenCalledWith(500);
  });
});

// ===========================================================================
// Bug 2a — POST /api/sequences ignored the authenticated tenant
// ===========================================================================
describe('POST /sequences — tenantId is the callers own, never the body', () => {
  it('stamps the authenticated tenantId even when the body tries to set another one', async () => {
    mockInsert.mockReturnValueOnce(resultChain([{ id: 'seq-1', tenantId: TENANT_A }]));

    const { req, res } = makeReqRes({
      user: { id: USER_A, tenantId: TENANT_A },
      body: { tenantId: TENANT_B, name: 'Onboarding', channel: 'whatsapp' },
    });
    await invoke(sequencesRouter, 'post', '/', req, res);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect((capturedValues[0] as { tenantId: string }).tenantId).toBe(TENANT_A);
    expect((capturedValues[0] as { tenantId: string }).tenantId).not.toBe(TENANT_B);
  });
});

// ===========================================================================
// Bug 2b — POST /api/sequences/enrol: body tenantId AND cross-tenant contact
// ===========================================================================
describe('POST /sequences/enrol — cannot enrol another tenants contact', () => {
  it('resolves tenantId from the session, and 400s when the contact does not belong to it', async () => {
    // 1st db.select — sequence lookup, scoped to the CALLER's tenant (A).
    mockSelect.mockReturnValueOnce(resultChain([
      { id: 'seq-1', tenantId: TENANT_A, name: 'onboarding', isActive: true },
    ]));
    // 2nd db.select — the contact lookup inside enrolContact(). CONTACT_B
    // actually belongs to tenant B, so a tenant-A-scoped lookup finds nothing.
    mockSelect.mockReturnValueOnce(resultChain([]));

    const { req, res, statusFn, jsonFn } = makeReqRes({
      user: { id: USER_A, tenantId: TENANT_A },
      body: { tenantId: TENANT_B, contactId: CONTACT_B, sequenceName: 'onboarding' },
    });
    await invoke(sequencesRouter, 'post', '/enrol', req, res);

    // Never reaches the enrolment insert — the contact lookup, not the body,
    // is what stopped it.
    expect(mockInsert).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(JSON.stringify(jsonFn.mock.calls[0][0])).toMatch(/not found/i);

    // The sequence lookup (call 0) must be scoped to the AUTHENTICATED
    // tenant, not the attacker-supplied body tenantId.
    expect(compiledParams(capturedWheres[0])).toContain(TENANT_A);
    expect(compiledParams(capturedWheres[0])).not.toContain(TENANT_B);

    // The contact lookup (call 1) must carry both the contactId AND the
    // caller's tenantId — this is the actual fix for the cross-tenant hole.
    expect(compiledSql(capturedWheres[1])).toContain('"contacts"."tenant_id"');
    expect(compiledSql(capturedWheres[1])).toContain('"contacts"."id"');
    expect(compiledParams(capturedWheres[1])).toEqual(expect.arrayContaining([CONTACT_B, TENANT_A]));
    expect(compiledParams(capturedWheres[1])).not.toContain(TENANT_B);
  });

  it('still enrols a contact that DOES belong to the callers tenant (no regression)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([
      { id: 'seq-1', tenantId: TENANT_A, name: 'onboarding', isActive: true },
    ]));
    mockSelect.mockReturnValueOnce(resultChain([
      { id: CONTACT_B, tenantId: TENANT_A, doNotContact: false },
    ]));
    // existing-active-enrolment check
    mockSelect.mockReturnValueOnce(resultChain([]));
    mockInsert.mockReturnValueOnce(resultChain([{ id: 'enr-1', tenantId: TENANT_A, contactId: CONTACT_B }]));

    const { req, res, statusFn } = makeReqRes({
      user: { id: USER_A, tenantId: TENANT_A },
      body: { contactId: CONTACT_B, sequenceName: 'onboarding' },
    });
    await invoke(sequencesRouter, 'post', '/enrol', req, res);

    expect(statusFn).toHaveBeenCalledWith(201);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Bug 3 — DELETE /api/sequences/enrolments/:id had no tenant predicate
// ===========================================================================
describe('DELETE /sequences/enrolments/:id — cancelEnrolment is tenant-scoped', () => {
  it('a cross-tenant enrolment id is a 404, and the UPDATE carries the callers tenant_id', async () => {
    // The enrolment belongs to tenant B; a tenant-A-scoped UPDATE affects 0 rows.
    mockUpdate.mockReturnValueOnce(resultChain([]));

    const { req, res, statusFn } = makeReqRes({
      user: { id: USER_A, tenantId: TENANT_A },
      params: { id: ENROLMENT_B },
    });
    await invoke(sequencesRouter, 'delete', '/enrolments/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(compiledSql(capturedWheres[0])).toContain('"sequence_enrolments"."tenant_id"');
    expect(compiledParams(capturedWheres[0])).toEqual([ENROLMENT_B, TENANT_A]);
    expect(compiledParams(capturedWheres[0])).not.toContain(TENANT_B);
  });

  it('cancels an enrolment that DOES belong to the callers tenant (no regression)', async () => {
    mockUpdate.mockReturnValueOnce(resultChain([{ id: ENROLMENT_B, tenantId: TENANT_A, status: 'cancelled' }]));

    const cancelled = await cancelEnrolment(ENROLMENT_B, TENANT_A);
    expect(cancelled).toBeDefined();
    expect(compiledParams(capturedWheres[0])).toEqual([ENROLMENT_B, TENANT_A]);
  });
});

// ===========================================================================
// Bug 4 — GET/PUT/DELETE /api/permissions/users/:userId — no tenant check on
// the target user
// ===========================================================================
describe('permissions.ts /users/:userId — target user must belong to the callers tenant', () => {
  function ownerCallerReqRes(overrides: Record<string, unknown> = {}) {
    return makeReqRes({
      user: { id: USER_A, tenantId: TENANT_A, role: 'admin' },
      params: { userId: USER_B },
      ...overrides,
    });
  }

  it('GET /users/:userId 404s a user from a different tenant and never reads their permissions', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller isOwner check
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_B }])); // target user lookup

    const { req, res, statusFn } = ownerCallerReqRes();
    await invoke(permissionsRouter, 'get', '/users/:userId', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockSelect).toHaveBeenCalledTimes(2); // never reaches the permissions select
  });

  it('GET /users/:userId returns permissions for a same-tenant user (no regression)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }]));
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_A }]));
    mockSelect.mockReturnValueOnce(resultChain([{ userId: USER_B, contactsView: true }]));

    const { req, res, jsonFn } = ownerCallerReqRes();
    await invoke(permissionsRouter, 'get', '/users/:userId', req, res);

    expect(jsonFn).toHaveBeenCalledWith({ permissions: { userId: USER_B, contactsView: true } });
  });

  it('PUT /users/:userId 404s a user from a different tenant and never writes', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller isOwner check
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_B }])); // target user lookup

    const { req, res, statusFn } = ownerCallerReqRes({ body: { contactsView: true } });
    await invoke(permissionsRouter, 'put', '/users/:userId', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('DELETE /users/:userId 404s a user from a different tenant, deactivates nothing, deletes nothing', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller isOwner check
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_B }])); // target user lookup

    const { req, res, statusFn } = ownerCallerReqRes();
    await invoke(permissionsRouter, 'delete', '/users/:userId', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    // Never reaches the targetPerms.isOwner check, the deactivation UPDATE, or the delete.
    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('DELETE /users/:userId removes a same-tenant user, and the permissions delete carries tenant_id (no regression)', async () => {
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: true }])); // caller isOwner check
    mockSelect.mockReturnValueOnce(resultChain([{ tenantId: TENANT_A }])); // target user lookup
    mockSelect.mockReturnValueOnce(resultChain([{ isOwner: false }])); // targetPerms (not the owner)
    mockDelete.mockReturnValueOnce(resultChain([]));

    const { req, res, jsonFn } = ownerCallerReqRes();
    await invoke(permissionsRouter, 'delete', '/users/:userId', req, res);

    expect(jsonFn).toHaveBeenCalledWith({ removed: true });
    expect(compiledSql(capturedWheres.at(-1))).toContain('"user_permissions"."tenant_id"');
    expect(compiledParams(capturedWheres.at(-1))).toEqual(expect.arrayContaining([USER_B, TENANT_A]));
  });
});

describe('sanity: unrelated UUID never collides with the fixture ids above', () => {
  it('VALID_UUID is distinct from every tenant/user/contact/enrolment fixture', () => {
    expect([TENANT_A, TENANT_B, USER_A, USER_B, CONTACT_B, ENROLMENT_B]).not.toContain(VALID_UUID);
  });
});
