import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility scan for the pages/dialogs built in the Wizmatch complete
// build (Jul 2026) — closes the "no axe-core scan ran" gap recorded in
// docs/release/WIZMATCH_RELEASE_READINESS.md. Mocked session + mocked API
// responses, same pattern as wizmatch-e2e-hardening-navigation.spec.ts.
//
// 2026-08-02 REPAIR. A full-app axe sweep of production measured 381 violation
// nodes while this suite was green. It was structurally incapable of catching
// any of them, for two reasons, both fixed below:
//
//   1. Every unmocked `**/api/**` call answered `{ items: [], total: 0 }`, so
//      every table rendered its EMPTY state and every per-row violation simply
//      never existed. The single biggest real offender was a per-row checkbox
//      that multiplied across rows — invisible to a suite that renders none.
//      Fixed by seeding FIXTURE_LIST, and — the part that actually matters —
//      by asserting the rows are on screen before axe runs. A page that
//      silently redirected or rendered empty scores zero violations, which is
//      indistinguishable from success; that false negative IS the bug.
//   2. Results were filtered to `critical | serious`, which made all 50
//      moderate nodes structurally invisible. Fixed by the enumerated
//      moderate landmark/heading gate in assertA11y().

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

// ---------------------------------------------------------------------------
// Non-empty catch-all fixture.
//
// Shaped loosely enough that any list page reached by these tests renders rows
// off the generic `**/api/**` handler, whether it reads `items`, `data`,
// `results` or `rows`. Per-test handlers registered later still win (Playwright
// matches routes most-recently-registered first), so the specific fixtures
// below are unaffected — this only changes what the UNMOCKED endpoints return,
// which is exactly where the empty-table blind spot lived.
// Same payload shape as e2e/walkthrough/axe-local.walkthrough.ts, which
// rendered 5 rows and 30-65 inputs on the WizMatch list pages.
const FIXTURE_ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: `fixture-${i}`,
  name: `Fixture Row ${i}`, title: `Fixture Row ${i}`,
  first_name: 'Fixture', last_name: `Row ${i}`,
  company: 'Fixture Co', company_name: 'Fixture Co', company_id: 'fixture-company',
  status: 'new', stage: 'draft', state: 'active', availability_status: 'available',
  email: `fixture-${i}@example.invalid`, phone: '910000000000', source: 'manual',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  score: 5, positions: 1, amount: 0, currency: 'INR',
  skills: ['java'], keywords: ['java'], roles: ['hiring_manager'],
}));
const FIXTURE_LIST = {
  items: FIXTURE_ROWS, data: FIXTURE_ROWS, results: FIXTURE_ROWS, rows: FIXTURE_ROWS,
  total: FIXTURE_ROWS.length, count: FIXTURE_ROWS.length, ok: true,
};

async function installBaseMocks(page: Page) {
  await page.route('**/api/**', (route) => json(route, FIXTURE_LIST));
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
 * Fails unless the route ACTUALLY MOUNTED and the seeded fixture is on screen.
 *
 * This runs before every axe scan of a list page, and it is the load-bearing
 * half of this repair. Two failure modes both score zero axe violations and
 * are indistinguishable from a clean page:
 *   - a route guard bounced the navigation (every WizMatch guard redirects to
 *     /wizmatch/today, so the page under test never mounts);
 *   - the page mounted but rendered its empty state.
 *
 * `sample` must be text/locator that can ONLY come from the seeded rows.
 * `minDataRows` counts `tr[tabindex="0"]` rather than `table tbody tr`, because
 * DataTable.jsx renders one <tr> for the empty state and EIGHT skeleton <tr>s
 * while loading — a raw tbody-row count proves nothing.
 */
async function assertRendered(
  page: Page,
  expectedPath: string,
  sample: Locator,
  opts: { minDataRows?: number } = {},
) {
  const landed = new URL(page.url()).pathname;
  expect(landed, `expected to be on ${expectedPath}; a route guard redirected to ${landed}`).toBe(expectedPath);
  await expect(sample, `${expectedPath} mounted but the seeded fixture never rendered`).toBeVisible();
  if (opts.minDataRows) {
    const dataRows = await page.locator('table tbody tr[tabindex="0"]').count();
    expect(dataRows, `${expectedPath} rendered ${dataRows} data row(s), expected >= ${opts.minDataRows}`)
      .toBeGreaterThanOrEqual(opts.minDataRows);
  }
}

// ---------------------------------------------------------------------------
// Moderate-impact landmark/heading gate.
//
// The old filter discarded everything below `serious`, which hid all 50
// moderate nodes the production sweep found: landmark-unique (26), region (14),
// heading-order (4), page-has-heading-one (4), landmark-one-main (2).
//
// Flipping the filter off wholesale would leave the suite permanently red: the
// ~25 CRM pages that render their own bare <Sidebar/> + <main> shell (see the
// note in admin/src/components/AppLayout.jsx) still emit `region` and
// `landmark-one-main`. So these five rules are enumerated and gated by a NUMBER
// per scan point instead. The count can only go down — any NEW node fails.
const MODERATE_LANDMARK_RULES = [
  'landmark-unique',
  'page-has-heading-one',
  'heading-order',
  'landmark-one-main',
  'region',
] as const;

/**
 * Known-issue allowance for ONE scan point, per rule. The default is 0
 * everywhere, and every scan in this file uses the default.
 *
 * Justification for 0: a local axe run over 14 rendered routes on 2026-08-02
 * (after the 353 aria-label fixes) measured ZERO nodes at EVERY impact level on
 * every AppLayout-hosted WizMatch page — today, job-leads, hiring-contacts,
 * requirements, candidates, placements, reports. All 31 nodes it did find came
 * from the shared CRM pages (tasks, inbox, pipeline, finance, audit), none of
 * which this suite visits. Every route below renders through AppLayout, so 0 is
 * a measurement, not an aspiration.
 *
 * Anything non-zero must carry a comment saying what it represents and what
 * has to happen for it to be reduced.
 */
type ModerateAllowance = Partial<Record<(typeof MODERATE_LANDMARK_RULES)[number], number>>;

/**
 * Runs axe against the current page state.
 *
 * Hard-fails on any critical/serious violation (this includes `color-contrast`,
 * which stays an unconditional failure — no contrast allowance is encoded
 * anywhere in this file) AND on any enumerated moderate landmark/heading rule
 * that exceeds its allowance.
 *
 * Moderate rules OUTSIDE the enumerated set stay non-blocking, as before.
 */
async function assertA11y(page: Page, label: string, allowance: ModerateAllowance = {}) {
  const results = await new AxeBuilder({ page }).analyze();
  const failures: string[] = [];

  for (const v of results.violations) {
    if (v.impact === 'critical' || v.impact === 'serious') {
      failures.push(`- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ')})`);
    }
  }

  const slack: string[] = [];
  for (const rule of MODERATE_LANDMARK_RULES) {
    const found = results.violations.find((v) => v.id === rule);
    const nodes = found?.nodes.length ?? 0;
    const allowed = allowance[rule] ?? 0;
    if (nodes > allowed) {
      failures.push(`- [moderate] ${rule}: ${nodes} node(s), allowance ${allowed} — a NEW violation appeared (e.g. ${found?.nodes[0]?.target.join(' ')})`);
    } else if (nodes < allowed) {
      slack.push(`${rule} ${nodes} < ${allowed}`);
    }
  }
  // The ratchet: whenever reality beats the allowance, say so loudly so the
  // number gets tightened rather than quietly rotting upward.
  if (slack.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[a11y ratchet] ${label}: allowance is now looser than reality — lower it (${slack.join(', ')})`);
  }

  if (failures.length > 0) {
    throw new Error(`${label}: ${failures.length} blocking a11y violation(s):\n${failures.join('\n')}`);
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
        effectiveDecision: 'allow',
        enforcementMode: 'shadow', requiresExplicitApproval: false, outreachEligibility: 'eligible',
        contactConfidenceTier: 'high', duplicatePending: false, duplicateId: null, isNonOverridable: false,
        policyScopeKey: 'entire_company', disabledReason: null,
        // PR 8B (P8B-2) — real server semantics: `approve_queue` on an
        // already-`eligible` company is idempotency-refused
        // (`already_approved`, decisionWorkbenchActions.ts), so the capability
        // this row would really receive is disabled, not enabled. The a11y
        // dialog/focus interaction below now targets Review Co instead, whose
        // approval is a genuinely available action.
        capabilities: { approve_queue: { enabled: false, reason: 'This company is already eligible; the approval was already recorded.' } },
      }, {
        // D-31: canonical resolver would DENY (L6b company cold-email lock) but
        // enforcement is `shadow`, so the API's behavioural `effectiveDecision`
        // follows the stored policy row. The row must keep every affordance and
        // disclose the divergence — shadow may never block through the UI.
        companyId: 'shadow-diverged-1', companyName: 'Shadow Diverged Co', companyDomain: null,
        canonicalDecision: 'deny', canonicalReasonCode: 'company_cold_email_lock',
        canonicalBlockerCode: 'policy_company_cold_email_lock',
        effectiveDecision: 'allow',
        enforcementMode: 'shadow', requiresExplicitApproval: false, outreachEligibility: 'eligible',
        contactConfidenceTier: 'high', duplicatePending: false, duplicateId: null, isNonOverridable: false,
        policyScopeKey: 'entire_company', disabledReason: null,
        // Also already-eligible for the same reason as Ready Co above — the
        // test only asserts this button stays VISIBLE (§16 rule 2: shadow
        // keeps every affordance a policy-eligible row has), never that it is
        // enabled, so this reflects real semantics without changing that
        // assertion.
        capabilities: { approve_queue: { enabled: false, reason: 'This company is already eligible; the approval was already recorded.' } },
      }],
      needsReview: [{
        companyId: 'review-1', companyName: 'Review Co', companyDomain: null,
        canonicalDecision: 'review', canonicalReasonCode: 'policy_unknown_cold_start', canonicalBlockerCode: null,
        effectiveDecision: 'review',
        enforcementMode: 'shadow', requiresExplicitApproval: true, outreachEligibility: 'needs_review',
        contactConfidenceTier: 'medium', duplicatePending: false, duplicateId: null, isNonOverridable: false,
        policyScopeKey: 'entire_company', disabledReason: 'No high- or medium-confidence contact is available yet.',
        // Not yet eligible, admin role, no non-overridable block — approve_queue
        // is a genuinely available action here, unlike the two rows above.
        capabilities: { approve_queue: { enabled: true, reason: null } },
      }],
      pausedOrBlocked: [{
        companyId: 'blocked-1', companyName: 'Blocked Co', companyDomain: null,
        canonicalDecision: 'deny', canonicalReasonCode: 'company_removal_request', canonicalBlockerCode: 'policy_company_removal_request',
        effectiveDecision: 'deny',
        enforcementMode: 'shadow', requiresExplicitApproval: false, outreachEligibility: 'blocked',
        contactConfidenceTier: null, duplicatePending: false, duplicateId: null, isNonOverridable: true, blockClass: 'compliance',
        policyScopeKey: 'entire_company', disabledReason: 'This company has a non-overridable block. No override or reclassify action is available at any scope.',
        capabilities: {
          approve_queue: { enabled: false, reason: 'This company has a non-overridable block at scope \'entire_company\'. No override, resume or reclassify action is available at any scope.' },
          resume: { enabled: false, reason: 'This company has a non-overridable block at scope \'entire_company\'. No override, resume or reclassify action is available at any scope.' },
          skip: { enabled: false, reason: 'This company has a non-overridable block at scope \'entire_company\'. No override, resume or reclassify action is available at any scope.' },
          pause: { enabled: false, reason: 'This company has a non-overridable block at scope \'entire_company\'. No override, resume or reclassify action is available at any scope.' },
        },
      }],
      repliesNeedingAction: [{ enrolmentId: 'enrol-1', companyId: 'ready-1', companyName: 'Ready Co', contactId: null, state: 'awaiting_action', stateAt: new Date().toISOString() }],
      counts: { readyToContact: 2, needsReview: 1, repliesNeedingAction: 1, pausedOrBlocked: 1 },
      partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
    }));
    await page.goto('/wizmatch/today');
    await page.waitForLoadState('networkidle');
    // Four seeded company rows (2 ready + 1 needs-review + 1 blocked), each a
    // DataTable row with its own select checkbox and action buttons. If the
    // workbench ever renders empty here, axe scores 0 and the test used to pass.
    await assertRendered(page, '/wizmatch/today',
      page.getByRole('row').filter({ hasText: 'Review Co' }), { minDataRows: 4 });
    await assertA11y(page, 'Today');

    // Keyboard/focus coverage (PR 6 §9): Approve & Queue on the needs-review
    // row opens the action dialog, focus moves inside it, and Escape closes
    // it without leaving focus stranded. Targets Review Co specifically (not
    // Ready Co) because PR 8B (P8B-2) capability-driven rendering correctly
    // disables Approve & Queue on an already-`eligible` company — Review Co
    // is the row where this action is genuinely available.
    const approveButton = page.getByRole('row').filter({ hasText: 'Review Co' }).getByRole('button', { name: 'Approve & Queue' });
    await approveButton.focus();
    await expect(approveButton).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Approve & Queue/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // D-31 / §16 rule 2 — the shadow-diverged row (canonical DENY, enforcement
    // `shadow`) must keep every affordance a policy-eligible row has, and must
    // disclose the divergence rather than silently acting on it. If the UI ever
    // keys its actions off `canonicalDecision` again, "Approve & Queue"
    // disappears here and this fails.
    const divergedRow = page.getByRole('row').filter({ hasText: 'Shadow Diverged Co' });
    await expect(divergedRow.getByRole('button', { name: 'Approve & Queue' })).toBeVisible();
    await expect(divergedRow.getByRole('button', { name: 'Reclassify' })).toHaveCount(0);
    await expect(divergedRow.getByText('shadow: would deny')).toBeVisible();
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
    // /wizmatch/companies sits behind StaffingPhaseRoute phase="A"; without the
    // access mock it redirects to /wizmatch/today and the scan below would be
    // measuring the wrong page. assertRendered catches exactly that.
    await assertRendered(page, '/wizmatch/companies',
      page.getByText('A11y Company').first(), { minDataRows: 1 });
    // Scan the LIST state too, not just the drawer — per-row violations (row
    // checkboxes, row action buttons) only exist while rows are on screen.
    await assertA11y(page, 'Companies (list with rows)');

    await page.getByText('A11y Company').click();
    await expect(page.getByRole('heading', { name: 'A11y Company' })).toBeVisible();
    await assertA11y(page, 'Companies (detail drawer open)');

    await page.getByRole('button', { name: 'Discover contacts' }).click();
    await assertA11y(page, 'Companies (discovery panel open)');
  });

  test('Hiring Contacts — both tabs, linked-contact drawer', async ({ page }) => {
    await page.route('**/api/wizmatch/staffing/companies*', (route) => json(route, {
      items: [{ id: 'c1', name: 'A11y Company' }],
    }));
    // The Linked tab reads the BULK cross-company endpoint. It used to fan out
    // one /companies/:id/contacts request per company; that was removed, so a
    // spec mocking only the fan-out renders zero rows and times out on the row
    // click below — which is exactly what was happening here.
    await page.route('**/api/wizmatch/staffing/hiring-contacts*', (route) => json(route, {
      items: [{ id: 'cc1', company_id: 'c1', company_name: 'A11y Company', first_name: 'Jane', last_name: 'Doe', roles: ['hiring_manager'], email: 'jane@a11y.test', active_requirement_count: 1, relationship_stage: 'active' }],
      total: 1,
    }));
    // Kept as a tripwire: if the fan-out ever comes back, this fulfils it and the
    // request-count spec catches it rather than this one hanging.
    await page.route('**/api/wizmatch/companies/c1/contacts', (route) => json(route, {
      items: [{ id: 'cc1', first_name: 'Jane', last_name: 'Doe', roles: ['hiring_manager'], email: 'jane@a11y.test', active_requirement_count: 1, relationship_stage: 'active' }],
    }));
    await page.route('**/api/wizmatch/staffing/company-contacts/cc1', (route) => json(route, {
      contact: { id: 'cc1', first_name: 'Jane', last_name: 'Doe', company_name: 'A11y Company', roles: ['hiring_manager'] },
      requirements: [], tasks: [], events: [],
    }));
    await page.route('**/api/wizmatch/contact-intelligence/queue?**', (route) => json(route, {
      items: [{ companyId: 'c1', companyName: 'A11y Company', contactCandidates: [{ id: 'cand1', name: 'Discovered Person', title: 'HR Lead', status: 'needs_review', deliverabilityStatus: null }] }],
      // total/returned present so the pager renders and is included in the scan.
      total: 1,
      returned: 1,
    }));

    await page.goto('/wizmatch/hiring-contacts');
    await page.waitForLoadState('networkidle');
    await assertRendered(page, '/wizmatch/hiring-contacts',
      page.getByRole('row').filter({ hasText: 'jane@a11y.test' }), { minDataRows: 1 });
    await assertA11y(page, 'Hiring Contacts (linked tab)');

    await page.getByRole('row').filter({ hasText: 'jane@a11y.test' }).click();
    await expect(page.getByRole('heading', { name: 'Jane Doe' })).toBeVisible();
    await assertA11y(page, 'Hiring Contacts (linked-contact drawer open)');
    await page.getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: 'Discovery queue' }).click();
    await assertA11y(page, 'Hiring Contacts (discovery queue tab)');
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
    await assertRendered(page, '/wizmatch/candidates',
      page.getByRole('row').filter({ hasText: 'A11y Candidate' }), { minDataRows: 1 });
    await assertA11y(page, 'Candidates (list with rows)');

    await page.getByRole('row').filter({ hasText: 'A11y Candidate' }).click();
    await expect(page.getByRole('heading', { name: 'A11y Candidate' })).toBeVisible();
    await assertA11y(page, 'Candidates (360 drawer with match)');
  });

  test('Submissions — delivery board + all 6 dialogs', async ({ page }) => {
    const draft = { id: 's1', first_name: 'A11y', last_name: 'Candidate', requirement_id: 'r1', requirement_title: 'A11y Requirement', company_name: 'A11y Co', consent_status: 'requested', status: 'draft', resend_count: 0, interview_count: 0 };
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.route('**/api/wizmatch/staffing/analytics', (route) => json(route, {
      commercial: { starts: 0, gross_margin: 0, invoiced: 0, collected: 0 }, exceptions: { overdue_submissions: 0, missing_next_action: 0 }, timeToFill: { average_days: null },
    }));
    await page.goto('/wizmatch/submissions');
    await page.waitForLoadState('networkidle');
    // /wizmatch/submissions is behind StaffingPhaseRoute phase="C". The board
    // renders its own <table className="table-fluent"> rather than DataTable, so
    // there is no tabindex row marker to count — the seeded requirement title is
    // the evidence that a real row (with its per-row action buttons) exists.
    await assertRendered(page, '/wizmatch/submissions',
      page.getByText('A11y Requirement').first());
    await assertA11y(page, 'Submissions (board)');

    await page.getByRole('button', { name: 'Consent' }).click();
    await assertA11y(page, 'Submissions (Consent dialog)');
    await page.keyboard.press('Escape');

    draft.status = 'approved';
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Record sent' }).click();
    await assertA11y(page, 'Submissions (Submission dialog)');
    await page.keyboard.press('Escape');

    draft.status = 'submitted';
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add interview' }).click();
    await assertA11y(page, 'Submissions (Interview dialog)');
    await page.keyboard.press('Escape');

    draft.status = 'interviewing';
    await page.route('**/api/wizmatch/staffing/delivery-board', (route) => json(route, { items: [draft] }));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Add offer' }).click();
    await assertA11y(page, 'Submissions (Offer dialog)');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Withdraw' }).click();
    await assertA11y(page, 'Submissions (Withdraw dialog)');
    await page.keyboard.press('Escape');
  });

  test('Placements — Kanban + detail modal (all 5 tabs)', async ({ page }) => {
    await page.route('**/api/wizmatch/placements?**', (route) => json(route, {
      items: [{ id: 'p1', candidate_first: 'A11y', candidate_last: 'Candidate', company_name: 'A11y Co', status: 'started', requirement_id: 'r1' }],
    }));
    await page.route('**/api/wizmatch/requirements/r1/timeline', (route) => json(route, { items: [] }));
    await page.goto('/wizmatch/placements');
    await page.waitForLoadState('networkidle');
    // Kanban, not a table — the seeded card is the row-equivalent here.
    await assertRendered(page, '/wizmatch/placements',
      page.getByText('A11y Candidate').first());
    await assertA11y(page, 'Placements (Kanban)');

    await page.getByText('A11y Candidate').click();
    await expect(page.getByText('Overview')).toBeVisible();
    for (const tab of ['Overview', 'Economics', 'Invoice', 'Collection', 'Adjustments']) {
      await page.getByRole('button', { name: tab }).click();
      await assertA11y(page, `Placements (${tab} tab)`);
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
    // Populated, not empty: this feeds the Reports requirement filter, and a
    // <select> with no <option>s cannot surface the per-option problems this
    // scan is meant to find.
    await page.route('**/api/wizmatch/requirements?**', (route) => json(route, FIXTURE_LIST));
    await page.goto('/wizmatch/reports');
    await page.waitForLoadState('networkidle');
    // Reports has no data table — it is charts and stat tiles. There is no
    // "rows rendered" property to assert, so this only proves the route mounted
    // rather than being bounced to /wizmatch/today. Stated plainly rather than
    // dressed up as a row assertion it is not.
    await assertRendered(page, '/wizmatch/reports',
      page.getByRole('heading', { name: 'Wizmatch Reports' }));
    await assertA11y(page, 'Reports');
  });
});
