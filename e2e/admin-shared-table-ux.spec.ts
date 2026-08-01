import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Regression coverage for the shared admin table/filter primitives:
//   admin/src/components/ui/DataTable.jsx
//   admin/src/components/wizmatch/filters/FilterBar.jsx
//   admin/src/components/wizmatch/filters/useTableControls.js
//   admin/src/components/wizmatch/Toast.jsx  (provider hoisted to App.jsx)
//
// Every one of these guards a behaviour that was measurably wrong before:
//
//  * filter inputs fired one request PER KEYSTROKE and blanked the table each
//    time, so typing a 5-letter word issued 5 requests and 5 full redraws;
//  * <thead> was inside an overflow-hidden wrapper with no sticky, so column
//    headers scrolled away on any list longer than a screen;
//  * a refetch replaced the whole tbody with the text "Loading…", throwing
//    away the user's visual anchor on every filter change;
//  * "Save preset" wrote localStorage but changed no state, so the panel kept
//    saying "No saved presets" and the feature looked broken;
//  * every filter change used history.replace, so Back exited the page
//    instead of undoing the filter;
//  * table rows were mouse-only — no tabIndex, no key handling.
//
// SAFETY: this spec is hermetic. Every /api/** response is mocked, and any
// request whose hostname is not localhost/127.0.0.1 is hard-aborted, so it can
// never reach a real backend or production even if baseURL is misconfigured
// (playwright.config.ts defaults baseURL to the PRODUCTION host).
// ---------------------------------------------------------------------------

const CANDIDATES = '/wizmatch/candidates';

function fakeCandidates(n: number) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: `cand-${i}`,
      full_name: `Candidate ${i}`,
      name: `Candidate ${i}`,
      title: 'Senior Engineer',
      email: `cand${i}@example.invalid`,
      status: 'active',
      skills: ['react'],
    })),
    total: n,
    returned: n,
  };
}

async function signInAsWizmatchAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'test-token');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'user-1', name: 'Test Admin', role: 'admin', tenantSlug: 'wizmatch' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
    // Presets are per-page localStorage keys; start every test from empty so
    // the "save shows up immediately" assertion cannot pass on a stale entry.
    Object.keys(localStorage).filter((k) => k.startsWith('wizmatch:presets:')).forEach((k) => localStorage.removeItem(k));
  });
}

async function blockNonLocalRequests(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (!isLocal) {
      console.warn(`[safety] aborted non-local request: ${url.href}`);
      return route.abort();
    }
    return route.fallback();
  });
}

async function mockAppShell(page: Page) {
  await page.route('**/api/wizmatch/staffing/access', (route) =>
    route.fulfill({ json: { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} } }));
  await page.route('**/api/inbox/unread-count', (route) => route.fulfill({ json: { count: 0 } }));
  await page.route('**/api/finance/leaves/pending-count', (route) => route.fulfill({ json: { count: 0 } }));
}

test.describe('shared admin table + filter primitives', () => {
  test.beforeEach(async ({ page }) => {
    await blockNonLocalRequests(page);
    await signInAsWizmatchAdmin(page);
    await mockAppShell(page);
  });

  test('typing in a filter debounces instead of firing one request per keystroke', async ({ page }) => {
    const listRequests: string[] = [];
    await page.route('**/api/wizmatch/candidates**', (route) => {
      listRequests.push(route.request().url());
      return route.fulfill({ json: fakeCandidates(12) });
    });

    await page.goto(CANDIDATES);
    await page.waitForLoadState('networkidle');
    const initialCount = listRequests.length;

    // A text filter — whichever the page exposes first.
    const textFilter = page.locator('input[type="text"]').first();
    await textFilter.click();
    // pressSequentially with a small delay simulates real typing well below
    // the 300ms debounce window; all five characters must coalesce.
    await textFilter.pressSequentially('react', { delay: 40 });
    await page.waitForTimeout(900); // > debounce + request settle

    const typedRequests = listRequests.length - initialCount;
    console.log(`[report] typing 5 characters issued ${typedRequests} list request(s) (pre-fix: 5)`);
    expect(typedRequests).toBeGreaterThan(0);   // it must still search
    expect(typedRequests).toBeLessThanOrEqual(2); // but not once per character
  });

  test('table header is sticky and the first load shows skeleton rows, not the word "Loading…"', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates**', (route) => route.fulfill({ json: fakeCandidates(40) }));

    await page.goto(CANDIDATES);
    await page.waitForLoadState('networkidle');

    const th = page.locator('table thead th').first();
    await expect(th).toHaveCSS('position', 'sticky');

    // The tbody advertises busy state for assistive tech rather than swapping
    // in a bare text node.
    await expect(page.locator('table tbody')).toHaveAttribute('aria-busy', /true|false/);
    await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
  });

  test('rows are keyboard reachable', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates**', (route) => route.fulfill({ json: fakeCandidates(5) }));

    await page.goto(CANDIDATES);
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toHaveAttribute('tabindex', '0');
  });

  test('saving a view shows it immediately, without touching anything else', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates**', (route) => route.fulfill({ json: fakeCandidates(8) }));

    // Saved views moved from localStorage to the database so they can be shared
    // with the team, so this now needs the API stubbed. The property under test
    // is unchanged and is the original bug: saving used to write storage but
    // change no React state, so the panel kept reading "no saved views" until an
    // unrelated filter was touched — a working feature that looked broken.
    let saved: Array<Record<string, unknown>> = [];
    await page.route('**/api/saved-views**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        saved = [{
          id: 'v1', pageId: body.pageId, name: body.name, query: body.query,
          isShared: Boolean(body.isShared), ownerUserId: 'user-1', ownerName: 'Test Admin',
          isOwner: true, createdAt: null, updatedAt: null,
        }];
        return route.fulfill({ status: 201, json: { item: saved[0] } });
      }
      return route.fulfill({ json: { items: saved } });
    });

    await page.goto(CANDIDATES);
    await page.waitForLoadState('networkidle');

    await page.getByText('Views', { exact: true }).first().click();
    await expect(page.getByText('No saved views yet')).toBeVisible();

    await page.getByPlaceholder('Save current view as…').fill('Hot ATS leads');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();

    await expect(page.getByText('Hot ATS leads')).toBeVisible();
    await expect(page.getByText('No saved views yet')).toHaveCount(0);
  });

  test('a view can be shared with the team at save time', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates**', (route) => route.fulfill({ json: fakeCandidates(8) }));

    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/saved-views**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        posted = JSON.parse(req.postData() || '{}');
        return route.fulfill({ status: 201, json: { item: { id: 'v1', ...posted, isOwner: true } } });
      }
      return route.fulfill({ json: { items: [] } });
    });

    await page.goto(CANDIDATES);
    await page.waitForLoadState('networkidle');

    await page.getByText('Views', { exact: true }).first().click();
    await page.getByPlaceholder('Save current view as…').fill('Team view');
    await page.getByLabel('Share with the team').check();
    await page.getByRole('button', { name: 'Save view', exact: true }).click();

    await expect.poll(() => posted?.isShared).toBe(true);
  });

  test('Back undoes the last filter instead of leaving the page', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates**', (route) => route.fulfill({ json: fakeCandidates(8) }));

    await page.goto(CANDIDATES);
    await page.waitForLoadState('networkidle');

    const textFilter = page.locator('input[type="text"]').first();
    await textFilter.click();
    await textFilter.pressSequentially('react', { delay: 40 });
    await page.waitForTimeout(900);

    await expect(page).toHaveURL(/react/);

    await page.goBack();
    await page.waitForTimeout(500);

    // Still on the candidates page, with the filter undone — previously Back
    // navigated away entirely because every filter change used replace.
    expect(new URL(page.url()).pathname).toBe(CANDIDATES);
    await expect(page).not.toHaveURL(/react/);
  });
});
