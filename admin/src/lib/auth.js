export const TENANTS = {
  'growth-escalators': {
    slug: 'growth-escalators',
    label: 'Growth Escalators',
    shortLabel: 'GE',
    subtitle: 'CRM Dashboard',
    storagePrefix: 'ge_crm',
  },
  // Transitional data/session namespace only. WizMatch is no longer an active
  // product/brand; keeping this slug temporarily avoids breaking existing
  // sessions before the underlying tenant data is consolidated into GE.
  wizmatch: {
    slug: 'wizmatch',
    label: 'Growth Escalators',
    shortLabel: 'GE',
    subtitle: 'CRM Dashboard',
    storagePrefix: 'wizmatch_crm',
  },
};

// Only Growth Escalators is an active selectable product. The legacy wizmatch
// slug remains addressable for session/data compatibility but must never be
// offered as a separate product choice.
export const TENANT_OPTIONS = [TENANTS['growth-escalators']];

// Reseller readiness (2026-08) — this USED to fold every slug that wasn't
// 'wizmatch'/'wm' down to 'growth-escalators', so a reseller's own
// `?tenant=acme-media` link rendered as (and authenticated against) Growth
// Escalators' tenant. Keep the legacy wizmatch aliases addressable until the
// data migration is complete; arbitrary reseller slugs continue to pass
// through unchanged. Absent/empty input still defaults to Growth Escalators.
export function normalizeTenantSlug(value) {
  const slug = String(value || '').toLowerCase().trim();
  if (!slug) return 'growth-escalators';
  if (slug === 'wizmatch' || slug === 'wm') return 'wizmatch';
  if (slug === 'growth' || slug === 'growth-escalators' || slug === 'ge') return 'growth-escalators';
  return slug;
}

// Only Growth Escalators is a selectable code-defined product now. The legacy
// wizmatch slug is intentionally excluded so LoginPage never renders a
// Growth/WizMatch product picker again.
export function isKnownTenantSlug(slug) {
  return normalizeTenantSlug(slug) === 'growth-escalators';
}

// Retained temporarily because routing/auth still need to distinguish the
// legacy data namespace from the canonical Growth tenant until consolidation.
export function productForTenant(slug = getTenantSlug()) {
  return normalizeTenantSlug(slug) === 'wizmatch' ? 'wizmatch' : 'growth';
}

export function getProductHome(slug = getTenantSlug()) {
  // The old WizMatch Today page is retired. Legacy sessions land on the shared
  // Growth CRM Contacts surface instead of a dead staffing/product page.
  return productForTenant(slug) === 'wizmatch' ? '/wizmatch/contacts' : '/dashboard';
}

export const WIZMATCH_SHARED_ROUTE_MAP = {
  '/dashboard': '/wizmatch/contacts',
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
  '/settings/permissions': '/wizmatch/settings/permissions',
  '/settings/branding': '/wizmatch/settings/branding',
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
// those two cases apart should use this instead of inspecting the resolved
// slug. Mirrors getTenantSlug's own detection order, but reports whether a
// real signal was found rather than which tenant it resolved to.
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

// Base config for the canonical Growth product plus temporary legacy session
// namespaces. Reseller slugs remain neutral, independently namespaced tenants.
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
// reseller tenant that has no `tenant_branding` row yet (or ever).
function prettifySlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Best-effort initials from a display name, for the round logo badge when no
// logoUrl is set — "Client Workspace" -> "CW", "Growth Escalators" -> "GE".
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

export function setTenantBranding(branding, slug = getTenantSlug()) {
  try {
    localStorage.setItem(brandingStorageKey(slug), JSON.stringify(branding || {}));
  } catch {
    // Branding is cosmetic; storage failures must never break the app.
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

export function setTenantFeatureFlags(features, slug = getTenantSlug()) {
  try {
    localStorage.setItem(tenantFeaturesStorageKey(slug), JSON.stringify(features || {}));
  } catch {
    // Feature cache is best-effort; server-side gates remain authoritative.
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
