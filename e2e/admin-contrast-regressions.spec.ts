import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ---------------------------------------------------------------------------
// Colour-contrast regressions found by the QA a11y sweep and fixed here.
// Measured against white / the element's own tint, all as NORMAL-size text
// (WCAG AA 4.5:1) because none of them qualify as large text — 14px bold is
// below the 18.66px-bold threshold:
//
//   Login "Sign in"        bg-sky-600            4.09:1 -> bg-sky-700       5.9:1
//   Job Leads score >= 8   text-success-600      3.30:1 -> text-success-700 5.0:1
//   Company Policy drawer  text-neutral-400      2.56:1 -> text-neutral-500 4.8:1
//
// The score badge is the interesting one: the >= 7 and >= 5 branches had
// already been moved to the 700 shade for exactly this reason (tailwind.config
// documents it for danger-700), and the >= 8 branch was simply missed — so the
// highest-scoring, most-looked-at leads carried the one failing badge.
//
// Hermetic: every /api/** call is mocked and non-local requests are aborted, so
// this can never reach a real backend (playwright.config defaults baseURL to
// PRODUCTION). Run with E2E_BASE_URL pointed at a local dev server.
// ---------------------------------------------------------------------------

async function blockNonLocalRequests(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (!isLocal) return route.abort();
    return route.fallback();
  });
}

async function signInAsWizmatchAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'test-token');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'user-1', name: 'Test Admin', role: 'admin', tenantSlug: 'wizmatch' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  });
}

async function mockAppShell(page: Page) {
  await page.route('**/api/wizmatch/staffing/access', (route) =>
    route.fulfill({ json: { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} } }));
  await page.route('**/api/inbox/unread-count', (route) => route.fulfill({ json: { count: 0 } }));
  await page.route('**/api/finance/leaves/pending-count', (route) => route.fulfill({ json: { count: 0 } }));
}

/** Contrast violations only — this spec is deliberately narrow. */
async function contrastViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return results.violations.flatMap((v) => v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary })));
}

test.describe('colour contrast regressions', () => {
  test.beforeEach(async ({ page }) => {
    await blockNonLocalRequests(page);
  });

  test('login page has no contrast violations (Sign in button was 4.09:1)', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    const violations = await contrastViolations(page);
    if (violations.length) console.log('[report] login contrast violations:', JSON.stringify(violations, null, 2));
    expect(violations).toHaveLength(0);
  });

  test('Job Leads score badges have no contrast violations, including the >= 8 branch', async ({ page }) => {
    await signInAsWizmatchAdmin(page);
    await mockAppShell(page);
    // One signal per score band, so every scoreColor branch renders and is
    // measured — a fixture with only mid-range scores would miss the exact
    // branch that was broken.
    await page.route('**/api/wizmatch/signals**', (route) => route.fulfill({
      json: {
        items: [9, 8, 7, 6, 4, 0].map((score, i) => ({
          id: `sig-${i}`, score,
          job_title: `Senior Engineer ${i}`,
          company_name: `Acme WizMatch Test Company ${i}`,
          status: 'scored', source: 'ats', created_at: '2026-07-01T00:00:00Z',
        })),
        total: 6,
      },
    }));
    await page.route('**/api/wizmatch/sourcing/status**', (route) => route.fulfill({ json: { providers: [] } }));

    await page.goto('/wizmatch/job-leads');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    const violations = await contrastViolations(page);
    if (violations.length) console.log('[report] job-leads contrast violations:', JSON.stringify(violations, null, 2));
    expect(violations).toHaveLength(0);
  });
});
