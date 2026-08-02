import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Verifies the Requirements form's accessible-name fixes actually hold under axe,
// rather than trusting that the attributes were added.
//
// 2026-08-02 REPAIR. This spec had the same two structural defects as the rest
// of the a11y suite and could not have failed on the 381 violation nodes the
// production sweep measured:
//
//   1. Every /api/ call was answered `{ items: [], total: 0 }`, so the
//      Requirements table rendered its EMPTY state. `label` and `select-name`
//      violations live on per-row and per-filter controls that only exist once
//      rows do — the assertion below was checking a page with nothing on it.
//      Fixed by FIXTURE_LIST plus assertRendered(), which fails if the page
//      redirected or rendered empty instead of scoring a meaningless zero.
//   2. Results were filtered to critical/serious, so the moderate
//      landmark/heading rules could never fail. Fixed by the enumerated gate
//      below.
const SESSION = {
  token: 'local-qa-a11y-token',
  user: { id: 'u1', name: 'QA Admin', email: 'test-admin-one@example.invalid', role: 'admin', tenantId: 't1', tenantSlug: 'wizmatch' },
};

// Non-empty catch-all fixture — same shape as
// e2e/walkthrough/axe-local.walkthrough.ts, which rendered 5 rows and 65 inputs
// on /wizmatch/requirements with this payload.
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
  requirements: FIXTURE_ROWS,
  total: FIXTURE_ROWS.length, count: FIXTURE_ROWS.length, ok: true,
};

// Enumerated moderate landmark/heading rules. The old critical/serious filter
// made all of these structurally invisible; gating them by a NUMBER (0 here)
// means the count can only go down. /wizmatch/requirements renders through
// AppLayout and measured ZERO nodes for all five in the local axe run of
// 2026-08-02, so 0 is a measurement rather than an aspiration. If one of these
// ever needs raising, write down what the number represents and what has to
// change for it to come back down.
const MODERATE_LANDMARK_RULES = [
  'landmark-unique',
  'page-has-heading-one',
  'heading-order',
  'landmark-one-main',
  'region',
] as const;
const MODERATE_ALLOWANCE: Partial<Record<(typeof MODERATE_LANDMARK_RULES)[number], number>> = {};

/**
 * Fails unless the page actually mounted AND the seeded rows are on screen.
 * A route guard redirect or an empty table both score zero axe violations and
 * read exactly like a clean page — that false negative is what this repair
 * removes. `tr[tabindex="0"]` is the data-row marker: DataTable.jsx renders one
 * <tr> for the empty state and eight skeleton <tr>s while loading, so counting
 * `table tbody tr` proves nothing.
 */
async function assertRendered(page: Page, expectedPath: string, minDataRows: number) {
  const landed = new URL(page.url()).pathname;
  expect(landed, `expected to be on ${expectedPath}; a route guard redirected to ${landed}`).toBe(expectedPath);
  await expect(page.getByText('Fixture Row 0').first(),
    `${expectedPath} mounted but the seeded fixture never rendered`).toBeVisible();
  const dataRows = await page.locator('table tbody tr[tabindex="0"]').count();
  expect(dataRows, `${expectedPath} rendered ${dataRows} data row(s), expected >= ${minDataRows}`)
    .toBeGreaterThanOrEqual(minDataRows);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', s.token);
    localStorage.setItem('wizmatch_crm_user', JSON.stringify(s.user));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
    localStorage.setItem('ge_crm_token', s.token);
    localStorage.setItem('ge_crm_user', JSON.stringify(s.user));
  }, SESSION);
  // Never let a test reach a non-localhost host.
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      // Access/phase gates need their own shape; everything else gets rows.
      if (u.pathname.endsWith('/staffing/access')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_LIST) });
    }
    return route.continue();
  });
});

test('Requirements page has no serious/critical accessible-name violations', async ({ page }) => {
  await page.goto('/wizmatch/requirements');
  await page.waitForLoadState('networkidle');
  // Gate the scan on rendered rows. Without this the assertions below pass on
  // an empty table, which is exactly how this spec stayed green while
  // production carried 55 `label` and 9 `select-name` nodes.
  await assertRendered(page, '/wizmatch/requirements', 1);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  const nameViolations = blocking.filter((v) =>
    ['select-name', 'input-button-name', 'button-name', 'label', 'aria-input-field-name', 'form-field-multiple-labels'].includes(v.id));
  console.log('ALL blocking:', blocking.map((v) => `${v.id}(${v.nodes.length})`).join(', ') || 'none');
  console.log('NAME-related:', nameViolations.map((v) => `${v.id}(${v.nodes.length})`).join(', ') || 'none');
  for (const v of blocking.filter((x) => x.id === 'color-contrast')) {
    for (const n of v.nodes) console.log('CONTRAST:', n.html?.slice(0, 160), '||', n.failureSummary?.split('\n').slice(0, 3).join(' '));
  }

  // Accessible names remain the headline assertion — that is what this spec is
  // named for and what the fix it verifies was about.
  expect(nameViolations, JSON.stringify(nameViolations.map((v) => ({ id: v.id, n: v.nodes.length })), null, 2)).toEqual([]);

  // Moderate landmark/heading rules, previously discarded wholesale.
  const moderateOver = MODERATE_LANDMARK_RULES
    .map((rule) => ({ rule, nodes: results.violations.find((v) => v.id === rule)?.nodes.length ?? 0 }))
    .filter(({ rule, nodes }) => nodes > (MODERATE_ALLOWANCE[rule] ?? 0));
  expect(moderateOver, `new moderate landmark/heading violation(s): ${JSON.stringify(moderateOver)}`).toEqual([]);
});
