import { describe, it, expect, vi, beforeEach } from 'vitest';

// scripts/onboarding/provisionResellerTenant.ts imports '../../src/db/index'
// (relative to scripts/onboarding/) which resolves to the same file as
// '../db/index' below (relative to src/__tests__/) — vi.doMock intercepts by
// resolved module id, so the mock applies regardless of the two different
// relative specifiers. Same technique src/__tests__/tenantFeatures.test.ts
// uses for the sibling module this one is stacked on top of.
const SCRIPT_PATH = '../../scripts/onboarding/provisionResellerTenant';

describe('parseCliArgs', () => {
  it('parses a full set of valid args', async () => {
    const { parseCliArgs } = await import(SCRIPT_PATH);
    expect(parseCliArgs(['Acme Marketing Co', 'acme-marketing', 'Owner@Acme.Example', 'Jane Doe'])).toEqual({
      name: 'Acme Marketing Co',
      slug: 'acme-marketing',
      ownerEmail: 'owner@acme.example', // lowercased
      ownerName: 'Jane Doe',
    });
  });

  it('defaults ownerName to "Owner" when omitted', async () => {
    const { parseCliArgs } = await import(SCRIPT_PATH);
    expect(parseCliArgs(['Acme Marketing Co', 'acme-marketing', 'owner@acme.example'])).toEqual({
      name: 'Acme Marketing Co',
      slug: 'acme-marketing',
      ownerEmail: 'owner@acme.example',
      ownerName: 'Owner',
    });
  });

  it('throws when the tenant name is missing/blank', async () => {
    const { parseCliArgs } = await import(SCRIPT_PATH);
    expect(() => parseCliArgs([])).toThrow(/tenant display name is required/);
    expect(() => parseCliArgs(['   ', 'acme-marketing', 'owner@acme.example'])).toThrow(/tenant display name is required/);
  });

  it('throws when the slug is missing', async () => {
    const { parseCliArgs } = await import(SCRIPT_PATH);
    expect(() => parseCliArgs(['Acme Marketing Co'])).toThrow(/tenant slug is required/);
  });

  it('throws on an invalid slug format (uppercase, spaces, underscores, leading/trailing/double hyphen)', async () => {
    const { parseCliArgs } = await import(SCRIPT_PATH);
    const base = ['Acme Marketing Co'];
    for (const badSlug of ['Acme-Marketing', 'acme marketing', 'acme_marketing', '-acme-marketing', 'acme-marketing-', 'acme--marketing', 'a']) {
      expect(() => parseCliArgs([...base, badSlug, 'owner@acme.example']), badSlug).toThrow();
    }
  });

  it('throws when the owner email is missing or invalid', async () => {
    const { parseCliArgs } = await import(SCRIPT_PATH);
    expect(() => parseCliArgs(['Acme Marketing Co', 'acme-marketing'])).toThrow(/valid owner email is required/);
    expect(() => parseCliArgs(['Acme Marketing Co', 'acme-marketing', 'not-an-email'])).toThrow(/valid owner email is required/);
  });
});

describe('validateTenantSlug', () => {
  it('accepts slugs matching existing tenant conventions', async () => {
    const { validateTenantSlug } = await import(SCRIPT_PATH);
    for (const slug of ['growth-escalators', 'wizmatch', 'acme-marketing', 'ab', 'a1-b2-c3']) {
      expect(() => validateTenantSlug(slug), slug).not.toThrow();
    }
  });

  it('rejects slugs that violate the convention', async () => {
    const { validateTenantSlug } = await import(SCRIPT_PATH);
    for (const slug of ['Acme', 'acme_marketing', 'acme marketing', '-acme', 'acme-', 'acme--marketing', 'a', '']) {
      expect(() => validateTenantSlug(slug), slug).toThrow();
    }
  });

  it('rejects slugs over 63 characters', async () => {
    const { validateTenantSlug } = await import(SCRIPT_PATH);
    expect(() => validateTenantSlug('a'.repeat(64))).toThrow(/2-63 characters/);
  });
});

describe('reseller_pilot plan defaults (extends PLAN_DEFAULTS from PR #115, does not duplicate it)', () => {
  it('crmAutomation on; wizmatch/seo/gstBilling/d2c off', async () => {
    const { computeTenantFeatures } = await import('../services/tenantFeatures');
    expect(computeTenantFeatures('reseller_pilot', {})).toEqual({
      wizmatch: false,
      seo: false,
      crmAutomation: true,
      gstBilling: false,
      d2c: false,
    });
  });

  it('RESELLER_PILOT_PLAN constant matches the key used in PLAN_DEFAULTS', async () => {
    const { RESELLER_PILOT_PLAN } = await import(SCRIPT_PATH);
    expect(RESELLER_PILOT_PLAN).toBe('reseller_pilot');
  });
});

describe('DEFAULT_PIPELINE_STAGES', () => {
  it('matches the admin "New Pipeline" default stage template with outcomes inferred correctly', async () => {
    const { DEFAULT_PIPELINE_STAGES, DEFAULT_PIPELINE_STAGE_NAMES } = await import(SCRIPT_PATH);
    expect(DEFAULT_PIPELINE_STAGE_NAMES).toEqual(['New Lead', 'Contacted', 'Proposal Sent', 'Won', 'Lost']);
    // For plain-string stage input, normalizePipelineStage() sets id = name
    // verbatim (no slugifying) — same behavior the admin UI's own
    // DEFAULT_STAGES gets from serializePipelineStages() over this same
    // string array (admin/src/lib/pipelineStages.js normalizePipelineStage).
    expect(DEFAULT_PIPELINE_STAGES).toEqual([
      { id: 'New Lead', name: 'New Lead', color: null, outcome: 'open' },
      { id: 'Contacted', name: 'Contacted', color: null, outcome: 'open' },
      { id: 'Proposal Sent', name: 'Proposal Sent', color: null, outcome: 'open' },
      { id: 'Won', name: 'Won', color: null, outcome: 'won' },
      { id: 'Lost', name: 'Lost', color: null, outcome: 'lost' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// DB-touching functions — mocked drizzle chains, matching the pattern
// src/__tests__/tenantFeatures.test.ts uses for the sibling module this
// script is stacked on top of.
// ---------------------------------------------------------------------------

interface DbMockConfig {
  /** One entry per db.select(...).from(...).where(...).limit(1) call, in call order. */
  selects?: unknown[][];
  /** One entry per db.insert(...).values(...).returning(...) call, in call order. */
  inserts?: unknown[][];
}

function mockDb({ selects = [], inserts = [] }: DbMockConfig) {
  let selectCall = 0;
  const limit = vi.fn(() => Promise.resolve(selects[selectCall++] ?? []));
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  let insertCall = 0;
  const values = vi.fn((_values: unknown) => {
    const rows = inserts[insertCall++] ?? [];
    const returning = vi.fn().mockResolvedValue(rows);
    // Awaitable directly (the userPermissions insert is never chained with
    // .returning()) AND exposes .returning() (the tenant/user/pipeline
    // inserts are) — one mock shape covers both call sites in the script.
    return Object.assign(Promise.resolve(undefined), { returning });
  });
  const insert = vi.fn().mockReturnValue({ values });

  vi.doMock('../db/index', () => ({ db: { select, insert } }));
  return { select, insert, where, from, limit, values };
}

describe('ensureTenant', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates a new tenant with plan=reseller_pilot and features derived from PLAN_DEFAULTS when the slug does not exist', async () => {
    const { values, insert } = mockDb({ selects: [[]], inserts: [[{ id: 'new-tenant-id' }]] });
    const { ensureTenant } = await import(SCRIPT_PATH);

    const result = await ensureTenant({ name: 'Acme Marketing Co', slug: 'acme-marketing' });

    expect(result).toEqual({ id: 'new-tenant-id', alreadyExisted: false });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    // gstBilling is forced `true` explicitly by ensureTenant (src/services/
    // tenantProvisioning.ts) regardless of what PLAN_DEFAULTS.reseller_pilot
    // says — belt-and-suspenders so this holds independent of a sibling
    // change to PLAN_DEFAULTS itself. Every other flag still comes straight
    // from computeTenantFeatures('reseller_pilot', {}).
    expect(values.mock.calls[0][0]).toMatchObject({
      name: 'Acme Marketing Co',
      slug: 'acme-marketing',
      plan: 'reseller_pilot',
      isActive: true,
      settings: { features: { wizmatch: false, seo: false, crmAutomation: true, gstBilling: true, d2c: false } },
    });
  });

  it('reuses an existing tenant by slug instead of inserting a duplicate', async () => {
    const { insert } = mockDb({ selects: [[{ id: 'existing-tenant-id' }]] });
    const { ensureTenant } = await import(SCRIPT_PATH);

    const result = await ensureTenant({ name: 'Acme Marketing Co', slug: 'acme-marketing' });

    expect(result).toEqual({ id: 'existing-tenant-id', alreadyExisted: true });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('ensureOwnerUser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@node-rs/argon2', () => ({ hash: vi.fn().mockResolvedValue('mock-hashed-password') }));
  });

  it('creates an owner user (role=admin) + userPermissions.isOwner=true + a fresh generated password when none exists', async () => {
    const { values, insert } = mockDb({ selects: [[]], inserts: [[{ id: 'new-user-id' }], []] });
    const { ensureOwnerUser } = await import(SCRIPT_PATH);

    const result = await ensureOwnerUser({ tenantId: 'tenant-1', email: 'owner@acme.example', name: 'Jane Doe' });

    expect(result.alreadyExisted).toBe(false);
    expect(result.id).toBe('new-user-id');
    expect(typeof result.temporaryPassword).toBe('string');
    expect(result.temporaryPassword).toHaveLength(12);

    expect(insert).toHaveBeenCalledTimes(2); // users insert, then userPermissions insert
    expect(values).toHaveBeenCalledTimes(2);
    expect(values.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      name: 'Jane Doe',
      email: 'owner@acme.example',
      passwordHash: 'mock-hashed-password',
      role: 'admin',
      tokenVersion: 1,
    });
    expect(values.mock.calls[1][0]).toMatchObject({ userId: 'new-user-id', tenantId: 'tenant-1', isOwner: true });
  });

  it('does not mint a new password or duplicate the user when the owner email already exists for that tenant', async () => {
    const { insert } = mockDb({ selects: [[{ id: 'existing-user-id' }]] });
    const { ensureOwnerUser } = await import(SCRIPT_PATH);

    const result = await ensureOwnerUser({ tenantId: 'tenant-1', email: 'owner@acme.example', name: 'Jane Doe' });

    expect(result).toEqual({ id: 'existing-user-id', alreadyExisted: true, temporaryPassword: null });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('ensureDefaultPipeline', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates the default 5-stage pipeline when none exists for the tenant', async () => {
    const { values, insert } = mockDb({ selects: [[]], inserts: [[{ id: 'new-pipeline-id' }]] });
    const { ensureDefaultPipeline, DEFAULT_PIPELINE_STAGES, DEFAULT_PIPELINE_SLUG, DEFAULT_PIPELINE_NAME } = await import(SCRIPT_PATH);

    const result = await ensureDefaultPipeline('tenant-1');

    expect(result).toEqual({ id: 'new-pipeline-id', alreadyExisted: false });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      name: DEFAULT_PIPELINE_NAME,
      slug: DEFAULT_PIPELINE_SLUG,
      stages: DEFAULT_PIPELINE_STAGES,
      isActive: true,
      sortOrder: 0,
    });
  });

  it('reuses an existing pipeline with the same slug instead of duplicating it', async () => {
    const { insert } = mockDb({ selects: [[{ id: 'existing-pipeline-id' }]] });
    const { ensureDefaultPipeline } = await import(SCRIPT_PATH);

    const result = await ensureDefaultPipeline('tenant-1');

    expect(result).toEqual({ id: 'existing-pipeline-id', alreadyExisted: true });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('provisionResellerTenant (end-to-end orchestration, mocked db)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@node-rs/argon2', () => ({ hash: vi.fn().mockResolvedValue('mock-hashed-password') }));
  });

  it('wires ensureTenant -> ensureOwnerUser -> ensureDefaultPipeline and returns the one-time password when everything is freshly created', async () => {
    mockDb({
      selects: [[], [], []], // tenant lookup, owner lookup, pipeline lookup — all miss
      inserts: [
        [{ id: 'tenant-1' }], // tenant insert
        [{ id: 'user-1' }], // user insert
        [], // userPermissions insert
        [{ id: 'pipeline-1' }], // pipeline insert
      ],
    });
    const { provisionResellerTenant } = await import(SCRIPT_PATH);

    const result = await provisionResellerTenant({
      name: 'Acme Marketing Co',
      slug: 'acme-marketing',
      ownerEmail: 'owner@acme.example',
      ownerName: 'Jane Doe',
    });

    expect(result.tenant).toEqual({
      id: 'tenant-1', name: 'Acme Marketing Co', slug: 'acme-marketing', plan: 'reseller_pilot', alreadyExisted: false,
    });
    expect(result.owner).toEqual({
      id: 'user-1', email: 'owner@acme.example', name: 'Jane Doe', alreadyExisted: false,
    });
    expect(result.pipeline).toEqual({
      id: 'pipeline-1', name: 'Sales Pipeline', slug: 'sales', alreadyExisted: false,
    });
    expect(result.temporaryPassword).not.toBeNull();
    expect(typeof result.temporaryPassword).toBe('string');
  });

  it('is idempotent: re-running against an already-provisioned tenant reuses every row and mints no new password', async () => {
    const { insert } = mockDb({
      selects: [
        [{ id: 'tenant-1' }], // tenant already exists
        [{ id: 'user-1' }], // owner already exists
        [{ id: 'pipeline-1' }], // pipeline already exists
      ],
      inserts: [],
    });
    const { provisionResellerTenant } = await import(SCRIPT_PATH);

    const result = await provisionResellerTenant({
      name: 'Acme Marketing Co',
      slug: 'acme-marketing',
      ownerEmail: 'owner@acme.example',
      ownerName: 'Jane Doe',
    });

    expect(result.tenant.alreadyExisted).toBe(true);
    expect(result.owner.alreadyExisted).toBe(true);
    expect(result.pipeline.alreadyExisted).toBe(true);
    expect(result.temporaryPassword).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});
