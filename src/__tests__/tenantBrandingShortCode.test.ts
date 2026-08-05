import { describe, it, expect, vi, beforeEach } from 'vitest';

// deriveTenantShortCode/resolveTenantShortCode replace the literal 'GE'
// invoiceNumberService.ts and retainerService.ts used to hardcode regardless
// of tenant. The key invariant under test: Growth Escalators' own displayName
// ("Growth Escalators") must keep deriving to "GE" — the exact code both
// series already used — so today's already-configured tenant sees no change.

const mockDbSelect = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock('../db/schema', () => ({
  tenantBranding: { tenantId: 'tenant_id' },
  tenants: { id: 'id', slug: 'slug' },
}));

function mockSelectOnce(rows: unknown[]) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

beforeEach(() => {
  mockDbSelect.mockReset();
});

describe('deriveTenantShortCode', () => {
  it("derives 'GE' from Growth Escalators' displayName (backward-compat anchor)", async () => {
    const { deriveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    expect(deriveTenantShortCode('Growth Escalators')).toBe('GE');
  });

  it('derives distinct codes for two different multi-word tenant names', async () => {
    const { deriveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    expect(deriveTenantShortCode('Acme Corp')).toBe('AC');
    expect(deriveTenantShortCode('Beta Industries')).toBe('BI');
    expect(deriveTenantShortCode('Acme Corp')).not.toBe(deriveTenantShortCode('Beta Industries'));
  });

  it('falls back to alnum-prefix for a single-word name', async () => {
    const { deriveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    expect(deriveTenantShortCode('Wizmatch')).toBe('WIZ');
  });

  it("falls back to 'TEN' for empty/missing displayName", async () => {
    const { deriveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    expect(deriveTenantShortCode(null)).toBe('TEN');
    expect(deriveTenantShortCode('   ')).toBe('TEN');
  });
});

describe('resolveTenantShortCode', () => {
  it("reads the tenant's own tenant_branding.displayName when configured", async () => {
    mockSelectOnce([{
      displayName: 'Growth Escalators', primaryColor: null, accentColor: null,
      legalEntityName: null, registeredAddress: null, gstin: null, bankName: null,
      bankAccountName: null, bankAccountNumber: null, bankIfsc: null,
      supportEmail: null, supportPhone: null, website: null,
    }]);
    const { resolveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    await expect(resolveTenantShortCode('tenant-ge')).resolves.toBe('GE');
  });

  it('falls back to the slug-based default when no tenant_branding row exists yet', async () => {
    mockSelectOnce([]); // getTenantDocumentIdentity finds nothing
    mockSelectOnce([{ slug: 'wizmatch' }]); // getTenantSlugById
    const { resolveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    await expect(resolveTenantShortCode('tenant-wm')).resolves.toBe('WIZ');
  });

  it('falls back to the generic placeholder when neither a branding row nor a known slug exists', async () => {
    mockSelectOnce([]); // getTenantDocumentIdentity finds nothing
    mockSelectOnce([]); // getTenantSlugById finds nothing
    const { resolveTenantShortCode, GENERIC_DEFAULT_BRANDING, deriveTenantShortCode } = await import('../services/tenantBrandingDefaults');
    await expect(resolveTenantShortCode('tenant-unknown')).resolves.toBe(deriveTenantShortCode(GENERIC_DEFAULT_BRANDING.displayName));
  });
});
