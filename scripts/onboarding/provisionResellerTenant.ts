/**
 * Reseller-tenant onboarding — Day-0 provisioning script.
 *
 * Phase 2 of the white-label reseller plan: pilot agencies are provisioned
 * ONE AT A TIME, by hand, by an owner running this script — there is no
 * self-serve signup and no HTTP route for this. That's deliberate; self-serve
 * is a later phase.
 *
 * Creates, idempotently (safe to re-run against the same slug):
 *   1. The `tenants` row, plan = 'reseller_pilot' (src/services/tenantFeatures.ts
 *      PLAN_DEFAULTS: crmAutomation on, wizmatch/seo/gstBilling/d2c off).
 *   2. An owner user for the tenant — role 'admin', userPermissions.isOwner =
 *      true, password auto-generated and printed ONCE for manual handoff —
 *      same convention as POST /api/permissions/users
 *      (src/routes/permissions.ts), reusing its generatePassword() helper
 *      (extracted to src/utils/password.ts) rather than inventing a second
 *      approach.
 *   3. A default starter pipeline, so the tenant doesn't land on a
 *      completely empty Pipeline Manager on first login. Reuses the exact
 *      5-stage template the admin "New Pipeline" modal defaults to
 *      (admin/src/pages/PipelineManagerPage.jsx DEFAULT_STAGES), run through
 *      the backend's serializePipelineStages() so ids/colors/outcomes are
 *      computed identically to POST /api/pipelines.
 *
 * Usage:
 *   npx tsx scripts/onboarding/provisionResellerTenant.ts \
 *     "<Tenant Display Name>" <tenant-slug> <owner-email> [owner-name]
 *
 * Example:
 *   npx tsx scripts/onboarding/provisionResellerTenant.ts \
 *     "Acme Marketing Co" acme-marketing owner@acmemarketing.example "Jane Doe"
 *
 * After running, share the printed owner email + temporary password with the
 * agency owner through a secure channel — it is shown exactly once.
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../../src/db/index';
// Table objects come from db/schema.ts (pure Drizzle table defs, no side
// effects) rather than db/index.ts (which also constructs the live pg Pool)
// — same split src/services/tenantFeatures.ts uses, which is what makes
// mocking just `{ db }` in tests sufficient without touching the pool.
import { tenants, users, userPermissions, pipelines } from '../../src/db/schema';
import { computeTenantFeatures } from '../../src/services/tenantFeatures';
import { serializePipelineStages } from '../../src/services/pipelineStages';
import { generatePassword } from '../../src/utils/password';

export const RESELLER_PILOT_PLAN = 'reseller_pilot';

// Lowercase letters/digits separated by single hyphens — matches every
// existing tenant slug in this repo (e.g. 'growth-escalators', 'wizmatch'):
// no leading/trailing hyphen, no consecutive hyphens, no uppercase/underscore.
export const TENANT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_SLUG_LENGTH = 2;
const MAX_SLUG_LENGTH = 63;

// Same pattern src/routes/permissions.ts's POST /users route validates
// email against.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export interface ProvisionCliArgs {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
}

export function parseCliArgs(argv: string[]): ProvisionCliArgs {
  const [rawName, rawSlug, rawOwnerEmail, rawOwnerName] = argv;

  const name = rawName?.trim();
  if (!name) {
    throw new Error('tenant display name is required (arg 1) — usage: provisionResellerTenant.ts <name> <slug> <ownerEmail> [ownerName]');
  }

  const slug = rawSlug?.trim();
  if (!slug) {
    throw new Error('tenant slug is required (arg 2) — usage: provisionResellerTenant.ts <name> <slug> <ownerEmail> [ownerName]');
  }
  validateTenantSlug(slug);

  const ownerEmail = rawOwnerEmail?.trim().toLowerCase();
  if (!ownerEmail || !EMAIL_PATTERN.test(ownerEmail)) {
    throw new Error('a valid owner email is required (arg 3) — usage: provisionResellerTenant.ts <name> <slug> <ownerEmail> [ownerName]');
  }

  const ownerName = rawOwnerName?.trim() || 'Owner';

  return { name, slug, ownerEmail, ownerName };
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
      // getTenantFeatures() would already fall back to for this plan.
      settings: { features: computeTenantFeatures(RESELLER_PILOT_PLAN, {}) },
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

export interface ProvisionResellerTenantResult {
  tenant: { id: string; name: string; slug: string; plan: string; alreadyExisted: boolean };
  owner: { id: string; email: string; name: string; alreadyExisted: boolean };
  pipeline: { id: string; name: string; slug: string; alreadyExisted: boolean };
  /** null when the owner user already existed — no new password was minted. */
  temporaryPassword: string | null;
}

export async function provisionResellerTenant(args: ProvisionCliArgs): Promise<ProvisionResellerTenantResult> {
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

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  console.log(`Provisioning reseller-pilot tenant "${args.name}" (${args.slug})...\n`);

  const result = await provisionResellerTenant(args);

  console.log('═══════════════════════════════════════════════════');
  console.log('  RESELLER TENANT PROVISIONED');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Tenant:       ${result.tenant.name} (${result.tenant.slug})`);
  console.log(`  Tenant ID:    ${result.tenant.id}${result.tenant.alreadyExisted ? '  (already existed — reused)' : ''}`);
  console.log(`  Plan:         ${result.tenant.plan}`);
  // Reseller readiness (2026-08) — auth.ts login now looks the tenant slug
  // up against the tenants table instead of folding every unrecognised slug
  // to Growth Escalators, so this is the actual, working login link for the
  // freshly provisioned owner (admin/src/pages/LoginPage.jsx reads `?tenant=`
  // via getTenantSlug in admin/src/lib/auth.js).
  console.log(`  Login URL:    https://crm.growthescalators.com/login?tenant=${result.tenant.slug}`);
  console.log(`  Owner email:  ${result.owner.email}`);
  if (result.temporaryPassword) {
    console.log(`  Owner pass:   ${result.temporaryPassword}`);
    console.log('  ⚠️  Share this password securely with the tenant owner ONCE.');
    console.log('      They can change it any time via "Forgot password" on the login page.');
  } else {
    console.log('  Owner user already existed — no new password minted.');
  }
  console.log(
    `  Pipeline:     ${result.pipeline.name} (${result.pipeline.slug})` +
    `${result.pipeline.alreadyExisted ? '  (already existed — reused)' : ''}`,
  );
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
  process.exit(0);
}

// Guards the CLI entrypoint so importing this module (e.g. from a test) does
// not itself hit the database — same pattern as
// scripts/onboarding/tenant-features-backfill.ts.
if (require.main === module) {
  main().catch((err) => {
    console.error('Provisioning failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
