import { expect, test, type Page, type Route } from '@playwright/test';

// Matching-UX improvements: wire the actionable Gate-B "Recalculate matches"
// affordance into the requirement drawer, make Talent Matching reachable, add
// the requirement ?id= deep-link, the no-skills hint, and the signal→requirement
// CTA. Mocked-session specs (no backend), matching the wizmatch-*-local style.

const session = {
  token: 'local-wizmatch-matching-ux-token',
  user: { id: 'mux-user-1', name: 'MUX Admin', email: 'mux-admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
};

async function installWizmatchSession(page: Page) {
  await page.addInitScript((value) => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', value.token);
    localStorage.setItem('wizmatch_crm_user', JSON.stringify(value.user));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true, staffingPhaseB: true }));
    localStorage.setItem('ge_crm_token', 'local-growth-token');
  }, session);
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installBaseMocks(page: Page) {
  await page.route('**/api/**', (route) => json(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/staffing/access', (route) => json(route, { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} }));
  await page.route('**/api/inbox/unread-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/finance/leaves/pending-count', (route) => json(route, { count: 0 }));
}

function guardAgainstNativeDialogs(page: Page) {
  page.on('dialog', (dialog) => { throw new Error(`Unexpected native ${dialog.type()} dialog: "${dialog.message()}"`); });
}

const REQ_WITH_SKILLS = {
  id: 'req-1', title: 'Senior Java Developer', company_id: 'co-1', company_name: 'Acme Corp', status: 'draft', stage: 'draft',
  required_skills: ['Java', 'Spring Boot'], match_count: 2,
};

// RequirementOperations (inside the drawer) loads a 360 payload + its sibling
// lists on mount; give them valid shapes so the drawer renders.
async function installDrawerOperationsMocks(page: Page, requirementId = 'req-1') {
  await page.route(`**/api/wizmatch/staffing/requirements/${requirementId}`, (route) => json(route, {
    requirement: { id: requirementId, stage: 'draft' }, contacts: [], assignments: [], events: [],
  }));
  await page.route('**/api/wizmatch/companies/**/contacts', (route) => json(route, { items: [] }));
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [] }));
}

const MATCHES = [
  { id: 'm-hi', candidate_id: 'c1', first_name: 'Priya', last_name: 'Sharma', score: 82, dimensions: { mandatorySkills: 45 }, blockers: [], missing_evidence: [], human_decision: 'unreviewed' },
  { id: 'm-lo', candidate_id: 'c2', first_name: 'Rahul', last_name: 'Verma', score: 0, dimensions: {}, blockers: ['missing_mandatory:Spring Boot'], missing_evidence: [], human_decision: 'unreviewed' },
];

test.describe('Requirement drawer — Gate-B recalculate matches', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    guardAgainstNativeDialogs(page);
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [REQ_WITH_SKILLS], total: 1 }));
    await installDrawerOperationsMocks(page, 'req-1');
    await installDrawerOperationsMocks(page, 'req-2');
  });

  test('Recalculate button hits the Gate-B endpoint and renders ranked matches, sorted with hide-blocked', async ({ page }) => {
    let recalcCalled = false;
    await page.route('**/api/wizmatch/staffing/requirements/req-1/matches/recalculate', async (route) => { recalcCalled = true; await json(route, { recalculated: 2 }); });
    await page.route('**/api/wizmatch/staffing/requirements/req-1/matches', (route) => json(route, { items: MATCHES }));

    await page.goto('/wizmatch/requirements');
    await page.getByRole('row').filter({ hasText: 'Senior Java Developer' }).click();

    const panel = page.locator('section').filter({ hasText: 'Matched candidates' });
    await panel.getByRole('button', { name: /Recalculate matches/ }).click();

    await expect.poll(() => recalcCalled).toBe(true);
    await expect(panel.getByText('Priya Sharma')).toBeVisible();
    await expect(panel.getByText('Rahul Verma')).toBeVisible();
    // Highest score first.
    const names = await panel.locator('p.font-semibold').allInnerTexts();
    expect(names.join(' ').indexOf('Priya')).toBeLessThan(names.join(' ').indexOf('Rahul'));
    // Hide-blocked removes the score-0 blocked candidate.
    await panel.getByRole('checkbox', { name: /Hide blocked/ }).check();
    await expect(panel.getByText('Rahul Verma')).toHaveCount(0);
    await expect(panel.getByText('Priya Sharma')).toBeVisible();
  });

  test('shows the "add must-have skills first" hint when the requirement has no mandatory skills', async ({ page }) => {
    const noSkills = { ...REQ_WITH_SKILLS, id: 'req-2', title: 'Vague Role', required_skills: [], match_count: 0 };
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [noSkills], total: 1 }));

    await page.goto('/wizmatch/requirements');
    await page.getByRole('row').filter({ hasText: 'Vague Role' }).click();

    const panel = page.locator('section').filter({ hasText: 'Matched candidates' });
    await expect(panel.getByText(/Add must-have skills to this requirement first/)).toBeVisible();
  });

  test('a match_count badge renders on the requirement row', async ({ page }) => {
    await page.goto('/wizmatch/requirements');
    await expect(page.getByRole('row').filter({ hasText: 'Senior Java Developer' }).getByText('2 matched')).toBeVisible();
  });
});

test.describe('Requirement deep-link + signal handoff', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    guardAgainstNativeDialogs(page);
  });

  test('?id= opens the requirement detail drawer directly', async ({ page }) => {
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [], total: 0 }));
    await page.route('**/api/wizmatch/requirements/req-1', (route) => json(route, REQ_WITH_SKILLS));
    await page.route('**/api/wizmatch/staffing/requirements/req-1/matches', (route) => json(route, { items: [] }));
    await installDrawerOperationsMocks(page, 'req-1');

    await page.goto('/wizmatch/requirements?id=req-1');
    await expect(page.getByRole('heading', { name: 'Senior Java Developer' })).toBeVisible();
  });
});

test.describe('Talent Matching reachable + empty-state CTA', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    guardAgainstNativeDialogs(page);
  });

  test('empty recruiter queue shows a CTA to Requirements', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/recruiter-work', (route) => json(route, { items: [] }));
    await page.goto('/wizmatch/talent-matching');
    await expect(page.getByText(/No candidate matches need your review yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Go to Requirements/ })).toBeVisible();
  });
});
