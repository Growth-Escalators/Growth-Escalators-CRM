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
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({}));
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

  await page.goto('/wizmatch/requirements');
  await page.getByRole('button', { name: 'New Requirement' }).click();

  await page.getByRole('button', { name: 'Parse with AI' }).click();
  await expect(page.getByRole('status')).toContainText('Paste the JD text first.');
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(parseCalls).toBe(0);

  await page.getByPlaceholder("Paste the client's job requirement here…").fill('Need an SAP ABAP developer with S/4HANA experience.');
  await page.getByRole('button', { name: 'Parse with AI' }).click();
  await expect(page.getByRole('alert')).toContainText('Parser temporarily unavailable');
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByPlaceholder('e.g. Senior Java Developer')).toHaveValue('SAP ABAP Developer');
  await expect(page.getByPlaceholder('Java, Spring Boot, AWS')).toHaveValue('SAP ABAP, S/4HANA');
  expect(parseAuthorization).toBe(`Bearer ${session.token}`);
  expect(parseContentType).toContain('multipart/form-data; boundary=');
});

test('Contact Intelligence previews before a confirmed mocked run and preserves review controls', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  let discoverBody: unknown = null;
  const company = {
    companyId: 'company-1',
    companyName: 'Example Staffing Client',
    companyDomain: 'example.test',
    targetRegion: 'india',
    qualificationTier: 'A',
    qualificationScore: 88,
    companyStatus: 'qualified',
    discoveryRunStatus: 'not_run',
    componentScores: {
      itTechFit: 25,
      signalQuality: 18,
      regionPriority: 15,
      candidateSupply: 12,
      relationshipValue: 8,
      safetyAndDeliverability: 10,
    },
    reasons: ['Strong IT staffing fit.'],
    hardBlocks: [],
    latestSignal: { jobTitle: 'Java Backend Developer', score: 8 },
    contactCandidates: [
      {
        id: 'candidate-1',
        name: 'Fictional TA Lead',
        title: 'Talent Acquisition Lead',
        email: 'ta@example.test',
        source: 'manual_seed',
        status: 'approved',
        rankingScore: 90,
        reasons: ['Decision-maker title fit.'],
      },
    ],
  };

  await page.route('**/api/wizmatch/contact-intelligence/queue?**', (route) => fulfillJson(route, {
    items: [company],
    costControls: { paidDiscoveryEnabled: false, googleFallbackEnabled: false, maxPaidDiscoveryPerCompany: 1, rediscoveryCooldownDays: 30 },
  }));
  await page.route('**/api/wizmatch/contact-intelligence/companies/company-1/discovery-preview', (route) => fulfillJson(route, {
    preview: {
      eligible: true,
      status: 'ready_for_manual_paid_discovery',
      estimatedCostCents: 100,
      providerOrder: ['internal_crm_reuse', 'website_manual_pattern', 'reacher_verification'],
      capStatus: { paidRunsInCooldown: 0, maxPaidDiscoveryPerCompany: 1, rediscoveryCooldownDays: 30, googleFallbackEnabled: false },
      costGuard: {
        allowed: true,
        currency: 'INR',
        providerEnv: { missing: [] },
        budget: {
          month: { usedCents: 0, limitCents: 500000 },
          day: { usedCents: 0, limitCents: 50000 },
          userDayRuns: { used: 0, limit: 5 },
          tenantDayRuns: { used: 0, limit: 20 },
          providerDayCalls: {},
        },
      },
      blockedReasons: [],
      notes: ['Preview makes no provider call.'],
    },
  }));
  await page.route('**/api/wizmatch/contact-intelligence/companies/company-1/discover', async (route) => {
    discoverBody = route.request().postDataJSON();
    await fulfillJson(route, {
      preview: { eligible: true, status: 'completed', estimatedCostCents: 0, costGuard: { currency: 'INR' } },
      status: 'succeeded',
      costCents: 0,
      contactCandidates: company.contactCandidates,
    });
  });

  await page.goto('/wizmatch/contact-intelligence');
  await expect(page.getByRole('heading', { name: 'Contact Intelligence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve company' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add manual contact' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link CRM' })).toBeVisible();

  const runButton = page.getByRole('button', { name: 'Confirm & run discovery' });
  await page.getByRole('button', { name: 'Discovery Preview' }).click();
  await expect(page.getByText('Estimated cost ₹1')).toBeVisible();
  await expect(runButton).toBeDisabled();
  expect(discoverBody).toBeNull();

  await page.getByRole('checkbox').check();
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await expect(page.getByText(/No outreach was sent/)).toBeVisible();
  expect(discoverBody).toEqual({ confirmPreview: true });
});

test('Contact Intelligence live failure stays honest and never shows demo companies', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/contact-intelligence/queue?**', (route) => fulfillJson(route, { error: 'Database unavailable' }, 500));

  await page.goto('/wizmatch/contact-intelligence');
  await expect(page.getByText('Could not load queue')).toBeVisible();
  await expect(page.getByText('Database unavailable')).toBeVisible();
  await expect(page.getByText('Bengaluru Cloud Staffing')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('dashboard and empty requirement priority show the corrected operating guidance', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/dashboard', (route) => fulfillJson(route, {
    summary: { openTasks: 3 },
    priorityActions: [],
    safetyCenter: {},
    guardrails: {},
  }));
  await page.route('**/api/wizmatch/requirement-priority/queue?**', (route) => fulfillJson(route, { items: [] }));

  await page.goto('/wizmatch/dashboard');
  await expect(page.getByText('Open work requiring action')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wizmatch work order' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Step 3 Signals/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Step 6 Requirements/ })).toBeVisible();

  await page.goto('/wizmatch/requirement-priority-new');
  await expect(page.getByRole('heading', { name: 'No confirmed requirements to prioritize' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Add a requirement/ })).toHaveAttribute('href', '/wizmatch/requirements');
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
  await page.route('**/api/**', (route) => fulfillJson(route, { error: 'Service unavailable for local outage test' }, 500));

  const routes = [
    { path: '/wizmatch/dashboard', heading: 'Wizmatch Dashboard', forbidden: 'Approve Asha Rao' },
    { path: '/wizmatch/review-workbench', heading: 'Wizmatch Review Workbench', forbidden: 'Approve Asha Rao' },
    { path: '/wizmatch/requirement-priority-new', heading: 'Requirement Priority', forbidden: 'Java Backend Developer' },
    { path: '/wizmatch/client-discovery', heading: 'Client Discovery', forbidden: 'Bengaluru Cloud Staffing' },
    { path: '/wizmatch/candidate-intelligence', heading: 'Candidate Intelligence', forbidden: 'Aarav Kumar' },
    { path: '/wizmatch/analytics', heading: 'Wizmatch Analytics / ROI', forbidden: '126' },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    await expect(page.getByText(route.forbidden, { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Service unavailable for local outage test/).first()).toBeVisible();
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

test('quota-backed candidate X-Ray stays disabled when provider gates are off', async ({ page }) => {
  await installWizmatchSession(page);
  await installGenericApiFallback(page);
  await page.route('**/api/wizmatch/readiness', (route) => fulfillJson(route, {
    costControls: { paidDiscoveryEnabled: false, googleFallbackEnabled: false },
  }));

  await page.goto('/wizmatch/source-candidates');
  await expect(page.getByRole('heading', { name: 'Source Candidates' })).toBeVisible();
  await expect(page.getByRole('option', { name: /LinkedIn X-Ray — disabled/ })).toBeDisabled();
  await expect(page.getByText(/stays disabled unless paid discovery and Google fallback are explicitly enabled/)).toBeVisible();
});

test('direct Wizmatch navigation preserves product and return path at login', async ({ page }) => {
  await page.goto('/wizmatch/dashboard');
  await expect(page).toHaveURL(/\/login\?tenant=wizmatch&returnTo=%2Fwizmatch%2Fdashboard/);
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
