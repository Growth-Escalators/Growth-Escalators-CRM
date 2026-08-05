import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// reassignUserRecords (src/services/userReassignment.ts) — the core of the
// reassign-on-offboard tool. contacts/deals.assignedTo are free text with no
// canonical representation (see the module's own doc comment), so this pins
// the actual SQL shape: each table's UPDATE is scoped to tenant_id, matches
// ALL plausible representations of the source user (id/email/name/lowercased
// first name), and is a CASE expression (not a blind overwrite) so a row
// keeps whichever representation it already used.
const mockExecute = vi.fn();

vi.mock('../db/index', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
  pool: { query: vi.fn() },
}));

import { reassignUserRecords, type ReassignableUser } from '../services/userReassignment';

const dialect = new PgDialect();
function compiled(query: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(query as Parameters<PgDialect['sqlToQuery']>[0]);
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FROM: ReassignableUser = { id: 'user-tushar', name: 'Tushar Jangid', email: 'tushar@growthescalators.com' };
const TO: ReassignableUser = { id: 'user-kanishk', name: 'Kanishk Khandelwal', email: 'kanishk.khandelwal@growthescalators.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rowCount: 0 });
});

describe('reassignUserRecords', () => {
  it('issues exactly one UPDATE per table — contacts, deals, tasks', async () => {
    await reassignUserRecords(TENANT_A, FROM, TO);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('scopes every UPDATE to the given tenant_id', async () => {
    await reassignUserRecords(TENANT_A, FROM, TO);
    for (const call of mockExecute.mock.calls) {
      const { sql, params } = compiled(call[0]);
      expect(sql).toMatch(/WHERE\s+tenant_id\s*=/i);
      expect(params).toContain(TENANT_A);
    }
  });

  it('targets contacts, deals, and tasks by name (and no other table)', async () => {
    await reassignUserRecords(TENANT_A, FROM, TO);
    const tableNames = mockExecute.mock.calls.map((call) => compiled(call[0]).sql);
    expect(tableNames.some((s) => /UPDATE\s+"?contacts"?/i.test(s))).toBe(true);
    expect(tableNames.some((s) => /UPDATE\s+"?deals"?/i.test(s))).toBe(true);
    expect(tableNames.some((s) => /UPDATE\s+"?tasks"?/i.test(s))).toBe(true);
  });

  it('matches every plausible representation of the FROM user: id, email, full name, and lowercased first name', async () => {
    await reassignUserRecords(TENANT_A, FROM, TO);
    const { params } = compiled(mockExecute.mock.calls[0][0]);
    expect(params).toEqual(expect.arrayContaining([FROM.id, FROM.email, FROM.name, 'tushar']));
  });

  it('maps to the SAME representation for the TO user (id->id, email->email, name->name, first->first)', async () => {
    await reassignUserRecords(TENANT_A, FROM, TO);
    const { sql, params } = compiled(mockExecute.mock.calls[0][0]);
    expect(sql).toMatch(/CASE/i);
    expect(params).toEqual(expect.arrayContaining([TO.id, TO.email, TO.name, 'kanishk']));
  });

  it('never blindly overwrites — uses a CASE expression with an ELSE that preserves unrelated rows', async () => {
    await reassignUserRecords(TENANT_A, FROM, TO);
    const { sql } = compiled(mockExecute.mock.calls[0][0]);
    expect(sql).toMatch(/ELSE\s+assigned_to/i);
  });

  it('returns the per-table row counts the UPDATEs report', async () => {
    mockExecute
      .mockResolvedValueOnce({ rowCount: 2 }) // contacts
      .mockResolvedValueOnce({ rowCount: 1 }) // deals
      .mockResolvedValueOnce({ rowCount: 5 }); // tasks
    const result = await reassignUserRecords(TENANT_A, FROM, TO);
    expect(result).toEqual({ contacts: 2, deals: 1, tasks: 5 });
  });

  it('defaults a null rowCount to 0 rather than throwing', async () => {
    mockExecute.mockResolvedValue({ rowCount: null });
    const result = await reassignUserRecords(TENANT_A, FROM, TO);
    expect(result).toEqual({ contacts: 0, deals: 0, tasks: 0 });
  });

  it('does not choke on a FROM user with a single-word or missing name', async () => {
    const fromNoName: ReassignableUser = { id: 'user-x', name: null, email: 'x@example.com' };
    await expect(reassignUserRecords(TENANT_A, fromNoName, TO)).resolves.toEqual({ contacts: 0, deals: 0, tasks: 0 });
  });
});
