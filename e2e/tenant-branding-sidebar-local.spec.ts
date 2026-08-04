import { expect, test, type Page, type Route } from '@playwright/test';

// Regression coverage for admin/src/components/Sidebar.jsx's logo fallback.
// It used to render <img src={tenant.logoUrl || '/ge-mark.png'}> — any
// tenant without its own configured logo (i.e. every reseller that hasn't
// uploaded one yet) silently inherited Growth Escalators' own mark. Fixed to
// fall back to a neutral Building2 badge instead; GE's own tenant is
// unaffected because its tenant_branding row is seeded with its OWN
// logoUrl ('/ge-mark.png' — see src/services/tenantBrandingDefaults.ts),
// not via this fallback.
//
// Mocked session + mocked API, same technique as wizmatch-gate-a-local.spec.ts
// — no real backend needed. Run via:
//   npx playwright test --config=playwright.wizmatch-local.config.ts tenant-branding-sidebar-local

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setup(page: Page, opts: { slug: string; storagePrefix: string }) {
  const { slug, storagePrefix } = opts;
  await page.addInitScript(({ slug, storagePrefix }) => {
    localStorage.setItem('crm_active_tenant_slug', slug);
    localStorage.setItem(`${storagePrefix}_token`, 'local-tenant-branding-token');
    localStorage.setItem(`${storagePrefix}_user`, JSON.stringify({ id: 'user-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: slug }));
    localStorage.setItem(`${storagePrefix}_permissions`, JSON.stringify({}));
  }, { slug, storagePrefix });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/inbox/unread-count' || path === '/api/finance/leaves/pending-count') return json(route, { count: 0 });
    // DashboardPage's own fetches all .catch(() => null) — {} is a safe
    // generic stand-in for anything not explicitly mocked below.
    return json(route, {});
  });
}

test('a reseller tenant with no configured logo gets a neutral fallback badge, never Growth Escalators\' own mark', async ({ page }) => {
  await setup(page, { slug: 'acme-media', storagePrefix: 'crm_acme_media' });
  await page.route('**/api/tenant-branding', route => json(route, {
    branding: {
      id: 'branding-1', tenantId: 'tenant-acme', displayName: 'Acme Media',
      logoUrl: null, primaryColor: '#334155', accentColor: '#64748b', faviconUrl: null,
      supportEmail: null,
    },
  }));

  await page.goto('/dashboard?tenant=acme-media');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar.getByText('Acme Media')).toBeVisible();

  // No <img> for the logo — the old bug rendered <img src="/ge-mark.png">
  // here for exactly this case.
  await expect(sidebar.locator('img')).toHaveCount(0);
  // The neutral Building2 fallback badge renders instead, in the logo slot
  // specifically — scoped by its accessible name (shortLabelFromName('Acme
  // Media') === 'AM') so this doesn't accidentally match the unrelated
  // Building2 icon the "Clients" nav link already uses elsewhere in the
  // sidebar.
  const logoBadge = sidebar.getByRole('img', { name: 'AM' });
  await expect(logoBadge).toBeVisible();
  await expect(logoBadge.locator('svg.lucide-building-2')).toBeVisible();
  expect(await logoBadge.evaluate((el) => el.tagName)).toBe('DIV');
});

test("GE's own tenant still renders its own real configured mark unchanged", async ({ page }) => {
  await setup(page, { slug: 'growth-escalators', storagePrefix: 'ge_crm' });
  await page.route('**/api/tenant-branding', route => json(route, {
    branding: {
      id: 'branding-ge', tenantId: 'tenant-ge', displayName: 'Growth Escalators',
      logoUrl: '/ge-mark.png', primaryColor: '#1A3A5C', accentColor: '#F97316', faviconUrl: '/favicon.svg',
      supportEmail: null,
    },
  }));

  await page.goto('/dashboard?tenant=growth-escalators');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(sidebar.getByText('Growth Escalators')).toBeVisible();

  // GE's own mark renders as its OWN configured branding value, not as a
  // hardcoded fallback — so it must still be there. Scoped by accessible
  // name (shortLabelFromName('Growth Escalators') === 'GE') to the logo slot
  // specifically, same reasoning as the reseller case above.
  const logoBadge = sidebar.getByRole('img', { name: 'GE' });
  await expect(logoBadge).toBeVisible();
  await expect(logoBadge).toHaveAttribute('src', '/ge-mark.png');
  expect(await logoBadge.evaluate((el) => el.tagName)).toBe('IMG');
});
