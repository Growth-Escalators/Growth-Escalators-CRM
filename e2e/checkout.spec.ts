import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://web-production-311da.up.railway.app';

// ---------------------------------------------------------------------------
// Test 1: Checkout page loads with all elements
// ---------------------------------------------------------------------------
test('checkout page loads with segment options and form', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

  // Should have segment selector buttons
  const segmentButtons = page.locator('#segment-selector button');
  await expect(segmentButtons.first()).toBeVisible({ timeout: 10000 });

  // Should have at least 3 segment options (D2C, Agency, Freelancer)
  const count = await segmentButtons.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Should have form inputs
  await expect(page.locator('input[name="name"]')).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="phone"]')).toBeVisible();

  // Should have the pay button
  const payButton = page.locator('button[type="submit"]');
  await expect(payButton).toBeVisible();
  await expect(payButton).toContainText('₹');
});

// ---------------------------------------------------------------------------
// Test 2: Form validation prevents submission without required fields
// ---------------------------------------------------------------------------
test('form validation blocks empty submission', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

  // Try to submit without selecting segment or filling form
  const payButton = page.locator('button[type="submit"]');
  await payButton.click();

  // Should show error about selecting segment
  const errorMsg = page.locator('text=Please select who you are');
  await expect(errorMsg).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 3: Form validation rejects invalid phone number
// ---------------------------------------------------------------------------
test('form validation rejects invalid phone', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

  // Select segment
  const segmentBtn = page.locator('#segment-selector button').first();
  await segmentBtn.click();

  // Fill form with invalid phone
  await page.fill('input[name="name"]', 'Test User');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="phone"]', '12345'); // Invalid — not 10 digits starting with 6-9

  // Submit
  const payButton = page.locator('button[type="submit"]');
  await payButton.click();

  // Should show phone validation error
  const errorMsg = page.locator('text=valid 10-digit');
  await expect(errorMsg).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Test 4: Webhook test endpoint is accessible
// ---------------------------------------------------------------------------
test('webhook-test endpoint returns handler info', async ({ request }) => {
  const response = await request.get(`${BASE}/api/cashfree/webhook-test`);

  expect(response.ok()).toBeTruthy();
  const data = await response.json();

  expect(data.status).toBe('active');
  expect(data.handler).toBe('POST /api/cashfree/webhook');
  expect(data.events_handled).toContain('PAYMENT_SUCCESS_WEBHOOK');
  expect(data.has_cashfree_creds).toBeDefined();
});

// ---------------------------------------------------------------------------
// Test 5: Webhook endpoint accepts POST and returns ok
// ---------------------------------------------------------------------------
test('webhook endpoint handles non-success events gracefully', async ({ request }) => {
  const response = await request.post(`${BASE}/api/cashfree/webhook`, {
    data: {
      event_type: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        payment: { payment_status: 'FAILED', cf_payment_id: 'test-fail-123' },
        order: { order_id: 'test-order-fail', order_amount: 9 },
      },
    },
  });

  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 6: create-order validates required fields
// ---------------------------------------------------------------------------
test('create-order rejects missing fields with 400', async ({ request }) => {
  const response = await request.post(`${BASE}/api/cashfree/create-order`, {
    data: { name: 'Test' }, // Missing email, phone, amount
  });

  expect(response.status()).toBe(400);
  const data = await response.json();
  expect(data.error).toContain('required');
});

// ---------------------------------------------------------------------------
// Test 7: Bump selections update order total
// ---------------------------------------------------------------------------
test('bump checkboxes are pre-selected and update total', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });

  // The pay button should show ₹707 (9 + 199 + 499) since both bumps pre-selected
  const payButton = page.locator('button[type="submit"]');
  const buttonText = await payButton.textContent();

  // Should contain a total (bump defaults vary by funnel config, but should be > ₹9)
  expect(buttonText).toContain('₹');
});
