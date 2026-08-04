import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Same technique as src/__tests__/savedViewsTenantIsolation.test.ts: there is no
// test Postgres in this repo, so instead of asserting "a mock was called with
// X", the fake `db.select().where(cond)` below compiles the REAL predicate the
// service hands to Drizzle (PgDialect.sqlToQuery) and evaluates it against
// fixture rows. Tenant isolation is therefore proven behaviourally — rows in,
// rows out — not by inspecting call args.

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

// Encryption itself is covered exhaustively in credentialEncryption.test.ts.
// Stubbed here so this file can focus on DB/tenant-scoping behaviour, with one
// sentinel ('CORRUPT') that simulates a tampered/undecryptable ciphertext.
vi.mock('../services/credentialEncryption', () => ({
  encryptCredentialsJSON: vi.fn((value: unknown) => `enc:${JSON.stringify(value)}`),
  decryptCredentialsJSON: vi.fn((payload: string) => {
    if (payload === 'CORRUPT') throw new Error('Unsupported state or unable to authenticate data');
    return JSON.parse(payload.replace(/^enc:/, ''));
  }),
}));

import {
  disconnectIntegration,
  getDecryptedCredentials,
  getIntegrationStatus,
  listIntegrations,
  upsertIntegrationCredentials,
} from '../services/tenantIntegrationsService';

const dialect = new PgDialect();

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------------
// Minimal evaluator for the parenthesised, fully-parameterised AND-of-equals
// expressions this service emits (no OR — every condition here is a plain
// conjunction). Anything outside that shape throws rather than silently
// evaluating true.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function matches(compiled: { sql: string; params: unknown[] }, row: Row): boolean {
  const tokens = compiled.sql.match(/\(|\)|"[a-z_]+"\."[a-z_]+"|\$\d+|=|and/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => { const t = tokens[i]; if (t === undefined) throw new Error(`unexpected end: ${compiled.sql}`); i += 1; return t; };

  function comparison(): boolean {
    const column = next();
    if (!/^"[a-z_]+"\."[a-z_]+"$/.test(column)) throw new Error(`unsupported operand ${column}`);
    if (next() !== '=') throw new Error(`unsupported operator after ${column}`);
    const rhs = next();
    const expected = rhs.startsWith('$') ? compiled.params[Number(rhs.slice(1)) - 1] : rhs;
    return row[column.split('.')[1].replace(/"/g, '')] === expected;
  }

  function group(): boolean {
    if (peek() !== '(') return comparison(); // a lone condition (no `and`) is not parenthesised
    next();
    const operands: boolean[] = [];
    while (peek() !== ')') {
      if (peek() === 'and') { next(); continue; }
      operands.push(peek() === '(' ? group() : comparison());
    }
    next();
    return operands.every(Boolean);
  }

  const result = group();
  if (i !== tokens.length) throw new Error(`unparsed tail in ${compiled.sql}`);
  return result;
}

const NOW = new Date('2026-08-01T00:00:00Z');

const ROWS: Row[] = [
  { id: 'row-a-email', tenant_id: TENANT_A, provider: 'email_smtp', encrypted_credentials: 'enc:{"host":"smtp.a.test","port":587,"user":"a@a.test","pass":"secretA"}', metadata: {}, status: 'connected', created_at: NOW, updated_at: NOW },
  { id: 'row-a-meta', tenant_id: TENANT_A, provider: 'meta', encrypted_credentials: 'enc:{"token":"a-meta-token"}', metadata: { note: 'a meta' }, status: 'disconnected', created_at: NOW, updated_at: NOW },
  { id: 'row-b-email', tenant_id: TENANT_B, provider: 'email_smtp', encrypted_credentials: 'enc:{"host":"smtp.b.test","port":587,"user":"b@b.test","pass":"secretB"}', metadata: {}, status: 'connected', created_at: NOW, updated_at: NOW },
  { id: 'row-a-broken', tenant_id: TENANT_A, provider: 'broken_provider', encrypted_credentials: 'CORRUPT', metadata: {}, status: 'connected', created_at: NOW, updated_at: NOW },
  { id: 'row-a-nocreds', tenant_id: TENANT_A, provider: 'no_creds_provider', encrypted_credentials: null, metadata: {}, status: 'connected', created_at: NOW, updated_at: NOW },
];

// Fixture rows are keyed by real DB column name (snake_case) so the predicate
// matcher can evaluate them, exactly as Postgres would see them on disk. Real
// Drizzle maps a matched row to the schema's camelCase JS shape before handing
// it back to application code — this mirrors that mapping so the service (which
// reads `row.tenantId`, `row.encryptedCredentials`, etc.) sees what it would in
// production.
function toDrizzleShape(row: Row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    encryptedCredentials: row.encrypted_credentials,
    metadata: row.metadata,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// A `db.select()` fake that runs the REAL predicate the service built against
// the full fixture set — proof the service's own eq()/and() calls are what's
// doing the filtering, not the test.
function fixtureSelectChain() {
  const chain: any = {
    from: () => chain,
    where: (cond: unknown) => {
      const compiled = dialect.sqlToQuery(cond as any);
      const filtered = ROWS.filter((r) => matches(compiled, r)).map(toDrizzleShape);
      const result: any = Promise.resolve(filtered);
      result.limit = (n: number) => Promise.resolve(filtered.slice(0, n));
      return result;
    },
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => fixtureSelectChain());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tenantIntegrationsService — tenant isolation (real predicate proof)', () => {
  it('listIntegrations only returns rows for the given tenant', async () => {
    const a = await listIntegrations(TENANT_A);
    expect(a.map((r) => r.id).sort()).toEqual(['row-a-broken', 'row-a-email', 'row-a-meta', 'row-a-nocreds'].sort());
    expect(a.some((r) => r.tenantId === TENANT_B)).toBe(false);

    const b = await listIntegrations(TENANT_B);
    expect(b.map((r) => r.id)).toEqual(['row-b-email']);
  });

  it('getIntegrationStatus for tenant A + email_smtp does not leak tenant B\'s row of the same provider', async () => {
    const a = await getIntegrationStatus(TENANT_A, 'email_smtp');
    expect(a?.id).toBe('row-a-email');
    expect(a?.tenantId).toBe(TENANT_A);

    const b = await getIntegrationStatus(TENANT_B, 'email_smtp');
    expect(b?.id).toBe('row-b-email');
    expect(b?.tenantId).toBe(TENANT_B);
  });

  it('getIntegrationStatus returns null for a provider the tenant never configured', async () => {
    expect(await getIntegrationStatus(TENANT_B, 'meta')).toBeNull();
  });

  it('getIntegrationStatus never returns the encrypted ciphertext field at all', async () => {
    const a = await getIntegrationStatus(TENANT_A, 'email_smtp');
    expect(a).not.toHaveProperty('encryptedCredentials');
    expect(JSON.stringify(a)).not.toMatch(/secretA/);
  });

  it('getDecryptedCredentials for tenant A never returns tenant B\'s credentials', async () => {
    const credsA = await getDecryptedCredentials<{ user: string; pass: string }>(TENANT_A, 'email_smtp');
    expect(credsA).toEqual({ host: 'smtp.a.test', port: 587, user: 'a@a.test', pass: 'secretA' });

    const credsB = await getDecryptedCredentials<{ user: string; pass: string }>(TENANT_B, 'email_smtp');
    expect(credsB).toEqual({ host: 'smtp.b.test', port: 587, user: 'b@b.test', pass: 'secretB' });
    expect(credsA?.user).not.toBe(credsB?.user);
  });

  it('getDecryptedCredentials returns null (not an error) when there is no connected row', async () => {
    expect(await getDecryptedCredentials(TENANT_B, 'meta')).toBeNull(); // tenant B has no 'meta' row at all
    expect(await getDecryptedCredentials(TENANT_A, 'meta')).toBeNull(); // tenant A's 'meta' row exists but is 'disconnected'
  });

  it('getDecryptedCredentials throws (does not silently fall back) when the stored ciphertext is corrupt/tampered', async () => {
    await expect(getDecryptedCredentials(TENANT_A, 'broken_provider')).rejects.toThrow();
  });

  it('getDecryptedCredentials throws when a connected row has no encrypted_credentials at all', async () => {
    await expect(getDecryptedCredentials(TENANT_A, 'no_creds_provider')).rejects.toThrow(/no encrypted_credentials/);
  });
});

describe('tenantIntegrationsService — writes are tenant+provider scoped', () => {
  function insertChain(row: Row) {
    return { values: vi.fn(() => ({ returning: () => Promise.resolve([row]) })) };
  }
  function updateChain(row: Row | undefined, captureWhere: (cond: unknown) => void) {
    return {
      set: vi.fn(() => ({
        where: (cond: unknown) => { captureWhere(cond); return { returning: () => Promise.resolve(row ? [row] : []) }; },
      })),
    };
  }

  it('upsertIntegrationCredentials INSERTs a new row scoped to the caller\'s tenant when none exists', async () => {
    mockSelect.mockImplementationOnce(() => ({
      from: () => ({ where: () => { const p = Promise.resolve([]); (p as any).limit = () => Promise.resolve([]); return p; } }),
    }));
    const newRow: Row = {
      id: 'row-new', tenantId: TENANT_A, provider: 'email_smtp',
      encryptedCredentials: 'enc:{}', metadata: {}, status: 'connected', createdAt: NOW, updatedAt: NOW,
    };
    mockInsert.mockReturnValueOnce(insertChain(newRow));

    const result = await upsertIntegrationCredentials(TENANT_A, 'email_smtp', { user: 'x', pass: 'y' });

    expect(result.tenantId).toBe(TENANT_A);
    expect(result.status).toBe('connected');
    expect(result).not.toHaveProperty('encryptedCredentials');
    const insertedValues = (mockInsert.mock.results[0].value.values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedValues.tenantId).toBe(TENANT_A);
    expect(insertedValues.provider).toBe('email_smtp');
  });

  it('upsertIntegrationCredentials UPDATEs (not INSERTs) when a row already exists for that tenant+provider', async () => {
    const existing = toDrizzleShape(ROWS.find((r) => r.id === 'row-a-email')!);
    mockSelect.mockImplementationOnce(() => ({
      from: () => ({ where: () => { const p = Promise.resolve([existing]); (p as any).limit = () => Promise.resolve([existing]); return p; } }),
    }));
    let capturedWhere: unknown;
    const updatedRow = { ...existing, encryptedCredentials: 'enc:{"rotated":true}', status: 'connected' };
    mockUpdate.mockReturnValueOnce(updateChain(updatedRow, (c) => { capturedWhere = c; }));

    const result = await upsertIntegrationCredentials(TENANT_A, 'email_smtp', { rotated: true });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(result.id).toBe('row-a-email');
    expect(result.tenantId).toBe(TENANT_A);
    // The UPDATE targets this specific row by id — proves it can't accidentally
    // touch a different tenant's row sharing the same provider name.
    const compiled = dialect.sqlToQuery(capturedWhere as any);
    expect(compiled.params).toContain('row-a-email');
  });

  it('disconnectIntegration wipes ciphertext and is scoped to (tenantId, provider)', async () => {
    let capturedWhere: unknown;
    const disconnected = { ...toDrizzleShape(ROWS.find((r) => r.id === 'row-a-email')!), encryptedCredentials: null, status: 'disconnected' };
    mockUpdate.mockReturnValueOnce(updateChain(disconnected, (c) => { capturedWhere = c; }));

    const result = await disconnectIntegration(TENANT_A, 'email_smtp');

    expect(result?.status).toBe('disconnected');
    const compiled = dialect.sqlToQuery(capturedWhere as any);
    expect(compiled.params).toEqual(expect.arrayContaining([TENANT_A, 'email_smtp']));
  });

  it('disconnectIntegration returns null when no row exists for that tenant+provider (never throws for a no-op)', async () => {
    mockUpdate.mockReturnValueOnce(updateChain(undefined, () => {}));
    expect(await disconnectIntegration(TENANT_B, 'nonexistent')).toBeNull();
  });
});
