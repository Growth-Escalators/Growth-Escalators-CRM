import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Real schema (not mocked) so the route's `eq(tenantBranding.tenantId, ...)`
// calls compile to genuine, parameterised SQL we can inspect — same technique
// as src/__tests__/savedViewsTenantIsolation.test.ts. This lets the tenant-
// scoping tests prove the WHERE clause binds req.user.tenantId rather than
// merely asserting a mock was "called with something".
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    pool: { query: vi.fn() },
    schema,
  };
});

import tenantBrandingRouter from '../routes/tenantBranding';

const dialect = new PgDialect();

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A_OWNER = '11111111-1111-4111-8111-111111111111';
const USER_A_STAFF = '22222222-2222-4222-8222-222222222222';

function makeReqRes(user: Record<string, unknown>, body: Record<string, unknown> = {}) {
  const req = { user, params: {}, body, query: {} } as any;
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { json: jsonFn, status: statusFn } as any;
  return { req, res, jsonFn, statusFn };
}

async function invoke(method: 'get' | 'put', path: string, req: any, res: any) {
  const layer = (tenantBrandingRouter as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  for (const item of layer.route.stack) {
    let nextCalled = false;
    await item.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
}

// Builds a mock select-chain and, if `onWhere` is given, hands the exact
// condition object the route passed to `.where(...)` back to the caller so it
// can be compiled and inspected.
function selectChain(rows: unknown[], onWhere?: (cond: unknown) => void) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((cond: unknown) => {
        onWhere?.(cond);
        return { limit: vi.fn().mockResolvedValue(rows) };
      }),
    }),
  };
}

function updateChain(returnedRows: unknown[], onWhere?: (cond: unknown) => void) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((cond: unknown) => {
        onWhere?.(cond);
        return { returning: vi.fn().mockResolvedValue(returnedRows) };
      }),
    }),
  };
}

function insertChain(returnedRows: unknown[]) {
  const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returnedRows) });
  return { values };
}

describe('GET /api/tenant-branding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the row for the caller\'s own tenant, and the WHERE binds req.user.tenantId', async () => {
    let captured: unknown;
    mockSelect.mockReturnValueOnce(selectChain(
      [{ id: 'row-1', tenantId: TENANT_A, displayName: 'Growth Escalators', logoUrl: '/ge-mark.png', primaryColor: '#1A3A5C', accentColor: '#F97316', faviconUrl: '/favicon.svg' }],
      (cond) => { captured = cond; },
    ));

    const { req, res, jsonFn } = makeReqRes({ id: USER_A_STAFF, tenantId: TENANT_A, tenantSlug: 'growth-escalators' });
    await invoke('get', '/', req, res);

    const compiled = dialect.sqlToQuery(captured as any);
    expect(compiled.sql).toContain('"tenant_branding"."tenant_id" =');
    expect(compiled.params).toEqual([TENANT_A]);
    expect(jsonFn).toHaveBeenCalledWith({ branding: expect.objectContaining({ displayName: 'Growth Escalators' }) });
  });

  it('two different tenants compile to the identical query shape but different bound tenant ids — no cross-tenant leak is even representable', async () => {
    const captured: unknown[] = [];
    mockSelect
      .mockReturnValueOnce(selectChain([], (cond) => captured.push(cond)))
      .mockReturnValueOnce(selectChain([], (cond) => captured.push(cond)));

    const reqA = makeReqRes({ id: USER_A_STAFF, tenantId: TENANT_A, tenantSlug: 'growth-escalators' });
    const reqB = makeReqRes({ id: 'user-b', tenantId: TENANT_B, tenantSlug: 'wizmatch' });
    await invoke('get', '/', reqA.req, reqA.res);
    await invoke('get', '/', reqB.req, reqB.res);

    const [a, b] = captured.map((c) => dialect.sqlToQuery(c as any));
    expect(a.sql).toBe(b.sql);
    expect(a.params).not.toEqual(b.params);
    expect(a.params).toEqual([TENANT_A]);
    expect(b.params).toEqual([TENANT_B]);
  });

  it('falls back to a computed default (using req.user.tenantSlug) when no row exists yet, without an extra DB round-trip', async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));

    const { req, res, jsonFn } = makeReqRes({ id: USER_A_STAFF, tenantId: TENANT_B, tenantSlug: 'wizmatch' });
    await invoke('get', '/', req, res);

    expect(mockSelect).toHaveBeenCalledTimes(1); // no tenants-table lookup needed — tenantSlug was already on the token
    expect(jsonFn).toHaveBeenCalledWith({ branding: expect.objectContaining({ displayName: 'Wizmatch', accentColor: '#3b82f6' }) });
  });

  it('falls back to the tenants table for the slug when the JWT lacks tenantSlug, and serves the generic placeholder for an unrecognized tenant', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([])) // tenant_branding lookup: no row
      .mockReturnValueOnce(selectChain([{ slug: 'a-pilot-reseller-slug' }])); // tenants lookup

    const { req, res, jsonFn } = makeReqRes({ id: 'user-c', tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    await invoke('get', '/', req, res);

    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(jsonFn).toHaveBeenCalledWith({ branding: expect.objectContaining({ displayName: 'Client Workspace', logoUrl: null }) });
  });
});

describe('PUT /api/tenant-branding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects with 403 when the caller is not an owner, and never reaches the branding table', async () => {
    mockSelect.mockReturnValueOnce(selectChain([{ isOwner: false }]));

    const { req, res, statusFn } = makeReqRes({ id: USER_A_STAFF, tenantId: TENANT_A }, { displayName: 'New Name' });
    await invoke('put', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(403);
    expect(mockSelect).toHaveBeenCalledTimes(1); // only the perms lookup
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects with 400 for a malformed color and does not write anything', async () => {
    mockSelect.mockReturnValueOnce(selectChain([{ isOwner: true }]));

    const { req, res, statusFn } = makeReqRes({ id: USER_A_OWNER, tenantId: TENANT_A }, { primaryColor: 'not-a-color' });
    await invoke('put', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(400);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('an owner updates their own tenant\'s row, and the WHERE binds req.user.tenantId even when the body smuggles a different tenantId', async () => {
    let captured: unknown;
    mockSelect
      .mockReturnValueOnce(selectChain([{ isOwner: true }])) // perms
      .mockReturnValueOnce(selectChain([{ id: 'row-1', tenantId: TENANT_A }])); // existing row
    mockUpdate.mockReturnValueOnce(updateChain(
      [{ id: 'row-1', tenantId: TENANT_A, displayName: 'New Name', primaryColor: '#123456' }],
      (cond) => { captured = cond; },
    ));

    const { req, res, jsonFn } = makeReqRes(
      { id: USER_A_OWNER, tenantId: TENANT_A },
      { displayName: 'New Name', primaryColor: '#123456', tenantId: TENANT_B },
    );
    await invoke('put', '/', req, res);

    const compiled = dialect.sqlToQuery(captured as any);
    expect(compiled.params).toEqual([TENANT_A]);
    expect(compiled.params).not.toContain(TENANT_B);
    expect(jsonFn).toHaveBeenCalledWith({ branding: expect.objectContaining({ displayName: 'New Name' }) });
  });

  it('an owner creates a new row for their tenant when none exists yet, requiring displayName', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ isOwner: true }])) // perms
      .mockReturnValueOnce(selectChain([])); // no existing row

    const { req, res, statusFn } = makeReqRes({ id: USER_A_OWNER, tenantId: TENANT_A }, { primaryColor: '#123456' });
    await invoke('put', '/', req, res);

    expect(statusFn).toHaveBeenCalledWith(400); // displayName required on first create
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('an owner\'s first-time create inserts scoped to req.user.tenantId', async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ isOwner: true }])) // perms
      .mockReturnValueOnce(selectChain([])); // no existing row
    const { values } = insertChain([{ id: 'new-row', tenantId: TENANT_A, displayName: 'Pilot Co' }]);
    mockInsert.mockReturnValueOnce({ values });

    const { req, res, jsonFn } = makeReqRes(
      { id: USER_A_OWNER, tenantId: TENANT_A },
      { displayName: 'Pilot Co', tenantId: TENANT_B }, // body tenantId must be ignored
    );
    await invoke('put', '/', req, res);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_A, displayName: 'Pilot Co' }));
    expect(jsonFn).toHaveBeenCalledWith({ branding: expect.objectContaining({ displayName: 'Pilot Co' }) });
  });
});
