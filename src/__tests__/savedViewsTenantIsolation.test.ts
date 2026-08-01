import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// The two properties this feature lives or dies on:
//
//   1. Every statement filters on req.user.tenantId, and another tenant's view
//      is indistinguishable from a view that does not exist (404 both).
//   2. A private view never leaks to another user inside the same tenant.
//
// There is no test Postgres in this repo, so instead of asserting that a mock
// was called, these tests compile the REAL predicate the route hands to Drizzle
// (PgDialect.sqlToQuery — same technique as contactSearch.test.ts) and then
// evaluate that compiled SQL against fixture rows. The visibility rule is
// therefore proven behaviourally: rows in, rows out.

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../db/index', async () => {
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
  buildVisibilityCondition,
  buildViewByIdCondition,
  buildOwnNamedViewCondition,
} from '../routes/savedViews';

const dialect = new PgDialect();

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ME = '11111111-1111-4111-8111-111111111111';
const TEAMMATE = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT_USER = '44444444-4444-4444-8444-444444444444';
const VIEW_ID = '33333333-3333-4333-8333-333333333333';
const PAGE = 'wizmatch-requirements';

// ---------------------------------------------------------------------------
// A minimal evaluator for the parenthesised, fully-parameterised boolean
// expressions Drizzle emits: `"tbl"."col" = $n`, grouped by a single connective
// per paren group. Anything outside that shape throws rather than silently
// evaluating to true — a predicate this test cannot understand must fail loudly.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function matches(compiled: { sql: string; params: unknown[] }, row: Row): boolean {
  const tokens = compiled.sql.match(/\(|\)|"[a-z_]+"\."[a-z_]+"|\$\d+|=|and|or|true|false|null/g) ?? [];
  let i = 0;

  const peek = (): string => {
    const token = tokens[i];
    if (token === undefined) throw new Error(`unexpected end of predicate: ${compiled.sql}`);
    return token;
  };
  const next = (): string => { const token = peek(); i += 1; return token; };

  function comparison(): boolean {
    const column = next();
    if (!/^"[a-z_]+"\."[a-z_]+"$/.test(column)) throw new Error(`unsupported operand ${column}`);
    if (next() !== '=') throw new Error(`unsupported operator after ${column}`);
    const rhs = next();
    const expected = rhs.startsWith('$') ? compiled.params[Number(rhs.slice(1)) - 1] : rhs === 'true';
    return row[column.split('.')[1].replace(/"/g, '')] === expected;
  }

  function group(): boolean {
    if (next() !== '(') throw new Error(`expected a group in ${compiled.sql}`);
    const operands: boolean[] = [];
    const connectives: string[] = [];
    while (peek() !== ')') {
      const token = peek();
      if (token === '(') { operands.push(group()); continue; }
      if (token === 'and' || token === 'or') { connectives.push(next()); continue; }
      operands.push(comparison());
    }
    next(); // ')'
    if (connectives.some((c) => c !== connectives[0])) {
      throw new Error(`mixed connectives without explicit grouping: ${compiled.sql}`);
    }
    return connectives[0] === 'or' ? operands.some(Boolean) : operands.every(Boolean);
  }

  const result = group();
  if (i !== tokens.length) throw new Error(`unparsed tail in ${compiled.sql}`);
  return result;
}

// Fixture rows keyed by database column name, as Postgres would see them.
const ROWS: Row[] = [
  { name: 'A — my private view', tenant_id: TENANT_A, page_id: PAGE, owner_user_id: ME, is_shared: false },
  { name: 'B — my shared view', tenant_id: TENANT_A, page_id: PAGE, owner_user_id: ME, is_shared: true },
  { name: 'C — teammate private view', tenant_id: TENANT_A, page_id: PAGE, owner_user_id: TEAMMATE, is_shared: false },
  { name: 'D — teammate shared view', tenant_id: TENANT_A, page_id: PAGE, owner_user_id: TEAMMATE, is_shared: true },
  { name: 'E — other tenant shared view', tenant_id: TENANT_B, page_id: PAGE, owner_user_id: OTHER_TENANT_USER, is_shared: true },
  { name: 'F — other tenant view owned by my user id', tenant_id: TENANT_B, page_id: PAGE, owner_user_id: ME, is_shared: false },
  { name: 'G — my view on another page', tenant_id: TENANT_A, page_id: 'wizmatch-companies', owner_user_id: ME, is_shared: true },
];

function visibleTo(tenantId: string, userId: string, pageId = PAGE): string[] {
  const compiled = dialect.sqlToQuery(buildVisibilityCondition(tenantId, pageId, userId));
  return ROWS.filter((r) => matches(compiled, r)).map((r) => r.name as string);
}

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

const capturedWheres: any[] = [];

function makeReqRes(tenantId: string, userId: string, overrides: Record<string, unknown> = {}) {
  const jsonFn = vi.fn();
  const sendFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn, end: sendFn });
  const req: any = {
    user: { id: userId, tenantId, role: 'admin', email: 'x@example.test', tokenVersion: 1 },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
  return { req, res: { json: jsonFn, status: statusFn } as any, jsonFn, statusFn, sendFn };
}

async function invoke(method: 'get' | 'post' | 'patch' | 'delete', path: string, req: any, res: any) {
  const layer = (savedViewsRouter as any).stack
    .find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  await layer.route.stack[0].handle(req, res, (err?: unknown) => { if (err) throw err; });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedWheres.length = 0;
});

describe('saved views — visibility inside a tenant', () => {
  it('shows me my own views (private and shared) plus other people\'s shared views — and nothing else', () => {
    expect(visibleTo(TENANT_A, ME)).toEqual([
      'A — my private view',
      'B — my shared view',
      'D — teammate shared view',
    ]);
  });

  it('never returns a teammate\'s PRIVATE view', () => {
    const visible = visibleTo(TENANT_A, ME);
    expect(visible).not.toContain('C — teammate private view');

    // ...and it is not simply invisible to everyone: its owner still sees it.
    expect(visibleTo(TENANT_A, TEAMMATE)).toContain('C — teammate private view');
  });

  it('does return a teammate\'s SHARED view', () => {
    expect(visibleTo(TENANT_A, ME)).toContain('D — teammate shared view');
  });

  it('scopes to the requested page — my shared view on another page does not bleed in', () => {
    expect(visibleTo(TENANT_A, ME)).not.toContain('G — my view on another page');
    expect(visibleTo(TENANT_A, ME, 'wizmatch-companies')).toEqual(['G — my view on another page']);
  });

  it('the same user id in a different tenant sees a completely disjoint set', () => {
    expect(visibleTo(TENANT_B, ME)).toEqual([
      'E — other tenant shared view',
      'F — other tenant view owned by my user id',
    ]);
  });
});

describe('saved views — tenant isolation', () => {
  it('a shared view from another tenant is invisible even though is_shared = true', () => {
    expect(visibleTo(TENANT_A, ME)).not.toContain('E — other tenant shared view');
  });

  it('a colliding user id cannot reach across the tenant boundary', () => {
    // Row F has owner_user_id === ME but belongs to tenant B. If tenant_id were
    // missing from the predicate, ownership alone would let it through.
    expect(visibleTo(TENANT_A, ME)).not.toContain('F — other tenant view owned by my user id');
  });

  it('every exported condition carries tenant_id, and the tenant is the first bound parameter', () => {
    const list = dialect.sqlToQuery(buildVisibilityCondition(TENANT_A, PAGE, ME));
    const byId = dialect.sqlToQuery(buildViewByIdCondition(TENANT_A, VIEW_ID));
    const byName = dialect.sqlToQuery(buildOwnNamedViewCondition(TENANT_A, ME, PAGE, 'n'));

    for (const compiled of [list, byId, byName]) {
      expect(compiled.sql).toContain('"saved_views"."tenant_id" =');
      expect(compiled.params).toContain(TENANT_A);
    }
    expect(list.params[0]).toBe(TENANT_A);
    expect(byId.params).toEqual([VIEW_ID, TENANT_A]);
  });

  it('the same view id read by two tenants compiles to two different bound predicates', () => {
    const a = dialect.sqlToQuery(buildViewByIdCondition(TENANT_A, VIEW_ID));
    const b = dialect.sqlToQuery(buildViewByIdCondition(TENANT_B, VIEW_ID));
    expect(a.sql).toBe(b.sql);
    expect(a.params).not.toEqual(b.params);
  });

  it('GET binds the callers tenant, not anything from the request', async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));
    const { req, res, jsonFn } = makeReqRes(TENANT_A, ME, { query: { pageId: PAGE, tenantId: TENANT_B } });
    await invoke('get', '/', req, res);

    const compiled = dialect.sqlToQuery(capturedWheres[0]);
    expect(compiled.params).toEqual([TENANT_A, PAGE, ME, true]);
    expect(compiled.params).not.toContain(TENANT_B);
    expect(jsonFn).toHaveBeenCalledWith({ items: [] });
  });

  it('PATCH on another tenant\'s view is a 404, not a 403 — existence is never revealed', async () => {
    // The tenant-scoped SELECT finds nothing, exactly as it would for an id
    // that was never issued.
    mockSelect.mockReturnValueOnce(selectChain([]));

    const { req, res, statusFn, jsonFn } = makeReqRes(TENANT_A, ME, {
      params: { id: VIEW_ID },
      body: { name: 'Stolen' },
    });
    await invoke('patch', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(statusFn).not.toHaveBeenCalledWith(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(capturedWheres[0]).params).toEqual([VIEW_ID, TENANT_A]);

    // Byte-identical to the response for an id that exists nowhere at all.
    const notFoundBody = jsonFn.mock.calls[0][0];
    mockSelect.mockReturnValueOnce(selectChain([]));
    const fresh = makeReqRes(TENANT_A, ME, {
      params: { id: '99999999-9999-4999-8999-999999999999' },
      body: { name: 'Stolen' },
    });
    await invoke('patch', '/:id', fresh.req, fresh.res);
    expect(fresh.jsonFn.mock.calls[0][0]).toEqual(notFoundBody);
  });

  it('DELETE on another tenant\'s view is a 404 and deletes nothing', async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));

    const { req, res, statusFn } = makeReqRes(TENANT_A, ME, { params: { id: VIEW_ID } });
    await invoke('delete', '/:id', req, res);

    expect(statusFn).toHaveBeenCalledWith(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('POST stamps the callers tenant even when the body tries to set another one', async () => {
    const { req, res, statusFn } = makeReqRes(TENANT_A, ME, {
      body: { pageId: PAGE, name: 'n', query: '', tenantId: TENANT_B },
    });
    await invoke('post', '/', req, res);

    // tenantId is not an accepted key at all — rejected before any write.
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('the predicate evaluator itself', () => {
  it('fails loudly on a predicate shape it does not understand', () => {
    expect(() => matches({ sql: '"t"."c" > $1', params: [1] }, { c: 2 })).toThrow();
  });

  it('agrees with Postgres semantics on a hand-checked case', () => {
    const compiled = dialect.sqlToQuery(buildVisibilityCondition(TENANT_A, PAGE, ME));
    expect(compiled.sql).toBe(
      '("saved_views"."tenant_id" = $1 and "saved_views"."page_id" = $2 and '
      + '("saved_views"."owner_user_id" = $3 or "saved_views"."is_shared" = $4))',
    );
    expect(matches(compiled, { tenant_id: TENANT_A, page_id: PAGE, owner_user_id: ME, is_shared: false })).toBe(true);
    expect(matches(compiled, { tenant_id: TENANT_A, page_id: PAGE, owner_user_id: TEAMMATE, is_shared: false })).toBe(false);
    expect(matches(compiled, { tenant_id: TENANT_A, page_id: PAGE, owner_user_id: TEAMMATE, is_shared: true })).toBe(true);
    expect(matches(compiled, { tenant_id: TENANT_B, page_id: PAGE, owner_user_id: ME, is_shared: true })).toBe(false);
  });
});
