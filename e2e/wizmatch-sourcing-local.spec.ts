import { expect, test, type Page, type Route } from '@playwright/test';

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'sourcing-token');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'user-1', name: 'Admin', role: 'admin', tenantSlug: 'wizmatch' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/inbox/unread-count' || path === '/api/finance/leaves/pending-count') return json(route, { count: 0 });
    if (path === '/api/wizmatch/staffing/access') return json(route, { allowed: true, phases: { A: true, B: true, C: true } });
    return json(route, {});
  });
}

test('results-first signal workflow qualifies, discovers POC, and creates one requirement draft', async ({ page }) => {
  await setup(page);
  const actions: string[] = [];
  const signal = { id: 'signal-1', job_title: 'SAP ABAP Consultant', company_name: 'Company A', company_id: 'company-a', location: 'Pune', source: 'theirstack', status: 'new', score: 8, keywords: ['SAP ABAP'] };
  await page.route('**/api/wizmatch/sourcing/status', route => json(route, {
    config: { theirstackEnabled: true, atsEnabled: true, xrayEnabled: true, pocDiscoveryEnabled: true },
    latestRuns: [{ provider: 'theirstack', status: 'succeeded', inserted_count: 1, duplicate_count: 0 }],
  }));
  await page.route('**/api/wizmatch/signals?**', route => json(route, { items: [signal], total: 1 }));
  await page.route('**/api/wizmatch/signals/signal-1', route => json(route, signal));
  for (const action of ['qualify', 'discover-poc', 'promote-to-requirement']) {
    await page.route(`**/api/wizmatch/signals/signal-1/${action}`, route => { actions.push(action); return json(route, action === 'promote-to-requirement' ? { created: true, requirement: { id: 'req-1' } } : { ok: true }); });
  }
  // Find POC is now preview-first: a read-only dry-run, then an explicit "Run free search".
  await page.route('**/api/wizmatch/signals/signal-1/discover-poc/preview', route => json(route, {
    query: '("Company A") ("talent acquisition" OR recruiter OR "people operations" OR "hiring manager" OR "delivery manager" OR procurement OR "vendor management") (site:linkedin.com/in)',
    company: 'Company A', domain: null, roles: ['talent_acquisition', 'hr_people', 'hiring_delivery_manager', 'vendor_procurement'],
    pocDiscoveryEnabled: true, searchApiConfigured: true, internalContactsExist: false, inCooldown: false, estimatedSearchApiCredits: 1,
    searchApiUsage: { daily: 0, monthly: 0, dailyLimit: 5, monthlyLimit: 80, dailyRemaining: 5, monthlyRemaining: 80 }, notes: ['Preview only — no provider is called.'],
  }));
  await page.goto('/wizmatch/signals');
  await expect(page.getByText('theirstack').first()).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'SAP ABAP Consultant' }).click();
  await page.getByRole('button', { name: 'Qualify + POC task' }).click();
  await page.getByRole('button', { name: 'Find POC ▸ preview' }).click();
  await page.getByRole('button', { name: 'Run free search' }).click();
  await page.getByRole('button', { name: 'Create requirement draft' }).click();
  expect(actions).toEqual(['qualify', 'discover-poc', 'promote-to-requirement']);
  await expect(page.getByRole('status')).toContainText('Create requirement draft completed');
});

test('provider failure stays actionable and never creates demo signals', async ({ page }) => {
  await setup(page);
  await page.route('**/api/wizmatch/sourcing/status', route => json(route, {
    config: { theirstackEnabled: true, atsEnabled: false, xrayEnabled: false, pocDiscoveryEnabled: true }, latestRuns: [],
  }));
  await page.route('**/api/wizmatch/signals?**', route => json(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/sourcing/theirstack/run', route => json(route, { error: 'TheirStack temporarily unavailable' }, 500));
  await page.goto('/wizmatch/signals');
  await page.getByRole('button', { name: 'Run now' }).first().click();
  await expect(page.getByRole('status')).toContainText('TheirStack temporarily unavailable');
  await expect(page.getByText('Bengaluru Cloud Staffing')).toHaveCount(0);
});

for (const viewport of [{ name: 'tablet', width: 820, height: 1180 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`source controls remain usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setup(page);
    await page.route('**/api/wizmatch/sourcing/status', route => json(route, {
      config: { theirstackEnabled: true, atsEnabled: true, xrayEnabled: false, pocDiscoveryEnabled: true }, latestRuns: [],
    }));
    await page.route('**/api/wizmatch/signals?**', route => json(route, { items: [], total: 0 }));
    await page.goto('/wizmatch/signals');
    await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible();
    await expect(page.getByText('TheirStack').first()).toBeVisible();
  });
}

test('accepted requirement can start capped requirement-first candidate sourcing', async ({ page }) => {
  await setup(page);
  let sourced = false;
  await page.route('**/api/wizmatch/requirements?**', route => json(route, { items: [{ id: 'req-1', company_id: 'company-a', company_name: 'Company A', title: 'Java Backend Developer', required_skills: ['Java'], stage: 'accepted', status: 'draft', assignments: [] }], total: 1 }));
  await page.route('**/api/wizmatch/staffing/requirements/req-1', route => json(route, { requirement: { id: 'req-1', company_id: 'company-a', title: 'Java Backend Developer', stage: 'accepted' }, contacts: [], assignments: [], tasks: [], events: [] }));
  await page.route('**/api/wizmatch/companies/company-a/contacts', route => json(route, { items: [] }));
  await page.route('**/api/wizmatch/staffing/users', route => json(route, { items: [{ id: 'user-1', name: 'Admin', role: 'admin' }] }));
  await page.route('**/api/wizmatch/requirements/req-1/source-candidates-xray', route => { sourced = true; return json(route, { candidates_created: 2 }); });
  await page.goto('/wizmatch/requirements');
  await page.getByRole('row').filter({ hasText: 'Java Backend Developer' }).click();
  await page.getByRole('button', { name: 'Source public candidate leads' }).click();
  await expect.poll(() => sourced).toBe(true);
  await expect(page.getByRole('status')).toContainText('X-Ray candidate leads created for evidence review');
});
