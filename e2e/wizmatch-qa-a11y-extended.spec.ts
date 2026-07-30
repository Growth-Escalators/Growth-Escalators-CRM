import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// QA lane 3 addition (2026-07-30) — extends the axe-core coverage in
// e2e/wizmatch-a11y.spec.ts (Today, Companies, Hiring Contacts, Candidates,
// Submissions, Placements, Reports) to the remaining pages named in the QA
// brief: Login, Job Leads, Company Policy, Requirements, Duplicate
// Companies. Deliberately a NEW file (not an edit to the existing spec) per
// this lane's file-write constraints. Same mocked-session, mocked-API
// pattern as the existing spec and wizmatch-e2e-hardening-navigation.spec.ts
// — no real backend required, runs in Phase 1.
//
// SAFETY: every route not explicitly listed here is asserted to stay on
// http://127.0.0.1:5184 (the Playwright-managed admin dev server) or
// resolve through page.route() mocks — see the guardOutboundNetwork()
// helper, which fails the test immediately on any other host.

const session = {
  token: 'local-wizmatch-qa-a11y-token',
  user: {
    id: 'qa-a11y-user-1',
    name: 'QA A11y Admin',
    email: 'qa-a11y-admin@example.invalid',
    role: 'admin',
    tenantSlug: 'wizmatch',
  },
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
  await page.route('**/api/wizmatch/staffing/access', (route) =>
    json(route, {
      allowed: true,
      phases: { A: true, B: true, C: true },
      capabilities: { viewCommercial: true, operateDelivery: true, approveSubmissions: true, manageOffers: true, manageFinance: true },
    }));
  await page.route('**/api/inbox/unread-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/finance/leaves/pending-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/wizmatch/dashboard', (route) => json(route, {}));
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [{ id: 'u1', name: 'QA Recruiter', role: 'admin' }] }));
}

/** Required deliverable per the QA brief: any request to a non-localhost
 * host fails the test immediately instead of silently succeeding/hanging.
 *
 * Carve-out: the admin app's index.html unconditionally links Google Fonts
 * (fonts.googleapis.com / fonts.gstatic.com) — pure static CSS/font assets,
 * unrelated to the safety property this guard exists to prove (no real
 * outreach/provider/payment traffic). Confirmed present in the pre-existing
 * baseline run too (it is not new behaviour introduced by this lane).
 * Blocking it would fail every single test on an irrelevant network call
 * and mask the signal this guard is actually for, so it is explicitly
 * allowlisted here. Nothing else is exempted. */
function guardOutboundNetwork(page: Page) {
  const allowedHosts = ['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!allowedHosts.includes(url.hostname)) {
      throw new Error(`Unexpected outbound network request to non-localhost host: ${request.url()}`);
    }
  });
}

async function assertNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')})`)
      .join('\n');
    throw new Error(`${label}: ${blocking.length} critical/serious a11y violation(s):\n${summary}`);
  }
}

test.describe('QA lane 3 — extended accessibility scan (mocked, no backend)', () => {
  test.beforeEach(async ({ page }) => {
    guardOutboundNetwork(page);
  });

  test('Login — unauthenticated form', async ({ page }) => {
    // Deliberately NOT calling installWizmatchSession — this is the one
    // page a real user reaches with no session at all.
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Login (initial)');

    // Keyboard-only path: Tab should reach the email field without a mouse.
    await page.keyboard.press('Tab');
    // First tab stop is a tenant-picker button; keep tabbing until an input
    // is focused, bounded so a real regression (focus trap / dead end)
    // fails fast rather than hanging.
    let reachedInput = false;
    for (let i = 0; i < 10; i++) {
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      if (tag === 'INPUT') { reachedInput = true; break; }
      await page.keyboard.press('Tab');
    }
    expect(reachedInput).toBe(true);

    // Submitting empty required fields must not silently no-op or throw —
    // native HTML5 required validation should block submission and axe
    // must still find no serious violations in that state.
    await page.getByRole('button', { name: 'Sign in' }).click();
    await assertNoSeriousViolations(page, 'Login (empty submit attempt)');

    // Forgot-password mode switch is reachable and keyboard-operable.
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('button', { name: 'Send Reset Code' })).toBeVisible();
    await assertNoSeriousViolations(page, 'Login (forgot-password mode)');
  });

  test('Job Leads (signals) — list + detail drawer', async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    await page.route('**/api/wizmatch/signals?**', (route) => json(route, {
      items: [{
        // Column render keys off `job_title` (WizmatchSignalsPage.jsx:45),
        // not `title` — verified against the actual SIGNAL_COLUMNS render fns.
        id: 'sig1', job_title: 'QA Signal Co — Java Developer', status: 'new', region: 'india',
        company_name: 'QA Signal Co', source: 'github', days_open: 2, score: 70, created_at: new Date().toISOString(),
      }],
      total: 1,
    }));
    await page.route('**/api/wizmatch/signals/sig1', (route) => json(route, {
      id: 'sig1', job_title: 'QA Signal Co — Java Developer', status: 'new', region: 'india',
      company_name: 'QA Signal Co', source: 'github', created_at: new Date().toISOString(),
      description: 'Synthetic QA fixture signal.',
    }));
    await page.route('**/api/wizmatch/sourcing/status', (route) => json(route, { runs: [] }));

    await page.goto('/wizmatch/job-leads');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Job Leads (list)');

    await page.getByText('QA Signal Co — Java Developer').click();
    await assertNoSeriousViolations(page, 'Job Leads (detail open)');
  });

  test('Requirements — list + create form', async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, {
      items: [{ id: 'req1', title: 'QA Requirement', stage: 'draft', company_name: 'QA Signal Co', positions: 1 }],
      total: 1,
    }));
    await page.route('**/api/wizmatch/staffing/companies', (route) => json(route, {
      items: [{ id: 'c1', name: 'QA Signal Co' }],
    }));

    await page.goto('/wizmatch/requirements');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Requirements (list)');

    await page.getByRole('button', { name: 'New Requirement' }).click();
    await expect(page.getByRole('heading', { name: 'New Requirement' })).toBeVisible();
    await assertNoSeriousViolations(page, 'Requirements (new-requirement form open)');
  });

  test('Company Policy — cold-start root policy inside the Companies drawer', async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    await page.route('**/api/wizmatch/staffing/companies*', (route) => json(route, {
      items: [{ id: 'c1', name: 'QA Policy Company', domain: 'qa-policy.example', contact_count: 0, open_requirement_count: 0 }],
    }));
    await page.route('**/api/wizmatch/staffing/companies/c1', (route) => json(route, {
      company: { id: 'c1', name: 'QA Policy Company', domain: 'qa-policy.example' },
      contacts: [], requirements: [], tasks: [], events: [],
    }));
    await page.route('**/api/wizmatch/companies/c1/policy', (route) => json(route, {
      effective: {
        rootRow: true,
        outreachEligibility: { value: 'eligible', scopeKey: 'entire_company' },
        externalHiringPolicy: { value: 'accepts_external_vendors', scopeKey: 'entire_company' },
        relationshipType: { value: 'new_prospect', scopeKey: 'entire_company' },
      },
      scoped: [{ id: 'row1', scopeType: 'entire_company', scopeKey: 'entire_company', isNonOverridable: false, reviewDate: null }],
      history: [{ id: 'h1', reasonCode: 'cold_start_bootstrap', reason: 'Created with the company (PR 4 backfill).', createdAt: new Date().toISOString() }],
      accountOwnerUserId: null,
    }));

    await page.goto('/wizmatch/companies');
    await page.waitForLoadState('networkidle');
    await page.getByText('QA Policy Company').click();
    await expect(page.getByRole('heading', { name: 'QA Policy Company' })).toBeVisible();
    await expect(page.getByText('Policy', { exact: true })).toBeVisible();
    await assertNoSeriousViolations(page, 'Company Policy (root row, drawer)');

    // History and Write policy are both keyboard-operable disclosure toggles.
    await page.getByRole('button', { name: /History/ }).click();
    await assertNoSeriousViolations(page, 'Company Policy (history expanded)');
  });

  test('Duplicate Companies — pending pair + resolve dialog', async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    await page.route('**/api/wizmatch/companies/duplicates?**', (route) => json(route, {
      duplicates: [{
        id: 'dup1', resolution: 'pending', detectionRule: 'domain',
        companyA: { id: 'c1', name: 'QA Dup Co', domain: 'qa-dup.example' },
        companyB: { id: 'c2', name: 'QA Dup Co Inc', domain: 'qa-dup.example' },
      }],
    }));

    await page.goto('/wizmatch/duplicates');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Duplicate Companies (pending list)');

    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog).toBeVisible();
    await assertNoSeriousViolations(page, 'Duplicate Companies (resolve dialog open)');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('mobile viewport (390x844) — no horizontal clipping on Today, Job Leads, Requirements', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWizmatchSession(page);
    await installBaseMocks(page);
    await page.route('**/api/wizmatch/staffing/my-work', (route) => json(route, { requirements: [], tasks: [] }));
    await page.route('**/api/wizmatch/today/queues*', (route) => json(route, {
      readyToContact: [], needsReview: [], pausedOrBlocked: [], repliesNeedingAction: [],
      counts: { readyToContact: 0, needsReview: 0, repliesNeedingAction: 0, pausedOrBlocked: 0 },
      partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
    }));
    await page.route('**/api/wizmatch/signals?**', (route) => json(route, { items: [], total: 0 }));
    await page.route('**/api/wizmatch/sourcing/status', (route) => json(route, { runs: [] }));
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [], total: 0 }));

    for (const path of ['/wizmatch/today', '/wizmatch/job-leads', '/wizmatch/requirements']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasHorizontalOverflow, `${path} overflows horizontally at 390px`).toBe(false);
    }
  });
});
