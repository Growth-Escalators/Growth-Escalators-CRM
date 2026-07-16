import { expect, test, type Page, type Route } from '@playwright/test';

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const access = {
  allowed: true,
  phases: { A: true, B: true, C: true },
  capabilities: { manageRelationships: true, manageAssignedWork: true, manageCandidateEvidence: true, viewDelivery: true, operateDelivery: true, approveSubmissions: true, manageOffers: true, viewCommercial: true, manageFinance: true },
};

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'sourcing-token');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'user-1', name: 'Admin', role: 'admin', tenantSlug: 'wizmatch' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/inbox/unread-count' || path === '/api/finance/leaves/pending-count') return json(route, { count: 0 });
    if (path === '/api/wizmatch/staffing/access') return json(route, access);
    return json(route, { items: [], total: 0 });
  });
}

test('exactly three job leads can be reviewed through qualification, POC evidence and draft conversion', async ({ page }) => {
  await setup(page);
  const actions: string[] = [];
  const signals: Record<string, any>[] = [
    { id: 'signal-sap', job_title: 'SAP ABAP Consultant', company_name: 'Company A', company_id: 'company-a', location: 'Pune', source: 'theirstack', status: 'new', score: 86, keywords: ['SAP ABAP'], raw_text: 'SAP ABAP and S/4HANA implementation demand.' },
    { id: 'signal-java', job_title: 'Java Backend Developer', company_name: 'Company B', company_id: 'company-b', location: 'Bengaluru', source: 'ats', status: 'new', score: 82, keywords: ['Java'], raw_text: 'Java and Spring Boot backend delivery demand.' },
    { id: 'signal-reject', job_title: 'Office Administrator', company_name: 'Company C', company_id: 'company-c', location: 'Mumbai', source: 'theirstack', status: 'new', score: 20, keywords: [], raw_text: 'Office administration only.' },
  ];
  const pocs: Record<string, any> = {
    'signal-sap': { state: 'identified_channel_pending', candidatesFound: 1, candidates: [{ name: 'Person A', title: 'Talent Acquisition Lead', roleCategory: 'talent_acquisition', state: 'identified_channel_pending', profileUrl: 'https://example.test/person-a' }] },
    'signal-java': { state: 'identified_channel_pending', candidatesFound: 1, candidates: [{ name: 'Person B', title: 'Engineering Hiring Manager', roleCategory: 'hiring_manager', state: 'identified_channel_pending', profileUrl: 'https://example.test/person-b' }] },
  };
  const requirements: Record<string, string> = { 'signal-sap': 'req-sap', 'signal-java': 'req-java' };

  await page.route('**/api/wizmatch/sourcing/status', route => json(route, {
    config: { theirstackEnabled: true, atsEnabled: true, xrayEnabled: true, pocDiscoveryEnabled: true },
    latestRuns: [{ provider: 'theirstack', status: 'succeeded' }, { provider: 'ats', status: 'succeeded' }],
    providerAccounts: { theirstack: { configured: true } },
  }));
  await page.route('**/api/wizmatch/signals?**', route => json(route, { items: signals, total: 3 }));
  await page.route('**/api/wizmatch/signals/**', async route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[4];
    const action = parts[5];
    const signal = signals.find(item => item.id === id);
    if (!signal) return json(route, { error: 'Not found' }, 404);
    if (!action) return json(route, signal);
    actions.push(`${id}:${action}`);
    if (action === 'qualify') {
      signal.qualified = true;
      signal.qualification = { qualified: true };
      signal.status = 'scored';
      return json(route, { qualified: true });
    }
    if (action === 'discover-poc') {
      signal.poc_state = pocs[id].state;
      signal.poc_candidates = pocs[id].candidates;
      return json(route, pocs[id]);
    }
    if (action === 'promote-to-requirement') {
      signal.status = 'drafted';
      signal.linked_requirement_id = requirements[id];
      signal.linked_requirement = { id: requirements[id], title: signal.job_title, stage: 'draft' };
      return json(route, { created: true, requirement: signal.linked_requirement });
    }
    if (action === 'reject') {
      signal.status = 'dead';
      return json(route, { rejected: true });
    }
    return json(route, {});
  });

  await page.goto('/wizmatch/job-leads');
  await expect(page.getByText('Showing 3 of 3 job leads')).toBeVisible();

  for (const item of [
    { title: 'SAP ABAP Consultant', person: 'Person A', id: 'signal-sap' },
    { title: 'Java Backend Developer', person: 'Person B', id: 'signal-java' },
  ]) {
    await page.getByRole('row').filter({ hasText: item.title }).click();
    await page.getByRole('button', { name: 'Qualify signal' }).click();
    await page.getByRole('button', { name: 'Find up to 3 POCs' }).click();
    await expect(page.getByText(item.person)).toBeVisible();
    await page.getByRole('button', { name: 'Create draft role' }).click();
    await expect(page.getByRole('status')).toContainText('Draft role created');
    await page.getByRole('button', { name: 'All job leads' }).click();
  }

  await page.getByRole('row').filter({ hasText: 'Office Administrator' }).click();
  await page.getByRole('button', { name: 'Reject with reason' }).click();
  await page.getByLabel('Reason').fill('No technical staffing demand');
  await page.getByRole('button', { name: 'Reject lead' }).click();

  expect(actions).toEqual([
    'signal-sap:qualify', 'signal-sap:discover-poc', 'signal-sap:promote-to-requirement',
    'signal-java:qualify', 'signal-java:discover-poc', 'signal-java:promote-to-requirement',
    'signal-reject:reject',
  ]);
});

test('job lead list and detail failures stay honest and recover with Retry', async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route('**/api/wizmatch/sourcing/status', route => json(route, { config: {}, latestRuns: [] }));
  await page.route('**/api/wizmatch/signals?**', route => {
    calls += 1;
    return calls === 1 ? json(route, { error: 'Signal service temporarily unavailable' }, 503) : json(route, { items: [], total: 0 });
  });
  await page.goto('/wizmatch/job-leads');
  await expect(page.getByRole('alert')).toContainText('Signal service temporarily unavailable');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No job leads match these filters')).toBeVisible();
  await expect(page.getByText('Bengaluru Cloud Staffing')).toHaveCount(0);
});

for (const viewport of [{ name: 'tablet', width: 1024, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`job lead review remains usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setup(page);
    await page.route('**/api/wizmatch/sourcing/status', route => json(route, { config: { theirstackEnabled: true, atsEnabled: true }, latestRuns: [] }));
    await page.route('**/api/wizmatch/signals?**', route => json(route, { items: [], total: 0 }));
    await page.goto('/wizmatch/job-leads');
    await expect(page.getByRole('heading', { level: 1, name: 'Job Leads' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('an accepted, skill-reviewed role starts an X-Ray run capped to three public leads', async ({ page }) => {
  await setup(page);
  let requestBody: any = null;
  const requirement = { id: 'req-java', company_id: 'company-a', company_name: 'Company A', title: 'Java Backend Developer', stage: 'accepted', status: 'draft', next_action: 'Review candidate evidence', next_action_due_at: '2026-07-15T10:00:00Z' };
  await page.route('**/api/wizmatch/requirements?**', route => json(route, { items: [{ ...requirement, required_skills: ['Java'], primary_source_name: 'Person B', assignments: [] }], total: 1 }));
  await page.route('**/api/wizmatch/staffing/requirements/req-java', route => json(route, {
    requirement,
    contacts: [{ id: 'attr-b', active: true, is_primary_source: true, company_contact_id: 'person-b', first_name: 'Person', last_name: 'B', role: 'source' }],
    assignments: [], tasks: [], events: [], requirementSkills: [{ skill_id: 'skill-java', canonical_label: 'Java', importance: 'mandatory' }],
    readiness: { acceptance: { ready: true, missing: [] }, matching: { ready: true, missing: [] } }, allowedTransitions: [], relatedCounts: {},
  }));
  await page.route('**/api/wizmatch/requirements/req-java/source-candidates-xray', async route => {
    requestBody = await route.request().postDataJSON();
    return json(route, { created: 3, duplicates: 0 });
  });
  await page.goto('/wizmatch/roles');
  await page.getByRole('row').filter({ hasText: 'Java Backend Developer' }).click();
  await page.getByRole('button', { name: 'Source up to 3 leads' }).click();
  await expect(page.getByLabel('Maximum public results')).toHaveValue('3');
  await page.getByRole('button', { name: 'Source up to 3', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Created 3; duplicates 0');
  expect(requestBody).toEqual({ maxResults: 3 });
});
