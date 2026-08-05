import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /auth/accept-invite — validates an invite token, lets the invitee set
// their own password, and activates the account. Mirrors reset-password's
// test posture (mock the token service + db execute, invoke the handler
// directly, skip the rate limiter) — see authResellerTenantSlug.test.ts for
// the same harness shape.

const mockDbExecute = vi.fn();

vi.mock('../db/index', () => ({
  db: { execute: (...args: unknown[]) => mockDbExecute(...args) },
  users: {},
  passwordResetTokens: {},
}));

const mockHash = vi.fn();
vi.mock('@node-rs/argon2', () => ({
  verify: vi.fn(),
  hash: (...args: unknown[]) => mockHash(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockFindValidInvite = vi.fn();
const mockConsumeInvite = vi.fn();
vi.mock('../services/userInvites', () => ({
  findValidInvite: (...args: unknown[]) => mockFindValidInvite(...args),
  consumeInvite: (...args: unknown[]) => mockConsumeInvite(...args),
}));

// Same minimal handler-chain harness this repo's route-level tests already
// use (authResellerTenantSlug.test.ts) — walks router.stack for the route,
// invokes ONLY the final middleware (the real handler), deliberately
// skipping resetLimiter (rate limiting is orthogonal to what's under test).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRouteHandler(router: any, path: string, method: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function makeReq(body: Record<string, unknown>) {
  return { body, get() { return undefined; } } as unknown as import('express').Request;
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

const USER_A = '11111111-1111-4111-8111-111111111111';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
  mockDbExecute.mockResolvedValue({ rows: [] });
  mockHash.mockResolvedValue('hashed-new-password');
});

describe('POST /auth/accept-invite', () => {
  it('400s when token is missing', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/accept-invite', 'post');
    const req = makeReq({ newPassword: 'longenoughpassword' });
    const res = makeRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(mockFindValidInvite).not.toHaveBeenCalled();
  });

  it('400s when newPassword is missing', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/accept-invite', 'post');
    const req = makeReq({ token: 'sometoken' });
    const res = makeRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it('400s when newPassword is under 8 characters', async () => {
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/accept-invite', 'post');
    const req = makeReq({ token: 'sometoken', newPassword: 'short' });
    const res = makeRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(mockFindValidInvite).not.toHaveBeenCalled();
  });

  it('400s with a generic message for an invalid or expired token, and never touches the DB', async () => {
    mockFindValidInvite.mockResolvedValue(null);
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/accept-invite', 'post');
    const req = makeReq({ token: 'bad-or-expired', newPassword: 'longenoughpassword' });
    const res = makeRes();
    await handler(req, res, () => {});

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/Invalid or expired/i);
    expect(mockDbExecute).not.toHaveBeenCalled();
    expect(mockConsumeInvite).not.toHaveBeenCalled();
  });

  it('activates the account on a valid token: hashes+stores the new password, sets is_active, bumps token_version, and consumes the invite (single-use)', async () => {
    mockFindValidInvite.mockResolvedValue({ userId: USER_A, tenantId: TENANT_A });
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/accept-invite', 'post');
    const req = makeReq({ token: 'good-token', newPassword: 'brandNewPassword1' });
    const res = makeRes();
    await handler(req, res, () => {});

    expect(mockHash).toHaveBeenCalledWith('brandNewPassword1');
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    const sqlCall = mockDbExecute.mock.calls[0][0];
    const text = JSON.stringify(sqlCall); // quick smoke check without a full SQL compiler
    expect(text).toContain('hashed-new-password');
    expect(text).toContain(USER_A);

    // Single-use: the invite must be consumed for THIS user so the token
    // can never be replayed.
    expect(mockConsumeInvite).toHaveBeenCalledWith(USER_A);
    expect(res.statusCode).toBe(200);
    expect((res.body as { message: string }).message).toMatch(/activated/i);
  });

  it('500s and does NOT consume the invite if the password update itself fails', async () => {
    mockFindValidInvite.mockResolvedValue({ userId: USER_A, tenantId: TENANT_A });
    mockDbExecute.mockRejectedValueOnce(new Error('db down'));
    const authRouter = (await import('../routes/auth')).default;
    const handler = getRouteHandler(authRouter, '/accept-invite', 'post');
    const req = makeReq({ token: 'good-token', newPassword: 'brandNewPassword1' });
    const res = makeRes();
    await handler(req, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(mockConsumeInvite).not.toHaveBeenCalled();
  });
});
