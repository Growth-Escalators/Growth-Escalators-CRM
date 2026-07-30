import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret';

const mockDbSelect = vi.fn();
vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
  users: { id: 'id', tokenVersion: 'token_version', tenantId: 'tenant_id' },
}));

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res as unknown as import('express').Response & { statusCode: number; body: unknown };
}

function makeReq(header?: string) {
  return { headers: { authorization: header }, method: 'GET' } as unknown as import('express').Request;
}

function signToken(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    { id: 'user-1', email: 'a@b.com', tenantId: 'tenant-1', role: 'admin', tokenVersion: 3, ...overrides },
    TEST_SECRET,
  );
}

// The identity row `currentIdentity` (formerly `currentTokenVersion`) reads.
// `tenantId` defaults to the value `signToken` puts in the JWT so every
// pre-existing test keeps exercising the matching-tenant happy path; the H-1
// tenant-binding tests below pass a differing value explicitly.
function mockTokenVersionRow(tokenVersion: number | null, tenantId: string | null = 'tenant-1') {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(tokenVersion === null ? [] : [{ tokenVersion, tenantId }]),
      }),
    }),
  });
}

describe('requireAuth / verifyAuthToken / requireStrictAuth', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('requireStrictAuth is the same function as requireAuth (DB tokenVersion check now lives in requireAuth itself)', async () => {
    const { requireAuth, requireStrictAuth } = await import('../middleware/auth');
    expect(requireStrictAuth).toBe(requireAuth);
  });

  describe('requireAuth', () => {
    it('rejects with 401 when the Authorization header is missing', async () => {
      const { requireAuth } = await import('../middleware/auth');
      const req = makeReq(undefined);
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects with 401 for a malformed/invalid token', async () => {
      const { requireAuth } = await import('../middleware/auth');
      const req = makeReq('Bearer not-a-real-token');
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects with 401 when required claims are missing from an otherwise-valid token', async () => {
      const { requireAuth } = await import('../middleware/auth');
      const token = jwt.sign({ id: 'user-1' }, TEST_SECRET); // missing role/tenantId/tokenVersion
      const req = makeReq(`Bearer ${token}`);
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes through when the DB tokenVersion matches the JWT claim (this is the H2 fix — was previously claims-only)', async () => {
      mockTokenVersionRow(3);
      const { requireAuth } = await import('../middleware/auth');
      const req = makeReq(`Bearer ${signToken({ tokenVersion: 3 })}`);
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user?.id).toBe('user-1');
    });

    it('rejects with 401 when the DB tokenVersion no longer matches the JWT claim (revoked session)', async () => {
      // Simulates a password reset / force-logout that bumped users.tokenVersion
      // to 4 after this token (tokenVersion=3) was issued.
      mockTokenVersionRow(4);
      const { requireAuth } = await import('../middleware/auth');
      const req = makeReq(`Bearer ${signToken({ tokenVersion: 3 })}`);
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the user no longer exists in the DB', async () => {
      mockTokenVersionRow(null);
      const { requireAuth } = await import('../middleware/auth');
      const req = makeReq(`Bearer ${signToken()}`);
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('fails closed (401) when the tokenVersion DB lookup throws', async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('connection reset')),
          }),
        }),
      });
      const { requireAuth } = await import('../middleware/auth');
      const req = makeReq(`Bearer ${signToken()}`);
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('blocks the viewer role from non-GET methods (read-only invariant, unaffected by the tokenVersion change)', async () => {
      mockTokenVersionRow(3);
      const { requireAuth } = await import('../middleware/auth');
      const req = { headers: { authorization: `Bearer ${signToken({ role: 'viewer', tokenVersion: 3 })}` }, method: 'POST' } as unknown as import('express').Request;
      const res = makeRes();
      const next = vi.fn();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('verifyAuthToken', () => {
    it('returns the payload for a valid, complete token', async () => {
      const { verifyAuthToken } = await import('../middleware/auth');
      const payload = verifyAuthToken(signToken());
      expect(payload?.id).toBe('user-1');
      expect(payload?.tenantId).toBe('tenant-1');
    });

    it('returns null for a token signed with the wrong secret', async () => {
      const { verifyAuthToken } = await import('../middleware/auth');
      const badToken = jwt.sign({ id: 'x', role: 'admin', tenantId: 't', tokenVersion: 1 }, 'wrong-secret');
      expect(verifyAuthToken(badToken)).toBeNull();
    });

    it('returns null for a token missing required claims', async () => {
      const { verifyAuthToken } = await import('../middleware/auth');
      const incomplete = jwt.sign({ id: 'user-1' }, TEST_SECRET);
      expect(verifyAuthToken(incomplete)).toBeNull();
    });

    it('returns null when JWT_SECRET is unset', async () => {
      delete process.env.JWT_SECRET;
      const { verifyAuthToken } = await import('../middleware/auth');
      expect(verifyAuthToken(signToken())).toBeNull();
    });
  });
});

describe('optionalAuth — revocation parity with requireAuth (2026-07-30)', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('populates req.user when the token tokenVersion MATCHES the DB', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3);
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3 })}`);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user?: { id: string } }).user?.id).toBe('user-1');
    expect(next).toHaveBeenCalled();
  });

  // THE REGRESSION GUARD. Before this fix optionalAuth never consulted the DB,
  // so a revoked session kept authenticating here until natural JWT expiry.
  it('does NOT populate req.user when the DB tokenVersion has been bumped (revoked session)', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockTokenVersionRow(9); // token carries 3, DB now says 9 => revoked
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3 })}`);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    // Degrades to anonymous, does NOT 401 — optional auth must stay reachable.
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('does NOT populate req.user when the user row is gone (lookup returns null)', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockTokenVersionRow(null);
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3 })}`);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('degrades to anonymous (fail closed) when the tokenVersion lookup throws', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockDbSelect.mockImplementation(() => { throw new Error('db down'); });
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3 })}`);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('allows an unauthenticated request through with no req.user', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('still enforces the viewer read-only guard for a non-GET with a VALID token', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3);
    const req = { headers: { authorization: `Bearer ${signToken({ tokenVersion: 3, role: 'viewer' })}` }, method: 'POST' } as unknown as import('express').Request;
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// QA run 2026-07-30 — regression guard for failure-matrix finding H-1
// ("cross-tenant read via unverified `tenantId` claim").
//
// The defect: `requireAuth` validated the JWT signature and the DB
// `token_version`, but NEVER compared the token's `tenantId` claim against the
// user's actual `users.tenant_id`. Route handlers then scope their queries by
// `req.user.tenantId` — a value taken verbatim from the token. Anyone able to
// mint a token (the practical bar being Railway project read access, since
// `list_variables` returns `JWT_SECRET` in plaintext — finding M-11, NOT a
// full secret compromise) could re-sign their own otherwise-valid claims with a
// different `tenantId` and read another tenant's rows with HTTP 200.
//
// `token_version` did not contain this: it is keyed on `users.id`, so the
// attacker's OWN id and OWN current token_version are used, and both match.
// The tenant is the only tampered claim, and nothing checked it.
//
// This matters more than usual here: both pilot operators hold accounts in TWO
// tenants, so correct tenant binding is load-bearing rather than theoretical.
describe('requireAuth — tenant binding (H-1)', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('rejects a validly-signed token whose tenantId does not match the user row', async () => {
    const { requireAuth } = await import('../middleware/auth');
    // token_version MATCHES (3 === 3) — only the tenant is forged, which is
    // exactly the attack the token_version check cannot see.
    mockTokenVersionRow(3, 'tenant-1');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-VICTIM' })}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
  });

  it('does not leak which tenant the user really belongs to in the error body', async () => {
    const { requireAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3, 'tenant-1');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-VICTIM' })}`);
    const res = makeRes();
    await requireAuth(req, res, vi.fn());
    expect(JSON.stringify(res.body)).not.toContain('tenant-1');
  });

  it('admits a token whose tenantId matches the user row (happy path unchanged)', async () => {
    const { requireAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3, 'tenant-1');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-1' })}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect((req as unknown as { user: { tenantId: string } }).user.tenantId).toBe('tenant-1');
  });

  it('fails closed (401) when the user row carries a NULL tenant_id', async () => {
    const { requireAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3, null);
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-1' })}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  // The tenant must be re-checked on a CACHE HIT too, not only on the cold
  // lookup — otherwise the binding is bypassable by simply issuing a legitimate
  // request first to warm the cache, then a forged one within the 30s TTL.
  it('still rejects a forged tenant on a warm cache hit (second request, no new DB read)', async () => {
    const { requireAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3, 'tenant-1');

    // Request 1 — legitimate, warms the cache for user-1.
    const good = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-1' })}`);
    const goodNext = vi.fn();
    await requireAuth(good, makeRes(), goodNext);
    expect(goodNext).toHaveBeenCalled();
    const callsAfterFirst = mockDbSelect.mock.calls.length;

    // Request 2 — same user, forged tenant, inside the TTL.
    const forged = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-VICTIM' })}`);
    const forgedRes = makeRes();
    const forgedNext = vi.fn();
    await requireAuth(forged, forgedRes, forgedNext);
    expect(forgedRes.statusCode).toBe(401);
    expect(forgedNext).not.toHaveBeenCalled();
    // Proves it was served from cache — the binding is not relying on a re-read.
    expect(mockDbSelect.mock.calls.length).toBe(callsAfterFirst);
  });
});

// optionalAuth must not become the soft underbelly of the H-1 fix: it shares
// the same identity cache, so a forged tenant must fail to populate req.user
// there too (degrading to anonymous, matching that route's public-by-secret
// contract rather than 401ing).
describe('optionalAuth — tenant binding (H-1)', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('does NOT populate req.user when the tenantId claim does not match the user row', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3, 'tenant-1');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-VICTIM' })}`);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('populates req.user when the tenantId claim matches (happy path unchanged)', async () => {
    const { optionalAuth } = await import('../middleware/auth');
    mockTokenVersionRow(3, 'tenant-1');
    const req = makeReq(`Bearer ${signToken({ tokenVersion: 3, tenantId: 'tenant-1' })}`);
    const res = makeRes();
    const next = vi.fn();
    await optionalAuth(req, res, next);
    expect((req as unknown as { user: { tenantId: string } }).user.tenantId).toBe('tenant-1');
    expect(next).toHaveBeenCalled();
  });
});
