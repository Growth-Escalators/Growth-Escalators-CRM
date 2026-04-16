import { test, expect, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';

const RAILWAY_URL = 'https://web-production-311da.up.railway.app';
const BASE = process.env.E2E_BASE_URL || `${RAILWAY_URL}/crm`;
const JWT_SECRET = process.env.JWT_SECRET || '';

function makeToken(): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET env var required');
  return jwt.sign({
    id: 'e480cc54-730a-4587-9374-33b681b6bbf0',
    email: 'jatin@growthescalators.com',
    tenantId: '3ff1e516-7612-477b-a778-4b84659767fa',
    role: 'admin', tokenVersion: 4,
  }, JWT_SECRET, { expiresIn: '1h' });
}

async function auth(page: Page, path: string) {
  const token = makeToken();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t: string) => {
    localStorage.setItem('ge_crm_token', t);
    localStorage.setItem('ge_crm_user', JSON.stringify({
      id: 'e480cc54-730a-4587-9374-33b681b6bbf0',
      name: 'Jatin', email: 'jatin@growthescalators.com', role: 'admin',
    }));
  }, token);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
}

test.describe('Finance Page', () => {
  test('loads with all 6 tabs', async ({ page }) => {
    await auth(page, '/finance');
    // Use heading to avoid matching sidebar
    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible({ timeout: 10000 });
    // Tab buttons
    for (const tab of ['Overview', 'Expenses', 'Income', 'Team', 'Attendance', 'Categories']) {
      await expect(page.locator('button').filter({ hasText: tab }).first()).toBeVisible();
    }
  });

  test('overview shows P&L cards and trend', async ({ page }) => {
    await auth(page, '/finance');
    await expect(page.locator('text=Revenue').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Profit').first()).toBeVisible();
    await expect(page.getByText('6-Month P&L Trend')).toBeVisible({ timeout: 10000 });
  });

  test('expenses: form + Export CSV visible', async ({ page }) => {
    await auth(page, '/finance');
    await page.locator('button').filter({ hasText: 'Expenses' }).first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByRole('heading', { name: 'Add Expense' })).toBeVisible();
    await expect(page.getByPlaceholder('Description *')).toBeVisible();
    await expect(page.getByText('Export CSV')).toBeVisible();
  });

  test('expenses: add, edit, cancel, delete', async ({ page }) => {
    await auth(page, '/finance');
    await page.locator('button').filter({ hasText: 'Expenses' }).first().click();
    await page.waitForTimeout(1500);

    // Add expense
    await page.getByPlaceholder('Description *').fill('PW_TEST_EXP');
    await page.getByPlaceholder('Amount *').fill('555');
    await page.getByRole('button', { name: 'Add Expense' }).click();
    await page.waitForTimeout(2500);

    // Verify it's in the table
    await expect(page.getByText('PW_TEST_EXP')).toBeVisible({ timeout: 5000 });

    // Click edit on the row
    const row = page.locator('tr').filter({ hasText: 'PW_TEST_EXP' });
    await row.locator('[title="Edit"]').click();
    await page.waitForTimeout(500);

    // Edit mode: heading changes, Update button appears
    await expect(page.getByRole('heading', { name: 'Edit Expense' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update Expense' })).toBeVisible();

    // Cancel returns to Add mode
    await page.getByText('Cancel').click();
    await expect(page.getByRole('heading', { name: 'Add Expense' })).toBeVisible();

    // Delete
    page.on('dialog', d => d.accept());
    await row.locator('[title="Delete"]').click();
    await page.waitForTimeout(2500);
    await expect(page.getByText('PW_TEST_EXP')).not.toBeVisible({ timeout: 5000 });
  });

  test('income: add, edit, cancel, delete', async ({ page }) => {
    await auth(page, '/finance');
    await page.locator('button').filter({ hasText: 'Income' }).first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByRole('heading', { name: 'Add Income' })).toBeVisible();

    // Add income
    await page.getByPlaceholder('Source *').fill('PW_TEST_INC');
    await page.getByPlaceholder('Amount *').fill('2000');
    await page.getByRole('button', { name: 'Add Income' }).click();
    await page.waitForTimeout(2500);

    await expect(page.getByText('PW_TEST_INC')).toBeVisible({ timeout: 5000 });

    // Edit
    const row = page.locator('tr').filter({ hasText: 'PW_TEST_INC' });
    await row.locator('[title="Edit"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Edit Income' })).toBeVisible();
    await page.getByText('Cancel').click();

    // Delete
    page.on('dialog', d => d.accept());
    await row.locator('[title="Delete"]').click();
    await page.waitForTimeout(2500);
    await expect(page.getByText('PW_TEST_INC')).not.toBeVisible({ timeout: 5000 });
  });

  test('team tab shows payroll', async ({ page }) => {
    await auth(page, '/finance');
    await page.locator('button').filter({ hasText: 'Team' }).first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByText('Team Payroll')).toBeVisible();
    await expect(page.getByText('Total Monthly Payroll')).toBeVisible({ timeout: 5000 });
  });

  test('categories tab', async ({ page }) => {
    await auth(page, '/finance');
    await page.locator('button').filter({ hasText: 'Categories' }).first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByText('Expense Categories')).toBeVisible();
    await expect(page.getByText('Software & Tech')).toBeVisible({ timeout: 5000 });
  });

  test('attendance tab', async ({ page }) => {
    await auth(page, '/finance');
    await page.locator('button').filter({ hasText: 'Attendance' }).first().click();
    await page.waitForTimeout(1500);

    await expect(page.getByText('Mark Attendance')).toBeVisible();
  });
});
