export const TENANTS = {
  'growth-escalators': {
    slug: 'growth-escalators',
    label: 'Growth Escalators',
    shortLabel: 'GE',
    subtitle: 'CRM Dashboard',
    storagePrefix: 'ge_crm',
  },
  wizmatch: {
    slug: 'wizmatch',
    label: 'Wizmatch',
    shortLabel: 'WM',
    subtitle: 'Operating Dashboard',
    storagePrefix: 'wizmatch_crm',
  },
};

export const TENANT_OPTIONS = Object.values(TENANTS);

// Reseller readiness (2026-08) — this USED to fold every slug that wasn't
// 'wizmatch'/'wm' down to 'growth-escalators', so a reseller's own
// `?tenant=acme-media` link rendered as (and authenticated against) Growth
// Escalators' tenant. Only fold the two products' own aliases now; anything
// else passes through unchanged (lowercased/trimmed) so arbitrary reseller
// slugs work end to end. Absent/empty input still defaults to
// 'growth-escalators' — the no-slug-supplied case is unchanged.
export function normalizeTenantSlug(value) {
  const slug = String(value || '').toLowerCase().trim();
  if (!slug) return 'growth-escalators';
  if (slug === 'wizmatch' || slug === 'wm') return 'wizmatch';
  if (slug === 'growth' || slug === 'growth-escalators' || slug === 'ge') return 'growth-escalators';
  return slug;
}

// True only for the two code-defined product variants (Growth Escalators /
// Wizmatch UI+routing). A reseller slug is a real, valid tenant but is not
// "known" in this sense — used to decide whether the GE/Wizmatch product
// picker (meaningless for a reseller) should render.
export function isKnownTenantSlug(slug) {
  return Object.prototype.hasOwnProperty.call(TENANTS, normalizeTenantSlug(slug));
}

export function productForTenant(slug = getTenantSlug()) {
  return normalizeTenantSlug(slug) === 'wizmatch' ? 'wizmatch' : 'growth';
}

export function getProductHome(slug = getTenantSlug()) {
  return productForTenant(slug) === 'wizmatch' ? '/wizmatch/today' : '/dashboard';
}

export const WIZMATCH_SHARED_ROUTE_MAP = {
  '/dashboard': '/wizmatch/today',
  '/contacts': '/wizmatch/contacts',
  '/pipeline': '/wizmatch/pipeline',
  '/tasks': '/wizmatch/tasks',
  '/tasks/v2': '/wizmatch/tasks',
  '/inbox': '/wizmatch/inbox',
  '/billing': '/wizmatch/billing',
  '/contracts': '/wizmatch/contracts',
  '/finance': '/wizmatch/finance',
  '/emails': '/wizmatch/emails',
  '/whatsapp-templates': '/wizmatch/whatsapp-templates',
  '/discover': '/wizmatch/discover',
  '/outreach-dashboard': '/wizmatch/outreach',
  '/intelligence': '/wizmatch/intelligence',
  '/settings/permissions': '/wizmatch/settings/permissions',
  '/settings/audit': '/wizmatch/settings/audit',
  '/pipelines/settings': '/wizmatch/pipelines/settings',
};

const GROWTH_SHARED_PATHS = Object.keys(WIZMATCH_SHARED_ROUTE_MAP);

export function productPath(path, slug = getTenantSlug()) {
  const raw = String(path || '/');
  if (raw.startsWith('/wizmatch') || productForTenant(slug) !== 'wizmatch') return raw;
  const match = raw.match(/^([^?#]*)(.*)$/);
  const pathname = match?.[1] || raw;
  const suffix = match?.[2] || '';
  return `${WIZMATCH_SHARED_ROUTE_MAP[pathname] || pathname}${suffix}`;
}

export function getTenantSlug(explicit) {
  if (explicit) return normalizeTenantSlug(explicit);
  if (typeof window === 'undefined') return 'growth-escalators';

  const params = new URLSearchParams(window.location.search);
  const queryTenant = params.get('tenant') || params.get('product');
  if (queryTenant) return normalizeTenantSlug(queryTenant);

  const host = window.location.hostname.toLowerCase();
  if (host.startsWith('wizmatch.') || host.includes('wizmatch')) return 'wizmatch';
  const pathname = window.location.pathname.toLowerCase();
  if (pathname.startsWith('/wizmatch')) return 'wizmatch';
  if (GROWTH_SHARED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return 'growth-escalators';
  }

  return normalizeTenantSlug(localStorage.getItem('crm_active_tenant_slug'));
}

// Reseller readiness (2026-08) — getTenantSlug()'s LAST fallback (nothing in
// the query string, hostname, or path, AND localStorage has never seen a
// tenant) silently resolves to 'growth-escalators'. Looking only at that
// resolved slug, there is no way to tell "nothing was asked for" apart from
// "growth-escalators was asked for explicitly". Callers that need to tell
// those two cases apart (LoginPage's product picker — see isKnownTenantSlug
// below) should use this instead of inspecting the resolved slug. Mirrors
// getTenantSlug's own detection order, but reports whether a real signal was
// found rather than which tenant it resolved to.
export function hasExplicitTenantSignal() {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('tenant') || params.get('product')) return true;

  const host = window.location.hostname.toLowerCase();
  if (host.startsWith('wizmatch.') || host.includes('wizmatch')) return true;

  const pathname = window.location.pathname.toLowerCase();
  if (pathname.startsWith('/wizmatch')) return true;
  if (GROWTH_SHARED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }

  return Boolean(localStorage.getItem('crm_active_tenant_slug'));
}

// Base, code-defined config for the two admin SPA product variants
// (routing/storage — which UI/build a hostname or ?tenant= renders). This is
// deliberately NOT what a white-label tenant's branding overrides — see
// getTenantConfig below for the fetched-branding merge that layers the
// tenant's own display name/logo/colors on top of whichever product variant
// they're using.
// Reseller readiness (2026-08) — unknown slugs used to silently fall back to
// TENANTS['growth-escalators'], which meant a reseller session (a) showed
// "Growth Escalators" on the login page and (b) shared GE's `ge_crm_*`
// storage prefix, so logging into a reseller tenant in the same browser as a
// GE session silently overwrote GE's token/user/permissions (and vice
// versa). A reseller slug now gets its own neutral, slug-scoped config —
// storagePrefix included — so it never collides with GE's or Wizmatch's.
function baseTenantConfig(slug) {
  const normalized = normalizeTenantSlug(slug);
  const known = TENANTS[normalized];
  if (known) return known;
  const label = prettifySlug(normalized) || 'Workspace';
  return {
    slug: normalized,
    label,
    shortLabel: shortLabelFromName(label) || 'W',
    subtitle: 'CRM Dashboard',
    storagePrefix: `crm_${normalized.replace(/-/g, '_')}`,
  };
}

// "acme-media" -> "Acme Media" — neutral fallback display label for a
// reseller tenant that has no `tenant_branding` row (yet, or ever) and isn't
// one of the two hardcoded TENANTS entries.
function prettifySlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Best-effort initials from a display name, for the round logo badge when no
// logoUrl is set — "Client Workspace" -> "CW", "Growth Escalators" -> "GE"
// (matches the pre-existing hardcoded shortLabel, by construction).
function shortLabelFromName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function brandingStorageKey(slug) {
  return `${baseTenantConfig(slug).storagePrefix}_branding`;
}

function tenantFeaturesStorageKey(slug) {
  return `${baseTenantConfig(slug).storagePrefix}_tenant_features`;
}

// Fetched from GET /api/tenant-branding (see admin/src/lib/branding.js) and
// cached here, namespaced the same way token/user/permissions already are —
// per PRODUCT variant, not per real tenant id (matches this file's existing
// session-storage convention; see the module-level note above storageKey).
export function setTenantBranding(branding, slug = getTenantSlug()) {
  try {
    localStorage.setItem(brandingStorageKey(slug), JSON.stringify(branding || {}));
  } catch {
    // localStorage unavailable (private mode / quota) — branding is cosmetic,
    // never let this throw into a caller that isn't expecting it.
  }
}

export function getTenantBranding(slug = getTenantSlug()) {
  try {
    return JSON.parse(localStorage.getItem(brandingStorageKey(slug)) || 'null');
  } catch {
    return null;
  }
}

export function clearTenantBranding(slug = getTenantSlug()) {
  localStorage.removeItem(brandingStorageKey(slug));
}

// Fetched from GET /api/tenant-features/me (see admin/src/lib/tenantFeatures.js)
// and cached here, namespaced exactly like branding above — per PRODUCT
// variant, not per real tenant id. This is what navEntries.js's
// computeFlags() reads to decide whether to show a nav entry whose backing
// API is gated by requireTenantFeature (src/middleware/requireTenantFeature.ts)
// — e.g. Billing for a tenant without `gstBilling`. Absent/uncached reads as
// `{}`, which computeFlags() treats as "unknown, don't restrict" rather than
// "everything off" — a fetch that hasn't resolved yet (or failed) must never
// hide a nav entry that was visible a moment ago.
export function setTenantFeatureFlags(features, slug = getTenantSlug()) {
  try {
    localStorage.setItem(tenantFeaturesStorageKey(slug), JSON.stringify(features || {}));
  } catch {
    // localStorage unavailable (private mode / quota) — same best-effort
    // posture as setTenantBranding above.
  }
}

export function getTenantFeatureFlags(slug = getTenantSlug()) {
  try {
    return JSON.parse(localStorage.getItem(tenantFeaturesStorageKey(slug)) || '{}');
  } catch {
    return {};
  }
}

export function clearTenantFeatureFlags(slug = getTenantSlug()) {
  localStorage.removeItem(tenantFeaturesStorageKey(slug));
}

// The single read path every display surface (LoginPage, Sidebar, page
// <title>) should use. Merges the fetched tenant_branding row (if any is
// cached yet) on top of the base product config — display identity becomes
// tenant-specific and requires no code change to add a new tenant; which
// PRODUCT VARIANT (routing, storage prefix, Growth-vs-Wizmatch UI) a tenant
// runs is unaffected and stays code-defined in TENANTS above (a deeper,
// separate axis this pass doesn't redesign).
export function getTenantConfig(slug = getTenantSlug()) {
  const base = baseTenantConfig(slug);
  const branding = getTenantBranding(slug);
  if (!branding) return base;
  return {
    ...base,
    label: branding.displayName || base.label,
    shortLabel: shortLabelFromName(branding.displayName) || base.shortLabel,
    logoUrl: branding.logoUrl ?? null,
    primaryColor: branding.primaryColor ?? null,
    accentColor: branding.accentColor ?? null,
    faviconUrl: branding.faviconUrl ?? null,
  };
}

function storageKey(kind, slug = getTenantSlug()) {
  return `${baseTenantConfig(slug).storagePrefix}_${kind}`;
}

export function setActiveTenantSlug(slug) {
  localStorage.setItem('crm_active_tenant_slug', normalizeTenantSlug(slug));
}

export function getAuthToken(slug = getTenantSlug()) {
  return localStorage.getItem(storageKey('token', slug));
}

export function setAuthSession({ token, user, permissions = {} }, slug = getTenantSlug()) {
  const tenantSlug = normalizeTenantSlug(slug);
  setActiveTenantSlug(tenantSlug);
  localStorage.setItem(storageKey('token', tenantSlug), token);
  localStorage.setItem(storageKey('user', tenantSlug), JSON.stringify(user));
  localStorage.setItem(storageKey('permissions', tenantSlug), JSON.stringify(permissions));
}

export function setAuthPermissions(permissions = {}, slug = getTenantSlug()) {
  localStorage.setItem(storageKey('permissions', slug), JSON.stringify(permissions));
}

export function getAuthUser(slug = getTenantSlug()) {
  try {
    return JSON.parse(localStorage.getItem(storageKey('user', slug)) || 'null');
  } catch {
    return null;
  }
}

export function getAuthPermissions(slug = getTenantSlug()) {
  try {
    return JSON.parse(localStorage.getItem(storageKey('permissions', slug)) || '{}');
  } catch {
    return {};
  }
}

export function clearAuthSession(slug = getTenantSlug()) {
  localStorage.removeItem(storageKey('token', slug));
  localStorage.removeItem(storageKey('user', slug));
  localStorage.removeItem(storageKey('permissions', slug));
  clearTenantBranding(slug);
  clearTenantFeatureFlags(slug);
}
