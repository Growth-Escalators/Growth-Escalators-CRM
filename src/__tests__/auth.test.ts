import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret';

const mockDbSelect = vi.fn();
vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
  users: { id: 'id', tokenVersion: 'token_version' },
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

function mockTokenVersionRow(tokenVersion: number | null) {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(tokenVersion === null ? [] : [{ tokenVersion }]),
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
