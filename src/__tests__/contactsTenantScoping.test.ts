import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// The tenant-scoping lint check (scripts/lint-tenant-scoping.ts, PR #114)
// independently flagged 4 routes in src/routes/contacts.ts that scoped a
// mutation/read by `id` (or `noteId`) alone, with no `tenantId` predicate
// anywhere: PATCH /:id, GET /:id/channels, PATCH /:id/notes/:noteId, and
// DELETE /:id/notes/:noteId. Any authenticated user of ANY tenant could
// read or mutate another tenant's contact/notes by guessing/reusing an id.
//
// These tests prove, for each of the 4 routes:
//   1. (structural) the query actually sent to the DB embeds a tenant_id
//      predicate carrying the CALLER's tenantId — not just an id/noteId
//      match — by compiling the real Drizzle condition object with
//      PgDialect (same technique as contactSearch.test.ts /
//      savedViewsTenantIsolation.test.ts).
//   2. (behavioural) when the row genuinely belongs to a different tenant
//      (simulated by the scoped query finding nothing, exactly as a real
//      Postgres WHERE tenant_id = $callerTenant would), the route responds
//      404 — not a data leak, not a silent 200.
//   3. (behavioural) the legitimate same-tenant path still works.
//
// There is no test Postgres in this repo (see savedViewsTenantIsolation.test.ts),
// so `../db/index` is mocked with the REAL schema (via vi.importActual) and a
// fake `db` whose select/update/delete chains are driven per-test.

vi.mock('../db/index', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      insert: vi.fn(),
    },
    pool: { query: vi.fn(), connect: vi.fn() },
  };
});

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

import contactsRouter from '../routes/contacts';

const dialect = new PgDialect();
function compile(cond: unknown) {
  return dialect.sqlToQuery(cond as SQL);
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = '22222222-2222-4222-8222-222222222222';

function makeReqRes(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const req = {
    user: { tenantId: TENANT_A },
    params: {},
    body: {},
    ...overrides,
  } as any;
  const res: any = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn };
}

async function invokeRoute(method: 'get' | 'patch' | 'delete', path: string, req: any, res: any) {
  const layer = (contactsRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    await item.handle(req, res, vi.fn());
  }
}

// ---- chain builders mirroring the exact shape each route calls -----------
function selectWithLimit(capture: (c: unknown) => void, rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((c: unknown) => {
        capture(c);
        return { limit: vi.fn().mockResolvedValue(rows) };
      }),
    }),
  };
}
function selectPlain(capture: (c: unknown) => void, rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((c: unknown) => {
        capture(c);
        return Promise.resolve(rows);
      }),
    }),
  };
}
function updateReturning(capture: (c: unknown) => void, rows: unknown[]) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((c: unknown) => {
        capture(c);
        return { returning: vi.fn().mockResolvedValue(rows) };
      }),
    }),
  };
}
function deleteReturning(capture: (c: unknown) => void, rows: unknown[]) {
  return {
    where: vi.fn().mockImplementation((c: unknown) => {
      capture(c);
      return { returning: vi.fn().mockResolvedValue(rows) };
    }),
  };
}

beforeEach(() => {
  mockSelect.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
});

describe('PATCH /contacts/:id — tenant isolation', () => {
  it('embeds the caller tenantId in the ownership-check predicate, not just the contact id', async () => {
    let captured: unknown;
    mockSelect.mockReturnValueOnce(selectWithLimit((c) => (captured = c), []));

    const { req, res, statusFn } = makeReqRes({
      params: { id: CONTACT_ID },
      body: { status: 'qualified' },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('patch', '/:id', req, res);

    const compiled = compile(captured);
    expect(compiled.sql).toContain('"tenant_id"');
    expect(compiled.params).toContain(TENANT_A);
    // ownership check failed -> 404, and the update must never have been attempted
    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a contact belonging to tenant B is invisible to tenant A (404, not the row)', async () => {
    // Simulates the real scoped WHERE (id AND tenant_id = caller) finding
    // nothing, exactly as Postgres would for a cross-tenant id.
    mockSelect.mockReturnValueOnce(selectWithLimit(() => {}, []));

    const { req, res, statusFn, jsonFn } = makeReqRes({
      params: { id: CONTACT_ID },
      body: { status: 'qualified' },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'contact not found' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('the legitimate same-tenant update still succeeds', async () => {
    mockSelect.mockReturnValueOnce(selectWithLimit(() => {}, [{ id: CONTACT_ID }]));
    mockUpdate.mockReturnValueOnce(
      updateReturning(() => {}, [{ id: CONTACT_ID, status: 'qualified' }]),
    );

    const { req, res, jsonFn, statusFn } = makeReqRes({
      params: { id: CONTACT_ID },
      body: { status: 'qualified' },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('patch', '/:id', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ id: CONTACT_ID, status: 'qualified' });
  });
});

describe('GET /contacts/:id/channels — tenant isolation', () => {
  it('embeds the caller tenantId in the ownership-check predicate', async () => {
    let captured: unknown;
    mockSelect.mockReturnValueOnce(selectWithLimit((c) => (captured = c), []));

    const { req, res, statusFn } = makeReqRes({ params: { id: CONTACT_ID }, user: { tenantId: TENANT_A } });
    await invokeRoute('get', '/:id/channels', req, res);

    const compiled = compile(captured);
    expect(compiled.sql).toContain('"tenant_id"');
    expect(compiled.params).toContain(TENANT_A);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('a contact belonging to tenant B never has its channels returned to tenant A', async () => {
    mockSelect.mockReturnValueOnce(selectWithLimit(() => {}, [])); // ownership check fails

    const { req, res, statusFn, jsonFn } = makeReqRes({ params: { id: CONTACT_ID }, user: { tenantId: TENANT_A } });
    await invokeRoute('get', '/:id/channels', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'contact not found' });
    // the channels select must never even run once ownership fails
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('the legitimate same-tenant lookup still returns channels', async () => {
    mockSelect.mockReturnValueOnce(selectWithLimit(() => {}, [{ id: CONTACT_ID }]));
    mockSelect.mockReturnValueOnce(
      selectPlain(() => {}, [{ id: 'chan-1', contactId: CONTACT_ID, channelType: 'email', channelValue: 'a@b.com' }]),
    );

    const { req, res, jsonFn, statusFn } = makeReqRes({ params: { id: CONTACT_ID }, user: { tenantId: TENANT_A } });
    await invokeRoute('get', '/:id/channels', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({
      channels: [{ id: 'chan-1', contactId: CONTACT_ID, channelType: 'email', channelValue: 'a@b.com' }],
    });
  });
});

describe('PATCH /contacts/:id/notes/:noteId — tenant isolation', () => {
  it('embeds the caller tenantId (and contactId) in the update predicate, not just noteId', async () => {
    let captured: unknown;
    mockUpdate.mockReturnValueOnce(updateReturning((c) => (captured = c), []));

    const { req, res, statusFn } = makeReqRes({
      params: { id: CONTACT_ID, noteId: NOTE_ID },
      body: { content: 'edited' },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('patch', '/:id/notes/:noteId', req, res);

    const compiled = compile(captured);
    expect(compiled.sql).toContain('"tenant_id"');
    expect(compiled.sql).toContain('"contact_id"');
    expect(compiled.params).toContain(TENANT_A);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('a note belonging to tenant B is not editable by tenant A (404, no leak)', async () => {
    mockUpdate.mockReturnValueOnce(updateReturning(() => {}, [])); // scoped update finds nothing

    const { req, res, statusFn, jsonFn } = makeReqRes({
      params: { id: CONTACT_ID, noteId: NOTE_ID },
      body: { content: 'malicious edit' },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('patch', '/:id/notes/:noteId', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'note not found' });
  });

  it('the legitimate same-tenant note edit still succeeds', async () => {
    mockUpdate.mockReturnValueOnce(
      updateReturning(() => {}, [{ id: NOTE_ID, content: 'edited', tenantId: TENANT_A }]),
    );

    const { req, res, jsonFn, statusFn } = makeReqRes({
      params: { id: CONTACT_ID, noteId: NOTE_ID },
      body: { content: 'edited' },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('patch', '/:id/notes/:noteId', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ id: NOTE_ID, content: 'edited', tenantId: TENANT_A });
  });
});

describe('DELETE /contacts/:id/notes/:noteId — tenant isolation', () => {
  it('embeds the caller tenantId in the delete predicate, not just noteId + contactId', async () => {
    let captured: unknown;
    mockDelete.mockReturnValueOnce(deleteReturning((c) => (captured = c), []));

    const { req, res, statusFn } = makeReqRes({
      params: { id: CONTACT_ID, noteId: NOTE_ID },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('delete', '/:id/notes/:noteId', req, res);

    const compiled = compile(captured);
    expect(compiled.sql).toContain('"tenant_id"');
    expect(compiled.params).toContain(TENANT_A);
    expect(statusFn).toHaveBeenCalledWith(404);
  });

  it('a note belonging to tenant B is not deletable by tenant A (404, row untouched)', async () => {
    mockDelete.mockReturnValueOnce(deleteReturning(() => {}, [])); // scoped delete matches nothing

    const { req, res, statusFn, jsonFn } = makeReqRes({
      params: { id: CONTACT_ID, noteId: NOTE_ID },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('delete', '/:id/notes/:noteId', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'note not found' });
  });

  it('the legitimate same-tenant delete still succeeds', async () => {
    mockDelete.mockReturnValueOnce(deleteReturning(() => {}, [{ id: NOTE_ID }]));

    const { req, res, jsonFn, statusFn } = makeReqRes({
      params: { id: CONTACT_ID, noteId: NOTE_ID },
      user: { tenantId: TENANT_A },
    });
    await invokeRoute('delete', '/:id/notes/:noteId', req, res);

    expect(statusFn).not.toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith({ deleted: true });
  });

  it('the same noteId queried by two different tenants produces two different where() conditions', async () => {
    const seenWheres: unknown[] = [];
    mockDelete.mockReturnValue(deleteReturning((c) => seenWheres.push(c), []));

    const tenantA = makeReqRes({ params: { id: CONTACT_ID, noteId: NOTE_ID }, user: { tenantId: TENANT_A } });
    const tenantB = makeReqRes({ params: { id: CONTACT_ID, noteId: NOTE_ID }, user: { tenantId: TENANT_B } });
    await invokeRoute('delete', '/:id/notes/:noteId', tenantA.req, tenantA.res);
    await invokeRoute('delete', '/:id/notes/:noteId', tenantB.req, tenantB.res);

    expect(seenWheres).toHaveLength(2);
    expect(compile(seenWheres[0]).params).not.toEqual(compile(seenWheres[1]).params);
  });
});
