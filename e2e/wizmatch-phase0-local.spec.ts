import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  token: 'local-wizmatch-test-token',
  user: {
    id: 'local-user-1',
    name: 'Local Wizmatch Admin',
    email: 'local-admin@example.test',
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

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installGenericApiFallback(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/wizmatch/staffing/access') {
      await fulfillJson(route, {
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
      });
      return;
    }
    if (path === '/api/inbox/unread-count' || path === '/api/finance/leaves/pending-count') {
      await fulfillJson(route, { count: 0 });
      return;
    }
    await fulfillJson(route, {});
  });
}

test('requirement parsing uses inline validation and recovers through Retry', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  let parseCalls = 0;
  let parseAuthorization = '';
  let parseContentType = '';

  await page.route('**/api/wizmatch/requirements/parse', async (route) => {
    parseCalls += 1;
    parseAuthorization = route.request().headers().authorization || '';
    parseContentType = route.request().headers()['content-type'] || '';
    if (parseCalls === 1) {
      await fulfillJson(route, { error: 'Parser temporarily unavailable' }, 500);
      return;
    }
    await fulfillJson(route, {
      parsed: {
        title: 'SAP ABAP Developer',
        region: 'india',
        location: 'Bengaluru',
        required_skills: ['SAP ABAP', 'S/4HANA'],
      },
      source_file_url: null,
    });
  });
  await page.route('**/api/wizmatch/requirements?**', (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/staffing/companies', (route) => fulfillJson(route, {
    items: [{ id: 'company-1', name: 'Example Staffing Client' }],
  }));
  await page.route('**/api/wizmatch/companies/company-1/contacts', (route) => fulfillJson(route, {
    items: [{ id: 'company-contact-1', first_name: 'Fictional', last_name: 'TA Lead', relationship_stage: 'active', email: 'ta@example.test' }],
  }));
  await page.route('**/api/wizmatch/staffing/users', (route) => fulfillJson(route, { items: [] }));
  await page.route('**/api/wizmatch/staffing/skills', (route) => fulfillJson(route, { items: [] }));

  await page.goto('/wizmatch/requirements');
  await expect(page).toHaveURL(/\/wizmatch\/roles$/);
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Company').selectOption('company-1');
  await page.getByLabel('Genuine source POC').selectOption('company-contact-1');
  await page.getByRole('button', { name: 'Continue' }).click();

  const parseButton = page.getByRole('button', { name: 'Parse to draft fields' });
  await parseButton.click();
  await expect(page.getByRole('alert')).toContainText('Paste the JD before parsing.');
  expect(parseCalls).toBe(0);

  await page.getByLabel('Job description').fill('Need an SAP ABAP developer with S/4HANA experience.');
  await parseButton.click();
  await expect(page.getByRole('alert')).toContainText('Parser temporarily unavailable');
  await parseButton.click();

  await expect(page.getByLabel('Role title')).toHaveValue('SAP ABAP Developer');
  await expect(page.getByLabel('Location')).toHaveValue('Bengaluru');
  expect(parseAuthorization).toBe(`Bearer ${session.token}`);
  expect(parseContentType).toContain('multipart/form-data; boundary=');
});

test('Job Leads alias exposes the capped POC-research action without sending outreach', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  let discoveryCalls = 0;
  const signal = {
    id: 'signal-1',
    job_title: 'Java Backend Developer',
    company_name: 'Example Staffing Client',
    company_domain: 'example.test',
    location: 'Bengaluru',
    source: 'theirstack',
    status: 'qualified',
    score: 88,
    qualification: { qualified: true },
    raw_text: 'Hiring a Java backend developer with Spring Boot experience.',
    created_at: '2026-07-14T08:00:00.000Z',
  };

  await page.route('**/api/wizmatch/signals?**', (route) => fulfillJson(route, { items: [signal], total: 1 }));
  await page.route('**/api/wizmatch/signals/signal-1', (route) => fulfillJson(route, signal));
  await page.route('**/api/wizmatch/sourcing/status', (route) => fulfillJson(route, {
    config: { theirstackEnabled: true, atsEnabled: false, pocDiscoveryEnabled: true },
    latestRuns: [],
    providerAccounts: { theirstack: { configured: true } },
  }));
  await page.route('**/api/wizmatch/signals/signal-1/discover-poc', async (route) => {
    discoveryCalls += 1;
    await fulfillJson(route, {
      state: 'identified_channel_pending',
      candidatesFound: 1,
      candidates: [{ name: 'Fictional TA Lead', title: 'Talent Acquisition Lead', state: 'identified_channel_pending', profileUrl: 'https://example.test/public-profile' }],
    });
  });

  await page.goto('/wizmatch/client-discovery?signalId=signal-1');
  await expect(page).toHaveURL(/\/wizmatch\/job-leads\?signalId=signal-1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Job Lead Review' })).toBeVisible();
  const discover = page.getByRole('button', { name: 'Find up to 3 POCs' });
  await expect(discover).toBeEnabled();
  await discover.click();
  await expect(page.getByText('Fictional TA Lead')).toBeVisible();
  await expect(page.getByText('1 public candidates found')).toBeVisible();
  await expect(page.getByText(/Neither action sends outreach/)).toBeVisible();
  expect(discoveryCalls).toBe(1);
});

test('Hiring Contacts alias keeps an honest Error and Retry state without demo people', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/staffing/hiring-contacts?**', (route) => fulfillJson(route, { error: 'Database unavailable' }, 500));

  await page.goto('/wizmatch/contact-intelligence');
  await expect(page).toHaveURL(/\/wizmatch\/hiring-contacts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Hiring Contacts' })).toBeVisible();
  await expect(page.getByText('This view could not be loaded')).toBeVisible();
  await expect(page.getByText('Database unavailable')).toBeVisible();
  await expect(page.getByText('Fictional TA Lead')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('Dashboard and Requirement Priority aliases open Today and Roles with canonical actions', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/staffing/my-work', (route) => fulfillJson(route, {
    workItems: [{ id: 'requirement:req-1', entityType: 'requirement', entityId: 'req-1', entityHref: '/wizmatch/roles?requirementId=req-1', title: 'SAP ABAP Consultant', bucket: 'overdue', recommendedAction: 'Confirm hiring POC', dueAt: '2026-07-12T08:00:00.000Z' }],
  }));
  await page.route('**/api/wizmatch/review-workbench?**', (route) => fulfillJson(route, { actions: [] }));
  await page.route('**/api/wizmatch/requirements?**', (route) => fulfillJson(route, { items: [], total: 0 }));

  await page.goto('/wizmatch/dashboard');
  await expect(page).toHaveURL(/\/wizmatch\/today$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByText('SAP ABAP Consultant')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review job leads' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add role' })).toBeVisible();

  await page.goto('/wizmatch/requirement-priority-new');
  await expect(page).toHaveURL(/\/wizmatch\/roles\?view=priority$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Roles / Requirements' })).toBeVisible();
  await expect(page.getByText('No roles match these filters')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New role' })).toBeVisible();
});

test('D-12 demo result states that no discovery was queued or run', async ({ page }) => {
  await page.goto('/wizmatch/review-workbench-demo');
  const action = page.getByRole('button', { name: 'Send to Contact Intelligence' }).first();
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.getByText(/No discovery was queued or run/).first()).toBeVisible();
});

test('authenticated API outages never substitute actionable demo records', async ({ page }) => {
  await installWizmatchSession(page);
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/wizmatch/staffing/access') {
      return fulfillJson(route, {
        allowed: true,
        phases: { A: true, B: true, C: true },
        capabilities: { manageRelationships: true, manageCandidateEvidence: true, viewDelivery: true, operateDelivery: true, viewCommercial: true, manageFinance: true },
      });
    }
    return fulfillJson(route, { error: 'Service unavailable for local outage test' }, 500);
  });

  const routes = [
    { path: '/wizmatch/dashboard', heading: 'Today', forbidden: 'Approve Asha Rao' },
    { path: '/wizmatch/client-discovery', heading: 'Job Leads', forbidden: 'Bengaluru Cloud Staffing' },
    { path: '/wizmatch/relationships', heading: 'Companies', forbidden: 'Bengaluru Cloud Staffing' },
    { path: '/wizmatch/contact-intelligence', heading: 'Hiring Contacts', forbidden: 'Fictional TA Lead' },
    { path: '/wizmatch/requirement-priority-new', heading: 'Roles / Requirements', forbidden: 'Java Backend Developer' },
    { path: '/wizmatch/candidate-intelligence', heading: 'Candidates', forbidden: 'Aarav Kumar' },
    { path: '/wizmatch/delivery', heading: 'Submissions', forbidden: 'Aarav Kumar' },
    { path: '/wizmatch/analytics', heading: 'Staffing reports', forbidden: '126' },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
    await expect(page.getByText(route.forbidden, { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Service unavailable for local outage test/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ }).first()).toBeVisible();
  }

  await page.goto('/wizmatch/intelligence');
  await expect(page.getByRole('heading', { name: 'Wizmatch AI Intelligence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate with Claude' })).toBeDisabled();
  await expect(page.getByText('Demo mode shows sample staffing guidance.')).toHaveCount(0);

  await page.goto('/wizmatch/system?tab=readiness');
  await expect(page.getByText(/Service unavailable for local outage test/).first()).toBeVisible();
  await expect(page.getByText('Demo mode')).toHaveCount(0);
});

test('pipeline request failure exits loading and offers Retry', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/pipelines', (route) => fulfillJson(route, { error: 'Pipeline service unavailable' }, 500));

  await page.goto('/wizmatch/pipeline');
  await expect(page.getByRole('heading', { name: 'Could not load the pipeline' })).toBeVisible();
  await expect(page.getByText('Pipeline service unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('Source Candidates alias explains that X-Ray is requirement-first and creates unverified leads', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/candidates?**', (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route('**/api/wizmatch/candidate-intelligence/queue?**', (route) => fulfillJson(route, { items: [], total: 0 }));

  await page.goto('/wizmatch/source-candidates');
  await expect(page).toHaveURL(/\/wizmatch\/candidates\?view=sourcing$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Candidates' })).toBeVisible();
  await expect(page.getByText('Candidate sourcing starts from a real requirement')).toBeVisible();
  await expect(page.getByText(/Results return here as unverified leads/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Open Roles \/ Requirements/ })).toHaveAttribute('href', '/wizmatch/roles');
  await expect(page.getByRole('button', { name: /LinkedIn X-Ray|Source candidates/i })).toHaveCount(0);
});

test('direct Wizmatch navigation preserves product and return path at login', async ({ page }) => {
  await page.goto('/wizmatch/requirements/role-7?tab=skills');
  await expect(page).toHaveURL(/\/login\?tenant=wizmatch&returnTo=%2Fwizmatch%2Froles%3Ftab%3Dskills%26requirementId%3Drole-7/);
  await expect(page.getByRole('heading', { name: 'Wizmatch' })).toBeVisible();
  await expect(page.getByText('Operating Dashboard')).toBeVisible();
});

test('AI provider failure exposes safe detail and never substitutes demo analysis', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/intelligence', (route) => fulfillJson(route, {
    aiEnabled: true,
    snapshot: { summary: {} },
    guidance: [],
  }));
  await page.route('**/api/wizmatch/intelligence/generate', (route) => fulfillJson(route, {
    error: 'Wizmatch AI Intelligence is not available',
    detail: 'The analysis exceeded the 20-second response limit. Retry once; if it repeats, check provider health.',
    reasonCode: 'provider_timeout',
  }, 503));

  await page.goto('/wizmatch/intelligence');
  await page.getByRole('button', { name: 'Generate with Claude' }).click();
  await expect(page.getByText(/exceeded the 20-second response limit/)).toBeVisible();
  await expect(page.getByText(/Demo AI analysis/)).toHaveCount(0);
});

test('query-string navigation resets a crashed route error boundary', async ({ page }) => {
  await page.goto('/__qa/query-boundary?tab=crash');
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await page.goto('/__qa/query-boundary?tab=recovered');
  await expect(page.getByRole('heading', { name: 'Query boundary recovered' })).toBeVisible();
});
