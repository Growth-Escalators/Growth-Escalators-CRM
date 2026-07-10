---
name: ge-add-wizmatch-admin-page
description: Use when adding or moving a page in the shared admin SPA that should belong to one tenant/product — a new Wizmatch cockpit page, a Wizmatch-only view, or anything that must NOT appear in the Growth CRM nav (or vice-versa). Triggers include "add a wizmatch page", "new admin screen for wizmatch", "wire the cockpit page into admin", "this page is showing for the wrong tenant", "hide X from growth users". Skips: backend routes (use ge-add-route), pages shared by both products intentionally, D2C client landing pages.
---

# Adding a product-scoped admin page

The admin SPA is **shared** between the Growth CRM tenant and the Wizmatch tenant. Every nav entry
is scoped by product. Forget to scope a new page and it **leaks into the wrong tenant's
navigation** — a cross-tenant surface bug that erodes trust. Reference:
[`admin/src/components/navEntries.js`](../../../admin/src/components/navEntries.js).

## How scoping works
- `productForTenantSlug(tenantSlug)` → `'wizmatch'` when slug is `wizmatch`, else `'growth'`.
- `entryProduct(entry)` reads `entry.product` (or infers `'wizmatch'` from `section: 'Wizmatch'`).
- `computeFlags(...)` exposes `isWizmatchProduct` / `isGrowthProduct` and `canWizmatch` (Wizmatch +
  admin-tier only). Nav filters entries by the active product.

## Steps
1. **Add the route** in `admin/src/App.jsx` (lazy-import the page component like its neighbours).
2. **Add the nav entry** in `navEntries.js` with an explicit `product: 'wizmatch'` (don't rely on
   inference). Set `section`, `group`, `icon`, `to`, and a stable `id` (e.g. `wm-cockpit`).
3. **Confirm the gate.** The entry should only show for the Wizmatch tenant / `canWizmatch` users.
   Growth-only pages get `product: 'growth'`.
4. **Build the SPA:** `npm run admin:build` (rebuilds `public/admin`) — required before the change
   is visible in prod.
5. **Manual check** (see `ge-manual-qa`): log in as a Wizmatch admin, confirm the page appears; log
   in / switch to Growth, confirm it does **not**.

## Never
- Never add a page without an explicit `product` scope (it defaults into Growth and leaks).
- Never mix a Wizmatch view into a shared Growth section without scoping.
- Never skip `npm run admin:build` — the route won't exist in the deployed bundle otherwise.
