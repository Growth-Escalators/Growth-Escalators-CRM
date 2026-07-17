import { describe, it, expect, vi } from 'vitest';
import { contactBelongsToTenant } from '../services/socketAuth';

function makePool(rows: Array<{ tenant_id: string }>) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('contactBelongsToTenant (Socket.io join_contact tenant scoping, C7)', () => {
  it('returns true when the contact belongs to the caller tenant', async () => {
    const pool = makePool([{ tenant_id: 'tenant-a' }]);
    expect(await contactBelongsToTenant(pool, 'contact-1', 'tenant-a')).toBe(true);
  });

  it('returns false when the contact belongs to a different tenant (cross-tenant join attempt)', async () => {
    const pool = makePool([{ tenant_id: 'tenant-b' }]);
    expect(await contactBelongsToTenant(pool, 'contact-1', 'tenant-a')).toBe(false);
  });

  it('returns false when the contact does not exist', async () => {
    const pool = makePool([]);
    expect(await contactBelongsToTenant(pool, 'nonexistent', 'tenant-a')).toBe(false);
  });

  it('returns false for a non-string / empty contactId without querying the DB', async () => {
    const pool = makePool([{ tenant_id: 'tenant-a' }]);
    expect(await contactBelongsToTenant(pool, undefined, 'tenant-a')).toBe(false);
    expect(await contactBelongsToTenant(pool, '', 'tenant-a')).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns false (fails closed) when the query throws', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('connection reset')) };
    expect(await contactBelongsToTenant(pool, 'contact-1', 'tenant-a')).toBe(false);
  });
});
