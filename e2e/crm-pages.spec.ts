import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://web-production-311da.up.railway.app';

// ---------------------------------------------------------------------------
// Helper: navigate to CRM page and wait for load
// ---------------------------------------------------------------------------
async function goTo(page: import('@playwright/test').Page, path: string) {
  await page.goto(`${BASE}/crm${path}`, { waitUntil: 'networkidle', timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Test 1: Login page loads and has form elements
// ---------------------------------------------------------------------------
test('login page renders correctly', async ({ page }) => {
  await page.goto(`${BASE}/crm/login`);
  await page.waitForLoadState('domcontentloaded');

  // Should have email and password inputs
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
  await expect(emailInput).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// Test 2: /login redirects to /crm/login
// ---------------------------------------------------------------------------
test('bare /login redirects to /crm/login', async ({ page }) => {
  const response = await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // Should have been redirected (301)
  expect(page.url()).toContain('/crm/login');
});

// ---------------------------------------------------------------------------
// Test 3: Dashboard loads without crash
// ---------------------------------------------------------------------------
test('dashboard page loads', async ({ page }) => {
  await goTo(page, '/dashboard');

  // Should show either dashboard content or redirect to login
  const isDashboard = await page.locator('text=Welcome back').isVisible({ timeout: 5000 }).catch(() => false);
  const isLogin = page.url().includes('/login');

  expect(isDashboard || isLogin).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Test 4: SEO page loads all 6 tabs
// ---------------------------------------------------------------------------
test('SEO page renders 6 tabs', async ({ page }) => {
  await goTo(page, '/seo');

  // Check for tab buttons (may need to be logged in)
  const isLoaded = await page.locator('text=SEO Dashboard').isVisible({ timeout: 5000 }).catch(() => false);
  const isLogin = page.url().includes('/login');

  if (isLoaded) {
    // Verify all 6 tabs exist
    const tabs = ['Overview', 'Keywords', 'Content Gaps', 'Backlinks', 'Alerts', 'Workflows'];
    for (const tab of tabs) {
      const tabBtn = page.locator(`button:has-text("${tab}")`);
      await expect(tabBtn).toBeVisible({ timeout: 3000 });
    }
  } else {
    // Redirected to login — that's OK for unauthenticated test
    expect(isLogin).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Test 5: Intelligence page loads
// ---------------------------------------------------------------------------
test('intelligence page loads', async ({ page }) => {
  await goTo(page, '/intelligence');

  const isLoaded = await page.locator('text=AI Coaching').isVisible({ timeout: 5000 }).catch(() => false);
  const isLogin = page.url().includes('/login');

  expect(isLoaded || isLogin).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Test 6: Billing page loads
// ---------------------------------------------------------------------------
test('billing page loads', async ({ page }) => {
  await goTo(page, '/billing');

  const isLoaded = await page.locator('text=Billing').isVisible({ timeout: 5000 }).catch(() => false);
  const isLogin = page.url().includes('/login');

  expect(isLoaded || isLogin).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Test 7: Reports page has Weekly/Monthly toggle
// ---------------------------------------------------------------------------
test('reports page loads with report type toggle', async ({ page }) => {
  await goTo(page, '/reports');

  const isLoaded = await page.locator('text=Reports').isVisible({ timeout: 5000 }).catch(() => false);
  const isLogin = page.url().includes('/login');

  if (isLoaded) {
    const weeklyBtn = page.locator('button:has-text("Weekly")');
    const monthlyBtn = page.locator('button:has-text("Monthly")');
    await expect(weeklyBtn).toBeVisible({ timeout: 3000 });
    await expect(monthlyBtn).toBeVisible({ timeout: 3000 });
  } else {
    expect(isLogin).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Test 8: Analytics page has Lead/Team tabs
// ---------------------------------------------------------------------------
test('analytics page loads with tab toggle', async ({ page }) => {
  await goTo(page, '/analytics');

  const isLoaded = await page.locator('text=Analytics').isVisible({ timeout: 5000 }).catch(() => false);
  const isLogin = page.url().includes('/login');

  if (isLoaded) {
    const leadsBtn = page.locator('button:has-text("Lead Analytics")');
    const teamBtn = page.locator('button:has-text("Team")');
    await expect(leadsBtn).toBeVisible({ timeout: 3000 });
    await expect(teamBtn).toBeVisible({ timeout: 3000 });
  } else {
    expect(isLogin).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Test 9: Health endpoint returns valid JSON
// ---------------------------------------------------------------------------
test('health endpoint returns 200', async ({ request }) => {
  const response = await request.get(`${BASE}/health`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty('status');
});

// ---------------------------------------------------------------------------
// Test 10: API endpoints require auth (return 401 without token)
// ---------------------------------------------------------------------------
test('protected API returns 401 without auth', async ({ request }) => {
  const endpoints = [
    '/api/intelligence/reports',
    '/api/seo/overview',
    '/api/analytics/lead-sources',
    '/api/billing/stats',
  ];

  for (const endpoint of endpoints) {
    const response = await request.get(`${BASE}${endpoint}`);
    expect(response.status()).toBe(401);
  }
});
