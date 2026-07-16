import { expect, test, type Page, type Route } from '@playwright/test';

// Manual delete affordances added this session:
//  - Job Signals: new "Delete permanently" button → DELETE /signals/:id
//  - Hiring contacts (POC): new hard "Delete permanently" (relationship-only,
//    keeps the CRM contact) → DELETE /companies/:id/contacts/:id/hard
// Mocked-session specs (no backend) matching the wizmatch-*-local.spec.ts style.

const session = {
  token: 'local-wizmatch-delete-detail-token',
  user: { id: 'dd-user-1', name: 'DD Admin', email: 'dd-admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
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
  await page.route('**/api/wizmatch/staffing/access', (route) => json(route, { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} }));
  await page.route('**/api/inbox/unread-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/finance/leaves/pending-count', (route) => json(route, { count: 0 }));
}

function guardAgainstNativeDialogs(page: Page) {
  page.on('dialog', (dialog) => { throw new Error(`Unexpected native ${dialog.type()} dialog: "${dialog.message()}"`); });
}

const SIGNAL_DETAIL = {
  id: 'sig-1', job_title: 'Senior Java Developer', company_name: 'Acme Corp', location: 'Bengaluru',
  score: 7, days_open: 3, status: 'scored', keywords: ['java'], matched_candidates: [], drafts: [],
};

test.describe('Job signal manual delete', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    guardAgainstNativeDialogs(page);
    await page.route('**/api/wizmatch/sourcing/status', (route) => json(route, { config: { pocDiscoveryEnabled: false }, latestRuns: [], providerAccounts: {} }));
  });

  async function routeSignals(page: Page, onDelete: (route: Route) => Promise<void>) {
    await page.route('**/api/wizmatch/signals**', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname === '/api/wizmatch/signals') return json(route, { items: [SIGNAL_DETAIL], total: 1 });
      if (url.pathname === '/api/wizmatch/signals/sig-1') {
        if (method === 'DELETE') return onDelete(route);
        return json(route, SIGNAL_DETAIL);
      }
      return json(route, { items: [], total: 0 });
    });
  }

  test('deletes a signal through the accessible confirm dialog', async ({ page }) => {
    let deleteCalled = false;
    await routeSignals(page, async (route) => { deleteCalled = true; await json(route, { deleted: true, id: 'sig-1' }); });

    await page.goto('/wizmatch/job-leads');
    await page.getByRole('row').filter({ hasText: 'Senior Java Developer' }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/reason/i).fill('Not a workable requirement');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();

    await expect.poll(() => deleteCalled).toBe(true);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('surfaces the 409 dependency message and keeps the drawer open', async ({ page }) => {
    await routeSignals(page, (route) => json(route, { error: 'has_dependencies', message: 'Cannot delete — this signal was promoted into requirement "Java Dev". Reject it instead if it\'s no longer relevant.' }, 409));

    await page.goto('/wizmatch/job-leads');
    await page.getByRole('row').filter({ hasText: 'Senior Java Developer' }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();

    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel(/reason/i).fill('cleanup');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();

    await expect(dialog.getByText(/Cannot delete — this signal was promoted/)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe('Hiring contact (POC) hard delete', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    guardAgainstNativeDialogs(page);
    await page.route('**/api/wizmatch/staffing/companies', (route) => json(route, { items: [{ id: 'co-1', name: 'Acme Corp' }] }));
    await page.route('**/api/wizmatch/companies/co-1/contacts', (route) => json(route, {
      items: [{ id: 'poc-1', first_name: 'Asha', last_name: 'Rao', relationship_stage: 'active', roles: ['hiring_manager'], email: 'asha@acme.test', active_requirement_count: 0 }],
    }));
    await page.route('**/api/wizmatch/staffing/company-contacts/poc-1', (route) => json(route, {
      contact: { id: 'poc-1', company_id: 'co-1', company_name: 'Acme Corp', first_name: 'Asha', last_name: 'Rao', roles: ['hiring_manager'], email: 'asha@acme.test', relationship_stage: 'active', source_type: 'manual' },
      requirements: [], events: [], tasks: [],
    }));
    await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [] }));
  });

  async function openPocDrawer(page: Page) {
    await page.goto('/wizmatch/hiring-contacts');
    await page.getByRole('row').filter({ hasText: 'Asha Rao' }).click();
    await expect(page.getByRole('heading', { name: 'Asha Rao' })).toBeVisible();
  }

  test('hard-deletes the relationship and makes clear the CRM contact is kept', async ({ page }) => {
    let deleteCalled = false;
    await page.route('**/api/wizmatch/companies/co-1/contacts/poc-1/hard', async (route) => { deleteCalled = true; await json(route, { deleted: true, id: 'poc-1' }); });

    await openPocDrawer(page);
    await page.getByRole('button', { name: 'Delete permanently' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/CRM contact record.*are kept/i)).toBeVisible();
    await dialog.getByLabel(/reason/i).fill('duplicate POC');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();

    await expect.poll(() => deleteCalled).toBe(true);
  });

  test('shows the 409 dependency message when the POC still has a submission/interview', async ({ page }) => {
    await page.route('**/api/wizmatch/companies/co-1/contacts/poc-1/hard', (route) => json(route, { error: 'has_dependencies', message: 'Cannot delete — this hiring contact has 1 submission(s). Deactivate the relationship instead (the CRM contact record is always kept).' }, 409));

    await openPocDrawer(page);
    await page.getByRole('button', { name: 'Delete permanently' }).click();

    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel(/reason/i).fill('cleanup');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();

    await expect(dialog.getByText(/Cannot delete — this hiring contact has 1 submission/)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
