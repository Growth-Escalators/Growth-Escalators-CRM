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

export function normalizeTenantSlug(value) {
  const slug = String(value || '').toLowerCase().trim();
  if (slug === 'wizmatch' || slug === 'wm') return 'wizmatch';
  return 'growth-escalators';
}

export function productForTenant(slug = getTenantSlug()) {
  return normalizeTenantSlug(slug) === 'wizmatch' ? 'wizmatch' : 'growth';
}

export function getProductHome(slug = getTenantSlug()) {
  return productForTenant(slug) === 'wizmatch' ? '/wizmatch/review-workbench' : '/dashboard';
}

export function getTenantSlug(explicit) {
  if (explicit) return normalizeTenantSlug(explicit);
  if (typeof window === 'undefined') return 'growth-escalators';

  const params = new URLSearchParams(window.location.search);
  const queryTenant = params.get('tenant') || params.get('product');
  if (queryTenant) return normalizeTenantSlug(queryTenant);

  const host = window.location.hostname.toLowerCase();
  if (host.startsWith('wizmatch.') || host.includes('wizmatch')) return 'wizmatch';
  if (window.location.pathname.toLowerCase().startsWith('/wizmatch')) return 'wizmatch';

  return normalizeTenantSlug(localStorage.getItem('crm_active_tenant_slug'));
}

export function getTenantConfig(slug = getTenantSlug()) {
  return TENANTS[normalizeTenantSlug(slug)] || TENANTS['growth-escalators'];
}

function storageKey(kind, slug = getTenantSlug()) {
  return `${getTenantConfig(slug).storagePrefix}_${kind}`;
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
}
