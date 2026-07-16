#!/usr/bin/env node

/**
 * Capture sanitized SOP screenshots from the real, locally running Wizmatch SPA.
 *
 * The app code and navigation are real. Network responses are deterministic
 * training fixtures so the guide never contains production data, credentials,
 * or client/candidate PII.
 */

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'wizmatch', 'sop-assets');
const baseUrl = process.env.WIZMATCH_SOP_BASE_URL || 'http://127.0.0.1:5175';

const access = {
  allowed: true,
  role: 'admin',
  pilotAccess: true,
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

const workItems = [
  {
    id: 'work-sap', bucket: 'overdue', entityType: 'requirement', entityId: 'role-sap',
    title: 'SAP ABAP Consultant', subtitle: 'Company A (Training) - Person A',
    blocker: 'Client feedback is overdue', recommendedAction: 'Confirm shortlist feedback with Person A',
    dueAt: '2026-07-13T11:00:00+05:30', sla: 'overdue', href: '/wizmatch/roles?requirementId=role-sap',
  },
  {
    id: 'work-java', bucket: 'due_today', entityType: 'requirement', entityId: 'role-java',
    title: 'Java Backend Developer', subtitle: 'Company A (Training) - Person B',
    recommendedAction: 'Review the Java candidate evidence', dueAt: '2026-07-14T16:00:00+05:30',
    sla: 'due_today', href: '/wizmatch/roles?requirementId=role-java',
  },
  {
    id: 'work-poc', bucket: 'blocked', entityType: 'contact_candidate', entityId: 'poc-3',
    title: 'Verify hiring POC for SAP FICO lead', subtitle: 'Fictional Systems India',
    blocker: 'Named person found; genuine contact channel still needs verification',
    recommendedAction: 'Review public evidence and record a genuine channel',
    dueAt: '2026-07-14T17:00:00+05:30', sla: 'blocked', href: '/wizmatch/hiring-contacts?candidateId=poc-3',
  },
];

const signals = [
  { id: 'signal-sap', job_title: 'SAP ABAP Consultant', company_name: 'Company A (Training)', location: 'Bengaluru - Hybrid', source: 'theirstack', status: 'qualified', score: 86, poc_state: 'verified', keywords: ['SAP ABAP', 'S/4HANA'] },
  { id: 'signal-java', job_title: 'Java Backend Developer', company_name: 'Company A (Training)', location: 'Pune - Remote', source: 'ats', status: 'scored', score: 78, keywords: ['Java', 'Spring Boot'] },
  { id: 'signal-fico', job_title: 'SAP FICO Functional Consultant', company_name: 'Fictional Systems India', location: 'Hyderabad', source: 'theirstack', status: 'new', score: 72, keywords: ['SAP FICO'] },
];

const companies = [
  { id: 'company-a', name: 'Company A (Training)', domain: 'company-a.example', industry: 'Technology services', country: 'India', contact_count: 2, open_requirement_count: 2, open_task_count: 2 },
  { id: 'company-b', name: 'Fictional Systems India', domain: 'fictional-systems.example', industry: 'Software', country: 'India', contact_count: 1, open_requirement_count: 1, open_task_count: 1 },
];

const hiringContacts = [
  { id: 'contact-a', company_id: 'company-a', company_name: 'Company A (Training)', first_name: 'Person', last_name: 'A', title: 'Talent Acquisition Lead', roles: ['talent_acquisition', 'source'], email: 'person.a@company-a.example', active_requirement_count: 1, next_action: 'Confirm SAP shortlist feedback', next_action_due_at: '2026-07-14T16:00:00+05:30' },
  { id: 'contact-b', company_id: 'company-a', company_name: 'Company A (Training)', first_name: 'Person', last_name: 'B', title: 'Engineering Hiring Manager', roles: ['hiring_manager', 'source'], email: 'person.b@company-a.example', active_requirement_count: 1, next_action: 'Review Java interview panel', next_action_due_at: '2026-07-15T11:00:00+05:30' },
  { id: 'contact-c', company_id: 'company-b', company_name: 'Fictional Systems India', first_name: 'Person', last_name: 'C', title: 'Recruitment Partner', roles: ['talent_acquisition'], active_requirement_count: 0, next_action: 'Verify genuine contact channel', next_action_due_at: '2026-07-14T17:00:00+05:30' },
];

const roles = [
  { id: 'role-sap', title: 'SAP ABAP Consultant', company_name: 'Company A (Training)', primary_source_name: 'Person A', required_skills: ['SAP ABAP', 'S/4HANA'], assignments: [{ id: 'sap-owner', name: 'Training Admin', role: 'account_owner' }, { id: 'sap-rec', name: 'Recruiter One', role: 'recruiter' }], stage: 'sourcing', next_action: 'Confirm shortlist feedback', next_action_due_at: '2026-07-14T16:00:00+05:30', priority: 'high', attribution_status: 'attributed' },
  { id: 'role-java', title: 'Java Backend Developer', company_name: 'Company A (Training)', primary_source_name: 'Person B', required_skills: ['Java', 'Spring Boot'], assignments: [{ id: 'java-owner', name: 'Training Admin', role: 'account_owner' }, { id: 'java-rec', name: 'Recruiter Two', role: 'recruiter' }], stage: 'accepted', next_action: 'Review candidate evidence', next_action_due_at: '2026-07-15T12:00:00+05:30', priority: 'normal', attribution_status: 'attributed' },
  { id: 'role-fico', title: 'SAP FICO Functional Consultant', company_name: 'Fictional Systems India', primary_source_name: 'Person C', required_skills: ['SAP FICO'], assignments: [{ id: 'fico-owner', name: 'Training Admin', role: 'account_owner' }], stage: 'qualifying', next_action: 'Verify Person C contact channel', next_action_due_at: '2026-07-14T17:00:00+05:30', priority: 'normal', attribution_status: 'needs_attribution' },
];

const matches = [
  { id: 'match-sap', candidate_id: 'candidate-rahul', first_name: 'Rahul', last_name: 'Example', candidate_name: 'Rahul Example', requirement_id: 'role-sap', requirement_title: 'SAP ABAP Consultant', score: 91, score_version: 'v1.0', blockers: [], missing_evidence: [], human_decision: 'shortlisted' },
  { id: 'match-java', candidate_id: 'candidate-priya', first_name: 'Priya', last_name: 'Example', candidate_name: 'Priya Example', requirement_id: 'role-java', requirement_title: 'Java Backend Developer', score: 87, score_version: 'v1.0', blockers: [], missing_evidence: ['availability confirmation'], human_decision: 'watch' },
  { id: 'match-cross', candidate_id: 'candidate-rahul', first_name: 'Rahul', last_name: 'Example', candidate_name: 'Rahul Example', requirement_id: 'role-java', requirement_title: 'Java Backend Developer', score: 18, score_version: 'v1.0', blockers: ['missing mandatory Java'], missing_evidence: [], human_decision: 'rejected' },
];

const deliveryBoard = [
  { id: 'submission-sap', candidate_id: 'candidate-rahul', first_name: 'Rahul', last_name: 'Example', requirement_id: 'role-sap', requirement_title: 'SAP ABAP Consultant', company_name: 'Company A (Training)', consent_status: 'granted', status: 'submitted', resend_count: 0, interview_count: 0, next_action: 'Confirm interview availability', next_action_due_at: '2026-07-15T11:00:00+05:30' },
  { id: 'submission-java', candidate_id: 'candidate-priya', first_name: 'Priya', last_name: 'Example', requirement_id: 'role-java', requirement_title: 'Java Backend Developer', company_name: 'Company A (Training)', consent_status: 'granted', status: 'interviewing', resend_count: 1, interview_count: 1, latest_interview_id: 'interview-java-1', latest_interview_status: 'scheduled', next_action: 'Record interview feedback', next_action_due_at: '2026-07-15T18:00:00+05:30' },
];

const placements = [
  { placementId: 'placement-sap', candidateName: 'Rahul Example', requirement_title: 'SAP ABAP Consultant', company_name: 'Company A (Training)', submissionId: 'submission-sap', linked_offer_id: 'offer-sap-1', status: 'started', start_date: '2026-07-01', economics: { model: 'permanent', originalAmount: 180000, originalCurrency: 'INR', originalPeriod: 'one_time' }, invoice: { id: 'invoice-sap', number: 'QA-INV-001', totalAmount: 180000 }, collections: { amount: 90000 }, open_adjustment_count: 0 },
  { placementId: 'placement-java', candidateName: 'Priya Example', requirement_title: 'Java Backend Developer', company_name: 'Company A (Training)', submissionId: 'submission-java', linked_offer_id: 'offer-java-1', status: 'started', start_date: '2026-07-08', economics: { model: 'contract', billAmount: 2400, loadedCost: 1800, grossMarginAmount: 600, originalCurrency: 'INR', originalPeriod: 'day' }, invoice: { id: 'invoice-java', number: 'QA-INV-002', totalAmount: 48000 }, collections: { amount: 48000 }, open_adjustment_count: 1, adjustment_count: 1 },
];

const analytics = {
  acquisitionFunnel: [
    { stage: 'job_leads', count: 24 }, { stage: 'poc_ready', count: 15 },
    { stage: 'requirements', count: 9 }, { stage: 'matches', count: 28 }, { stage: 'shortlists', count: 14 },
  ],
  funnel: [
    { status: 'draft', count: 10 }, { status: 'approved', count: 8 }, { status: 'submitted', count: 7 },
    { status: 'interviewing', count: 4 }, { status: 'offered', count: 3 }, { status: 'placed', count: 2 },
  ],
  commercial: { starts: 2, gross_margin: 228000, invoiced: 228000, collected: 138000 },
  exceptions: { overdue_submissions: 1, missing_next_action: 0 },
  timeToFill: { average_days: 24 },
  cohorts: [{ cohort: 'Jul 2026', requirements: 9, submissions: 7, starts: 2 }],
  recruiterPerformance: [{ recruiter: 'Recruiter One', submissions: 4, progressed: 3, starts: 1 }, { recruiter: 'Recruiter Two', submissions: 3, progressed: 2, starts: 1 }],
  sourcePerformance: [{ source: 'theirstack', submissions: 4, starts: 1 }, { source: 'ats', submissions: 3, starts: 1 }],
  aging: [{ bucket: '0-2 days', count: 6 }, { bucket: '3-5 days', count: 2 }],
  rejectionReasons: [{ reason: 'Mandatory skill missing', count: 3 }, { reason: 'Availability mismatch', count: 2 }],
  filterOptions: {
    companies: [{ id: 'company-a', label: 'Company A (Training)' }],
    recruiters: [{ id: 'recruiter-1', label: 'Recruiter One' }],
    skills: [{ id: 'skill-abap', label: 'SAP ABAP' }, { id: 'skill-java', label: 'Java' }],
    sources: ['theirstack', 'ats'],
  },
};

function responseFor(url) {
  const pathname = url.pathname;
  if (pathname === '/api/inbox/unread-count' || pathname === '/api/finance/leaves/pending-count') return { count: 0 };
  if (pathname === '/api/wizmatch/staffing/access') return access;
  if (pathname === '/api/wizmatch/staffing/my-work') return { workItems, items: workItems, summary: {} };
  if (pathname === '/api/wizmatch/review-workbench') return { actions: [] };
  if (pathname === '/api/wizmatch/sourcing/status') return {
    config: { theirstackEnabled: true, atsEnabled: true, pocDiscoveryEnabled: true },
    providerAccounts: { theirstack: { configured: true }, searchapi: { configured: true } },
    latestRuns: [{ provider: 'theirstack', status: 'completed' }, { provider: 'ats', status: 'completed' }],
  };
  if (pathname === '/api/wizmatch/signals') return { items: signals, total: signals.length };
  if (pathname === '/api/wizmatch/staffing/companies') return { items: companies, total: companies.length };
  if (pathname === '/api/wizmatch/staffing/hiring-contacts') return { items: hiringContacts, total: hiringContacts.length };
  if (pathname === '/api/wizmatch/requirements') return { items: roles, total: roles.length };
  if (pathname === '/api/wizmatch/staffing/recruiter-work') return { items: matches };
  if (pathname === '/api/wizmatch/candidates') return { items: [], total: 0 };
  if (pathname === '/api/wizmatch/candidate-intelligence/queue') return { items: [], total: 0 };
  if (pathname === '/api/wizmatch/staffing/delivery-board') return { items: deliveryBoard };
  if (pathname === '/api/wizmatch/staffing/placements') return { items: placements };
  if (pathname === '/api/wizmatch/staffing/analytics') return analytics;
  return { items: [], total: 0 };
}

const captures = [
  ['01-today.png', '/wizmatch/today', 'Today'],
  ['02-job-leads.png', '/wizmatch/job-leads', 'Job Leads'],
  ['03-companies.png', '/wizmatch/companies', 'Companies'],
  ['04-hiring-contacts.png', '/wizmatch/hiring-contacts', 'Hiring Contacts'],
  ['05-roles-requirements.png', '/wizmatch/roles', 'Roles / Requirements'],
  ['06-candidates-matching.png', '/wizmatch/candidates?view=matching', 'Candidates'],
  ['07-submissions.png', '/wizmatch/submissions', 'Submissions'],
  ['08-placements.png', '/wizmatch/placements', 'Placements'],
  ['09-reports.png', '/wizmatch/reports', 'Staffing reports'],
];

await mkdir(output, { recursive: true });
process.stdout.write(`CAPTURE_BASE ${baseUrl}\n`);
for (const [filename, route, heading] of captures) {
  // A fresh headless browser process per capture prevents Chromium/macOS from
  // reusing unpainted compositor tiles and writing black rectangles into PNGs.
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'sanitized-local-training-session');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ id: 'training-admin', name: 'Training Admin', email: 'training@example.test', role: 'admin', tenantSlug: 'wizmatch' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify({ staffingPilotAccess: true }));
  });
  await context.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFor(new URL(route.request().url()))) });
  });

    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    // Vite keeps a development websocket open, so networkidle is not a useful
    // completion signal here. The page heading and intercepted API state are.
    process.stdout.write(`OPEN ${route}\n`);
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.getByRole('heading', { level: 1, name: heading }).waitFor({ state: 'visible' });
    await page.evaluate(() => {
      document.body.style.visibility = 'hidden';
      document.body.getBoundingClientRect();
      document.body.style.visibility = 'visible';
      document.documentElement.getBoundingClientRect();
    });
    await page.waitForTimeout(750);
    await page.locator('body').screenshot({ path: path.join(output, filename), animations: 'disabled' });
    await page.close();
    process.stdout.write(`CAPTURED ${filename}\n`);
  } finally {
    await browser.close();
  }
}
