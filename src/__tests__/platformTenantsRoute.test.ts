import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// POST /api/platform/tenants (src/routes/platformTenants.ts) — the HTTP
// entry point for provisioning a reseller-pilot tenant from the admin panel,
// wrapping the exact same core logic as `npm run onboarding:provision-
// reseller-tenant` (src/services/tenantProvisioning.ts). This exercises the
// REAL router, including the `router.use(requirePlatformSuperadmin)` gate at
// its top (src/middleware/rbac.ts) — not just the route handler in
// isolation — so a 403 for a non-superadmin caller is proven end-to-end
// through the actual middleware chain, the same chain index.ts mounts.
//
// `../db/index` is mocked once for the whole file. Both the route's own
// dependency chain (src/routes/platformTenants.ts -> src/services/
// tenantProvisioning.ts -> '../db/index' relative to src/services/) and
// requirePlatformSuperadmin's (src/middleware/rbac.ts -> '../db/index'
// relative to src/middleware/) resolve to the same absolute module
// (src/db/index.ts), so one vi.doMock intercepts both — same technique
// documented in src/__tests__/provisionResellerTenant.test.ts.
// `db/schema` is left unmocked (real Drizzle column objects), matching that
// same file's approach.
// ---------------------------------------------------------------------------

interface DbMockConfig {
  /** One entry per db.select(...).from(...).where(...).limit(1) call, in call order. */
  selects?: unknown[][];
  /** One entry per db.insert(...).values(...).returning(...) call, in call order. */
  inserts?: unknown[][];
}

function mockDb({ selects = [], inserts = [] }: DbMockConfig) {
  let selectCall = 0;
  const limit = vi.fn(() => Promise.resolve(selects[selectCall++] ?? []));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  let insertCall = 0;
  const values = vi.fn((_values: unknown) => {
    const rows = inserts[insertCall++] ?? [];
    const returning = vi.fn().mockResolvedValue(rows);
    return Object.assign(Promise.resolve(undefined), { returning });
  });
  const insert = vi.fn().mockReturnValue({ values });

  vi.doMock('../db/index', () => ({
    db: { select, insert },
    // requirePlatformSuperadmin (src/middleware/rbac.ts) imports `users` from
    // '../db/index' (not '../db/schema') — plain string placeholders are
    // enough since our mocked `.where()` never inspects its argument, same
    // shape src/__tests__/platformSuperadmin.test.ts uses.
    users: { id: 'id', isPlatformSuperadmin: 'is_platform_superadmin' },
  }));
  return { select, insert, where, from, limit, values };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res as unknown as import('express').Response & { statusCode: number; body: unknown };
}

function makeReq(user: Record<string, unknown> | undefined, body: Record<string, unknown> = {}) {
  return { user, body } as unknown as import('express').Request;
}

// Walks the router's OWN stack (middleware + route layers), chaining next()
// exactly like Express does — unlike the simpler "find the one matching
// route layer" harness other route tests in this repo use, this one also
// runs any router.use(...) layers ahead of the route, so a middleware that
// short-circuits (never calls next()) is faithfully exercised.
//
// Real middleware (e.g. requirePlatformSuperadmin) calls `next()` WITHOUT
// awaiting it and then returns — the call that invoked it therefore resolves
// before the rest of the chain (and the terminal res.json()) has actually
// run. Rather than relying on the return-value chain (which that
// fire-and-forget pattern breaks), this harness patches `res.json` to
// resolve a `done` promise, and awaits THAT — it fires the chain and waits
// for a response to actually be sent, exactly what a real HTTP client would
// observe.
function invoke(router: any, method: 'get' | 'post', path: string, req: any, res: any): Promise<void> {
  let resolveDone: () => void;
  let rejectDone: (e: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const r = originalJson(body);
    resolveDone();
    return r;
  };

  const layers = router.stack;
  let idx = 0;
  function runNext(err?: unknown): void {
    if (err) { rejectDone(err); return; }
    const layer = layers[idx++];
    if (!layer) { resolveDone(); return; }
    if (layer.route) {
      if (layer.route.path !== path || !layer.route.methods?.[method]) { runNext(); return; }
      const routeStack = layer.route.stack;
      let rIdx = 0;
      function runRoute(err2?: unknown): void {
        if (err2) { rejectDone(err2); return; }
        const item = routeStack[rIdx++];
        if (!item) { resolveDone(); return; }
        Promise.resolve(item.handle(req, res, runRoute)).catch(rejectDone);
      }
      runRoute();
      return;
    }
    Promise.resolve(layer.handle(req, res, runNext)).catch(rejectDone);
  }
  runNext();
  return done;
}

const SUPERADMIN_ROW = [{ isPlatformSuperadmin: true }];
const NON_SUPERADMIN_ROW = [{ isPlatformSuperadmin: false }];

beforeEach(() => {
  vi.resetModules();
  vi.doMock('@node-rs/argon2', () => ({ hash: vi.fn().mockResolvedValue('mock-hashed-password') }));
});

describe('router.use(requirePlatformSuperadmin) gate', () => {
  it('rejects a non-superadmin caller with 403 and never reaches provisioning logic', async () => {
    const { insert } = mockDb({ selects: [NON_SUPERADMIN_ROW] });
    const { default: router } = await import('../routes/platformTenants');

    const req = makeReq({ id: 'user-1', tenantId: 'tenant-1', role: 'admin' }, {
      name: 'Acme Marketing Co', slug: 'acme-marketing', ownerEmail: 'owner@acme.example', ownerName: 'Jane Doe',
    });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);

    expect(res.statusCode).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects with 403 when there is no authenticated user at all', async () => {
    mockDb({});
    const { default: router } = await import('../routes/platformTenants');

    const req = makeReq(undefined, { name: 'Acme Marketing Co', slug: 'acme-marketing', ownerEmail: 'owner@acme.example' });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/platform/tenants — input validation (superadmin caller)', () => {
  it('400s when name is missing, without touching provisioning logic', async () => {
    const { insert } = mockDb({ selects: [SUPERADMIN_ROW] });
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq({ id: 'admin-1' }, { slug: 'acme-marketing', ownerEmail: 'owner@acme.example' });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/tenant name is required/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('400s on an invalid slug format, surfacing validateTenantSlug\'s own message', async () => {
    mockDb({ selects: [SUPERADMIN_ROW] });
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq({ id: 'admin-1' }, { name: 'Acme Marketing Co', slug: 'Acme Marketing', ownerEmail: 'owner@acme.example' });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid tenant slug/);
  });

  it('400s on a malformed owner email', async () => {
    mockDb({ selects: [SUPERADMIN_ROW] });
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq({ id: 'admin-1' }, { name: 'Acme Marketing Co', slug: 'acme-marketing', ownerEmail: 'not-an-email' });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/valid owner email is required/);
  });
});

describe('POST /api/platform/tenants — successful provisioning (matches the CLI script\'s own shape)', () => {
  it('creates a fresh tenant/owner/pipeline, returns the one-time password + login URL, and never logs the password', async () => {
    mockDb({
      selects: [
        SUPERADMIN_ROW, // requirePlatformSuperadmin
        [], // ensureTenant miss
        [], // ensureOwnerUser miss
        [], // ensureDefaultPipeline miss
      ],
      inserts: [
        [{ id: 'tenant-1' }], // tenant insert
        [{ id: 'user-1' }], // owner insert
        [], // userPermissions insert
        [{ id: 'pipeline-1' }], // pipeline insert
      ],
    });
    const { default: router } = await import('../routes/platformTenants');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const req = makeReq({ id: 'admin-1' }, {
      name: 'Acme Marketing Co', slug: 'acme-marketing', ownerEmail: 'Owner@Acme.Example', ownerName: 'Jane Doe',
    });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as {
      ok: boolean;
      tenant: { id: string; name: string; slug: string; plan: string; alreadyExisted: boolean };
      owner: { id: string; email: string; name: string; alreadyExisted: boolean };
      pipeline: { id: string; name: string; slug: string; alreadyExisted: boolean };
      loginUrl: string;
      temporaryPassword: string | null;
    };
    expect(body.ok).toBe(true);
    // Same shape provisionResellerTenant() (and therefore the CLI script)
    // returns — this route adds only loginUrl/note on top.
    expect(body.tenant).toEqual({ id: 'tenant-1', name: 'Acme Marketing Co', slug: 'acme-marketing', plan: 'reseller_pilot', alreadyExisted: false });
    expect(body.owner).toEqual({ id: 'user-1', email: 'owner@acme.example', name: 'Jane Doe', alreadyExisted: false });
    expect(body.pipeline).toEqual({ id: 'pipeline-1', name: 'Sales Pipeline', slug: 'sales', alreadyExisted: false });
    expect(body.loginUrl).toBe('https://crm.growthescalators.com/login?tenant=acme-marketing');
    expect(typeof body.temporaryPassword).toBe('string');
    expect(body.temporaryPassword).not.toBeNull();

    // The one-time password must be present in the JSON response but must
    // never appear in any console.log/console.error call this request made.
    const password = body.temporaryPassword as string;
    const allLoggedArgs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat();
    for (const arg of allLoggedArgs) {
      expect(String(arg)).not.toContain(password);
    }

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('is idempotent: re-posting an existing slug reuses every row, mints no new password, and does not insert', async () => {
    const { insert } = mockDb({
      selects: [
        SUPERADMIN_ROW, // requirePlatformSuperadmin
        [{ id: 'tenant-1' }], // tenant already exists
        [{ id: 'user-1' }], // owner already exists
        [{ id: 'pipeline-1' }], // pipeline already exists
      ],
    });
    const { default: router } = await import('../routes/platformTenants');

    const req = makeReq({ id: 'admin-1' }, {
      name: 'Acme Marketing Co', slug: 'acme-marketing', ownerEmail: 'owner@acme.example', ownerName: 'Jane Doe',
    });
    const res = makeRes();
    await invoke(router, 'post', '/', req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as {
      tenant: { alreadyExisted: boolean };
      owner: { alreadyExisted: boolean };
      pipeline: { alreadyExisted: boolean };
      temporaryPassword: string | null;
      note: string;
    };
    expect(body.tenant.alreadyExisted).toBe(true);
    expect(body.owner.alreadyExisted).toBe(true);
    expect(body.pipeline.alreadyExisted).toBe(true);
    expect(body.temporaryPassword).toBeNull();
    expect(body.note).toMatch(/already existed/);
    expect(insert).not.toHaveBeenCalled();
  });
});
