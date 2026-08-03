import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real schema (not mocked) so `tenantBranding.tenantId` etc. are genuine
// Drizzle columns — needed to assert onConflictDoNothing's `target` argument
// is the actual column object, not a stand-in.
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
    },
    pool: { query: vi.fn() },
    schema,
  };
});

import { tenants, tenantBranding } from '../db/schema';
import {
  getDefaultBrandingForSlug,
  GENERIC_DEFAULT_BRANDING,
  seedTenantBrandingDefaults,
} from '../services/tenantBrandingDefaults';

function selectTenantsChain(rows: Array<{ id: string; slug: string }>) {
  return { from: vi.fn().mockResolvedValue(rows) };
}

describe('getDefaultBrandingForSlug', () => {
  it('returns Growth Escalators\' real branding for growth-escalators', () => {
    const b = getDefaultBrandingForSlug('growth-escalators');
    expect(b.displayName).toBe('Growth Escalators');
    expect(b.logoUrl).toBe('/ge-mark.png');
    expect(b.primaryColor).toBe('#1A3A5C');
    expect(b.accentColor).toBe('#F97316');
  });

  it('returns Wizmatch\'s real branding for wizmatch', () => {
    const b = getDefaultBrandingForSlug('wizmatch');
    expect(b.displayName).toBe('Wizmatch');
    expect(b.accentColor).toBe('#3b82f6');
  });

  it('returns a clearly-generic placeholder for any other tenant slug — never a real client name', () => {
    const b = getDefaultBrandingForSlug('some-other-pilot-tenant');
    expect(b).toEqual(GENERIC_DEFAULT_BRANDING);
    expect(b.displayName).toBe('Client Workspace');
    expect(b.logoUrl).toBeNull();
    expect(b.faviconUrl).toBeNull();
    // Guard against ever accidentally seeding the placeholder with GE's or
    // Wizmatch's identity/colors.
    expect(b.displayName).not.toBe('Growth Escalators');
    expect(b.displayName).not.toBe('Wizmatch');
    expect(b.primaryColor).not.toBe('#1A3A5C');
    expect(b.accentColor).not.toBe('#F97316');
    expect(b.accentColor).not.toBe('#3b82f6');
  });

  it('is case-sensitive / exact-match on slug (an unrecognized casing falls to the generic default, not a partial match)', () => {
    expect(getDefaultBrandingForSlug('Wizmatch')).toEqual(GENERIC_DEFAULT_BRANDING);
    expect(getDefaultBrandingForSlug('')).toEqual(GENERIC_DEFAULT_BRANDING);
  });
});

describe('seedTenantBrandingDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a default row for every tenant, keyed by that tenant\'s own slug, and no-ops on conflict', async () => {
    const TENANT_GE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const TENANT_WM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const TENANT_PILOT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    mockSelect.mockReturnValueOnce(selectTenantsChain([
      { id: TENANT_GE, slug: 'growth-escalators' },
      { id: TENANT_WM, slug: 'wizmatch' },
      { id: TENANT_PILOT, slug: 'a-pilot-reseller-slug' },
    ]));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    mockInsert.mockReturnValue({ values });

    await seedTenantBrandingDefaults();

    expect(mockInsert).toHaveBeenCalledTimes(3);
    expect(values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: TENANT_GE, displayName: 'Growth Escalators', accentColor: '#F97316',
    }));
    expect(values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      tenantId: TENANT_WM, displayName: 'Wizmatch', accentColor: '#3b82f6',
    }));
    expect(values).toHaveBeenNthCalledWith(3, expect.objectContaining({
      tenantId: TENANT_PILOT, displayName: 'Client Workspace', logoUrl: null,
    }));
    // Never leaks GE's/Wizmatch's identity onto the pilot tenant's seeded row.
    const pilotCallArgs = values.mock.calls[2][0];
    expect(pilotCallArgs.displayName).not.toBe('Growth Escalators');
    expect(pilotCallArgs.displayName).not.toBe('Wizmatch');

    // Idempotency: the conflict target is the real unique column, so re-running
    // this against tenants that already have a row is a safe no-op.
    expect(onConflictDoNothing).toHaveBeenCalledTimes(3);
    for (const call of onConflictDoNothing.mock.calls) {
      expect(call[0]).toEqual({ target: tenantBranding.tenantId });
    }
  });

  it('is a no-op when there are no tenants', async () => {
    mockSelect.mockReturnValueOnce(selectTenantsChain([]));
    await seedTenantBrandingDefaults();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// Sanity check that the real schema import used above still points at the
// columns this whole test file's assertions assume exist.
describe('schema sanity', () => {
  it('tenantBranding.tenantId and tenants.slug are real Drizzle columns', () => {
    expect(tenantBranding.tenantId).toBeDefined();
    expect(tenants.slug).toBeDefined();
  });
});
