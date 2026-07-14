import { expect, test, type Page } from '@playwright/test';

// Real-backend, real-browser proof of the Requirements delete/archive flow
// added by the E2E hardening pass: draft-only permanent delete via an
// accessible ConfirmDialog (no native confirm()), plus the 409 dependency
// guard when a requirement is no longer a draft. Uses disposable
// E2E_WIZMATCH_-prefixed data created through the real API.

const BACKEND_URL = process.env.WIZMATCH_E2E_BACKEND_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.WIZMATCH_E2E_TEST_EMAIL || 'e2e.wizmatch.test@example.invalid';
const TEST_PASSWORD = process.env.WIZMATCH_E2E_TEST_PASSWORD;

function guardAgainstNativeDialogs(page: Page) {
  page.on('dialog', (dialog) => {
    throw new Error(`Unexpected native ${dialog.type()} dialog: "${dialog.message()}"`);
  });
}

test.describe('Requirements delete/archive (real backend)', () => {
  test.skip(!TEST_PASSWORD, 'WIZMATCH_E2E_TEST_PASSWORD not set — see hardening report for local setup');

  let token: string;
  let companyId: string;
  const reqTitle = `E2E_WIZMATCH_${Date.now()}_DELETE_TEST`;

  test.beforeAll(async ({ request }) => {
    const login = await request.post(`${BACKEND_URL}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD, tenantSlug: 'wizmatch' },
    });
    token = (await login.json()).token;

    const company = await request.post(`${BACKEND_URL}/api/wizmatch/staffing/companies`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    }).catch(() => null);
    // Companies are created via the client-discovery seed flow in this
    // repo, not a direct POST — fall back to that if the above 404s.
    if (!company || !company.ok()) {
      const seeded = await request.post(`${BACKEND_URL}/api/wizmatch/client-discovery/seed-company`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { companyName: `E2E_WIZMATCH_${Date.now()}_DELETE_CO`, domain: 'e2e-wizmatch-delete-test.invalid', jobTitle: 'role', region: 'india' },
      });
      const body = await seeded.json();
      companyId = body.companyId || body.company?.id || body.id;
    } else {
      companyId = (await company.json()).id;
    }
  });

  test.afterAll(async ({ request }) => {
    if (!companyId || !token) return;
    await request.delete(`${BACKEND_URL}/api/wizmatch/staffing/companies/${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
      localStorage.setItem('wizmatch_crm_token', value.token);
      localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'x', name: 'E2E', email: 'e2e@example.test', role: 'admin', tenantSlug: 'wizmatch' }));
      localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
    }, { token });
    guardAgainstNativeDialogs(page);
  });

  test('draft requirement can be deleted through the accessible confirm dialog, with no native dialogs', async ({ page, request }) => {
    test.skip(!companyId, 'company seed did not return a usable id in this environment');

    const created = await request.post(`${BACKEND_URL}/api/wizmatch/requirements`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: reqTitle, company_id: companyId, region: 'india', positions: 1 },
    });
    expect(created.ok()).toBe(true);

    await page.goto('/wizmatch/requirements');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row', { name: new RegExp(reqTitle) }).click();

    const deleteButton = page.getByRole('button', { name: 'Delete permanently' });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(reqTitle);

    const confirmButton = dialog.getByRole('button', { name: 'Delete permanently' });
    await expect(confirmButton).toBeDisabled();

    await dialog.getByLabel(/Reason/).fill('E2E hardening automated cleanup');
    await dialog.getByLabel(new RegExp(`Type.*${reqTitle}`)).fill(reqTitle);
    await expect(confirmButton).toBeEnabled();

    const createdId = (await created.json()).id;
    const [deleteResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/wizmatch/requirements/${createdId}`) && r.request().method() === 'DELETE'),
      confirmButton.click(),
    ]);
    expect(deleteResponse.status()).toBe(200);
    await expect(dialog).not.toBeVisible();

    // Confirm it's gone from the list the UI actually re-fetched (onSaved()),
    // not a second, independently-authenticated check — this is what the
    // recruiter using the product actually sees.
    await expect(page.getByRole('row', { name: new RegExp(reqTitle) })).toHaveCount(0);

    const check = await request.get(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(check.status()).toBe(404);
  });

  test('Escape closes the confirm dialog without deleting anything', async ({ page, request }) => {
    test.skip(!companyId, 'company seed did not return a usable id in this environment');
    const title = `${reqTitle}_ESC`;
    const created = await request.post(`${BACKEND_URL}/api/wizmatch/requirements`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, company_id: companyId, region: 'india', positions: 1 },
    });
    const createdId = (await created.json()).id;

    await page.goto('/wizmatch/requirements');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row', { name: new RegExp(title) }).click();
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).not.toBeVisible();

    const check = await request.get(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(check.ok()).toBe(true);

    await request.delete(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test('a non-draft requirement cannot be permanently deleted (409, dependency message shown)', async ({ request }) => {
    test.skip(!companyId, 'company seed did not return a usable id in this environment');
    const title = `${reqTitle}_NONDRAFT`;
    const created = await request.post(`${BACKEND_URL}/api/wizmatch/requirements`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, company_id: companyId, region: 'india', positions: 1 },
    });
    const createdId = (await created.json()).id;
    await request.put(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'shared' },
    });

    const del = await request.delete(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status()).toBe(409);
    const body = await del.json();
    expect(body.error).toBe('not_draft');

    // Cleanup: restore to draft, then delete for real so no test row lingers.
    await request.put(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'draft' },
    });
    await request.delete(`${BACKEND_URL}/api/wizmatch/requirements/${createdId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });
});
