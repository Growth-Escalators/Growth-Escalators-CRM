import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Real schema (not mocked) so `tenantBranding.tenantId` etc. are genuine
// Drizzle columns — needed to assert onConflictDoNothing's `target` argument
// is the actual column object, not a stand-in.
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockLoggerWarn = vi.fn();

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

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

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

// Fictitious end-to-end — no resemblance to Growth Escalators' real legal
// name, address, GSTIN, or bank details is intended. GSTIN/IFSC use the
// standard publicly-documented example formats.
const FAKE_DEFAULT_TENANT_ENV: Record<string, string> = {
  DEFAULT_TENANT_LEGAL_NAME: 'Example Operator Pvt Ltd',
  DEFAULT_TENANT_REGISTERED_ADDRESS: '1 Example Business Park, Sample City, Karnataka 560001',
  DEFAULT_TENANT_GSTIN: '22AAAAA0000A1Z5',
  DEFAULT_TENANT_BANK_NAME: 'Example Bank',
  DEFAULT_TENANT_BANK_ACCOUNT_NAME: 'Example Operator Pvt Ltd',
  DEFAULT_TENANT_BANK_ACCOUNT_NUMBER: '000123456789',
  DEFAULT_TENANT_BANK_IFSC: 'EXBK0001234',
  DEFAULT_TENANT_SUPPORT_EMAIL: 'billing@example-operator.test',
  DEFAULT_TENANT_SUPPORT_PHONE: '+91 90000 00001',
  DEFAULT_TENANT_WEBSITE: 'example-operator.test',
};
const DEFAULT_TENANT_ENV_VAR_NAMES = Object.keys(FAKE_DEFAULT_TENANT_ENV);

describe('seedTenantBrandingDefaults', () => {
  // Every test in this block starts from a clean slate for these vars,
  // regardless of what the ambient shell/CI environment happens to have set
  // — and restores whatever was really there afterward.
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of DEFAULT_TENANT_ENV_VAR_NAMES) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of DEFAULT_TENANT_ENV_VAR_NAMES) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
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

    // No DEFAULT_TENANT_* env vars set in this test (see beforeEach) — the
    // legal/financial identity backfill is covered separately below.
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
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  describe('default tenant legal/financial identity — read from environment, never hardcoded', () => {
    function mockInsertNoOp() {
      mockInsert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }) });
    }

    it('when no DEFAULT_TENANT_* env vars are set: warns naming every missing var by name, and never calls update', async () => {
      const TENANT_GE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      mockSelect.mockReturnValueOnce(selectTenantsChain([{ id: TENANT_GE, slug: 'growth-escalators' }]));
      mockInsertNoOp();

      await seedTenantBrandingDefaults();

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      const warnMessage = mockLoggerWarn.mock.calls[0][0] as string;
      for (const name of DEFAULT_TENANT_ENV_VAR_NAMES) {
        expect(warnMessage).toContain(name);
      }
    });

    it('writes only the fields whose env var is set — a partially configured deployment does not null out the rest', async () => {
      const TENANT_GE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      mockSelect.mockReturnValueOnce(selectTenantsChain([{ id: TENANT_GE, slug: 'growth-escalators' }]));
      mockInsertNoOp();

      process.env.DEFAULT_TENANT_LEGAL_NAME = FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_LEGAL_NAME;
      process.env.DEFAULT_TENANT_REGISTERED_ADDRESS = FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_REGISTERED_ADDRESS;
      // Every other var (gstin, bank*, support*, website) intentionally left unset.

      let setArgs: Record<string, unknown> = {};
      mockUpdate.mockReturnValueOnce({
        set: vi.fn().mockImplementation((args: Record<string, unknown>) => {
          setArgs = args;
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      });

      await seedTenantBrandingDefaults();

      expect(setArgs.legalEntityName).toBe(FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_LEGAL_NAME);
      expect(setArgs.registeredAddress).toBe(FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_REGISTERED_ADDRESS);
      // The unset fields must be genuinely ABSENT from the SET payload (not
      // present-as-null/undefined) — an ORM `.set({ gstin: undefined })`
      // can still emit `gstin = NULL` depending on the driver, which would
      // silently wipe a value entered later via the Branding settings page.
      for (const field of ['gstin', 'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfsc', 'supportEmail', 'supportPhone', 'website']) {
        expect(Object.prototype.hasOwnProperty.call(setArgs, field)).toBe(false);
      }
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      const warnMessage = mockLoggerWarn.mock.calls[0][0] as string;
      expect(warnMessage).toContain('DEFAULT_TENANT_GSTIN');
      // The two vars that WERE set must not be listed among the missing ones.
      expect(warnMessage).not.toContain('DEFAULT_TENANT_LEGAL_NAME');
      expect(warnMessage).not.toContain('DEFAULT_TENANT_REGISTERED_ADDRESS');
    });

    it('writes every field when every env var is set — flows through exactly what was configured, not a hardcoded literal', async () => {
      const TENANT_GE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      mockSelect.mockReturnValueOnce(selectTenantsChain([{ id: TENANT_GE, slug: 'growth-escalators' }]));
      mockInsertNoOp();

      for (const [name, value] of Object.entries(FAKE_DEFAULT_TENANT_ENV)) {
        process.env[name] = value;
      }

      let setArgs: unknown;
      mockUpdate.mockReturnValueOnce({
        set: vi.fn().mockImplementation((args: unknown) => {
          setArgs = args;
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      });

      await seedTenantBrandingDefaults();

      expect(mockLoggerWarn).not.toHaveBeenCalled();
      expect(setArgs).toMatchObject({
        legalEntityName: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_LEGAL_NAME,
        registeredAddress: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_REGISTERED_ADDRESS,
        gstin: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_GSTIN,
        bankName: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_NAME,
        bankAccountName: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_ACCOUNT_NAME,
        bankAccountNumber: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_ACCOUNT_NUMBER,
        bankIfsc: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_IFSC,
        supportEmail: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_SUPPORT_EMAIL,
        supportPhone: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_SUPPORT_PHONE,
        website: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_WEBSITE,
      });
    });

    it('the update is scoped to the tenant and null-guarded on legalEntityName — the mechanism that stops a later deploy (env vars missing again) from ever clobbering a row already populated', async () => {
      // This compiles the actual WHERE condition object through Drizzle's
      // own SQL generator (same technique as tenantBranding.test.ts) rather
      // than asserting a mock was "called with something" — the guarantee
      // this proves is a property of the SQL Postgres will run: an UPDATE
      // whose WHERE requires legal_entity_name IS NULL is a no-op against
      // any row where that column is already set, regardless of what the
      // SET payload contains or how many times this function runs.
      const TENANT_GE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      mockSelect.mockReturnValueOnce(selectTenantsChain([{ id: TENANT_GE, slug: 'growth-escalators' }]));
      mockInsertNoOp();
      process.env.DEFAULT_TENANT_LEGAL_NAME = FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_LEGAL_NAME;

      let updateWhereCond: unknown;
      mockUpdate.mockReturnValueOnce(updateWhereChain((cond) => { updateWhereCond = cond; }));

      await seedTenantBrandingDefaults();

      expect(mockUpdate).toHaveBeenCalledWith(tenantBranding);
      const compiled = dialect.sqlToQuery(updateWhereCond as any);
      expect(compiled.sql).toContain('"tenant_branding"."tenant_id" =');
      expect(compiled.sql).toContain('"tenant_branding"."legal_entity_name" is null');
      expect(compiled.params).toEqual([TENANT_GE]);
    });

    it('never runs the backfill for a non-default tenant, even if the env vars happen to be set', async () => {
      const TENANT_WM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      mockSelect.mockReturnValueOnce(selectTenantsChain([{ id: TENANT_WM, slug: 'wizmatch' }]));
      mockInsertNoOp();
      for (const [name, value] of Object.entries(FAKE_DEFAULT_TENANT_ENV)) {
        process.env[name] = value;
      }

      await seedTenantBrandingDefaults();

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
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

  it('a default-tenant-shaped complete identity (the FAKE_DEFAULT_TENANT_ENV shape) passes every combination of requirements', () => {
    const defaultTenant = fullIdentity({
      legalEntityName: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_LEGAL_NAME,
      registeredAddress: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_REGISTERED_ADDRESS,
      gstin: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_GSTIN,
      bankName: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_NAME,
      bankAccountName: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_ACCOUNT_NAME,
      bankAccountNumber: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_ACCOUNT_NUMBER,
      bankIfsc: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_BANK_IFSC,
      supportEmail: FAKE_DEFAULT_TENANT_ENV.DEFAULT_TENANT_SUPPORT_EMAIL,
    });
    expect(isBillingIdentityConfigured(defaultTenant, { requireGstBankDetails: true, requireSupportEmail: true })).toBe(true);
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
