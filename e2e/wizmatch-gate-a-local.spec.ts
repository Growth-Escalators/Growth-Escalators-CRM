import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  token: 'local-wizmatch-gate-a-token',
  user: { id: 'user-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: 'wizmatch' },
};

const access = {
  allowed: true,
  phases: { A: true, B: true, C: true },
  capabilities: {
    workRequirements: true,
    manageRequirementAttribution: true,
    manageRequirementAssignments: true,
    manageCandidateEvidence: true,
  },
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
    if (path === '/api/wizmatch/staffing/access') return json(route, access);
    if (path === '/api/wizmatch/review-workbench') return json(route, { actions: [] });
    return json(route, {});
  });
}

function captureNativeDialogs(page: Page) {
  const messages: string[] = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  });
  return messages;
}

test('Today keeps Person A SAP work separate from Person B Java work and deep-links to the exact role', async ({ page }) => {
  await setup(page);
  await page.route('**/api/wizmatch/staffing/my-work', (route) => json(route, {
    workItems: [
      {
        id: 'work-sap', bucket: 'overdue', entityType: 'requirement', entityId: 'sap',
        title: 'SAP ABAP Developer', subtitle: 'Company A · Person A',
        recommendedAction: 'Confirm SAP shortlist', dueAt: '2026-07-01T09:00:00Z', sla: 'overdue',
        href: '/wizmatch/roles?requirementId=sap',
      },
      {
        id: 'work-java', bucket: 'due_today', entityType: 'requirement', entityId: 'java',
        title: 'Java Developer', subtitle: 'Company A · Person B',
        recommendedAction: 'Send Java shortlist', dueAt: '2026-07-14T09:00:00Z', sla: 'due_today',
        href: '/wizmatch/roles?requirementId=java',
      },
    ],
  }));

  await page.goto('/wizmatch/today');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('Needs attention').first()).toBeVisible();

  const sapCard = page.getByRole('article').filter({ hasText: 'SAP ABAP Developer' });
  const javaCard = page.getByRole('article').filter({ hasText: 'Java Developer' });
  await expect(sapCard).toContainText('Person A');
  await expect(sapCard).toContainText('Confirm SAP shortlist');
  await expect(javaCard).toContainText('Person B');
  await expect(javaCard).toContainText('Send Java shortlist');

  await sapCard.getByRole('link', { name: 'Open record' }).click();
  await expect(page).toHaveURL(/\/wizmatch\/roles\?requirementId=sap$/);
});

test('Company and Hiring Contact 360 preserve Person A SAP and Person B Java histories independently', async ({ page }) => {
  await setup(page);
  const companies = [{ id: 'company-a', name: 'Company A', domain: 'companya.example', industry: 'Technology', country: 'India', contact_count: 2, open_requirement_count: 2 }];
  const hiringContacts = [
    { id: 'rel-a', company_id: 'company-a', company_name: 'Company A', first_name: 'Person', last_name: 'A', title: 'Talent Acquisition Lead', roles: ['talent_acquisition'], email: 'a@example.test', active_requirement_count: 1, next_action: 'Confirm SAP shortlist' },
    { id: 'rel-b', company_id: 'company-a', company_name: 'Company A', first_name: 'Person', last_name: 'B', title: 'Hiring Manager', roles: ['hiring_manager'], email: 'b@example.test', active_requirement_count: 1, next_action: 'Review Java candidates' },
  ];
  const companyDetail = {
    company: companies[0],
    contacts: hiringContacts.map((contact) => ({ ...contact, relationship_stage: 'active' })),
    requirements: [
      { id: 'sap', title: 'SAP ABAP Developer', source_first_name: 'Person', source_last_name: 'A', stage: 'accepted', next_action: 'Confirm SAP shortlist' },
      { id: 'java', title: 'Java Developer', source_first_name: 'Person', source_last_name: 'B', stage: 'sourcing', next_action: 'Review Java candidates' },
    ],
    tasks: [], events: [],
  };
  const contactDetails: Record<string, unknown> = {
    'rel-a': {
      contact: { ...hiringContacts[0], relationship_stage: 'active', source_type: 'manual', owner_name: 'Local Admin' },
      requirements: [{ id: 'sap', title: 'SAP ABAP Developer', contact_role: 'source', is_primary_source: true, active: true, stage: 'accepted', next_action: 'Confirm SAP shortlist' }],
      tasks: [], events: [{ id: 'event-a', event_type: 'coordination_call', summary: 'SAP intake confirmed', created_at: '2026-07-14T08:00:00Z' }],
    },
    'rel-b': {
      contact: { ...hiringContacts[1], relationship_stage: 'active', source_type: 'manual', owner_name: 'Local Admin' },
      requirements: [{ id: 'java', title: 'Java Developer', contact_role: 'source', is_primary_source: true, active: true, stage: 'sourcing', next_action: 'Review Java candidates' }],
      tasks: [], events: [{ id: 'event-b', event_type: 'coordination_email', summary: 'Java criteria received', created_at: '2026-07-14T08:30:00Z' }],
    },
  };

  await page.route('**/api/wizmatch/staffing/companies?**', (route) => json(route, { items: companies }));
  await page.route('**/api/wizmatch/staffing/companies/company-a', (route) => json(route, companyDetail));
  await page.route('**/api/wizmatch/staffing/hiring-contacts?**', (route) => json(route, { items: hiringContacts }));
  await page.route('**/api/wizmatch/staffing/company-contacts/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() || '';
    return json(route, contactDetails[id] || {});
  });

  await page.goto('/wizmatch/companies');
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'Company A' }).click();
  await expect(page.getByRole('heading', { name: 'Company 360' })).toBeVisible();
  await page.getByRole('tab', { name: /Roles \/ Requirements/ }).click();
  const sapRole = page.getByRole('link').filter({ hasText: 'SAP ABAP Developer' });
  const javaRole = page.getByRole('link').filter({ hasText: 'Java Developer' });
  await expect(sapRole).toContainText('Source: Person A');
  await expect(javaRole).toContainText('Source: Person B');

  await page.goto('/wizmatch/hiring-contacts');
  await expect(page.getByRole('heading', { name: 'Hiring Contacts' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Person A' })).toContainText('Company A');
  await expect(page.getByRole('row').filter({ hasText: 'Person B' })).toContainText('Company A');

  await page.getByRole('row').filter({ hasText: 'Person A' }).click();
  await expect(page.getByRole('heading', { name: 'Hiring Contact 360' })).toBeVisible();
  await page.getByRole('tab', { name: /Roles supplied/ }).click();
  const personAHistory = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Roles supplied by Person A' }) });
  await expect(personAHistory.getByText('SAP ABAP Developer')).toBeVisible();
  await expect(personAHistory.getByText('Java Developer')).toHaveCount(0);

  await page.goto('/wizmatch/hiring-contacts?contactId=rel-b&tab=roles');
  await page.getByRole('tab', { name: /Roles supplied/ }).click();
  const personBHistory = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Roles supplied by Person B' }) });
  await expect(personBHistory.getByText('Java Developer')).toBeVisible();
  await expect(personBHistory.getByText('SAP ABAP Developer')).toHaveCount(0);
});

test('Requirement 360 records source attribution, assigned team, SLA and next action through one validated modal', async ({ page }) => {
  await setup(page);
  const nativeDialogs = captureNativeDialogs(page);
  const sourcePayloads: Record<string, unknown>[] = [];
  const assignmentPayloads: Record<string, unknown>[] = [];
  let nextActionPayload: Record<string, unknown> | null = null;
  const requirement = {
    id: 'sap', company_id: 'company-a', company_name: 'Company A', title: 'SAP ABAP Developer',
    stage: 'qualifying', status: 'draft', attribution_status: 'needs_attribution', priority: 'high',
    work_mode: 'hybrid', employment_type: 'permanent', location: 'Bengaluru', positions: 1,
    next_action: null, next_action_due_at: null, sla_due_at: null,
  } as Record<string, unknown>;
  const contacts: Record<string, unknown>[] = [];
  const assignments: Record<string, unknown>[] = [];
  const detail = () => ({
    requirement,
    contacts,
    assignments,
    tasks: [], events: [], requirementSkills: [], relatedCounts: {},
    readiness: {
      acceptance: { ready: contacts.length > 0 && assignments.length === 2 && Boolean(requirement.next_action), missing: contacts.length ? [] : ['primary source contact', 'assigned team', 'SLA', 'dated next action'] },
      matching: { ready: false, missing: ['mandatory canonical skill'] },
      checks: { company: true, primarySource: contacts.length > 0, primarySourceChannel: contacts.length > 0, accountOwner: assignments.some((item) => item.role === 'account_owner'), recruiter: assignments.some((item) => item.role === 'recruiter'), sla: Boolean(requirement.sla_due_at), datedNextAction: Boolean(requirement.next_action), mandatorySkill: false },
    },
    allowedTransitions: [{ stage: 'accepted', allowed: contacts.length > 0 && assignments.length === 2 && Boolean(requirement.next_action), blockers: ['mandatory canonical skill'] }],
  });

  await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { total: 1, items: [{ ...requirement, assignments: [] }] }));
  await page.route('**/api/wizmatch/staffing/requirements/sap', (route) => json(route, detail()));
  await page.route('**/api/wizmatch/companies/company-a/contacts', (route) => json(route, { items: [{ id: 'rel-a', first_name: 'Person', last_name: 'A', email: 'a@example.test', roles: ['talent_acquisition'], relationship_stage: 'active' }] }));
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [{ id: 'user-1', name: 'Local Admin', role: 'admin' }, { id: 'recruiter-1', name: 'Recruiter One', role: 'staff' }] }));
  await page.route('**/api/wizmatch/requirements/sap/contacts', async (route) => {
    const payload = await route.request().postDataJSON();
    sourcePayloads.push(payload);
    contacts.push({ id: 'attr-1', company_contact_id: payload.companyContactId, first_name: 'Person', last_name: 'A', email: 'a@example.test', role: 'source', is_primary_source: true, active: true });
    return json(route, { id: 'attr-1' }, 201);
  });
  await page.route('**/api/wizmatch/requirements/sap/assignments', async (route) => {
    const payload = await route.request().postDataJSON();
    assignmentPayloads.push(payload);
    assignments.push({ id: `assignment-${assignmentPayloads.length}`, user_id: payload.userId, role: payload.role, name: payload.userId === 'user-1' ? 'Local Admin' : 'Recruiter One', active: true });
    return json(route, { id: `assignment-${assignmentPayloads.length}` }, 201);
  });
  await page.route('**/api/wizmatch/requirements/sap/next-action', async (route) => {
    nextActionPayload = await route.request().postDataJSON();
    Object.assign(requirement, { next_action: nextActionPayload.nextAction, next_action_due_at: nextActionPayload.nextActionDueAt, sla_due_at: nextActionPayload.slaDueAt, attribution_status: 'attributed' });
    return json(route, { task: { id: 'task-1' } }, 201);
  });

  await page.goto('/wizmatch/roles?requirementId=sap');
  await expect(page.getByRole('heading', { name: 'Requirement 360' })).toBeVisible();
  await expect(page.getByText('Company A → Source person needed → SAP ABAP Developer')).toBeVisible();
  await page.getByRole('button', { name: 'Complete intake' }).click();

  const dialog = page.getByRole('dialog', { name: 'Complete requirement intake' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Primary source person').selectOption('rel-a');
  await dialog.getByLabel('Account owner').selectOption('user-1');
  await dialog.getByLabel('Recruiter').selectOption('recruiter-1');
  await dialog.getByLabel('Requirement SLA').fill('2026-07-15T10:00');
  await dialog.getByLabel('Next action', { exact: true }).fill('Confirm SAP shortlist with Person A');
  await dialog.getByLabel('Next action due').fill('2026-07-14T10:00');
  await dialog.getByRole('button', { name: 'Save intake' }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => sourcePayloads.length).toBe(1);
  await expect.poll(() => assignmentPayloads.length).toBe(2);
  await expect.poll(() => nextActionPayload).not.toBeNull();
  expect(sourcePayloads[0]).toMatchObject({ companyContactId: 'rel-a', role: 'source', isPrimarySource: true });
  expect(assignmentPayloads).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: 'user-1', role: 'account_owner' }),
    expect.objectContaining({ userId: 'recruiter-1', role: 'recruiter' }),
  ]));
  expect(nextActionPayload).toMatchObject({ nextAction: 'Confirm SAP shortlist with Person A' });
  await expect(page.getByText('Company A → Person A → SAP ABAP Developer')).toBeVisible();
  await expect(page.getByText('Local Admin · Account Owner')).toBeVisible();
  await expect(page.getByText('Recruiter One · Recruiter')).toBeVisible();
  await expect(page.getByText('Confirm SAP shortlist with Person A').first()).toBeVisible();
  expect(nativeDialogs).toEqual([]);
});

test('guided role intake creates an attributed draft with Person A, ownership, SLA and reviewed SAP FICO evidence', async ({ page }) => {
  await setup(page);
  const nativeDialogs = captureNativeDialogs(page);
  let requirementPayload: Record<string, unknown> | null = null;
  let sourcePayload: Record<string, unknown> | null = null;
  const assignmentPayloads: Record<string, unknown>[] = [];
  let nextActionPayload: Record<string, unknown> | null = null;
  let skillsPayload: Record<string, unknown> | null = null;

  await page.route('**/api/wizmatch/requirements?**', (route) => json(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/staffing/companies', (route) => json(route, { items: [{ id: 'company-a', name: 'Company A' }] }));
  await page.route('**/api/wizmatch/companies/company-a/contacts', (route) => json(route, { items: [
    { id: 'rel-a', first_name: 'Person', last_name: 'A', email: 'a@example.test', relationship_stage: 'active' },
    { id: 'rel-b', first_name: 'Person', last_name: 'B', email: 'b@example.test', relationship_stage: 'active' },
  ] }));
  await page.route('**/api/wizmatch/staffing/users', (route) => json(route, { items: [{ id: 'owner-1', name: 'Account Owner', role: 'sales' }, { id: 'recruiter-1', name: 'Recruiter One', role: 'staff' }] }));
  await page.route('**/api/wizmatch/staffing/skills', (route) => json(route, { items: [
    { id: 'skill-abap', canonical_label: 'SAP ABAP', family: 'SAP', specialization: 'ABAP' },
    { id: 'skill-fico', canonical_label: 'SAP FICO', family: 'SAP', specialization: 'FICO' },
    { id: 'skill-java', canonical_label: 'Java', family: 'Java', specialization: 'Java' },
    { id: 'skill-js', canonical_label: 'JavaScript', family: 'JavaScript', specialization: 'JavaScript' },
  ] }));
  await page.route('**/api/wizmatch/requirements', async (route) => {
    requirementPayload = await route.request().postDataJSON();
    return json(route, { id: 'new-role', title: 'SAP FICO Consultant' }, 201);
  });
  await page.route('**/api/wizmatch/requirements/new-role/contacts', async (route) => {
    sourcePayload = await route.request().postDataJSON();
    return json(route, { id: 'attr-new' }, 201);
  });
  await page.route('**/api/wizmatch/requirements/new-role/assignments', async (route) => {
    assignmentPayloads.push(await route.request().postDataJSON());
    return json(route, { id: `assignment-${assignmentPayloads.length}` }, 201);
  });
  await page.route('**/api/wizmatch/requirements/new-role/next-action', async (route) => {
    nextActionPayload = await route.request().postDataJSON();
    return json(route, { task: { id: 'task-new' } }, 201);
  });
  await page.route('**/api/wizmatch/staffing/requirements/new-role/skills', async (route) => {
    skillsPayload = await route.request().postDataJSON();
    return json(route, { ok: true });
  });
  await page.route('**/api/wizmatch/staffing/requirements/new-role', (route) => json(route, {
    requirement: { id: 'new-role', company_id: 'company-a', company_name: 'Company A', title: 'SAP FICO Consultant', stage: 'draft', status: 'draft' },
    contacts: [{ id: 'attr-new', company_contact_id: 'rel-a', first_name: 'Person', last_name: 'A', role: 'source', is_primary_source: true, active: true }],
    assignments: [{ id: 'a1', role: 'account_owner', name: 'Account Owner', active: true }, { id: 'a2', role: 'recruiter', name: 'Recruiter One', active: true }],
    tasks: [], events: [], requirementSkills: [{ skill_id: 'skill-fico', importance: 'mandatory' }], relatedCounts: {},
    readiness: { acceptance: { ready: true, missing: [] }, matching: { ready: true, missing: [] }, checks: { company: true, primarySource: true, primarySourceChannel: true, accountOwner: true, recruiter: true, sla: true, datedNextAction: true, mandatorySkill: true } },
    allowedTransitions: [{ stage: 'qualifying', allowed: true, blockers: [] }],
  }));

  await page.goto('/wizmatch/roles');
  await page.getByRole('button', { name: 'New role' }).click();
  const dialog = page.getByRole('dialog', { name: 'New role — guided intake' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Company').selectOption('company-a');
  await expect(dialog.getByLabel('Genuine source POC')).toContainText('Person A');
  await dialog.getByLabel('Genuine source POC').selectOption('rel-a');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await dialog.getByLabel('Job description').fill('We need a senior SAP FICO consultant with five years of implementation experience.');
  await dialog.getByLabel('Role title').fill('SAP FICO Consultant');
  await dialog.getByLabel('Location').fill('Bengaluru');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await dialog.getByLabel('Account owner').selectOption('owner-1');
  await dialog.getByLabel('Recruiter').selectOption('recruiter-1');
  await dialog.getByLabel('SLA due').fill('2026-07-16T10:00');
  await dialog.getByLabel('Next action due').fill('2026-07-15T10:00');
  await dialog.getByLabel('Next action', { exact: true }).fill('Confirm SAP FICO interview panel with Person A');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await dialog.getByRole('checkbox', { name: /SAP FICO/ }).check();
  await dialog.getByLabel('Minimum years').fill('5');
  await dialog.getByLabel('JD evidence').fill('senior SAP FICO consultant with five years');
  await dialog.getByRole('button', { name: 'Continue' }).click();

  await expect(dialog.getByText('Company A → Person A → SAP FICO Consultant')).toBeVisible();
  await expect(dialog.getByText('Saving creates a draft only')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create attributed draft' }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/wizmatch\/roles\?requirementId=new-role$/);
  expect(requirementPayload).toMatchObject({ company_id: 'company-a', title: 'SAP FICO Consultant', required_skills: ['SAP FICO'] });
  expect(sourcePayload).toMatchObject({ companyContactId: 'rel-a', role: 'source', isPrimarySource: true });
  expect(assignmentPayloads).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: 'owner-1', role: 'account_owner' }),
    expect.objectContaining({ userId: 'recruiter-1', role: 'recruiter' }),
  ]));
  expect(nextActionPayload).toMatchObject({ nextAction: 'Confirm SAP FICO interview panel with Person A' });
  expect(skillsPayload).toMatchObject({ skills: [expect.objectContaining({ skillId: 'skill-fico', importance: 'mandatory', minimumYears: 5 })] });
  expect(nativeDialogs).toEqual([]);
});
