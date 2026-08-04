import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real schema (not mocked) so `tenantBranding.tenantId` etc. are genuine
// Drizzle columns — needed to assert onConflictDoNothing's `target` argument
// is the actual column object, not a stand-in.
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/index', async () => {
  const schema = await import('../db/schema');
  return {
    db: {
      select: (...args: unknown[]) => mockSelect(...args),
      insert: (...args: unknown[]) => mockInsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    pool: { query: vi.fn() },
    schema,
  };
});

import { PgDialect } from 'drizzle-orm/pg-core';
import { tenants, tenantBranding } from '../db/schema';
import {
  getDefaultBrandingForSlug,
  GENERIC_DEFAULT_BRANDING,
  seedTenantBrandingDefaults,
  getTenantDocumentIdentity,
  isBillingIdentityConfigured,
  type TenantDocumentIdentity,
} from '../services/tenantBrandingDefaults';

const dialect = new PgDialect();

function selectTenantsChain(rows: Array<{ id: string; slug: string }>) {
  return { from: vi.fn().mockResolvedValue(rows) };
}

// Builds a mock select-chain that hands back to the caller the exact
// condition object passed to `.where(...)`, so it can be compiled and
// inspected the same way tenantBranding.test.ts / savedViewsTenantIsolation
// do — proves the WHERE binds the real tenantId param, not a stand-in.
function selectWhereChain(rows: unknown[], onWhere?: (cond: unknown) => void) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((cond: unknown) => {
        onWhere?.(cond);
        return { limit: vi.fn().mockResolvedValue(rows) };
      }),
    }),
  };
}

function updateWhereChain(onWhere?: (cond: unknown) => void) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((cond: unknown) => {
        onWhere?.(cond);
        return Promise.resolve(undefined);
      }),
    }),
  };
}

function fullIdentity(overrides: Partial<TenantDocumentIdentity> = {}): TenantDocumentIdentity {
  return {
    displayName: 'Acme Recruiting',
    primaryColor: '#123456',
    accentColor: '#abcdef',
    legalEntityName: 'Acme Recruiting Pvt Ltd',
    registeredAddress: '1 MG Road, Bengaluru, Karnataka 560001',
    gstin: '29AABCU9603R1ZM',
    bankName: 'HDFC Bank',
    bankAccountName: 'Acme Recruiting Pvt Ltd',
    bankAccountNumber: '000111222333',
    bankIfsc: 'HDFC0000001',
    supportEmail: 'billing@acme.example',
    supportPhone: '+91 90000 00000',
    website: 'acme.example',
    ...overrides,
  };
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

    let updateWhereCond: unknown;
    mockUpdate.mockReturnValueOnce(updateWhereChain((cond) => { updateWhereCond = cond; }));

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

    // The legal/financial identity backfill runs ONLY for growth-escalators
    // (DEFAULT_TENANT_SLUG) — never for Wizmatch or the pilot tenant, and
    // never as a second call.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(tenantBranding);
    const compiledUpdateWhere = dialect.sqlToQuery(updateWhereCond as any);
    expect(compiledUpdateWhere.sql).toContain('"tenant_branding"."tenant_id" =');
    expect(compiledUpdateWhere.sql).toContain('"tenant_branding"."legal_entity_name" is null');
    expect(compiledUpdateWhere.params).toEqual([TENANT_GE]);
  });

  it('backfills growth-escalators\' own legal/financial identity with an idempotent, null-guarded UPDATE', async () => {
    const TENANT_GE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mockSelect.mockReturnValueOnce(selectTenantsChain([{ id: TENANT_GE, slug: 'growth-escalators' }]));

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing }) });

    let setArgs: unknown;
    const set = vi.fn().mockImplementation((args: unknown) => {
      setArgs = args;
      return { where: vi.fn().mockResolvedValue(undefined) };
    });
    mockUpdate.mockReturnValueOnce({ set });

    await seedTenantBrandingDefaults();

    // Byte-identical to today's hardcoded values — GE's own invoices/reports
    // must render exactly as before this change.
    expect(setArgs).toMatchObject({
      legalEntityName: 'Growth Escalators',
      registeredAddress: '264/103-104 Pratap Nagar, Sanganer, Jaipur, Rajasthan 302033',
      gstin: '08DRYPA4899F2ZZ',
      bankName: 'ICICI Bank',
      bankAccountName: 'Growth Escalators',
      bankAccountNumber: '3617 0500 1178',
      bankIfsc: 'ICIC0003617',
      supportEmail: 'jatin@growthescalators.com',
      supportPhone: '+91 77338 88883',
      website: 'growthescalators.com',
    });
  });

  it('is a no-op when there are no tenants', async () => {
    mockSelect.mockReturnValueOnce(selectTenantsChain([]));
    await seedTenantBrandingDefaults();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('getTenantDocumentIdentity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when the tenant has no tenant_branding row yet — never a default GSTIN/bank', async () => {
    mockSelect.mockReturnValueOnce(selectWhereChain([]));
    const result = await getTenantDocumentIdentity('some-tenant-id');
    expect(result).toBeNull();
  });

  it('scopes the read to the given tenantId', async () => {
    let captured: unknown;
    mockSelect.mockReturnValueOnce(selectWhereChain(
      [fullIdentity()],
      (cond) => { captured = cond; },
    ));
    const result = await getTenantDocumentIdentity('tenant-x');
    expect(result?.legalEntityName).toBe('Acme Recruiting Pvt Ltd');

    const compiled = dialect.sqlToQuery(captured as any);
    expect(compiled.sql).toContain('"tenant_branding"."tenant_id" =');
    expect(compiled.params).toEqual(['tenant-x']);
  });
});

describe('isBillingIdentityConfigured', () => {
  it('rejects null identity', () => {
    expect(isBillingIdentityConfigured(null, { requireGstBankDetails: false })).toBe(false);
  });

  it('requires legalEntityName + registeredAddress for every invoice, GST or not', () => {
    expect(isBillingIdentityConfigured(
      fullIdentity({ legalEntityName: null }), { requireGstBankDetails: false },
    )).toBe(false);
    expect(isBillingIdentityConfigured(
      fullIdentity({ registeredAddress: '   ' }), { requireGstBankDetails: false },
    )).toBe(false);
    expect(isBillingIdentityConfigured(
      fullIdentity(), { requireGstBankDetails: false },
    )).toBe(true);
  });

  it('additionally requires gstin + full bank details when requireGstBankDetails is true', () => {
    const complete = fullIdentity();
    expect(isBillingIdentityConfigured(complete, { requireGstBankDetails: true })).toBe(true);

    for (const field of ['gstin', 'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfsc'] as const) {
      const partial = fullIdentity({ [field]: null });
      expect(isBillingIdentityConfigured(partial, { requireGstBankDetails: true })).toBe(false);
      // But the same partial identity is fine for a non-GST invoice.
      expect(isBillingIdentityConfigured(partial, { requireGstBankDetails: false })).toBe(true);
    }
  });

  it('additionally requires supportEmail only when requireSupportEmail is true', () => {
    const noSupportEmail = fullIdentity({ supportEmail: null });
    expect(isBillingIdentityConfigured(noSupportEmail, { requireGstBankDetails: false })).toBe(true);
    expect(isBillingIdentityConfigured(
      noSupportEmail, { requireGstBankDetails: false, requireSupportEmail: true },
    )).toBe(false);
    expect(isBillingIdentityConfigured(
      fullIdentity(), { requireGstBankDetails: false, requireSupportEmail: true },
    )).toBe(true);
  });

  it('a Growth-Escalators-shaped complete identity passes every combination of requirements', () => {
    const ge = fullIdentity({
      legalEntityName: 'Growth Escalators',
      registeredAddress: '264/103-104 Pratap Nagar, Sanganer, Jaipur, Rajasthan 302033',
      gstin: '08DRYPA4899F2ZZ',
      bankName: 'ICICI Bank',
      bankAccountName: 'Growth Escalators',
      bankAccountNumber: '3617 0500 1178',
      bankIfsc: 'ICIC0003617',
      supportEmail: 'jatin@growthescalators.com',
    });
    expect(isBillingIdentityConfigured(ge, { requireGstBankDetails: true, requireSupportEmail: true })).toBe(true);
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
