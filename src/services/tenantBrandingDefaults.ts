import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index';
import { tenantBranding, tenants } from '../db/schema';
import { DEFAULT_TENANT_SLUG } from '../config/constants';
import logger from '../utils/logger';

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
// Legal / financial identity — the fields client-facing documents (invoices,
// performance report PDFs) render instead of the old hardcoded Growth
// Escalators literals. All nullable in the DB: a tenant that hasn't filled
// these in must not silently inherit Growth Escalators' identity, so the
// invoice/report routes in src/routes/billing.ts and src/routes/reports.ts
// block document generation instead of falling back — see
// isBillingIdentityConfigured below.
// ---------------------------------------------------------------------------
export interface TenantBillingIdentity {
  legalEntityName: string | null;
  registeredAddress: string | null;
  gstin: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  website: string | null;
}

// Everything a client-facing document needs about a tenant, in one row read:
// the existing branding chrome (name/colors) plus the legal/financial
// identity above.
export interface TenantDocumentIdentity extends TenantBillingIdentity {
  displayName: string;
  primaryColor: string | null;
  accentColor: string | null;
}

// ---------------------------------------------------------------------------
// The default tenant's (DEFAULT_TENANT_SLUG) own legal/financial identity is
// read ENTIRELY from environment configuration — never hardcoded in source.
// This repo is public; hardcoding that tenant's real registered address,
// GSTIN, or bank details as literals here would put them in git history,
// which is exactly the class of leak this whole change set exists to close.
//
// Every var is independently optional: seedTenantBrandingDefaults below
// writes only the fields whose var is actually set, and logs a startup WARN
// naming exactly which vars are missing. An unset legalEntityName/
// registeredAddress means that tenant's own invoice/report generation is
// blocked by isBillingIdentityConfigured — same as any other unconfigured
// tenant, deliberately not special-cased. Set these in the deployment
// environment (see .env.example) before this ships to a live default
// tenant that issues real invoices.
// ---------------------------------------------------------------------------
const DEFAULT_TENANT_ENV_VARS: Record<keyof TenantBillingIdentity, string> = {
  legalEntityName: 'DEFAULT_TENANT_LEGAL_NAME',
  registeredAddress: 'DEFAULT_TENANT_REGISTERED_ADDRESS',
  gstin: 'DEFAULT_TENANT_GSTIN',
  bankName: 'DEFAULT_TENANT_BANK_NAME',
  bankAccountName: 'DEFAULT_TENANT_BANK_ACCOUNT_NAME',
  bankAccountNumber: 'DEFAULT_TENANT_BANK_ACCOUNT_NUMBER',
  bankIfsc: 'DEFAULT_TENANT_BANK_IFSC',
  supportEmail: 'DEFAULT_TENANT_SUPPORT_EMAIL',
  supportPhone: 'DEFAULT_TENANT_SUPPORT_PHONE',
  website: 'DEFAULT_TENANT_WEBSITE',
};

function readDefaultTenantIdentityFromEnv(): { values: Partial<TenantBillingIdentity>; missingEnvVars: string[] } {
  const values: Partial<TenantBillingIdentity> = {};
  const missingEnvVars: string[] = [];
  for (const [field, envVar] of Object.entries(DEFAULT_TENANT_ENV_VARS) as Array<[keyof TenantBillingIdentity, string]>) {
    const raw = process.env[envVar];
    if (raw && raw.trim()) {
      values[field] = raw.trim();
    } else {
      missingEnvVars.push(envVar);
    }
  }
  return { values, missingEnvVars };
}

// ---------------------------------------------------------------------------
// Idempotent startup bootstrap — inserts a default branding row for every
// tenant that doesn't already have one. Safe to run on every cold start
// (relies on the unique index on tenant_branding.tenant_id to no-op on a
// second insert attempt for the same tenant).
//
// Also backfills the default tenant's legal/financial identity onto its
// row from the DEFAULT_TENANT_* env vars above — additive columns introduced
// by the reseller-readiness fix start out null even for a tenant that already
// had a tenant_branding row (the insert above is a no-op for it). Two
// deliberate safety properties, since getting this wrong would newly BLOCK
// that tenant's real invoice generation instead of fixing the bug:
//   1. Only fields whose env var is actually set are written — a partially
//      configured deployment doesn't clobber the rest with nulls/undefined.
//   2. The write only ever happens once: it's gated on legalEntityName still
//      being null, so a later deploy where an env var goes missing (or the
//      row was since hand-edited via the Branding settings page) can never
//      overwrite what's already there.
// ---------------------------------------------------------------------------
export async function seedTenantBrandingDefaults(): Promise<void> {
  const tenantRows = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants);
  for (const t of tenantRows) {
    const defaults = getDefaultBrandingForSlug(t.slug);
    await db
      .insert(tenantBranding)
      .values({ tenantId: t.id, ...defaults })
      .onConflictDoNothing({ target: tenantBranding.tenantId });

    if (t.slug === DEFAULT_TENANT_SLUG) {
      const { values, missingEnvVars } = readDefaultTenantIdentityFromEnv();
      if (missingEnvVars.length > 0) {
        logger.warn(
          `[tenant-branding] default tenant (${DEFAULT_TENANT_SLUG}) billing identity: env var(s) not set — ${missingEnvVars.join(', ')}. ` +
          'That tenant\'s own invoice/report generation will be blocked or incomplete for the affected fields until these are configured — see .env.example.',
        );
      }
      if (Object.keys(values).length > 0) {
        await db
          .update(tenantBranding)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(tenantBranding.tenantId, t.id), isNull(tenantBranding.legalEntityName)));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Read path for client-facing document generation (billing.ts, reports.ts).
// Returns null when the tenant has no tenant_branding row at all yet (seed
// hasn't run against this environment / brand-new tenant) — callers treat
// that the same as "not configured".
// ---------------------------------------------------------------------------
export async function getTenantDocumentIdentity(tenantId: string): Promise<TenantDocumentIdentity | null> {
  const [row] = await db
    .select({
      displayName: tenantBranding.displayName,
      primaryColor: tenantBranding.primaryColor,
      accentColor: tenantBranding.accentColor,
      legalEntityName: tenantBranding.legalEntityName,
      registeredAddress: tenantBranding.registeredAddress,
      gstin: tenantBranding.gstin,
      bankName: tenantBranding.bankName,
      bankAccountName: tenantBranding.bankAccountName,
      bankAccountNumber: tenantBranding.bankAccountNumber,
      bankIfsc: tenantBranding.bankIfsc,
      supportEmail: tenantBranding.supportEmail,
      supportPhone: tenantBranding.supportPhone,
      website: tenantBranding.website,
    })
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// The gate for "does this tenant have enough billing identity configured to
// generate a client-facing invoice" — the fix for the bug this change set
// out to close: a tenant with nothing configured must not silently render
// Growth Escalators' identity onto their client's invoice.
//
// legalEntityName + registeredAddress are required for every invoice (they
// render in the header regardless of GST/non-GST). requireGstBankDetails
// additionally requires gstin + full bank details — pdfService only ever
// renders a bank-details block for invoiceType='gst' (non-GST invoices use a
// freeform per-invoice paymentNote instead), so non-GST invoices don't need
// them. requireSupportEmail is separate again: only the invoice-email route
// needs it (as the "from" address) — PDF download/creation don't send an
// email at all, so they leave it false rather than block a tenant that only
// wants PDFs from also having to fill in a support email.
// ---------------------------------------------------------------------------
export function isBillingIdentityConfigured(
  identity: TenantDocumentIdentity | TenantBillingIdentity | null,
  opts: { requireGstBankDetails: boolean; requireSupportEmail?: boolean },
): boolean {
  if (!identity?.legalEntityName?.trim() || !identity?.registeredAddress?.trim()) return false;
  if (opts.requireGstBankDetails) {
    if (!identity.gstin?.trim()) return false;
    if (!identity.bankName?.trim() || !identity.bankAccountName?.trim()) return false;
    if (!identity.bankAccountNumber?.trim() || !identity.bankIfsc?.trim()) return false;
  }
  if (opts.requireSupportEmail && !identity.supportEmail?.trim()) return false;
  return true;
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

// ---------------------------------------------------------------------------
// Short tenant code derivation — used to build tenant-scoped document-number
// prefixes/segments (the invoice series prefix in invoiceNumberService.ts,
// and the retainer-number tenant segment in retainerService.ts) instead of
// the literal 'GE' both previously hardcoded regardless of tenant.
//
// There is no dedicated short-code column on tenant_branding today (checked
// the schema before adding this — see src/db/schema.ts's tenantBranding
// table) so this derives one from displayName rather than adding a new
// column/migration for it. Growth Escalators' own displayName ("Growth
// Escalators") already derives to "GE" — the exact literal both series used
// before this existed — so the default tenant's numbering is unchanged.
//
// This is a readability aid, NOT a uniqueness guarantee: two tenants with
// identical or initials-colliding display names derive the same code. That
// residual risk is accepted here (see retainerService.ts's getNextRetainerNumber
// and invoiceNumberService.ts for the specific tradeoffs at each call site) —
// closing it completely would mean scoping the underlying UNIQUE constraints
// by tenant_id, which is a schema/migration change and out of scope for this
// fix per AGENTS.md (schema changes need their own explicit sign-off).
// ---------------------------------------------------------------------------
export function deriveTenantShortCode(displayName: string | null | undefined): string {
  const name = (displayName || '').trim();
  if (!name) return 'TEN';
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).filter(Boolean).join('').toUpperCase();
    return initials.slice(0, 4) || 'TEN';
  }
  const alnum = name.replace(/[^a-zA-Z0-9]/g, '');
  return (alnum.slice(0, 3) || 'TEN').toUpperCase();
}

// Resolves a tenant's short code from its configured tenant_branding
// identity, falling back to the slug-based branding default (or the generic
// placeholder) when no tenant_branding row / displayName exists yet —
// mirrors the same fallback chain this file's other callers already use
// (getDefaultBrandingForSlug / GENERIC_DEFAULT_BRANDING).
export async function resolveTenantShortCode(tenantId: string): Promise<string> {
  const identity = await getTenantDocumentIdentity(tenantId);
  if (identity?.displayName?.trim()) return deriveTenantShortCode(identity.displayName);
  const slug = await getTenantSlugById(tenantId);
  const fallbackName = slug ? getDefaultBrandingForSlug(slug).displayName : GENERIC_DEFAULT_BRANDING.displayName;
  return deriveTenantShortCode(fallbackName);
}
