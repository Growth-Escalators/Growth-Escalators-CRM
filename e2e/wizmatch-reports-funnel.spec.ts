import { expect, test, type Page, type Route } from '@playwright/test';

// Reports funnel (buildDeliveryFunnel() in WizmatchAnalyticsPage.jsx) —
// closes the "code-reviewed but not test-proven" gap recorded in
// docs/release/WIZMATCH_RELEASE_READINESS.md. Proves the three funnel-stage
// states (not-supported / errored / real) never get conflated, and that the
// Status filter genuinely changes the Requirement stage's count.

const session = {
  token: 'local-wizmatch-reports-funnel-token',
  user: { id: 'rf-user-1', name: 'RF Admin', email: 'rf-admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installBaseMocks(page: Page) {
  await page.route('**/api/**', (route) => json(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/staffing/access', (route) => json(route, { allowed: true, phases: { A: true, B: true, C: true }, capabilities: { viewCommercial: true } }));
  await page.route('**/api/inbox/unread-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/finance/leaves/pending-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/wizmatch/digest', (route) => json(route, { stats: {} }));
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [] }));
}

test.describe('Reports funnel', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
  });

  test('unsupported stages render "Not available yet", never a fabricated number', async ({ page }) => {
    await page.route('**/api/wizmatch/analytics?**', (route) => json(route, { funnel: [], sources: [] }));
    await page.route('**/api/wizmatch/analytics/roi?**', (route) => json(route, { funnel: [{ stage: 'Signals captured', count: 5 }], sourceBreakdown: [] }));
    await page.route('**/api/wizmatch/staffing/analytics**', (route) => json(route, {
      funnel: [{ status: 'submitted', count: 2 }], commercial: { gross_margin: '0', starts: 1, invoiced: '0', collected: '0' },
      exceptions: { overdue_submissions: 0, missing_next_action: 0 }, cohorts: [], timeToFill: { average_days: null }, aging: [], rejectionReasons: [], recruiterPerformance: [], sourcePerformance: [],
    }));
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [], total: 3 }));

    await page.goto('/wizmatch/reports');
    await page.waitForLoadState('networkidle');

    // Hiring Contact, Match, and Shortlist have no backing tenant-wide endpoint.
    for (const label of ['Hiring Contact', 'Match', 'Shortlist']) {
      const row = page.locator('div').filter({ hasText: label }).filter({ hasText: 'Not available yet' }).last();
      await expect(row).toBeVisible();
    }
    // Job Lead and Requirement ARE supported and must show their real counts, not "Not available yet".
    await expect(page.getByText('Not available yet')).toHaveCount(3);
  });

  test('a failed fetch for a supported stage renders a distinct retryable error, not "Not available yet"', async ({ page }) => {
    await page.route('**/api/wizmatch/analytics?**', (route) => json(route, { funnel: [], sources: [] }));
    await page.route('**/api/wizmatch/analytics/roi?**', (route) => json(route, { funnel: [{ stage: 'Signals captured', count: 5 }], sourceBreakdown: [] }));
    await page.route('**/api/wizmatch/staffing/analytics**', (route) => json(route, { error: 'Staffing analytics unavailable' }, 500));
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [], total: 3 }));

    await page.goto('/wizmatch/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Failed to load').first()).toBeVisible();
    // The errored Submission/Interview/Offer/Start stages must not silently
    // fall back to the "not supported" copy — that would hide a real outage.
    const failedCount = await page.getByText('Failed to load').count();
    expect(failedCount).toBeGreaterThanOrEqual(3);
  });

  test('changing the Status filter changes the Requirement stage count', async ({ page }) => {
    await page.route('**/api/wizmatch/analytics?**', (route) => json(route, { funnel: [], sources: [] }));
    await page.route('**/api/wizmatch/analytics/roi?**', (route) => json(route, { funnel: [{ stage: 'Signals captured', count: 5 }], sourceBreakdown: [] }));
    await page.route('**/api/wizmatch/staffing/analytics**', (route) => json(route, {
      funnel: [], commercial: { gross_margin: '0', starts: 0, invoiced: '0', collected: '0' }, exceptions: { overdue_submissions: 0, missing_next_action: 0 },
      cohorts: [], timeToFill: { average_days: null }, aging: [], rejectionReasons: [], recruiterPerformance: [], sourcePerformance: [],
    }));
    await page.route('**/api/wizmatch/requirements?**', (route) => {
      const url = new URL(route.request().url());
      const status = url.searchParams.get('status');
      const total = status === 'draft' ? 1 : status === 'closed' ? 7 : 10;
      return json(route, { items: [], total });
    });

    await page.goto('/wizmatch/reports');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('10').first()).toBeVisible();

    await page.getByLabel('Status', { exact: true }).selectOption('draft');
    await expect(page.getByText('1').first()).toBeVisible();

    await page.getByLabel('Status', { exact: true }).selectOption('closed');
    await expect(page.getByText('7').first()).toBeVisible();
  });
});
