import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  token: 'local-wizmatch-gate-a-token',
  user: { id: 'user-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setup(page: Page) {
  await page.addInitScript((value) => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', value.token);
    localStorage.setItem('wizmatch_crm_user', JSON.stringify(value.user));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  }, session);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/inbox/unread-count' || path === '/api/finance/leaves/pending-count') return json(route, { count: 0 });
    if (path === '/api/wizmatch/staffing/access') return json(route, { allowed: true, phases: { A: true, B: false, C: false } });
    return json(route, {});
  });
}

test('My Work keeps SAP Person A and Java Person B visibly separate', async ({ page }) => {
  await setup(page);
  await page.route('**/api/wizmatch/staffing/my-work', route => json(route, {
    requirements: [
      { id: 'sap', title: 'SAP ABAP Developer', company_name: 'Company A', source_first_name: 'Person', source_last_name: 'A', my_roles: ['recruiter'], stage: 'accepted', next_action: 'Confirm SAP shortlist', next_action_due_at: '2026-07-01T09:00:00Z' },
      { id: 'java', title: 'Java Developer', company_name: 'Company A', source_first_name: 'Person', source_last_name: 'B', my_roles: ['recruiter'], stage: 'sourcing', next_action: 'Send Java shortlist', next_action_due_at: '2026-07-20T09:00:00Z' },
    ],
    tasks: [{ id: 'task-1', title: 'Confirm SAP shortlist', description: 'Wizmatch requirement: SAP ABAP Developer', due_at: '2026-07-01T09:00:00Z' }],
  }));
  await page.goto('/wizmatch/my-work');
  await expect(page.getByRole('heading', { name: 'My Work / Today' })).toBeVisible();
  const sapRow = page.getByRole('row').filter({ hasText: 'SAP ABAP Developer' });
  const javaRow = page.getByRole('row').filter({ hasText: 'Java Developer' });
  await expect(sapRow).toContainText('Person A');
  await expect(sapRow).toContainText('Confirm SAP shortlist');
  await expect(javaRow).toContainText('Person B');
  await expect(javaRow).toContainText('Send Java shortlist');
  await expect(page.getByText('Open linked tasks (1)')).toBeVisible();
});

test('Company and Hiring Contact 360 preserve person-specific requirement history', async ({ page }) => {
  await setup(page);
  await page.route('**/api/wizmatch/staffing/companies', route => json(route, { items: [{ id: 'company-a', name: 'Company A', contact_count: 2, open_requirement_count: 2 }] }));
  await page.route('**/api/wizmatch/staffing/companies/company-a', route => json(route, {
    company: { id: 'company-a', name: 'Company A' },
    contacts: [
      { id: 'rel-a', first_name: 'Person', last_name: 'A', roles: ['talent_acquisition'], email: 'a@example.test', phone: null, active_requirement_count: 1, relationship_stage: 'active' },
      { id: 'rel-b', first_name: 'Person', last_name: 'B', roles: ['hiring_manager'], email: 'b@example.test', phone: null, active_requirement_count: 1, relationship_stage: 'active' },
    ],
    requirements: [
      { id: 'sap', title: 'SAP ABAP Developer', required_skills: ['SAP ABAP'], source_first_name: 'Person', source_last_name: 'A', stage: 'accepted', next_action: 'Confirm shortlist' },
      { id: 'java', title: 'Java Developer', required_skills: ['Java'], source_first_name: 'Person', source_last_name: 'B', stage: 'sourcing', next_action: 'Review candidates' },
    ], tasks: [], events: [],
  }));
  await page.route('**/api/wizmatch/staffing/company-contacts/rel-a', route => json(route, {
    contact: { id: 'rel-a', first_name: 'Person', last_name: 'A', company_name: 'Company A', roles: ['talent_acquisition'], email: 'a@example.test' },
    requirements: [{ id: 'sap', title: 'SAP ABAP Developer', contact_role: 'source', is_primary_source: true, stage: 'accepted' }], tasks: [], events: [],
  }));
  await page.goto('/wizmatch/relationships');
  await expect(page.getByRole('heading', { name: 'Companies & Hiring Contacts' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'SAP ABAP Developer' })).toContainText('Person A');
  await expect(page.getByRole('row').filter({ hasText: 'Java Developer' })).toContainText('Person B');
  await page.getByRole('row').filter({ hasText: 'a@example.test' }).click();
  await expect(page.getByRole('heading', { name: 'Person A' })).toBeVisible();
  const contactDrawer = page.locator('.fixed').filter({ hasText: 'Requirement history' });
  await expect(contactDrawer.getByText('SAP ABAP Developer')).toBeVisible();
  await expect(contactDrawer.getByText('source · primary source · accepted')).toBeVisible();
});

test('Requirement 360 sets source, team and dated next action through audited endpoints', async ({ page }) => {
  await setup(page);
  let sourcePosted = false; let assignmentPosted = false; let nextActionPosted = false;
  await page.route('**/api/wizmatch/requirements?**', route => json(route, { total: 1, items: [{ id: 'sap', company_id: 'company-a', company_name: 'Company A', title: 'SAP ABAP Developer', required_skills: ['SAP ABAP'], region: 'india', positions: 1, status: 'draft', stage: 'qualifying', attribution_status: 'needs_attribution', assignments: [] }] }));
  await page.route('**/api/wizmatch/staffing/requirements/sap', route => json(route, { requirement: { id: 'sap', company_id: 'company-a', title: 'SAP ABAP Developer', stage: 'qualifying' }, contacts: [], assignments: [], tasks: [], events: [] }));
  await page.route('**/api/wizmatch/companies/company-a/contacts', route => json(route, { items: [{ id: 'rel-a', first_name: 'Person', last_name: 'A', roles: ['talent_acquisition'], relationship_stage: 'active' }] }));
  await page.route('**/api/wizmatch/staffing/users', route => json(route, { items: [{ id: 'user-1', name: 'Local Admin', role: 'admin' }, { id: 'recruiter-1', name: 'Recruiter One', role: 'staff' }] }));
  await page.route('**/api/wizmatch/requirements/sap/contacts', async route => { sourcePosted = route.request().method() === 'POST'; return json(route, { id: 'attr-1' }, 201); });
  await page.route('**/api/wizmatch/requirements/sap/assignments', async route => { assignmentPosted = route.request().method() === 'POST'; return json(route, { id: 'assignment-1' }, 201); });
  await page.route('**/api/wizmatch/requirements/sap/next-action', async route => { nextActionPosted = route.request().method() === 'POST'; return json(route, { task: { id: 'task-1' } }, 201); });
  await page.goto('/wizmatch/requirements');
  await page.getByRole('row').filter({ hasText: 'SAP ABAP Developer' }).click();
  await expect(page.getByText('Requirement 360')).toBeVisible();
  await page.getByRole('button', { name: 'Set primary' }).click();
  await expect.poll(() => sourcePosted).toBe(true);
  await page.getByRole('button', { name: 'Assign' }).click();
  await expect.poll(() => assignmentPosted).toBe(true);
  await page.getByPlaceholder('Example: Call Priya for Java shortlist feedback').fill('Confirm SAP shortlist with Person A');
  await page.getByLabel('Next action due').fill('2026-07-14T10:00');
  await page.getByLabel('Requirement SLA due').fill('2026-07-15T10:00');
  await page.getByRole('button', { name: 'Save next action' }).click();
  await expect.poll(() => nextActionPosted).toBe(true);
});

test('new requirement requires an explicit company and submits its ID', async ({ page }) => {
  await setup(page);
  let submittedCompany = '';
  await page.route('**/api/wizmatch/requirements?**', route => json(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/staffing/companies', route => json(route, { items: [{ id: 'company-a', name: 'Company A' }] }));
  await page.route('**/api/wizmatch/requirements', async route => {
    if (route.request().method() === 'POST') submittedCompany = (await route.request().postDataJSON()).company_id;
    return json(route, { id: 'new-role' }, 201);
  });
  await page.route('**/api/wizmatch/requirements/new-role/sheet', route => json(route, {}));
  await page.goto('/wizmatch/requirements');
  await page.getByRole('button', { name: 'New Requirement' }).click();
  await page.getByPlaceholder('e.g. Senior Java Developer').fill('SAP FICO Consultant');
  await page.getByRole('button', { name: 'Save & Generate Sheet' }).click();
  await expect.poll(() => submittedCompany).toBe('company-a');
});
