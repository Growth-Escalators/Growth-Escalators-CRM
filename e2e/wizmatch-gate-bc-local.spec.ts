import { expect, test, type Page, type Route } from '@playwright/test';

const session = { token: 'local-wizmatch-gate-bc-token', user: { id: 'admin-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: 'wizmatch' } };
async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }

const access = {
  allowed: true,
  phases: { A: true, B: true, C: true },
  capabilities: {
    manageCandidateEvidence: true,
    viewCommercial: true,
    operateDelivery: true,
    approveSubmissions: true,
    manageOffers: true,
    manageFinance: true,
  },
};
const emptyAnalytics = {
  funnel: [], commercial: { starts: 0, gross_margin: 0, invoiced: 0, collected: 0 },
  exceptions: { overdue_submissions: 0, missing_next_action: 0 },
  timeToFill: { average_days: null }, cohorts: [], aging: [], rejectionReasons: [], recruiterPerformance: [], sourcePerformance: [],
};

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
    if (path === '/api/wizmatch/staffing/analytics') return json(route, emptyAnalytics);
    if (path === '/api/wizmatch/staffing/delivery-board' || path === '/api/wizmatch/staffing/recruiter-work' || path === '/api/wizmatch/staffing/placements') return json(route, { items: [] });
    if (path === '/api/wizmatch/candidates') return json(route, { items: [], total: 0 });
    if (path === '/api/wizmatch/candidate-intelligence/queue') return json(route, { items: [], total: 0 });
    return json(route, {});
  });
}

test('Candidates shortlist is side-effect free and consent starts only from Submissions', async ({ page }) => {
  await setup(page);
  let decision = '';
  let consentCalls = 0;
  let submissionCalls = 0;
  let consentPayload: Record<string, unknown> | null = null;
  let submissionPayload: Record<string, unknown> | null = null;
  const items = [
    { id: 'm-sap', candidate_id: 'c-sap', requirement_id: 'r-sap', first_name: 'Asha', last_name: 'SAP', requirement_title: 'SAP ABAP Developer', score: 96, score_version: 'gate-b-v1', blockers: [], missing_evidence: [], human_decision: 'unreviewed' },
    { id: 'm-java', candidate_id: 'c-java', requirement_id: 'r-java', first_name: 'Jay', last_name: 'Java', requirement_title: 'Java Developer', score: 88, score_version: 'gate-b-v1', blockers: [], missing_evidence: ['recency:Java'], human_decision: 'shortlisted' },
  ];
  await page.route('**/api/wizmatch/staffing/recruiter-work', (route) => json(route, { items }));
  await page.route('**/api/wizmatch/staffing/matches/*/decision', async (route) => {
    decision = (await route.request().postDataJSON()).decision;
    items[0].human_decision = decision;
    return json(route, { ok: true });
  });
  await page.route('**/api/wizmatch/staffing/consents', async (route) => {
    consentCalls += 1;
    consentPayload = await route.request().postDataJSON();
    return json(route, { id: 'consent-1', status: 'granted' }, 201);
  });
  await page.route('**/api/wizmatch/staffing/submissions', async (route) => {
    submissionCalls += 1;
    submissionPayload = await route.request().postDataJSON();
    return json(route, { id: 'submission-1', status: 'draft' }, 201);
  });

  await page.goto('/wizmatch/candidates?view=matching');
  await expect(page.getByRole('heading', { name: 'Candidates' })).toBeVisible();
  await expect(page.getByText('SAP ABAP Developer')).toBeVisible();
  await expect(page.getByText('Java Developer')).toBeVisible();

  const asha = page.locator('article').filter({ hasText: 'Asha SAP' });
  await asha.getByRole('button', { name: 'Shortlist' }).click();
  await expect.poll(() => decision).toBe('shortlisted');
  await expect(page.getByText(/No consent or submission was created/i)).toBeVisible();
  expect(consentCalls).toBe(0);
  expect(submissionCalls).toBe(0);

  await asha.getByRole('link', { name: 'Continue in Submissions' }).click();
  await expect(page).toHaveURL(/\/wizmatch\/submissions\?matchId=m-sap&action=consent/);
  await expect(page.getByRole('heading', { name: 'Submissions' })).toBeVisible();
  const consentDialog = page.getByRole('dialog', { name: 'Record exact-requirement consent' });
  await expect(consentDialog).toBeVisible();
  await consentDialog.getByRole('checkbox', { name: /Consent genuinely received/i }).check();
  await consentDialog.getByRole('button', { name: 'Record action' }).click();

  await expect.poll(() => consentCalls).toBe(1);
  await expect.poll(() => submissionCalls).toBe(1);
  expect(consentPayload).toMatchObject({ candidateId: 'c-sap', requirementId: 'r-sap', status: 'granted', consentType: 'rtr' });
  expect(submissionPayload).toMatchObject({ candidateId: 'c-sap', requirementId: 'r-sap', matchId: 'm-sap' });
  await expect(page.getByText(/Nothing was sent/i)).toBeVisible();
});

test('Submissions advances through validated delivery forms into a traceable placement', async ({ page }) => {
  await setup(page);
  const recorded: string[] = [];
  const submission = {
    id: 's-1', candidate_id: 'c-sap', requirement_id: 'r-sap', first_name: 'Asha', last_name: 'SAP',
    requirement_title: 'SAP ABAP Developer', company_name: 'Company A', consent_status: 'granted',
    status: 'draft', resend_count: 0, interview_count: 0,
  } as Record<string, unknown>;

  await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [submission] }));
  await page.route('**/api/wizmatch/staffing/recruiter-work', (route) => json(route, { items: [] }));
  await page.route('**/api/wizmatch/staffing/submissions/s-1/approve', (route) => {
    recorded.push('approved'); submission.status = 'approved'; return json(route, { status: 'approved' });
  });
  await page.route('**/api/wizmatch/staffing/submissions/s-1/record-sent', async (route) => {
    const payload = await route.request().postDataJSON();
    expect(payload.recipients).toEqual([{ name: 'Person A', email: 'person.a@example.test' }]);
    recorded.push('sent'); submission.status = 'submitted'; return json(route, { status: 'submitted' });
  });
  await page.route('**/api/wizmatch/staffing/submissions/s-1/interviews', async (route) => {
    const payload = await route.request().postDataJSON();
    expect(payload.roundType).toBe('technical');
    recorded.push('interview');
    Object.assign(submission, { status: 'interviewing', interview_count: 1, latest_interview_id: 'interview-1', latest_interview_status: 'scheduled' });
    return json(route, { id: 'interview-1', status: 'scheduled' }, 201);
  });
  await page.route('**/api/wizmatch/staffing/interviews/interview-1', async (route) => {
    const payload = await route.request().postDataJSON();
    expect(payload).toMatchObject({ status: 'completed', outcome: 'Proceed to offer' });
    expect(payload.feedback).toContain('Strong technical fit');
    recorded.push('feedback'); submission.latest_interview_status = 'completed'; return json(route, { id: 'interview-1', status: 'completed' });
  });
  await page.route('**/api/wizmatch/staffing/submissions/s-1/offers', async (route) => {
    const payload = await route.request().postDataJSON();
    expect(payload).toMatchObject({ amount: 1_200_000, currency: 'INR', period: 'annual' });
    recorded.push('offer');
    Object.assign(submission, { status: 'offered', latest_offer_id: 'offer-1', offer_revision: 1, offer_status: 'draft' });
    return json(route, { id: 'offer-1', status: 'draft' }, 201);
  });
  await page.route('**/api/wizmatch/staffing/offers/offer-1/status', (route) => {
    recorded.push('accepted'); submission.offer_status = 'accepted'; return json(route, { status: 'accepted' });
  });
  await page.route('**/api/wizmatch/staffing/submissions/s-1/placement', async (route) => {
    const payload = await route.request().postDataJSON();
    expect(payload).toMatchObject({ offerId: 'offer-1', model: 'permanent', originalAmount: 180_000, feeAmount: 180_000, currency: 'INR' });
    recorded.push('placed'); submission.status = 'placed'; return json(route, { id: 'placement-1', status: 'started' }, 201);
  });

  await page.goto('/wizmatch/submissions?submissionId=s-1');
  await expect(page.getByRole('heading', { name: 'Submissions' })).toBeVisible();
  await expect(page.getByText(/never sends automatically/i)).toBeVisible();

  await page.getByRole('button', { name: 'Approve submission' }).click();
  await page.getByRole('button', { name: 'Record sent' }).click();
  let dialog = page.getByRole('dialog', { name: 'Record manual submission delivery' });
  await dialog.getByLabel('Named recipient').fill('Person A');
  await dialog.getByLabel('Recipient email (optional)').fill('person.a@example.test');
  await dialog.getByRole('button', { name: 'Record action' }).click();

  await page.getByRole('button', { name: 'Add interview' }).click();
  dialog = page.getByRole('dialog', { name: 'Schedule interview' });
  await dialog.getByLabel('Interview date and time').fill('2026-07-15T10:00');
  await dialog.getByLabel('Round type').selectOption('technical');
  await dialog.getByRole('button', { name: 'Record action' }).click();

  await page.getByRole('button', { name: 'Record interview outcome' }).click();
  dialog = page.getByRole('dialog', { name: 'Record interview outcome' });
  await dialog.getByLabel('Outcome').fill('Proceed to offer');
  await dialog.getByLabel('Feedback').fill('Strong technical fit; approved by the interview panel.');
  await dialog.getByRole('button', { name: 'Record action' }).click();

  await page.getByRole('button', { name: 'Add offer' }).click();
  dialog = page.getByRole('dialog', { name: 'Add offer revision' });
  await dialog.getByLabel('Amount').fill('1200000');
  await dialog.getByRole('button', { name: 'Record action' }).click();

  await page.getByRole('button', { name: 'Record offer accepted' }).click();
  await page.getByRole('button', { name: 'Create placement' }).click();
  dialog = page.getByRole('dialog', { name: 'Create traceable placement' });
  await dialog.getByLabel('Permanent fee').fill('180000');
  await dialog.getByRole('button', { name: 'Record action' }).click();

  await expect.poll(() => recorded).toEqual(['approved', 'sent', 'interview', 'feedback', 'offer', 'accepted', 'placed']);
  await expect(page.getByText(/Traceable placement created/i)).toBeVisible();
});

test('canonical Candidates, Submissions, Placements and Reports remain usable at desktop, tablet and mobile widths', async ({ page }) => {
  await setup(page);
  const routes = [
    ['/wizmatch/candidates?view=leads', 'Candidates'],
    ['/wizmatch/submissions', 'Submissions'],
    ['/wizmatch/placements', 'Placements'],
    ['/wizmatch/reports', 'Staffing reports'],
  ] as const;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} should not overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  }
});
