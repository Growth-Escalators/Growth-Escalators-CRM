import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenantBranding, tenants } from '../db/schema';

// ---------------------------------------------------------------------------
// Default branding values, keyed by tenant slug.
//
// growth-escalators and wizmatch get their real, currently-hardcoded-in-the-
// admin-SPA branding (colors pulled from src/services/pdfService.ts's GE
// palette and src/config/constants.ts's WIZMATCH_BRAND_ACCENT, so the seeded
// row matches what's already on screen today — this feature is meant to be a
// no-op for existing tenants until someone edits it).
//
// Any other tenant (a new reseller/pilot client) gets GENERIC_DEFAULT: a
// clearly-placeholder name, a neutral color pair, and no logo — logoUrl/
// faviconUrl null means the admin SPA falls back to the built-in GE mark
// asset rather than rendering a broken <img>.
// ---------------------------------------------------------------------------
export interface TenantBrandingDefaults {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  faviconUrl: string | null;
}

export const GENERIC_DEFAULT_BRANDING: TenantBrandingDefaults = {
  displayName: 'Client Workspace',
  logoUrl: null,
  primaryColor: '#334155', // neutral slate — no brand color chosen yet
  accentColor: '#64748b',
  faviconUrl: null,
};

const DEFAULTS_BY_SLUG: Record<string, TenantBrandingDefaults> = {
  'growth-escalators': {
    displayName: 'Growth Escalators',
    logoUrl: '/ge-mark.png',
    primaryColor: '#1A3A5C',
    accentColor: '#F97316',
    faviconUrl: '/favicon.svg',
  },
  wizmatch: {
    displayName: 'Wizmatch',
    // No dedicated Wizmatch mark asset exists in the repo yet — null falls
    // back to the GE mark client-side until one is designed.
    logoUrl: null,
    primaryColor: '#1e3a8a',
    accentColor: '#3b82f6', // matches WIZMATCH_BRAND_ACCENT in src/config/constants.ts
    faviconUrl: null,
  },
};

export function getDefaultBrandingForSlug(slug: string): TenantBrandingDefaults {
  return DEFAULTS_BY_SLUG[slug] || GENERIC_DEFAULT_BRANDING;
}

// ---------------------------------------------------------------------------
// Idempotent startup bootstrap — inserts a default branding row for every
// tenant that doesn't already have one. Safe to run on every cold start
// (relies on the unique index on tenant_branding.tenant_id to no-op on a
// second insert attempt for the same tenant).
// ---------------------------------------------------------------------------
export async function seedTenantBrandingDefaults(): Promise<void> {
  const tenantRows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants);
  for (const t of tenantRows) {
    const defaults = getDefaultBrandingForSlug(t.slug);
    await db
      .insert(tenantBranding)
      .values({ tenantId: t.id, ...defaults })
      .onConflictDoNothing({ target: tenantBranding.tenantId });
  }
}

// ---------------------------------------------------------------------------
// Lookup used by the GET route to serve a sensible response for a tenant that
// doesn't have a tenant_branding row yet (e.g. the seed hasn't run against
// this environment, or the tenant was created after this feature shipped).
// ---------------------------------------------------------------------------
export async function getTenantSlugById(tenantId: string): Promise<string | undefined> {
  const [row] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return row?.slug;
}
