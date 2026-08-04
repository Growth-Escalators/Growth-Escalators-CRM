// The admin sidebar (admin/src/components/navEntries.js) used to have no
// knowledge of per-tenant feature entitlements (src/services/
// tenantFeatures.ts) at all — it only branched on product (growth vs
// wizmatch) and role. A reseller tenant without `gstBilling` still saw a
// "Billing" nav entry, which then 403'd on click because `/api/billing` is
// mounted behind `requireTenantFeature('gstBilling')` (src/index.ts).
//
// This pins the fix: computeFlags()/getVisibleEntries() now take the
// resolved TenantFeatureFlags as a 5th argument and fold `gstBilling` into
// `canBilling` — the only nav entry backed by a route that
// requireTenantFeature actually gates today (grep src/index.ts for
// `requireTenantFeature(` — just `/api/billing` and `/api/wizmatch`).
//
// Cross-checked against the REAL PLAN_DEFAULTS table (via
// computeTenantFeatures, not a hand-copied fixture) so a future change to
// agency_internal's defaults would fail this test loudly instead of the nav
// silently drifting out of sync with the backend's own entitlement table.
import { describe, it, expect } from 'vitest';
import { computeTenantFeatures } from '../services/tenantFeatures';
// navEntries.js is plain JS with no type declarations — same suppression
// sidebarNavBucketCoverage.test.ts uses for the same reason.
// @ts-ignore -- untyped JS module
import { computeFlags, getVisibleEntries } from '../../admin/src/components/navEntries.js';

const OWNER_PERMS = { isOwner: true };

describe("Growth Escalators' own tenant sees everything it sees today", () => {
  it("agency_internal's real resolved flags leave gstBilling true (ground truth this test pins)", () => {
    const geFeatures = computeTenantFeatures('agency_internal', {});
    expect(geFeatures.gstBilling).toBe(true);
  });

  it('full visible-entry list for growth-escalators is identical with and without the new 5th argument', () => {
    const geFeatures = computeTenantFeatures('agency_internal', {});
    const before = getVisibleEntries('admin', OWNER_PERMS, 'growth-escalators', {});
    const after = getVisibleEntries('admin', OWNER_PERMS, 'growth-escalators', {}, geFeatures);
    expect(after).toEqual(before);
    expect(after.map((e: { id: string }) => e.id)).toContain('billing');
  });

  it('omitting tenantFeatures entirely (e.g. before the /api/tenant-features/me fetch resolves) never hides Billing', () => {
    // computeFlags defaults tenantFeatures to {} — undefined must read as
    // "unknown, don't restrict", not "everything off", or a slow network
    // request would flash Billing away for every tenant on first paint.
    expect(computeFlags('admin', OWNER_PERMS, 'growth-escalators').canBilling).toBe(true);
  });
});

describe('a tenant without gstBilling does not see Billing', () => {
  it('canBilling is false even with a full billingView + isOwner grant', () => {
    const flags = computeFlags('admin', OWNER_PERMS, 'growth-escalators', {}, { gstBilling: false });
    expect(flags.canBilling).toBe(false);
  });

  it("the 'billing' nav entry is absent from getVisibleEntries — and it's the ONLY entry removed", () => {
    const withFlag = getVisibleEntries('admin', OWNER_PERMS, 'growth-escalators', {}, { gstBilling: true }).map((e: { id: string }) => e.id);
    const withoutFlag = getVisibleEntries('admin', OWNER_PERMS, 'growth-escalators', {}, { gstBilling: false }).map((e: { id: string }) => e.id);
    expect(withFlag).toContain('billing');
    expect(withoutFlag).not.toContain('billing');
    expect(withFlag.filter((id: string) => !withoutFlag.includes(id))).toEqual(['billing']);
  });

  it('Contracts, Expenses and Funnels stay visible — their APIs are not gstBilling-gated (src/index.ts mounts them with only requireAuth)', () => {
    const ids = getVisibleEntries('admin', OWNER_PERMS, 'growth-escalators', {}, { gstBilling: false }).map((e: { id: string }) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['contracts', 'expenses', 'funnels']));
  });
});

describe('Wizmatch nav is unaffected by tenantFeatures — already isolated by product, not this flag', () => {
  it('the wizmatch tenant sees the same nav regardless of what tenantFeatures carries', () => {
    const idsA = getVisibleEntries('admin', {}, 'wizmatch', {}, { wizmatch: true, gstBilling: true }).map((e: { id: string }) => e.id);
    const idsB = getVisibleEntries('admin', {}, 'wizmatch', {}, { wizmatch: false, gstBilling: false }).map((e: { id: string }) => e.id);
    expect(idsA).toEqual(idsB);
  });
});
