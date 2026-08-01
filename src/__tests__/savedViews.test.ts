import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Route behaviour for /api/saved-views. Tenant isolation and cross-user
// visibility get their own file (savedViewsTenantIsolation.test.ts).

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../db/index', async () => {
  // The real table objects (schema.ts has no side effects — it never opens a
  // pool), so conditions the route builds compile to real SQL below.
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    pool: { query: vi.fn(), connect: vi.fn() },
    users: schema.users,
  };
});

import savedViewsRouter, {
  parseCreateBody,
  parsePatchBody,
  parsePageIdParam,
  parseViewId,
  serializeView,
  sortViews,
  SAVED_VIEW_LIMITS,
} from '../routes/savedViews';

const dialect = new PgDialect();

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ME = '11111111-1111-4111-8111-111111111111';
const USER_TEAMMATE = '22222222-2222-4222-8222-222222222222';
const VIEW_ID = '33333333-3333-4333-8333-333333333333';

const capturedWheres: any[] = [];
const capturedValues: any[] = [];
const capturedConflicts: any[] = [];
const capturedSets: any[] = [];

function selectChain(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: (cond: unknown) => { capturedWheres.push(cond); return chain; },
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

function insertChain(rows: unknown[]) {
  const chain: any = {
    values: (values: unknown) => { capturedValues.push(values); return chain; },
    onConflictDoUpdate: (conflict: unknown) => { capturedConflicts.push(conflict); return chain; },
    returning: () => Promise.resolve(rows),
  };
  return chain;
}

function updateChain(rows: unknown[]) {
  const chain: any = {
    set: (values: unknown) => { capturedSets.push(values); return chain; },
    where: (cond: unknown) => { capturedWheres.push(cond); return chain; },
    returning: () => Promise.resolve(rows),
  };
  return chain;
}

function deleteChain() {
  return {
    where: (cond: unknown) => { capturedWheres.push(cond); return Promise.resolve({ rowCount: 1 }); },
  } as any;
}

function makeReqRes(overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const sendFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn, end: sendFn });
  const req: any = {
    user: { id: USER_ME, tenantId: TENANT_A, role: 'staff', email: 'me@example.test', tokenVersion: 1 },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  const res: any = { json: jsonFn, status: statusFn };
  return { req, res, jsonFn, statusFn, sendFn };
}

async function invoke(method: 'get' | 'post' | 'patch' | 'delete', path: string, req: any, res: any) {
  const layer = (savedViewsRouter as any).stack
    .find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  await layer.route.stack[0].handle(req, res, (err?: unknown) => { if (err) throw err; });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: VIEW_ID,
    pageId: 'wizmatch-requirements',
    name: 'Hot ATS leads',
    query: 'score=8..&status=scored',
    isShared: false,
    ownerUserId: USER_ME,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedWheres.length = 0;
  capturedValues.length = 0;
  capturedConflicts.length = 0;
  capturedSets.length = 0;
});

describe('GET /api/saved-views', () => {
  it('returns the contract item shape with isOwner and ownerName resolved server-side', async () => {
    mockSelect.mockReturnValueOnce(selectChain([
      { ...row(), ownerName: 'Jatin' },
      { ...row({ id: 'other', name: 'Aged pipeline', ownerUserId: USER_TEAMMATE, isShared: true }), ownerName: 'Kanishk' },
    ]));

    const { req, res, jsonFn } = makeReqRes({ query: { pageId: 'wizmatch-requirements' } });
    await invoke('get', '/', req, res);

    const payload = jsonFn.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['items']);
    expect(Object.keys(payload.items[0]).sort()).toEqual([
      'createdAt', 'id', 'isOwner', 'isShared', 'name', 'ownerName', 'ownerUserId', 'pageId', 'query', 'updatedAt',
    ]);
    expect(payload.items[0]).toMatchObject({
      id: VIEW_ID,
      pageId: 'wizmatch-requirements',
      name: 'Hot ATS leads',
      query: 'score=8..&status=scored',
      isShared: false,
      ownerUserId: USER_ME,
      ownerName: 'Jatin',
      isOwner: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    });
    expect(payload.items[1]).toMatchObject({ isOwner: false, ownerName: 'Kanishk', isShared: true });
  });

  it('400s when pageId is missing', async () => {
    const { req, res, statusFn } = makeReqRes({ query: {} });
    await invoke('get', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('401s when there is no authenticated user', async () => {
    const { req, res, statusFn } = makeReqRes({ user: undefined, query: { pageId: 'p' } });
    await invoke('get', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('sorts the callers own views first, then shared, alphabetically within each', () => {
    const sorted = sortViews([
      { isOwner: false, name: 'beta shared' },
      { isOwner: true, name: 'zulu mine' },
      { isOwner: false, name: 'alpha shared' },
      { isOwner: true, name: 'alpha mine' },
    ]);
    expect(sorted.map((v) => v.name)).toEqual(['alpha mine', 'zulu mine', 'alpha shared', 'beta shared']);
  });
});

describe('POST /api/saved-views', () => {
  it('creates a view and returns 201 { item }', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([]))               // no existing view with that name
      .mockReturnValueOnce(selectChain([{ name: 'Jatin' }])); // owner name
    mockInsert.mockReturnValueOnce(insertChain([row()]));

    const { req, res, statusFn, jsonFn } = makeReqRes({
      body: { pageId: 'wizmatch-requirements', name: 'Hot ATS leads', query: 'score=8..' },
    });
    await invoke('post', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(201);
    expect(jsonFn.mock.calls[0][0].item).toMatchObject({ id: VIEW_ID, isOwner: true, ownerName: 'Jatin' });
    // tenant + owner are stamped from the session, never from the body
    expect(capturedValues[0]).toMatchObject({
      tenantId: TENANT_A,
      ownerUserId: USER_ME,
      pageId: 'wizmatch-requirements',
      name: 'Hot ATS leads',
      isShared: false,
    });
  });

  it('upserts on the unique tuple and returns 200 when the name already exists', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ id: VIEW_ID }])) // existing view with this name
      .mockReturnValueOnce(selectChain([{ name: 'Jatin' }]));
    mockInsert.mockReturnValueOnce(insertChain([row({ query: 'score=9..', isShared: true })]));

    const { req, res, statusFn, jsonFn } = makeReqRes({
      body: { pageId: 'wizmatch-requirements', name: 'Hot ATS leads', query: 'score=9..', isShared: true },
    });
    await invoke('post', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(200);
    expect(jsonFn.mock.calls[0][0].item).toMatchObject({ query: 'score=9..', isShared: true });
    // one row, updated in place — not a second insert
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(capturedConflicts[0].target).toHaveLength(4);
    expect(capturedConflicts[0].set).toMatchObject({ query: 'score=9..', isShared: true });
    expect(capturedConflicts[0].set.updatedAt).toBeInstanceOf(Date);
    // the conflict target is exactly the unique index (tenant, owner, page, name)
    expect(capturedConflicts[0].target.map((c: any) => c.name))
      .toEqual(['tenant_id', 'owner_user_id', 'page_id', 'name']);
  });

  it('scopes the existing-name probe to the caller tenant AND the caller user', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ name: 'Jatin' }]));
    mockInsert.mockReturnValueOnce(insertChain([row()]));

    const { req, res } = makeReqRes({
      body: { pageId: 'wizmatch-requirements', name: 'Hot ATS leads', query: '' },
    });
    await invoke('post', '/', req, res);

    const probe = dialect.sqlToQuery(capturedWheres[0]);
    expect(probe.sql).toContain('"saved_views"."tenant_id" = $1');
    expect(probe.sql).toContain('"saved_views"."owner_user_id" = $2');
    expect(probe.params).toEqual([TENANT_A, USER_ME, 'wizmatch-requirements', 'Hot ATS leads']);
  });

  it.each([
    ['missing name', { pageId: 'p', query: '' }],
    ['blank name after trim', { pageId: 'p', name: '   ', query: '' }],
    ['name over 80 chars', { pageId: 'p', name: 'x'.repeat(81), query: '' }],
    ['pageId over 64 chars', { pageId: 'x'.repeat(65), name: 'n', query: '' }],
    ['query over 2000 chars', { pageId: 'p', name: 'n', query: 'x'.repeat(2001) }],
    ['non-string query', { pageId: 'p', name: 'n', query: { a: 1 } }],
    ['non-boolean isShared', { pageId: 'p', name: 'n', query: '', isShared: 'yes' }],
    ['unknown key', { pageId: 'p', name: 'n', query: '', ownerUserId: USER_TEAMMATE }],
  ])('400s on %s and writes nothing', async (_label, body) => {
    const { req, res, statusFn } = makeReqRes({ body });
    await invoke('post', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('accepts the boundary lengths', () => {
    const parsed = parseCreateBody({
      pageId: 'x'.repeat(SAVED_VIEW_LIMITS.pageId),
      name: 'x'.repeat(SAVED_VIEW_LIMITS.name),
      query: 'x'.repeat(SAVED_VIEW_LIMITS.query),
    });
    expect(parsed.name).toHaveLength(80);
    expect(parsed.query).toHaveLength(2000);
    expect(parsed.isShared).toBe(false);
  });

  it('trims name and pageId before storing', () => {
    expect(parseCreateBody({ pageId: '  page  ', name: '  My view  ', query: 'a=1' }))
      .toEqual({ pageId: 'page', name: 'My view', query: 'a=1', isShared: false });
  });
});

describe('PATCH /api/saved-views/:id', () => {
  it('updates an owned view and returns { item } with a bumped updatedAt', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([row()]))          // ownership load
      .mockReturnValueOnce(selectChain([{ name: 'Jatin' }])); // owner name
    mockUpdate.mockReturnValueOnce(updateChain([row({ name: 'Renamed', isShared: true })]));

    const { req, res, jsonFn } = makeReqRes({ params: { id: VIEW_ID }, body: { name: 'Renamed', isShared: true } });
    await invoke('patch', '/:id', req, res);

    expect(jsonFn.mock.calls[0][0].item).toMatchObject({ name: 'Renamed', isShared: true, isOwner: true });
    expect(capturedSets[0]).toMatchObject({ name: 'Renamed', isShared: true });
    expect(capturedSets[0].updatedAt).toBeInstanceOf(Date);
  });

  it('403s a teammate patching a view they do not own, and writes nothing', async () => {
    mockSelect.mockReturnValueOnce(selectChain([row({ ownerUserId: USER_TEAMMATE, isShared: true })]));

    const { req, res, statusFn } = makeReqRes({ params: { id: VIEW_ID }, body: { name: 'Hijacked' } });
    await invoke('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('ignores an ownerUserId supplied in the body (unknown key → 400, never trusted)', async () => {
    const { req, res, statusFn } = makeReqRes({
      params: { id: VIEW_ID },
      body: { name: 'Mine now', ownerUserId: USER_ME, tenantId: TENANT_A },
    });
    await invoke('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('400s an empty patch body', async () => {
    const { req, res, statusFn } = makeReqRes({ params: { id: VIEW_ID }, body: {} });
    await invoke('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('404s a malformed id without touching the database', async () => {
    const { req, res, statusFn } = makeReqRes({ params: { id: 'not-a-uuid' }, body: { name: 'x' } });
    await invoke('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('409s when a rename collides with another of the callers views on the same page', async () => {
    mockSelect.mockReturnValueOnce(selectChain([row()]));
    mockUpdate.mockReturnValueOnce({
      set: () => ({ where: () => ({ returning: () => Promise.reject(Object.assign(new Error('dup'), { code: '23505' })) }) }),
    });

    const { req, res, statusFn, jsonFn } = makeReqRes({ params: { id: VIEW_ID }, body: { name: 'Existing name' } });
    await invoke('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(409);
    expect(jsonFn.mock.calls[0][0]).toMatchObject({ error: 'duplicate_name' });
  });
});

describe('DELETE /api/saved-views/:id', () => {
  it('deletes an owned view and returns 204 with no body', async () => {
    mockSelect.mockReturnValueOnce(selectChain([row()]));
    mockDelete.mockReturnValueOnce(deleteChain());

    const { req, res, statusFn, sendFn, jsonFn } = makeReqRes({ params: { id: VIEW_ID } });
    await invoke('delete', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(204);
    expect(sendFn).toHaveBeenCalled();
    expect(jsonFn).not.toHaveBeenCalled();
  });

  it('403s a teammate deleting a shared view they do not own, and deletes nothing', async () => {
    mockSelect.mockReturnValueOnce(selectChain([row({ ownerUserId: USER_TEAMMATE, isShared: true })]));

    const { req, res, statusFn } = makeReqRes({ params: { id: VIEW_ID } });
    await invoke('delete', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('404s a malformed id without touching the database', async () => {
    const { req, res, statusFn } = makeReqRes({ params: { id: '../../etc/passwd' } });
    await invoke('delete', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe('validation helpers', () => {
  it('parsePageIdParam rejects missing, empty and oversized values', () => {
    expect(() => parsePageIdParam(undefined)).toThrow(/pageId is required/);
    expect(() => parsePageIdParam('')).toThrow(/pageId is required/);
    expect(() => parsePageIdParam('x'.repeat(65))).toThrow(/at most 64/);
    expect(parsePageIdParam(['wizmatch-requirements'])).toBe('wizmatch-requirements');
  });

  it('parseViewId turns anything that is not a uuid into a 404, not a 400', () => {
    expect(() => parseViewId('nope')).toThrow(expect.objectContaining({ status: 404 }));
    expect(parseViewId(VIEW_ID)).toBe(VIEW_ID);
  });

  it('parsePatchBody keeps only the three mutable fields', () => {
    expect(parsePatchBody({ name: ' A ', query: 'a=1', isShared: true }))
      .toEqual({ name: 'A', query: 'a=1', isShared: true });
    expect(() => parsePatchBody({ pageId: 'moved' })).toThrow(/Unsupported field/);
    expect(() => parsePatchBody(null)).toThrow(/JSON object body/);
  });

  it('serializeView computes isOwner from the row, not from anything client-supplied', () => {
    const mine = serializeView(row() as any, 'Jatin', USER_ME);
    const theirs = serializeView(row({ ownerUserId: USER_TEAMMATE }) as any, 'Kanishk', USER_ME);
    expect(mine.isOwner).toBe(true);
    expect(theirs.isOwner).toBe(false);
    expect(serializeView(row() as any, null, USER_ME).ownerName).toBeNull();
  });
});
