import { expect, test, type Page, type Route } from '@playwright/test';

const session = { token: 'local-wizmatch-gate-bc-token', user: { id: 'admin-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: 'wizmatch' } };
async function json(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }); }
async function setup(page: Page) {
  await page.addInitScript((value) => { localStorage.setItem('crm_active_tenant_slug','wizmatch'); localStorage.setItem('wizmatch_crm_token',value.token); localStorage.setItem('wizmatch_crm_user',JSON.stringify(value.user)); localStorage.setItem('wizmatch_crm_permissions',JSON.stringify({ staffingPilotAccess: true })); }, session);
  await page.route('**/api/**', async route => { const path=new URL(route.request().url()).pathname; if(path==='/api/inbox/unread-count'||path==='/api/finance/leaves/pending-count') return json(route,{count:0}); if(path==='/api/wizmatch/staffing/access') return json(route,{allowed:true,phases:{A:true,B:true,C:true},capabilities:{viewCommercial:true,operateDelivery:true,approveSubmissions:true,manageOffers:true,manageFinance:true}}); return json(route,{}); });
}

test('Talent Matching shows explainable SAP and Java decisions without submission side effects', async ({ page }) => {
  await setup(page); let decision=''; let consentRecorded=false; let draftRecorded=false;
  const items=[
    {id:'m-sap',candidate_id:'c-sap',requirement_id:'r-sap',first_name:'Asha',last_name:'SAP',requirement_title:'SAP ABAP Developer',score:96,score_version:'gate-b-v1',blockers:[],missing_evidence:[],human_decision:'unreviewed'},
    {id:'m-java',candidate_id:'c-java',requirement_id:'r-java',first_name:'Jay',last_name:'Java',requirement_title:'Java Developer',score:88,score_version:'gate-b-v1',blockers:[],missing_evidence:['recency:Java'],human_decision:'shortlisted'},
  ];
  await page.route('**/api/wizmatch/staffing/recruiter-work',route=>json(route,{items}));
  await page.route('**/api/wizmatch/staffing/matches/*/decision',async route=>{decision=(await route.request().postDataJSON()).decision;return json(route,{ok:true});});
  await page.route('**/api/wizmatch/staffing/consents',async route=>{consentRecorded=true;return json(route,{id:'consent-1'},201);});
  await page.route('**/api/wizmatch/staffing/submissions',async route=>{draftRecorded=true;return json(route,{id:'submission-1'},201);});
  await page.goto('/wizmatch/talent-matching');
  await expect(page.getByRole('heading',{name:'Talent Matching'})).toBeVisible();
  await expect(page.getByText('SAP ABAP Developer')).toBeVisible(); await expect(page.getByText('Java Developer')).toBeVisible();
  await page.locator('article').filter({hasText:'Asha SAP'}).getByRole('button',{name:'Shortlist'}).click(); await expect.poll(()=>decision).toBe('shortlisted');
  page.once('dialog',dialog=>dialog.accept()); await page.locator('article').filter({hasText:'Jay Java'}).getByRole('button',{name:'Record consent + draft'}).click();
  await expect.poll(()=>consentRecorded&&draftRecorded).toBe(true);
});

test('Delivery board traces approval through placement without automatic sending', async ({ page }) => {
  // The Wizmatch complete build (Jul 2026) replaced this page's native
  // prompt() chain with accessible dialogs (DialogShell + ConfirmDialog).
  // page.on('dialog') below asserts that invariant directly — any native
  // dialog appearing during this flow now fails the test instead of being
  // silently auto-accepted.
  await setup(page); const recorded: string[]=[];
  const draft={id:'s-1',first_name:'Asha',last_name:'SAP',requirement_title:'SAP ABAP Developer',company_name:'Company A',consent_status:'granted',status:'draft',resend_count:0,interview_count:0};
  await page.route('**/api/wizmatch/staffing/delivery-board',route=>json(route,{items:[draft]}));
  await page.route('**/api/wizmatch/staffing/analytics',route=>json(route,{commercial:{starts:0,gross_margin:0,invoiced:0,collected:0},exceptions:{overdue_submissions:0,missing_next_action:1},timeToFill:{average_days:null}}));
  await page.route('**/api/wizmatch/staffing/submissions/s-1/approve',route=>{recorded.push('approved');draft.status='approved';return json(route,{status:'approved'});});
  await page.route('**/api/wizmatch/staffing/submissions/s-1/record-sent',route=>{recorded.push('sent');draft.status='submitted';return json(route,{status:'submitted'});});
  await page.route('**/api/wizmatch/staffing/submissions/s-1/interviews',route=>{recorded.push('interview');draft.status='interviewing';draft.interview_count=1;return json(route,{id:'interview-1'},201);});
  await page.route('**/api/wizmatch/staffing/submissions/s-1/offers',route=>{recorded.push('offer');draft.status='offered';Object.assign(draft,{latest_offer_id:'offer-1',offer_revision:1,offer_status:'draft'});return json(route,{id:'offer-1'},201);});
  await page.route('**/api/wizmatch/staffing/offers/offer-1/status',route=>{recorded.push('accepted');draft.offer_status='accepted';return json(route,{status:'accepted'});});
  await page.route('**/api/wizmatch/staffing/submissions/s-1/placement',route=>{recorded.push('placed');draft.status='placed';return json(route,{placement:{id:'placement-1'}},201);});
  page.on('dialog', (dialog) => { throw new Error(`Unexpected native ${dialog.type()} dialog: "${dialog.message()}"`); });

  await page.goto('/wizmatch/delivery'); await expect(page.getByRole('heading',{name:'Submissions & Delivery'})).toBeVisible();
  await expect(page.getByText(/never sends automatically/i)).toBeVisible();

  await page.getByRole('button',{name:'Approve'}).click();
  await expect.poll(()=>recorded).toEqual(['approved']);

  await page.getByRole('button',{name:'Record sent'}).click();
  let dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Recipient name *').fill('Person A');
  await dialog.locator('input[type="datetime-local"]').fill('2026-07-15T10:00');
  await dialog.getByRole('button', { name: 'Record sent' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(()=>recorded).toEqual(['approved','sent']);

  await page.getByRole('button',{name:'Add interview'}).click();
  dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  // Schedule mode has two datetime-local fields: "Scheduled at *" (first,
  // required) and "Next action due" (second, optional) — only the first is needed.
  await dialog.locator('input[type="datetime-local"]').first().fill('2026-07-16T10:00');
  await dialog.getByRole('button', { name: 'Schedule round' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(()=>recorded).toEqual(['approved','sent','interview']);

  await page.getByRole('button',{name:'Add offer'}).click();
  dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="number"]').fill('1200000');
  await dialog.getByRole('button', { name: 'Create offer' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(()=>recorded).toEqual(['approved','sent','interview','offer']);

  await page.getByRole('button',{name:'Record accepted'}).click();
  await expect.poll(()=>recorded).toEqual(['approved','sent','interview','offer','accepted']);

  await page.getByRole('button',{name:'Create placement'}).click();
  dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="number"]').fill('1800000');
  await dialog.getByRole('button', { name: 'Create placement' }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(()=>recorded).toEqual(['approved','sent','interview','offer','accepted','placed']);
});
