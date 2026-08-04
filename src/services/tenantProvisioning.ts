/**
 * Reseller-tenant provisioning — core, reusable logic.
 *
 * Originally lived entirely inside scripts/onboarding/provisionResellerTenant.ts
 * as a hand-run, one-at-a-time CLI (Phase 2 of the white-label reseller plan).
 * Extracted here so the SAME logic can be called from two places without
 * duplication:
 *   1. The CLI script (scripts/onboarding/provisionResellerTenant.ts), now a
 *      thin argv-parsing + console-printing wrapper around this module.
 *   2. POST /api/platform/tenants (src/routes/platformTenants.ts) — lets a
 *      platform superadmin do the same provisioning from the admin panel
 *      instead of a terminal.
 *
 * Creates, idempotently (safe to call twice with the same slug):
 *   1. The `tenants` row, plan = 'reseller_pilot' (src/services/tenantFeatures.ts
 *      PLAN_DEFAULTS: crmAutomation on, wizmatch/seo/d2c off). `gstBilling` is
 *      forced `true` explicitly at creation time (see ensureTenant below) —
 *      deliberately NOT left to PLAN_DEFAULTS alone.
 *   2. An owner user for the tenant — role 'admin', userPermissions.isOwner =
 *      true, password auto-generated and returned ONCE for manual handoff —
 *      same convention as POST /api/permissions/users
 *      (src/routes/permissions.ts), reusing its generatePassword() helper
 *      (src/utils/password.ts) rather than inventing a second approach.
 *   3. A default starter pipeline, so the tenant doesn't land on a
 *      completely empty Pipeline Manager on first login. Reuses the exact
 *      5-stage template the admin "New Pipeline" modal defaults to
 *      (admin/src/pages/PipelineManagerPage.jsx DEFAULT_STAGES), run through
 *      the backend's serializePipelineStages() so ids/colors/outcomes are
 *      computed identically to POST /api/pipelines.
 */
import { hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenants, users, userPermissions, pipelines } from '../db/schema';
import { computeTenantFeatures } from './tenantFeatures';
import { serializePipelineStages } from './pipelineStages';
import { generatePassword } from '../utils/password';

export const RESELLER_PILOT_PLAN = 'reseller_pilot';

// Lowercase letters/digits separated by single hyphens — matches every
// existing tenant slug in this repo (e.g. 'growth-escalators', 'wizmatch'):
// no leading/trailing hyphen, no consecutive hyphens, no uppercase/underscore.
export const TENANT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MIN_SLUG_LENGTH = 2;
export const MAX_SLUG_LENGTH = 63;

// Same pattern src/routes/permissions.ts's POST /users route (and
// src/routes/tenantBranding.ts) validate email against.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export function validateTenantSlug(slug: string): void {
  if (slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`tenant slug must be ${MIN_SLUG_LENGTH}-${MAX_SLUG_LENGTH} characters, got ${slug.length} ("${slug}")`);
  }
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `invalid tenant slug "${slug}" — must be lowercase letters/digits separated by single hyphens ` +
      `(e.g. "acme-marketing"), matching existing tenant slug conventions (growth-escalators, wizmatch)`,
    );
  }
}

// The exact login-link pattern the CLI script has printed since reseller
// readiness (2026-08): auth.ts's login now looks the tenant slug up against
// the tenants table instead of folding every unrecognised slug to Growth
// Escalators (see src/__tests__/authResellerTenantSlug.test.ts), so this is
// the actual, working login link for a freshly provisioned owner
// (admin/src/pages/LoginPage.jsx reads `?tenant=` via getTenantSlug in
// admin/src/lib/auth.js). Shared here so the CLI's console output and the
// HTTP route's JSON response can never drift apart.
export function loginUrlForSlug(slug: string): string {
  return `https://crm.growthescalators.com/login?tenant=${slug}`;
}

// Default starter pipeline — the exact stage template the admin UI's
// "New Pipeline" modal defaults new-, from-scratch pipelines to
// (admin/src/pages/PipelineManagerPage.jsx DEFAULT_STAGES), so a reseller
// pilot's first-login experience matches what any admin user already gets
// when they create a fresh pipeline by hand.
export const DEFAULT_PIPELINE_NAME = 'Sales Pipeline';
export const DEFAULT_PIPELINE_SLUG = 'sales';
export const DEFAULT_PIPELINE_STAGE_NAMES = ['New Lead', 'Contacted', 'Proposal Sent', 'Won', 'Lost'];
export const DEFAULT_PIPELINE_STAGES = serializePipelineStages(DEFAULT_PIPELINE_STAGE_NAMES);
export const DEFAULT_PIPELINE_COLOR = '#F97316'; // matches schema default + admin modal default

export interface EnsureTenantInput {
  name: string;
  slug: string;
}
export interface EnsureTenantResult {
  id: string;
  alreadyExisted: boolean;
}

/** Idempotent: reuses an existing tenant row by slug instead of erroring or duplicating it. */
export async function ensureTenant(input: EnsureTenantInput): Promise<EnsureTenantResult> {
  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
  if (existing) return { id: existing.id, alreadyExisted: true };

  const [created] = await db
    .insert(tenants)
    .values({
      name: input.name,
      slug: input.slug,
      plan: RESELLER_PILOT_PLAN,
      isActive: true,
      // Derived from PLAN_DEFAULTS via computeTenantFeatures — same approach
      // src/db/seed.ts uses — so this can never drift from what
      // getTenantFeatures() would already fall back to for this plan, EXCEPT
      // gstBilling, which is forced `true` explicitly here rather than left
      // to PLAN_DEFAULTS. Belt-and-suspenders: a sibling change may also be
      // flipping PLAN_DEFAULTS.reseller_pilot.gstBilling to `true` in
      // src/services/tenantFeatures.ts — this explicit override makes THIS
      // function correct regardless of merge order with that change, and a
      // no-op once/if the two agree.
      settings: { features: { ...computeTenantFeatures(RESELLER_PILOT_PLAN, {}), gstBilling: true } },
    })
    .returning({ id: tenants.id });
  return { id: created.id, alreadyExisted: false };
}

export interface EnsureOwnerUserInput {
  tenantId: string;
  email: string;
  name: string;
}
export interface EnsureOwnerUserResult {
  id: string;
  alreadyExisted: boolean;
  /** null when the user already existed — no new password was minted. */
  temporaryPassword: string | null;
}

/**
 * Idempotent: reuses an existing user (by tenant + email) instead of
 * duplicating it or rotating its password. Role 'admin' +
 * userPermissions.isOwner = true — same shape POST /api/permissions/users
 * creates a team member with, except isOwner is set true directly here
 * rather than defaulting to false (this IS the tenant's first/owner user).
 */
export async function ensureOwnerUser(input: EnsureOwnerUserInput): Promise<EnsureOwnerUserResult> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), eq(users.email, input.email)))
    .limit(1);
  if (existing) return { id: existing.id, alreadyExisted: true, temporaryPassword: null };

  const temporaryPassword = generatePassword();
  const passwordHash = await hash(temporaryPassword);

  const [created] = await db
    .insert(users)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'admin',
      tokenVersion: 1,
    })
    .returning({ id: users.id });

  await db.insert(userPermissions).values({
    userId: created.id,
    tenantId: input.tenantId,
    isOwner: true,
  });

  return { id: created.id, alreadyExisted: false, temporaryPassword };
}

export interface EnsureDefaultPipelineResult {
  id: string;
  alreadyExisted: boolean;
}

/** Idempotent: reuses an existing pipeline with the same slug for this tenant. */
export async function ensureDefaultPipeline(tenantId: string): Promise<EnsureDefaultPipelineResult> {
  const [existing] = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.slug, DEFAULT_PIPELINE_SLUG)))
    .limit(1);
  if (existing) return { id: existing.id, alreadyExisted: true };

  const [created] = await db
    .insert(pipelines)
    .values({
      tenantId,
      name: DEFAULT_PIPELINE_NAME,
      slug: DEFAULT_PIPELINE_SLUG,
      stages: DEFAULT_PIPELINE_STAGES,
      color: DEFAULT_PIPELINE_COLOR,
      isActive: true,
      sortOrder: 0,
    })
    .returning({ id: pipelines.id });
  return { id: created.id, alreadyExisted: false };
}

export interface ProvisionResellerTenantInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
}

export interface ProvisionResellerTenantResult {
  tenant: { id: string; name: string; slug: string; plan: string; alreadyExisted: boolean };
  owner: { id: string; email: string; name: string; alreadyExisted: boolean };
  pipeline: { id: string; name: string; slug: string; alreadyExisted: boolean };
  /** null when the owner user already existed — no new password was minted. */
  temporaryPassword: string | null;
}

export async function provisionResellerTenant(args: ProvisionResellerTenantInput): Promise<ProvisionResellerTenantResult> {
  const tenant = await ensureTenant({ name: args.name, slug: args.slug });
  const owner = await ensureOwnerUser({ tenantId: tenant.id, email: args.ownerEmail, name: args.ownerName });
  const pipeline = await ensureDefaultPipeline(tenant.id);

  return {
    tenant: { id: tenant.id, name: args.name, slug: args.slug, plan: RESELLER_PILOT_PLAN, alreadyExisted: tenant.alreadyExisted },
    owner: { id: owner.id, email: args.ownerEmail, name: args.ownerName, alreadyExisted: owner.alreadyExisted },
    pipeline: {
      id: pipeline.id,
      name: DEFAULT_PIPELINE_NAME,
      slug: DEFAULT_PIPELINE_SLUG,
      alreadyExisted: pipeline.alreadyExisted,
    },
    temporaryPassword: owner.temporaryPassword,
  };
}
