import { test as setup, expect } from '@playwright/test';

// Shared auth state — login once, reuse token across all tests
setup('authenticate', async ({ page }) => {
  const baseURL = process.env.E2E_BASE_URL || 'https://web-production-311da.up.railway.app';

  // Navigate to CRM login page
  await page.goto(`${baseURL}/crm/login`);
  await page.waitForLoadState('networkidle');

  // Fill login credentials (admin account)
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  const passwordInput = page.locator('input[type="password"], input[name="password"]');

  if (await emailInput.isVisible({ timeout: 5000 })) {
    await emailInput.fill(process.env.E2E_EMAIL || 'jatin@growthescalators.com');
    await passwordInput.fill(process.env.E2E_PASSWORD || '');

    // Click login button
    const loginBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await loginBtn.click();

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard**', { timeout: 10000 }).catch(() => {});
  }

  // Save auth state for reuse
  await page.context().storageState({ path: './e2e/.auth/user.json' });
});
