import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Invite-by-email service tests (src/services/userInvites.ts) — token
// generation, expiry, single-use enforcement, and resend-invalidates-old.
//
// There is no test Postgres in this repo (see tenantIsolationIDOR.test.ts,
// savedViewsTenantIsolation.test.ts), so this uses a small in-memory fake of
// the `user_invites` table instead of per-call resultChain mocks — the
// behaviour under test (delete-before-insert, hash-lookup, expiry) is
// genuinely stateful across calls, which a fixed canned-response mock can't
// exercise honestly.
const dialect = new PgDialect();

interface FakeRow { userId: string; tenantId: string; tokenHash: string; expiresAt: Date }
let store: FakeRow[] = [];

function compiledParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as Parameters<PgDialect['sqlToQuery']>[0]).params;
}
function compiledSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as Parameters<PgDialect['sqlToQuery']>[0]).sql;
}

// Both predicates this service ever issues are single `eq(column, value)`
// conditions — filter the fake store by whichever column the compiled SQL
// names, using the compiled condition's own bound parameter.
function filterByCondition(rows: FakeRow[], cond: unknown): FakeRow[] {
  const sql = compiledSql(cond);
  const [value] = compiledParams(cond);
  if (sql.includes('user_id')) return rows.filter((r) => r.userId === value);
  if (sql.includes('token_hash')) return rows.filter((r) => r.tokenHash === value);
  return rows;
}

const mockSendTransactionalEmail = vi.fn().mockResolvedValue({ success: true });
const mockGetTenantDocumentIdentity = vi.fn();

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      delete: (_table: unknown) => ({
        where: (cond: unknown) => {
          const before = store.length;
          store = store.filter((r) => !filterByCondition(store, cond).includes(r));
          return Promise.resolve({ rowCount: before - store.length });
        },
      }),
      insert: (_table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          store.push({
            userId: vals.userId as string,
            tenantId: vals.tenantId as string,
            tokenHash: vals.tokenHash as string,
            expiresAt: vals.expiresAt as Date,
          });
          return Promise.resolve();
        },
      }),
      select: (_proj?: unknown) => ({
        from: (_table: unknown) => ({
          where: (cond: unknown) => ({
            limit: (_n: number) => Promise.resolve(filterByCondition(store, cond).slice(0, _n)),
          }),
        }),
      }),
    },
    pool: { query: vi.fn() },
    userInvites: schema.userInvites,
  };
});

vi.mock('../services/emailService', () => ({
  sendTransactionalEmail: (...args: unknown[]) => mockSendTransactionalEmail(...args),
}));

vi.mock('../services/tenantBrandingDefaults', () => ({
  getTenantDocumentIdentity: (...args: unknown[]) => mockGetTenantDocumentIdentity(...args),
}));

import {
  createInviteToken,
  findValidInvite,
  consumeInvite,
  hasPendingInvite,
  hashInviteToken,
  sendInviteEmail,
} from '../services/userInvites';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
  mockSendTransactionalEmail.mockResolvedValue({ success: true });
  store = [];
});

describe('hashInviteToken', () => {
  it('is deterministic — same input always hashes the same', () => {
    expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'));
  });
});

describe('createInviteToken', () => {
  it('mints a unique, non-empty token each call', async () => {
    const t1 = await createInviteToken(USER_A, TENANT_A);
    store = []; // isolate the second mint from the first's delete-before-insert
    const t2 = await createInviteToken(USER_A, TENANT_A);
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(t1).not.toBe(t2);
  });

  it('stores only the HASH of the token, never the raw value', async () => {
    const token = await createInviteToken(USER_A, TENANT_A);
    expect(store).toHaveLength(1);
    expect(store[0].tokenHash).toBe(hashInviteToken(token));
    expect(store[0].tokenHash).not.toBe(token);
  });

  it('sets an expiry in the future (~7 days)', async () => {
    const before = Date.now();
    await createInviteToken(USER_A, TENANT_A);
    const expiresAt = store[0].expiresAt.getTime();
    const days = (expiresAt - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe('findValidInvite / single-use / expiry', () => {
  it('resolves a freshly-minted token to its userId/tenantId', async () => {
    const token = await createInviteToken(USER_A, TENANT_A);
    const found = await findValidInvite(token);
    expect(found).toEqual({ userId: USER_A, tenantId: TENANT_A });
  });

  it('returns null for a token that was never issued', async () => {
    await createInviteToken(USER_A, TENANT_A);
    expect(await findValidInvite('never-issued-token')).toBeNull();
  });

  it('returns null (not throw) for an empty/garbage token', async () => {
    expect(await findValidInvite('')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await findValidInvite(undefined as any)).toBeNull();
  });

  it('returns null once the token has expired', async () => {
    const token = await createInviteToken(USER_A, TENANT_A);
    store[0].expiresAt = new Date(Date.now() - 1000); // force expiry
    expect(await findValidInvite(token)).toBeNull();
  });

  it('consumeInvite deletes the row — the token can never be replayed', async () => {
    const token = await createInviteToken(USER_A, TENANT_A);
    expect(await findValidInvite(token)).not.toBeNull();
    await consumeInvite(USER_A);
    expect(await findValidInvite(token)).toBeNull();
  });

  it('resend (a second createInviteToken) invalidates the OLD token — only the newest works', async () => {
    const oldToken = await createInviteToken(USER_A, TENANT_A);
    const newToken = await createInviteToken(USER_A, TENANT_A); // resend-invite calls this again
    expect(await findValidInvite(oldToken)).toBeNull();
    expect(await findValidInvite(newToken)).toEqual({ userId: USER_A, tenantId: TENANT_A });
  });

  it("one user's invite never resolves for a different user's token", async () => {
    const tokenA = await createInviteToken(USER_A, TENANT_A);
    await createInviteToken(USER_B, TENANT_A);
    const found = await findValidInvite(tokenA);
    expect(found?.userId).toBe(USER_A);
    expect(found?.userId).not.toBe(USER_B);
  });
});

describe('hasPendingInvite', () => {
  it('is false with no outstanding invite', async () => {
    expect(await hasPendingInvite(USER_A)).toBe(false);
  });

  it('is true right after an invite is issued', async () => {
    await createInviteToken(USER_A, TENANT_A);
    expect(await hasPendingInvite(USER_A)).toBe(true);
  });

  it('is false again after the invite is consumed', async () => {
    await createInviteToken(USER_A, TENANT_A);
    await consumeInvite(USER_A);
    expect(await hasPendingInvite(USER_A)).toBe(false);
  });
});

describe('sendInviteEmail — tenant branding', () => {
  it("uses the tenant's own displayName in the subject, never a hardcoded \"Growth Escalators\"", async () => {
    mockGetTenantDocumentIdentity.mockResolvedValue({ displayName: 'Acme Media' });
    const token = await createInviteToken(USER_A, TENANT_A);
    await sendInviteEmail(token, TENANT_A, 'Sneha Joshi', 'sneha@example.com');

    expect(mockSendTransactionalEmail).toHaveBeenCalledTimes(1);
    const [, , subject, html] = mockSendTransactionalEmail.mock.calls[0];
    expect(subject).toContain('Acme Media');
    expect(subject).not.toContain('Growth Escalators');
    expect(html).toContain('Acme Media');
  });

  it('falls back to a neutral "the team" (not "Growth Escalators") when no branding row exists', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValue(null);
    const token = await createInviteToken(USER_A, TENANT_A);
    await sendInviteEmail(token, TENANT_A, 'Sneha Joshi', 'sneha@example.com');

    const [, , subject] = mockSendTransactionalEmail.mock.calls[0];
    expect(subject).not.toContain('Growth Escalators');
    expect(subject).toContain('the team');
  });
});
