import { expect, test, type Page, type Route } from '@playwright/test';

// Phase 1A regression coverage — entity-first navigation, More menu, breadcrumbs,
// legacy redirects, and the "no native dialog" guard. Uses a mocked session +
// mocked API responses (no real backend needed) so it stays fast and
// deterministic, matching the pattern already established in
// wizmatch-phase0-local.spec.ts.

const session = {
  token: 'local-wizmatch-e2e-hardening-token',
  user: {
    id: 'local-e2e-user-1',
    name: 'E2E Hardening Admin',
    email: 'e2e-hardening-admin@example.test',
    role: 'admin',
    tenantSlug: 'wizmatch',
  },
};

async function installWizmatchSession(page: Page) {
  await page.addInitScript((value) => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', value.token);
    localStorage.setItem('wizmatch_crm_user', JSON.stringify(value.user));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
    localStorage.setItem('ge_crm_token', 'local-growth-token');
  }, session);
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApiMocks(page: Page) {
  // Playwright matches the MOST RECENTLY registered overlapping route first,
  // so the generic catch-all must be registered before the specific
  // overrides below it (registering it last would shadow them instead).
  await page.route('**/api/**', (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/staffing/access', (route) =>
    fulfillJson(route, { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} }));
  await page.route('**/api/inbox/unread-count', (route) => fulfillJson(route, { count: 0 }));
  await page.route('**/api/finance/leaves/pending-count', (route) => fulfillJson(route, { count: 0 }));
  await page.route('**/api/wizmatch/dashboard', (route) => fulfillJson(route, {}));
}

/** Fails the test immediately if a native alert/confirm/prompt fires. */
function guardAgainstNativeDialogs(page: Page) {
  page.on('dialog', (dialog) => {
    throw new Error(`Unexpected native ${dialog.type()} dialog: "${dialog.message()}"`);
  });
}

test.describe('Phase 1A entity-first navigation', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installApiMocks(page);
    guardAgainstNativeDialogs(page);
  });

  test('all 9 primary nav items are present and point at their canonical paths', async ({ page }) => {
    await page.goto('/wizmatch/today');
    await page.waitForLoadState('networkidle');

    const expected: Array<[string, string]> = [
      ['Today', '/wizmatch/today'],
      ['Job Leads', '/wizmatch/job-leads'],
      ['Companies', '/wizmatch/companies'],
      ['Hiring Contacts', '/wizmatch/hiring-contacts'],
      ['Roles / Requirements', '/wizmatch/requirements'],
      ['Candidates', '/wizmatch/candidates'],
      ['Submissions', '/wizmatch/submissions'],
      ['Placements', '/wizmatch/placements'],
      ['Reports', '/wizmatch/reports'],
    ];
    for (const [label, path] of expected) {
      const link = page.getByRole('link', { name: label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', path);
    }
  });

  test('More menu expands to reveal 4 labeled subsections', async ({ page }) => {
    await page.goto('/wizmatch/today');
    await page.waitForLoadState('networkidle');

    // Below the md breakpoint, Sidebar renders behind a hamburger-triggered
    // drawer (translate-x-full off-screen until opened) — open it first.
    const hamburger = page.getByRole('button', { name: 'Open navigation' });
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.click();
    }

    const moreButton = page.getByRole('button', { name: 'More' });
    await expect(moreButton).toBeVisible();
    await expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    await moreButton.click();
    await expect(moreButton).toHaveAttribute('aria-expanded', 'true');

    for (const section of ['Communication', 'CRM Utilities', 'Administration', 'Finance']) {
      await expect(page.getByText(section, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'System', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Billing', exact: true })).toBeVisible();

    await moreButton.click();
    await expect(moreButton).toHaveAttribute('aria-expanded', 'false');
  });

  test('More menu is keyboard operable', async ({ page }) => {
    await page.goto('/wizmatch/today');
    await page.waitForLoadState('networkidle');
    const moreButton = page.getByRole('button', { name: 'More' });
    await moreButton.focus();
    await expect(moreButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(moreButton).toHaveAttribute('aria-expanded', 'false');
  });

  test.describe('legacy path redirects', () => {
    const redirects: Array<[string, string]> = [
      ['/wizmatch/dashboard', '/wizmatch/today'],
      ['/wizmatch/signals', '/wizmatch/job-leads'],
      ['/wizmatch/relationships', '/wizmatch/companies'],
      ['/wizmatch/contact-intelligence', '/wizmatch/hiring-contacts'],
      ['/wizmatch/delivery', '/wizmatch/submissions'],
      ['/wizmatch/analytics', '/wizmatch/reports'],
    ];
    for (const [from, to] of redirects) {
      test(`${from} -> ${to}`, async ({ page }) => {
        await page.goto(from);
        await page.waitForURL(`**${to}`);
        expect(new URL(page.url()).pathname).toBe(to);
      });
    }
  });

  test('query string survives a legacy redirect chain (System tab preservation)', async ({ page }) => {
    await page.goto('/wizmatch/domains');
    await page.waitForURL('**/wizmatch/system?tab=domains');
    const url = new URL(page.url());
    expect(url.pathname).toBe('/wizmatch/system');
    expect(url.searchParams.get('tab')).toBe('domains');
  });

  test('refreshing a deep link (not just navigating to it) still resolves correctly', async ({ page }) => {
    await page.goto('/wizmatch/requirements');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/wizmatch/requirements');
    await expect(page.locator('body')).not.toContainText('Something went wrong');
  });

  test('breadcrumb root is tenant-aware ("Wizmatch", not "CRM") and shows the friendly label', async ({ page }) => {
    await page.goto('/wizmatch/review-workbench');
    await page.waitForLoadState('networkidle');
    const nav = page.locator('nav', { hasText: 'Review Workbench' }).first();
    await expect(nav.getByRole('link', { name: 'Wizmatch' })).toBeVisible();
    await expect(nav).not.toContainText('CRM');
    await expect(nav).toContainText('Review Workbench');
    await expect(nav).not.toContainText('Review-workbench');
  });

  test('pending-merge pages remain directly accessible by URL even though they are out of primary/More nav', async ({ page }) => {
    for (const path of ['/wizmatch/my-work', '/wizmatch/review-workbench', '/wizmatch/client-discovery', '/wizmatch/talent-matching']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator('body')).not.toContainText('Something went wrong');
    }
  });

  test('no horizontal overflow on the primary nav shell at any of the 3 viewports', async ({ page }) => {
    await page.goto('/wizmatch/today');
    await page.waitForLoadState('networkidle');
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });

  test('no unhandled navigation loop across the 9 primary destinations', async ({ page }) => {
    const paths = [
      '/wizmatch/today', '/wizmatch/job-leads', '/wizmatch/companies', '/wizmatch/hiring-contacts',
      '/wizmatch/requirements', '/wizmatch/candidates', '/wizmatch/submissions', '/wizmatch/placements', '/wizmatch/reports',
    ];
    for (const path of paths) {
      await page.goto(path, { timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      expect(new URL(page.url()).pathname).toBe(path);
    }
  });
});
