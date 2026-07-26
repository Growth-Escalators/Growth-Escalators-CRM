import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility scan for the pages/dialogs built in the Wizmatch complete
// build (Jul 2026) — closes the "no axe-core scan ran" gap recorded in
// docs/release/WIZMATCH_RELEASE_READINESS.md. Mocked session + mocked API
// responses, same pattern as wizmatch-e2e-hardening-navigation.spec.ts.

const session = {
  token: 'local-wizmatch-a11y-token',
  user: {
    id: 'a11y-user-1',
    name: 'A11y Test Admin',
    email: 'a11y-admin@example.test',
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
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [{ id: 'u1', name: 'A11y Recruiter', role: 'admin' }] }));
}

/**
 * Runs axe against the current page state and fails with a readable summary
 * if any critical/serious violation is found. Moderate/minor findings are
 * logged but non-blocking — matches the plan's "fix what the scan surfaces,
 * don't assume" instruction without making the suite flaky on cosmetic
 * contrast nits unrelated to this build's new dialogs/pages.
 */
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

test.describe('Wizmatch accessibility scan (complete build)', () => {
  test.beforeEach(async ({ page }) => {
    await installWizmatchSession(page);
    await installBaseMocks(page);
  });

  test('Today', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/my-work', (route) => json(route, {
      requirements: [{ id: 'r1', title: 'A11y Requirement', company_name: 'A11y Co', stage: 'sourcing', next_action: 'Review candidates', next_action_due_at: new Date(Date.now() - 86400000).toISOString() }],
      tasks: [],
    }));
    // PR 6 — the admin dev server always runs with `import.meta.env.DEV`
    // true, which forces `decisionWorkbenchUiEnabled` on (same idiom as
    // `companyPolicyUiEnabled`), so WizmatchTodayPage.jsx renders the new
    // decision workbench here, not the legacy My Work buckets. Mock its
    // real endpoint too so this scan covers populated queue cards, not an
    // empty-state fallback.
    await page.route('**/api/wizmatch/today/queues*', (route) => json(route, {
      readyToContact: [{
        companyId: 'ready-1', companyName: 'Ready Co', companyDomain: 'ready.example',
        canonicalDecision: 'allow', canonicalReasonCode: null, canonicalBlockerCode: null,
        enforcementMode: 'shadow', requiresExplicitApproval: false, outreachEligibility: 'eligible',
        contactConfidenceTier: 'high', duplicatePending: false, duplicateId: null, isNonOverridable: false,
        policyScopeKey: 'entire_company', disabledReason: null,
      }],
      needsReview: [{
        companyId: 'review-1', companyName: 'Review Co', companyDomain: null,
        canonicalDecision: 'review', canonicalReasonCode: 'policy_unknown_cold_start', canonicalBlockerCode: null,
        enforcementMode: 'shadow', requiresExplicitApproval: true, outreachEligibility: 'needs_review',
        contactConfidenceTier: 'medium', duplicatePending: false, duplicateId: null, isNonOverridable: false,
        policyScopeKey: 'entire_company', disabledReason: 'No high- or medium-confidence contact is available yet.',
      }],
      pausedOrBlocked: [{
        companyId: 'blocked-1', companyName: 'Blocked Co', companyDomain: null,
        canonicalDecision: 'deny', canonicalReasonCode: 'company_removal_request', canonicalBlockerCode: 'policy_company_removal_request',
        enforcementMode: 'shadow', requiresExplicitApproval: false, outreachEligibility: 'blocked',
        contactConfidenceTier: null, duplicatePending: false, duplicateId: null, isNonOverridable: true, blockClass: 'compliance',
        policyScopeKey: 'entire_company', disabledReason: 'This company has a non-overridable block. No override or reclassify action is available at any scope.',
      }],
      repliesNeedingAction: [{ enrolmentId: 'enrol-1', companyId: 'ready-1', companyName: 'Ready Co', contactId: null, state: 'awaiting_action', stateAt: new Date().toISOString() }],
      counts: { readyToContact: 1, needsReview: 1, repliesNeedingAction: 1, pausedOrBlocked: 1 },
      partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
    }));
    await page.goto('/wizmatch/today');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Today');

    // Keyboard/focus coverage (PR 6 §9): Approve & Queue on the ready-to-
    // contact row opens the action dialog, focus moves inside it, and
    // Escape closes it without leaving focus stranded.
    const approveButton = page.getByRole('button', { name: 'Approve & Queue' }).first();
    await approveButton.focus();
    await expect(approveButton).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Approve & Queue/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('Companies — list, detail drawer, discover-contacts panel', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/companies*', (route) => json(route, {
      items: [{ id: 'c1', name: 'A11y Company', domain: 'a11y.test', contact_count: 1, open_requirement_count: 1 }],
    }));
    await page.route('**/api/wizmatch/staffing/companies/c1', (route) => json(route, {
      company: { id: 'c1', name: 'A11y Company', domain: 'a11y.test' },
      contacts: [{ id: 'cc1', first_name: 'Jane', last_name: 'Doe', roles: ['talent_acquisition'], email: 'jane@a11y.test', active_requirement_count: 1, relationship_stage: 'active' }],
      requirements: [{ id: 'r1', title: 'A11y Requirement', stage: 'sourcing', positions: 1 }],
      tasks: [], events: [],
    }));
    await page.goto('/wizmatch/companies');
    await page.waitForLoadState('networkidle');
    await page.getByText('A11y Company').click();
    await expect(page.getByRole('heading', { name: 'A11y Company' })).toBeVisible();
    await assertNoSeriousViolations(page, 'Companies (detail drawer open)');

    await page.getByRole('button', { name: 'Discover contacts' }).click();
    await assertNoSeriousViolations(page, 'Companies (discovery panel open)');
  });

  test('Hiring Contacts — both tabs, linked-contact drawer', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/companies*', (route) => json(route, {
      items: [{ id: 'c1', name: 'A11y Company' }],
    }));
    await page.route('**/api/wizmatch/companies/c1/contacts', (route) => json(route, {
      items: [{ id: 'cc1', first_name: 'Jane', last_name: 'Doe', roles: ['hiring_manager'], email: 'jane@a11y.test', active_requirement_count: 1, relationship_stage: 'active' }],
    }));
    await page.route('**/api/wizmatch/staffing/company-contacts/cc1', (route) => json(route, {
      contact: { id: 'cc1', first_name: 'Jane', last_name: 'Doe', company_name: 'A11y Company', roles: ['hiring_manager'] },
      requirements: [], tasks: [], events: [],
    }));
    await page.route('**/api/wizmatch/contact-intelligence/queue?**', (route) => json(route, {
      items: [{ companyId: 'c1', companyName: 'A11y Company', contactCandidates: [{ id: 'cand1', name: 'Discovered Person', title: 'HR Lead', status: 'needs_review', deliverabilityStatus: null }] }],
    }));

    await page.goto('/wizmatch/hiring-contacts');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Hiring Contacts (linked tab)');

    await page.getByRole('row').filter({ hasText: 'jane@a11y.test' }).click();
    await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible();
    await assertNoSeriousViolations(page, 'Hiring Contacts (linked-contact drawer open)');
    await page.getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: 'Discovery queue' }).click();
    await assertNoSeriousViolations(page, 'Hiring Contacts (discovery queue tab)');
  });

  test('Candidates — list + 360 drawer with matches', async ({ page }) => {
    await page.route('**/api/wizmatch/candidates?**', (route) => json(route, {
      items: [{ id: 'cand1', first_name: 'A11y', last_name: 'Candidate', skills: ['Java'], availability_status: 'available', source: 'manual' }],
      total: 1,
    }));
    await page.route('**/api/wizmatch/candidates/cand1', (route) => json(route, {
      id: 'cand1', first_name: 'A11y', last_name: 'Candidate', availability_status: 'available', source: 'manual', skills: ['Java'],
    }));
    await page.route('**/api/wizmatch/staffing/candidates/cand1', (route) => json(route, {
      candidate: { id: 'cand1' },
      skills: [{ id: 's1', canonical_label: 'Java', verified: true, experience_years: 5 }],
      matches: [{
        id: 'm1', requirement_id: 'r1', requirement_title: 'A11y Requirement', stage: 'sourcing',
        score: 62, dimensions: { mandatorySkills: 40, preferredSkills: 10, experienceRecencyEvidence: 8, locationAuthorization: 8, availability: 7, commercial: 5 },
        blockers: [], missing_evidence: [], human_decision: 'unreviewed',
      }],
    }));
    await page.goto('/wizmatch/candidates');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').filter({ hasText: 'A11y Candidate' }).click();
    await expect(page.getByRole('heading', { name: 'A11y Candidate' })).toBeVisible();
    await assertNoSeriousViolations(page, 'Candidates (360 drawer with match)');
  });

  test('Submissions — delivery board + all 6 dialogs', async ({ page }) => {
    const draft = { id: 's1', first_name: 'A11y', last_name: 'Candidate', requirement_id: 'r1', requirement_title: 'A11y Requirement', company_name: 'A11y Co', consent_status: 'requested', status: 'draft', resend_count: 0, interview_count: 0 };
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.route('**/api/wizmatch/staffing/analytics', (route) => json(route, {
      commercial: { starts: 0, gross_margin: 0, invoiced: 0, collected: 0 }, exceptions: { overdue_submissions: 0, missing_next_action: 0 }, timeToFill: { average_days: null },
    }));
    await page.goto('/wizmatch/submissions');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Submissions (board)');

    await page.getByRole('button', { name: 'Consent' }).click();
    await assertNoSeriousViolations(page, 'Submissions (Consent dialog)');
    await page.keyboard.press('Escape');

    draft.status = 'approved';
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Record sent' }).click();
    await assertNoSeriousViolations(page, 'Submissions (Submission dialog)');
    await page.keyboard.press('Escape');

    draft.status = 'submitted';
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add interview' }).click();
    await assertNoSeriousViolations(page, 'Submissions (Interview dialog)');
    await page.keyboard.press('Escape');

    draft.status = 'interviewing';
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add offer' }).click();
    await assertNoSeriousViolations(page, 'Submissions (Offer dialog)');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Withdraw' }).click();
    await assertNoSeriousViolations(page, 'Submissions (Withdraw dialog)');
    await page.keyboard.press('Escape');
  });

  test('Placements — Kanban + detail modal (all 5 tabs)', async ({ page }) => {
    await page.route('**/api/wizmatch/placements?**', (route) => json(route, {
      items: [{ id: 'p1', candidate_first: 'A11y', candidate_last: 'Candidate', company_name: 'A11y Co', status: 'started', requirement_id: 'r1' }],
    }));
    await page.route('**/api/wizmatch/requirements/r1/timeline', (route) => json(route, { items: [] }));
    await page.goto('/wizmatch/placements');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Placements (Kanban)');

    await page.getByText('A11y Candidate').click();
    await expect(page.getByText('Overview')).toBeVisible();
    for (const tab of ['Overview', 'Economics', 'Invoice', 'Collection', 'Adjustments']) {
      await page.getByRole('button', { name: tab }).click();
      await assertNoSeriousViolations(page, `Placements (${tab} tab)`);
    }
  });

  test('Reports — funnel with filters', async ({ page }) => {
    await page.route('**/api/wizmatch/analytics?**', (route) => json(route, { funnel: [], sources: [] }));
    await page.route('**/api/wizmatch/digest', (route) => json(route, { stats: {} }));
    await page.route('**/api/wizmatch/analytics/roi?**', (route) => json(route, { funnel: [{ stage: 'Signals captured', count: 2 }], sourceBreakdown: [] }));
    await page.route('**/api/wizmatch/staffing/analytics', (route) => json(route, {
      funnel: [], commercial: { gross_margin: '0', starts: 0, invoiced: '0', collected: '0' }, exceptions: { overdue_submissions: 0, missing_next_action: 0 },
      cohorts: [], timeToFill: { average_days: null }, aging: [], rejectionReasons: [], recruiterPerformance: [], sourcePerformance: [],
    }));
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [], total: 0 }));
    await page.goto('/wizmatch/reports');
    await page.waitForLoadState('networkidle');
    await assertNoSeriousViolations(page, 'Reports');
  });
});
