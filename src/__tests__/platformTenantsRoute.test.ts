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
function invoke(router: any, method: 'get' | 'post' | 'patch', path: string, req: any, res: any): Promise<void> {
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

// ---------------------------------------------------------------------------
// GET / (list), GET /:tenantId (detail), PATCH /:tenantId/status
// (suspend/reactivate), PATCH /:tenantId/features, PATCH /:tenantId/plan —
// the tenant-management surface added alongside the original provisioning
// route above, all behind the SAME `router.use(requirePlatformSuperadmin)`
// gate (exercised here exactly like the POST / tests above: through the
// REAL router stack, not just the handler in isolation).
//
// `getTenantFeatures`/`setTenantFeatures`/`setTenantPlan`/`KNOWN_PLANS`
// (src/services/tenantFeatures.ts) are mocked at the module level rather than
// re-driven through a db mock — that module's OWN logic (including the
// plan-change feature-reset decision) has its own dedicated coverage in
// src/__tests__/tenantFeatures.test.ts. These tests verify only that each
// ROUTE validates its input, 404s correctly, and calls through to the right
// function with the right arguments — the same "wraps an existing function,
// tests the wrapping" scope this file's header already establishes for
// POST /.
//
// "Suspend actually blocks API access" (not just the DB flag) is NOT proven
// here — that's the requireAuth per-request re-check, covered end-to-end by
// the "requireAuth — suspended tenants" describe block in
// src/__tests__/auth.test.ts. This file only proves the route writes
// `tenants.isActive` correctly and audits the change.
// ---------------------------------------------------------------------------

function selectChain(rows: unknown[]) {
  const chainObj: any = {};
  const passthrough = () => chainObj;
  chainObj.from = passthrough;
  chainObj.leftJoin = passthrough;
  chainObj.innerJoin = passthrough;
  chainObj.where = passthrough;
  chainObj.groupBy = passthrough;
  chainObj.orderBy = passthrough;
  chainObj.limit = passthrough;
  chainObj.offset = passthrough;
  chainObj.then = (resolve: (v: unknown) => void) => resolve(rows);
  return chainObj;
}

function makeReq2(user: Record<string, unknown> | undefined, opts: {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string>;
} = {}) {
  return {
    user,
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
  } as unknown as import('express').Request;
}

interface TenantManagementMockConfig {
  /** defaults true — set false to exercise the requirePlatformSuperadmin 403 path. */
  superadmin?: boolean;
  /** One entry per db.select(...) call AFTER the requirePlatformSuperadmin check, in call order. */
  selects?: unknown[][];
  /** One entry per db.execute(sql\`...\`) call, in call order (the raw-SQL owner/user-count helpers). */
  executes?: unknown[][];
}

/**
 * Richer db/index mock than mockDb() above — these routes touch db.select
 * with orderBy/offset/innerJoin chains the provisioning route never uses,
 * plus db.execute (raw SQL) and db.update, none of which mockDb() models.
 * `selectChain`'s passthrough-everything-then-resolve shape (same technique
 * src/__tests__/bookingRouteAuth.test.ts's own `selectChain` uses) means one
 * queued row-array works regardless of which chain methods the route calls.
 */
function mockDbForTenantManagement({ superadmin = true, selects = [], executes = [] }: TenantManagementMockConfig) {
  const mockSelect = vi.fn();
  mockSelect.mockReturnValueOnce(selectChain([{ isPlatformSuperadmin: superadmin }])); // requirePlatformSuperadmin's own lookup
  for (const rows of selects) {
    mockSelect.mockReturnValueOnce(selectChain(rows));
  }

  const mockExecute = vi.fn();
  for (const rows of executes) {
    mockExecute.mockResolvedValueOnce({ rows });
  }

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

  vi.doMock('../db/index', () => ({
    db: { select: mockSelect, execute: mockExecute, update: mockUpdate },
    users: { id: 'id', isPlatformSuperadmin: 'is_platform_superadmin' },
    tenants: {
      id: 'tenants.id', name: 'tenants.name', slug: 'tenants.slug', plan: 'tenants.plan',
      isActive: 'tenants.is_active', createdAt: 'tenants.created_at', settings: 'tenants.settings',
    },
    plans: {
      id: 'plans.id', name: 'plans.name', price: 'plans.price', currency: 'plans.currency',
      limits: 'plans.limits', featureEntitlements: 'plans.feature_entitlements',
    },
    subscriptions: {
      tenantId: 'subscriptions.tenant_id', planId: 'subscriptions.plan_id', status: 'subscriptions.status',
      renewalDate: 'subscriptions.renewal_date', paymentProvider: 'subscriptions.payment_provider',
      createdAt: 'subscriptions.created_at',
    },
  }));

  return { mockSelect, mockExecute, mockUpdate, updateSet, updateWhere };
}

/** Fresh mocked `../services/tenantFeatures` per call — same "fresh mock per test" convention as mockDb() above. */
function mockTenantFeaturesModule(
  knownPlans: string[] = ['agency_internal', 'wizmatch_internal', 'client_basic', 'reseller_pilot'],
) {
  const getTenantFeatures = vi.fn();
  const setTenantFeatures = vi.fn();
  const setTenantPlan = vi.fn();
  vi.doMock('../services/tenantFeatures', () => ({
    getTenantFeatures: (...args: unknown[]) => getTenantFeatures(...args),
    setTenantFeatures: (...args: unknown[]) => setTenantFeatures(...args),
    setTenantPlan: (...args: unknown[]) => setTenantPlan(...args),
    KNOWN_PLANS: knownPlans,
  }));
  return { getTenantFeatures, setTenantFeatures, setTenantPlan };
}

/** Fresh mocked `../utils/audit` per call — same convention src/__tests__/authResellerTenantSlug.test.ts uses. */
function mockAuditModule() {
  const logAuditEvent = vi.fn();
  vi.doMock('../utils/audit', () => ({
    logAuditEvent: (...args: unknown[]) => logAuditEvent(...args),
  }));
  return { logAuditEvent };
}

describe('GET /api/platform/tenants — list', () => {
  it('returns each tenant enriched with its owner and active user count', async () => {
    mockDbForTenantManagement({
      selects: [
        [
          { id: 'tenant-1', name: 'Acme Marketing Co', slug: 'acme-marketing', plan: 'reseller_pilot', isActive: true, createdAt: new Date('2026-01-01') },
          { id: 'tenant-2', name: 'Growth Escalators', slug: 'growth-escalators', plan: 'agency_internal', isActive: true, createdAt: new Date('2025-01-01') },
        ], // tenants page
        [{ count: 2 }], // total count
      ],
      executes: [
        [{ tenant_id: 'tenant-1', id: 'owner-1', name: 'Jane Doe', email: 'owner@acme.example' }], // owners (tenant-2 has none)
        [{ tenant_id: 'tenant-1', count: 3 }, { tenant_id: 'tenant-2', count: 10 }], // active user counts
      ],
    });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');

    const req = makeReq2({ id: 'admin-1' });
    const res = makeRes();
    await invoke(router, 'get', '/', req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { tenants: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(2);
    expect(body.tenants).toHaveLength(2);
    expect(body.tenants[0]).toMatchObject({
      id: 'tenant-1', name: 'Acme Marketing Co', slug: 'acme-marketing', plan: 'reseller_pilot',
      owner: { id: 'owner-1', name: 'Jane Doe', email: 'owner@acme.example' },
      userCount: 3,
    });
    expect(body.tenants[1]).toMatchObject({ id: 'tenant-2', owner: null, userCount: 10 });
  });

  it('does not run the owner/user-count enrichment queries when the tenant page is empty', async () => {
    const { mockExecute } = mockDbForTenantManagement({ selects: [[], [{ count: 0 }]] });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' });
    const res = makeRes();
    await invoke(router, 'get', '/', req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { tenants: unknown[] }).tenants).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('403s for a non-superadmin caller', async () => {
    mockDbForTenantManagement({ superadmin: false });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'user-1' });
    const res = makeRes();
    await invoke(router, 'get', '/', req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/platform/tenants/:tenantId — detail', () => {
  it('returns tenant + owner + userCount + resolved features + subscription plan limits', async () => {
    const { getTenantFeatures } = mockTenantFeaturesModule();
    getTenantFeatures.mockResolvedValueOnce({ wizmatch: false, seo: false, crmAutomation: true, gstBilling: true, d2c: false });
    mockDbForTenantManagement({
      selects: [
        [{ id: 'tenant-1', name: 'Acme Marketing Co', slug: 'acme-marketing', plan: 'reseller_pilot', isActive: true, createdAt: new Date('2026-01-01') }], // tenant row
        [{ // subscription joined to plans
          subscriptionStatus: 'active', renewalDate: new Date('2026-09-01'), paymentProvider: 'razorpay',
          planName: 'Pro', planPrice: 4999, planCurrency: 'INR', planLimits: { seats: 10 }, planFeatureEntitlements: { wizmatch: false },
        }],
      ],
      executes: [
        [{ tenant_id: 'tenant-1', id: 'owner-1', name: 'Jane Doe', email: 'owner@acme.example' }],
        [{ tenant_id: 'tenant-1', count: 3 }],
      ],
    });
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');

    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' } });
    const res = makeRes();
    await invoke(router, 'get', '/:tenantId', req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { tenant: Record<string, unknown>; owner: unknown; userCount: number; features: unknown; subscriptionPlan: Record<string, unknown> | null };
    expect(body.tenant).toMatchObject({ id: 'tenant-1', name: 'Acme Marketing Co', plan: 'reseller_pilot' });
    expect(body.owner).toEqual({ id: 'owner-1', name: 'Jane Doe', email: 'owner@acme.example' });
    expect(body.userCount).toBe(3);
    expect(body.features).toEqual({ wizmatch: false, seo: false, crmAutomation: true, gstBilling: true, d2c: false });
    expect(body.subscriptionPlan).toMatchObject({ planName: 'Pro', planPrice: 4999 });
    expect(getTenantFeatures).toHaveBeenCalledWith('tenant-1');
  });

  it('returns subscriptionPlan: null and owner: null when the tenant has no subscription/owner (the common case today)', async () => {
    const { getTenantFeatures } = mockTenantFeaturesModule();
    getTenantFeatures.mockResolvedValueOnce({ wizmatch: false, seo: true, crmAutomation: true, gstBilling: true, d2c: true });
    mockDbForTenantManagement({
      selects: [
        [{ id: 'tenant-2', name: 'Growth Escalators', slug: 'growth-escalators', plan: 'agency_internal', isActive: true, createdAt: new Date('2025-01-01') }],
        [], // no subscription row
      ],
      executes: [[], []], // no owner, no counted users
    });
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');

    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-2' } });
    const res = makeRes();
    await invoke(router, 'get', '/:tenantId', req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { owner: unknown; userCount: number; subscriptionPlan: unknown };
    expect(body.owner).toBeNull();
    expect(body.userCount).toBe(0);
    expect(body.subscriptionPlan).toBeNull();
  });

  it('404s when the tenant does not exist', async () => {
    mockDbForTenantManagement({ selects: [[]] });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'missing-tenant' } });
    const res = makeRes();
    await invoke(router, 'get', '/:tenantId', req, res);
    expect(res.statusCode).toBe(404);
  });

  it('403s for a non-superadmin caller', async () => {
    mockDbForTenantManagement({ superadmin: false });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'user-1' }, { params: { tenantId: 'tenant-1' } });
    const res = makeRes();
    await invoke(router, 'get', '/:tenantId', req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /api/platform/tenants/:tenantId/status — suspend/reactivate', () => {
  it('400s when isActive is not a boolean, without touching tenants.isActive', async () => {
    const { mockUpdate } = mockDbForTenantManagement({});
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { isActive: 'yes' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/status', req, res);
    expect(res.statusCode).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the tenant does not exist', async () => {
    mockDbForTenantManagement({ selects: [[]] });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'missing-tenant' }, body: { isActive: false } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/status', req, res);
    expect(res.statusCode).toBe(404);
  });

  it('suspends an active tenant, writes tenants.isActive=false, and audits it', async () => {
    const { logAuditEvent } = mockAuditModule();
    const { updateSet } = mockDbForTenantManagement({
      selects: [[{ id: 'tenant-1', name: 'Acme Marketing Co', isActive: true }]],
    });
    mockTenantFeaturesModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { isActive: false } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/status', req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { tenant: Record<string, unknown> }).tenant).toEqual({ id: 'tenant-1', name: 'Acme Marketing Co', isActive: false });
    expect(updateSet).toHaveBeenCalledWith({ isActive: false });
    expect(logAuditEvent).toHaveBeenCalledWith(
      'admin-1', 'tenant-1', 'platform_superadmin.tenant_suspended', 'tenant', 'tenant-1',
      expect.objectContaining({ tenantName: 'Acme Marketing Co', previousIsActive: true, nextIsActive: false }),
      req,
    );
  });

  it('reactivates a suspended tenant, writes tenants.isActive=true, and audits it under a different action name', async () => {
    const { logAuditEvent } = mockAuditModule();
    const { updateSet } = mockDbForTenantManagement({
      selects: [[{ id: 'tenant-1', name: 'Acme Marketing Co', isActive: false }]],
    });
    mockTenantFeaturesModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { isActive: true } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/status', req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { tenant: { isActive: boolean } }).tenant.isActive).toBe(true);
    expect(updateSet).toHaveBeenCalledWith({ isActive: true });
    expect(logAuditEvent).toHaveBeenCalledWith(
      'admin-1', 'tenant-1', 'platform_superadmin.tenant_reactivated', 'tenant', 'tenant-1',
      expect.any(Object), req,
    );
  });

  it('403s for a non-superadmin caller and never writes tenants.isActive', async () => {
    const { mockUpdate } = mockDbForTenantManagement({ superadmin: false });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'user-1' }, { params: { tenantId: 'tenant-1' }, body: { isActive: false } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/status', req, res);
    expect(res.statusCode).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/platform/tenants/:tenantId/features', () => {
  it('400s when no recognised feature key is provided', async () => {
    mockDbForTenantManagement({});
    const { setTenantFeatures } = mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { notAFeature: true } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/features', req, res);
    expect(res.statusCode).toBe(400);
    expect(setTenantFeatures).not.toHaveBeenCalled();
  });

  it('400s when a feature value is not a boolean', async () => {
    mockDbForTenantManagement({});
    const { setTenantFeatures } = mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { wizmatch: 'true' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/features', req, res);
    expect(res.statusCode).toBe(400);
    expect(setTenantFeatures).not.toHaveBeenCalled();
  });

  it('404s when the tenant does not exist', async () => {
    mockDbForTenantManagement({ selects: [[]] });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'missing-tenant' }, body: { wizmatch: true } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/features', req, res);
    expect(res.statusCode).toBe(404);
  });

  it('calls through to setTenantFeatures() with exactly the recognised flags (ignoring unknown body keys), then returns the resolved features', async () => {
    mockDbForTenantManagement({ selects: [[{ id: 'tenant-1' }]] });
    const { setTenantFeatures, getTenantFeatures } = mockTenantFeaturesModule();
    setTenantFeatures.mockResolvedValueOnce(undefined);
    getTenantFeatures.mockResolvedValueOnce({ wizmatch: true, seo: false, crmAutomation: true, gstBilling: true, d2c: false });
    const { logAuditEvent } = mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { wizmatch: true, extraJunkKey: 'ignored' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/features', req, res);

    expect(res.statusCode).toBe(200);
    expect(setTenantFeatures).toHaveBeenCalledWith('tenant-1', { wizmatch: true });
    expect((res.body as { features: unknown }).features).toEqual({ wizmatch: true, seo: false, crmAutomation: true, gstBilling: true, d2c: false });
    expect(logAuditEvent).toHaveBeenCalledWith(
      'admin-1', 'tenant-1', 'platform_superadmin.tenant_features_changed', 'tenant', 'tenant-1',
      { patch: { wizmatch: true } }, req,
    );
  });

  it('403s for a non-superadmin caller and never calls setTenantFeatures', async () => {
    mockDbForTenantManagement({ superadmin: false });
    const { setTenantFeatures } = mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'user-1' }, { params: { tenantId: 'tenant-1' }, body: { wizmatch: true } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/features', req, res);
    expect(res.statusCode).toBe(403);
    expect(setTenantFeatures).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/platform/tenants/:tenantId/plan', () => {
  it('400s when plan is missing', async () => {
    mockDbForTenantManagement({});
    const { setTenantPlan } = mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: {} });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/plan', req, res);
    expect(res.statusCode).toBe(400);
    expect(setTenantPlan).not.toHaveBeenCalled();
  });

  it('400s on an unknown plan name, surfacing the known-plans list', async () => {
    mockDbForTenantManagement({});
    const { setTenantPlan } = mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { plan: 'made_up_plan' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/plan', req, res);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/unknown plan/);
    expect(setTenantPlan).not.toHaveBeenCalled();
  });

  it('404s when the tenant does not exist', async () => {
    mockDbForTenantManagement({ selects: [[]] });
    mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'missing-tenant' }, body: { plan: 'client_basic' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/plan', req, res);
    expect(res.statusCode).toBe(404);
  });

  it('calls through to setTenantPlan() and returns the reset feature set, auditing the previous/next plan', async () => {
    mockDbForTenantManagement({ selects: [[{ id: 'tenant-1', plan: 'reseller_pilot' }]] });
    const { setTenantPlan, getTenantFeatures } = mockTenantFeaturesModule();
    setTenantPlan.mockResolvedValueOnce(undefined);
    getTenantFeatures.mockResolvedValueOnce({ wizmatch: false, seo: false, crmAutomation: false, gstBilling: false, d2c: false });
    const { logAuditEvent } = mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'admin-1' }, { params: { tenantId: 'tenant-1' }, body: { plan: 'client_basic' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/plan', req, res);

    expect(res.statusCode).toBe(200);
    expect(setTenantPlan).toHaveBeenCalledWith('tenant-1', 'client_basic');
    const body = res.body as { plan: string; features: unknown };
    expect(body.plan).toBe('client_basic');
    expect(body.features).toEqual({ wizmatch: false, seo: false, crmAutomation: false, gstBilling: false, d2c: false });
    expect(logAuditEvent).toHaveBeenCalledWith(
      'admin-1', 'tenant-1', 'platform_superadmin.tenant_plan_changed', 'tenant', 'tenant-1',
      { previousPlan: 'reseller_pilot', nextPlan: 'client_basic' }, req,
    );
  });

  it('403s for a non-superadmin caller and never calls setTenantPlan', async () => {
    mockDbForTenantManagement({ superadmin: false });
    const { setTenantPlan } = mockTenantFeaturesModule();
    mockAuditModule();
    const { default: router } = await import('../routes/platformTenants');
    const req = makeReq2({ id: 'user-1' }, { params: { tenantId: 'tenant-1' }, body: { plan: 'client_basic' } });
    const res = makeRes();
    await invoke(router, 'patch', '/:tenantId/plan', req, res);
    expect(res.statusCode).toBe(403);
    expect(setTenantPlan).not.toHaveBeenCalled();
  });
});
