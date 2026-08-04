/**
 * Reseller-tenant onboarding — Day-0 provisioning script.
 *
 * Phase 2 of the white-label reseller plan: pilot agencies are provisioned
 * ONE AT A TIME, by an owner running this script OR — as of the platform
 * superadmin panel (src/routes/platformTenants.ts, admin/src/pages/
 * ProvisionTenantPage.jsx) — from the admin frontend instead. Either entry
 * point calls the exact same core logic in src/services/tenantProvisioning.ts;
 * this file is now just an argv-parsing + console-printing wrapper around it,
 * so the two paths can never drift apart. There is still no self-serve
 * signup — both entry points require a human with platform-superadmin (or
 * terminal) access.
 *
 * Creates, idempotently (safe to re-run against the same slug):
 *   1. The `tenants` row, plan = 'reseller_pilot' (src/services/tenantFeatures.ts
 *      PLAN_DEFAULTS: crmAutomation on, wizmatch/seo/d2c off; gstBilling is
 *      forced on explicitly — see tenantProvisioning.ts's ensureTenant).
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
import { pool } from '../../src/db/index';
import {
  RESELLER_PILOT_PLAN,
  TENANT_SLUG_PATTERN,
  EMAIL_PATTERN,
  validateTenantSlug,
  loginUrlForSlug,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_SLUG,
  DEFAULT_PIPELINE_STAGE_NAMES,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_COLOR,
  ensureTenant,
  ensureOwnerUser,
  ensureDefaultPipeline,
  provisionResellerTenant,
  type ProvisionResellerTenantInput,
  type EnsureTenantInput,
  type EnsureTenantResult,
  type EnsureOwnerUserInput,
  type EnsureOwnerUserResult,
  type EnsureDefaultPipelineResult,
  type ProvisionResellerTenantResult,
} from '../../src/services/tenantProvisioning';

// Re-exported so existing importers (e.g. src/__tests__/provisionResellerTenant.test.ts)
// and any other script keep working unchanged — the core logic now lives in
// src/services/tenantProvisioning.ts (see that file's header comment), this
// script is a thin wrapper around it.
export {
  RESELLER_PILOT_PLAN,
  TENANT_SLUG_PATTERN,
  validateTenantSlug,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_SLUG,
  DEFAULT_PIPELINE_STAGE_NAMES,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_COLOR,
  ensureTenant,
  ensureOwnerUser,
  ensureDefaultPipeline,
  provisionResellerTenant,
};
export type {
  EnsureTenantInput,
  EnsureTenantResult,
  EnsureOwnerUserInput,
  EnsureOwnerUserResult,
  EnsureDefaultPipelineResult,
  ProvisionResellerTenantResult,
};

/** CLI-args shape — same fields as ProvisionResellerTenantInput, kept as its own name for this file's own readability. */
export type ProvisionCliArgs = ProvisionResellerTenantInput;

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
  console.log(`  Login URL:    ${loginUrlForSlug(result.tenant.slug)}`);
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
