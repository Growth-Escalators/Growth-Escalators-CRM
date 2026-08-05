import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/services/shortLinksDb.ts had zero occurrences of "tenant" and
// `slug TEXT PRIMARY KEY` — a global namespace shared across every tenant.
// A reseller tenant could overwrite or delete another tenant's short link
// by reusing the same slug via the admin CRUD API (src/routes/links.ts).
// [NEEDS HUMAN SIGN-OFF — see PR description] These tests cover:
//   - every admin-facing function now binds tenant_id
//   - a foreign-tenant slug collision resolves to "not found", never a
//     cross-tenant overwrite/delete
//   - the public redirect path's necessarily tenant-agnostic lookup
//     (lookupShortLinkDbAnyTenant) and its now-tenant-scoped click counter
//   - ensureShortLinksTable()'s backfill + composite-PK migration

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/shortLinks', () => ({ SEED_SHORT_LINKS: [] }));

const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fakeRow(tenantId: string, slug: string) {
  return { slug, tenant_id: tenantId, destination: 'https://example.com/x', description: null, tags: [], created_by_user_id: null, created_at: new Date(), updated_at: new Date(), click_count: 0, last_clicked_at: null };
}

beforeEach(() => {
  mockPoolQuery.mockReset();
});

describe('shortLinksDb — admin-facing functions are tenant-scoped', () => {
  it('lookupShortLinkDb binds tenant_id + slug', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [fakeRow(TENANT_A, 'promo')] });
    const { lookupShortLinkDb } = await import('../services/shortLinksDb');

    const hit = await lookupShortLinkDb(TENANT_A, 'promo');

    expect(hit?.tenantId).toBe(TENANT_A);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/tenant_id = \$1/);
    expect(params).toEqual([TENANT_A, 'promo']);
  });

  it('listShortLinksDb only queries the caller\'s own tenant_id', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });
    const { listShortLinksDb } = await import('../services/shortLinksDb');

    await listShortLinksDb(TENANT_A);

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE tenant_id = \$1/);
    expect(params).toEqual([TENANT_A]);
  });

  it('createShortLinkDb binds tenant_id on the INSERT', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [fakeRow(TENANT_A, 'promo')] });
    const { createShortLinkDb } = await import('../services/shortLinksDb');

    await createShortLinkDb({ tenantId: TENANT_A, slug: 'promo', destination: 'https://example.com' });

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO short_links \(tenant_id, slug/);
    expect(params[0]).toBe(TENANT_A);
  });

  it('a foreign tenant updating a slug that belongs to a different tenant finds nothing — never overwrites it', async () => {
    // tenant B's UPDATE ... WHERE tenant_id = B AND slug = 'promo' matches
    // zero rows, since 'promo' actually belongs to tenant A.
    mockPoolQuery.mockResolvedValue({ rows: [] });
    const { updateShortLinkDb } = await import('../services/shortLinksDb');

    const result = await updateShortLinkDb(TENANT_B, 'promo', { destination: 'https://attacker.example' });

    expect(result).toBeNull();
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE tenant_id = \$\d+ AND slug = \$\d+/);
    expect(params).toContain(TENANT_B);
    expect(params).not.toContain(TENANT_A);
  });

  it('a foreign tenant deleting a slug that belongs to a different tenant deletes nothing', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 0 });
    const { deleteShortLinkDb } = await import('../services/shortLinksDb');

    const deleted = await deleteShortLinkDb(TENANT_B, 'promo');

    expect(deleted).toBe(false);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE tenant_id = \$1 AND slug = \$2/);
    expect(params).toEqual([TENANT_B, 'promo']);
  });
});

describe('shortLinksDb — public redirect path (necessarily tenant-agnostic)', () => {
  it('lookupShortLinkDbAnyTenant looks up by slug alone, with no tenant predicate', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [fakeRow(TENANT_A, 'promo')] });
    const { lookupShortLinkDbAnyTenant } = await import('../services/shortLinksDb');

    const hit = await lookupShortLinkDbAnyTenant('promo');

    expect(hit?.tenantId).toBe(TENANT_A);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).not.toMatch(/tenant_id/);
    expect(params).toEqual(['promo']);
  });

  it('incrementClickCount is scoped to the specific resolved tenant row, not every tenant sharing that slug', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 1 });
    const { incrementClickCount } = await import('../services/shortLinksDb');

    await incrementClickCount(TENANT_A, 'promo');

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE tenant_id = \$1 AND slug = \$2/);
    expect(params).toEqual([TENANT_A, 'promo']);
  });
});

describe('shortLinksDb.ensureShortLinksTable — tenant_id backfill + composite-PK migration', () => {
  it('backfills NULL tenant_id rows to the default tenant, then tightens NOT NULL and swaps the PK', async () => {
    const calls: string[] = [];
    mockPoolQuery.mockImplementation(async (sqlText: string) => {
      const sql = String(sqlText);
      calls.push(sql);
      if (sql.includes('FROM tenants WHERE slug')) return { rows: [{ id: TENANT_A }] };
      if (sql.includes('SELECT COUNT(*)::int AS c FROM short_links WHERE tenant_id IS NULL')) return { rows: [{ c: 0 }] };
      return { rows: [] };
    });
    const { ensureShortLinksTable } = await import('../services/shortLinksDb');

    await ensureShortLinksTable();

    expect(calls.some(c => c.includes('UPDATE short_links SET tenant_id') && c.includes('WHERE tenant_id IS NULL'))).toBe(true);
    expect(calls.some(c => c.includes('ALTER COLUMN tenant_id SET NOT NULL'))).toBe(true);
    expect(calls.some(c => c.includes('DROP CONSTRAINT IF EXISTS short_links_pkey'))).toBe(true);
    expect(calls.some(c => c.includes('ADD CONSTRAINT short_links_tenant_slug_pkey PRIMARY KEY (tenant_id, slug)'))).toBe(true);
  });

  it('skips the NOT NULL/PK tightening when rows still have NULL tenant_id (default tenant unresolvable) instead of crashing boot', async () => {
    const calls: string[] = [];
    mockPoolQuery.mockImplementation(async (sqlText: string) => {
      const sql = String(sqlText);
      calls.push(sql);
      if (sql.includes('FROM tenants WHERE slug')) return { rows: [] }; // unresolvable
      if (sql.includes('SELECT COUNT(*)::int AS c FROM short_links WHERE tenant_id IS NULL')) return { rows: [{ c: 3 }] };
      return { rows: [] };
    });
    const { ensureShortLinksTable } = await import('../services/shortLinksDb');

    await expect(ensureShortLinksTable()).resolves.toBeUndefined(); // never throws — fails soft

    expect(calls.some(c => c.includes('ALTER COLUMN tenant_id SET NOT NULL'))).toBe(false);
    expect(calls.some(c => c.includes('DROP CONSTRAINT IF EXISTS short_links_pkey'))).toBe(false);
  });
});
