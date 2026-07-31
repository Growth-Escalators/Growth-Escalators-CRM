import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Regression coverage for the WizMatch admin N+1 request fan-out (perf/admin-
// request-fanout). Confirmed prod bug: the "Linked hiring contacts" tab
// (admin/src/pages/WizmatchHiringContactsPage.jsx) used to Promise.all over
// every company from GET /api/wizmatch/staffing/companies and fire one
// GET /api/wizmatch/companies/:id/contacts per company. With 183 companies in
// prod that is 183 parallel requests on a single page load — enough to trip
// the API rate limiter (429s) and make the page unusable.
//
// Fix: the admin tab now calls the single bulk aggregate endpoint
// GET /api/wizmatch/staffing/hiring-contacts (wizmatchStaffingService.
// listHiringContacts), which already existed on the backend but had no
// caller. This spec mocks every /api/** response — it needs no real backend
// or database — and asserts the page issues a small, bounded number of
// requests regardless of how many companies exist.
//
// SAFETY: every request whose hostname is not localhost/127.0.0.1 is
// hard-aborted below, so this spec can never reach a real backend or
// production, even by accident (e.g. a stray absolute-URL fetch).
// ---------------------------------------------------------------------------

const COMPANY_COUNT = 200; // mirrors "hundreds of companies" scale from the prod incident (183)

function fakeCompanies(n: number) {
  return { items: Array.from({ length: n }, (_, i) => ({ id: `company-${i}`, name: `Company ${i}` })) };
}

function fakeCompanyContacts(companyId: string) {
  return {
    items: [
      {
        id: `${companyId}-contact-1`,
        company_id: companyId,
        first_name: 'Asha',
        last_name: 'Rao',
        relationship_stage: 'active',
        roles: ['hiring_manager'],
        active_requirement_count: 1,
        next_action: null,
        email: 'asha@example.com',
        phone: null,
      },
    ],
  };
}

function fakeHiringContactsAggregate(n: number) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: `hc-${i}`,
      company_id: `company-${i}`,
      company_name: `Company ${i}`,
      first_name: 'Asha',
      last_name: `Rao ${i}`,
      relationship_stage: 'active',
      roles: ['hiring_manager'],
      active_requirement_count: i % 3,
      next_action: null,
      email: `asha${i}@example.com`,
      phone: null,
    })),
  };
}

/** Sets up a logged-in Wizmatch admin session in localStorage before any script runs. */
async function signInAsWizmatchAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'test-token');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'user-1', name: 'Test Admin', role: 'admin', tenantSlug: 'wizmatch' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  });
}

/** Hard safety net: abort anything that isn't talking to the local dev server. */
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

/** Mocks the app-shell requests every authenticated page fires on mount (Sidebar/TopBar/App). */
async function mockAppShell(page: Page) {
  await page.route('**/api/wizmatch/staffing/access', (route) =>
    route.fulfill({ json: { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} } }));
  await page.route('**/api/inbox/unread-count', (route) => route.fulfill({ json: { count: 0 } }));
  await page.route('**/api/finance/leaves/pending-count', (route) => route.fulfill({ json: { count: 0 } }));
  await page.route('**/api/wizmatch/contact-intelligence/queue**', (route) => route.fulfill({ json: { items: [] } }));
}

function countRequestsByPattern(page: Page, pattern: RegExp) {
  const matches: string[] = [];
  page.on('request', (req) => {
    if (pattern.test(req.url())) matches.push(req.url());
  });
  return matches;
}

test.describe('WizMatch admin — request fan-out', () => {
  test.beforeEach(async ({ page }) => {
    await blockNonLocalRequests(page);
    await signInAsWizmatchAdmin(page);
    await mockAppShell(page);
  });

  test('Linked hiring contacts tab issues a bounded number of requests, not one per company', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/companies', (route) => route.fulfill({ json: fakeCompanies(COMPANY_COUNT) }));
    await page.route('**/api/wizmatch/staffing/hiring-contacts', (route) => route.fulfill({ json: fakeHiringContactsAggregate(COMPANY_COUNT) }));
    // Still mocked in case a regression brings the fan-out back — without this
    // the per-company fetch would 404/hang against the app-shell catch-all.
    await page.route(/\/api\/wizmatch\/companies\/[^/]+\/contacts/, (route) => {
      const companyId = route.request().url().match(/companies\/([^/]+)\/contacts/)?.[1] || 'unknown';
      return route.fulfill({ json: fakeCompanyContacts(companyId) });
    });

    const allRequests: string[] = [];
    page.on('request', (req) => { if (/\/api\//.test(req.url())) allRequests.push(req.url()); });
    const perCompanyRequests = countRequestsByPattern(page, /\/api\/wizmatch\/companies\/[^/]+\/contacts/);

    await page.goto('/wizmatch/hiring-contacts');
    await page.waitForLoadState('networkidle');

    // The regression this guards against: a per-company fan-out would fire
    // COMPANY_COUNT (200) requests here. The bulk endpoint fires exactly one.
    expect(perCompanyRequests).toHaveLength(0);
    expect(allRequests.length).toBeLessThan(10);

    console.log(`[report] /wizmatch/hiring-contacts (linked tab) — ${COMPANY_COUNT} companies — total /api requests: ${allRequests.length}, per-company fan-out requests: ${perCompanyRequests.length}`);
  });

  test('Discovery queue tab issues a single request regardless of queue size', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/companies', (route) => route.fulfill({ json: fakeCompanies(0) }));
    await page.route('**/api/wizmatch/staffing/hiring-contacts', (route) => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/wizmatch/contact-intelligence/queue**', (route) => route.fulfill({
      json: { items: Array.from({ length: 50 }, (_, i) => ({ companyId: `c-${i}`, companyName: `Co ${i}`, contactCandidates: [{ id: `cand-${i}` }] })) },
    }));

    const allRequests: string[] = [];
    page.on('request', (req) => { if (/\/api\//.test(req.url())) allRequests.push(req.url()); });

    await page.goto('/wizmatch/hiring-contacts?tab=queue');
    await page.waitForLoadState('networkidle');

    expect(allRequests.length).toBeLessThan(10);
    console.log(`[report] /wizmatch/hiring-contacts (queue tab) — 50 queued candidates — total /api requests: ${allRequests.length}`);
  });
});
