import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Reseller readiness (2026-08) — regression guard.
//
// The defect: `normaliseTenantSlug()` in src/routes/auth.ts folded ANY slug
// that wasn't one of the two hardcoded GE/Wizmatch aliases down to
// 'growth-escalators'. A freshly provisioned reseller tenant (e.g.
// scripts/onboarding/provisionResellerTenant.ts with slug 'acme-media') could
// never log in: `/auth/login` silently rewrote its own tenantSlug to
// 'growth-escalators' before running `... AND t.slug = ${tenantSlug}`, so the
// query looked the user up under GE's tenant and always 401'd — same bug hit
// /auth/forgot-password and /auth/reset-password.
//
// The fix keeps the GE/Wizmatch alias folding byte-for-byte identical and
// passes any other non-empty slug through unchanged. The login/forgot/reset
// queries already INNER JOIN tenants ON t.slug = tenantSlug AND
// t.is_active = true, so an unknown slug simply matches zero rows — that IS
// the tenant-existence check, with no separate lookup and no oracle for
// probing which slugs exist (nonexistent-tenant and bad-password both 401
// identically; forgot-password stays non-committal either way).
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-jwt-secret-auth-reseller-tenant-slug';

const mockDbExecute = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
  users: {},
  passwordResetTokens: {},
}));

const mockVerify = vi.fn();
const mockHash = vi.fn();
vi.mock('@node-rs/argon2', () => ({
  verify: (...args: unknown[]) => mockVerify(...args),
  hash: (...args: unknown[]) => mockHash(...args),
}));

const mockLogAuditEvent = vi.fn();
vi.mock('../utils/audit', () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Same minimal handler-chain harness used across this repo's route-level
// tests (see src/__tests__/healthRouteStatusCode.test.ts) — walks
// router.stack to find the route, but here invokes ONLY the final middleware
// (the actual async handler), deliberately skipping the loginLimiter /
// resetLimiter rate-limit middleware in front of it. Rate limiting is
// orthogonal to the tenant-slug fix under test, and express-rate-limit's
// default in-memory store persists counters across `it()` blocks in the same
// file, which would 429 later cases in this file for reasons unrelated to
// what they're testing.
function getRouteHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq(opts: { body?: Record<string, unknown>; headers?: Record<string, string>; hostname?: string } = {}) {
  const { body = {}, headers = {}, hostname = 'crm.growthescalators.com' } = opts;
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return {
    body,
    hostname,
    get(name: string) { return lowerHeaders[String(name).toLowerCase()]; },
  } as unknown as import('express').Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res as unknown as import('express').Response & { statusCode: number; body: any };
}

// drizzle-orm's `sql\`...\`` tagged template exposes its interpolated values
// and text segments via the public `queryChunks` array (alternating
// text-chunk objects `{ value: string[] }` and raw bound values). This is the
// same extraction technique src/__tests__/seoTenantIsolation.test.ts,
// billing.test.ts and blockerAlertDedup.test.ts already use to assert on
// what a mocked db.execute call was actually bound with, rather than trusting
// a canned response blindly.
function extractFromDrizzleSql(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  let text = '';
  const params: unknown[] = [];
  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'value' in (chunk as Record<string, unknown>)) {
      text += (chunk as { value: string[] }).value.join('');
    } else {
      params.push(chunk);
    }
  }
  return { text, params };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'user@example.com',
    passwordHash: 'hashed-pw',
    role: 'admin',
    tenantId: 'tenant-1',
    tokenVersion: 1,
    tenantSlug: 'growth-escalators',
    tenantName: 'Growth Escalators',
    ...overrides,
  };
}

describe('POST /auth/login — reseller tenant slugs', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('logs a provisioned reseller-tenant user in via its own slug and issues a JWT scoped to that tenant', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/login', 'post');

    mockDbExecute.mockResolvedValueOnce({
      rows: [userRow({
        id: 'user-acme-1',
        email: 'owner@acmemedia.example',
        tenantId: 'tenant-acme-id',
        tenantSlug: 'acme-media',
        tenantName: 'Acme Media',
      })],
    });
    mockVerify.mockResolvedValue(true);

    const req = makeReq({ body: { email: 'Owner@AcmeMedia.example', password: 'correct-horse-battery', tenantSlug: 'acme-media' } });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();

    const payload = jwt.verify(res.body.token, TEST_SECRET) as Record<string, unknown>;
    expect(payload.tenantId).toBe('tenant-acme-id');
    expect(payload.tenantSlug).toBe('acme-media');

    expect(res.body.user.tenantId).toBe('tenant-acme-id');
    expect(res.body.user.tenantSlug).toBe('acme-media');

    // THE regression guard: the raw reseller slug must reach the query
    // unfolded. Before the fix this would have been silently rewritten to
    // 'growth-escalators' here, and the mocked row above (keyed to
    // acme-media) would never have matched a real database.
    const { params } = extractFromDrizzleSql(mockDbExecute.mock.calls[0][0]);
    expect(params).toContain('acme-media');
    expect(params).not.toContain('growth-escalators');
  });

  it('a nonexistent tenant slug behaves exactly like bad credentials — generic 401, no tenant-existence oracle', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/login', 'post');

    // INNER JOIN tenants ON t.slug = tenantSlug finds no matching active
    // tenant at all -> zero rows, same as any other failed lookup.
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ body: { email: 'user@example.com', password: 'whatever', tenantSlug: 'no-such-tenant' } });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid credentials' });
    // Never even reached the password check — proves the 401 came from the
    // tenant/email join finding nothing, not from a separate rejection path.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('the nonexistent-tenant 401 is identical to the bad-password 401 for a real tenant (no oracle)', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/login', 'post');

    mockDbExecute.mockResolvedValueOnce({ rows: [] });
    const req1 = makeReq({ body: { email: 'user@example.com', password: 'whatever', tenantSlug: 'no-such-tenant' } });
    const res1 = makeRes();
    await handler(req1, res1);

    mockDbExecute.mockResolvedValueOnce({ rows: [userRow()] });
    mockVerify.mockResolvedValueOnce(false);
    const req2 = makeReq({ body: { email: 'user@example.com', password: 'wrong-password', tenantSlug: 'growth-escalators' } });
    const res2 = makeRes();
    await handler(req2, res2);

    expect(res1.statusCode).toBe(res2.statusCode);
    expect(res1.body).toEqual(res2.body);
  });
});

describe('POST /auth/login — GE / Wizmatch aliasing unchanged (regression guard)', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it.each([
    ['growth-escalators', 'growth-escalators'],
    ['growth', 'growth-escalators'],
    ['ge', 'growth-escalators'],
    ['GE', 'growth-escalators'],
    ['wizmatch', 'wizmatch'],
    ['wm', 'wizmatch'],
    ['WizMatch', 'wizmatch'],
  ])('explicit slug %s still resolves to %s in the login query (byte-for-byte alias behavior)', async (input, expected) => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/login', 'post');

    mockDbExecute.mockResolvedValueOnce({ rows: [userRow({ tenantSlug: expected })] });
    mockVerify.mockResolvedValue(true);

    const req = makeReq({ body: { email: 'user@example.com', password: 'pw', tenantSlug: input } });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const { params } = extractFromDrizzleSql(mockDbExecute.mock.calls[0][0]);
    expect(params).toContain(expected);
  });

  it('defaults to growth-escalators when no tenant slug is supplied at all (no body field, no header, non-wizmatch host)', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/login', 'post');

    mockDbExecute.mockResolvedValueOnce({ rows: [userRow()] });
    mockVerify.mockResolvedValue(true);

    const req = makeReq({ body: { email: 'user@example.com', password: 'pw' }, hostname: 'crm.growthescalators.com' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const { params } = extractFromDrizzleSql(mockDbExecute.mock.calls[0][0]);
    expect(params).toContain('growth-escalators');
  });

  it('detects wizmatch from the request hostname when no explicit slug or header is supplied', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/login', 'post');

    mockDbExecute.mockResolvedValueOnce({ rows: [userRow({ tenantSlug: 'wizmatch' })] });
    mockVerify.mockResolvedValue(true);

    const req = makeReq({ body: { email: 'user@example.com', password: 'pw' }, hostname: 'wizmatch.growthescalators.com' });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const { params } = extractFromDrizzleSql(mockDbExecute.mock.calls[0][0]);
    expect(params).toContain('wizmatch');
  });
});

describe('POST /auth/forgot-password — reseller tenant slugs', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalBrevo = process.env.BREVO_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
    delete process.env.BREVO_API_KEY;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    if (originalBrevo === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = originalBrevo;
  });

  it('finds the reseller-tenant user by its own slug and issues a reset code', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/forgot-password', 'post');

    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 'user-acme-1', name: 'Acme Owner', email: 'owner@acmemedia.example' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // DELETE old tokens
    const mockValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: mockValues });

    const req = makeReq({ body: { email: 'owner@acmemedia.example', tenantSlug: 'acme-media' } });
    const res = makeRes();
    await handler(req, res);

    expect(res.body).toEqual({ message: 'If that email is registered, a reset code has been sent.' });

    // Regression guard: the lookup query was actually bound to the reseller
    // slug, not silently rewritten to GE's.
    const { params } = extractFromDrizzleSql(mockDbExecute.mock.calls[0][0]);
    expect(params).toContain('acme-media');
    expect(params).not.toContain('growth-escalators');

    // Proves this took the "user found" branch (a reset token was actually
    // minted), not the silent-miss branch that returns the same message.
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-acme-1' }));
  });

  it('a nonexistent slug returns the same non-committal message without minting a token (no oracle)', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/forgot-password', 'post');

    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const req = makeReq({ body: { email: 'owner@acmemedia.example', tenantSlug: 'no-such-tenant' } });
    const res = makeRes();
    await handler(req, res);

    expect(res.body).toEqual({ message: 'If that email is registered, a reset code has been sent.' });
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
