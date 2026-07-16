import { expect, test, type Page, type Route } from '@playwright/test';

// Candidates 360 drawer + explainable matching (WizmatchCandidatesPage.jsx +
// MatchExplanation.jsx) — closes the "code-reviewed but not test-proven" gap
// recorded in docs/release/WIZMATCH_RELEASE_READINESS.md.

const session = {
  token: 'local-wizmatch-candidates-360-token',
  user: { id: 'c360-user-1', name: 'C360 Admin', email: 'c360-admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
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
  await page.route('**/api/wizmatch/staffing/access', (route) => json(route, { allowed: true, phases: { A: true, B: true, C: true }, capabilities: {} }));
  await page.route('**/api/inbox/unread-count', (route) => json(route, { count: 0 }));
  await page.route('**/api/finance/leaves/pending-count', (route) => json(route, { count: 0 }));
}

function guardAgainstNativeDialogs(page: Page) {
  page.on('dialog', (dialog) => { throw new Error(`Unexpected native ${dialog.type()} dialog: "${dialog.message()}"`); });
}

test.describe('Candidates 360', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
    guardAgainstNativeDialogs(page);
    await page.route('**/api/wizmatch/candidates?**', (route) => json(route, {
      items: [{ id: 'cand-1', first_name: 'Priya', last_name: 'Sharma', skills: ['Java'], availability_status: 'available', source: 'manual' }],
      total: 1,
    }));
  });

  test('row click opens the drawer and renders canonical skills + explainable matches', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates/cand-1', (route) => json(route, {
      id: 'cand-1', first_name: 'Priya', last_name: 'Sharma', availability_status: 'available', source: 'manual',
      skills: ['Java', 'Spring Boot'], location: 'Bengaluru',
    }));
    await page.route('**/api/wizmatch/staffing/candidates/cand-1', (route) => json(route, {
      candidate: { id: 'cand-1' },
      skills: [{ id: 's1', canonical_label: 'Java', verified: true, experience_years: 6, evidence: 'Led backend migration' }],
      matches: [{
        id: 'm1', requirement_id: 'r1', requirement_title: 'Senior Java Developer', stage: 'sourcing',
        score: 78, dimensions: { mandatorySkills: 45, preferredSkills: 12, experienceRecencyEvidence: 12, locationAuthorization: 8, availability: 6, commercial: 5 },
        blockers: [], missing_evidence: [], human_decision: 'unreviewed',
      }],
    }));

    await page.goto('/wizmatch/candidates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').filter({ hasText: 'Priya Sharma' }).click();

    await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible();
    await expect(page.getByText('Canonical skill tags & evidence')).toBeVisible();
    await expect(page.getByText('Java', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Led backend migration')).toBeVisible();
    await expect(page.getByText('Senior Java Developer')).toBeVisible();
    await expect(page.getByText('78')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shortlist' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Watch' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  });

  test('Shortlist calls the decision endpoint and updates the badge in place', async ({ page }) => {
    let decisionBody: unknown = null;
    await page.route('**/api/wizmatch/candidates/cand-1', (route) => json(route, { id: 'cand-1', first_name: 'Priya', last_name: 'Sharma', availability_status: 'available', source: 'manual' }));
    await page.route('**/api/wizmatch/staffing/candidates/cand-1', (route) => json(route, {
      candidate: { id: 'cand-1' }, skills: [],
      matches: [{ id: 'm1', requirement_id: 'r1', requirement_title: 'Senior Java Developer', stage: 'sourcing', score: 78, dimensions: {}, blockers: [], missing_evidence: [], human_decision: decisionBody ? 'shortlisted' : 'unreviewed' }],
    }));
    await page.route('**/api/wizmatch/staffing/matches/m1/decision', async (route) => {
      decisionBody = route.request().postDataJSON();
      await json(route, { ok: true });
    });

    await page.goto('/wizmatch/candidates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').filter({ hasText: 'Priya Sharma' }).click();
    await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible();

    await page.getByRole('button', { name: 'Shortlist' }).click();
    await expect.poll(() => decisionBody).toEqual({ decision: 'shortlisted' });
    await expect(page.getByText('shortlisted', { exact: true })).toBeVisible();
  });

  test('delete is offered only with zero known matches; otherwise Mark unavailable is offered', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates/cand-1', (route) => json(route, { id: 'cand-1', first_name: 'Priya', last_name: 'Sharma', availability_status: 'available', source: 'manual' }));
    await page.route('**/api/wizmatch/staffing/candidates/cand-1', (route) => json(route, {
      candidate: { id: 'cand-1' }, skills: [],
      matches: [{ id: 'm1', requirement_id: 'r1', requirement_title: 'Senior Java Developer', stage: 'sourcing', score: 60, dimensions: {}, blockers: [], missing_evidence: [], human_decision: 'unreviewed' }],
    }));

    await page.goto('/wizmatch/candidates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').filter({ hasText: 'Priya Sharma' }).click();
    await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Mark unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);
  });

  test('delete is offered with zero matches, and Cancel closes only the dialog, not the whole drawer', async ({ page }) => {
    // Regression test for a real bug found and fixed this session: the
    // ConfirmDialog was originally rendered outside the drawer panel's
    // stopPropagation() boundary, so a Cancel click bubbled to the outer
    // backdrop's onClick={onClose} and closed the entire drawer instead of
    // just the dialog.
    await page.route('**/api/wizmatch/candidates/cand-1', (route) => json(route, { id: 'cand-1', first_name: 'Priya', last_name: 'Sharma', availability_status: 'available', source: 'manual' }));
    await page.route('**/api/wizmatch/staffing/candidates/cand-1', (route) => json(route, { candidate: { id: 'cand-1' }, skills: [], matches: [] }));

    await page.goto('/wizmatch/candidates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').filter({ hasText: 'Priya Sharma' }).click();
    const heading = page.getByRole('heading', { name: 'Priya Sharma' });
    await expect(heading).toBeVisible();

    await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete permanently' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).not.toBeVisible();
    await expect(heading).toBeVisible();
  });

  test('submission history section renders real submissions from the candidate 360 payload', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates/cand-1', (route) => json(route, { id: 'cand-1', first_name: 'Priya', last_name: 'Sharma', availability_status: 'available', source: 'manual' }));
    await page.route('**/api/wizmatch/staffing/candidates/cand-1', (route) => json(route, {
      candidate: { id: 'cand-1' }, skills: [], matches: [],
      submissions: [{ id: 'sub-1', status: 'interviewing', version: 2, first_sent_at: '2026-07-10T00:00:00.000Z', requirement_title: 'Senior Java Developer', company_name: 'Acme Corp' }],
    }));

    await page.goto('/wizmatch/candidates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').filter({ hasText: 'Priya Sharma' }).click();
    await expect(page.getByRole('heading', { name: 'Priya Sharma' })).toBeVisible();

    const section = page.locator('section').filter({ hasText: 'Submission history' });
    await expect(section.getByText('Senior Java Developer')).toBeVisible();
    await expect(section.getByText('Acme Corp', { exact: false })).toBeVisible();
    await expect(section.getByText(/not been submitted/)).toHaveCount(0);
  });
});
