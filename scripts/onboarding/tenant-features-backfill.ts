/**
 * Tenant-feature-gating PR — OPTIONAL backfill making `tenants.settings.features`
 * explicit for the 3 known tenants (growth-escalators / wizmatch / a
 * client-basic tenant, referred to by slug only).
 *
 * IMPORTANT: this is NOT required for correct behavior. src/services/tenantFeatures.ts's
 * getTenantFeatures() already falls back to a per-plan default table
 * (PLAN_DEFAULTS) whenever `settings.features` is empty — which is the state
 * of every tenant row in production today. That fallback table is
 * hand-verified to reproduce EXACTLY what's true today via the global
 * env-var flags (see the PR description / tenantFeatures.ts comments for the
 * evidence per flag). Running this script only makes that behavior explicit
 * in the row instead of implicit in code — it changes no observable
 * behavior for these 3 tenants either way.
 *
 * Run this once a NEW tenant's plan doesn't cover its features cleanly, or
 * to make the 3 existing rows self-documenting. The target values below are
 * DERIVED via computeTenantFeatures(plan, {}) from
 * src/services/tenantFeatures.ts's PLAN_DEFAULTS — the same function
 * src/db/seed.ts uses — so this script can never drift from what the app
 * itself would already fall back to for an unmigrated tenant.
 *
 * SAFE BY DEFAULT: exits without writing anything unless --apply is passed.
 * Idempotent: a second --apply run against an already-backfilled tenant
 * writes the exact same value (jsonb_set is not additive-only churn).
 *
 * Usage (dry run — the only mode this session may execute):
 *   DATABASE_URL=... npm run tenant-features:backfill
 *
 * Usage (apply — requires explicit owner approval per AGENTS.md /
 * ge-prod-data-mutation; NEVER run this against production from an agent
 * session without that sign-off):
 *   DATABASE_URL=... npm run tenant-features:backfill -- --apply
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { computeTenantFeatures, type TenantFeatureFlags } from '../../src/services/tenantFeatures';

export interface TenantFeatureSeed {
  slug: string;
  features: TenantFeatureFlags;
}

// slug -> plan for the 3 tenants that exist today (src/db/seed.ts uses the
// same mapping). `features` is derived below, never hardcoded twice.
const SLUG_TO_PLAN: Record<string, string> = {
  'growth-escalators': 'agency_internal',
  wizmatch: 'wizmatch_internal',
  'city-clinic': 'client_basic',
};

export const TENANT_FEATURE_SEEDS: TenantFeatureSeed[] = Object.entries(SLUG_TO_PLAN).map(
  ([slug, plan]) => ({ slug, features: computeTenantFeatures(plan, {}) }),
);

export async function fetchCurrentSettings(
  pool: Pool,
  slug: string,
): Promise<{ id: string; plan: string | null; settings: unknown } | null> {
  const result = await pool.query<{ id: string; plan: string | null; settings: unknown }>(
    `SELECT id, plan, settings FROM tenants WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return result.rows[0] ?? null;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const apply = process.argv.includes('--apply');

  const pool = new Pool({ connectionString });
  try {
    const plan: Array<{ slug: string; found: boolean; before: unknown; after: TenantFeatureFlags }> = [];
    for (const seed of TENANT_FEATURE_SEEDS) {
      const current = await fetchCurrentSettings(pool, seed.slug);
      plan.push({
        slug: seed.slug,
        found: Boolean(current),
        before: current?.settings ?? null,
        after: seed.features,
      });
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', plan }, null, 2));

    if (!apply) {
      console.log('\nDry run only — no row written. Pass --apply (with explicit owner approval) to write.');
      return;
    }

    for (const seed of TENANT_FEATURE_SEEDS) {
      await pool.query(
        `UPDATE tenants
         SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{features}', $2::jsonb, true)
         WHERE slug = $1`,
        [seed.slug, JSON.stringify(seed.features)],
      );
    }
    console.log(`\nApplied — ${TENANT_FEATURE_SEEDS.length} tenant(s) updated.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[tenant-features backfill] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
