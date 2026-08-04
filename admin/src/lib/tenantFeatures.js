// Fetches the current tenant's feature flags (src/services/tenantFeatures.ts's
// TenantFeatureFlags, mirrored read-only at GET /api/tenant-features/me) and
// caches them — the frontend counterpart to route-level enforcement in
// src/middleware/requireTenantFeature.ts. Consumed by navEntries.js's
// computeFlags() so the sidebar stops advertising a nav entry whose backing
// API a tenant's plan does not actually grant (e.g. Billing when
// `gstBilling` is off), instead of the tenant discovering that only by
// clicking through to a 403.
//
// Deliberately mirrors admin/src/lib/branding.js's refreshTenantBranding():
// same best-effort, silent-on-failure posture (feature-flag nav gating is a
// UX nicety layered on top of the real server-side enforcement, so a failed
// fetch must never block login, session-restore, or navigation — the worst
// case of a stale/empty cache is a nav entry that 403s on click, exactly
// today's pre-existing behaviour, not a new failure mode).
import { apiFetch } from './api.js';
import { setTenantFeatureFlags } from './auth.js';

export async function refreshTenantFeatures() {
  try {
    const data = await apiFetch('/api/tenant-features/me');
    if (data?.features) {
      setTenantFeatureFlags(data.features);
      return data.features;
    }
  } catch {
    // best-effort — see module docstring
  }
  return null;
}
