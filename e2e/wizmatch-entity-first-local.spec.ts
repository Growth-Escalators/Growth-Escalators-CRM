import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  token: 'entity-first-local-token',
  user: { id: 'admin-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const access = {
  allowed: true,
  phases: { A: true, B: true, C: true },
  capabilities: {
    manageRelationships: true,
    manageAssignedWork: true,
    manageCandidateEvidence: true,
    viewDelivery: true,
    operateDelivery: true,
    approveSubmissions: true,
    manageOffers: true,
    viewCommercial: true,
    manageFinance: true,
  },
};

async function installSession(page: Page) {
  await page.addInitScript((value) => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', value.token);
    localStorage.setItem('wizmatch_crm_user', JSON.stringify(value.user));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  }, session);
}

async function installEmptyApis(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/inbox/unread-count' || path === '/api/finance/leaves/pending-count') return json(route, { count: 0 });
    if (path === '/api/wizmatch/staffing/access') return json(route, access);
    if (path === '/api/wizmatch/staffing/my-work') return json(route, { workItems: [], items: [], summary: {} });
    if (path === '/api/wizmatch/review-workbench') return json(route, { actions: [] });
    if (path === '/api/wizmatch/sourcing/status') return json(route, { config: { theirstackEnabled: false, atsEnabled: false, pocDiscoveryEnabled: false }, latestRuns: [], providerAccounts: {} });
    if (path === '/api/wizmatch/signals') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/staffing/companies') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/staffing/hiring-contacts') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/requirements') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/candidates') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/candidate-intelligence/queue') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/staffing/recruiter-work') return json(route, { items: [] });
    if (path === '/api/wizmatch/staffing/delivery-board') return json(route, { items: [] });
    if (path === '/api/wizmatch/staffing/placements') return json(route, { items: [] });
    if (path === '/api/wizmatch/staffing/analytics') return json(route, {
      acquisitionFunnel: [
        { stage: 'job_leads', count: 0 }, { stage: 'poc_ready', count: 0 },
        { stage: 'requirements', count: 0 }, { stage: 'matches', count: 0 }, { stage: 'shortlists', count: 0 },
      ],
      funnel: [], commercial: {}, exceptions: {}, timeToFill: {}, cohorts: [], recruiterPerformance: [],
      sourcePerformance: [], aging: [], rejectionReasons: [],
    });
    return json(route, { items: [], total: 0 });
  });
}

async function expectNoSeriousOrCriticalViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const severe = results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || ''));
  expect(severe, severe.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
}

const primaryPages = [
  { path: '/wizmatch/today', heading: 'Today', snapshot: 'today.png' },
  { path: '/wizmatch/job-leads', heading: 'Job Leads', snapshot: 'job-leads.png' },
  { path: '/wizmatch/companies', heading: 'Companies', snapshot: 'companies.png' },
  { path: '/wizmatch/hiring-contacts', heading: 'Hiring Contacts', snapshot: 'hiring-contacts.png' },
  { path: '/wizmatch/roles', heading: 'Roles / Requirements', snapshot: 'roles.png' },
  { path: '/wizmatch/candidates', heading: 'Candidates', snapshot: 'candidates.png' },
  { path: '/wizmatch/submissions', heading: 'Submissions', snapshot: 'submissions.png' },
  { path: '/wizmatch/placements', heading: 'Placements', snapshot: 'placements.png' },
  { path: '/wizmatch/reports', heading: 'Staffing reports', snapshot: 'reports.png' },
];

test.beforeEach(async ({ page }) => {
  await installSession(page);
  await installEmptyApis(page);
});

for (const target of primaryPages) {
  test(`${target.heading} mounts, is accessible, and matches its visual baseline`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(target.path);
    await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoSeriousOrCriticalViolations(page);
    await expect(page).toHaveScreenshot(target.snapshot, { fullPage: true, animations: 'disabled' });
  });
}

for (const viewport of [
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`all primary workspaces keep actions within the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const target of primaryPages) {
      await page.goto(target.path);
      await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}

test('legacy bookmarks retain their entity and query context', async ({ page }) => {
  await page.goto('/wizmatch/dashboard?bucket=overdue');
  await expect(page).toHaveURL(/\/wizmatch\/today\?bucket=overdue$/);
  await page.goto('/wizmatch/requirements/requirement-7?tab=skills');
  await expect(page).toHaveURL(/\/wizmatch\/roles\?tab=skills&requirementId=requirement-7|\/wizmatch\/roles\?requirementId=requirement-7&tab=skills/);
  await page.goto('/wizmatch/talent-matching?candidateId=candidate-3');
  await expect(page).toHaveURL(/\/wizmatch\/candidates\?.*candidateId=candidate-3/);
});

test('an API outage clears stale company data and exposes Error plus Retry', async ({ page }) => {
  await page.unroute('**/api/**');
  await installSession(page);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/wizmatch/staffing/access') return json(route, access);
    if (path === '/api/wizmatch/staffing/companies') return json(route, { error: 'Company service unavailable' }, 503);
    return json(route, { count: 0 });
  });
  await page.goto('/wizmatch/companies');
  await expect(page.getByRole('alert')).toContainText('Company service unavailable');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByText('Bengaluru Cloud Staffing')).toHaveCount(0);
});

test('populated Company, Hiring Contact, and Role 360 states have no serious accessibility violations', async ({ page }) => {
  const company = {
    id: 'company-a', name: 'Company A', domain: 'companya.example', industry: 'Technology', country: 'India',
    contact_count: 2, open_requirement_count: 2,
  };
  const contacts = [
    {
      id: 'rel-a', company_id: 'company-a', company_name: 'Company A', first_name: 'Person', last_name: 'A',
      title: 'Talent Acquisition Lead', roles: ['talent_acquisition'], email: 'person.a@example.test',
      relationship_stage: 'active', active_requirement_count: 1, next_action: 'Confirm SAP shortlist',
    },
    {
      id: 'rel-b', company_id: 'company-a', company_name: 'Company A', first_name: 'Person', last_name: 'B',
      title: 'Hiring Manager', roles: ['hiring_manager'], email: 'person.b@example.test',
      relationship_stage: 'active', active_requirement_count: 1, next_action: 'Review Java candidates',
    },
  ];
  const requirements = [
    {
      id: 'sap', company_id: 'company-a', company_name: 'Company A', title: 'SAP ABAP Developer',
      source_first_name: 'Person', source_last_name: 'A', stage: 'accepted', status: 'open', priority: 'high',
      work_mode: 'hybrid', employment_type: 'permanent', location: 'Bengaluru', positions: 1,
      next_action: 'Confirm SAP shortlist', next_action_due_at: '2026-07-15T10:00:00Z', sla_due_at: '2026-07-16T10:00:00Z',
      assignments: [{ id: 'assignment-owner', role: 'account_owner', name: 'Local Admin', active: true }, { id: 'assignment-recruiter', role: 'recruiter', name: 'Recruiter One', active: true }],
    },
    {
      id: 'java', company_id: 'company-a', company_name: 'Company A', title: 'Java Developer',
      source_first_name: 'Person', source_last_name: 'B', stage: 'sourcing', status: 'open', priority: 'normal',
      next_action: 'Review Java candidates', assignments: [],
    },
  ];

  await page.route('**/api/wizmatch/staffing/companies?**', (route) => json(route, { items: [company], total: 1 }));
  await page.route('**/api/wizmatch/staffing/companies/company-a', (route) => json(route, {
    company,
    contacts,
    requirements,
    tasks: [{ id: 'task-1', title: 'Confirm SAP shortlist', due_at: '2026-07-15T10:00:00Z', status: 'open' }],
    events: [{ id: 'company-event-1', event_type: 'requirement_accepted', summary: 'SAP role accepted', created_at: '2026-07-14T08:00:00Z' }],
  }));
  await page.route('**/api/wizmatch/staffing/hiring-contacts?**', (route) => json(route, { items: contacts, total: 2 }));
  await page.route('**/api/wizmatch/staffing/company-contacts/rel-a', (route) => json(route, {
    contact: { ...contacts[0], source_type: 'manual', owner_name: 'Local Admin' },
    requirements: [{ ...requirements[0], contact_role: 'source', is_primary_source: true, active: true }],
    tasks: [{ id: 'contact-task-1', title: 'Confirm SAP shortlist', due_at: '2026-07-15T10:00:00Z', status: 'open' }],
    events: [{ id: 'contact-event-1', event_type: 'coordination_call', summary: 'SAP intake confirmed', created_at: '2026-07-14T08:30:00Z' }],
  }));
  await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: requirements, total: 2 }));
  await page.route('**/api/wizmatch/staffing/requirements/sap', (route) => json(route, {
    requirement: requirements[0],
    contacts: [{ id: 'source-a', company_contact_id: 'rel-a', first_name: 'Person', last_name: 'A', email: 'person.a@example.test', role: 'source', is_primary_source: true, active: true }],
    assignments: requirements[0].assignments,
    tasks: [{ id: 'role-task-1', title: 'Confirm SAP shortlist', due_at: '2026-07-15T10:00:00Z', status: 'open' }],
    events: [{ id: 'role-event-1', event_type: 'stage_changed', summary: 'Requirement accepted', created_at: '2026-07-14T08:45:00Z' }],
    requirementSkills: [{ skill_id: 'skill-abap', canonical_label: 'SAP ABAP', importance: 'mandatory', minimum_years: 5, evidence: 'SAP ABAP delivery experience' }],
    relatedCounts: { matches: 4, shortlists: 2, submissions: 1, documents: 1 },
    readiness: {
      acceptance: { ready: true, missing: [] }, matching: { ready: true, missing: [] },
      checks: { company: true, primarySource: true, primarySourceChannel: true, accountOwner: true, recruiter: true, sla: true, datedNextAction: true, mandatorySkill: true },
    },
    allowedTransitions: [{ stage: 'sourcing', allowed: true, blockers: [] }],
  }));

  await page.goto('/wizmatch/companies?companyId=company-a');
  await expect(page.getByRole('heading', { name: 'Company 360' })).toBeVisible();
  await page.getByRole('tab', { name: /Roles \/ Requirements/ }).click();
  await expect(page.getByText('SAP ABAP Developer')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);

  await page.goto('/wizmatch/hiring-contacts?contactId=rel-a&tab=roles');
  await expect(page.getByRole('heading', { name: 'Hiring Contact 360' })).toBeVisible();
  await page.getByRole('tab', { name: /Roles supplied/ }).click();
  await expect(page.getByText('SAP ABAP Developer')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);

  await page.goto('/wizmatch/roles?requirementId=sap');
  await expect(page.getByRole('heading', { name: 'Requirement 360' })).toBeVisible();
  await expect(page.getByText('Company A → Person A → SAP ABAP Developer')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);
});

test('populated Candidate and Submission workspaces have no serious accessibility violations', async ({ page }) => {
  const candidateMatches = [
    {
      id: 'match-sap', candidate_id: 'candidate-sap', requirement_id: 'requirement-sap',
      first_name: 'Asha', last_name: 'SAP', requirement_title: 'SAP ABAP Developer', company_name: 'Company A',
      score: 94, score_version: 'gate-b-v1', blockers: [], missing_evidence: [], human_decision: 'shortlisted',
      updated_at: '2026-07-14T09:00:00Z',
    },
    {
      id: 'match-java', candidate_id: 'candidate-java', requirement_id: 'requirement-java',
      first_name: 'Jay', last_name: 'Java', requirement_title: 'Java Backend Developer', company_name: 'Company B',
      score: 72, score_version: 'gate-b-v1', blockers: [], missing_evidence: ['recency:Java'], human_decision: 'watch',
      updated_at: '2026-07-14T09:10:00Z',
    },
  ];
  const submission = {
    id: 'submission-sap', candidate_id: 'candidate-sap', requirement_id: 'requirement-sap',
    first_name: 'Asha', last_name: 'SAP', requirement_title: 'SAP ABAP Developer', company_name: 'Company A',
    consent_status: 'granted', status: 'submitted', resend_count: 0, interview_count: 1,
    latest_interview_id: 'interview-1', latest_interview_status: 'scheduled', submitted_at: '2026-07-14T09:30:00Z',
    nextAllowedActions: ['record_interview_outcome', 'add_interview', 'withdraw'],
  };

  await page.route('**/api/wizmatch/staffing/recruiter-work', (route) => json(route, { items: candidateMatches }));
  await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [submission] }));

  await page.goto('/wizmatch/candidates?view=matching');
  await expect(page.getByRole('heading', { name: 'Candidates' })).toBeVisible();
  await expect(page.getByText('Asha SAP')).toBeVisible();
  await expect(page.getByText('SAP ABAP Developer')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);

  await page.goto('/wizmatch/submissions?submissionId=submission-sap');
  await expect(page.getByRole('heading', { name: 'Submissions' })).toBeVisible();
  await expect(page.getByText('Asha SAP')).toBeVisible();
  await expect(page.getByText('SAP ABAP Developer')).toBeVisible();
  await expectNoSeriousOrCriticalViolations(page);
});

test('Requirement tabs and intake dialog keep keyboard focus predictable', async ({ page }) => {
  const requirement = {
    id: 'sap', company_id: 'company-a', company_name: 'Company A', title: 'SAP ABAP Developer',
    stage: 'qualifying', status: 'draft', attribution_status: 'needs_attribution', priority: 'high',
    work_mode: 'hybrid', employment_type: 'permanent', location: 'Bengaluru', positions: 1,
    next_action: null, next_action_due_at: null, sla_due_at: null,
  };
  await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [requirement], total: 1 }));
  await page.route('**/api/wizmatch/staffing/requirements/sap', (route) => json(route, {
    requirement, contacts: [], assignments: [], tasks: [], events: [], requirementSkills: [], relatedCounts: {},
    readiness: {
      acceptance: { ready: false, missing: ['primary source contact', 'assigned team', 'SLA', 'dated next action'] },
      matching: { ready: false, missing: ['mandatory canonical skill'] },
      checks: { company: true, primarySource: false, primarySourceChannel: false, accountOwner: false, recruiter: false, sla: false, datedNextAction: false, mandatorySkill: false },
    },
    allowedTransitions: [{ stage: 'accepted', allowed: false, blockers: ['primary source contact'] }],
  }));
  await page.route('**/api/wizmatch/companies/company-a/contacts', (route) => json(route, { items: [{ id: 'rel-a', first_name: 'Person', last_name: 'A', email: 'person.a@example.test', relationship_stage: 'active' }] }));
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [{ id: 'admin-1', name: 'Local Admin', role: 'admin' }, { id: 'recruiter-1', name: 'Recruiter One', role: 'staff' }] }));

  await page.goto('/wizmatch/roles?requirementId=sap');
  const overviewTab = page.getByRole('tab', { name: 'Overview' });
  const skillsTab = page.getByRole('tab', { name: /Skills & Matches/ });
  await overviewTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(skillsTab).toBeFocused();
  await expect(skillsTab).toHaveAttribute('aria-selected', 'true');

  const opener = page.getByRole('button', { name: 'Complete intake' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Complete requirement intake' });
  await expect(dialog).toBeVisible();
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await expectNoSeriousOrCriticalViolations(page);

  const focusStayedInDialog = async () => page.evaluate(() => {
    const active = document.activeElement;
    return Boolean(active?.closest('[role="dialog"]'));
  });
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    await expect.poll(focusStayedInDialog).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
