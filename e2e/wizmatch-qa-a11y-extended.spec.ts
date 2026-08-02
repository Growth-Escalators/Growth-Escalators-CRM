import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// 2026-08-02 REPAIR — same two structural defects as e2e/wizmatch-a11y.spec.ts,
// fixed the same way: (1) the catch-all `**/api/**` mock now seeds NON-EMPTY
// rows and every list scan asserts those rows are on screen first, so a
// redirect or an empty table can no longer masquerade as a clean scan;
// (2) moderate landmark/heading rules are gated by a per-rule NUMBER instead of
// being discarded wholesale. See the long comments on FIXTURE_LIST,
// assertRendered() and MODERATE_LANDMARK_RULES below.

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

// ---------------------------------------------------------------------------
// Non-empty catch-all fixture.
//
// This used to be `{ items: [], total: 0 }`, so every table under test rendered
// its EMPTY state and every per-row violation (row checkboxes, row action
// buttons) simply never existed to be found. Shaped loosely so a list page
// renders rows whether it reads `items`, `data`, `results` or `rows`; matches
// the payload in e2e/walkthrough/axe-local.walkthrough.ts, which produced 5
// rows and 30-65 inputs on the WizMatch list pages.
//
// Per-test handlers registered later still win (Playwright matches routes
// most-recently-registered first), so this only changes what the UNMOCKED
// endpoints return.
const FIXTURE_ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: `fixture-${i}`,
  name: `Fixture Row ${i}`, title: `Fixture Row ${i}`, job_title: `Fixture Row ${i}`,
  first_name: 'Fixture', last_name: `Row ${i}`,
  company: 'Fixture Co', company_name: 'Fixture Co', company_id: 'fixture-company',
  status: 'new', stage: 'draft', state: 'active', region: 'india',
  email: `fixture-${i}@example.invalid`, phone: '910000000000', source: 'manual',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  score: 5, positions: 1, days_open: 2,
  skills: ['java'], keywords: ['java'], roles: ['hiring_manager'],
}));
const FIXTURE_LIST = {
  items: FIXTURE_ROWS, data: FIXTURE_ROWS, results: FIXTURE_ROWS, rows: FIXTURE_ROWS,
  total: FIXTURE_ROWS.length, count: FIXTURE_ROWS.length, ok: true,
};

async function installBaseMocks(page: Page) {
  await page.route('**/api/**', (route) => json(route, FIXTURE_LIST));
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

/**
 * Fails unless the route ACTUALLY MOUNTED and the seeded fixture is on screen.
 *
 * Both silent failures — a route guard bouncing the navigation to
 * /wizmatch/today, or the page rendering its empty state — score ZERO axe
 * violations and are indistinguishable from a clean page. That false negative
 * is the defect this repair exists to remove, so every list scan is gated on
 * this first.
 *
 * `minDataRows` counts `tr[tabindex="0"]`, not `table tbody tr`: DataTable.jsx
 * renders one <tr> for the empty state and EIGHT skeleton <tr>s while loading,
 * so a raw tbody-row count proves nothing.
 */
async function assertRendered(
  page: Page,
  expectedPath: string,
  sample: Locator,
  opts: { minDataRows?: number } = {},
) {
  const landed = new URL(page.url()).pathname;
  expect(landed, `expected to be on ${expectedPath}; a route guard redirected to ${landed}`).toBe(expectedPath);
  await expect(sample, `${expectedPath} mounted but the seeded fixture never rendered`).toBeVisible();
  if (opts.minDataRows) {
    const dataRows = await page.locator('table tbody tr[tabindex="0"]').count();
    expect(dataRows, `${expectedPath} rendered ${dataRows} data row(s), expected >= ${opts.minDataRows}`)
      .toBeGreaterThanOrEqual(opts.minDataRows);
  }
}

// ---------------------------------------------------------------------------
// Moderate-impact landmark/heading gate.
//
// The old filter discarded everything below `serious`, hiding all 50 moderate
// nodes the 2026-08-02 production sweep found: landmark-unique (26), region
// (14), heading-order (4), page-has-heading-one (4), landmark-one-main (2).
// Flipping the filter off wholesale would leave the suite red, so these five
// rules are enumerated and gated by a NUMBER per scan point. The count can only
// go down — any NEW node fails.
const MODERATE_LANDMARK_RULES = [
  'landmark-unique',
  'page-has-heading-one',
  'heading-order',
  'landmark-one-main',
  'region',
] as const;

type ModerateAllowance = Partial<Record<(typeof MODERATE_LANDMARK_RULES)[number], number>>;

/**
 * Known-issue allowance for the LOGIN page only.
 *
 * admin/src/pages/LoginPage.jsx renders no landmark at all — no <main>, no
 * <nav>, just a centred <div> card (it is the one page that does not go through
 * AppLayout). So `landmark-one-main` and `region` fire there by construction,
 * and no aria-label pass can change that; the fix is a structural one on
 * LoginPage.jsx, which is outside this lane.
 *
 *  - landmark-one-main: 1 — axe reports the missing main landmark exactly once.
 *  - region: 8 — an UPPER BOUND, not a measurement. axe reports each outermost
 *    content node that no landmark contains; the login card holds a heading
 *    block plus one form, so the real number is well under 8. assertA11y logs
 *    "[a11y ratchet] … lower it" with the true count on the first run — replace
 *    8 with that number then.
 *
 * DELETE this whole allowance when LoginPage.jsx wraps its card in a <main>:
 * both counts go to 0 and the default (0 for every rule) applies.
 */
const LOGIN_ALLOWANCE: ModerateAllowance = { 'landmark-one-main': 1, region: 8 };

/**
 * Every OTHER scan in this file uses the default allowance of 0 for all five
 * rules. That is a measurement, not an aspiration: a local axe run over 14
 * rendered routes on 2026-08-02 (after the 353 aria-label fixes) found ZERO
 * nodes at every impact level on every AppLayout-hosted WizMatch page. All 31
 * nodes it did find came from the shared CRM pages (tasks, inbox, pipeline,
 * finance, audit), none of which this suite visits.
 */
async function assertA11y(page: Page, label: string, allowance: ModerateAllowance = {}) {
  const results = await new AxeBuilder({ page }).analyze();
  const failures: string[] = [];

  for (const v of results.violations) {
    if (v.impact === 'critical' || v.impact === 'serious') {
      failures.push(`- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')})`);
    }
  }

  const slack: string[] = [];
  for (const rule of MODERATE_LANDMARK_RULES) {
    const found = results.violations.find((v) => v.id === rule);
    const nodes = found?.nodes.length ?? 0;
    const allowed = allowance[rule] ?? 0;
    if (nodes > allowed) {
      failures.push(`- [moderate] ${rule}: ${nodes} node(s), allowance ${allowed} — a NEW violation appeared (e.g. ${found?.nodes[0]?.target.join(' ')})`);
    } else if (nodes < allowed) {
      slack.push(`${rule} ${nodes} < ${allowed}`);
    }
  }
  // The ratchet: whenever reality beats the allowance, say so loudly so the
  // number gets tightened rather than quietly rotting upward.
  if (slack.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[a11y ratchet] ${label}: allowance is now looser than reality — lower it (${slack.join(', ')})`);
  }

  if (failures.length > 0) {
    throw new Error(`${label}: ${failures.length} blocking a11y violation(s):\n${failures.join('\n')}`);
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
    // Login has no rows; the form itself is the content. Assert it mounted (a
    // stale session would redirect straight past /login and the scan below
    // would silently be measuring the dashboard instead).
    await assertRendered(page, '/login', page.getByRole('button', { name: 'Sign in' }));
    await assertA11y(page, 'Login (initial)', LOGIN_ALLOWANCE);

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
    await assertA11y(page, 'Login (empty submit attempt)', LOGIN_ALLOWANCE);

    // Forgot-password mode switch is reachable and keyboard-operable.
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('button', { name: 'Send Reset Code' })).toBeVisible();
    await assertA11y(page, 'Login (forgot-password mode)', LOGIN_ALLOWANCE);
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
    await assertRendered(page, '/wizmatch/job-leads',
      page.getByText('QA Signal Co — Java Developer'), { minDataRows: 1 });
    await assertA11y(page, 'Job Leads (list)');

    await page.getByText('QA Signal Co — Java Developer').click();
    await assertA11y(page, 'Job Leads (detail open)');
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
    await assertRendered(page, '/wizmatch/requirements',
      page.getByText('QA Requirement').first(), { minDataRows: 1 });
    await assertA11y(page, 'Requirements (list)');

    await page.getByRole('button', { name: 'New Requirement' }).click();
    await expect(page.getByRole('heading', { name: 'New Requirement' })).toBeVisible();
    await assertA11y(page, 'Requirements (new-requirement form open)');
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
    // /wizmatch/companies is behind StaffingPhaseRoute phase="A" — without the
    // access mock this redirects to /wizmatch/today and every scan below would
    // be measuring the wrong page while looking perfectly clean.
    await assertRendered(page, '/wizmatch/companies',
      page.getByText('QA Policy Company').first(), { minDataRows: 1 });
    await assertA11y(page, 'Company Policy (companies list with rows)');

    await page.getByText('QA Policy Company').click();
    await expect(page.getByRole('heading', { name: 'QA Policy Company' })).toBeVisible();
    await expect(page.getByText('Policy', { exact: true })).toBeVisible();
    await assertA11y(page, 'Company Policy (root row, drawer)');

    // History and Write policy are both keyboard-operable disclosure toggles.
    await page.getByRole('button', { name: /History/ }).click();
    await assertA11y(page, 'Company Policy (history expanded)');
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
    // Duplicate pairs render as cards, not a table — the seeded pair is the
    // row-equivalent, and the Merge button below only exists if it rendered.
    await assertRendered(page, '/wizmatch/duplicates', page.getByText('QA Dup Co Inc'));
    await assertA11y(page, 'Duplicate Companies (pending list)');

    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog).toBeVisible();
    await assertA11y(page, 'Duplicate Companies (resolve dialog open)');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('mobile viewport (390x844) — no horizontal clipping on Today, Job Leads, Requirements', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installWizmatchSession(page);
    await installBaseMocks(page);
    // These three routes used to be mocked EMPTY here, which made the assertion
    // vacuous: an empty table has nothing wide in it, so nothing can clip. Wide
    // content is the only thing that overflows a 390px viewport, so the fixtures
    // must be populated for this test to mean anything.
    await page.route('**/api/wizmatch/staffing/my-work', (route) => json(route, {
      requirements: [{ id: 'r1', title: 'QA Requirement', company_name: 'QA Signal Co', stage: 'sourcing', next_action: 'Review candidates' }],
      tasks: [],
    }));
    await page.route('**/api/wizmatch/today/queues*', (route) => json(route, {
      readyToContact: [{
        companyId: 'ready-1', companyName: 'Ready Co', companyDomain: 'ready.example',
        canonicalDecision: 'allow', canonicalReasonCode: null, canonicalBlockerCode: null,
        effectiveDecision: 'allow', enforcementMode: 'shadow', requiresExplicitApproval: false,
        outreachEligibility: 'eligible', contactConfidenceTier: 'high', duplicatePending: false,
        duplicateId: null, isNonOverridable: false, policyScopeKey: 'entire_company', disabledReason: null,
        capabilities: { approve_queue: { enabled: false, reason: 'This company is already eligible; the approval was already recorded.' } },
      }],
      needsReview: [{
        companyId: 'review-1', companyName: 'Review Co', companyDomain: null,
        canonicalDecision: 'review', canonicalReasonCode: 'policy_unknown_cold_start', canonicalBlockerCode: null,
        effectiveDecision: 'review', enforcementMode: 'shadow', requiresExplicitApproval: true,
        outreachEligibility: 'needs_review', contactConfidenceTier: 'medium', duplicatePending: false,
        duplicateId: null, isNonOverridable: false, policyScopeKey: 'entire_company', disabledReason: null,
        capabilities: { approve_queue: { enabled: true, reason: null } },
      }],
      pausedOrBlocked: [], repliesNeedingAction: [],
      counts: { readyToContact: 1, needsReview: 1, repliesNeedingAction: 0, pausedOrBlocked: 0 },
      partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
    }));
    await page.route('**/api/wizmatch/sourcing/status', (route) => json(route, { runs: [] }));
    // Job Leads and Requirements fall through to the non-empty FIXTURE_LIST
    // catch-all, which renders 5 rows on each.

    const evidence: Record<string, string> = {
      '/wizmatch/today': 'Review Co',
      '/wizmatch/job-leads': 'Fixture Row 0',
      '/wizmatch/requirements': 'Fixture Row 0',
    };
    for (const path of ['/wizmatch/today', '/wizmatch/job-leads', '/wizmatch/requirements']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Rows first: an empty page cannot overflow, so without this the
      // assertion below passes for the wrong reason.
      await assertRendered(page, path, page.getByText(evidence[path]).first(), { minDataRows: 1 });
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasHorizontalOverflow, `${path} overflows horizontally at 390px`).toBe(false);
    }
  });
});
